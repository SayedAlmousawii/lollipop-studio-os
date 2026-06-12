import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { join } from "node:path";
import test from "node:test";
import { OrderSelectionStatus, OrderStatus } from "@prisma/client";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { POSWorkspace } from "@/modules/orders/order.types";
import type {
  SalesPageComposition,
  SalesPageDraftOwnership,
  SalesPageDraftState,
  SalesPageFinancialPreview,
  SalesPagePreviewState,
  SalesPageStagedChangesRow,
} from "@/modules/order-commits/projections/sales-page-view.types";
import {
  ORDER_COMMIT_PREVIEW_COMMIT_KIND,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
  ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND,
} from "@/modules/order-commits/order-commit-preview.constants";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

type SalesRightColumnComponent = ComponentType<{
  workspace: POSWorkspace;
  composition: SalesPageComposition;
  financialPreview: SalesPageFinancialPreview;
  draft: SalesPageDraftState | null;
  preview: SalesPagePreviewState | null;
  stagedChanges: SalesPageStagedChangesRow[];
  ownership: SalesPageDraftOwnership;
}>;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
let paymentDialogPropsCapture:
  | Array<{
      targets?: Array<{ invoiceId: string }>;
      defaultTargetInvoiceId?: string;
    }>
  | undefined;
let stagedControlsPropsCapture:
  | Array<{
      draft: SalesPageDraftState | null;
      preview: SalesPagePreviewState | null;
      stagedChanges: SalesPageStagedChangesRow[];
      financialPreview: SalesPageFinancialPreview;
      ownership: SalesPageDraftOwnership;
    }>
  | undefined;

test("SalesRightColumn renders grouped receipt and draft financial summary", async () => {
  const SalesRightColumn = await loadSalesRightColumn();
  const markup = renderToStaticMarkup(
    createElement(SalesRightColumn, {
      workspace: workspaceFixture(),
      composition: compositionFixture({ source: "projected" }),
      financialPreview: financialPreviewFixture(),
      draft: draftFixture(),
      preview: previewFixture(),
      stagedChanges: stagedChangesFixture(),
      ownership: ownershipFixture(),
    })
  );

  assert.match(markup, /Order summary/);
  assert.match(markup, /Preview/);
  assert.match(markup, /Signature Family/);
  assert.match(markup, /Extra digital photos/);
  assert.match(markup, /VIP album/);
  assert.match(markup, /Order-level add-ons/);
  assert.match(markup, /Wall frame/);
  assert.match(markup, /368.000 KD/);
  assert.doesNotMatch(markup, /Cake theme/);
  assert.doesNotMatch(markup, /Deposit/);
  assert.doesNotMatch(markup, /Remaining due/);

  assert.match(markup, /Financial summary/);
  assert.match(markup, /Previous total/);
  assert.match(markup, /After commit/);
  assert.match(markup, /Pending diff/);
  assert.match(markup, /Due after commit/);
  assert.match(markup, /Draft/);
  assert.match(markup, /Review &amp; commit/);
  assert.match(markup, /Discard draft/);
});

test("SalesRightColumn renders clean financial rows and record payment target", async () => {
  const paymentDialogProps: Array<{
    targets?: Array<{ invoiceId: string }>;
    defaultTargetInvoiceId?: string;
  }> = [];
  paymentDialogPropsCapture = paymentDialogProps;
  const SalesRightColumn = await loadSalesRightColumn();
  const adjustmentInvoice = invoiceFixture({
    invoiceId: "adjustment-1",
    invoiceNumber: "ADJ-1",
    invoiceType: "ADJUSTMENT",
    remainingAmount: 42,
    invoiceTotal: 42,
  });

  const markup = renderToStaticMarkup(
    createElement(SalesRightColumn, {
      workspace: workspaceFixture({
        remainingAmount: 0,
        adjustmentInvoices: [adjustmentInvoice],
      }),
      composition: compositionFixture({ source: "current" }),
      financialPreview: financialPreviewFixture({
        collectPaymentTargetInvoiceId: "adjustment-1",
        settlement: {
          mode: "clean",
          financialCaseId: "financial-case-1",
          netCustomerTotal: 321,
          cashPaid: 140,
          remainingDue: 181,
          availableCredit: 12,
          refundable: 12,
        },
      }),
      draft: null,
      preview: null,
      stagedChanges: [],
      ownership: ownershipFixture({ hasDraft: false }),
    })
  );

  assert.match(markup, /Current/);
  assert.match(markup, /No changes to commit/);
  assert.match(markup, /Record payment/);
  assert.match(markup, /Total/);
  assert.match(markup, /Paid/);
  assert.match(markup, /Remaining/);
  assert.match(markup, /Available credit/);
  assert.match(markup, /Refundable/);
  assert.doesNotMatch(markup, /Previous total/);
  assert.equal(paymentDialogProps[0]?.defaultTargetInvoiceId, "adjustment-1");
  assert.deepEqual(
    paymentDialogProps[0]?.targets?.map((target) => target.invoiceId),
    ["adjustment-1"]
  );
  paymentDialogPropsCapture = undefined;
});

test("SalesRightColumn clean state does not recreate invoice creation surface", async () => {
  const SalesRightColumn = await loadSalesRightColumn();
  const markup = renderToStaticMarkup(
    createElement(SalesRightColumn, {
      workspace: workspaceFixture({ invoice: null, remainingAmount: 0 }),
      composition: compositionFixture({ source: "current" }),
      financialPreview: financialPreviewFixture({
        collectPaymentTargetInvoiceId: null,
        isFullySettled: true,
      }),
      draft: null,
      preview: null,
      stagedChanges: [],
      ownership: ownershipFixture({ hasDraft: false }),
    })
  );

  assert.match(markup, /No changes to commit/);
  assert.match(markup, /No payment target is open/);
  assert.doesNotMatch(markup, /Create Invoice/);
  assert.doesNotMatch(markup, /Financial Case/);
  assert.doesNotMatch(markup, /Reference #/);
  assert.doesNotMatch(markup, /Document plan/);
  assert.doesNotMatch(markup, /Payment impact/);
  assert.doesNotMatch(markup, /Refund impact/);
});

test("SalesRightColumn forwards draft commit props unchanged", async () => {
  const stagedControlsProps: Array<{
    draft: SalesPageDraftState | null;
    preview: SalesPagePreviewState | null;
    stagedChanges: SalesPageStagedChangesRow[];
    financialPreview: SalesPageFinancialPreview;
    ownership: SalesPageDraftOwnership;
  }> = [];
  stagedControlsPropsCapture = stagedControlsProps;
  const SalesRightColumn = await loadSalesRightColumn();
  const draft = draftFixture();
  const preview = previewFixture();
  const stagedChanges = stagedChangesFixture();
  const financialPreview = financialPreviewFixture();
  const ownership = ownershipFixture();

  renderToStaticMarkup(
    createElement(SalesRightColumn, {
      workspace: workspaceFixture(),
      composition: compositionFixture({ source: "projected" }),
      financialPreview,
      draft,
      preview,
      stagedChanges,
      ownership,
    })
  );

  assert.equal(stagedControlsProps[0]?.draft, draft);
  assert.equal(stagedControlsProps[0]?.preview, preview);
  assert.equal(stagedControlsProps[0]?.stagedChanges, stagedChanges);
  assert.equal(stagedControlsProps[0]?.financialPreview, financialPreview);
  assert.equal(stagedControlsProps[0]?.ownership, ownership);
  stagedControlsPropsCapture = undefined;
});

test("SalesRightColumn source stays display-only and service-free", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "app/(app)/orders/[orderId]/sales/sales-right-column.tsx"
    ),
    "utf8"
  );

  assert.doesNotMatch(source, /@\/lib\/db/);
  assert.doesNotMatch(source, /commitOrderChanges/);
  assert.doesNotMatch(source, /CreateOrderInvoiceForm|Create Invoice/);
  assert.doesNotMatch(source, /financialCaseId/);
  assert.doesNotMatch(source, /documentPlan|paymentImpact|refundImpact/);
  assert.doesNotMatch(source, /lineDiffs/);
  assert.doesNotMatch(source, /stagedChanges\.[a-zA-Z]+\([^)]*=>[^)]*[-+*/]/s);
  assert.doesNotMatch(source, /row\.netDelta\s*[-+*/]/);
  assert.doesNotMatch(source, /[-+*/]\s*row\.netDelta/);
  assert.doesNotMatch(source, /previousTotal\s*[-+*/]/);
  assert.doesNotMatch(source, /pendingDelta\s*[-+*/]/);
  assert.doesNotMatch(source, /pendingTotal\s*[-+*/]/);
});

async function loadSalesRightColumn(): Promise<SalesRightColumnComponent> {
  const originalModuleLoad = moduleWithLoader._load;
  moduleWithLoader._load = function loadWithActionStubs(request, parent, isMain) {
    if (request === "./sales-page.module.css") {
      return {
        rightColumn: "rightColumn",
        receiptCard: "receiptCard",
        receiptList: "receiptList",
      };
    }
    if (request === "@/components/orders/pos-record-payment-dialog") {
      return {
        POSRecordPaymentDialog: (props: {
          trigger?: unknown;
          targets?: Array<{ invoiceId: string }>;
          defaultTargetInvoiceId?: string;
        }) => {
          paymentDialogPropsCapture?.push(props);
          return createElement("button", null, "Record payment");
        },
      };
    }
    if (request === "@/components/orders/sales-staged-commit-controls") {
      return {
        SalesStagedCommitControls: (props: {
          draft: SalesPageDraftState | null;
          preview: SalesPagePreviewState | null;
          stagedChanges: SalesPageStagedChangesRow[];
          financialPreview: SalesPageFinancialPreview;
          ownership: SalesPageDraftOwnership;
        }) => {
          stagedControlsPropsCapture?.push(props);
          return createElement(
            "section",
            null,
            createElement("button", null, "Review & commit"),
            createElement("button", null, "Discard draft")
          );
        },
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const rightColumnModule = await import(
      "../../../app/(app)/orders/[orderId]/sales/sales-right-column.tsx"
    );
    return rightColumnModule.SalesRightColumn;
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
}

function compositionFixture(input: {
  source: SalesPageComposition["source"];
}): SalesPageComposition {
  return {
    orderId: "order-1",
    jobNumber: "JOB-1",
    sourceState: "draft",
    source: input.source,
    packageLines: [
      {
        id: "line-package-1",
        orderPackageId: "package-1",
        packageId: "catalog-package-1",
        packageName: "Signature Family",
        packagePrice: 250,
        sessionTypeId: "session-type-1",
        sessionTypeName: "Family",
        includedPhotoCount: 10,
        selectedPhotoCount: 13,
        extraDigitalCount: 2,
        extraPrintCount: 1,
        extraPhotoCount: 3,
        extraDigitalUnitPrice: 12,
        extraPrintUnitPrice: 14,
        extraPhotoTotal: 38,
        packageSubtotal: 308,
        upgradeDelta: 20,
        packageItems: [],
      },
    ],
    addOns: [
      {
        id: "addon-package-album",
        orderAddOnId: "addon-package-album",
        orderPackageId: "package-1",
        productId: "product-album",
        name: "VIP album",
        quantity: 1,
        unitAmount: 30,
        totalAmount: 30,
      },
      {
        id: "addon-order-frame",
        orderAddOnId: "addon-order-frame",
        orderPackageId: null,
        productId: "product-frame",
        name: "Wall frame",
        quantity: 1,
        unitAmount: 30,
        totalAmount: 30,
      },
    ],
    sessionConfigurations: [
      {
        id: "config-cake",
        orderPackageId: "package-1",
        configurationId: "config-1",
        label: "Cake theme",
        optionLabel: "Vanilla",
        numericValue: null,
        textValue: null,
        priceDelta: 0,
      },
    ],
    totals: {
      packageBaseTotal: 250,
      packageUpgradeDeltaTotal: 20,
      deliverablesTotal: 0,
      addOnTotal: 60,
      extraPhotoTotal: 38,
      sessionConfigurationTotal: 0,
      netCompositionTotal: 368,
    },
  };
}

function financialPreviewFixture(
  input: Partial<SalesPageFinancialPreview> = {}
): SalesPageFinancialPreview {
  return {
    stage: input.stage ?? "active",
    financialCaseId: input.financialCaseId ?? "financial-case-1",
    settlement: input.settlement ?? {
      mode: "draft",
      financialCaseId: "financial-case-1",
      netCustomerTotal: 321,
      cashPaid: 140,
      remainingDue: 181,
      previousTotal: 100,
      pendingDelta: 44,
      afterCommitTotal: 144,
      amountDueAfterCommit: 44,
    },
    isFullySettled: input.isFullySettled ?? false,
    paymentStatusEnum: input.paymentStatusEnum ?? "PARTIAL",
    collectPaymentTargetInvoiceId:
      input.collectPaymentTargetInvoiceId === undefined
        ? "final-1"
        : input.collectPaymentTargetInvoiceId,
  };
}

function draftFixture(): SalesPageDraftState {
  return {
    id: "draft-1",
    version: 2,
    ownerUserId: "user-1",
    openedByUserId: "user-1",
    lastTouchedByUserId: "user-1",
    updatedAt: new Date("2026-06-12T12:00:00.000Z"),
    baseCommitId: "commit-1",
  };
}

function ownershipFixture(
  input: Partial<SalesPageDraftOwnership> = {}
): SalesPageDraftOwnership {
  return {
    mode: input.mode ?? (input.hasDraft === false ? "none" : "owner"),
    hasDraft: input.hasDraft ?? true,
    isOwner: input.isOwner ?? input.hasDraft !== false,
    isManagerOverride: input.isManagerOverride ?? false,
    canStage: input.canStage ?? true,
    canDiscard: input.canDiscard ?? true,
    canCommit: input.canCommit ?? true,
    ownerUserId: input.ownerUserId ?? "user-1",
    openedByUserId: input.openedByUserId ?? "user-1",
    lastTouchedByUserId: input.lastTouchedByUserId ?? "user-1",
    updatedAt: input.updatedAt ?? new Date("2026-06-12T12:00:00.000Z"),
    banner: input.banner ?? null,
  };
}

function stagedChangesFixture(): SalesPageStagedChangesRow[] {
  return [
    {
      id: "change-1",
      changeKind: "ADDED",
      label: "VIP album",
      netDelta: 30,
      parentLabel: "Signature Family",
    },
  ];
}

function previewFixture(): SalesPagePreviewState {
  return {
    baselineSource: "LATEST_ORDER_COMMIT",
    baselineCommitId: "commit-1",
    baselineSequence: 1,
    draftId: "draft-1",
    draftVersion: 2,
    commitKind: ORDER_COMMIT_PREVIEW_COMMIT_KIND.ADJUSTMENT_INVOICE,
    lineDiffs: [],
    netDelta: 44,
    totals: {
      baselineTotal: 100,
      netDelta: 44,
      pendingTotal: 144,
    },
    requiresApproval: false,
    approvalReasons: [],
    documentPlan: {
      kind: ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ADJUSTMENT_INVOICE,
      amount: 44,
      requiresPaymentCollection: true,
      requiresRefundReview: false,
      reason: null,
    },
    paymentImpact: {
      kind: ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.PAYMENT_DUE,
      amountDue: 44,
      creditAmount: 0,
      alreadyPaidAmount: 125,
      remainingAfterCommit: 44,
    },
    refundImpact: {
      refundRequired: false,
      refundableAmount: 0,
      creditNoteAmount: 0,
      reason: null,
    },
    zeroNetReason: null,
  };
}

function workspaceFixture(
  input: {
    invoice?: POSWorkspace["invoice"];
    remainingAmount?: number;
    adjustmentInvoices?: POSWorkspace["adjustmentInvoices"];
  } = {}
): POSWorkspace {
  const invoice =
    input.invoice === undefined
      ? invoiceFixture({
          invoiceId: "final-1",
          remainingAmount: input.remainingAmount ?? 176,
        })
      : input.invoice;

  return {
    orderId: "order-1",
    jobNumber: "JOB-1",
    orderStatusRaw: OrderStatus.WAITING_SELECTION,
    orderStatus: "Waiting Selection",
    selectionStatus: OrderSelectionStatus.PENDING,
    sessionDate: "2026-05-19",
    customerName: "Customer",
    customerPhone: "+96500000000",
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
    invoice,
    adjustmentInvoices: input.adjustmentInvoices ?? [],
    paidAdjustmentInvoices: [],
    aggregateOutstanding: input.remainingAmount ?? 176,
  } as POSWorkspace;
}

function invoiceFixture(
  input: Partial<NonNullable<POSWorkspace["invoice"]>> = {}
): NonNullable<POSWorkspace["invoice"]> {
  return {
    invoiceId: input.invoiceId ?? "invoice-1",
    financialCaseId: input.financialCaseId ?? "financial-case-1",
    invoiceNumber: input.invoiceNumber ?? "INV-1",
    invoiceType: input.invoiceType ?? "FINAL",
    invoiceStatus: input.invoiceStatus ?? "Issued",
    isLocked: input.isLocked ?? false,
    renderMode: input.renderMode ?? "COMPUTED",
    packageBaseTotal: input.packageBaseTotal ?? 300,
    bundleAdjustment: input.bundleAdjustment ?? 0,
    addOnTotal: input.addOnTotal ?? 0,
    extraPhotoTotal: input.extraPhotoTotal ?? 0,
    invoiceTotal: input.invoiceTotal ?? 300,
    paidAmount: input.paidAmount ?? 125,
    depositInvoiceNumber: input.depositInvoiceNumber ?? "DEP-1",
    depositPaidAmount: input.depositPaidAmount ?? 50,
    remainingAmount: input.remainingAmount ?? 176,
    lineItems: input.lineItems ?? [],
  };
}
