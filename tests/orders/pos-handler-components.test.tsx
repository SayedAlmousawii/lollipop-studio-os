import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import test from "node:test";
import { OrderSelectionStatus, OrderStatus } from "@prisma/client";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { DraftPOSCompositionProjection } from "@/modules/orders/composition/projections";
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
    composition: DraftPOSCompositionProjection;
    handlers: POSCompositionHandlers;
  }>;
  POSPhotoCountCard: ComponentType<{
    workspace: POSWorkspace;
    composition: DraftPOSCompositionProjection;
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
  await withPOSComponentStubs(async () => {
    const { POSPackageComposition, POSPhotoCountCard } =
      await loadPackageComponents();
    const { POSAddOnMarketplace } = await loadAddOnComponents();
    const workspace = buildPOSWorkspaceFixture();
    const composition = buildDraftPOSCompositionFixture(workspace);
    const compositionHandlers = {
      changePackageTier: async () => ({ ok: true }),
      upgradePackageItem: async () => ({ ok: true }),
      changeSelectedPhotoCount: async () => ({ ok: true }),
      shouldPromptInlineApproval: false,
    } satisfies POSCompositionHandlers;
    const addOnHandlers = {
      addAddOn: async () => ({ ok: true }),
      removeAddOn: async () => ({ ok: true }),
      shouldPromptInlineApproval: false,
    } satisfies POSAddOnHandlers;

    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(POSPackageComposition, {
          workspace,
          composition,
          handlers: compositionHandlers,
        }),
        createElement(POSPhotoCountCard, {
          workspace,
          composition,
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
    assert.match(markup, /Classic/);
    assert.match(markup, /2 extras · Print · 6.000 KD/);
    assert.match(markup, /Digital 0 x 2.000 KD · Print 2 x 3.000 KD · Total 6.000 KD/);
    assert.match(markup, /Autosaves on blur or mode change/);
    assert.match(markup, /Commercial Actions/);
    assert.match(markup, /Add-On Marketplace/);
    assert.match(markup, /Current add-ons/);
  });
});

test("POSPhotoCountCard renders saved photo values from a pending-adjustment composition projection", async () => {
  await withPOSComponentStubs(async () => {
    const { POSPhotoCountCard } = await loadPackageComponents();
    const workspace = buildPOSWorkspaceFixture();
    const composition = pendingAdjustmentCompositionFixture(workspace);
    const handlers = {
      changePackageTier: async () => ({ ok: true }),
      upgradePackageItem: async () => ({ ok: true }),
      changeSelectedPhotoCount: async () => ({ ok: true }),
      shouldPromptInlineApproval: false,
    } satisfies POSCompositionHandlers;

    const markup = renderToStaticMarkup(
      createElement(POSPhotoCountCard, {
        workspace,
        composition,
        handlers,
      })
    );

    assert.match(markup, /Selected Photos/);
    assert.match(markup, /value="12"/);
    assert.match(markup, /2 extras · Print · 6.000 KD/);
    assert.match(markup, /Digital 0 x 2.000 KD · Print 2 x 3.000 KD · Total 6.000 KD/);
    assert.match(markup, /Print/);
  });
});

test("POSPackageComposition renders package-item upgrade row from projection", async () => {
  await withPOSComponentStubs(async () => {
    const { POSPackageComposition } = await loadPackageComponents();
    const workspace = buildPOSWorkspaceFixture();
    const composition = packageItemUpgradeCompositionFixture(workspace);
    const handlers = {
      changePackageTier: async () => ({ ok: true }),
      upgradePackageItem: async () => ({ ok: true }),
      changeSelectedPhotoCount: async () => ({ ok: true }),
      shouldPromptInlineApproval: false,
    } satisfies POSCompositionHandlers;

    const markup = renderToStaticMarkup(
      createElement(POSPackageComposition, {
        workspace,
        composition,
        handlers,
      })
    );

    assert.match(markup, /Premium Album/);
    assert.match(markup, /2x/);
    assert.match(markup, /45.000 KD/);
  });
});

test("POS composition components do not import sales server actions directly", () => {
  assert.equal(
    hasImportFrom(
      "src/components/orders/pos-package-composition.tsx",
      "@/app/orders/[orderId]/sales/actions"
    ),
    false
  );
  assert.equal(
    hasImportFrom(
      "src/components/orders/pos-add-on-marketplace.tsx",
      "@/app/orders/[orderId]/sales/actions"
    ),
    false
  );
});

test("R8a POS package component keeps photo draft helpers out of the client component", () => {
  const source = readFileSync(
    "src/components/orders/pos-package-composition.tsx",
    "utf8"
  );

  for (const helperName of [
    "buildPhotoLineDraft",
    "resolveBillingMode",
    "getPhotoLinePreview",
    "resolvePhotoPayload",
  ]) {
    assert.doesNotMatch(source, new RegExp(helperName));
  }
});

test("R8a sales and adjustment pages consume composition projectors instead of buildCompositionView", () => {
  for (const filePath of [
    "app/orders/[orderId]/sales/page.tsx",
    "app/orders/[orderId]/adjustment-workspace/page.tsx",
  ]) {
    const source = readFileSync(filePath, "utf8");
    assert.doesNotMatch(source, /buildCompositionView/);
    assert.match(source, /toCurrentCompositionCard/);
  }
});

function hasImportFrom(filePath: string, modulePath: string): boolean {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  let found = false;
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === modulePath
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

async function withPOSComponentStubs<T>(callback: () => Promise<T>): Promise<T> {
  const originalModuleLoad = moduleWithLoader._load;
  // The approval modal is statically imported and still owns the sales approval action.
  moduleWithLoader._load = function loadWithSalesActionStub(
    request,
    parent,
    isMain
  ) {
    if (request === "server-only") return {};
    if (request === "@/app/orders/[orderId]/sales/actions") {
      return {
        confirmReductiveEditWithApproval: async () => ({ kind: "success" }),
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
      packageBaseTotal: workspace.packageLines.reduce(
        (sum, line) => sum + line.currentPackage.price,
        0
      ),
      packageUpgradeDeltaTotal: 0,
      deliverablesTotal: workspace.rawDeliverableTotal,
      addOnTotal: workspace.addOnTotal,
      extraPhotoTotal: workspace.extraPhotoTotal,
      sessionConfigurationTotal: workspace.sessionConfigurationTotal,
      netCompositionTotal:
        workspace.packageLines.reduce(
          (sum, line) => sum + line.currentPackage.price,
          0
        ) +
        workspace.addOnTotal +
        workspace.extraPhotoTotal +
        workspace.sessionConfigurationTotal,
    },
  };
}

function pendingAdjustmentCompositionFixture(
  workspace: POSWorkspace
): DraftPOSCompositionProjection {
  return {
    ...buildDraftPOSCompositionFixture(workspace),
    sourceState: "adjustment",
    packageLines: buildDraftPOSCompositionFixture(workspace).packageLines.map(
      (line) => ({
        ...line,
        selectedPhotoCount: 12,
        extraDigitalCount: 0,
        extraPrintCount: 2,
        extraPhotoCount: 2,
        extraDigitalUnitPrice: 2,
        extraPrintUnitPrice: 3,
        extraPhotoTotal: 6,
      })
    ),
    totals: {
      ...buildDraftPOSCompositionFixture(workspace).totals,
      extraPhotoTotal: 6,
      netCompositionTotal: 126,
    },
  };
}

function packageItemUpgradeCompositionFixture(
  workspace: POSWorkspace
): DraftPOSCompositionProjection {
  const composition = buildDraftPOSCompositionFixture(workspace);
  return {
    ...composition,
    packageLines: composition.packageLines.map((line) => ({
      ...line,
      upgradeDelta: 15,
      packageItems: [
        {
          id: "package-item-1",
          productId: "product-premium-album",
          productName: "Premium Album",
          category: "ALBUM",
          quantity: 2,
          unitAmount: 45,
          totalAmount: 90,
        },
      ],
    })),
    totals: {
      ...composition.totals,
      packageUpgradeDeltaTotal: 15,
      deliverablesTotal: 90,
    },
  };
}
