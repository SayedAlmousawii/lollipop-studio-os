import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import test, { before } from "node:test";
import { OrderSelectionStatus, OrderStatus } from "@prisma/client";
import {
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  type OrderCommitSnapshotLineV1,
  type OrderCommitSnapshotV1,
} from "@/modules/order-commits";
import { toSalesPageComposition } from "@/modules/order-commits/projections/to-sales-page-composition";
import type { POSWorkspace } from "@/modules/orders/order.types";
import type { DraftPOSCompositionProjection } from "@/modules/orders/composition";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;

moduleWithLoader._load = function loadWithServerOnlyStub(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalModuleLoad.call(this, request, parent, isMain);
};

let compositionModule: typeof import("@/modules/orders/composition") | null = null;

before(async () => {
  compositionModule = await import("@/modules/orders/composition");
});

test("Spec 139 live composition keeps upgrade money while removing upgrades from add-on displays", () => {
  const workspace = spec139WorkspaceFixture();
  const snapshot =
    composition().buildCompositionSnapshotFromPOSWorkspace(workspace);
  const projected = composition().toDraftPOSComposition({
    orderId: workspace.orderId,
    jobNumber: workspace.jobNumber,
    state: "draft",
    baseComposition: null,
    effectiveComposition: snapshot,
  });
  const marketplace = composition().toPOSAddOnMarketplace(projected);

  assert.equal(workspace.addOns.length, 1);
  assert.equal(snapshot.addOns.length, 1);
  assert.equal(projected.addOns.length, 1);
  assert.equal(marketplace.currentAddOns.length, 1);
  assert.equal(snapshot.addOns[0]?.label, "Canvas");
  assert.equal(projected.addOns[0]?.name, "Canvas");
  assert.equal(marketplace.currentAddOns[0]?.name, "Canvas");
  assert.equal(
    [...snapshot.addOns, ...projected.addOns, ...marketplace.currentAddOns].some(
      (line) => "name" in line ? line.name.includes("Album") : line.label.includes("Album")
    ),
    false
  );

  assert.equal(projected.packageLines[0]?.packageItems[0]?.id, "package-item-1");
  assert.equal(
    projected.packageLines[0]?.packageItems[0]?.productName,
    "Album to Premium Album"
  );
  assert.equal(projected.packageLines[0]?.packageItems[0]?.unitAmount, 45);

  assert.deepEqual(snapshot.totals, {
    packageBaseTotal: 100,
    packageUpgradeDeltaTotal: 15,
    deliverablesTotal: 45,
    addOnTotal: 55,
    extraPhotoTotal: 6,
    sessionConfigurationTotal: 0,
    netCompositionTotal: 161,
  });
  assert.deepEqual(projected.totals, snapshot.totals);
});

test("Spec 139 add-on marketplace renders one quantity-N row and keeps remove-one quantity", () => {
  const workspace = spec139WorkspaceFixture();
  const snapshot =
    composition().buildCompositionSnapshotFromPOSWorkspace(workspace);
  const projected = composition().toDraftPOSComposition({
    orderId: workspace.orderId,
    jobNumber: workspace.jobNumber,
    state: "draft",
    baseComposition: null,
    effectiveComposition: snapshot,
  });
  const marketplace = composition().toPOSAddOnMarketplace(projected);

  assert.equal(projected.addOns[0]?.quantity, 2);
  assert.equal(projected.addOns[0]?.totalAmount, 40);
  assert.equal(marketplace.currentAddOns.length, 1);
  assert.equal(marketplace.currentAddOns[0]?.currentQuantity, 2);
  assert.deepEqual(marketplace.productStates, [
    {
      productId: "product-canvas",
      count: 2,
      removalOrderAddOnId: "order-addon-1",
      removalOrderAddOnQuantity: 2,
    },
  ]);
});

test("Spec 139 live and snapshot projections converge for upgraded deliverables and quantity add-ons", () => {
  const workspace = spec139WorkspaceFixture();
  const liveSnapshot =
    composition().buildCompositionSnapshotFromPOSWorkspace(workspace);
  const live = composition().toDraftPOSComposition({
    orderId: workspace.orderId,
    jobNumber: workspace.jobNumber,
    state: "draft",
    baseComposition: null,
    effectiveComposition: liveSnapshot,
  });
  const fromOrderCommit = toSalesPageComposition({
    draftSnapshot: orderCommitSnapshotFixture(),
    currentComposition: live,
  });

  assert.deepEqual(shapeForConvergence(live), shapeForConvergence(fromOrderCommit));
});

test("Spec 139 getPOSWorkspace maps display add-ons from order add-ons only", () => {
  const source = readFileSync("src/modules/orders/order.service.ts", "utf8");

  assert.match(source, /const addOns = mapPOSAddOns\(order\.orderAddOns\)/);
  assert.match(
    source,
    /const addOnTotal = sumOrderAddOnRowsDecimal\(combinedAddOnRows\)/
  );
});

function spec139WorkspaceFixture(): POSWorkspace {
  return {
    orderId: "order-1",
    jobNumber: "JOB-1",
    orderStatusRaw: OrderStatus.WAITING_SELECTION,
    orderStatus: "Waiting Selection",
    selectionStatus: OrderSelectionStatus.PENDING,
    sessionDate: "2026-06-04",
    customerName: "Customer",
    customerPhone: "+96500000000",
    photographerName: null,
    packageLines: [
      {
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
            productName: "Album to Premium Album",
            category: "ALBUM",
            quantity: 1,
            priceSnapshot: 45,
            priceSnapshotLabel: "45.000 KD",
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
        packageSubtotal: 121,
        upgradeDelta: 15,
        upgradeDeltaLabel: "+15.000 KD",
        packageOptions: [],
        sessionConfigurationSummary: [],
        sessionConfigurationSubtotal: 0,
        missingRequiredConfigurationCodes: [],
        availableConfigurations: [],
        currentSelections: [],
      },
    ],
    packageItems: [],
    rawDeliverableTotal: 45,
    includedPhotoCount: 10,
    selectedPhotoCount: 12,
    extraPhotoCount: 2,
    extraPhotoTotal: 6,
    addOns: [
      {
        id: "order-addon-1",
        addOnRowId: "order-addon-1",
        productId: "product-canvas",
        name: "Canvas",
        quantity: 2,
        price: 20,
        priceLabel: "20.000 KD",
      },
    ],
    addOnTotal: 55,
    sessionConfigurationTotal: 0,
    productOptions: [],
    addOnCatalog: [],
    invoice: null,
    adjustmentInvoices: [],
    paidAdjustmentInvoices: [],
    aggregateOutstanding: 0,
  };
}

function orderCommitSnapshotFixture(): OrderCommitSnapshotV1 {
  return {
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-04T00:00:00.000Z",
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines: [
      snapshotLine({
        lineId: "package:order-package-1",
        lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
        orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
        orderEntityId: "order-package-1",
        catalogEntityId: "package-classic",
        stableKey: "order-package:order-package-1",
        label: "Classic",
        quantity: 1,
        unitPrice: 100,
        lineTotal: 100,
        metadata: {
          includedPhotoCount: 10,
          selectedPhotoCount: 12,
          sessionTypeId: "session-type-1",
          sessionTypeName: "Portrait",
        },
      }),
      snapshotLine({
        lineId: "item-upgrade:upgrade-1",
        lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE,
        orderEntityKind:
          ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
        orderEntityId: "upgrade-1",
        parentOrderPackageId: "order-package-1",
        catalogEntityId: "package-item-1",
        stableKey: "order-package-item-upgrade:upgrade-1",
        label: "Album to Premium Album",
        quantity: 1,
        unitPrice: 45,
        lineTotal: 45,
        metadata: { packageItemId: "package-item-1", categoryLabel: "ALBUM" },
      }),
      snapshotLine({
        lineId: "extra-photo:order-package-1:print",
        lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA,
        orderEntityKind:
          ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_PHOTO_EXTRA,
        orderEntityId: "order-package-1:PRINT",
        parentOrderPackageId: "order-package-1",
        catalogEntityId: null,
        stableKey: "order-package:order-package-1:extra-photo:print",
        label: "Extra photos - PRINT",
        quantity: 2,
        unitPrice: 3,
        lineTotal: 6,
        metadata: { mediaType: "PRINT" },
      }),
      snapshotLine({
        lineId: "addon:order-addon-1",
        lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
        orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_ADD_ON,
        orderEntityId: "order-addon-1",
        catalogEntityId: "product-canvas",
        stableKey: "order-add-on:order-addon-1",
        label: "Canvas",
        quantity: 2,
        unitPrice: 20,
        lineTotal: 40,
        metadata: { orderAddOnId: "order-addon-1" },
      }),
    ],
    totals: {
      subtotal: 0,
      discountTotal: 0,
      netTotal: 161,
    },
  };
}

function snapshotLine(
  input: Omit<OrderCommitSnapshotLineV1, "priceSource">
): OrderCommitSnapshotLineV1 {
  return {
    ...input,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
  };
}

function shapeForConvergence(composition: DraftPOSCompositionProjection): {
  packageItems: unknown[];
  addOns: unknown[];
} {
  return {
    packageItems: composition.packageLines.flatMap((line) =>
      line.packageItems.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        unitAmount: item.unitAmount,
        totalAmount: item.totalAmount,
      }))
    ),
    addOns: composition.addOns.map((addOn) => ({
      orderAddOnId: addOn.orderAddOnId,
      productId: addOn.productId,
      name: addOn.name,
      quantity: addOn.quantity,
      unitAmount: addOn.unitAmount,
      totalAmount: addOn.totalAmount,
    })),
  };
}

function composition(): typeof import("@/modules/orders/composition") {
  assert.ok(compositionModule);
  return compositionModule;
}
