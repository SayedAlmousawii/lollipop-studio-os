import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { OrderSelectionStatus, OrderStatus } from "@prisma/client";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DraftPOSCompositionProjection } from "@/modules/orders/composition/projections";
import type { POSWorkspace } from "@/modules/orders/order.types";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

type FinancialSidebarDraftComponent = ComponentType<{
  workspace: POSWorkspace;
  composition: DraftPOSCompositionProjection;
}>;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };

test("FinancialSidebarDraft renders draft commercial rows from the composition projection", async () => {
  const FinancialSidebarDraft = await loadFinancialSidebarDraft();
  const markup = renderToStaticMarkup(
    createElement(FinancialSidebarDraft, {
      workspace: workspaceFixture(),
      composition: compositionFixture(),
    })
  );

  assert.match(markup, /Package \(Projected Package\)/);
  assert.match(markup, /Extra photos total \(3\)/);
  assert.match(markup, /Projected Canvas/);
  assert.match(markup, /Projected Backdrop/);
  assert.match(markup, /Preview total/);
  assert.match(markup, /140.000 KD/);
  assert.doesNotMatch(markup, /Workspace Package/);
  assert.doesNotMatch(markup, /999.000 KD/);
});

test("FinancialSidebarDraft renders locked order from composition projection", async () => {
  const FinancialSidebarDraft = await loadFinancialSidebarDraft();
  const lockedWorkspace = workspaceFixture();
  lockedWorkspace.invoice = {
    invoiceId: "invoice-final",
    financialCaseId: "financial-case-1",
    invoiceNumber: "INV-FINAL",
    invoiceType: "FINAL",
    invoiceStatus: "Closed",
    isLocked: true,
    renderMode: "COMPUTED",
    packageBaseTotal: 100,
    bundleAdjustment: 0,
    addOnTotal: 20,
    extraPhotoTotal: 8,
    invoiceTotal: 250,
    paidAmount: 150,
    depositInvoiceNumber: null,
    depositPaidAmount: 0,
    remainingAmount: 100,
    lineItems: [],
  };

  const markup = renderToStaticMarkup(
    createElement(FinancialSidebarDraft, {
      workspace: lockedWorkspace,
      composition: { ...compositionFixture(), sourceState: "locked" },
    })
  );

  assert.match(markup, /Invoice #INV-FINAL/);
  assert.match(markup, /Locked/);
  assert.match(markup, /Projected Canvas/);
  assert.match(markup, /Projected Backdrop/);
  assert.match(markup, /Final invoice total/);
  assert.match(markup, /250.000 KD/);
  assert.doesNotMatch(markup, /140.000 KD/);
});

async function loadFinancialSidebarDraft(): Promise<FinancialSidebarDraftComponent> {
  const originalModuleLoad = moduleWithLoader._load;
  moduleWithLoader._load = function loadWithActionStubs(request, parent, isMain) {
    if (request === "@/components/orders/create-order-invoice-form") {
      return {
        CreateOrderInvoiceForm: () => createElement("button", null, "Create Invoice"),
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
      "../../src/components/orders/financial-sidebar-draft.tsx"
    );
    return sidebarModule.FinancialSidebarDraft;
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
}

function workspaceFixture(): POSWorkspace {
  return {
    orderId: "order-1",
    jobNumber: "JOB-1",
    orderStatusRaw: OrderStatus.WAITING_SELECTION,
    orderStatus: "Waiting Selection",
    selectionStatus: OrderSelectionStatus.PENDING,
    sessionDate: "2026-05-19",
    customerName: "Customer",
    customerPhone: "+96500000000",
    packageLines: [
      {
        id: "op-1",
        sortOrder: 0,
        sessionTypeId: "session-1",
        sessionTypeName: "Portrait",
        originalPackage: {
          id: "pkg-workspace",
          name: "Workspace Package",
          price: 999,
          priceLabel: "999.000 KD",
          photoCount: 10,
          bundleAdjustment: 0,
        },
        currentPackage: {
          id: "pkg-workspace",
          name: "Workspace Package",
          price: 999,
          priceLabel: "999.000 KD",
          photoCount: 10,
          bundleAdjustment: 0,
        },
        packageItems: [],
        includedPhotoCount: 10,
        selectedPhotoCount: 10,
        extraDigitalCount: 0,
        extraPrintCount: 0,
        extraPhotoCount: 0,
        extraDigitalUnitPrice: 0,
        extraPrintUnitPrice: 0,
        extraPhotoTotal: 0,
        packageSubtotal: 999,
        upgradeDelta: 0,
        upgradeDeltaLabel: "0.000 KD",
        packageOptions: [],
        sessionConfigurationSummary: [],
        sessionConfigurationSubtotal: 0,
        missingRequiredConfigurationCodes: [],
        availableConfigurations: [],
        currentSelections: [],
      },
    ],
    packageItems: [],
    rawDeliverableTotal: 0,
    includedPhotoCount: 10,
    selectedPhotoCount: 10,
    extraPhotoCount: 0,
    extraPhotoTotal: 999,
    addOns: [],
    addOnTotal: 999,
    sessionConfigurationTotal: 999,
    productOptions: [],
    addOnCatalog: [],
    invoice: null,
    adjustmentInvoices: [],
    paidAdjustmentInvoices: [],
    aggregateOutstanding: 0,
  };
}

function compositionFixture(): DraftPOSCompositionProjection {
  return {
    orderId: "order-1",
    jobNumber: "JOB-1",
    sourceState: "draft",
    packageLines: [
      {
        id: "package:op-1",
        orderPackageId: "op-1",
        packageId: "pkg-projected",
        packageName: "Projected Package",
        packagePrice: 100,
        sessionTypeId: "session-1",
        sessionTypeName: "Portrait",
        includedPhotoCount: 10,
        selectedPhotoCount: 13,
        extraDigitalCount: 1,
        extraPrintCount: 2,
        extraPhotoCount: 3,
        extraDigitalUnitPrice: 2,
        extraPrintUnitPrice: 3,
        extraPhotoTotal: 8,
        packageSubtotal: 108,
        upgradeDelta: 0,
        packageItems: [],
      },
    ],
    addOns: [
      {
        id: "addon:projected-canvas",
        orderAddOnId: "addon-row-1",
        productId: "product-canvas",
        name: "Projected Canvas",
        quantity: 1,
        unitAmount: 20,
        totalAmount: 20,
      },
    ],
    sessionConfigurations: [
      {
        id: "session-config:backdrop",
        orderPackageId: "op-1",
        configurationId: "backdrop",
        label: "Projected Backdrop",
        optionLabel: "Gold",
        numericValue: null,
        textValue: null,
        priceDelta: 12,
      },
    ],
    totals: {
      packageBaseTotal: 100,
      packageUpgradeDeltaTotal: 0,
      deliverablesTotal: 0,
      addOnTotal: 20,
      extraPhotoTotal: 8,
      sessionConfigurationTotal: 12,
      netCompositionTotal: 140,
    },
  };
}
