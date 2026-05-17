import assert from "node:assert/strict";
import test from "node:test";
import {
  InvoiceStatus,
  InvoiceType,
  OrderSelectionStatus,
  OrderStatus,
  Prisma,
} from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderDetailsFinancialsTab } from "@/components/financial/order-details-financials-tab";
import { OrderSettlementSummary } from "@/components/orders/order-settlement-summary";
import {
  computeOrderSettlementSummary,
  deriveLockedFinancialSidebarSummary,
} from "@/modules/orders/order-settlement";
import type {
  LinkedFinancialDocument,
  POSWorkspace,
} from "@/modules/orders/order.types";

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

test("OrderDetailsFinancialsTab displays summary values from deriveLockedFinancialSidebarSummary", () => {
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

test("Order settlement header outstanding matches Financials tab remaining on fixture", () => {
  const summary = financialSummaryFixture();
  const settlementSummary = computeOrderSettlementSummary({
    invoices: [
      invoice(InvoiceType.DEPOSIT, 20, 0),
      invoice(InvoiceType.FINAL, 230, 0),
      invoice(InvoiceType.ADJUSTMENT, 40, 20),
      invoice(InvoiceType.REFUND, 10, 0),
      invoice(InvoiceType.CREDIT_NOTE, 5, 0),
    ],
  });
  const markup = renderToStaticMarkup(
    createElement(OrderSettlementSummary, { summary: settlementSummary })
  );

  assert.equal(settlementSummary.outstandingAmount, summary.remaining);
  assert.match(markup, new RegExp(`${formatKD(summary.remaining)} outstanding`));
});

function financialSummaryFixture() {
  return deriveLockedFinancialSidebarSummary({
    finalInvoice: {
      totalAmount: 230,
      remainingAmount: 0,
      depositPaidAmount: 20,
    },
    finalizedAdjustments: [{ totalAmount: 40, remainingAmount: 20 }],
    orderId: "order-1",
  });
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
    document("invoice-dep", "INV-DEP", InvoiceType.DEPOSIT, 20, 0),
    document("invoice-final", "INV-FINAL", InvoiceType.FINAL, 230, 0),
    document("invoice-adj", "INV-ADJ", InvoiceType.ADJUSTMENT, 40, 20),
    document("invoice-refund", "INV-REFUND", InvoiceType.REFUND, 10, 0),
    document("invoice-credit", "INV-CREDIT", InvoiceType.CREDIT_NOTE, 5, 0),
  ];
}

function document(
  invoiceId: string,
  invoiceNumber: string,
  invoiceType: LinkedFinancialDocument["invoiceType"],
  invoiceTotal: number,
  remainingAmount: number
): LinkedFinancialDocument {
  return {
    invoiceId,
    invoiceNumber,
    invoiceType,
    invoiceStatus:
      remainingAmount > 0 ? InvoiceStatus.PARTIAL : InvoiceStatus.CLOSED,
    invoiceTotal,
    paidAmount: invoiceTotal - remainingAmount,
    remainingAmount,
    issuedAt: new Date("2026-05-17T10:00:00.000Z"),
    createdAt: new Date("2026-05-17T10:00:00.000Z"),
  };
}

function invoice(
  invoiceType: InvoiceType,
  totalAmount: number,
  remainingAmount: number
) {
  return {
    invoiceType,
    totalAmount: new Prisma.Decimal(totalAmount),
    remainingAmount: new Prisma.Decimal(remainingAmount),
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

function formatKD(value: number): string {
  return `${value.toFixed(3)} KD`;
}
