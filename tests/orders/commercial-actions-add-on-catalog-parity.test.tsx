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
import type { POSAddOnHandlers } from "@/modules/orders/pos-handlers.types";
import {
  buildPOSAddOnEditPolicies,
  orderEditModeContextFromWorkspace,
  type POSAddOnEditPolicies,
} from "@/modules/orders/policies/edit-mode-policy";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

type AddOnComponents = {
  POSAddOnMarketplace: ComponentType<{
    workspace: POSWorkspace;
    marketplace: POSAddOnMarketplaceProjection;
    handlers: POSAddOnHandlers;
    editPolicies: POSAddOnEditPolicies;
  }>;
};

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };

test("Commercial Actions add-on catalog renders one-to-one with projected marketplace state", async () => {
  await withPOSComponentStubs(async () => {
    const { POSAddOnMarketplace } = await loadAddOnComponents();
    const workspace = buildPOSWorkspaceFixture();
    const composition = duplicateAndLegacyAddOnCompositionFixture(workspace);
    const marketplace = toPOSAddOnMarketplace(composition);
    const markup = renderToStaticMarkup(
      createElement(POSAddOnMarketplace, {
        workspace,
        marketplace,
        handlers: {
          addAddOn: async () => ({ ok: true }),
          removeAddOn: async () => ({ ok: true }),
        },
        editPolicies: buildAddOnPolicies(workspace),
      })
    );

    assertCatalogRowsMatchProjection(markup, workspace, marketplace);
    assertCurrentRowsMatchProjection(markup, marketplace);
    assert.equal(quickActionButtonIsDisabled(markup, "Add Canvas"), false);
    assert.equal(quickActionButtonIsDisabled(markup, "Add Album"), false);
    assert.equal(quickActionButtonIsDisabled(markup, "Add Prints"), false);
    assert.equal(quickActionButtonIsDisabled(markup, "Add Digital"), true);
  });
});

function assertCatalogRowsMatchProjection(
  markup: string,
  workspace: POSWorkspace,
  marketplace: POSAddOnMarketplaceProjection
): void {
  const stateByProductId = new Map(
    marketplace.productStates.map((state) => [state.productId, state])
  );

  for (const item of workspace.addOnCatalog) {
    const state = stateByProductId.get(item.id) ?? null;
    assert.match(markup, new RegExp(escapeRegExp(item.name)));
    assert.match(markup, new RegExp(escapeRegExp(item.category)));
    assert.match(markup, new RegExp(escapeRegExp(`+${item.priceLabel}`)));

    if (state) {
      assert.match(markup, new RegExp(`Added x${state.count}`));
      assert.match(markup, new RegExp(`value="${state.removalOrderAddOnId}"`));
      assert.match(
        markup,
        new RegExp(`name="currentQuantity" value="${state.removalOrderAddOnQuantity}"`)
      );
    }
  }

  assert.equal(
    workspace.addOnCatalog.every((item) => markup.includes(item.name)),
    true
  );
}

function assertCurrentRowsMatchProjection(
  markup: string,
  marketplace: POSAddOnMarketplaceProjection
): void {
  for (const addOn of marketplace.currentAddOns) {
    assert.match(markup, new RegExp(escapeRegExp(addOn.name)));
    assert.match(markup, new RegExp(escapeRegExp(`${addOn.unitAmount.toFixed(3)} KD`)));
    if (addOn.orderAddOnId) {
      assert.match(markup, new RegExp(`value="${addOn.orderAddOnId}"`));
      assert.match(
        markup,
        new RegExp(`name="currentQuantity" value="${addOn.currentQuantity}"`)
      );
    }
  }

  assert.doesNotMatch(markup, /No standalone add-ons are attached/);
}

function buildAddOnPolicies(workspace: POSWorkspace): POSAddOnEditPolicies {
  return buildPOSAddOnEditPolicies(
    orderEditModeContextFromWorkspace({
      orderId: workspace.orderId,
      orderStatus: workspace.orderStatusRaw,
      finalInvoiceIsLocked: workspace.invoice?.isLocked ?? false,
      persistenceContext: "sales",
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
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    return await callback();
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
}

async function loadAddOnComponents(): Promise<AddOnComponents> {
  const addOnModule = await import(
    "../../src/components/orders/pos-add-on-marketplace.tsx"
  );
  return (
    "POSAddOnMarketplace" in addOnModule ? addOnModule : addOnModule.default
  ) as AddOnComponents;
}

function quickActionButtonIsDisabled(markup: string, label: string): boolean {
  const buttons = markup.matchAll(/<button(?<attrs>[^>]*)>(?<body>.*?)<\/button>/gs);
  for (const button of buttons) {
    const attrs = button.groups?.attrs ?? "";
    const bodyText = (button.groups?.body ?? "").replace(/<[^>]*>/g, "");
    if (bodyText.includes(label)) {
      return /\sdisabled(?:=""|=|\s)/.test(attrs);
    }
  }
  assert.fail(`Expected to find quick action button: ${label}`);
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
    packageItems: [],
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
    packageOptions: [],
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
    packageItems: [],
    rawDeliverableTotal: 0,
    includedPhotoCount: 10,
    selectedPhotoCount: 12,
    extraPhotoCount: 2,
    extraPhotoTotal: 6,
    addOns: [],
    addOnTotal: 45,
    sessionConfigurationTotal: 0,
    productOptions: [],
    addOnCatalog: [
      {
        id: "product-canvas",
        name: "Canvas",
        category: "CANVAS",
        price: 20,
        priceLabel: "20.000 KD",
      },
      {
        id: "product-album",
        name: "Album",
        category: "ALBUM",
        price: 35,
        priceLabel: "35.000 KD",
      },
      {
        id: "product-print",
        name: "Print Set",
        category: "PRINT",
        price: 15,
        priceLabel: "15.000 KD",
      },
    ],
    invoice: null,
    adjustmentInvoices: [],
    paidAdjustmentInvoices: [],
    aggregateOutstanding: 0,
  };
}

function duplicateAndLegacyAddOnCompositionFixture(
  workspace: POSWorkspace
): DraftPOSCompositionProjection {
  return {
    orderId: workspace.orderId,
    jobNumber: workspace.jobNumber,
    sourceState: "draft",
    packageLines: [],
    addOns: [
      {
        id: "addon:canvas",
        orderAddOnId: "add-on-row-1",
        productId: "product-canvas",
        name: "Canvas",
        quantity: 2,
        unitAmount: 20,
        totalAmount: 40,
      },
      {
        id: "addon:legacy-manual",
        orderAddOnId: "legacy-manual-row",
        productId: null,
        name: "Legacy manual add-on",
        quantity: 1,
        unitAmount: 5,
        totalAmount: 5,
      },
    ],
    sessionConfigurations: [],
    totals: {
      packageBaseTotal: 100,
      packageUpgradeDeltaTotal: 0,
      deliverablesTotal: 0,
      addOnTotal: 45,
      extraPhotoTotal: 6,
      sessionConfigurationTotal: 0,
      netCompositionTotal: 151,
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
