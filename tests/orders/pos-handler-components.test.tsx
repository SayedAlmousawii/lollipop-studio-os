import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import test from "node:test";
import { OrderSelectionStatus, OrderStatus } from "@prisma/client";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
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
  ORDER_EDIT_MODE_MESSAGES,
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
  POSPhotoCountCard: ComponentType<{
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

test("POS handler components render the stable sales DOM labels from handler props", async () => {
  await withPOSComponentStubs(async () => {
    const { POSPackageComposition, POSPhotoCountCard } =
      await loadPackageComponents();
    const { POSAddOnMarketplace } = await loadAddOnComponents();
    const workspace = buildPOSWorkspaceFixture();
    const composition = buildDraftPOSCompositionFixture(workspace);
    const packagePolicies = buildPackagePolicies(workspace);
    const addOnPolicies = buildAddOnPolicies(workspace);
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
          editPolicies: packagePolicies,
        }),
        createElement(POSPhotoCountCard, {
          workspace,
          composition,
          handlers: compositionHandlers,
          editPolicies: packagePolicies,
        }),
        createElement(POSAddOnMarketplace, {
          workspace,
          marketplace: toPOSAddOnMarketplace(composition),
          handlers: addOnHandlers,
          editPolicies: addOnPolicies,
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

test("R9 POS handler components render locked notices from policy fixtures", async () => {
  await withPOSComponentStubs(async () => {
    const { POSPackageComposition, POSPhotoCountCard } =
      await loadPackageComponents();
    const { POSAddOnMarketplace } = await loadAddOnComponents();
    const workspace = lockedPOSWorkspaceFixture();
    const composition = buildDraftPOSCompositionFixture(workspace);
    const packagePolicies = buildPackagePolicies(workspace);
    const addOnPolicies = buildAddOnPolicies(workspace);
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

    const packageMarkup = renderToStaticMarkup(
      createElement(POSPackageComposition, {
        workspace,
        composition,
        handlers: compositionHandlers,
        editPolicies: packagePolicies,
      })
    );
    const photoMarkup = renderToStaticMarkup(
      createElement(POSPhotoCountCard, {
        workspace,
        composition,
        handlers: compositionHandlers,
        editPolicies: packagePolicies,
      })
    );
    const addOnMarkup = renderToStaticMarkup(
      createElement(POSAddOnMarketplace, {
        workspace,
        marketplace: toPOSAddOnMarketplace(composition),
        handlers: addOnHandlers,
        editPolicies: addOnPolicies,
      })
    );

    assert.match(packageMarkup, new RegExp(ORDER_EDIT_MODE_MESSAGES.lockedDirectPOS));
    assert.match(photoMarkup, new RegExp(ORDER_EDIT_MODE_MESSAGES.lockedDirectPOS));
    assert.match(addOnMarkup, new RegExp(ORDER_EDIT_MODE_MESSAGES.lockedDirectPOS));
  });
});

test("R8b POS add-on marketplace renders current add-ons and catalog badges from projection", async () => {
  await withPOSComponentStubs(async () => {
    const { POSAddOnMarketplace } = await loadAddOnComponents();
    const workspace = buildPOSWorkspaceFixture();
    const composition = duplicateAndLegacyAddOnCompositionFixture(workspace);
    const editPolicies = buildAddOnPolicies(workspace);
    const handlers = {
      addAddOn: async () => ({ ok: true }),
      removeAddOn: async () => ({ ok: true }),
      shouldPromptInlineApproval: false,
    } satisfies POSAddOnHandlers;

    const markup = renderToStaticMarkup(
      createElement(POSAddOnMarketplace, {
        workspace,
        marketplace: toPOSAddOnMarketplace(composition),
        handlers,
        editPolicies,
      })
    );

    assert.match(markup, /Added x2/);
    assert.match(markup, /Canvas/);
    assert.match(markup, /Legacy manual add-on/);
    assert.match(markup, /value="add-on-row-1"/);
  });
});

test("POS add-on marketplace quick actions use add-on catalog options", async () => {
  await withPOSComponentStubs(async () => {
    const { POSAddOnMarketplace } = await loadAddOnComponents();
    const workspace = {
      ...buildPOSWorkspaceFixture(),
      productOptions: [],
      addOnCatalog: [
        {
          id: "addon-canvas-quick",
          name: "Canvas Quick Add",
          category: "CANVAS",
          price: 25,
          priceLabel: "25.000 KD",
        },
      ],
    };
    const handlers = {
      addAddOn: async () => ({ ok: true }),
      removeAddOn: async () => ({ ok: true }),
      shouldPromptInlineApproval: false,
    } satisfies POSAddOnHandlers;

    const markup = renderToStaticMarkup(
      createElement(POSAddOnMarketplace, {
        workspace,
        marketplace: toPOSAddOnMarketplace(buildDraftPOSCompositionFixture(workspace)),
        handlers,
        editPolicies: buildAddOnPolicies(workspace),
      })
    );

    assert.equal(quickActionButtonIsDisabled(markup, "Add Canvas"), false);
    assert.equal(quickActionButtonIsDisabled(markup, "Add Album"), true);
  });
});

test("POS add-on marketplace quick actions stay interactive in adjustment mode", async () => {
  await withPOSComponentStubs(async () => {
    const { POSAddOnMarketplace } = await loadAddOnComponents();
    const workspace = {
      ...lockedPOSWorkspaceFixture(),
      productOptions: [],
      addOnCatalog: [
        {
          id: "addon-album-adjustment",
          name: "Album Adjustment Add-On",
          category: "ALBUM",
          price: 45,
          priceLabel: "45.000 KD",
        },
      ],
    };
    const handlers = {
      addAddOn: async () => ({ ok: true }),
      removeAddOn: async () => ({ ok: true }),
      shouldPromptInlineApproval: false,
    } satisfies POSAddOnHandlers;

    const markup = renderToStaticMarkup(
      createElement(POSAddOnMarketplace, {
        workspace,
        marketplace: toPOSAddOnMarketplace(buildDraftPOSCompositionFixture(workspace)),
        handlers,
        editPolicies: buildAddOnPolicies(workspace, "adjustment"),
      })
    );

    assert.equal(quickActionButtonIsDisabled(markup, "Add Album"), false);
  });
});

test("R8b POS add-on marketplace keeps empty catalog and current-row empty states", async () => {
  await withPOSComponentStubs(async () => {
    const { POSAddOnMarketplace } = await loadAddOnComponents();
    const workspace = {
      ...buildPOSWorkspaceFixture(),
      addOns: [],
      addOnCatalog: [],
    };
    const composition = {
      ...buildDraftPOSCompositionFixture(workspace),
      addOns: [],
    };
    const handlers = {
      addAddOn: async () => ({ ok: true }),
      removeAddOn: async () => ({ ok: true }),
      shouldPromptInlineApproval: false,
    } satisfies POSAddOnHandlers;

    const markup = renderToStaticMarkup(
      createElement(POSAddOnMarketplace, {
        workspace,
        marketplace: toPOSAddOnMarketplace(composition),
        handlers,
        editPolicies: buildAddOnPolicies(workspace),
      })
    );

    assert.match(markup, /No marketplace add-ons are configured yet/);
    assert.match(markup, /No standalone add-ons are attached to this order yet/);
  });
});

test("R8b POS add-on marketplace displays null-target current rows without removal", async () => {
  await withPOSComponentStubs(async () => {
    const { POSAddOnMarketplace } = await loadAddOnComponents();
    const workspace = {
      ...buildPOSWorkspaceFixture(),
      addOns: [],
      addOnCatalog: [],
    };
    const composition = currentAddOnCompositionFixture(workspace, [
      {
        id: "addon:null-target",
        orderAddOnId: null,
        productId: null,
        name: "Projected manual add-on",
        quantity: 1,
        unitAmount: 7,
        totalAmount: 7,
      },
    ]);
    const handlers = {
      addAddOn: async () => ({ ok: true }),
      removeAddOn: async () => ({ ok: true }),
      shouldPromptInlineApproval: false,
    } satisfies POSAddOnHandlers;

    const markup = renderToStaticMarkup(
      createElement(POSAddOnMarketplace, {
        workspace,
        marketplace: toPOSAddOnMarketplace(composition),
        handlers,
        editPolicies: buildAddOnPolicies(workspace),
      })
    );

    assert.match(markup, /Projected manual add-on/);
    assert.doesNotMatch(markup, /aria-label="Remove add-on"/);
    assert.doesNotMatch(markup, /name="addOnId"/);
  });
});

test("R8b POS add-on marketplace removes projected current row target", async () => {
  await withPOSComponentStubs(async () => {
    const { POSAddOnMarketplace } = await loadAddOnComponents();
    const workspace = {
      ...buildPOSWorkspaceFixture(),
      addOns: [],
      addOnCatalog: [],
    };
    const composition = currentAddOnCompositionFixture(workspace, [
      {
        id: "addon:remove-target",
        orderAddOnId: "remove-target-id",
        productId: "product-canvas",
        name: "Canvas",
        quantity: 1,
        unitAmount: 20,
        totalAmount: 20,
      },
    ]);
    const handlers = {
      addAddOn: async () => ({ ok: true }),
      removeAddOn: async () => ({ ok: true }),
      shouldPromptInlineApproval: false,
    } satisfies POSAddOnHandlers;

    const markup = renderToStaticMarkup(
      createElement(POSAddOnMarketplace, {
        workspace,
        marketplace: toPOSAddOnMarketplace(composition),
        handlers,
        editPolicies: buildAddOnPolicies(workspace),
      })
    );

    assert.match(markup, /Canvas/);
    assert.match(markup, /name="addOnId"/);
    assert.match(markup, /value="remove-target-id"/);
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
        editPolicies: buildPackagePolicies(workspace, "adjustment"),
      })
    );

    assert.match(markup, /Selected Photos/);
    assert.match(markup, /10 included/);
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
        editPolicies: buildPackagePolicies(workspace),
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

test("R8a sales page consumes composition projectors and retired AW page redirects", () => {
  const salesSource = readFileSync(
    "app/orders/[orderId]/sales/page.tsx",
    "utf8"
  );
  assert.doesNotMatch(salesSource, /buildCompositionView/);
  assert.match(salesSource, /getSalesPageView/);
  assert.match(salesSource, /composition=\{salesPageView\.composition\}/);

  const adjustmentSource = readFileSync(
    "app/orders/[orderId]/adjustment-workspace/page.tsx",
    "utf8"
  );
  assert.doesNotMatch(adjustmentSource, /buildCompositionView/);
  assert.doesNotMatch(adjustmentSource, /toCurrentCompositionCard/);
  assert.match(adjustmentSource, /redirect\(`\/orders\/\$\{orderId\}\/sales`\)/);
});

test("R8b add-on marketplace does not derive current state from POSWorkspace add-ons", () => {
  const source = readFileSync(
    "src/components/orders/pos-add-on-marketplace.tsx",
    "utf8"
  );

  assert.doesNotMatch(source, /workspace\.addOns/);
  assert.doesNotMatch(source, /addOnCountsByProductId/);
});

test("R9 POS components do not reintroduce local locked edit-mode notice copy", () => {
  for (const filePath of [
    "src/components/orders/financial-sidebar-draft.tsx",
    "src/components/orders/pos-package-composition.tsx",
    "src/components/orders/pos-add-on-marketplace.tsx",
  ]) {
    const source = readFileSync(filePath, "utf8");
    assert.doesNotMatch(source, /future adjustment flow/i);
    assert.doesNotMatch(source, /Invoice is locked\./);
    assert.doesNotMatch(source, /Additions issue adjustments/);
    assert.doesNotMatch(source, /Added extras issue adjustments/);
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

function buildPackagePolicies(
  workspace: POSWorkspace,
  persistenceContext: "sales" | "adjustment" = "sales"
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
  persistenceContext: "sales" | "adjustment" = "sales"
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
    if (request === "@/app/orders/[orderId]/actions") {
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

function duplicateAndLegacyAddOnCompositionFixture(
  workspace: POSWorkspace
): DraftPOSCompositionProjection {
  const composition = buildDraftPOSCompositionFixture(workspace);
  const addOns = [
    {
      id: "addon:canvas-1",
      orderAddOnId: "add-on-row-1",
      productId: "product-canvas",
      name: "Canvas",
      quantity: 1,
      unitAmount: 20,
      totalAmount: 20,
    },
    {
      id: "addon:canvas-2",
      orderAddOnId: "add-on-row-1",
      productId: "product-canvas",
      name: "Canvas",
      quantity: 1,
      unitAmount: 20,
      totalAmount: 20,
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
  ];

  return {
    ...composition,
    addOns,
    totals: {
      ...composition.totals,
      addOnTotal: 45,
      netCompositionTotal:
        composition.totals.netCompositionTotal -
        composition.totals.addOnTotal +
        45,
    },
  };
}

function currentAddOnCompositionFixture(
  workspace: POSWorkspace,
  addOns: DraftPOSCompositionProjection["addOns"]
): DraftPOSCompositionProjection {
  const composition = buildDraftPOSCompositionFixture(workspace);
  const addOnTotal = addOns.reduce((sum, addOn) => sum + addOn.totalAmount, 0);

  return {
    ...composition,
    addOns,
    totals: {
      ...composition.totals,
      addOnTotal,
      netCompositionTotal:
        composition.totals.netCompositionTotal -
        composition.totals.addOnTotal +
        addOnTotal,
    },
  };
}
