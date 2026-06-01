import { randomUUID } from "node:crypto";
import {
  InvoiceType,
  MediaType,
  Prisma,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  UserRole,
  type PrismaClient,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth/actor-context";
import { withRetry } from "@/lib/retry";
import {
  priceSelections,
  type PricedSelection,
} from "@/modules/session-configurations/session-configuration-pricing";
import {
  ORDER_COMMIT_KIND,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  ORDER_COMMIT_SNAPSHOT_VERSION,
  ORDER_COMMIT_STATUS,
} from "./order-commit.constants";
import {
  orderCommitKindSchema,
  orderCommitMetadataSchema,
  orderCommitSnapshotV1Schema,
  orderCommitStatusSchema,
} from "./order-commit.schema";
import {
  ORDER_COMMIT_DRAFT_OPERATION_TYPE,
  ORDER_COMMIT_DRAFT_PENDING_OPS_SCHEMA_VERSION,
} from "./order-commit-draft.constants";
import {
  orderCommitDraftOperationV1Schema,
  orderCommitDraftPendingOpsV1Schema,
} from "./order-commit-draft.schema";
import { normalizeOrderCommitSnapshot } from "./order-commit-snapshot-normalizer";
import type {
  OrderCommitDraftOperationV1,
  OrderCommitDraftPendingOpsV1,
  OrderCommitDraftPendingSnapshotV1,
} from "./order-commit-draft.types";
import type {
  OrderCommitKind,
  OrderCommitStatus,
  OrderCommitSnapshotLineV1,
  OrderCommitSnapshotV1,
} from "./order-commit.types";

export type OrderCommitSnapshotClient =
  | Pick<PrismaClient, "order" | "sessionTypeExtraPhotoPricing">
  | Pick<Prisma.TransactionClient, "order" | "sessionTypeExtraPhotoPricing">;

type OrderCommitReadClient =
  | Pick<PrismaClient, "orderCommit">
  | Pick<Prisma.TransactionClient, "orderCommit">;

type OrderCommitDraftReadClient =
  | Pick<PrismaClient, "orderCommitDraft">
  | Pick<Prisma.TransactionClient, "orderCommitDraft">;

type OrderCommitTransactionClient = Pick<
  Prisma.TransactionClient,
  "order" | "orderCommit" | "sessionTypeExtraPhotoPricing"
>;

type OrderCommitRootClient = OrderCommitTransactionClient & {
  $transaction<T>(
    fn: (transaction: OrderCommitTransactionClient) => Promise<T>
  ): Promise<T>;
};

type OrderCommitBackfillClient = OrderCommitRootClient;

type OrderCommitDraftTransactionClient = Pick<
  Prisma.TransactionClient,
  "order" | "orderCommit" | "orderCommitDraft" | "sessionTypeExtraPhotoPricing"
>;

type OrderCommitDraftRootClient = OrderCommitDraftTransactionClient & {
  $transaction<T>(
    fn: (transaction: OrderCommitDraftTransactionClient) => Promise<T>
  ): Promise<T>;
};

type OrderCommitRow = {
  id: string;
  orderId: string;
  financialCaseId: string;
  previousCommitId: string | null;
  sequence: number;
  kind: OrderCommitKind;
  status: OrderCommitStatus;
  snapshotVersion: number;
  metadata: Record<string, unknown>;
  committedAt: Date;
  committedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CommittedOrderSnapshot = {
  commit: OrderCommitRow;
  snapshot: OrderCommitSnapshotV1;
};

export type OrderCommitDraftRow = {
  id: string;
  orderId: string;
  financialCaseId: string;
  baseCommitId: string | null;
  pendingSnapshotVersion: number;
  version: number;
  ownerUserId: string;
  openedByUserId: string;
  lastTouchedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type OrderCommitDraftState = {
  draft: OrderCommitDraftRow;
  pendingSnapshot: OrderCommitDraftPendingSnapshotV1;
  pendingOps: OrderCommitDraftPendingOpsV1;
};

export type GetLatestCommittedOrderSnapshotInput =
  | { orderId: string; financialCaseId?: never; client?: OrderCommitReadClient }
  | { financialCaseId: string; orderId?: never; client?: OrderCommitReadClient };

export type GetOrderCommitDraftInput = {
  orderId: string;
  client?: OrderCommitDraftReadClient;
};

export type GetOrCreateOrderCommitDraftInput = {
  orderId: string;
  actorContext: ActorContext;
  client?: OrderCommitDraftRootClient;
};

export type DiscardOrderCommitDraftInput = {
  orderId: string;
  expectedVersion: number;
  actorContext: ActorContext;
  client?: OrderCommitDraftRootClient;
};

export type ReplaceOrderCommitDraftSnapshotInput = {
  orderId: string;
  pendingSnapshotJson: unknown;
  expectedVersion: number;
  actorContext: ActorContext;
  operation?: OrderCommitDraftOperationV1;
  client?: OrderCommitDraftRootClient;
};

export type AppendOrderCommitDraftOperationInput = {
  orderId: string;
  operation: unknown;
  expectedVersion: number;
  actorContext: ActorContext;
  client?: OrderCommitDraftRootClient;
};

export type CreateOrderCommitSnapshotInput = {
  orderId: string;
  kind: OrderCommitKind;
  actorContext: ActorContext;
  metadata?: Record<string, unknown>;
  client?: OrderCommitRootClient;
};

export type BootstrapOrderCommitIfMissingInput = {
  orderId: string;
  actorContext: ActorContext;
  client?: OrderCommitRootClient;
};

export type OrderCommitBackfillFailure = {
  orderId: string;
  reason: string;
};

export type OrderCommitBackfillResult = {
  scanned: number;
  created: number;
  skippedExisting: number;
  skippedNoFinancialCommitment: number;
  failed: OrderCommitBackfillFailure[];
};

export type BackfillOrderCommitsForFinanciallyCommittedOrdersInput = {
  actorContext?: ActorContext;
  client?: OrderCommitBackfillClient;
};

const orderCommitRowSelect = {
  id: true,
  orderId: true,
  financialCaseId: true,
  previousCommitId: true,
  sequence: true,
  kind: true,
  status: true,
  snapshotVersion: true,
  snapshotJson: true,
  metadataJson: true,
  committedAt: true,
  committedByUserId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrderCommitSelect;

type SelectedOrderCommitRow = Prisma.OrderCommitGetPayload<{
  select: typeof orderCommitRowSelect;
}>;

const orderCommitDraftRowSelect = {
  id: true,
  orderId: true,
  financialCaseId: true,
  baseCommitId: true,
  pendingSnapshotVersion: true,
  pendingSnapshotJson: true,
  pendingOpsJson: true,
  version: true,
  ownerUserId: true,
  openedByUserId: true,
  lastTouchedByUserId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrderCommitDraftSelect;

type SelectedOrderCommitDraftRow = Prisma.OrderCommitDraftGetPayload<{
  select: typeof orderCommitDraftRowSelect;
}>;

const orderCommitSnapshotOrderSelect = {
  id: true,
  booking: {
    select: {
      financialCase: { select: { id: true } },
    },
  },
  packages: {
    select: {
      id: true,
      originalPackageId: true,
      currentPackageId: true,
      bookingPackageId: true,
      sessionTypeId: true,
      originalPackageNameSnapshot: true,
      currentPackageNameSnapshot: true,
      originalPackagePriceSnapshot: true,
      finalPackagePriceSnapshot: true,
      selectedPhotoCount: true,
      extraDigitalCount: true,
      extraPrintCount: true,
      sortOrder: true,
      createdAt: true,
      currentPackage: {
        select: {
          price: true,
          photoCount: true,
        },
      },
      sessionType: {
        select: {
          id: true,
          name: true,
        },
      },
      sessionConfigurationSelections: {
        select: {
          id: true,
          orderPackageId: true,
          configurationId: true,
          optionId: true,
          numericValue: true,
          textValue: true,
          snapshotOptionLabel: true,
          snapshotConfigurationCode: true,
          snapshotLabel: true,
          snapshotPriceDelta: true,
          snapshotFinancialBehavior: true,
          snapshotInputType: true,
          snapshotPricingMode: true,
          snapshotLinkedProductId: true,
          orderAddOnId: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  },
  orderAddOns: {
    select: {
      id: true,
      orderPackageId: true,
      productId: true,
      nameSnapshot: true,
      priceSnapshot: true,
      quantity: true,
      notes: true,
      createdAt: true,
      sessionConfigurationSelections: { select: { id: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  packageItemUpgrades: {
    select: {
      id: true,
      orderPackageId: true,
      packageItemId: true,
      nameSnapshot: true,
      priceSnapshot: true,
      quantity: true,
      notes: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.OrderSelect;

type CapturedOrder = Prisma.OrderGetPayload<{
  select: typeof orderCommitSnapshotOrderSelect;
}>;

export async function getLatestCommittedOrderSnapshot(
  input: GetLatestCommittedOrderSnapshotInput
): Promise<CommittedOrderSnapshot | null> {
  const client = input.client ?? (await loadDefaultOrderCommitReadClient());
  const row = await findLatestCommittedOrderSnapshotRow(client, input);
  return row ? parseCommittedOrderSnapshot(row) : null;
}

export async function getOrderCommitDraft(
  input: GetOrderCommitDraftInput
): Promise<OrderCommitDraftState | null> {
  const client = input.client ?? (await loadDefaultOrderCommitDraftReadClient());
  const row = await client.orderCommitDraft.findUnique({
    where: { orderId: input.orderId },
    select: orderCommitDraftRowSelect,
  });

  return row ? parseOrderCommitDraft(row) : null;
}

export async function getOrCreateOrderCommitDraft(
  input: GetOrCreateOrderCommitDraftInput
): Promise<OrderCommitDraftState> {
  assertValidDraftActor(input.actorContext, "create OrderCommitDraft");
  const client = input.client ?? (await loadDefaultOrderCommitDraftRootClient());

  return withRetry(
    () =>
      client.$transaction(async (transaction) => {
        const existing = await transaction.orderCommitDraft.findUnique({
          where: { orderId: input.orderId },
          select: orderCommitDraftRowSelect,
        });
        if (existing) return parseOrderCommitDraft(existing);

        return createOrderCommitDraftWithTransaction(transaction, {
          orderId: input.orderId,
          actorContext: input.actorContext,
        });
      }),
    "OrderCommitDraft creation failed",
    3,
    isUniqueOrderCommitDraftOrderConflict
  );
}

export async function discardOrderCommitDraft(
  input: DiscardOrderCommitDraftInput
): Promise<OrderCommitDraftState> {
  assertValidDraftActor(input.actorContext, "discard OrderCommitDraft");
  const client = input.client ?? (await loadDefaultOrderCommitDraftRootClient());

  return client.$transaction(async (transaction) => {
    const existing = await transaction.orderCommitDraft.findUnique({
      where: { orderId: input.orderId },
      select: orderCommitDraftRowSelect,
    });
    if (!existing) {
      throw new Error(
        `OrderCommitDraft discard failed: draft for order ${input.orderId} was not found.`
      );
    }

    assertDraftExpectedVersion(existing, input.expectedVersion, "discard");
    assertDraftMutationAllowed(existing, input.actorContext, "discard");

    const deleted = await transaction.orderCommitDraft.deleteMany({
      where: { id: existing.id, version: input.expectedVersion },
    });
    if (deleted.count !== 1) {
      throw new Error(
        `OrderCommitDraft discard failed: stale expectedVersion ${input.expectedVersion} for draft ${existing.id}.`
      );
    }

    return parseOrderCommitDraft(existing);
  });
}

export async function replaceOrderCommitDraftSnapshot(
  input: ReplaceOrderCommitDraftSnapshotInput
): Promise<OrderCommitDraftState> {
  assertValidDraftActor(input.actorContext, "replace OrderCommitDraft snapshot");
  const replacementSnapshot = orderCommitSnapshotV1Schema.parse(
    input.pendingSnapshotJson
  );
  const operation = snapshotReplacementOperation(
    input.operation,
    input.actorContext.actorUserId
  );
  const client = input.client ?? (await loadDefaultOrderCommitDraftRootClient());

  return client.$transaction(async (transaction) => {
    const existing = await transaction.orderCommitDraft.findUnique({
      where: { orderId: input.orderId },
      select: orderCommitDraftRowSelect,
    });
    if (!existing) {
      throw new Error(
        `OrderCommitDraft snapshot replacement failed: draft for order ${input.orderId} was not found.`
      );
    }

    assertDraftExpectedVersion(existing, input.expectedVersion, "replace snapshot");
    assertDraftMutationAllowed(existing, input.actorContext, "replace snapshot");
    assertReplacementSnapshotMatchesDraft(existing, replacementSnapshot);

    const existingPendingOps = orderCommitDraftPendingOpsV1Schema.parse(
      existing.pendingOpsJson
    );
    const pendingOps: OrderCommitDraftPendingOpsV1 = {
      ...existingPendingOps,
      operations: [...existingPendingOps.operations, operation],
    };

    const updated = await transaction.orderCommitDraft.updateMany({
      where: { id: existing.id, version: input.expectedVersion },
      data: {
        pendingSnapshotVersion: ORDER_COMMIT_SNAPSHOT_VERSION,
        pendingSnapshotJson: replacementSnapshot as unknown as Prisma.InputJsonValue,
        pendingOpsJson: pendingOps as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
        lastTouchedByUserId: input.actorContext.actorUserId,
      },
    });
    if (updated.count !== 1) {
      throw new Error(
        `OrderCommitDraft snapshot replacement failed: stale expectedVersion ${input.expectedVersion} for draft ${existing.id}.`
      );
    }

    const row = await transaction.orderCommitDraft.findUnique({
      where: { id: existing.id },
      select: orderCommitDraftRowSelect,
    });
    if (!row) {
      throw new Error(
        `OrderCommitDraft snapshot replacement failed: updated draft ${existing.id} was not found.`
      );
    }

    return parseOrderCommitDraft(row);
  });
}

export async function appendOrderCommitDraftOperation(
  input: AppendOrderCommitDraftOperationInput
): Promise<OrderCommitDraftState> {
  assertValidDraftActor(input.actorContext, "append OrderCommitDraft operation");
  const operation = orderCommitDraftOperationV1Schema.parse(input.operation);
  const client = input.client ?? (await loadDefaultOrderCommitDraftRootClient());

  return client.$transaction(async (transaction) => {
    const existing = await transaction.orderCommitDraft.findUnique({
      where: { orderId: input.orderId },
      select: orderCommitDraftRowSelect,
    });
    if (!existing) {
      throw new Error(
        `OrderCommitDraft operation append failed: draft for order ${input.orderId} was not found.`
      );
    }

    assertDraftExpectedVersion(existing, input.expectedVersion, "append operation");
    assertDraftMutationAllowed(existing, input.actorContext, "append operation");

    const existingPendingOps = orderCommitDraftPendingOpsV1Schema.parse(
      existing.pendingOpsJson
    );
    const existingIndex = existingPendingOps.operations.findIndex(
      (candidate) => candidate.id === operation.id
    );
    const operations =
      existingIndex === -1
        ? [...existingPendingOps.operations, operation]
        : existingPendingOps.operations.map((candidate, index) =>
            index === existingIndex ? operation : candidate
          );
    const pendingOps: OrderCommitDraftPendingOpsV1 = {
      ...existingPendingOps,
      operations,
    };

    const updated = await transaction.orderCommitDraft.updateMany({
      where: { id: existing.id, version: input.expectedVersion },
      data: {
        pendingOpsJson: pendingOps as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
        lastTouchedByUserId: input.actorContext.actorUserId,
      },
    });
    if (updated.count !== 1) {
      throw new Error(
        `OrderCommitDraft operation append failed: stale expectedVersion ${input.expectedVersion} for draft ${existing.id}.`
      );
    }

    const row = await transaction.orderCommitDraft.findUnique({
      where: { id: existing.id },
      select: orderCommitDraftRowSelect,
    });
    if (!row) {
      throw new Error(
        `OrderCommitDraft operation append failed: updated draft ${existing.id} was not found.`
      );
    }

    return parseOrderCommitDraft(row);
  });
}

export async function createOrderCommitSnapshot(
  input: CreateOrderCommitSnapshotInput
): Promise<CommittedOrderSnapshot> {
  const kind = orderCommitKindSchema.parse(input.kind);
  const metadata = orderCommitMetadataSchema.parse(input.metadata ?? {});
  const client = input.client ?? (await loadDefaultOrderCommitRootClient());

  return withRetry(
    () =>
      client.$transaction((transaction) =>
        createOrderCommitSnapshotWithTransaction(transaction, {
          orderId: input.orderId,
          kind,
          actorContext: input.actorContext,
          metadata,
        })
      ),
    "OrderCommit snapshot creation failed",
    3,
    isUniqueOrderCommitSequenceConflict
  );
}

export async function bootstrapOrderCommitIfMissing(
  input: BootstrapOrderCommitIfMissingInput
): Promise<CommittedOrderSnapshot> {
  const client = input.client ?? (await loadDefaultOrderCommitRootClient());

  return withRetry(
    () =>
      client.$transaction(async (transaction) => {
        const existing = await findLatestCommittedOrderSnapshotRow(transaction, {
          orderId: input.orderId,
        });
        if (existing) return parseCommittedOrderSnapshot(existing);

        return createOrderCommitSnapshotWithTransaction(transaction, {
          orderId: input.orderId,
          kind: ORDER_COMMIT_KIND.BASELINE,
          actorContext: input.actorContext,
          metadata: { reason: "phase_1_bootstrap" },
        });
      }),
    "OrderCommit bootstrap failed",
    3,
    isUniqueOrderCommitSequenceConflict
  );
}

export async function backfillOrderCommitsForFinanciallyCommittedOrders(
  input: BackfillOrderCommitsForFinanciallyCommittedOrdersInput = {}
): Promise<OrderCommitBackfillResult> {
  const client = input.client ?? (await loadDefaultOrderCommitRootClient());
  const actorContext = input.actorContext ?? defaultBackfillActorContext();
  const orders = await client.order.findMany({
    select: {
      id: true,
      invoices: {
        select: {
          invoiceType: true,
          isLocked: true,
        },
      },
      orderCommits: {
        select: { id: true },
        take: 1,
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const result: OrderCommitBackfillResult = {
    scanned: orders.length,
    created: 0,
    skippedExisting: 0,
    skippedNoFinancialCommitment: 0,
    failed: [],
  };

  for (const order of orders) {
    if (order.orderCommits.length > 0) {
      result.skippedExisting += 1;
      continue;
    }

    if (!hasFinancialCommitmentInvoice(order.invoices)) {
      result.skippedNoFinancialCommitment += 1;
      continue;
    }

    try {
      await bootstrapOrderCommitIfMissing({
        orderId: order.id,
        actorContext,
        client,
      });
      result.created += 1;
    } catch (error) {
      result.failed.push({
        orderId: order.id,
        reason: errorReason(error),
      });
    }
  }

  return result;
}

export async function captureOrderCommitSnapshotFromOrderRows(input: {
  orderId: string;
  client?: OrderCommitSnapshotClient;
}): Promise<OrderCommitSnapshotV1> {
  const client = input.client ?? (await loadDefaultClient());
  const order = await client.order.findUnique({
    where: { id: input.orderId },
    select: orderCommitSnapshotOrderSelect,
  });

  if (!order) {
    throw new Error(`OrderCommit snapshot capture failed: order ${input.orderId} was not found.`);
  }
  const financialCaseId = order.booking.financialCase?.id;
  if (!financialCaseId) {
    throw new Error(
      `OrderCommit snapshot capture failed: order ${input.orderId} has no FinancialCase.`
    );
  }

  const extraPhotoPrices = await getExtraPhotoPriceMap(
    client,
    order.packages.map((orderPackage) => orderPackage.sessionTypeId)
  );
  const addOnById = new Map(order.orderAddOns.map((addOn) => [addOn.id, addOn]));
  const lines: OrderCommitSnapshotLineV1[] = [];

  for (const orderPackage of order.packages) {
    lines.push(packageLine(orderPackage));

    for (const mediaType of [MediaType.DIGITAL, MediaType.PRINT] as const) {
      const extraLine = extraPhotoLine(orderPackage, mediaType, extraPhotoPrices);
      if (extraLine) lines.push(extraLine);
    }

    for (const selection of orderPackage.sessionConfigurationSelections) {
      lines.push(...sessionConfigurationLines(orderPackage.id, selection));
      const linkedAddOn = selection.orderAddOnId
        ? addOnById.get(selection.orderAddOnId)
        : null;
      if (linkedAddOn && selection.snapshotLinkedProductId) {
        lines.push(linkedSelectionAddOnLine(orderPackage.id, selection, linkedAddOn));
      }
    }
  }

  for (const addOn of order.orderAddOns) {
    if (addOn.sessionConfigurationSelections.length > 0) continue;
    lines.push(addOnLine(addOn));
  }

  for (const upgrade of order.packageItemUpgrades) {
    lines.push(packageItemUpgradeLine(upgrade));
  }

  return normalizeOrderCommitSnapshot({
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: order.id,
    financialCaseId,
    capturedAt: new Date().toISOString(),
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines,
    totals: {
      subtotal: 0,
      discountTotal: 0,
      netTotal: 0,
    },
  });
}

async function createOrderCommitSnapshotWithTransaction(
  transaction: OrderCommitTransactionClient,
  input: {
    orderId: string;
    kind: OrderCommitKind;
    actorContext: ActorContext;
    metadata: Record<string, unknown>;
  }
): Promise<CommittedOrderSnapshot> {
  const order = await transaction.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      booking: {
        select: {
          financialCase: { select: { id: true } },
        },
      },
    },
  });

  if (!order) {
    throw new Error(
      `OrderCommit snapshot creation failed: order ${input.orderId} was not found.`
    );
  }
  const financialCaseId = order.booking.financialCase?.id;
  if (!financialCaseId) {
    throw new Error(
      `OrderCommit snapshot creation failed: order ${input.orderId} has no FinancialCase.`
    );
  }

  const latest = await findLatestCommittedOrderSnapshotRow(transaction, {
    orderId: input.orderId,
  });
  const sequence = (latest?.sequence ?? 0) + 1;
  const snapshot = await captureOrderCommitSnapshotFromOrderRows({
    orderId: input.orderId,
    client: transaction,
  });
  if (snapshot.financialCaseId !== financialCaseId) {
    throw new Error(
      `OrderCommit snapshot creation failed: order ${input.orderId} resolved inconsistent FinancialCase ids.`
    );
  }

  const row = await transaction.orderCommit.create({
    data: {
      orderId: input.orderId,
      financialCaseId,
      previousCommitId: latest?.id ?? null,
      sequence,
      kind: input.kind,
      status: ORDER_COMMIT_STATUS.COMMITTED,
      snapshotVersion: ORDER_COMMIT_SNAPSHOT_VERSION,
      snapshotJson: snapshot as unknown as Prisma.InputJsonValue,
      metadataJson: input.metadata as Prisma.InputJsonObject,
      committedByUserId: input.actorContext.actorUserId.trim() || null,
    },
    select: orderCommitRowSelect,
  });

  return parseCommittedOrderSnapshot(row);
}

async function findLatestCommittedOrderSnapshotRow(
  client: OrderCommitReadClient,
  input: { orderId: string } | { financialCaseId: string }
): Promise<SelectedOrderCommitRow | null> {
  return client.orderCommit.findFirst({
    where:
      "orderId" in input
        ? { orderId: input.orderId }
        : { financialCaseId: input.financialCaseId },
    orderBy: [{ sequence: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: orderCommitRowSelect,
  });
}

function parseCommittedOrderSnapshot(
  row: SelectedOrderCommitRow
): CommittedOrderSnapshot {
  const snapshot = orderCommitSnapshotV1Schema.parse(row.snapshotJson);
  return {
    commit: {
      id: row.id,
      orderId: row.orderId,
      financialCaseId: row.financialCaseId,
      previousCommitId: row.previousCommitId,
      sequence: row.sequence,
      kind: orderCommitKindSchema.parse(row.kind),
      status: orderCommitStatusSchema.parse(row.status),
      snapshotVersion: row.snapshotVersion,
      metadata: orderCommitMetadataSchema.parse(row.metadataJson),
      committedAt: row.committedAt,
      committedByUserId: row.committedByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    snapshot,
  };
}

async function loadDefaultOrderCommitReadClient(): Promise<OrderCommitReadClient> {
  const { db } = await import("@/lib/db");
  return db;
}

async function loadDefaultOrderCommitDraftReadClient(): Promise<OrderCommitDraftReadClient> {
  const { db } = await import("@/lib/db");
  return db;
}

async function loadDefaultOrderCommitRootClient(): Promise<OrderCommitRootClient> {
  const { db } = await import("@/lib/db");
  return db as unknown as OrderCommitRootClient;
}

async function loadDefaultOrderCommitDraftRootClient(): Promise<OrderCommitDraftRootClient> {
  const { db } = await import("@/lib/db");
  return db as unknown as OrderCommitDraftRootClient;
}

function defaultBackfillActorContext(): ActorContext {
  return {
    actorUserId: "",
    actorRole: UserRole.ADMIN,
  };
}

function hasFinancialCommitmentInvoice(
  invoices: { invoiceType: InvoiceType; isLocked: boolean }[]
): boolean {
  return invoices.some(
    (invoice) =>
      invoice.invoiceType === InvoiceType.FINAL ||
      invoice.invoiceType === InvoiceType.ADJUSTMENT ||
      invoice.invoiceType === InvoiceType.CREDIT_NOTE ||
      invoice.invoiceType === InvoiceType.REFUND
  );
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUniqueOrderCommitSequenceConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    isUniqueTarget(error.meta?.target, ["orderId", "sequence"], "orderId_sequence")
  );
}

function isUniqueOrderCommitDraftOrderConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    isUniqueTarget(error.meta?.target, ["orderId"], "orderId")
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

async function createOrderCommitDraftWithTransaction(
  transaction: OrderCommitDraftTransactionClient,
  input: {
    orderId: string;
    actorContext: ActorContext;
  }
): Promise<OrderCommitDraftState> {
  const order = await transaction.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      booking: {
        select: {
          financialCase: { select: { id: true } },
        },
      },
    },
  });

  if (!order) {
    throw new Error(
      `OrderCommitDraft creation failed: order ${input.orderId} was not found.`
    );
  }
  const financialCaseId = order.booking.financialCase?.id;
  if (!financialCaseId) {
    throw new Error(
      `OrderCommitDraft creation failed: order ${input.orderId} has no FinancialCase.`
    );
  }

  const latest = await findLatestCommittedOrderSnapshotRow(transaction, {
    orderId: input.orderId,
  });
  const baseSnapshot = latest
    ? parseCommittedOrderSnapshot(latest).snapshot
    : await captureOrderCommitSnapshotFromOrderRows({
        orderId: input.orderId,
        client: transaction,
      });

  if (baseSnapshot.orderId !== input.orderId || baseSnapshot.financialCaseId !== financialCaseId) {
    throw new Error(
      `OrderCommitDraft creation failed: order ${input.orderId} resolved inconsistent snapshot identity.`
    );
  }

  const pendingOps: OrderCommitDraftPendingOpsV1 = {
    schemaVersion: ORDER_COMMIT_DRAFT_PENDING_OPS_SCHEMA_VERSION,
    operations: [],
  };
  const row = await transaction.orderCommitDraft.create({
    data: {
      orderId: input.orderId,
      financialCaseId,
      baseCommitId: latest?.id ?? null,
      pendingSnapshotVersion: ORDER_COMMIT_SNAPSHOT_VERSION,
      pendingSnapshotJson: baseSnapshot as unknown as Prisma.InputJsonValue,
      pendingOpsJson: pendingOps as unknown as Prisma.InputJsonValue,
      ownerUserId: input.actorContext.actorUserId,
      openedByUserId: input.actorContext.actorUserId,
      lastTouchedByUserId: input.actorContext.actorUserId,
    },
    select: orderCommitDraftRowSelect,
  });

  return parseOrderCommitDraft(row);
}

function parseOrderCommitDraft(
  row: SelectedOrderCommitDraftRow
): OrderCommitDraftState {
  return {
    draft: {
      id: row.id,
      orderId: row.orderId,
      financialCaseId: row.financialCaseId,
      baseCommitId: row.baseCommitId,
      pendingSnapshotVersion: row.pendingSnapshotVersion,
      version: row.version,
      ownerUserId: row.ownerUserId,
      openedByUserId: row.openedByUserId,
      lastTouchedByUserId: row.lastTouchedByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    pendingSnapshot: orderCommitSnapshotV1Schema.parse(row.pendingSnapshotJson),
    pendingOps: orderCommitDraftPendingOpsV1Schema.parse(row.pendingOpsJson),
  };
}

function assertValidDraftActor(actorContext: ActorContext, action: string): void {
  if (!actorContext.actorUserId.trim()) {
    throw new Error(`Cannot ${action}: actorUserId is required.`);
  }
  if (!actorContext.actorRole) {
    throw new Error(`Cannot ${action}: actorRole is required.`);
  }
}

function assertDraftExpectedVersion(
  draft: SelectedOrderCommitDraftRow,
  expectedVersion: number,
  action: string
): void {
  if (draft.version !== expectedVersion) {
    throw new Error(
      `OrderCommitDraft ${action} failed: stale expectedVersion ${expectedVersion} for draft ${draft.id}; current version is ${draft.version}.`
    );
  }
}

function assertDraftMutationAllowed(
  draft: SelectedOrderCommitDraftRow,
  actorContext: ActorContext,
  action: string
): void {
  if (
    draft.ownerUserId === actorContext.actorUserId ||
    actorContext.actorRole === UserRole.ADMIN ||
    actorContext.actorRole === UserRole.MANAGER
  ) {
    return;
  }

  throw new Error(
    `OrderCommitDraft ${action} failed: actor ${actorContext.actorUserId} cannot mutate draft ${draft.id}.`
  );
}

function snapshotReplacementOperation(
  operation: OrderCommitDraftOperationV1 | undefined,
  actorUserId: string
): OrderCommitDraftOperationV1 {
  if (!operation) {
    return {
      id: `snapshot-replaced:${randomUUID()}`,
      type: ORDER_COMMIT_DRAFT_OPERATION_TYPE.SNAPSHOT_REPLACED,
      payload: {},
      createdAt: new Date().toISOString(),
      actorUserId,
    };
  }

  const parsed = orderCommitDraftOperationV1Schema.parse(operation);
  if (parsed.type !== ORDER_COMMIT_DRAFT_OPERATION_TYPE.SNAPSHOT_REPLACED) {
    throw new Error(
      `OrderCommitDraft snapshot replacement failed: operation type must be ${ORDER_COMMIT_DRAFT_OPERATION_TYPE.SNAPSHOT_REPLACED}.`
    );
  }
  return parsed;
}

function assertReplacementSnapshotMatchesDraft(
  draft: SelectedOrderCommitDraftRow,
  snapshot: OrderCommitSnapshotV1
): void {
  if (snapshot.orderId !== draft.orderId) {
    throw new Error(
      `OrderCommitDraft snapshot replacement failed: snapshot orderId ${snapshot.orderId} does not match draft order ${draft.orderId}.`
    );
  }
  if (snapshot.financialCaseId !== draft.financialCaseId) {
    throw new Error(
      `OrderCommitDraft snapshot replacement failed: snapshot financialCaseId ${snapshot.financialCaseId} does not match draft FinancialCase ${draft.financialCaseId}.`
    );
  }
  if (snapshot.currency !== ORDER_COMMIT_SNAPSHOT_CURRENCY) {
    throw new Error(
      `OrderCommitDraft snapshot replacement failed: snapshot currency ${snapshot.currency} is not supported.`
    );
  }
}

type CapturedOrderPackage = CapturedOrder["packages"][number];
type CapturedOrderAddOn = CapturedOrder["orderAddOns"][number];
type CapturedPackageItemUpgrade = CapturedOrder["packageItemUpgrades"][number];
type CapturedSessionConfigurationSelection =
  CapturedOrderPackage["sessionConfigurationSelections"][number];

async function loadDefaultClient(): Promise<OrderCommitSnapshotClient> {
  const { db } = await import("@/lib/db");
  return db;
}

function packageLine(orderPackage: CapturedOrderPackage): OrderCommitSnapshotLineV1 {
  const unitPrice = money(
    orderPackage.finalPackagePriceSnapshot ?? orderPackage.currentPackage.price
  );
  return {
    lineId: `package:${orderPackage.id}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId: orderPackage.id,
    parentOrderPackageId: null,
    catalogEntityId: orderPackage.currentPackageId,
    stableKey: `order-package:${orderPackage.id}`,
    label: orderPackage.currentPackageNameSnapshot,
    quantity: 1,
    unitPrice,
    lineTotal: unitPrice,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      originalPackageId: orderPackage.originalPackageId,
      originalPackageNameSnapshot: orderPackage.originalPackageNameSnapshot,
      originalPackagePriceSnapshot: nullableMoney(
        orderPackage.originalPackagePriceSnapshot
      ),
      bookingPackageId: orderPackage.bookingPackageId,
      selectedPhotoCount:
        orderPackage.selectedPhotoCount ?? orderPackage.currentPackage.photoCount,
      includedPhotoCount: orderPackage.currentPackage.photoCount,
      extraDigitalCount: orderPackage.extraDigitalCount,
      extraPrintCount: orderPackage.extraPrintCount,
      sessionTypeId: orderPackage.sessionType.id,
      sessionTypeName: orderPackage.sessionType.name,
      sortOrder: orderPackage.sortOrder,
    },
  };
}

function addOnLine(addOn: CapturedOrderAddOn): OrderCommitSnapshotLineV1 {
  const unitPrice = money(addOn.priceSnapshot);
  return {
    lineId: `addon:${addOn.id}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_ADD_ON,
    orderEntityId: addOn.id,
    parentOrderPackageId: addOn.orderPackageId,
    catalogEntityId: addOn.productId,
    stableKey: `order-add-on:${addOn.id}`,
    label: addOn.nameSnapshot,
    quantity: addOn.quantity,
    unitPrice,
    lineTotal: multiplyMoney(unitPrice, addOn.quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      notes: addOn.notes,
    },
  };
}

function packageItemUpgradeLine(
  upgrade: CapturedPackageItemUpgrade
): OrderCommitSnapshotLineV1 {
  const unitPrice = money(upgrade.priceSnapshot);
  return {
    lineId: `item-upgrade:${upgrade.id}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
    orderEntityId: upgrade.id,
    parentOrderPackageId: upgrade.orderPackageId,
    catalogEntityId: upgrade.packageItemId,
    stableKey: `order-package-item-upgrade:${upgrade.id}`,
    label: upgrade.nameSnapshot,
    quantity: upgrade.quantity,
    unitPrice,
    lineTotal: multiplyMoney(unitPrice, upgrade.quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      packageItemId: upgrade.packageItemId,
      notes: upgrade.notes,
    },
  };
}

function extraPhotoLine(
  orderPackage: CapturedOrderPackage,
  mediaType: MediaType,
  extraPhotoPrices: Map<string, Prisma.Decimal>
): OrderCommitSnapshotLineV1 | null {
  const quantity =
    mediaType === MediaType.DIGITAL
      ? orderPackage.extraDigitalCount
      : orderPackage.extraPrintCount;
  if (quantity <= 0) return null;

  const unitPriceDecimal = extraPhotoPrices.get(
    extraPhotoPriceKey(orderPackage.sessionTypeId, mediaType)
  );
  if (!unitPriceDecimal) {
    throw new Error(
      `OrderCommit snapshot capture failed: missing ${mediaType} extra-photo pricing for session type ${orderPackage.sessionTypeId}.`
    );
  }

  const unitPrice = money(unitPriceDecimal);
  return {
    lineId: extraPhotoLineId(orderPackage.id, mediaType),
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_PHOTO_EXTRA,
    orderEntityId: `${orderPackage.id}:${mediaType}`,
    parentOrderPackageId: orderPackage.id,
    catalogEntityId: null,
    stableKey: `order-package:${orderPackage.id}:extra-photo:${mediaType.toLowerCase()}`,
    label: `Extra photos - ${formatEnum(mediaType)} (${orderPackage.currentPackageNameSnapshot})`,
    quantity,
    unitPrice,
    lineTotal: multiplyMoney(unitPrice, quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.SESSION_TYPE_EXTRA_PHOTO_PRICING,
    metadata: {
      mediaType,
      sessionTypeId: orderPackage.sessionTypeId,
    },
  };
}

function sessionConfigurationLines(
  orderPackageId: string,
  selection: CapturedSessionConfigurationSelection
): OrderCommitSnapshotLineV1[] {
  if (
    selection.snapshotFinancialBehavior !==
    SessionConfigurationFinancialBehavior.FINANCIAL
  ) {
    return [zeroValueSessionConfigurationLine(orderPackageId, selection)];
  }

  return priceSelections([pricedSelection(selection)]).lineItems.map((lineItem) => {
    const unitPrice = money(lineItem.unitPrice);
    return {
      lineId: `session-config:${selection.id}`,
      lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION,
      orderEntityKind:
        ORDER_COMMIT_ORDER_ENTITY_KIND
          .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
      orderEntityId: selection.id,
      parentOrderPackageId: orderPackageId,
      catalogEntityId: selection.configurationId,
      stableKey: `session-configuration-selection:${selection.id}`,
      label: lineItem.description,
      quantity: lineItem.quantity,
      unitPrice,
      lineTotal: multiplyMoney(unitPrice, lineItem.quantity),
      priceSource:
        ORDER_COMMIT_PRICE_SOURCE.SESSION_CONFIGURATION_SELECTION_SNAPSHOT,
      metadata: selectionMetadata(selection),
    };
  });
}

function zeroValueSessionConfigurationLine(
  orderPackageId: string,
  selection: CapturedSessionConfigurationSelection
): OrderCommitSnapshotLineV1 {
  return {
    lineId: `session-config:${selection.id}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: selection.id,
    parentOrderPackageId: orderPackageId,
    catalogEntityId: selection.configurationId,
    stableKey: `session-configuration-selection:${selection.id}`,
    label: formatSelectionOwnershipLabel(selection),
    quantity: 1,
    unitPrice: 0,
    lineTotal: 0,
    priceSource:
      ORDER_COMMIT_PRICE_SOURCE.SESSION_CONFIGURATION_SELECTION_SNAPSHOT,
    metadata: selectionMetadata(selection),
  };
}

function linkedSelectionAddOnLine(
  orderPackageId: string,
  selection: CapturedSessionConfigurationSelection,
  addOn: CapturedOrderAddOn
): OrderCommitSnapshotLineV1 {
  const unitPrice = money(addOn.priceSnapshot);
  return {
    lineId: `session-config:${selection.id}:addon:${addOn.id}`,
    lineKind:
      ORDER_COMMIT_SNAPSHOT_LINE_KIND
        .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: selection.id,
    parentOrderPackageId: orderPackageId,
    catalogEntityId: selection.snapshotLinkedProductId ?? addOn.productId,
    stableKey: `session-configuration-selection:${selection.id}:add-on:${addOn.id}`,
    label: addOn.nameSnapshot,
    quantity: addOn.quantity,
    unitPrice,
    lineTotal: multiplyMoney(unitPrice, addOn.quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      ...selectionMetadata(selection),
      orderAddOnId: addOn.id,
      productId: addOn.productId,
      addOnNotes: addOn.notes,
    },
  };
}

function pricedSelection(
  selection: CapturedSessionConfigurationSelection
): PricedSelection {
  return {
    id: selection.id,
    snapshotConfigurationCode: selection.snapshotConfigurationCode,
    snapshotLabel: selection.snapshotLabel,
    snapshotPriceDelta: selection.snapshotPriceDelta,
    snapshotPricingMode: selection.snapshotPricingMode,
    snapshotInputType: selection.snapshotInputType,
    snapshotOptionLabel: selection.snapshotOptionLabel,
    snapshotLinkedProductId: selection.snapshotLinkedProductId,
    orderAddOnId: selection.orderAddOnId,
    numericValue: selection.numericValue,
  };
}

function selectionMetadata(
  selection: CapturedSessionConfigurationSelection
): Record<string, unknown> {
  return {
    configurationId: selection.configurationId,
    optionId: selection.optionId,
    numericValue: selection.numericValue?.toString() ?? null,
    textValue: selection.textValue,
    snapshotOptionLabel: selection.snapshotOptionLabel,
    snapshotConfigurationCode: selection.snapshotConfigurationCode,
    snapshotLabel: selection.snapshotLabel,
    snapshotPriceDelta: money(selection.snapshotPriceDelta),
    snapshotFinancialBehavior: selection.snapshotFinancialBehavior,
    snapshotInputType: selection.snapshotInputType,
    snapshotPricingMode: selection.snapshotPricingMode,
    snapshotLinkedProductId: selection.snapshotLinkedProductId,
    orderAddOnId: selection.orderAddOnId,
  };
}

function formatSelectionOwnershipLabel(
  selection: CapturedSessionConfigurationSelection
): string {
  if (
    (selection.snapshotInputType === SessionConfigurationInputType.SELECT ||
      selection.snapshotInputType === SessionConfigurationInputType.COUNTER) &&
    selection.snapshotOptionLabel
  ) {
    return `${selection.snapshotLabel} - ${selection.snapshotOptionLabel}`;
  }

  if (
    selection.snapshotInputType === SessionConfigurationInputType.COUNTER &&
    selection.numericValue
  ) {
    return `${selection.snapshotLabel} (${selection.numericValue.toString()})`;
  }

  return selection.snapshotLabel;
}

async function getExtraPhotoPriceMap(
  client: OrderCommitSnapshotClient,
  sessionTypeIds: string[]
): Promise<Map<string, Prisma.Decimal>> {
  const uniqueSessionTypeIds = [...new Set(sessionTypeIds)];
  if (uniqueSessionTypeIds.length === 0) return new Map();

  const rows = await client.sessionTypeExtraPhotoPricing.findMany({
    where: {
      sessionTypeId: { in: uniqueSessionTypeIds },
      mediaType: { in: [MediaType.DIGITAL, MediaType.PRINT] },
    },
    select: { sessionTypeId: true, mediaType: true, unitPrice: true },
  });

  return new Map(
    rows.map((row) => [
      extraPhotoPriceKey(row.sessionTypeId, row.mediaType),
      row.unitPrice,
    ])
  );
}

function extraPhotoLineId(orderPackageId: string, mediaType: MediaType): string {
  return `extra-photo:${orderPackageId}:${mediaType.toLowerCase()}`;
}

function extraPhotoPriceKey(sessionTypeId: string, mediaType: MediaType): string {
  return `${sessionTypeId}:${mediaType}`;
}

function nullableMoney(value: Prisma.Decimal | null): number | null {
  return value ? money(value) : null;
}

function multiplyMoney(unitPrice: number, quantity: number): number {
  return roundMoney(unitPrice * quantity);
}

function money(value: Prisma.Decimal): number {
  return roundMoney(value.toNumber());
}

function roundMoney(value: number): number {
  return Number(value.toFixed(3));
}

function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
