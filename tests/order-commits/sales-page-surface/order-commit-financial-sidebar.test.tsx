import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { join } from "node:path";
import test from "node:test";
import { InvoiceStatus, InvoiceType, OrderSelectionStatus, OrderStatus } from "@prisma/client";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FinancialCaseSummary } from "@/modules/financial-cases/financial-case-summary.types";
import type {
  SalesPageFinancialPreview,
  SalesPagePreviewState,
} from "@/modules/order-commits/projections/sales-page-view.types";
import {
  ORDER_COMMIT_PREVIEW_COMMIT_KIND,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
  ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND,
} from "@/modules/order-commits/order-commit-preview.constants";
import type { POSWorkspace } from "@/modules/orders/order.types";
import {
  buildPOSFinancialSidebarEditPolicies,
  orderEditModeContextFromWorkspace,
  type POSFinancialSidebarEditPolicies,
} from "@/modules/orders/policies/edit-mode-policy";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

type OrderCommitFinancialSidebarComponent = ComponentType<{
  workspace: POSWorkspace;
  financialPreview: SalesPageFinancialPreview;
  financialCase: FinancialCaseSummary;
  preview: SalesPagePreviewState | null;
  editPolicies: POSFinancialSidebarEditPolicies;
}>;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
let paymentDialogPropsCapture:
  | Array<{
      targets?: Array<{ invoiceId: string }>;
      defaultTargetInvoiceId?: string;
    }>
  | undefined;

test("OrderCommitFinancialSidebar renders canonical receipt and draft fields", async () => {
  const OrderCommitFinancialSidebar = await loadOrderCommitFinancialSidebar();
  const workspace = workspaceFixture();
  const financialPreview = financialPreviewFixture();
  const markup = renderToStaticMarkup(
    createElement(OrderCommitFinancialSidebar, {
      workspace,
      financialPreview,
      financialCase: activeFinancialCase(),
      preview: previewFixture(),
      editPolicies: financialPolicies(workspace),
    })
  );

  assert.match(markup, /Financial Preview/);
  assert.match(markup, /Receipt/);
  assert.match(markup, /Order total \(net\)/);
  assert.match(markup, /321.000 KD/);
  assert.match(markup, /Cash paid/);
  assert.match(markup, /140.000 KD/);
  assert.match(markup, /Remaining due/);
  assert.match(markup, /181.000 KD/);
  assert.match(markup, /Previous total/);
  assert.match(markup, /100.000 KD/);
  assert.match(markup, /Pending delta/);
  assert.match(markup, /44.000 KD/);
  assert.match(markup, /After commit/);
  assert.match(markup, /144.000 KD/);
  assert.match(markup, /Amount due after commit/);
  assert.doesNotMatch(markup, /Customer total/);
  assert.doesNotMatch(markup, /Paid so far/);
  assert.doesNotMatch(markup, /Effective paid/);
  assert.doesNotMatch(markup, /Document plan/);
});

test("OrderCommitFinancialSidebar renders in-credit split as a positive receipt line", async () => {
  const OrderCommitFinancialSidebar = await loadOrderCommitFinancialSidebar();
  const workspace = workspaceFixture();
  const financialPreview = financialPreviewFixture({
    settlement: {
      mode: "clean",
      financialCaseId: "financial-case-1",
      netCustomerTotal: 150,
      cashPaid: 200,
      remainingDue: 0,
      availableCredit: 50,
      refundable: 50,
    },
  });

  const markup = renderToStaticMarkup(
    createElement(OrderCommitFinancialSidebar, {
      workspace,
      financialPreview,
      financialCase: activeFinancialCase(),
      preview: previewFixture(),
      editPolicies: financialPolicies(workspace),
    })
  );

  assert.match(markup, /Remaining due/);
  assert.match(markup, /0.000 KD/);
  assert.match(markup, /Available credit \/ refundable/);
  assert.match(markup, /50.000 KD/);
  assert.doesNotMatch(markup, /-50.000 KD/);
});

test("OrderCommitFinancialSidebar keeps clean state receipt-only", async () => {
  const OrderCommitFinancialSidebar = await loadOrderCommitFinancialSidebar();
  const workspace = workspaceFixture();
  const financialPreview = financialPreviewFixture({
    settlement: {
      mode: "clean",
      financialCaseId: "financial-case-1",
      netCustomerTotal: 321,
      cashPaid: 140,
      remainingDue: 181,
    },
  });

  const markup = renderToStaticMarkup(
    createElement(OrderCommitFinancialSidebar, {
      workspace,
      financialPreview,
      financialCase: activeFinancialCase(),
      preview: null,
      editPolicies: financialPolicies(workspace),
    })
  );

  assert.match(markup, /Order total \(net\)/);
  assert.doesNotMatch(markup, /Previous total/);
  assert.doesNotMatch(markup, /Document plan/);
  assert.doesNotMatch(markup, /Payment impact/);
  assert.doesNotMatch(markup, /Refund impact/);
});

test("OrderCommitFinancialSidebar preserves single-target invoice affordance behavior", async () => {
  const OrderCommitFinancialSidebar = await loadOrderCommitFinancialSidebar();
  const payableWorkspace = workspaceFixture({
    remainingAmount: 55,
  });
  const paidWorkspace = workspaceFixture({
    remainingAmount: 0,
  });
  const noInvoiceWorkspace = workspaceFixture({
    invoice: null,
  });
  const fullySettledPreview = financialPreviewFixture({
    isFullySettled: true,
    collectPaymentTargetInvoiceId: null,
  });

  const payableMarkup = renderToStaticMarkup(
    createElement(OrderCommitFinancialSidebar, {
      workspace: payableWorkspace,
      financialPreview: financialPreviewFixture(),
      financialCase: activeFinancialCase(),
      preview: previewFixture(),
      editPolicies: financialPolicies(payableWorkspace),
    })
  );
  const paidMarkup = renderToStaticMarkup(
    createElement(OrderCommitFinancialSidebar, {
      workspace: paidWorkspace,
      financialPreview: fullySettledPreview,
      financialCase: activeFinancialCase(),
      preview: previewFixture(),
      editPolicies: financialPolicies(paidWorkspace),
    })
  );
  const noInvoiceMarkup = renderToStaticMarkup(
    createElement(OrderCommitFinancialSidebar, {
      workspace: noInvoiceWorkspace,
      financialPreview: financialPreviewFixture(),
      financialCase: activeFinancialCase(),
      preview: previewFixture(),
      editPolicies: financialPolicies(noInvoiceWorkspace),
    })
  );

  assert.match(payableMarkup, /Record Payment/);
  assert.match(paidMarkup, /Fully Paid/);
  assert.match(noInvoiceMarkup, /Create Invoice/);
});

test("OrderCommitFinancialSidebar targets open adjustments without rendering accounting documents", async () => {
  const paymentDialogProps: Array<{
    targets?: Array<{ invoiceId: string }>;
    defaultTargetInvoiceId?: string;
  }> = [];
  paymentDialogPropsCapture = paymentDialogProps;
  const OrderCommitFinancialSidebar = await loadOrderCommitFinancialSidebar();
  const adjustmentInvoice = invoiceFixture({
    invoiceId: "adjustment-1",
    invoiceNumber: "ADJ-1",
    invoiceType: "ADJUSTMENT",
    invoiceStatus: "Issued",
    invoiceTotal: 42,
    remainingAmount: 42,
  });
  const workspace = workspaceFixture({
    remainingAmount: 0,
    adjustmentInvoices: [adjustmentInvoice],
  });
  const financialPreview = financialPreviewFixture({
    isFullySettled: false,
    collectPaymentTargetInvoiceId: "adjustment-1",
  });

  const markup = renderToStaticMarkup(
    createElement(OrderCommitFinancialSidebar, {
      workspace,
      financialPreview,
      financialCase: activeFinancialCase(),
      preview: previewFixture(),
      editPolicies: financialPolicies(workspace),
    })
  );

  assert.match(markup, /Partial/);
  assert.match(markup, /Reference #INV-1/);
  assert.doesNotMatch(markup, /Adjustments/);
  assert.doesNotMatch(markup, /ADJ-1/);
  assert.doesNotMatch(markup, /Credit notes/);
  assert.doesNotMatch(markup, /CN-1/);
  assert.doesNotMatch(markup, /Refunds/);
  assert.doesNotMatch(markup, /REF-1/);
  assert.doesNotMatch(markup, /Fully Paid/);
  assert.equal(paymentDialogProps[0]?.defaultTargetInvoiceId, "adjustment-1");
  assert.deepEqual(
    paymentDialogProps[0]?.targets?.map((target) => target.invoiceId),
    ["adjustment-1"]
  );
  paymentDialogPropsCapture = undefined;
});

test("OrderCommitFinancialSidebar source stays receipt-only and service-free", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/orders/order-commit-financial-sidebar.tsx"),
    "utf8"
  );

  assert.doesNotMatch(source, /@\/lib\/db/);
  assert.doesNotMatch(source, /formatSignedMoney/);
  assert.doesNotMatch(source, /customerTotal/);
  assert.doesNotMatch(source, /paidSoFar/);
  assert.doesNotMatch(source, /effectivePaid/);
  assert.doesNotMatch(source, /outstandingAmount/);
  assert.doesNotMatch(source, /totalAdjustments/);
  assert.doesNotMatch(source, /remainingAfterCommit/);
  assert.doesNotMatch(source, /documentPlan|paymentImpact|refundImpact/);
});

async function loadOrderCommitFinancialSidebar(): Promise<OrderCommitFinancialSidebarComponent> {
  const originalModuleLoad = moduleWithLoader._load;
  moduleWithLoader._load = function loadWithActionStubs(request, parent, isMain) {
    if (request === "@/components/orders/create-order-invoice-form") {
      return {
        CreateOrderInvoiceForm: () => createElement("button", null, "Create Invoice"),
      };
    }
    if (request === "@/components/orders/pos-record-payment-dialog") {
      return {
        POSRecordPaymentDialog: (props: {
          targets?: Array<{ invoiceId: string }>;
          defaultTargetInvoiceId?: string;
        }) => {
          paymentDialogPropsCapture?.push(props);
          return createElement("button", null, "Record Payment");
        },
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const sidebarModule = await import(
      "../../../src/components/orders/order-commit-financial-sidebar.tsx"
    );
    return sidebarModule.OrderCommitFinancialSidebar;
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
}

function financialPolicies(workspace: POSWorkspace): POSFinancialSidebarEditPolicies {
  return buildPOSFinancialSidebarEditPolicies(
    orderEditModeContextFromWorkspace({
      orderId: workspace.orderId,
      orderStatus: workspace.orderStatusRaw,
      finalInvoiceIsLocked: workspace.invoice?.isLocked ?? false,
      persistenceContext: "sales",
    })
  );
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

function activeFinancialCase(): Extract<FinancialCaseSummary, { stage: "active" }> {
  return {
    stage: "active",
    financialCaseId: "financial-case-1",
    orderId: "order-1",
    bookingId: "booking-1",
    depositInvoice: {
      id: "deposit-1",
      invoiceNumber: "DEP-1",
      total: 50,
      status: InvoiceStatus.PAID,
      isLocked: true,
      paidAmount: 50,
    },
    finalInvoice: {
      id: "final-1",
      invoiceNumber: "INV-1",
      invoiceType: InvoiceType.FINAL,
      total: 300,
      remaining: 176,
      status: InvoiceStatus.ISSUED,
      isLocked: false,
      depositPaidAmount: 50,
    },
    finalizedAdjustments: [],
    creditNotes: [],
    refunds: [],
    customerTotal: 321,
    effectivePaid: 140,
    paidSoFar: 125,
    depositApplied: 50,
    remaining: 176,
    totalAdjustments: 0,
    finalTotal: 300,
    overpaymentCapacity: 0,
    creditNoteCapacity: 0,
    availableCaseCredit: 0,
    linkedDocuments: [],
    paymentStatusEnum: "PARTIAL",
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
      ? {
          invoiceId: "final-1",
          financialCaseId: "financial-case-1",
          invoiceNumber: "INV-1",
          invoiceType: "FINAL",
          invoiceStatus: "Issued",
          isLocked: false,
          renderMode: "COMPUTED",
          packageBaseTotal: 300,
          bundleAdjustment: 0,
          addOnTotal: 0,
          extraPhotoTotal: 0,
          invoiceTotal: 300,
          paidAmount: 125,
          depositInvoiceNumber: "DEP-1",
          depositPaidAmount: 50,
          remainingAmount: input.remainingAmount ?? 176,
          lineItems: [],
        }
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
