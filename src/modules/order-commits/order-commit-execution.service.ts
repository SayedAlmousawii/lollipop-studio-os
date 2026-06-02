import {
  InvoiceLineType,
  InvoiceType,
  Prisma,
  UserRole,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
import {
  buildOpenAdjustmentLineMap,
  computeCreditNoteCapacityForFinal,
  createAdjustmentInvoiceWithClient,
  createCreditNoteWithClient,
  createInvoiceForOrderWithClient,
} from "@/modules/invoices/invoice.service";
import {
  ORDER_COMMIT_DOCUMENT_ROLE,
} from "./order-commit.constants";
import {
  mapOrderCommitDiffToFinancialLines,
} from "./order-commit-financial-emission.service";
import {
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
} from "./order-commit-preview.constants";
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
import type { OrderCommitDocumentRole } from "./order-commit.types";

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

export type OrderCommitEmissionResult = {
  emissions: Array<{
    invoice: { id: string };
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

type OpenAdjustmentLineMap = Awaited<
  ReturnType<typeof buildOpenAdjustmentLineMap>
>;

type OrderCommitInvoiceEmissionDependencies = {
  buildOpenAdjustmentLineMap: typeof buildOpenAdjustmentLineMap;
  computeCreditNoteCapacityForFinal: typeof computeCreditNoteCapacityForFinal;
  createAdjustmentInvoiceWithClient: typeof createAdjustmentInvoiceWithClient;
  createCreditNoteWithClient: typeof createCreditNoteWithClient;
  createInvoiceForOrderWithClient: typeof createInvoiceForOrderWithClient;
  mapOrderCommitDiffToFinancialLines: typeof mapOrderCommitDiffToFinancialLines;
};

const ONE_FILS = 0.001;

export async function emitOrderCommitFinancialDocuments(
  input: EmitOrderCommitFinancialDocumentsInput
): Promise<OrderCommitEmissionResult> {
  const dependencies = {
    buildOpenAdjustmentLineMap,
    computeCreditNoteCapacityForFinal,
    createAdjustmentInvoiceWithClient,
    createCreditNoteWithClient,
    createInvoiceForOrderWithClient,
    mapOrderCommitDiffToFinancialLines,
    ...input.dependencies,
  } satisfies OrderCommitInvoiceEmissionDependencies;

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
  computeCreditNoteCapacityForFinal: typeof computeCreditNoteCapacityForFinal;
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
