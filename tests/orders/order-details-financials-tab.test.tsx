import assert from "node:assert/strict";
import test from "node:test";
import {
  InvoiceStatus,
  InvoiceType,
  OrderSelectionStatus,
  OrderStatus,
} from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatKD } from "@/components/financial";
import { OrderDetailsFinancialsTab } from "@/components/financial/order-details-financials-tab";
import { OrderSettlementSummary } from "@/components/orders/order-settlement-summary";
import type {
  FinancialTabBlockProjection,
  OrderHeaderFinancialProjection,
} from "@/modules/financial-cases";
import type {
  LinkedFinancialDocument,
  POSWorkspace,
} from "@/modules/orders/order.types";

const FIXTURE_INVOICE_DATA = [
  { invoiceType: InvoiceType.DEPOSIT, invoiceTotal: 20, remainingAmount: 0 },
  { invoiceType: InvoiceType.FINAL, invoiceTotal: 230, remainingAmount: 0 },
  { invoiceType: InvoiceType.ADJUSTMENT, invoiceTotal: 40, remainingAmount: 20 },
  { invoiceType: InvoiceType.REFUND, invoiceTotal: 10, remainingAmount: 0 },
  { invoiceType: InvoiceType.CREDIT_NOTE, invoiceTotal: 5, remainingAmount: 0 },
] as const;

test("OrderDetailsFinancialsTab renders all linked documents in canonical order", () => {
  const summary = financialSummaryFixture();
  const markup = renderToStaticMarkup(
    createElement(OrderDetailsFinancialsTab, {
      workspace: workspaceFixture(),
      linkedDocuments: linkedDocumentsFixture(),
      summary,
    })
  );

  assertInOrder(markup, [
    "Payment Summary",
    "Total Source",
    "Linked Financial Documents",
    "Price Breakdown",
  ]);
  assert.match(markup, /INV-DEP/);
  assert.match(markup, /INV-FINAL/);
  assert.match(markup, /INV-ADJ/);
  assert.match(markup, /INV-REFUND/);
  assert.match(markup, /INV-CREDIT/);
});

test("OrderDetailsFinancialsTab displays summary values from projector-shaped data", () => {
  const summary = financialSummaryFixture();
  const markup = renderToStaticMarkup(
    createElement(OrderDetailsFinancialsTab, {
      workspace: workspaceFixture(),
      linkedDocuments: linkedDocumentsFixture(),
      summary,
    })
  );

  assert.match(markup, new RegExp(`Customer Total[\\s\\S]*${formatKD(summary.customerTotal)}`));
  assert.match(markup, new RegExp(`Paid So Far[\\s\\S]*${formatKD(summary.paidSoFar)}`));
  assert.match(markup, new RegExp(`Remaining[\\s\\S]*${formatKD(summary.remaining)}`));
});

test("OrderDetailsFinancialsTab is read-only", () => {
  const markup = renderToStaticMarkup(
    createElement(OrderDetailsFinancialsTab, {
      workspace: workspaceFixture(),
      linkedDocuments: linkedDocumentsFixture(),
      summary: financialSummaryFixture(),
    })
  );

  assert.doesNotMatch(markup, /Record Payment/);
  assert.doesNotMatch(markup, /Open Adjustment Workspace/);
  assert.doesNotMatch(markup, /Take Over/);
});

test("Order settlement header renders projector-shaped financial data", () => {
  const summary = financialSummaryFixture();
  const headerSummary: OrderHeaderFinancialProjection = {
    totalOrderValue: summary.customerTotal,
    paidAmount: summary.paidSoFar,
    outstandingAmount: summary.remaining,
    refundedAmount: 10,
    hasOverpayment: false,
    paymentStatusEnum: "PARTIAL",
  };
  const markup = renderToStaticMarkup(
    createElement(OrderSettlementSummary, { summary: headerSummary })
  );

  assert.match(markup, new RegExp(`${formatKD(summary.remaining)} outstanding`));
  assert.match(markup, /Partially paid/);
});

function financialSummaryFixture(): FinancialTabBlockProjection {
  return {
    customerTotal: 270,
    paidSoFar: 250,
    includesDeposit: 20,
    remaining: 20,
    finalInvoiceTotal: 230,
    totalAdjustments: 40,
    finalTotal: 270,
  };
}

function workspaceFixture(): POSWorkspace {
  return {
    orderId: "order-1",
    jobNumber: "JOB-1",
    orderStatusRaw: OrderStatus.SELECTION_COMPLETED,
    orderStatus: "Selection Completed",
    selectionStatus: OrderSelectionStatus.COMPLETED,
    sessionDate: "2026-05-17",
    customerName: "Test Customer",
    customerPhone: "55500000",
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
    invoice: {
      invoiceId: "invoice-final",
      financialCaseId: "case-1",
      invoiceNumber: "INV-FINAL",
      invoiceType: "FINAL",
      invoiceStatus: "Closed",
      isLocked: true,
      renderMode: "SNAPSHOT",
      packageBaseTotal: 250,
      bundleAdjustment: 0,
      addOnTotal: 0,
      extraPhotoTotal: 0,
      invoiceTotal: 230,
      paidAmount: 230,
      depositInvoiceNumber: "INV-DEP",
      depositPaidAmount: 20,
      remainingAmount: 0,
      lineItems: [
        {
          id: "line-1",
          lineType: "Package",
          description: "Album 30x30",
          quantity: 1,
          unitPriceLabel: "250.000 KD",
          lineTotalLabel: "250.000 KD",
        },
      ],
    },
    adjustmentInvoices: [],
    paidAdjustmentInvoices: [
      {
        invoiceId: "invoice-adj",
        financialCaseId: "case-1",
        invoiceNumber: "INV-ADJ",
        invoiceType: "ADJUSTMENT",
        invoiceStatus: "Partial",
        isLocked: true,
        renderMode: "SNAPSHOT",
        packageBaseTotal: 0,
        bundleAdjustment: 0,
        addOnTotal: 0,
        extraPhotoTotal: 0,
        invoiceTotal: 40,
        paidAmount: 20,
        depositInvoiceNumber: null,
        depositPaidAmount: 0,
        remainingAmount: 20,
        lineItems: [],
      },
    ],
    aggregateOutstanding: 20,
  };
}

function linkedDocumentsFixture(): LinkedFinancialDocument[] {
  return [
    document("invoice-dep", "INV-DEP", fixtureInvoice(InvoiceType.DEPOSIT)),
    document("invoice-final", "INV-FINAL", fixtureInvoice(InvoiceType.FINAL)),
    document("invoice-adj", "INV-ADJ", fixtureInvoice(InvoiceType.ADJUSTMENT)),
    document("invoice-refund", "INV-REFUND", fixtureInvoice(InvoiceType.REFUND)),
    document(
      "invoice-credit",
      "INV-CREDIT",
      fixtureInvoice(InvoiceType.CREDIT_NOTE)
    ),
  ];
}

function document(
  invoiceId: string,
  invoiceNumber: string,
  fixture: (typeof FIXTURE_INVOICE_DATA)[number]
): LinkedFinancialDocument {
  return {
    invoiceId,
    invoiceNumber,
    invoiceType: fixture.invoiceType,
    invoiceStatus:
      fixture.remainingAmount > 0 ? InvoiceStatus.PARTIAL : InvoiceStatus.CLOSED,
    invoiceTotal: fixture.invoiceTotal,
    paidAmount: fixture.invoiceTotal - fixture.remainingAmount,
    remainingAmount: fixture.remainingAmount,
    issuedAt: new Date("2026-05-17T10:00:00.000Z"),
    createdAt: new Date("2026-05-17T10:00:00.000Z"),
  };
}

function assertInOrder(markup: string, labels: string[]) {
  let previousIndex = -1;
  for (const label of labels) {
    const index = markup.indexOf(label);
    assert.ok(index > previousIndex, `${label} should appear after the previous section`);
    previousIndex = index;
  }
}

function fixtureInvoice(invoiceType: InvoiceType) {
  const fixture = FIXTURE_INVOICE_DATA.find(
    (candidate) => candidate.invoiceType === invoiceType
  );
  assert.ok(fixture, `Missing fixture invoice for ${invoiceType}`);
  return fixture;
}
