import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import test from "node:test";
import { OrderSelectionStatus, OrderStatus } from "@prisma/client";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { POSWorkspace } from "@/modules/orders/order.types";
import type {
  POSAddOnHandlers,
  POSCompositionHandlers,
} from "@/modules/orders/pos-handlers.types";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

type PackageComponents = {
  POSPackageComposition: ComponentType<{
    workspace: POSWorkspace;
    handlers: POSCompositionHandlers;
  }>;
  POSPhotoCountCard: ComponentType<{
    workspace: POSWorkspace;
    handlers: POSCompositionHandlers;
  }>;
};

type AddOnComponents = {
  POSAddOnMarketplace: ComponentType<{
    workspace: POSWorkspace;
    handlers: POSAddOnHandlers;
  }>;
};

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };

test("POS handler components render the stable sales DOM labels from handler props", async () => {
  const originalModuleLoad = moduleWithLoader._load;
  moduleWithLoader._load = function loadWithSalesActionStub(
    request,
    parent,
    isMain
  ) {
    if (request === "@/app/orders/[orderId]/sales/actions") {
      return {
        confirmReductiveEditWithApproval: async () => ({ kind: "success" }),
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const packageModule = await import(
      "../../src/components/orders/pos-package-composition.tsx"
    );
    const addOnModule = await import(
      "../../src/components/orders/pos-add-on-marketplace.tsx"
    );
    const packageExports = (
      "POSPackageComposition" in packageModule
        ? packageModule
        : packageModule.default
    ) as PackageComponents;
    const addOnExports = (
      "POSAddOnMarketplace" in addOnModule ? addOnModule : addOnModule.default
    ) as AddOnComponents;
    const { POSPackageComposition, POSPhotoCountCard } =
      packageExports;
    const { POSAddOnMarketplace } = addOnExports;
    const workspace = buildPOSWorkspaceFixture();
    const compositionHandlers = {
      changePackageTier: async () => ({ ok: true }),
      upgradePackageItem: async () => ({ ok: true }),
      changeSelectedPhotoCount: async () => ({ ok: true }),
      shouldPromptInlineApproval: false,
    } satisfies POSCompositionHandlers;
    const addOnHandlers = {
      addAddOn: async () => ({ ok: true }),
      removeAddOn: async () => ({ ok: true }),
      changeAddOnQuantity: async () => ({ ok: true }),
      shouldPromptInlineApproval: false,
    } satisfies POSAddOnHandlers;

    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(POSPackageComposition, {
          workspace,
          handlers: compositionHandlers,
        }),
        createElement(POSPhotoCountCard, {
          workspace,
          handlers: compositionHandlers,
        }),
        createElement(POSAddOnMarketplace, {
          workspace,
          handlers: addOnHandlers,
        })
      )
    );

    assert.match(markup, /Package Composition/);
    assert.match(markup, /Upgrade Package/);
    assert.match(markup, /Selected Photos/);
    assert.match(markup, /Autosaves on blur or mode change/);
    assert.match(markup, /Commercial Actions/);
    assert.match(markup, /Add-On Marketplace/);
    assert.match(markup, /Current add-ons/);
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
});

test("POS composition components do not import sales server actions directly", () => {
  const packageSource = readFileSync(
    "src/components/orders/pos-package-composition.tsx",
    "utf8"
  );
  const addOnSource = readFileSync(
    "src/components/orders/pos-add-on-marketplace.tsx",
    "utf8"
  );

  assert.doesNotMatch(packageSource, /@\/app\/orders\/\[orderId\]\/sales\/actions/);
  assert.doesNotMatch(addOnSource, /@\/app\/orders\/\[orderId\]\/sales\/actions/);
});

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
