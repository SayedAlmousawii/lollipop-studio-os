import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import test from "node:test";
import { InvoiceStatus, InvoiceType, OrderSelectionStatus, OrderStatus } from "@prisma/client";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SalesSidebarLockedProjection } from "@/modules/financial-cases";
import type {
  LinkedFinancialDocument,
  POSWorkspace,
} from "@/modules/orders/order.types";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

type FinancialSidebarLockedComponent = ComponentType<{
  workspace: POSWorkspace;
  linkedDocuments: LinkedFinancialDocument[];
  financialSummary: SalesSidebarLockedProjection;
  openWorkspace: {
    id: string;
    openedAt: Date;
    currentOwnerUserId: string | null;
    currentOwnerUser: { name: string } | null;
    openedByUser: { name: string };
  } | null;
  currentUserId: string;
  isManager: boolean;
}>;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };

test("FinancialSidebarLocked renders the locked sidebar sections and sanitized labels", async () => {
  const FinancialSidebarLocked = await loadFinancialSidebarLocked();
  const markup = renderToStaticMarkup(
    createElement(FinancialSidebarLocked, {
      workspace: workspaceFixture(),
      linkedDocuments: linkedDocumentsFixture(),
      financialSummary: {
        customerTotal: 270,
        paidSoFar: 270,
        includesDeposit: 20,
        remaining: 0,
        finalInvoiceTotal: 230,
        totalAdjustments: 40,
        finalTotal: 270,
      },
      openWorkspace: {
        id: "workspace-1",
        openedAt: new Date("2026-05-17T10:00:00.000Z"),
        currentOwnerUserId: "user-1",
        currentOwnerUser: { name: "Owner User" },
        openedByUser: { name: "Owner User" },
      },
      currentUserId: "user-1",
      isManager: false,
    })
  );

  assertInOrder(markup, [
    "Payment Summary",
    "Total Source",
    "Linked Financial Documents",
    "Adjustment Workspace",
  ]);
  assert.match(markup, /Customer Total/);
  assert.match(markup, /Paid So Far/);
  assert.match(markup, /Includes Deposit/);
  assert.match(markup, /Remaining/);
  assert.match(markup, /Final Total \/ Customer Total/);
  assert.doesNotMatch(markup, /Effective Total/);
  assert.doesNotMatch(markup, /Deposit Applied/);
  assert.doesNotMatch(markup, /SNAPSHOT LINE ITEMS/i);
  assert.doesNotMatch(markup, /Album 30×30 to Album 30×30/);
  assert.doesNotMatch(markup, /Album 30×30 to Album 20×20/);
  assert.match(markup, /Resume Workspace/);
  assert.match(markup, /INV-DEP/);
  assert.match(markup, /INV-FINAL/);
  assert.match(markup, /INV-ADJ/);
  assert.match(markup, /INV-REFUND/);
  assert.match(markup, /INV-CREDIT/);
});

test("FinancialSidebarLocked keeps adjustment workspace actions in the sidebar source", () => {
  const source = readFileSync(
    "src/components/orders/financial-sidebar-locked.tsx",
    "utf8"
  );

  assert.match(source, /Open Adjustment Workspace/);
  assert.match(source, /Resume Workspace/);
  assert.match(source, /Take Over/);
  assert.match(source, /openAdjustmentWorkspaceAction\.bind/);
  assert.match(source, /takeOverAdjustmentWorkspaceAction\.bind/);
});

function assertInOrder(markup: string, labels: string[]) {
  let previousIndex = -1;
  for (const label of labels) {
    const index = markup.indexOf(label);
    assert.ok(index > previousIndex, `${label} should appear after the previous section`);
    previousIndex = index;
  }
}

async function loadFinancialSidebarLocked(): Promise<FinancialSidebarLockedComponent> {
  const originalModuleLoad = moduleWithLoader._load;
  moduleWithLoader._load = function loadWithActionStubs(request, parent, isMain) {
    if (request === "@/app/orders/[orderId]/adjustment-workspace/actions") {
      return {
        openAdjustmentWorkspaceAction: async () => undefined,
        takeOverAdjustmentWorkspaceAction: async () => undefined,
      };
    }
    if (request === "@/components/orders/pos-record-payment-dialog") {
      return {
        POSRecordPaymentDialog: () => createElement("button", null, "Record Payment"),
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const sidebarModule = await import(
      "../../src/components/orders/financial-sidebar-locked.tsx"
    );
    return sidebarModule.FinancialSidebarLocked;
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
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
      lineItems: [],
    },
    adjustmentInvoices: [],
    paidAdjustmentInvoices: [
      {
        invoiceId: "invoice-adj",
        financialCaseId: "case-1",
        invoiceNumber: "INV-ADJ",
        invoiceType: "ADJUSTMENT",
        invoiceStatus: "Closed",
        isLocked: true,
        renderMode: "SNAPSHOT",
        packageBaseTotal: 0,
        bundleAdjustment: 0,
        addOnTotal: 0,
        extraPhotoTotal: 0,
        invoiceTotal: 40,
        paidAmount: 40,
        depositInvoiceNumber: null,
        depositPaidAmount: 0,
        remainingAmount: 0,
        lineItems: [],
      },
    ],
    aggregateOutstanding: 0,
  };
}

function linkedDocumentsFixture(): LinkedFinancialDocument[] {
  return [
    document("invoice-dep", "INV-DEP", InvoiceType.DEPOSIT, 20),
    document("invoice-final", "INV-FINAL", InvoiceType.FINAL, 230),
    document("invoice-adj", "INV-ADJ", InvoiceType.ADJUSTMENT, 40),
    document("invoice-refund", "INV-REFUND", InvoiceType.REFUND, 10),
    document("invoice-credit", "INV-CREDIT", InvoiceType.CREDIT_NOTE, 5),
  ];
}

function document(
  invoiceId: string,
  invoiceNumber: string,
  invoiceType: LinkedFinancialDocument["invoiceType"],
  invoiceTotal: number
): LinkedFinancialDocument {
  return {
    invoiceId,
    invoiceNumber,
    invoiceType,
    invoiceStatus: InvoiceStatus.CLOSED,
    invoiceTotal,
    paidAmount: invoiceTotal,
    remainingAmount: 0,
    issuedAt: new Date("2026-05-17T10:00:00.000Z"),
    createdAt: new Date("2026-05-17T10:00:00.000Z"),
  };
}
