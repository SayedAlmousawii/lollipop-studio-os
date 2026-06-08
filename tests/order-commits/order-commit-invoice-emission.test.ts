import "dotenv/config";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Module from "node:module";
import test, { after } from "node:test";
import {
  DocumentApplicationKind,
  InvoiceLineType,
  InvoiceStatus,
  OrderEntityKind,
  Prisma,
  UserRole,
} from "@prisma/client";
import {
  ORDER_COMMIT_DOCUMENT_ROLE,
} from "@/modules/order-commits/order-commit.constants";
import {
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
} from "@/modules/order-commits/order-commit-preview.constants";
import type {
  OrderCommitDocumentPlanPreview,
  OrderCommitSnapshotDiff,
} from "@/modules/order-commits/order-commit-preview.types";
import type {
  OrderCommitFinancialEmission,
} from "@/modules/order-commits/order-commit-financial-emission.service";
import type {
  EmitOrderCommitFinancialDocumentsInput,
} from "@/modules/order-commits/order-commit-execution.service";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;
moduleWithLoader._load = function loadWithServerOnlyShim(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalModuleLoad.call(this, request, parent, isMain);
};
after(() => {
  moduleWithLoader._load = originalModuleLoad;
});

type BuildOpenAdjustmentLineMap = typeof import("@/modules/invoices/invoice.service")["buildOpenAdjustmentLineMap"];

const actorContext = {
  actorUserId: "manager-user",
  actorRole: UserRole.MANAGER,
};

async function loadExecutionService() {
  return import("@/modules/order-commits/order-commit-execution.service");
}

async function loadInvoiceService() {
  return import("@/modules/invoices/invoice.service");
}

test("emits a base invoice for first commits without using adjustment outputs", async () => {
  const { emitOrderCommitFinancialDocuments } = await loadExecutionService();
  const { client, calls } = fakeEmissionClient();
  const dependencies = fakeDependencies({
    emission: {
      ...emptyEmission(),
      adjustmentLines: [adjustmentLine("Positive add-on", 12)],
    },
  });

  const result = await emitOrderCommitFinancialDocuments({
    ...baseInput(client),
    resolvedFinalInvoice: null,
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.EMPTY,
    documentPlan: documentPlan(
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.BASE_INVOICE
    ),
    dependencies,
  });

  assert.deepEqual(result, {
    emissions: [
      {
        invoice: { id: "base-invoice", status: InvoiceStatus.DRAFT },
        role: ORDER_COMMIT_DOCUMENT_ROLE.BASE_INVOICE,
      },
    ],
    finalInvoiceMode: "CREATE_BASE",
    finalInvoiceId: "base-invoice",
  });
  assert.equal(calls.invoiceFindMany.length, 0);
  assert.equal(dependencies.createAdjustmentInvoiceWithClient.calls.length, 0);
  assert.equal(dependencies.createCreditNoteWithClient.calls.length, 0);
});

test("resolves CREATE_BASE from missing FINAL even with latest baseline", async () => {
  const { emitOrderCommitFinancialDocuments } = await loadExecutionService();
  const { client } = fakeEmissionClient();
  const dependencies = fakeDependencies({ emission: emptyEmission() });

  const result = await emitOrderCommitFinancialDocuments({
    ...baseInput(client),
    resolvedFinalInvoice: null,
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    documentPlan: documentPlan(
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.BASE_INVOICE
    ),
    dependencies,
  });

  assert.equal(result.finalInvoiceMode, "CREATE_BASE");
  assert.equal(result.finalInvoiceId, "base-invoice");
  assert.equal(dependencies.createInvoiceForOrderWithClient.calls.length, 1);
  assert.equal(dependencies.buildOpenAdjustmentLineMap.calls.length, 0);
});

test("rebuilds an unlocked FINAL without mapping ADJ or CREDIT output", async () => {
  const { emitOrderCommitFinancialDocuments } = await loadExecutionService();
  const { client, calls } = fakeEmissionClient();
  const dependencies = fakeDependencies({
    emission: {
      ...emptyEmission(),
      adjustmentLines: [adjustmentLine("Should not emit", 10)],
      creditNoteFinalLines: [
        { reason: "REMOVED_ADDON", line: creditLine("Should not credit", 5) },
      ],
    },
  });

  const result = await emitOrderCommitFinancialDocuments({
    ...baseInput(client),
    resolvedFinalInvoice: { id: "unlocked-final", isLocked: false },
    documentPlan: documentPlan(
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.REFUND_NEEDED
    ),
    dependencies,
  });

  assert.deepEqual(result, {
    emissions: [],
    finalInvoiceMode: "REBUILD_UNLOCKED",
    finalInvoiceId: "unlocked-final",
    rebuiltInvoiceId: "unlocked-final",
  });
  assert.equal(dependencies.mapOrderCommitDiffToFinancialLines.calls.length, 0);
  assert.equal(dependencies.buildOpenAdjustmentLineMap.calls.length, 0);
  assert.equal(dependencies.createAdjustmentInvoiceWithClient.calls.length, 0);
  assert.equal(dependencies.createCreditNoteWithClient.calls.length, 0);
  assert.equal(
    dependencies.rebuildUnlockedFinalInvoiceForOrderWithClient.calls.length,
    1
  );
  assert.deepEqual(calls.orderUpdates, []);
});

test("resolves EMIT_ADJUSTMENT from locked FINAL even without latest baseline", async () => {
  const { emitOrderCommitFinancialDocuments } = await loadExecutionService();
  const { client } = fakeEmissionClient();
  const dependencies = fakeDependencies({
    emission: {
      ...emptyEmission(),
      adjustmentLines: [adjustmentLine("Mapped add-on", 20)],
    },
  });

  const result = await emitOrderCommitFinancialDocuments({
    ...baseInput(client),
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.EMPTY,
    resolvedFinalInvoice: { id: "locked-final", isLocked: true },
    documentPlan: documentPlan(
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.BASE_INVOICE
    ),
    dependencies,
  });

  assert.equal(result.finalInvoiceMode, "EMIT_ADJUSTMENT");
  assert.equal(result.finalInvoiceId, "locked-final");
  assert.deepEqual(result.emissions, [
    {
      invoice: { id: "adjustment-invoice-1" },
      role: ORDER_COMMIT_DOCUMENT_ROLE.ADJUSTMENT_INVOICE,
    },
  ]);
  assert.equal(
    dependencies.rebuildUnlockedFinalInvoiceForOrderWithClient.calls.length,
    0
  );
});

test("uses mapper output, not documentPlan.kind alone, for later emissions", async () => {
  const { emitOrderCommitFinancialDocuments } = await loadExecutionService();
  const { client } = fakeEmissionClient();
  const noOutputDependencies = fakeDependencies({ emission: emptyEmission() });
  const noOutputResult = await emitOrderCommitFinancialDocuments({
    ...baseInput(client),
    documentPlan: documentPlan(
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ADJUSTMENT_INVOICE
    ),
    dependencies: noOutputDependencies,
  });
  assert.deepEqual(noOutputResult.emissions, []);
  assert.equal(
    noOutputDependencies.createAdjustmentInvoiceWithClient.calls.length,
    0
  );

  const mappedOutputDependencies = fakeDependencies({
    emission: {
      ...emptyEmission(),
      adjustmentLines: [adjustmentLine("Mapped add-on", 20)],
    },
  });
  const mappedOutputResult = await emitOrderCommitFinancialDocuments({
    ...baseInput(client),
    documentPlan: documentPlan(ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.NO_OP),
    dependencies: mappedOutputDependencies,
  });
  assert.deepEqual(mappedOutputResult.emissions, [
    {
      invoice: { id: "adjustment-invoice-1" },
      role: ORDER_COMMIT_DOCUMENT_ROLE.ADJUSTMENT_INVOICE,
    },
  ]);
});

test("does not pre-check final credit capacity for residual credits", async () => {
  const { emitOrderCommitFinancialDocuments } = await loadExecutionService();
  const { client } = fakeEmissionClient();
  const dependencies = fakeDependencies({
    emission: {
      ...emptyEmission(),
      adjustmentLines: [adjustmentLine("Mapped add-on", 20)],
      creditNoteFinalLines: [
        {
          reason: "REMOVED_ADDON",
          line: creditLine("Removed add-on", 10),
        },
      ],
    },
    creditCapacity: 5,
  });

  const result = await emitOrderCommitFinancialDocuments({
    ...baseInput(client),
    requiresApproval: true,
    approvalActorUserId: "manager-user",
    documentPlan: documentPlan(
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.CREDIT_NOTE
    ),
    dependencies,
  });

  assert.deepEqual(result.emissions, [
    {
      invoice: { id: "adjustment-invoice-1" },
      role: ORDER_COMMIT_DOCUMENT_ROLE.ADJUSTMENT_INVOICE,
    },
    { invoice: { id: "credit-note-1" }, role: ORDER_COMMIT_DOCUMENT_ROLE.CREDIT_NOTE },
  ]);
  assert.equal(dependencies.createAdjustmentInvoiceWithClient.calls.length, 1);
  assert.equal(dependencies.createCreditNoteWithClient.calls.length, 1);
  assert.equal(
    dependencies.createCreditNoteWithClient.calls[0]?.input.applicationMode,
    "UNAPPLIED"
  );
});

test("emits final credit notes and marks refund pending without payments", async () => {
  const { emitOrderCommitFinancialDocuments } = await loadExecutionService();
  const { client, calls } = fakeEmissionClient();
  const dependencies = fakeDependencies({
    emission: {
      ...emptyEmission(),
      creditNoteFinalLines: [
        {
          reason: "REMOVED_ADDON",
          line: creditLine("Removed add-on", 10),
        },
      ],
    },
  });

  const result = await emitOrderCommitFinancialDocuments({
    ...baseInput(client),
    requiresApproval: true,
    approvalActorUserId: "manager-user",
    documentPlan: documentPlan(
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.REFUND_NEEDED
    ),
    dependencies,
  });

  assert.deepEqual(result.emissions, [
    { invoice: { id: "credit-note-1" }, role: ORDER_COMMIT_DOCUMENT_ROLE.CREDIT_NOTE },
  ]);
  assert.equal(dependencies.createCreditNoteWithClient.calls.length, 1);
  assert.equal(
    dependencies.createCreditNoteWithClient.calls[0]?.input.targetFinalInvoiceId,
    "final-invoice"
  );
  assert.equal(
    dependencies.createCreditNoteWithClient.calls[0]?.input.applicationMode,
    "UNAPPLIED"
  );
  assert.equal(dependencies.appendCreditApplication.calls.length, 0);
  assert.deepEqual(calls.orderUpdates, [
    {
      where: { id: "order-1" },
      data: { refundPending: true },
      select: { id: true },
    },
  ]);
});

test("settles residual credit against the same-commit adjustment invoice", async () => {
  const { emitOrderCommitFinancialDocuments } = await loadExecutionService();
  const { client } = fakeEmissionClient();
  const dependencies = fakeDependencies({
    emission: {
      ...emptyEmission(),
      adjustmentLines: [adjustmentLine("Package upgrade", 100)],
      creditNoteFinalLines: [
        {
          reason: "REMOVED_EXTRA_PHOTO",
          line: creditLine("Removed extra photos", 10),
        },
      ],
    },
    openReceivables: [
      { invoiceId: "adjustment-invoice-1", invoiceSeq: 10, remainingAmount: 100 },
    ],
  });

  const result = await emitOrderCommitFinancialDocuments({
    ...baseInput(client),
    requiresApproval: true,
    approvalActorUserId: "manager-user",
    documentPlan: documentPlan(
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ADJUSTMENT_INVOICE
    ),
    dependencies,
  });

  assert.deepEqual(result.emissions, [
    {
      invoice: { id: "adjustment-invoice-1" },
      role: ORDER_COMMIT_DOCUMENT_ROLE.ADJUSTMENT_INVOICE,
    },
    { invoice: { id: "credit-note-1" }, role: ORDER_COMMIT_DOCUMENT_ROLE.CREDIT_NOTE },
  ]);
  assert.equal(
    dependencies.createCreditNoteWithClient.calls[0]?.input.applicationMode,
    "UNAPPLIED"
  );
  assert.deepEqual(dependencies.appendCreditApplication.calls.map((call) => call.input), [
    {
      creditNoteId: "credit-note-1",
      targetInvoiceId: "adjustment-invoice-1",
      amount: 10,
      kind: DocumentApplicationKind.SETTLEMENT,
      appliedByUserId: "manager-user",
      notes: "OrderCommit residual credit settlement",
    },
  ]);
});

test("settles residual credit oldest first across open receivables", async () => {
  const { emitOrderCommitFinancialDocuments } = await loadExecutionService();
  const { client } = fakeEmissionClient();
  const dependencies = fakeDependencies({
    emission: {
      ...emptyEmission(),
      creditNoteFinalLines: [
        {
          reason: "REMOVED_ADDON",
          line: creditLine("Removed add-on", 30),
        },
      ],
    },
    openReceivables: [
      { invoiceId: "old-adjustment", invoiceSeq: 2, remainingAmount: 20 },
      { invoiceId: "new-adjustment", invoiceSeq: 3, remainingAmount: 15 },
    ],
  });

  await emitOrderCommitFinancialDocuments({
    ...baseInput(client),
    requiresApproval: true,
    approvalActorUserId: "manager-user",
    documentPlan: documentPlan(
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.CREDIT_NOTE
    ),
    dependencies,
  });

  assert.deepEqual(dependencies.appendCreditApplication.calls.map((call) => call.input), [
    {
      creditNoteId: "credit-note-1",
      targetInvoiceId: "old-adjustment",
      amount: 20,
      kind: DocumentApplicationKind.SETTLEMENT,
      appliedByUserId: "manager-user",
      notes: "OrderCommit residual credit settlement",
    },
    {
      creditNoteId: "credit-note-1",
      targetInvoiceId: "new-adjustment",
      amount: 10,
      kind: DocumentApplicationKind.SETTLEMENT,
      appliedByUserId: "manager-user",
      notes: "OrderCommit residual credit settlement",
    },
  ]);
});

test("leaves residual credit unapplied when receivables are exhausted", async () => {
  const { emitOrderCommitFinancialDocuments } = await loadExecutionService();
  const { client } = fakeEmissionClient();
  const dependencies = fakeDependencies({
    emission: {
      ...emptyEmission(),
      creditNoteFinalLines: [
        {
          reason: "REMOVED_ADDON",
          line: creditLine("Removed add-on", 30),
        },
      ],
    },
    openReceivables: [
      { invoiceId: "only-adjustment", invoiceSeq: 2, remainingAmount: 12 },
    ],
  });

  await emitOrderCommitFinancialDocuments({
    ...baseInput(client),
    requiresApproval: true,
    approvalActorUserId: "manager-user",
    documentPlan: documentPlan(
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.CREDIT_NOTE
    ),
    dependencies,
  });

  assert.equal(
    dependencies.createCreditNoteWithClient.calls[0]?.input.applicationMode,
    "UNAPPLIED"
  );
  assert.deepEqual(dependencies.appendCreditApplication.calls.map((call) => call.input), [
    {
      creditNoteId: "credit-note-1",
      targetInvoiceId: "only-adjustment",
      amount: 12,
      kind: DocumentApplicationKind.SETTLEMENT,
      appliedByUserId: "manager-user",
      notes: "OrderCommit residual credit settlement",
    },
  ]);
});

test("groups adjustment reversals into line-targeted credit notes", async () => {
  const { emitOrderCommitFinancialDocuments } = await loadExecutionService();
  const { client } = fakeEmissionClient();
  const dependencies = fakeDependencies({
    emission: {
      ...emptyEmission(),
      adjustmentReversals: [
        {
          reason: "REMOVED_ADDON",
          parentAdjustmentInvoiceId: "adjustment-parent",
          targetInvoiceLineId: "adjustment-line-1",
          causeOrderEntityKind: OrderEntityKind.ADDON,
          causeOrderEntityId: "addon-1",
          amount: 8,
          description: "Removed: Add-on",
        },
      ],
    },
  });

  const result = await emitOrderCommitFinancialDocuments({
    ...baseInput(client),
    requiresApproval: true,
    approvalActorUserId: "manager-user",
    documentPlan: documentPlan(
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.CREDIT_NOTE
    ),
    dependencies,
  });

  assert.deepEqual(result.emissions, [
    { invoice: { id: "credit-note-1" }, role: ORDER_COMMIT_DOCUMENT_ROLE.CREDIT_NOTE },
  ]);
  assert.equal(
    dependencies.createCreditNoteWithClient.calls[0]?.input
      .targetAdjustmentInvoiceId,
    "adjustment-parent"
  );
  assert.equal(
    dependencies.createCreditNoteWithClient.calls[0]?.input.reason,
    "REMOVED_ADDON"
  );
  assert.deepEqual(dependencies.createCreditNoteWithClient.calls[0]?.input.lines, [
    {
      lineType: InvoiceLineType.MANUAL_DISCOUNT,
      description: "Removed: Add-on",
      quantity: 1,
      unitPrice: 8,
      causeOrderEntityKind: OrderEntityKind.ADDON,
      causeOrderEntityId: "addon-1",
      targetInvoiceId: "adjustment-parent",
      targetInvoiceLineId: "adjustment-line-1",
    },
  ]);
});

test("uses the first reversal reason when a parent ADJ groups mixed reasons", async () => {
  const { emitOrderCommitFinancialDocuments } = await loadExecutionService();
  const { client } = fakeEmissionClient();
  const dependencies = fakeDependencies({
    emission: {
      ...emptyEmission(),
      adjustmentReversals: [
        {
          reason: "REMOVED_ADDON",
          parentAdjustmentInvoiceId: "adjustment-parent",
          targetInvoiceLineId: "adjustment-line-addon",
          causeOrderEntityKind: OrderEntityKind.ADDON,
          causeOrderEntityId: "addon-1",
          amount: 5,
          description: "Removed: Add-on",
        },
        {
          reason: "REMOVED_PACKAGE_ITEM_UPGRADE",
          parentAdjustmentInvoiceId: "adjustment-parent",
          targetInvoiceLineId: "adjustment-line-upgrade",
          causeOrderEntityKind: OrderEntityKind.UPGRADE,
          causeOrderEntityId: "upgrade-1",
          amount: 7,
          description: "Removed: Item upgrade",
        },
      ],
    },
  });

  await emitOrderCommitFinancialDocuments({
    ...baseInput(client),
    requiresApproval: true,
    approvalActorUserId: "manager-user",
    documentPlan: documentPlan(
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.CREDIT_NOTE
    ),
    dependencies,
  });

  assert.equal(dependencies.createCreditNoteWithClient.calls.length, 1);
  assert.equal(
    dependencies.createCreditNoteWithClient.calls[0]?.input.reason,
    "REMOVED_ADDON"
  );
});

test("keeps cause reversals line-targeted before residual settlement", async () => {
  const { emitOrderCommitFinancialDocuments } = await loadExecutionService();
  const { client } = fakeEmissionClient();
  const dependencies = fakeDependencies({
    emission: {
      ...emptyEmission(),
      adjustmentReversals: [
        {
          reason: "REMOVED_ADDON",
          parentAdjustmentInvoiceId: "same-cause-adjustment",
          targetInvoiceLineId: "same-cause-line",
          causeOrderEntityKind: OrderEntityKind.ADDON,
          causeOrderEntityId: "addon-1",
          amount: 8,
          description: "Removed: Add-on",
        },
      ],
      creditNoteFinalLines: [
        {
          reason: "PACKAGE_TIER_DOWNGRADE",
          line: creditLine("Package downgrade", 5),
        },
      ],
    },
    openReceivables: [
      { invoiceId: "other-adjustment", invoiceSeq: 4, remainingAmount: 20 },
    ],
  });

  await emitOrderCommitFinancialDocuments({
    ...baseInput(client),
    requiresApproval: true,
    approvalActorUserId: "manager-user",
    documentPlan: documentPlan(
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.CREDIT_NOTE
    ),
    dependencies,
  });

  assert.equal(dependencies.createCreditNoteWithClient.calls.length, 2);
  assert.equal(
    dependencies.createCreditNoteWithClient.calls[0]?.input
      .targetAdjustmentInvoiceId,
    "same-cause-adjustment"
  );
  assert.deepEqual(dependencies.createCreditNoteWithClient.calls[0]?.input.lines, [
    {
      lineType: InvoiceLineType.MANUAL_DISCOUNT,
      description: "Removed: Add-on",
      quantity: 1,
      unitPrice: 8,
      causeOrderEntityKind: OrderEntityKind.ADDON,
      causeOrderEntityId: "addon-1",
      targetInvoiceId: "same-cause-adjustment",
      targetInvoiceLineId: "same-cause-line",
    },
  ]);
  assert.deepEqual(dependencies.appendCreditApplication.calls.map((call) => call.input), [
    {
      creditNoteId: "credit-note-2",
      targetInvoiceId: "other-adjustment",
      amount: 5,
      kind: DocumentApplicationKind.SETTLEMENT,
      appliedByUserId: "manager-user",
      notes: "OrderCommit residual credit settlement",
    },
  ]);
});

test("uses the first residual reason when mixed reasons create a credit note", async () => {
  const { emitOrderCommitFinancialDocuments } = await loadExecutionService();
  const { client } = fakeEmissionClient();
  const dependencies = fakeDependencies({
    emission: {
      ...emptyEmission(),
      creditNoteFinalLines: [
        {
          reason: "REMOVED_ADDON",
          line: creditLine("Removed: Add-on", 10),
        },
        {
          reason: "PACKAGE_TIER_DOWNGRADE",
          line: {
            lineType: InvoiceLineType.MANUAL_DISCOUNT,
            description: "Package downgrade: A -> B",
            quantity: 1,
            unitPrice: 20,
            causeOrderEntityKind: OrderEntityKind.PACKAGE_TIER_UPGRADE,
            causeOrderEntityId: "order-package-1",
          },
        },
      ],
    },
  });

  await emitOrderCommitFinancialDocuments({
    ...baseInput(client),
    requiresApproval: true,
    approvalActorUserId: "manager-user",
    documentPlan: documentPlan(
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.CREDIT_NOTE
    ),
    dependencies,
  });

  assert.equal(dependencies.createCreditNoteWithClient.calls.length, 1);
  assert.equal(
    dependencies.createCreditNoteWithClient.calls[0]?.input.reason,
    "REMOVED_ADDON"
  );
  assert.equal(
    dependencies.createCreditNoteWithClient.calls[0]?.input.targetFinalInvoiceId,
    "final-invoice"
  );
  assert.equal(
    dependencies.createCreditNoteWithClient.calls[0]?.input.applicationMode,
    "UNAPPLIED"
  );
});

test("emits mixed-sign adjustment and final credit documents", async () => {
  const { emitOrderCommitFinancialDocuments } = await loadExecutionService();
  const { client } = fakeEmissionClient();
  const dependencies = fakeDependencies({
    emission: {
      ...emptyEmission(),
      adjustmentLines: [adjustmentLine("Package upgrade", 40)],
      creditNoteFinalLines: [
        {
          reason: "REMOVED_ADDON",
          line: creditLine("Removed add-on", 10),
        },
      ],
    },
  });

  const result = await emitOrderCommitFinancialDocuments({
    ...baseInput(client),
    requiresApproval: true,
    approvalActorUserId: "manager-user",
    documentPlan: documentPlan(
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ADJUSTMENT_INVOICE
    ),
    dependencies,
  });

  assert.deepEqual(result.emissions, [
    {
      invoice: { id: "adjustment-invoice-1" },
      role: ORDER_COMMIT_DOCUMENT_ROLE.ADJUSTMENT_INVOICE,
    },
    { invoice: { id: "credit-note-1" }, role: ORDER_COMMIT_DOCUMENT_ROLE.CREDIT_NOTE },
  ]);
});

test("requires manager or admin approval when preview requires approval", async () => {
  const {
    emitOrderCommitFinancialDocuments,
    OrderCommitApprovalRequiredError,
  } = await loadExecutionService();
  const { client } = fakeEmissionClient({ approvalRole: UserRole.RECEPTIONIST });
  await assert.rejects(
    emitOrderCommitFinancialDocuments({
      ...baseInput(client),
      requiresApproval: true,
      approvalActorUserId: "receptionist-user",
      dependencies: fakeDependencies({ emission: emptyEmission() }),
    }),
    OrderCommitApprovalRequiredError
  );
});

test("buildOpenAdjustmentLineMap returns canonical ordered open lines", async () => {
  const { buildOpenAdjustmentLineMap } = await loadInvoiceService();
  const calls: Array<{ model: string; args: unknown }> = [];
  const client = {
    invoiceLineItem: {
      findMany: async (args: unknown) => {
        calls.push({ model: "invoiceLineItem", args });
        return [
          openLineRow({
            id: "line-late",
            invoiceSeq: 3,
            sortOrder: 0,
            causeOrderEntityKind: OrderEntityKind.ADDON,
            causeOrderEntityId: "addon-1",
          }),
          openLineRow({
            id: "line-b",
            invoiceSeq: 1,
            sortOrder: 2,
            causeOrderEntityKind: OrderEntityKind.ADDON,
            causeOrderEntityId: "addon-1",
          }),
          openLineRow({
            id: "line-a",
            invoiceSeq: 1,
            sortOrder: 1,
            causeOrderEntityKind: OrderEntityKind.ADDON,
            causeOrderEntityId: "addon-1",
          }),
          openLineRow({
            id: "line-package",
            invoiceSeq: 2,
            sortOrder: 0,
            causeOrderEntityKind: OrderEntityKind.PACKAGE_TIER_UPGRADE,
            causeOrderEntityId: "package-tier-upgrade",
          }),
          openLineRow({
            id: "line-print",
            invoiceSeq: 2,
            sortOrder: 1,
            causeOrderEntityKind: OrderEntityKind.EXTRA_PHOTO,
            causeOrderEntityId: "Extra print photos",
          }),
        ];
      },
    },
    orderPackage: {
      findMany: async (args: unknown) => {
        calls.push({ model: "orderPackage", args });
        return [
          { id: "package-1", extraDigitalCount: 1, extraPrintCount: 0 },
          { id: "package-2", extraDigitalCount: 0, extraPrintCount: 2 },
        ];
      },
    },
    documentApplication: {
      aggregate: async () => ({
        _sum: { amountApplied: new Prisma.Decimal(0) },
      }),
    },
  } as unknown as Parameters<BuildOpenAdjustmentLineMap>[2];

  const map = await buildOpenAdjustmentLineMap(
    "financial-case-1",
    "order-1",
    client
  );

  assert.deepEqual(
    map.get("ADDON:addon-1")?.map((line) => line.invoiceLineId),
    ["line-a", "line-b", "line-late"]
  );
  assert.ok(map.has("PACKAGE_TIER_UPGRADE:package-1"));
  assert.ok(map.has("PACKAGE_TIER_UPGRADE:package-2"));
  assert.ok(map.has("EXTRA_PHOTO:package-2:PRINT"));
  assert.equal(map.has("EXTRA_PHOTO:Extra print photos"), false);
  assert.match(
    JSON.stringify(calls.find((call) => call.model === "invoiceLineItem")?.args),
    /financialCaseId.*financial-case-1.*orderId.*order-1/
  );
});

test("buildOpenReceivableInvoices returns ordered adjustment invoice remaining balances", async () => {
  const { buildOpenReceivableInvoices } = await loadInvoiceService();
  const calls: Array<{ model: string; args: unknown }> = [];
  const invoiceTotals = new Map([
    ["old-adjustment", new Prisma.Decimal(20)],
    ["closed-adjustment", new Prisma.Decimal(10)],
    ["late-adjustment", new Prisma.Decimal(25)],
  ]);
  const incomingPaid = new Map([
    ["old-adjustment", new Prisma.Decimal(5)],
    ["closed-adjustment", new Prisma.Decimal(10)],
    ["late-adjustment", new Prisma.Decimal(0)],
  ]);
  const documentPaid = new Map([
    ["old-adjustment", new Prisma.Decimal(3)],
    ["closed-adjustment", new Prisma.Decimal(0)],
    ["late-adjustment", new Prisma.Decimal(0)],
  ]);
  const client = {
    invoice: {
      findMany: async (args: unknown) => {
        calls.push({ model: "invoice.findMany", args });
        return [
          {
            id: "old-adjustment",
            invoiceSeq: 1,
            totalAmount: invoiceTotals.get("old-adjustment")!,
          },
          {
            id: "closed-adjustment",
            invoiceSeq: 2,
            totalAmount: invoiceTotals.get("closed-adjustment")!,
          },
          {
            id: "late-adjustment",
            invoiceSeq: 3,
            totalAmount: invoiceTotals.get("late-adjustment")!,
          },
        ];
      },
      findUnique: async (args: { where: { id: string } }) => ({
        id: args.where.id,
        invoiceType: "ADJUSTMENT",
      }),
    },
    paymentAllocation: {
      aggregate: async (args: { where: { invoiceId: string; payment: { direction: string } } }) => ({
        _sum: {
          amount:
            args.where.payment.direction === "IN"
              ? incomingPaid.get(args.where.invoiceId)
              : new Prisma.Decimal(0),
        },
      }),
    },
    documentApplication: {
      aggregate: async (args: { where: { targetInvoiceId: string } }) => ({
        _sum: {
          amountApplied: documentPaid.get(args.where.targetInvoiceId),
        },
      }),
    },
  } as unknown as Parameters<typeof buildOpenReceivableInvoices>[2];

  const receivables = await buildOpenReceivableInvoices(
    "financial-case-1",
    "order-1",
    client
  );

  assert.deepEqual(
    receivables.map((invoice) => ({
      invoiceId: invoice.invoiceId,
      remainingAmount: invoice.remainingAmount.toFixed(3),
    })),
    [
      { invoiceId: "old-adjustment", remainingAmount: "12.000" },
      { invoiceId: "late-adjustment", remainingAmount: "25.000" },
    ]
  );
  assert.match(
    JSON.stringify(calls.find((call) => call.model === "invoice.findMany")?.args),
    /financialCaseId.*financial-case-1.*orderId.*order-1.*ADJUSTMENT/
  );
});

test("order commit execution source avoids out-of-scope integrations", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/order-commits/order-commit-execution.service.ts"
    ),
    "utf8"
  );

  assert.doesNotMatch(source, /pendingOpsJson/);
  assert.doesNotMatch(source, /payment\.create|issueRefundWithPayment|refund\.service/);
  assert.doesNotMatch(source, /adjustment-workspace|AdjustmentWorkspace/);
  assert.doesNotMatch(source, /app\/orders|src\/components/);
});

function baseInput(
  client: Prisma.TransactionClient
): Omit<
  EmitOrderCommitFinancialDocumentsInput,
  "dependencies"
> {
  return {
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    resolvedFinalInvoice: { id: "final-invoice", isLocked: true },
    baselineSource: ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
    diff: {} as OrderCommitSnapshotDiff,
    documentPlan: documentPlan(
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ADJUSTMENT_INVOICE
    ),
    requiresApproval: false,
    draftToOrderEntityMap: new Map(),
    actorContext,
    client,
  };
}

function documentPlan(
  kind: OrderCommitDocumentPlanPreview["kind"]
): OrderCommitDocumentPlanPreview {
  return {
    kind,
    amount: 0,
    requiresPaymentCollection: false,
    requiresRefundReview:
      kind === ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.REFUND_NEEDED,
    reason: null,
  };
}

function emptyEmission(): OrderCommitFinancialEmission {
  return {
    adjustmentLines: [],
    creditNoteFinalLines: [],
    adjustmentReversals: [],
    totals: {
      positiveTotal: 0,
      negativeTotal: 0,
      netDelta: 0,
      reversalTotal: 0,
      creditNoteFinalTotal: 0,
    },
  };
}

function adjustmentLine(description: string, unitPrice: number) {
  return {
    lineType: InvoiceLineType.ADD_ON,
    description,
    quantity: 1,
    unitPrice,
    causeOrderEntityKind: OrderEntityKind.ADDON,
    causeOrderEntityId: "addon-1",
  };
}

function creditLine(description: string, unitPrice: number) {
  return {
    lineType: InvoiceLineType.MANUAL_DISCOUNT,
    description,
    quantity: 1,
    unitPrice,
    causeOrderEntityKind: OrderEntityKind.ADDON,
    causeOrderEntityId: "addon-1",
  };
}

function fakeEmissionClient(options?: { approvalRole?: UserRole }) {
  const calls = {
    invoiceFindMany: [] as unknown[],
    orderUpdates: [] as unknown[],
  };
  const client = {
    user: {
      findUnique: async () => ({
        id: "approval-user",
        role: options?.approvalRole ?? UserRole.MANAGER,
      }),
    },
    invoice: {
      findMany: async (args: unknown) => {
        calls.invoiceFindMany.push(args);
        return [{ id: "final-invoice" }];
      },
    },
    order: {
      update: async (args: unknown) => {
        calls.orderUpdates.push(args);
        return { id: "order-1" };
      },
    },
  } as unknown as Prisma.TransactionClient;

  return { client, calls };
}

function fakeDependencies(options: {
  emission: OrderCommitFinancialEmission;
  creditCapacity?: number;
  openReceivables?: Array<{
    invoiceId: string;
    invoiceSeq: number;
    remainingAmount: number;
  }>;
}) {
  const createAdjustmentInvoiceWithClient = async (input: unknown) => {
    createAdjustmentInvoiceWithClient.calls.push({ input });
    return { id: `adjustment-invoice-${createAdjustmentInvoiceWithClient.calls.length}` };
  };
  createAdjustmentInvoiceWithClient.calls = [] as Array<{ input: unknown }>;

  const createCreditNoteWithClient = async (input: unknown) => {
    createCreditNoteWithClient.calls.push({ input: input as { lines: unknown[] } });
    return { id: `credit-note-${createCreditNoteWithClient.calls.length}` };
  };
  createCreditNoteWithClient.calls = [] as Array<{
    input: {
      targetFinalInvoiceId?: string;
      targetAdjustmentInvoiceId?: string;
      reason?: string;
      applicationMode?: "AUTO_APPLY" | "UNAPPLIED";
      lines: unknown[];
    };
  }>;

  const buildOpenAdjustmentLineMap = async () => {
    buildOpenAdjustmentLineMap.calls.push({});
    return new Map();
  };
  buildOpenAdjustmentLineMap.calls = [] as Array<Record<string, never>>;

  const buildOpenReceivableInvoices = async () => {
    buildOpenReceivableInvoices.calls.push({});
    return (options.openReceivables ?? []).map((invoice) => ({
      invoiceId: invoice.invoiceId,
      invoiceSeq: invoice.invoiceSeq,
      totalAmount: new Prisma.Decimal(invoice.remainingAmount),
      effectivePaidAmount: new Prisma.Decimal(0),
      remainingAmount: new Prisma.Decimal(invoice.remainingAmount),
    }));
  };
  buildOpenReceivableInvoices.calls = [] as Array<Record<string, never>>;

  const appendCreditApplication = async (input: unknown) => {
    appendCreditApplication.calls.push({ input });
    return { id: `application-${appendCreditApplication.calls.length}` };
  };
  appendCreditApplication.calls = [] as Array<{ input: {
    creditNoteId: string;
    targetInvoiceId: string;
    amount: Prisma.Decimal.Value;
    kind: DocumentApplicationKind;
    targetInvoiceLineId?: string | null;
  } }>;

  const createInvoiceForOrderWithClient = async () => {
    createInvoiceForOrderWithClient.calls.push({});
    return {
      id: "base-invoice",
      status: InvoiceStatus.DRAFT,
    };
  };
  createInvoiceForOrderWithClient.calls = [] as Array<Record<string, never>>;

  const rebuildUnlockedFinalInvoiceForOrderWithClient = async (
    _client: unknown,
    input: { finalInvoiceId: string }
  ) => {
    rebuildUnlockedFinalInvoiceForOrderWithClient.calls.push({ input });
    return {
      id: input.finalInvoiceId,
      status: InvoiceStatus.DRAFT,
    };
  };
  rebuildUnlockedFinalInvoiceForOrderWithClient.calls = [] as Array<{
    input: { finalInvoiceId: string };
  }>;

  const mapOrderCommitDiffToFinancialLines = () => {
    mapOrderCommitDiffToFinancialLines.calls.push({});
    return options.emission;
  };
  mapOrderCommitDiffToFinancialLines.calls = [] as Array<Record<string, never>>;

  return {
    buildOpenAdjustmentLineMap,
    buildOpenReceivableInvoices,
    computeCreditNoteCapacityForFinal: async () =>
      new Prisma.Decimal(options.creditCapacity ?? 999),
    appendCreditApplication,
    createAdjustmentInvoiceWithClient,
    createCreditNoteWithClient,
    createInvoiceForOrderWithClient,
    rebuildUnlockedFinalInvoiceForOrderWithClient,
    mapOrderCommitDiffToFinancialLines,
  };
}

function openLineRow(input: {
  id: string;
  invoiceSeq: number;
  sortOrder: number;
  causeOrderEntityKind: OrderEntityKind;
  causeOrderEntityId: string;
}) {
  return {
    id: input.id,
    invoiceId: `invoice-${input.invoiceSeq}`,
    description: input.id,
    lineTotal: new Prisma.Decimal(10),
    sortOrder: input.sortOrder,
    causeOrderEntityKind: input.causeOrderEntityKind,
    causeOrderEntityId: input.causeOrderEntityId,
    invoice: {
      invoiceSeq: input.invoiceSeq,
      paymentAllocations: [] as Array<{ amount: Prisma.Decimal }>,
      lineItems: [
        { id: input.id, lineTotal: new Prisma.Decimal(10) },
      ],
    },
  };
}
