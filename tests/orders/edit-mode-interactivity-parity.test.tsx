import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { OrderSelectionStatus, OrderStatus } from "@prisma/client";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  toPOSAddOnMarketplace,
  type DraftPOSCompositionProjection,
  type POSAddOnMarketplaceProjection,
} from "@/modules/orders/composition/projections";
import type { POSWorkspace } from "@/modules/orders/order.types";
import type {
  POSAddOnHandlers,
  POSCompositionHandlers,
} from "@/modules/orders/pos-handlers.types";
import {
  buildPOSAddOnEditPolicies,
  buildPOSPackageCompositionEditPolicies,
  orderEditModeContextFromWorkspace,
  type POSAddOnEditPolicies,
  type POSPackageCompositionEditPolicies,
} from "@/modules/orders/policies/edit-mode-policy";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

type PackageComponents = {
  POSPackageComposition: ComponentType<{
    workspace: POSWorkspace;
    composition: DraftPOSCompositionProjection;
    handlers: POSCompositionHandlers;
    editPolicies: POSPackageCompositionEditPolicies;
  }>;
};

type AddOnComponents = {
  POSAddOnMarketplace: ComponentType<{
    workspace: POSWorkspace;
    marketplace: POSAddOnMarketplaceProjection;
    handlers: POSAddOnHandlers;
    editPolicies: POSAddOnEditPolicies;
  }>;
};

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };

test("locked POS edit controls follow edit-mode policy interactivity", async () => {
  await withPOSComponentStubs(async () => {
    const { POSPackageComposition } = await loadPackageComponents();
    const { POSAddOnMarketplace } = await loadAddOnComponents();
    const workspace = lockedPOSWorkspaceFixture();
    const composition = buildDraftPOSCompositionFixture(workspace);
    const compositionHandlers = {
      changePackageTier: async () => ({ ok: true }),
      upgradePackageItem: async () => ({ ok: true }),
      changeSelectedPhotoCount: async () => ({ ok: true }),
    } satisfies POSCompositionHandlers;
    const addOnHandlers = {
      addAddOn: async () => ({ ok: true }),
      removeAddOn: async () => ({ ok: true }),
    } satisfies POSAddOnHandlers;

    const lockedMarkup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(POSPackageComposition, {
          workspace,
          composition,
          handlers: compositionHandlers,
          editPolicies: buildPackagePolicies(workspace, "sales"),
        }),
        createElement(POSAddOnMarketplace, {
          workspace,
          marketplace: toPOSAddOnMarketplace(composition),
          handlers: addOnHandlers,
          editPolicies: buildAddOnPolicies(workspace, "sales"),
        })
      )
    );

    const adjustmentMarkup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(POSPackageComposition, {
          workspace,
          composition: { ...composition, sourceState: "adjustment" },
          handlers: compositionHandlers,
          editPolicies: buildPackagePolicies(workspace, "sales"),
        }),
        createElement(POSAddOnMarketplace, {
          workspace,
          marketplace: toPOSAddOnMarketplace({
            ...composition,
            sourceState: "adjustment",
          }),
          handlers: addOnHandlers,
          editPolicies: buildAddOnPolicies(workspace, "sales"),
        })
      )
    );

    const lockedPackagePolicy = buildPackagePolicies(workspace, "sales");
    const lockedAddOnPolicy = buildAddOnPolicies(workspace, "sales");
    const adjustmentPackagePolicy = buildPackagePolicies(workspace, "sales");
    const adjustmentAddOnPolicy = buildAddOnPolicies(workspace, "sales");

    assert.equal(
      buttonIsDisabled(lockedMarkup, "Upgrade Package"),
      !lockedPackagePolicy.packageTierChange.isInteractive
    );
    assert.equal(
      buttonIsDisabled(lockedMarkup, "Edit photos"),
      !lockedPackagePolicy.selectedPhotoCountChange.isInteractive
    );
    assert.equal(
      buttonIsDisabled(lockedMarkup, "Add Canvas"),
      !lockedAddOnPolicy.addAddOn.isInteractive
    );
    assert.equal(
      iconButtonIsDisabled(lockedMarkup, "Remove add-on"),
      !lockedAddOnPolicy.removeAddOn.isInteractive
    );

    assert.equal(
      buttonIsDisabled(adjustmentMarkup, "Upgrade Package"),
      !adjustmentPackagePolicy.packageTierChange.isInteractive
    );
    assert.equal(
      buttonIsDisabled(adjustmentMarkup, "Edit photos"),
      !adjustmentPackagePolicy.selectedPhotoCountChange.isInteractive
    );
    assert.equal(
      buttonIsDisabled(adjustmentMarkup, "Add Canvas"),
      !adjustmentAddOnPolicy.addAddOn.isInteractive
    );
    assert.equal(
      iconButtonIsDisabled(adjustmentMarkup, "Remove add-on"),
      !adjustmentAddOnPolicy.removeAddOn.isInteractive
    );
  });
});

function buildPackagePolicies(
  workspace: POSWorkspace,
  persistenceContext: "sales"
): POSPackageCompositionEditPolicies {
  return buildPOSPackageCompositionEditPolicies(
    orderEditModeContextFromWorkspace({
      orderId: workspace.orderId,
      orderStatus: workspace.orderStatusRaw,
      finalInvoiceIsLocked: workspace.invoice?.isLocked ?? false,
      persistenceContext,
    })
  );
}

function buildAddOnPolicies(
  workspace: POSWorkspace,
  persistenceContext: "sales"
): POSAddOnEditPolicies {
  return buildPOSAddOnEditPolicies(
    orderEditModeContextFromWorkspace({
      orderId: workspace.orderId,
      orderStatus: workspace.orderStatusRaw,
      finalInvoiceIsLocked: workspace.invoice?.isLocked ?? false,
      persistenceContext,
    })
  );
}

async function withPOSComponentStubs<T>(callback: () => Promise<T>): Promise<T> {
  const originalModuleLoad = moduleWithLoader._load;
  moduleWithLoader._load = function loadWithSalesActionStub(
    request,
    parent,
    isMain
  ) {
    if (request === "server-only") return {};
    if (request === "@/app/(app)/orders/[orderId]/sales/actions") {
      return {
        stageSessionConfigurationSelectionAction: async () => ({ kind: "success" }),
      };
    }
    if (request === "@/app/(app)/orders/[orderId]/actions") {
      return {};
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    return await callback();
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
}

async function loadPackageComponents(): Promise<PackageComponents> {
  const packageModule = await import(
    "../../src/components/orders/pos-package-composition.tsx"
  );
  return (
    "POSPackageComposition" in packageModule
      ? packageModule
      : packageModule.default
  ) as PackageComponents;
}

async function loadAddOnComponents(): Promise<AddOnComponents> {
  const addOnModule = await import(
    "../../src/components/orders/pos-add-on-marketplace.tsx"
  );
  return (
    "POSAddOnMarketplace" in addOnModule ? addOnModule : addOnModule.default
  ) as AddOnComponents;
}

function buttonIsDisabled(markup: string, label: string): boolean {
  const buttons = markup.matchAll(/<button(?<attrs>[^>]*)>(?<body>.*?)<\/button>/gs);
  for (const button of buttons) {
    const attrs = button.groups?.attrs ?? "";
    const bodyText = (button.groups?.body ?? "").replace(/<[^>]*>/g, "");
    if (bodyText.includes(label)) {
      return /\sdisabled(?:=""|=|\s)/.test(attrs);
    }
  }
  assert.fail(`Expected to find button: ${label}`);
}

function iconButtonIsDisabled(markup: string, label: string): boolean {
  const pattern = new RegExp(
    `<button(?=[^>]*aria-label="${escapeRegExp(label)}")(?<attrs>[^>]*)>`,
    "s"
  );
  const match = pattern.exec(markup);
  assert.ok(match?.groups);
  return /\sdisabled(?:=""|=|\s)/.test(match.groups.attrs);
}

function lockedPOSWorkspaceFixture(): POSWorkspace {
  return {
    ...buildPOSWorkspaceFixture(),
    invoice: {
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
      extraPhotoTotal: 6,
      invoiceTotal: 126,
      paidAmount: 126,
      depositInvoiceNumber: null,
      depositPaidAmount: 0,
      remainingAmount: 0,
      lineItems: [],
    },
  };
}

function buildPOSWorkspaceFixture(): POSWorkspace {
  const packageLine = {
    id: "order-package-1",
    sortOrder: 1,
    sessionTypeId: "session-type-1",
    sessionTypeName: "Portrait",
    originalPackage: {
      id: "package-classic",
      name: "Classic",
      price: 100,
      priceLabel: "100.000 KD",
      photoCount: 10,
      bundleAdjustment: 0,
    },
    currentPackage: {
      id: "package-classic",
      name: "Classic",
      price: 100,
      priceLabel: "100.000 KD",
      photoCount: 10,
      bundleAdjustment: 0,
    },
    packageItems: [
      {
        id: "package-item-1",
        productId: "product-album",
        productName: "Album",
        category: "ALBUM",
        quantity: 1,
        priceSnapshot: 30,
        priceSnapshotLabel: "30.000 KD",
      },
    ],
    includedPhotoCount: 10,
    selectedPhotoCount: 12,
    extraDigitalCount: 0,
    extraPrintCount: 2,
    extraPhotoCount: 2,
    extraDigitalUnitPrice: 2,
    extraPrintUnitPrice: 3,
    extraPhotoTotal: 6,
    packageSubtotal: 106,
    upgradeDelta: 0,
    upgradeDeltaLabel: "0.000 KD",
    packageOptions: [
      {
        id: "package-classic",
        name: "Classic",
        price: 100,
        priceLabel: "100.000 KD",
        isCurrentPackage: true,
        upgradeDelta: 0,
        upgradeDeltaLabel: "0.000 KD",
      },
      {
        id: "package-premium",
        name: "Premium",
        price: 150,
        priceLabel: "150.000 KD",
        isCurrentPackage: false,
        upgradeDelta: 50,
        upgradeDeltaLabel: "50.000 KD",
      },
    ],
    sessionConfigurationSummary: [],
    sessionConfigurationSubtotal: 0,
    missingRequiredConfigurationCodes: [],
    availableConfigurations: [],
    currentSelections: [],
  };

  return {
    orderId: "order-1",
    jobNumber: "JOB-1",
    orderStatusRaw: OrderStatus.WAITING_SELECTION,
    orderStatus: "Waiting Selection",
    selectionStatus: OrderSelectionStatus.PENDING,
    sessionDate: "2026-05-17",
    customerName: "Test Customer",
    customerPhone: "55500000",
    packageLines: [packageLine],
    packageItems: packageLine.packageItems,
    rawDeliverableTotal: 30,
    includedPhotoCount: 10,
    selectedPhotoCount: 12,
    extraPhotoCount: 2,
    extraPhotoTotal: 6,
    addOns: [
      {
        id: "add-on-1",
        addOnRowId: "add-on-row-1",
        productId: "product-canvas",
        name: "Canvas",
        price: 20,
        priceLabel: "20.000 KD",
      },
    ],
    addOnTotal: 20,
    sessionConfigurationTotal: 0,
    productOptions: [
      {
        id: "product-premium-album",
        name: "Premium Album",
        category: "ALBUM",
        canonicalPrice: 45,
        canonicalPriceLabel: "45.000 KD",
      },
    ],
    addOnCatalog: [
      {
        id: "product-canvas",
        name: "Canvas",
        category: "CANVAS",
        price: 20,
        priceLabel: "20.000 KD",
      },
    ],
    invoice: null,
    adjustmentInvoices: [],
    paidAdjustmentInvoices: [],
    aggregateOutstanding: 0,
  };
}

function buildDraftPOSCompositionFixture(
  workspace: POSWorkspace
): DraftPOSCompositionProjection {
  return {
    orderId: workspace.orderId,
    jobNumber: workspace.jobNumber,
    sourceState: "draft",
    packageLines: workspace.packageLines.map((line) => ({
      id: `package:${line.id}`,
      orderPackageId: line.id,
      packageId: line.currentPackage.id,
      packageName: line.currentPackage.name,
      packagePrice: line.currentPackage.price,
      sessionTypeId: line.sessionTypeId,
      sessionTypeName: line.sessionTypeName,
      includedPhotoCount: line.includedPhotoCount,
      selectedPhotoCount: line.selectedPhotoCount,
      extraDigitalCount: line.extraDigitalCount,
      extraPrintCount: line.extraPrintCount,
      extraPhotoCount: line.extraPhotoCount,
      extraDigitalUnitPrice: line.extraDigitalUnitPrice,
      extraPrintUnitPrice: line.extraPrintUnitPrice,
      extraPhotoTotal: line.extraPhotoTotal,
      packageSubtotal: line.packageSubtotal,
      upgradeDelta: line.upgradeDelta,
      packageItems: line.packageItems.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        category: item.category,
        quantity: item.quantity,
        unitAmount: item.priceSnapshot,
        totalAmount: item.priceSnapshot * item.quantity,
      })),
    })),
    addOns: workspace.addOns.map((addOn) => ({
      id: `addon:${addOn.id}`,
      orderAddOnId: addOn.addOnRowId,
      productId: addOn.productId,
      name: addOn.name,
      quantity: 1,
      unitAmount: addOn.price,
      totalAmount: addOn.price,
    })),
    sessionConfigurations: [],
    totals: {
      packageBaseTotal: 100,
      packageUpgradeDeltaTotal: 0,
      deliverablesTotal: 30,
      addOnTotal: 20,
      extraPhotoTotal: 6,
      sessionConfigurationTotal: 0,
      netCompositionTotal: 126,
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
