import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Module from "node:module";
import test, { after } from "node:test";
import {
  AuditAction,
  AuditEntityType,
  InvoiceStatus,
  OrderActivityType,
  Prisma,
  UserRole,
  type PrismaClient,
} from "@prisma/client";
import {
  ORDER_COMMIT_KIND,
  ORDER_COMMIT_STATUS,
} from "@/modules/order-commits/order-commit.constants";
import {
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
} from "@/modules/order-commits/order-commit-preview.constants";
import type { OrderCommitSnapshotV1 } from "@/modules/order-commits/order-commit.types";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;
let activeHarness: ReturnType<typeof fakeExecutionHarness> | null = null;

moduleWithLoader._load = function loadWithOrderCommitTask6Shims(
  request,
  parent,
  isMain
) {
  if (request === "server-only") return {};
  if (request === "@/lib/db") return { db: {} };
  if (
    request === "@/modules/financial-cases" ||
    request === "@/modules/financial-cases/financial-case-summary.service"
  ) {
    return {
      getFinancialCaseSummary: async () => requiredHarness().financialSummary,
    };
  }
  if (request === "@/modules/invoices/invoice.service") {
    return invoiceServiceShim();
  }
  if (request === "@/modules/audit/audit-log.service") {
    return {
      recordAuditLog: async (
        _client: Prisma.TransactionClient,
        _actorContext: unknown,
        input: unknown
      ) => {
        requiredHarness().calls.sequence.push("audit");
        requiredHarness().calls.audit.push(input as Record<string, unknown>);
      },
    };
  }
  if (request === "@/modules/orders/order-activity.service") {
    return {
      recordOrderActivity: async (
        _client: Prisma.TransactionClient,
        input: unknown
      ) => {
        requiredHarness().calls.sequence.push("activity");
        requiredHarness().calls.activity.push(input as Record<string, unknown>);
      },
    };
  }
  if (request === "@/modules/financial/invariants") {
    return {
      assertFinancialCaseInvariants: async (financialCaseId: string) => {
        requiredHarness().calls.sequence.push("invariants");
        requiredHarness().calls.invariants.push(financialCaseId);
      },
    };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

after(() => {
  moduleWithLoader._load = originalModuleLoad;
});

const actorContext = {
  actorUserId: "staff-user",
  actorRole: UserRole.RECEPTIONIST,
};

test("commitOrderChanges atomically creates an audit commit and deletes the draft after invariants", async () => {
  const harness = fakeExecutionHarness();
  activeHarness = harness;
  const { commitOrderChanges } = await loadExecutionService();

  const result = await commitOrderChanges({
    orderId: "order-1",
    expectedDraftVersion: 2,
    actorContext,
    client: harness.client,
  });

  assert.deepEqual(harness.calls.transactionOptions, [
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  ]);
  assert.deepEqual(result, {
    orderCommit: { id: "order-commit-1", sequence: 1 },
    emittedDocuments: [],
  });

  const createdCommit = harness.calls.orderCommitCreates[0]?.data;
  assert.equal(createdCommit?.kind, ORDER_COMMIT_KIND.AUDIT);
  assert.equal(createdCommit?.status, ORDER_COMMIT_STATUS.COMMITTED);
  assert.equal(createdCommit?.committedFromDraftVersion, 2);
  assert.equal(createdCommit?.committedByUserId, "staff-user");
  assert.deepEqual(createdCommit?.snapshotJson, harness.pendingSnapshot);
  assert.deepEqual(createdCommit?.metadataJson, {
    commitKind: "NO_OP",
    documentPlanKind: ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.NO_OP,
    approvalActorUserId: null,
    netDelta: 0,
  });

  assert.deepEqual(harness.calls.documentCreateMany, []);
  assert.equal(harness.calls.audit[0]?.entityType, AuditEntityType.ORDER_COMMIT);
  assert.equal(harness.calls.audit[0]?.action, AuditAction.ORDER_COMMIT_CREATED);
  assert.equal(harness.calls.activity[0]?.type, OrderActivityType.ORDER_COMMITTED);
  assert.deepEqual(harness.calls.invariants, ["financial-case-1"]);
  assert.deepEqual(harness.calls.draftDeletes, [{ id: "draft-1" }]);
  assert.ok(
    harness.calls.sequence.indexOf("invariants") <
      harness.calls.sequence.indexOf("draft.delete")
  );
  assert.equal(harness.calls.paymentsCreated, 0);
});

test("commitOrderChanges rejects stale draft versions before writes", async () => {
  const harness = fakeExecutionHarness({ draftVersion: 3 });
  activeHarness = harness;
  const { commitOrderChanges, OrderCommitStaleDraftError } =
    await loadExecutionService();

  await assert.rejects(
    commitOrderChanges({
      orderId: "order-1",
      expectedDraftVersion: 2,
      actorContext,
      client: harness.client,
    }),
    OrderCommitStaleDraftError
  );
  assert.deepEqual(harness.calls.orderCommitCreates, []);
  assert.deepEqual(harness.calls.documentCreateMany, []);
  assert.deepEqual(harness.calls.draftDeletes, []);
});

test("committedFromDraftVersion conflicts surface as concurrent commit errors without retry", async () => {
  const harness = fakeExecutionHarness({ throwConcurrentOnCommit: true });
  activeHarness = harness;
  const { commitOrderChanges, OrderCommitConcurrentCommitError } =
    await loadExecutionService();

  await assert.rejects(
    commitOrderChanges({
      orderId: "order-1",
      expectedDraftVersion: 2,
      actorContext,
      client: harness.client,
    }),
    OrderCommitConcurrentCommitError
  );
  assert.equal(harness.calls.transactionOptions.length, 1);
  assert.deepEqual(harness.calls.draftDeletes, []);
});

test("commitOrderChanges source stays Task 6 scoped", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/order-commits/order-commit-execution.service.ts"
    ),
    "utf8"
  );

  assert.match(source, /commitOrderChanges/);
  assert.match(source, /materializeOrderCommitDraftIntoOrderRows/);
  assert.match(source, /emitOrderCommitFinancialDocuments/);
  assert.match(source, /createOrderCommitDocumentLinks/);
  assert.doesNotMatch(source, /pendingOpsJson/);
  assert.doesNotMatch(source, /payment\.create|issueRefundWithPayment/);
  assert.doesNotMatch(source, /adjustment-workspace|AdjustmentWorkspace/);
  assert.doesNotMatch(source, /app\/orders|src\/components/);
});

async function loadExecutionService() {
  return import("@/modules/order-commits/order-commit-execution.service");
}

function requiredHarness(): ReturnType<typeof fakeExecutionHarness> {
  assert.ok(activeHarness, "Expected an active test harness.");
  return activeHarness;
}

function invoiceServiceShim() {
  return {
    buildOpenAdjustmentLineMap: async () => new Map(),
    computeCreditNoteCapacityForFinal: async () => new Prisma.Decimal(999),
    createAdjustmentInvoiceWithClient: async () => ({ id: "adjustment-invoice-1" }),
    createCreditNoteWithClient: async () => ({ id: "credit-note-1" }),
    createInvoiceForOrderWithClient: async () => {
      requiredHarness().calls.sequence.push("base-invoice");
      return { id: "base-invoice-1", status: InvoiceStatus.DRAFT };
    },
  };
}

function fakeExecutionHarness(input?: {
  draftVersion?: number;
  throwConcurrentOnCommit?: boolean;
}) {
  const pendingSnapshot = snapshot({
    catalogEntityId: "package-base",
    label: "Base package",
    unitPrice: 100,
  });
  const calls = {
    transactionOptions: [] as unknown[],
    sequence: [] as string[],
    orderCommitCreates: [] as Array<{ data: Record<string, unknown> }>,
    documentCreateMany: [] as Array<{ data: unknown[] }>,
    draftDeletes: [] as unknown[],
    audit: [] as Array<Record<string, unknown>>,
    activity: [] as Array<Record<string, unknown>>,
    invariants: [] as string[],
    paymentsCreated: 0,
  };
  const currentPackage = {
    id: "order-package-1",
    orderId: "order-1",
    originalPackageId: "package-base",
    currentPackageId: "package-base",
    bookingPackageId: "booking-package-1",
    sessionTypeId: "session-type-1",
    originalPackageNameSnapshot: "Base package",
    currentPackageNameSnapshot: "Base package",
    originalPackagePriceSnapshot: new Prisma.Decimal(100),
    finalPackagePriceSnapshot: new Prisma.Decimal(100),
    selectedPhotoCount: 10,
    extraDigitalCount: 0,
    extraPrintCount: 0,
    sortOrder: 0,
    createdAt: new Date("2026-06-02T00:00:00.000Z"),
    originalPackage: { photoCount: 10 },
    sessionType: { id: "session-type-1", name: "Portrait" },
  };
  const order = {
    id: "order-1",
    selectedPhotoCount: 10,
    booking: { financialCase: { id: "financial-case-1" } },
    packages: [currentPackage],
  };
  const documents: Array<{
    id: string;
    orderCommitId: string;
    invoiceId: string;
    role: string;
    createdAt: Date;
  }> = [];
  let invariantMarked = false;
  const markInvariantRead = () => {
    if (invariantMarked) return;
    invariantMarked = true;
    calls.sequence.push("invariants");
    calls.invariants.push("financial-case-1");
  };

  const transaction = {
    $queryRaw: async () => [],
    order: {
      findUnique: async () => order,
      update: async () => ({ id: "order-1" }),
    },
    orderPackage: {
      findMany: async () => [currentPackage],
      update: async () => ({ id: "order-package-1" }),
    },
    orderAddOn: {
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({ id: "addon-1" }),
      update: async () => ({ id: "addon-1" }),
      findFirst: async () => null,
    },
    orderPackageItemUpgrade: {
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({ id: "upgrade-1" }),
      update: async () => ({ id: "upgrade-1" }),
      findFirst: async () => null,
    },
    orderPackageSessionConfigurationSelection: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({ id: "selection-1" }),
      update: async () => ({ id: "selection-1" }),
    },
    orderCommitDraft: {
      findUnique: async () => ({
        id: "draft-1",
        orderId: "order-1",
        financialCaseId: "financial-case-1",
        pendingSnapshotJson: pendingSnapshot,
        version: input?.draftVersion ?? 2,
      }),
      delete: async (args: unknown) => {
        calls.sequence.push("draft.delete");
        calls.draftDeletes.push((args as { where: unknown }).where);
        return { id: "draft-1" };
      },
    },
    orderCommit: {
      findFirst: async () => null,
      create: async (args: { data: Record<string, unknown> }) => {
        calls.sequence.push("orderCommit.create");
        calls.orderCommitCreates.push(args);
        if (input?.throwConcurrentOnCommit) {
          throw new Prisma.PrismaClientKnownRequestError(
            "Unique constraint failed on committedFromDraftVersion",
            {
              code: "P2002",
              clientVersion: "test",
              meta: {
                target: ["orderId", "committedFromDraftVersion"],
              },
            }
          );
        }
        return {
          id: "order-commit-1",
          sequence: args.data.sequence as number,
          kind: args.data.kind as string,
        };
      },
    },
    orderCommitDocument: {
      createMany: async (args: { data: Array<Record<string, string>> }) => {
        calls.sequence.push("document.createMany");
        calls.documentCreateMany.push(args);
        documents.push(
          ...args.data.map((row, index) => ({
            id: `document-link-${index + 1}`,
            orderCommitId: row.orderCommitId,
            invoiceId: row.invoiceId,
            role: row.role,
            createdAt: new Date("2026-06-02T00:00:00.000Z"),
          }))
        );
        return { count: args.data.length };
      },
      findMany: async () => documents,
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.sequence.push("audit");
        calls.audit.push(args.data);
        return { id: "audit-1" };
      },
    },
    orderActivity: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.sequence.push("activity");
        calls.activity.push(args.data);
        return { id: "activity-1" };
      },
      findFirst: async () => null,
    },
    user: {
      findUnique: async () => ({ id: "manager-user", role: UserRole.MANAGER }),
    },
    invoice: {
      findMany: async () => [],
    },
    invoiceLineItem: {
      findMany: async () => [],
    },
    financialCase: {
      findUnique: async () => ({
        id: "financial-case-1",
        bookingId: "booking-1",
        jobId: "job-1",
        booking: {
          id: "booking-1",
          jobId: "job-1",
          order: { id: "order-1" },
        },
        invoices: [],
      }),
      findMany: async () => [],
    },
    documentApplication: {
      findMany: async () => [],
      aggregate: async () => ({
        _sum: { amountApplied: new Prisma.Decimal(0) },
      }),
    },
    payment: {
      findMany: async () => {
        markInvariantRead();
        return [];
      },
      create: async () => {
        calls.paymentsCreated += 1;
        return { id: "payment-1" };
      },
    },
  };

  const client = {
    $transaction: async (
      fn: (tx: typeof transaction) => Promise<unknown>,
      options: unknown
    ) => {
      calls.transactionOptions.push(options);
      return fn(transaction);
    },
  } as unknown as PrismaClient;

  return {
    calls,
    client,
    financialSummary: {
      stage: "booking",
      financialCaseId: "financial-case-1",
      bookingId: "booking-1",
      depositInvoice: null,
      depositPaid: false,
      awaitingFinalInvoiceAfterCheckIn: true,
      finalInvoicePending: true,
      linkedDocuments: [],
    },
    pendingSnapshot,
  };
}

function snapshot(input: {
  catalogEntityId: string;
  label: string;
  unitPrice: number;
}): OrderCommitSnapshotV1 {
  return {
    schemaVersion: "order_commit_snapshot_v1",
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-02T00:00:00.000Z",
    currency: "KWD",
    lines: [
      {
        lineId: "package:order-package-1",
        lineKind: "PACKAGE",
        orderEntityKind: "ORDER_PACKAGE",
        orderEntityId: "order-package-1",
        parentOrderPackageId: null,
        catalogEntityId: input.catalogEntityId,
        stableKey: "order-package:order-package-1",
        label: input.label,
        quantity: 1,
        unitPrice: input.unitPrice,
        lineTotal: input.unitPrice,
        priceSource: "ORDER_ROW_SNAPSHOT",
        metadata: {
          originalPackageId: "package-base",
          originalPackageNameSnapshot: "Base package",
          originalPackagePriceSnapshot: 100,
          bookingPackageId: "booking-package-1",
          selectedPhotoCount: 10,
          includedPhotoCount: 10,
          extraDigitalCount: 0,
          extraPrintCount: 0,
          sessionTypeId: "session-type-1",
          sessionTypeName: "Portrait",
          sortOrder: 0,
        },
      },
    ],
    totals: {
      subtotal: input.unitPrice,
      discountTotal: 0,
      netTotal: input.unitPrice,
    },
  };
}
