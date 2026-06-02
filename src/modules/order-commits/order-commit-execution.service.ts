import {
  AuditAction,
  AuditEntityType,
  InvoiceLineType,
  InvoiceType,
  OrderActivityType,
  Prisma,
  type PrismaClient,
  UserRole,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
import { withRetry } from "@/lib/retry";
import type { FinancialCaseSummary } from "@/modules/financial-cases/financial-case-summary.types";
import {
  createOrderCommitDocumentLinks,
} from "./order-commit-document.service";
import {
  ORDER_COMMIT_DOCUMENT_ROLE,
  ORDER_COMMIT_KIND,
  ORDER_COMMIT_SNAPSHOT_VERSION,
  ORDER_COMMIT_STATUS,
} from "./order-commit.constants";
import {
  materializeOrderCommitDraftIntoOrderRows,
} from "./order-commit-materialization.service";
import {
  buildOrderCommitApprovalAndDocumentPreview,
  type OrderCommitPreviewPaymentState,
} from "./order-commit-approval-document-preview.service";
import {
  mapOrderCommitDiffToFinancialLines,
} from "./order-commit-financial-emission.service";
import {
  classifyOrderCommitPreview,
} from "./order-commit-preview-classification.service";
import {
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
} from "./order-commit-preview.constants";
import {
  diffOrderCommitSnapshots,
} from "./order-commit-preview-diff.service";
import {
  resolveOrderCommitPreviewBaseline,
} from "./order-commit-preview-baseline.service";
import {
  orderCommitKindSchema,
  orderCommitSnapshotV1Schema,
} from "./order-commit.schema";
import type {
  OrderCommitDocumentPlanPreview,
  OrderCommitPreviewBaselineSource,
  OrderCommitSnapshotDiff,
} from "./order-commit-preview.types";
import type {
  OrderCommitAdjustmentReversal,
  OrderCommitFinancialEmission,
  OrderCommitOpenAdjustmentLine,
} from "./order-commit-financial-emission.service";
import type {
  OrderCommitDocumentRole,
  OrderCommitKind,
  OrderCommitSnapshotV1,
} from "./order-commit.types";

export class OrderCommitCreditCapacityExhaustedError extends Error {
  constructor(
    public readonly payload: {
      orderId: string;
      expectedFinalCreditTotal: number;
      currentCapacity: number;
    }
  ) {
    super(
      `OrderCommit credit capacity exhausted for order ${payload.orderId}: expected ${payload.expectedFinalCreditTotal.toFixed(
        3
      )}, current capacity ${payload.currentCapacity.toFixed(3)}.`
    );
    this.name = "OrderCommitCreditCapacityExhaustedError";
  }
}

export class OrderCommitApprovalRequiredError extends Error {
  constructor(
    public readonly payload: {
      orderId: string;
      approvalActorUserId: string | null;
    }
  ) {
    super(`OrderCommit approval is required for order ${payload.orderId}.`);
    this.name = "OrderCommitApprovalRequiredError";
  }
}

export class OrderCommitStaleDraftError extends Error {
  constructor(
    public readonly payload: {
      orderId: string;
      expectedDraftVersion: number;
      actualDraftVersion: number | null;
      draftId: string | null;
    }
  ) {
    super(
      `OrderCommit draft is stale for order ${payload.orderId}: expected version ${payload.expectedDraftVersion}, actual version ${payload.actualDraftVersion ?? "none"}.`
    );
    this.name = "OrderCommitStaleDraftError";
  }
}

export class OrderCommitConcurrentCommitError extends Error {
  constructor(
    public readonly payload: {
      orderId: string;
      draftVersion: number;
    }
  ) {
    super(
      `OrderCommit concurrent commit detected for order ${payload.orderId} at draft version ${payload.draftVersion}.`
    );
    this.name = "OrderCommitConcurrentCommitError";
  }
}

export type OrderCommitEmissionResult = {
  emissions: Array<{
    invoice: { id: string };
    role: OrderCommitDocumentRole;
  }>;
};

export type CommitOrderChangesInput = {
  orderId: string;
  expectedDraftVersion: number;
  approvalActorUserId?: string;
  actorContext: ActorContext;
  client?: PrismaClient;
};

export type OrderCommitExecutionResult = {
  orderCommit: {
    id: string;
    sequence: number;
  };
  emittedDocuments: Array<{
    orderCommitDocumentId: string;
    invoiceId: string;
    role: OrderCommitDocumentRole;
  }>;
};

export type EmitOrderCommitFinancialDocumentsInput = {
  orderId: string;
  financialCaseId: string;
  baselineSource: OrderCommitPreviewBaselineSource;
  diff: OrderCommitSnapshotDiff;
  documentPlan: OrderCommitDocumentPlanPreview;
  requiresApproval: boolean;
  draftToOrderEntityMap: ReadonlyMap<string, string>;
  actorContext: ActorContext;
  approvalActorUserId?: string;
  client: Prisma.TransactionClient;
  dependencies?: Partial<OrderCommitInvoiceEmissionDependencies>;
};

type BuildOpenAdjustmentLineMap = typeof import("@/modules/invoices/invoice.service")["buildOpenAdjustmentLineMap"];
type ComputeCreditNoteCapacityForFinal = typeof import("@/modules/invoices/invoice.service")["computeCreditNoteCapacityForFinal"];
type CreateAdjustmentInvoiceWithClient = typeof import("@/modules/invoices/invoice.service")["createAdjustmentInvoiceWithClient"];
type CreateCreditNoteWithClient = typeof import("@/modules/invoices/invoice.service")["createCreditNoteWithClient"];
type CreateInvoiceForOrderWithClient = typeof import("@/modules/invoices/invoice.service")["createInvoiceForOrderWithClient"];
type OpenAdjustmentLineMap = Awaited<ReturnType<BuildOpenAdjustmentLineMap>>;

type OrderCommitInvoiceEmissionDependencies = {
  buildOpenAdjustmentLineMap: BuildOpenAdjustmentLineMap;
  computeCreditNoteCapacityForFinal: ComputeCreditNoteCapacityForFinal;
  createAdjustmentInvoiceWithClient: CreateAdjustmentInvoiceWithClient;
  createCreditNoteWithClient: CreateCreditNoteWithClient;
  createInvoiceForOrderWithClient: CreateInvoiceForOrderWithClient;
  mapOrderCommitDiffToFinancialLines: typeof mapOrderCommitDiffToFinancialLines;
};

const ONE_FILS = 0.001;

const orderCommitExecutionDraftSelect = {
  id: true,
  orderId: true,
  financialCaseId: true,
  pendingSnapshotJson: true,
  version: true,
} satisfies Prisma.OrderCommitDraftSelect;

const orderCommitExecutionOrderSelect = {
  id: true,
  booking: {
    select: {
      financialCase: { select: { id: true } },
    },
  },
} satisfies Prisma.OrderSelect;

type OrderCommitExecutionDraft = Prisma.OrderCommitDraftGetPayload<{
  select: typeof orderCommitExecutionDraftSelect;
}>;

type OrderCommitExecutionClient = PrismaClient;
type OrderCommitExecutionTransactionClient = Prisma.TransactionClient;

export async function commitOrderChanges(
  input: CommitOrderChangesInput
): Promise<OrderCommitExecutionResult> {
  const client = input.client ?? (await loadDefaultOrderCommitExecutionClient());

  return withRetry(
    () =>
      client.$transaction(
        (transaction) => commitOrderChangesWithTransaction(input, transaction),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      ),
    "OrderCommit execution failed",
    3,
    shouldRetryOrderCommitExecution
  );
}

async function commitOrderChangesWithTransaction(
  input: CommitOrderChangesInput,
  client: OrderCommitExecutionTransactionClient
): Promise<OrderCommitExecutionResult> {
  await lockOrderForUpdate(client, input.orderId);
  const order = await client.order.findUnique({
    where: { id: input.orderId },
    select: orderCommitExecutionOrderSelect,
  });
  if (!order) {
    throw new Error(
      `OrderCommit execution failed: order ${input.orderId} was not found.`
    );
  }

  await lockOrderCommitDraftForUpdate(client, input.orderId);
  const draft = await client.orderCommitDraft.findUnique({
    where: { orderId: input.orderId },
    select: orderCommitExecutionDraftSelect,
  });
  const activeDraft = assertExpectedDraftVersion({
    orderId: input.orderId,
    expectedDraftVersion: input.expectedDraftVersion,
    draft,
  });

  const latestCommit = await client.orderCommit.findFirst({
    where: { orderId: input.orderId },
    orderBy: [{ sequence: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: { id: true, sequence: true },
  });
  if (latestCommit) {
    await lockOrderCommitForUpdate(client, latestCommit.id);
  }

  const pendingSnapshot = orderCommitSnapshotV1Schema.parse(
    activeDraft.pendingSnapshotJson
  );
  assertSnapshotIdentity({
    orderId: input.orderId,
    orderFinancialCaseId: order.booking.financialCase?.id ?? null,
    draft: activeDraft,
    pendingSnapshot,
  });

  const baseline = await resolveOrderCommitPreviewBaseline({
    orderId: input.orderId,
    client,
  });
  const diff = diffOrderCommitSnapshots({
    baseSnapshot: baseline.snapshot,
    pendingSnapshot,
  });
  const classification = classifyOrderCommitPreview({ diff });
  const paymentState = await loadPreviewPaymentState(input.orderId, client);
  const approvalAndDocumentPreview =
    buildOrderCommitApprovalAndDocumentPreview({
      baselineSource: baseline.baselineSource,
      classification,
      paymentState,
    });

  const { draftToOrderEntityMap } =
    await materializeOrderCommitDraftIntoOrderRows({
      orderId: input.orderId,
      pendingSnapshot,
      actorContext: input.actorContext,
      client,
    });

  if (shouldEmitFinancialDocuments(approvalAndDocumentPreview.documentPlan)) {
    await lockParentInvoiceForEmissionIfPresent({
      baselineSource: baseline.baselineSource,
      financialCaseId: pendingSnapshot.financialCaseId,
      orderId: input.orderId,
      client,
    });
  }

  const { emissions } = shouldEmitFinancialDocuments(
    approvalAndDocumentPreview.documentPlan
  )
    ? await emitOrderCommitFinancialDocuments({
        orderId: input.orderId,
        financialCaseId: pendingSnapshot.financialCaseId,
        baselineSource: baseline.baselineSource,
        diff,
        documentPlan: approvalAndDocumentPreview.documentPlan,
        requiresApproval: approvalAndDocumentPreview.requiresApproval,
        draftToOrderEntityMap,
        actorContext: input.actorContext,
        approvalActorUserId: input.approvalActorUserId,
        client,
      })
    : { emissions: [] };

  const orderCommit = await createCommittedOrderCommitRow({
    orderId: input.orderId,
    financialCaseId: pendingSnapshot.financialCaseId,
    previousCommitId: latestCommit?.id ?? null,
    sequence: (latestCommit?.sequence ?? 0) + 1,
    kind: commitKindForDocumentPlan({
      baselineSource: baseline.baselineSource,
      documentPlanKind: approvalAndDocumentPreview.documentPlan.kind,
    }),
    pendingSnapshot,
    draftVersion: activeDraft.version,
    metadata: {
      commitKind: classification.commitKind,
      documentPlanKind: approvalAndDocumentPreview.documentPlan.kind,
      approvalActorUserId: input.approvalActorUserId ?? null,
      netDelta: classification.netDelta,
    },
    actorContext: input.actorContext,
    client,
  });

  await createOrderCommitDocumentLinks({
    orderCommitId: orderCommit.id,
    emissions,
    client,
  });
  const emittedDocuments = await loadOrderCommitDocumentResults(
    client,
    orderCommit.id
  );

  await recordOrderCommitAudit({
    orderId: input.orderId,
    financialCaseId: pendingSnapshot.financialCaseId,
    orderCommit,
    documentPlanKind: approvalAndDocumentPreview.documentPlan.kind,
    netDelta: classification.netDelta,
    emittedDocumentCount: emittedDocuments.length,
    actorContext: input.actorContext,
    client,
  });
  await recordOrderCommitActivity({
    orderId: input.orderId,
    orderCommit,
    documentPlanKind: approvalAndDocumentPreview.documentPlan.kind,
    emittedDocumentCount: emittedDocuments.length,
    actorContext: input.actorContext,
    client,
  });

  await assertOrderCommitFinancialCaseInvariants(
    pendingSnapshot.financialCaseId,
    client
  );

  await client.orderCommitDraft.delete({
    where: { id: activeDraft.id },
    select: { id: true },
  });

  return {
    orderCommit: {
      id: orderCommit.id,
      sequence: orderCommit.sequence,
    },
    emittedDocuments,
  };
}

function assertExpectedDraftVersion(input: {
  orderId: string;
  expectedDraftVersion: number;
  draft: OrderCommitExecutionDraft | null;
}): OrderCommitExecutionDraft {
  if (!input.draft || input.draft.version !== input.expectedDraftVersion) {
    throw new OrderCommitStaleDraftError({
      orderId: input.orderId,
      expectedDraftVersion: input.expectedDraftVersion,
      actualDraftVersion: input.draft?.version ?? null,
      draftId: input.draft?.id ?? null,
    });
  }
  return input.draft;
}

function assertSnapshotIdentity(input: {
  orderId: string;
  orderFinancialCaseId: string | null;
  draft: OrderCommitExecutionDraft;
  pendingSnapshot: OrderCommitSnapshotV1;
}): void {
  if (input.pendingSnapshot.orderId !== input.orderId) {
    throw new Error(
      `OrderCommit execution failed: draft snapshot order ${input.pendingSnapshot.orderId} does not match order ${input.orderId}.`
    );
  }
  if (input.pendingSnapshot.financialCaseId !== input.draft.financialCaseId) {
    throw new Error(
      `OrderCommit execution failed: draft ${input.draft.id} resolved inconsistent FinancialCase ids.`
    );
  }
  if (
    input.orderFinancialCaseId &&
    input.orderFinancialCaseId !== input.pendingSnapshot.financialCaseId
  ) {
    throw new Error(
      `OrderCommit execution failed: order ${input.orderId} resolved inconsistent FinancialCase ids.`
    );
  }
}

async function loadPreviewPaymentState(
  orderId: string,
  client: OrderCommitExecutionTransactionClient
): Promise<OrderCommitPreviewPaymentState> {
  const { getFinancialCaseSummary } = await import(
    "@/modules/financial-cases/financial-case-summary.service"
  );
  const summary = await getFinancialCaseSummary({ orderId }, client);
  if (!summary) {
    throw new Error(
      `OrderCommit execution failed: FinancialCase summary for order ${orderId} was not found.`
    );
  }

  return paymentStateFromFinancialCaseSummary(summary);
}

function paymentStateFromFinancialCaseSummary(
  summary: FinancialCaseSummary
): OrderCommitPreviewPaymentState {
  if (summary.stage === "booking") {
    return {
      alreadyPaidAmount: summary.depositInvoice?.paidAmount ?? 0,
      currentRemainingAmount: 0,
      creditNoteCapacity: 0,
      overpaymentCapacity: 0,
    };
  }

  return {
    alreadyPaidAmount: summary.effectivePaid,
    currentRemainingAmount: summary.remaining,
    creditNoteCapacity: summary.creditNoteCapacity,
    overpaymentCapacity: summary.overpaymentCapacity,
  };
}

function shouldEmitFinancialDocuments(
  documentPlan: OrderCommitDocumentPlanPreview
): boolean {
  return (
    documentPlan.kind !==
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ZERO_NET_AUDIT_COMMIT &&
    documentPlan.kind !== ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.NO_OP
  );
}

async function lockParentInvoiceForEmissionIfPresent(input: {
  baselineSource: OrderCommitPreviewBaselineSource;
  financialCaseId: string;
  orderId: string;
  client: OrderCommitExecutionTransactionClient;
}): Promise<void> {
  if (
    input.baselineSource !==
    ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT
  ) {
    return;
  }

  const parentFinalInvoiceId = await resolveLockedParentFinalInvoiceId({
    financialCaseId: input.financialCaseId,
    orderId: input.orderId,
    client: input.client,
  });
  await lockInvoiceForUpdate(input.client, parentFinalInvoiceId);
}

function commitKindForDocumentPlan(input: {
  baselineSource: OrderCommitPreviewBaselineSource;
  documentPlanKind: OrderCommitDocumentPlanPreview["kind"];
}): OrderCommitKind {
  if (
    input.documentPlanKind ===
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ZERO_NET_AUDIT_COMMIT ||
    input.documentPlanKind === ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.NO_OP
  ) {
    return orderCommitKindSchema.parse(ORDER_COMMIT_KIND.AUDIT);
  }

  if (
    input.baselineSource !==
    ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT
  ) {
    return orderCommitKindSchema.parse(ORDER_COMMIT_KIND.BASELINE);
  }

  return orderCommitKindSchema.parse(ORDER_COMMIT_KIND.ADJUSTMENT);
}

async function createCommittedOrderCommitRow(input: {
  orderId: string;
  financialCaseId: string;
  previousCommitId: string | null;
  sequence: number;
  kind: OrderCommitKind;
  pendingSnapshot: OrderCommitSnapshotV1;
  draftVersion: number;
  metadata: Record<string, unknown>;
  actorContext: ActorContext;
  client: OrderCommitExecutionTransactionClient;
}): Promise<{
  id: string;
  sequence: number;
  kind: OrderCommitKind;
}> {
  try {
    const row = await input.client.orderCommit.create({
      data: {
        orderId: input.orderId,
        financialCaseId: input.financialCaseId,
        previousCommitId: input.previousCommitId,
        sequence: input.sequence,
        kind: input.kind,
        status: ORDER_COMMIT_STATUS.COMMITTED,
        snapshotVersion: ORDER_COMMIT_SNAPSHOT_VERSION,
        snapshotJson: input.pendingSnapshot as unknown as Prisma.InputJsonValue,
        metadataJson: input.metadata as Prisma.InputJsonObject,
        committedByUserId: input.actorContext.actorUserId.trim() || null,
        committedFromDraftVersion: input.draftVersion,
      },
      select: { id: true, sequence: true, kind: true },
    });

    return {
      id: row.id,
      sequence: row.sequence,
      kind: orderCommitKindSchema.parse(row.kind),
    };
  } catch (error) {
    if (isUniqueCommittedFromDraftVersionConflict(error)) {
      throw new OrderCommitConcurrentCommitError({
        orderId: input.orderId,
        draftVersion: input.draftVersion,
      });
    }
    throw error;
  }
}

async function loadOrderCommitDocumentResults(
  client: OrderCommitExecutionTransactionClient,
  orderCommitId: string
): Promise<OrderCommitExecutionResult["emittedDocuments"]> {
  const rows = await client.orderCommitDocument.findMany({
    where: { orderCommitId },
    select: { id: true, invoiceId: true, role: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return rows.map((row) => ({
    orderCommitDocumentId: row.id,
    invoiceId: row.invoiceId,
    role: row.role as OrderCommitDocumentRole,
  }));
}

async function recordOrderCommitAudit(input: {
  orderId: string;
  financialCaseId: string;
  orderCommit: { id: string; sequence: number; kind: OrderCommitKind };
  documentPlanKind: OrderCommitDocumentPlanPreview["kind"];
  netDelta: number;
  emittedDocumentCount: number;
  actorContext: ActorContext;
  client: OrderCommitExecutionTransactionClient;
}): Promise<void> {
  const { recordAuditLog } = await import("@/modules/audit/audit-log.service");
  await recordAuditLog(input.client, input.actorContext, {
    entityType: AuditEntityType.ORDER_COMMIT,
    entityId: input.orderCommit.id,
    action: AuditAction.ORDER_COMMIT_CREATED,
    after: {
      orderId: input.orderId,
      financialCaseId: input.financialCaseId,
      sequence: input.orderCommit.sequence,
      kind: input.orderCommit.kind,
      documentPlanKind: input.documentPlanKind,
      netDelta: input.netDelta,
      emittedDocumentCount: input.emittedDocumentCount,
    },
    context: {
      orderId: input.orderId,
      financialCaseId: input.financialCaseId,
    },
  });
}

async function recordOrderCommitActivity(input: {
  orderId: string;
  orderCommit: { id: string; sequence: number; kind: OrderCommitKind };
  documentPlanKind: OrderCommitDocumentPlanPreview["kind"];
  emittedDocumentCount: number;
  actorContext: ActorContext;
  client: OrderCommitExecutionTransactionClient;
}): Promise<void> {
  const { recordOrderActivity } = await import(
    "@/modules/orders/order-activity.service"
  );
  await recordOrderActivity(input.client, {
    orderId: input.orderId,
    userId: input.actorContext.actorUserId,
    type: OrderActivityType.ORDER_COMMITTED,
    title: "Order committed",
    description: `OrderCommit sequence ${input.orderCommit.sequence} committed.`,
    metadata: {
      orderCommitId: input.orderCommit.id,
      sequence: input.orderCommit.sequence,
      kind: input.orderCommit.kind,
      documentPlanKind: input.documentPlanKind,
      emittedDocumentCount: input.emittedDocumentCount,
    },
  });
}

async function lockOrderForUpdate(
  client: OrderCommitExecutionTransactionClient,
  orderId: string
): Promise<void> {
  await client.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "orders" WHERE id = ${orderId} FOR UPDATE
  `;
}

async function lockOrderCommitDraftForUpdate(
  client: OrderCommitExecutionTransactionClient,
  orderId: string
): Promise<void> {
  await client.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "order_commit_drafts" WHERE "orderId" = ${orderId} FOR UPDATE
  `;
}

async function lockOrderCommitForUpdate(
  client: OrderCommitExecutionTransactionClient,
  orderCommitId: string
): Promise<void> {
  await client.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "order_commits" WHERE id = ${orderCommitId} FOR UPDATE
  `;
}

async function lockInvoiceForUpdate(
  client: OrderCommitExecutionTransactionClient,
  invoiceId: string
): Promise<void> {
  await client.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "invoices" WHERE id = ${invoiceId} FOR UPDATE
  `;
}

async function assertOrderCommitFinancialCaseInvariants(
  financialCaseId: string,
  client: OrderCommitExecutionTransactionClient
): Promise<void> {
  const { assertFinancialCaseInvariants } = await import(
    "@/modules/financial/invariants"
  );
  await assertFinancialCaseInvariants(financialCaseId, client);
}

async function loadOrderCommitInvoiceEmissionDependencies(
  overrides: Partial<OrderCommitInvoiceEmissionDependencies> = {}
): Promise<OrderCommitInvoiceEmissionDependencies> {
  const invoiceService = await import("@/modules/invoices/invoice.service");
  return {
    buildOpenAdjustmentLineMap: invoiceService.buildOpenAdjustmentLineMap,
    computeCreditNoteCapacityForFinal:
      invoiceService.computeCreditNoteCapacityForFinal,
    createAdjustmentInvoiceWithClient:
      invoiceService.createAdjustmentInvoiceWithClient,
    createCreditNoteWithClient: invoiceService.createCreditNoteWithClient,
    createInvoiceForOrderWithClient:
      invoiceService.createInvoiceForOrderWithClient,
    mapOrderCommitDiffToFinancialLines,
    ...overrides,
  };
}

export async function emitOrderCommitFinancialDocuments(
  input: EmitOrderCommitFinancialDocumentsInput
): Promise<OrderCommitEmissionResult> {
  const dependencies = await loadOrderCommitInvoiceEmissionDependencies(
    input.dependencies
  );

  await assertApprovalIfRequired(input);

  const isFirstCommit =
    input.baselineSource !==
    ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT;
  const openAdjustmentLinesByCause = isFirstCommit
    ? new Map<string, OrderCommitOpenAdjustmentLine[]>()
    : toOrderCommitOpenAdjustmentLineMap(
        await dependencies.buildOpenAdjustmentLineMap(
          input.financialCaseId,
          input.orderId,
          input.client
        )
      );
  const emission = dependencies.mapOrderCommitDiffToFinancialLines({
    diff: input.diff,
    baselineSource: input.baselineSource,
    draftToOrderEntityMap: input.draftToOrderEntityMap,
    openAdjustmentLinesByCause,
  });

  if (isFirstCommit) {
    assertFirstCommitHasNoCreditSide(input.orderId, emission);
    const invoice = await dependencies.createInvoiceForOrderWithClient(
      input.client,
      input.orderId,
      input.actorContext
    );
    return {
      emissions: [
        {
          invoice,
          role: ORDER_COMMIT_DOCUMENT_ROLE.BASE_INVOICE,
        },
      ],
    };
  }

  const hasInvoiceEmission =
    emission.adjustmentLines.length > 0 ||
    emission.adjustmentReversals.length > 0 ||
    emission.creditNoteFinalLines.length > 0;
  if (!hasInvoiceEmission) {
    return { emissions: [] };
  }

  const parentFinalInvoiceId = await resolveLockedParentFinalInvoiceId({
    financialCaseId: input.financialCaseId,
    orderId: input.orderId,
    client: input.client,
  });
  await assertFinalCreditCapacity({
    orderId: input.orderId,
    parentFinalInvoiceId,
    emission,
    client: input.client,
    computeCreditNoteCapacityForFinal:
      dependencies.computeCreditNoteCapacityForFinal,
  });

  const emissions: OrderCommitEmissionResult["emissions"] = [];
  if (emission.adjustmentLines.length > 0) {
    const adjustmentInvoice =
      await dependencies.createAdjustmentInvoiceWithClient(
        {
          parentFinalInvoiceId,
          lines: emission.adjustmentLines,
          createdByUserId:
            input.approvalActorUserId ?? input.actorContext.actorUserId,
          notes: "OrderCommit adjustment invoice emission",
        },
        input.client
      );
    emissions.push({
      invoice: adjustmentInvoice,
      role: ORDER_COMMIT_DOCUMENT_ROLE.ADJUSTMENT_INVOICE,
    });
  }

  for (const reversals of groupAdjustmentReversals(
    emission.adjustmentReversals
  ).values()) {
    const firstReversal = reversals[0];
    if (!firstReversal) continue;
    const creditNote = await dependencies.createCreditNoteWithClient(
      {
        targetAdjustmentInvoiceId: firstReversal.parentAdjustmentInvoiceId,
        lines: reversals.map((reversal) => ({
          lineType: InvoiceLineType.MANUAL_DISCOUNT,
          description: reversal.description,
          quantity: 1,
          unitPrice: reversal.amount,
          causeOrderEntityKind: reversal.causeOrderEntityKind,
          causeOrderEntityId: reversal.causeOrderEntityId,
          targetInvoiceId: reversal.parentAdjustmentInvoiceId,
          targetInvoiceLineId: reversal.targetInvoiceLineId,
        })),
        reason: creditReasonForReversals(reversals),
        createdByUserId:
          input.approvalActorUserId ?? input.actorContext.actorUserId,
        notes: "OrderCommit adjustment reversal credit note emission",
      },
      input.client
    );
    emissions.push({
      invoice: creditNote,
      role: ORDER_COMMIT_DOCUMENT_ROLE.CREDIT_NOTE,
    });
  }

  if (emission.creditNoteFinalLines.length > 0) {
    const creditNote = await dependencies.createCreditNoteWithClient(
      {
        targetFinalInvoiceId: parentFinalInvoiceId,
        lines: emission.creditNoteFinalLines.map((entry) => entry.line),
        reason: creditReasonForFinalLines(emission.creditNoteFinalLines),
        createdByUserId:
          input.approvalActorUserId ?? input.actorContext.actorUserId,
        notes: "OrderCommit final credit note emission",
      },
      input.client
    );
    emissions.push({
      invoice: creditNote,
      role: ORDER_COMMIT_DOCUMENT_ROLE.CREDIT_NOTE,
    });
  }

  if (
    input.documentPlan.kind ===
    ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.REFUND_NEEDED
  ) {
    await input.client.order.update({
      where: { id: input.orderId },
      data: { refundPending: true },
      select: { id: true },
    });
  }

  return { emissions };
}

async function assertApprovalIfRequired(
  input: EmitOrderCommitFinancialDocumentsInput
): Promise<void> {
  if (!input.requiresApproval) return;

  const approvalActorUserId = input.approvalActorUserId ?? null;
  if (!approvalActorUserId) {
    throw new OrderCommitApprovalRequiredError({
      orderId: input.orderId,
      approvalActorUserId,
    });
  }

  const approvalActor = await input.client.user.findUnique({
    where: { id: approvalActorUserId },
    select: { id: true, role: true },
  });
  if (
    !approvalActor ||
    (approvalActor.role !== UserRole.ADMIN &&
      approvalActor.role !== UserRole.MANAGER)
  ) {
    throw new OrderCommitApprovalRequiredError({
      orderId: input.orderId,
      approvalActorUserId,
    });
  }
}

async function resolveLockedParentFinalInvoiceId(input: {
  financialCaseId: string;
  orderId: string;
  client: Prisma.TransactionClient;
}): Promise<string> {
  const invoices = await input.client.invoice.findMany({
    where: {
      financialCaseId: input.financialCaseId,
      orderId: input.orderId,
      invoiceType: InvoiceType.FINAL,
      isLocked: true,
    },
    select: { id: true },
  });
  if (invoices.length !== 1) {
    throw new Error(
      `OrderCommit emission expected exactly one locked FINAL invoice for order ${input.orderId}.`
    );
  }

  return invoices[0]!.id;
}

async function assertFinalCreditCapacity(input: {
  orderId: string;
  parentFinalInvoiceId: string;
  emission: OrderCommitFinancialEmission;
  client: Prisma.TransactionClient;
  computeCreditNoteCapacityForFinal: ComputeCreditNoteCapacityForFinal;
}): Promise<void> {
  const expectedFinalCreditTotal = round3(
    input.emission.creditNoteFinalLines.reduce(
      (sum, entry) => sum + entry.line.quantity * Number(entry.line.unitPrice),
      0
    )
  );
  if (expectedFinalCreditTotal < ONE_FILS) return;

  const currentCapacity = decimalLikeToNumber(
    await input.computeCreditNoteCapacityForFinal(
      input.parentFinalInvoiceId,
      input.client
    )
  );
  if (expectedFinalCreditTotal > currentCapacity + ONE_FILS) {
    throw new OrderCommitCreditCapacityExhaustedError({
      orderId: input.orderId,
      expectedFinalCreditTotal,
      currentCapacity,
    });
  }
}

function assertFirstCommitHasNoCreditSide(
  orderId: string,
  emission: OrderCommitFinancialEmission
): void {
  if (
    emission.adjustmentReversals.length > 0 ||
    emission.creditNoteFinalLines.length > 0
  ) {
    throw new Error(
      `OrderCommit first commit for order ${orderId} cannot emit credit notes.`
    );
  }
}

function toOrderCommitOpenAdjustmentLineMap(
  linesByCause: OpenAdjustmentLineMap
): Map<string, OrderCommitOpenAdjustmentLine[]> {
  return new Map(
    [...linesByCause.entries()].map(([key, lines]) => [
      key,
      lines.map((line) => ({
        invoiceLineId: line.invoiceLineId,
        invoiceId: line.invoiceId,
        causeOrderEntityKind: line.causeOrderEntityKind,
        causeOrderEntityId: line.causeOrderEntityId,
        remainingAmount: decimalLikeToNumber(line.remainingAmount),
        isPaid: line.isPaid,
        lineSnapshot: { ...line.lineSnapshot },
      })),
    ])
  );
}

function groupAdjustmentReversals(
  reversals: readonly OrderCommitAdjustmentReversal[]
): Map<string, OrderCommitAdjustmentReversal[]> {
  const grouped = new Map<string, OrderCommitAdjustmentReversal[]>();
  for (const reversal of reversals) {
    const bucket = grouped.get(reversal.parentAdjustmentInvoiceId) ?? [];
    bucket.push(reversal);
    grouped.set(reversal.parentAdjustmentInvoiceId, bucket);
  }
  return grouped;
}

function creditReasonForReversals(
  reversals: readonly OrderCommitAdjustmentReversal[]
): string {
  const reasons = new Set(reversals.map((reversal) => reversal.reason));
  return reasons.size === 1
    ? reversals[0]!.reason
    : "ORDER_COMMIT_ADJUSTMENT_REVERSAL";
}

function creditReasonForFinalLines(
  lines: OrderCommitFinancialEmission["creditNoteFinalLines"]
): string {
  const reasons = new Set(lines.map((entry) => entry.reason));
  return reasons.size === 1
    ? lines[0]!.reason
    : "ORDER_COMMIT_FINAL_RESIDUAL_CREDIT";
}

function decimalLikeToNumber(value: Prisma.Decimal | number): number {
  return typeof value === "number" ? value : value.toNumber();
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

function shouldRetryOrderCommitExecution(error: unknown): boolean {
  if (error instanceof OrderCommitConcurrentCommitError) return false;
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2002") return false;
  if (isUniqueCommittedFromDraftVersionConflict(error)) return false;
  return isUniqueOrderCommitSequenceConflict(error);
}

function isUniqueOrderCommitSequenceConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    isUniqueTarget(error.meta?.target, ["orderId", "sequence"], "orderId_sequence")
  );
}

function isUniqueCommittedFromDraftVersionConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    isUniqueTarget(
      error.meta?.target,
      ["orderId", "committedFromDraftVersion"],
      "orderId_committedFromDraftVersion"
    )
  );
}

function isUniqueTarget(
  target: unknown,
  fields: string[],
  fallbackName: string
): boolean {
  if (Array.isArray(target)) {
    return fields.every((field) => target.includes(field));
  }
  return typeof target === "string" && target.includes(fallbackName);
}

async function loadDefaultOrderCommitExecutionClient(): Promise<OrderCommitExecutionClient> {
  const { db } = await import("@/lib/db");
  return db;
}
