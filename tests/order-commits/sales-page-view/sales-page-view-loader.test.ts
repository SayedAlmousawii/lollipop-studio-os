import assert from "node:assert/strict";
import test from "node:test";
import {
  InvoiceStatus,
  InvoiceType,
  OrderSelectionStatus,
  OrderStatus,
  UserRole,
} from "@prisma/client";
import {
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
  ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  type OrderCommitPreview,
  type OrderCommitSnapshotLineV1,
  type OrderCommitSnapshotV1,
} from "@/modules/order-commits";
import type { ActorContext } from "@/lib/auth/actor-context";
import type { FinancialCaseSummary } from "@/modules/financial-cases/financial-case-summary.types";
import type { DraftPOSCompositionProjection } from "@/modules/orders/composition/projections/to-draft-pos-composition";
import type { POSWorkspace } from "@/modules/orders/order.types";
import type {
  OrderCommitDraftState,
} from "@/modules/order-commits/order-commit.service";
import type {
  SalesPageViewLoaderDependencies,
} from "@/modules/order-commits/projections";
import { getSalesPageView } from "@/modules/order-commits/projections";

test("loader composes no-draft view without preview or draft creation", async () => {
  const calls = callTracker();
  const dependencies = fakeDependencies({
    calls,
    draft: null,
  });

  const view = await getSalesPageView({
    orderId: "order-1",
    actorContext: actorContext(),
    dependencies,
  });

  assert.equal(view.draft, null);
  assert.equal(view.preview, null);
  assert.equal(view.composition.source, "current");
  assert.equal(view.stagedChanges.length, 0);
  assert.equal(calls.preview, 0);
  assert.equal(calls.getOrCreateDraft, 0);
  assert.equal(calls.draftComposition, 1);
  assert.equal(view.order.jobNumber, "JOB-1");
  assert.equal(view.financialPreview.baseline.remaining, 100);
});

test("loader composes with-draft view from pending snapshot and preview once", async () => {
  const calls = callTracker();
  const draft = draftState({
    pendingSnapshot: snapshotFixture({
      netTotal: 222,
      lines: [
        packageLine({
          orderEntityId: "draft:package-1",
          label: "Projected Package",
          lineTotal: 222,
        }),
      ],
    }),
  });
  const dependencies = fakeDependencies({
    calls,
    draft,
    preview: previewFixture({ netDelta: 22 }),
  });

  const view = await getSalesPageView({
    orderId: "order-1",
    actorContext: actorContext({ actorRole: UserRole.MANAGER }),
    dependencies,
  });

  assert.equal(calls.preview, 1);
  assert.equal(view.draft?.id, "draft-1");
  assert.equal(view.draft?.version, 7);
  assert.equal(view.preview?.netDelta, 22);
  assert.equal(view.composition.source, "projected");
  assert.equal(view.composition.packageLines[0]?.orderPackageId, "draft:package-1");
  assert.equal(view.financialPreview.overlay.pendingDelta, 22);
  assert.equal(view.permissions.canUpdateOrderFinancial, true);
});

test("loader selects locked composition helper from current invoice state", async () => {
  const calls = callTracker();
  const dependencies = fakeDependencies({
    calls,
    workspace: workspaceFixture({
      invoice: {
        invoiceId: "invoice-final-1",
        invoiceNumber: "INV-1",
        invoiceType: InvoiceType.FINAL,
        invoiceStatus: InvoiceStatus.CLOSED,
        invoiceTotal: 100,
        paidAmount: 100,
        remainingAmount: 0,
        isLocked: true,
        issuedAt: null,
        paidAt: null,
        closedAt: null,
        depositPaidAmount: 0,
        depositInvoiceNumber: null,
        renderMode: "COMPUTED",
        lineItems: [],
      },
    }),
    draft: null,
    financialCase: activeFinancialCase({
      finalInvoice: {
        id: "invoice-final-1",
        invoiceNumber: "INV-1",
        invoiceType: InvoiceType.FINAL,
        total: 100,
        remaining: 0,
        status: InvoiceStatus.CLOSED,
        isLocked: true,
        depositPaidAmount: 0,
      },
      remaining: 0,
    }),
  });

  const view = await getSalesPageView({
    orderId: "order-1",
    actorContext: actorContext(),
    dependencies,
  });

  assert.equal(calls.lockedComposition, 1);
  assert.equal(calls.lockedInvoiceId, "invoice-final-1");
  assert.equal(calls.draftComposition, 0);
  assert.equal(view.isLocked, true);
});

test("loader keeps SalesPageView fields bound to their canonical sources", async () => {
  const financialCase = activeFinancialCase({
    financialCaseId: "financial-case-source",
    customerTotal: 901,
    remaining: 77,
  });
  const preview = previewFixture({ netDelta: 33 });
  const draft = draftState({
    version: 12,
    pendingSnapshot: snapshotFixture({
      netTotal: 456,
      lines: [packageLine({ label: "Source Draft Package", lineTotal: 456 })],
    }),
  });
  const dependencies = fakeDependencies({
    draft,
    preview,
    financialCase,
    currentComposition: currentCompositionFixture({
      packageName: "Source Current Package",
      netCompositionTotal: 123,
    }),
  });

  const view = await getSalesPageView({
    orderId: "order-1",
    actorContext: actorContext({ actorRole: UserRole.ACCOUNTANT }),
    dependencies,
  });

  assert.equal(view.order.customerName, "Customer Source");
  assert.equal(view.draft?.version, 12);
  assert.equal(view.composition.packageLines[0]?.packageName, "Source Draft Package");
  assert.equal(view.preview, preview);
  assert.equal(view.stagedChanges[0]?.netDelta, 33);
  assert.equal(view.financialCase, financialCase);
  assert.equal(view.financialPreview.baseline.customerTotal, 901);
  assert.equal(view.financialPreview.baseline.remaining, 77);
  assert.equal(view.permissions.actorRole, UserRole.ACCOUNTANT);
  assert.equal(view.permissions.canCreatePayment, true);
  assert.equal(view.permissions.canUpdateOrderFinancial, false);
});

function fakeDependencies(input: {
  calls?: ReturnType<typeof callTracker>;
  workspace?: POSWorkspace;
  currentComposition?: DraftPOSCompositionProjection;
  draft?: OrderCommitDraftState | null;
  preview?: OrderCommitPreview;
  financialCase?: FinancialCaseSummary;
} = {}): Partial<SalesPageViewLoaderDependencies> {
  const calls = input.calls ?? callTracker();
  return {
    getPOSWorkspace: async () => input.workspace ?? workspaceFixture(),
    getDraftOrderCompositionViewModel: async () => {
      calls.draftComposition += 1;
      return { marker: "draft-model" } as never;
    },
    getLockedOrderCompositionViewModel: async (args) => {
      calls.lockedComposition += 1;
      calls.lockedInvoiceId = args.invoiceId;
      return { marker: "locked-model" } as never;
    },
    toDraftPOSComposition: () =>
      input.currentComposition ?? currentCompositionFixture(),
    getOrderCommitDraft: async () => input.draft ?? null,
    getOrderCommitPreview: async () => {
      calls.preview += 1;
      return input.preview ?? previewFixture();
    },
    getFinancialCaseSummary: async () =>
      input.financialCase ?? activeFinancialCase(),
    hasPermission: (actor, permission) => {
      if (permission === "order:read") return true;
      if (permission === "payment:create") {
        return ["ADMIN", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"].includes(
          actor.role
        );
      }
      if (permission === "invoice:create") {
        return ["ADMIN", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"].includes(
          actor.role
        );
      }
      return ["ADMIN", "MANAGER"].includes(actor.role);
    },
  };
}

function callTracker() {
  return {
    preview: 0,
    getOrCreateDraft: 0,
    draftComposition: 0,
    lockedComposition: 0,
    lockedInvoiceId: null as string | null,
  };
}

function actorContext(
  overrides: Partial<ActorContext> = {}
): ActorContext {
  return {
    actorUserId: "actor-1",
    actorRole: UserRole.RECEPTIONIST,
    ...overrides,
  };
}

function workspaceFixture(
  overrides: Partial<POSWorkspace> = {}
): POSWorkspace {
  return {
    orderId: "order-1",
    jobNumber: "JOB-1",
    orderStatusRaw: OrderStatus.ACTIVE,
    orderStatus: "Active",
    selectionStatus: OrderSelectionStatus.WAITING_SELECTION,
    sessionDate: "June 2, 2026",
    customerName: "Customer Source",
    customerPhone: "+965 5555 0000",
    packageLines: [],
    packageItems: [],
    rawDeliverableTotal: 0,
    includedPhotoCount: 0,
    selectedPhotoCount: 0,
    extraPhotoCount: 0,
    extraPhotoTotal: 0,
    addOns: [],
    addOnTotal: 0,
    sessionConfigurationTotal: 0,
    productOptions: [],
    addOnCatalog: [],
    invoice: null,
    adjustmentInvoices: [],
    paidAdjustmentInvoices: [],
    aggregateOutstanding: 0,
    ...overrides,
  };
}

function currentCompositionFixture(
  overrides: Partial<DraftPOSCompositionProjection> & {
    packageName?: string;
    netCompositionTotal?: number;
  } = {}
): DraftPOSCompositionProjection {
  const netCompositionTotal = overrides.netCompositionTotal ?? 100;
  return {
    orderId: overrides.orderId ?? "order-1",
    jobNumber: overrides.jobNumber ?? "JOB-1",
    sourceState: overrides.sourceState ?? "draft",
    packageLines: overrides.packageLines ?? [
      {
        id: "package:current-package-1",
        orderPackageId: "current-package-1",
        packageId: "package-basic",
        packageName: overrides.packageName ?? "Current Package",
        packagePrice: netCompositionTotal,
        sessionTypeId: "session-type-1",
        sessionTypeName: "Portrait",
        includedPhotoCount: 10,
        selectedPhotoCount: 10,
        extraDigitalCount: 0,
        extraPrintCount: 0,
        extraPhotoCount: 0,
        extraDigitalUnitPrice: 0,
        extraPrintUnitPrice: 0,
        extraPhotoTotal: 0,
        packageSubtotal: netCompositionTotal,
        upgradeDelta: 0,
        packageItems: [],
      },
    ],
    addOns: [],
    sessionConfigurations: [],
    totals: overrides.totals ?? {
      packageBaseTotal: netCompositionTotal,
      packageUpgradeDeltaTotal: 0,
      deliverablesTotal: 0,
      addOnTotal: 0,
      extraPhotoTotal: 0,
      sessionConfigurationTotal: 0,
      netCompositionTotal,
    },
  };
}

function draftState(
  input: {
    version?: number;
    pendingSnapshot?: OrderCommitSnapshotV1;
  } = {}
): OrderCommitDraftState {
  return {
    draft: {
      id: "draft-1",
      orderId: "order-1",
      financialCaseId: "financial-case-1",
      baseCommitId: "commit-1",
      pendingSnapshotVersion: 1,
      version: input.version ?? 7,
      ownerUserId: "owner-1",
      openedByUserId: "owner-1",
      lastTouchedByUserId: "owner-1",
      createdAt: new Date("2026-06-02T10:00:00.000Z"),
      updatedAt: new Date("2026-06-02T10:30:00.000Z"),
    },
    pendingSnapshot:
      input.pendingSnapshot ??
      snapshotFixture({
        netTotal: 100,
        lines: [packageLine()],
      }),
    pendingOps: {
      schemaVersion: "order_commit_draft_pending_ops_v1",
      operations: [],
    },
  };
}

function snapshotFixture(input: {
  lines: OrderCommitSnapshotLineV1[];
  netTotal: number;
}): OrderCommitSnapshotV1 {
  return {
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-02T10:00:00.000Z",
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines: input.lines,
    totals: {
      subtotal: input.netTotal,
      discountTotal: 0,
      netTotal: input.netTotal,
    },
  };
}

function packageLine(
  input: Partial<OrderCommitSnapshotLineV1> = {}
): OrderCommitSnapshotLineV1 {
  return {
    lineId: "package:order-package-1",
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId: "order-package-1",
    parentOrderPackageId: null,
    catalogEntityId: "package-basic",
    stableKey: "order-package:order-package-1",
    label: "Basic Package",
    quantity: 1,
    unitPrice: 100,
    lineTotal: 100,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: { includedPhotoCount: 10, selectedPhotoCount: 10 },
    ...input,
  };
}

function previewFixture(
  input: Partial<OrderCommitPreview> = {}
): OrderCommitPreview {
  const netDelta = input.netDelta ?? 10;
  return {
    baselineSource: "LATEST_ORDER_COMMIT",
    baselineCommitId: "commit-1",
    baselineSequence: 1,
    draftId: "draft-1",
    draftVersion: 7,
    commitKind: "ADJUSTMENT_INVOICE",
    lineDiffs: input.lineDiffs ?? [
      {
        stableKey: "diff-1",
        lineId: "diff-1",
        lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
        changeKind: "PRICE_CHANGED",
        baselineLine: null,
        pendingLine: {
          stableKey: "diff-1",
          lineId: "diff-1",
          lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
          orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
          orderEntityId: "order-package-1",
          parentOrderPackageId: null,
          catalogEntityId: "package-basic",
          label: "Diff Package",
          quantity: 1,
          unitPrice: netDelta,
          lineTotal: netDelta,
          priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
          metadata: {},
        },
        quantityDelta: 0,
        moneyDelta: netDelta,
        operationalFlags: {
          isPackageChange: true,
          isPackageUpgrade: false,
          isPackageDowngrade: false,
          isPackageSwap: false,
          isAddOnChange: false,
          isPackageItemUpgradeChange: false,
          isPhotoChange: false,
          isSessionConfigurationChange: false,
          isLinkedProductChange: false,
          isFinanciallyRelevant: true,
          isOperationallyMeaningful: true,
        },
      },
    ],
    netDelta,
    requiresApproval: false,
    approvalReasons: [],
    documentPlan: {
      kind: ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ADJUSTMENT_INVOICE,
      amount: netDelta,
      requiresPaymentCollection: true,
      requiresRefundReview: false,
      reason: null,
    },
    paymentImpact: {
      kind: ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.PAYMENT_DUE,
      amountDue: netDelta,
      creditAmount: 0,
      alreadyPaidAmount: 0,
      remainingAfterCommit: netDelta,
    },
    refundImpact: {
      refundRequired: false,
      refundableAmount: 0,
      creditNoteAmount: 0,
      reason: null,
    },
    zeroNetReason: null,
    ...input,
  };
}

function activeFinancialCase(
  input: Partial<Extract<FinancialCaseSummary, { stage: "active" }>> = {}
): Extract<FinancialCaseSummary, { stage: "active" }> {
  return {
    stage: "active",
    financialCaseId: "financial-case-1",
    orderId: "order-1",
    bookingId: "booking-1",
    depositInvoice: null,
    finalInvoice: {
      id: "final-1",
      invoiceNumber: "INV-1",
      invoiceType: InvoiceType.FINAL,
      total: 100,
      remaining: 100,
      status: InvoiceStatus.ISSUED,
      isLocked: false,
      depositPaidAmount: 0,
    },
    finalizedAdjustments: [],
    creditNotes: [],
    refunds: [],
    customerTotal: 100,
    effectivePaid: 0,
    paidSoFar: 0,
    depositApplied: 0,
    remaining: 100,
    totalAdjustments: 0,
    finalTotal: 100,
    overpaymentCapacity: 0,
    creditNoteCapacity: 0,
    linkedDocuments: [],
    paymentStatusEnum: "UNPAID",
    ...input,
  };
}
