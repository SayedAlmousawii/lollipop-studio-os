import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import Module from "node:module";
import { join } from "node:path";
import test, { before } from "node:test";
import {
  OrderSelectionStatus,
  OrderStatus,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
} from "@prisma/client";
import type {
  AdjustmentBaseSnapshot,
  AdjustmentCompositionLine,
  AdjustmentCompositionTotals,
  AdjustmentWorkspaceEdit,
} from "@/modules/adjustment-workspace/adjustment-workspace.types";
import type { POSWorkspace } from "@/modules/orders/order.types";

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

test("draft composition exposes packages, deliverables, photos, add-ons, session configurations, and raw totals", () => {
  const snapshot =
    composition().buildCompositionSnapshotFromPOSWorkspace(posWorkspaceFixture());

  assert.equal(snapshot.packageLines.length, 1);
  assert.equal(snapshot.deliverables.length, 1);
  assert.equal(snapshot.addOns.length, 1);
  assert.equal(snapshot.extraPhotos.length, 1);
  assert.equal(snapshot.sessionConfigurations.length, 1);
  assert.equal(snapshot.packageLines[0]?.selectedPhotoCount, 13);
  assert.equal(snapshot.extraPhotos[0]?.metadata.displayKind, "extraPhotos");
  assert.equal(
    snapshot.sessionConfigurations[0]?.metadata.displayKind,
    "sessionConfiguration"
  );
  assert.deepEqual(snapshot.totals, {
    packageBaseTotal: 125,
    packageUpgradeDeltaTotal: 25,
    deliverablesTotal: 30,
    addOnTotal: 12,
    extraPhotoTotal: 6,
    sessionConfigurationTotal: 8,
    netCompositionTotal: 151,
  });
});

test("locked effective composition preserves finalized positive and negative adjustment metadata", () => {
  const snapshot = composition().buildCompositionSnapshotFromAdjustmentSnapshot({
    capturedAt: "2026-05-19T00:00:00.000Z",
    lines: [
      adjustmentLine({
        lineId: "package:op-1",
        kind: "package",
        refId: "pkg-basic",
        label: "Basic Package",
        unitPrice: "100.000",
        lineTotalNet: "100.000",
      }),
      adjustmentLine({
        lineId: "adj:positive",
        kind: "addon",
        refId: "prod-frame",
        label: "Frame",
        unitPrice: "15.000",
        lineTotalNet: "15.000",
      }),
      adjustmentLine({
        lineId: "adj:negative",
        kind: "session_configuration",
        refId: "sel-credit",
        label: "Configuration credit",
        quantity: -1,
        unitPrice: "5.000",
        lineTotalNet: "-5.000",
      }),
    ],
    totals: totals("110.000"),
  });

  const positive = snapshot.lines.find((line) => line.id === "adj:positive");
  const negative = snapshot.lines.find((line) => line.id === "adj:negative");
  assert.equal(positive?.metadata.sourceKind, "adjustmentDelta");
  assert.equal(positive?.metadata.displayKind, "addOn");
  assert.equal(positive?.totalAmount, 15);
  assert.equal(negative?.metadata.sourceKind, "adjustmentDelta");
  assert.equal(negative?.metadata.displayKind, "sessionConfiguration");
  assert.equal(negative?.totalAmount, -5);
  assert.equal(snapshot.totals.netCompositionTotal, 110);
});

test("pending adjustment metadata covers every composition-affecting edit op without label parsing", () => {
  const base = adjustmentSnapshot({
    lines: [
      adjustmentLine({
        lineId: "package:op-swap",
        kind: "package",
        refId: "pkg-basic",
        label: "Basic Package",
        unitPrice: "100.000",
        lineTotalNet: "100.000",
      }),
      adjustmentLine({
        lineId: "package:op-tier",
        kind: "package",
        refId: "pkg-standard",
        label: "Standard Package",
        unitPrice: "140.000",
        lineTotalNet: "140.000",
      }),
      adjustmentLine({
        lineId: "package:op-photos",
        kind: "package",
        refId: "pkg-photo",
        label: "Photo Package",
        unitPrice: "80.000",
        lineTotalNet: "80.000",
      }),
      adjustmentLine({
        lineId: "addon:addon-remove",
        kind: "addon",
        refId: "prod-remove",
        label: "Remove Me",
        unitPrice: "20.000",
        lineTotalNet: "20.000",
      }),
      adjustmentLine({
        lineId: "addon:addon-qty",
        kind: "addon",
        refId: "prod-qty",
        label: "Quantity Add-on",
        quantity: 1,
        unitPrice: "10.000",
        lineTotalNet: "10.000",
      }),
      adjustmentLine({
        lineId: "addon:addon-swap",
        kind: "addon",
        refId: "prod-old-addon",
        label: "Old Add-on",
        unitPrice: "9.000",
        lineTotalNet: "9.000",
      }),
      adjustmentLine({
        lineId: "session-config:sel-base",
        kind: "session_configuration",
        refId: "sel-base",
        label: "Backdrop - Blue",
        unitPrice: "5.000",
        lineTotalNet: "5.000",
      }),
    ],
    sessionConfigurationSelections: [
      {
        id: "sel-base",
        orderPackageId: "op-config",
        configurationId: "config-backdrop",
        optionId: "option-blue",
        numericValue: null,
        textValue: null,
        snapshotOptionLabel: "Blue",
        snapshotConfigurationCode: "BACKDROP",
        snapshotLabel: "Backdrop",
        snapshotPriceDelta: "5.000",
        snapshotFinancialBehavior: "FINANCIAL",
        snapshotInputType: "SELECT",
        snapshotPricingMode: "FIXED",
        snapshotLinkedProductId: null,
        orderAddOnId: null,
      },
    ],
  });
  const proposed = adjustmentSnapshot({
    lines: [
      ...base.lines,
      adjustmentLine({
        lineId: "session-config:sel-new",
        kind: "session_configuration",
        refId: "sel-new",
        label: "Backdrop - Gold",
        unitPrice: "8.000",
        lineTotalNet: "8.000",
      }),
    ],
    sessionConfigurationSelections: [
      {
        id: "sel-new",
        orderPackageId: "op-config",
        configurationId: "config-backdrop",
        optionId: "option-gold",
        numericValue: null,
        textValue: null,
        snapshotOptionLabel: "Gold",
        snapshotConfigurationCode: "BACKDROP",
        snapshotLabel: "Backdrop",
        snapshotPriceDelta: "8.000",
        snapshotFinancialBehavior: "FINANCIAL",
        snapshotInputType: "SELECT",
        snapshotPricingMode: "FIXED",
        snapshotLinkedProductId: null,
        orderAddOnId: null,
      },
    ],
  });
  const edits: AdjustmentWorkspaceEdit[] = [
    { id: "edit-add", op: "add_line", kind: "addon", refId: "prod-new", quantity: 1 },
    { id: "edit-remove", op: "remove_line", targetLineId: "addon:addon-remove" },
    {
      id: "edit-qty",
      op: "modify_quantity",
      targetLineId: "addon:addon-qty",
      newQuantity: 3,
    },
    {
      id: "edit-swap-package",
      op: "swap_package",
      fromPackageRefId: "pkg-basic",
      toPackageRefId: "pkg-deluxe",
    },
    {
      id: "edit-swap-addon",
      op: "swap_addon",
      targetLineId: "addon:addon-swap",
      toAddonRefId: "prod-new-addon",
    },
    {
      id: "edit-upgrade-item",
      op: "upgrade_package_item",
      orderPackageId: "op-upgrade",
      packageItemId: "item-standard",
      toProductId: "prod-premium",
      quantity: 1,
    },
    {
      id: "edit-photos",
      op: "change_selected_photo_count",
      orderPackageId: "op-photos",
      selectedPhotoCount: 12,
      extraDigitalCount: 2,
      extraPrintCount: 0,
    },
    {
      id: "edit-tier",
      op: "change_package_tier",
      orderPackageId: "op-tier",
      toPackageRefId: "pkg-gold",
    },
    {
      id: "edit-config",
      op: "change_session_configuration_selection",
      orderPackageId: "op-config",
      configurationId: "config-backdrop",
      desired: { kind: "select", optionId: "option-gold" },
    },
  ];

  const snapshot = composition().buildCompositionSnapshotFromAdjustmentSnapshot(proposed, {
    baseSnapshot: base,
    edits,
    adjustmentLines: [
      adjustmentLine({
        lineId: "edit:edit-add",
        kind: "addon",
        refId: "prod-new",
        label: "New Add-on",
        unitPrice: "12.000",
        lineTotalNet: "12.000",
      }),
      adjustmentLine({
        lineId: "delta:addon:prod-remove",
        kind: "addon",
        refId: "prod-remove",
        label: "Remove Me",
        quantity: -1,
        unitPrice: "20.000",
        lineTotalNet: "-20.000",
      }),
      adjustmentLine({
        lineId: "delta:addon:prod-qty",
        kind: "addon",
        refId: "prod-qty",
        label: "Quantity Add-on",
        quantity: 2,
        unitPrice: "10.000",
        lineTotalNet: "20.000",
      }),
      adjustmentLine({
        lineId: "delta:package:pkg-basic",
        kind: "package",
        refId: "pkg-basic",
        label: "Basic Package",
        quantity: -1,
        unitPrice: "100.000",
        lineTotalNet: "-100.000",
      }),
      adjustmentLine({
        lineId: "delta:package:pkg-deluxe",
        kind: "package",
        refId: "pkg-deluxe",
        label: "Deluxe Package",
        unitPrice: "160.000",
        lineTotalNet: "160.000",
      }),
      adjustmentLine({
        lineId: "delta:addon:prod-old-addon",
        kind: "addon",
        refId: "prod-old-addon",
        label: "Old Add-on",
        quantity: -1,
        unitPrice: "9.000",
        lineTotalNet: "-9.000",
      }),
      adjustmentLine({
        lineId: "delta:addon:prod-new-addon",
        kind: "addon",
        refId: "prod-new-addon",
        label: "New Add-on",
        unitPrice: "14.000",
        lineTotalNet: "14.000",
      }),
      adjustmentLine({
        lineId: "item:op-upgrade:item-standard",
        kind: "item",
        refId: "prod-premium",
        label: "Premium Album",
        unitPrice: "25.000",
        lineTotalNet: "25.000",
      }),
      adjustmentLine({
        lineId: "extra-photo:op-photos:digital",
        kind: "item",
        refId: "extra-digital",
        label: "Extra photos - Digital",
        quantity: 2,
        unitPrice: "3.000",
        lineTotalNet: "6.000",
      }),
      adjustmentLine({
        lineId: "delta:package:pkg-standard",
        kind: "package",
        refId: "pkg-standard",
        label: "Standard Package",
        quantity: -1,
        unitPrice: "140.000",
        lineTotalNet: "-140.000",
      }),
      adjustmentLine({
        lineId: "delta:package:pkg-gold",
        kind: "package",
        refId: "pkg-gold",
        label: "Gold Package",
        unitPrice: "190.000",
        lineTotalNet: "190.000",
      }),
      adjustmentLine({
        lineId: "delta:session-config:sel-new",
        kind: "session_configuration",
        refId: "sel-new",
        label: "Backdrop - Gold",
        unitPrice: "3.000",
        lineTotalNet: "3.000",
      }),
    ],
    metadataContext: {
      products: new Map([
        ["prod-new", { id: "prod-new", name: "New Add-on" }],
        ["prod-new-addon", { id: "prod-new-addon", name: "New Add-on" }],
        ["prod-premium", { id: "prod-premium", name: "Premium Album" }],
      ]),
      packages: new Map([
        ["pkg-basic", { id: "pkg-basic", name: "Basic Package" }],
        ["pkg-deluxe", { id: "pkg-deluxe", name: "Deluxe Package" }],
        ["pkg-standard", { id: "pkg-standard", name: "Standard Package" }],
        ["pkg-gold", { id: "pkg-gold", name: "Gold Package" }],
      ]),
      packageItems: new Map([
        [
          "item-standard",
          {
            id: "item-standard",
            productId: "prod-standard",
            productName: "Standard Album",
            categoryLabel: "Album",
          },
        ],
      ]),
    },
  });

  const coveredEditIds = new Set(
    snapshot.adjustmentLines
      .map((line) => line.metadata.adjustmentEditId)
      .filter((value): value is string => Boolean(value))
  );
  assert.deepEqual(coveredEditIds, new Set(edits.map((edit) => edit.id)));

  const upgrade = snapshot.adjustmentLines.find(
    (line) => line.metadata.adjustmentEditId === "edit-upgrade-item"
  );
  assert.equal(upgrade?.metadata.displayKind, "upgrade");
  assert.equal(upgrade?.metadata.fromLabel, "Standard Album");
  assert.equal(upgrade?.metadata.toLabel, "Premium Album");

  const packageSwap = snapshot.adjustmentLines.find(
    (line) => line.metadata.adjustmentEditId === "edit-swap-package"
  );
  assert.equal(packageSwap?.metadata.displayKind, "swap");
  assert.equal(packageSwap?.metadata.fromLabel, "Basic Package");
  assert.equal(packageSwap?.metadata.toLabel, "Deluxe Package");

  const sessionConfiguration = snapshot.adjustmentLines.find(
    (line) => line.metadata.adjustmentEditId === "edit-config"
  );
  assert.equal(sessionConfiguration?.metadata.displayKind, "sessionConfiguration");
  assert.equal(sessionConfiguration?.metadata.fromLabel, "Blue");
  assert.equal(sessionConfiguration?.metadata.toLabel, "Gold");
});

test("new composition module does not introduce label-derived swap parsing", () => {
  const violations = walk(join(process.cwd(), "src/modules/orders/composition"))
    .filter((filePath) => filePath.endsWith(".ts"))
    .filter((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return (
        source.includes("parseChangeLabel") ||
        source.includes('" to "') ||
        source.includes("' to '") ||
        source.includes("` to `") ||
        source.includes("\\s+to\\s+")
      );
    })
    .map((filePath) => filePath.replace(`${process.cwd()}/`, ""));

  assert.deepEqual(violations, []);
});

function posWorkspaceFixture(): POSWorkspace {
  return {
    orderId: "order-1",
    jobNumber: "JOB-1",
    orderStatusRaw: OrderStatus.WAITING_SELECTION,
    orderStatus: "Waiting Selection",
    selectionStatus: OrderSelectionStatus.PENDING,
    sessionDate: "May 19, 2026",
    customerName: "Customer",
    customerPhone: "+96500000000",
    packageLines: [
      {
        id: "op-1",
        sortOrder: 0,
        sessionTypeId: "session-1",
        sessionTypeName: "Portrait",
        originalPackage: {
          id: "pkg-original",
          name: "Original Package",
          price: 100,
          priceLabel: "100.000 KD",
          photoCount: 10,
          bundleAdjustment: 0,
        },
        currentPackage: {
          id: "pkg-current",
          name: "Current Package",
          price: 125,
          priceLabel: "125.000 KD",
          photoCount: 10,
          bundleAdjustment: 0,
        },
        packageItems: [
          {
            id: "item-1",
            productId: "prod-album",
            productName: "Album",
            category: "ALBUM",
            quantity: 1,
            priceSnapshot: 30,
            priceSnapshotLabel: "30.000 KD",
          },
        ],
        includedPhotoCount: 10,
        selectedPhotoCount: 13,
        extraDigitalCount: 3,
        extraPrintCount: 0,
        extraPhotoCount: 3,
        extraDigitalUnitPrice: 2,
        extraPrintUnitPrice: 4,
        extraPhotoTotal: 6,
        packageSubtotal: 131,
        upgradeDelta: 25,
        upgradeDeltaLabel: "+25.000 KD",
        packageOptions: [],
        sessionConfigurationSummary: [
          {
            configurationId: "config-1",
            code: "BACKDROP",
            label: "Backdrop",
            optionLabel: "Gold",
            numericValue: null,
            textValue: null,
            priceDelta: 8,
            financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
            inputType: SessionConfigurationInputType.SELECT,
          },
        ],
        sessionConfigurationSubtotal: 8,
        missingRequiredConfigurationCodes: [],
        availableConfigurations: [],
        currentSelections: [],
      },
    ],
    packageItems: [],
    rawDeliverableTotal: 30,
    includedPhotoCount: 10,
    selectedPhotoCount: 13,
    extraPhotoCount: 3,
    extraPhotoTotal: 6,
    addOns: [
      {
        id: "addon-1",
        addOnRowId: "addon-row-1",
        productId: "prod-usb",
        name: "USB",
        price: 12,
        priceLabel: "12.000 KD",
      },
    ],
    addOnTotal: 12,
    sessionConfigurationTotal: 8,
    productOptions: [],
    addOnCatalog: [],
    invoice: null,
    adjustmentInvoices: [],
    paidAdjustmentInvoices: [],
    aggregateOutstanding: 0,
  };
}

function composition(): typeof import("@/modules/orders/composition") {
  assert.ok(compositionModule);
  return compositionModule;
}

function adjustmentSnapshot(input: {
  lines: AdjustmentCompositionLine[];
  sessionConfigurationSelections?: AdjustmentBaseSnapshot["sessionConfigurationSelections"];
}): AdjustmentBaseSnapshot {
  return {
    capturedAt: "2026-05-19T00:00:00.000Z",
    lines: input.lines,
    totals: totals(
      input.lines
        .reduce((sum, line) => sum + Number(line.lineTotalNet), 0)
        .toFixed(3)
    ),
    sessionConfigurationSelections: input.sessionConfigurationSelections,
  };
}

function adjustmentLine(
  overrides: Partial<AdjustmentCompositionLine>
): AdjustmentCompositionLine {
  const quantity = overrides.quantity ?? 1;
  const unitPrice = overrides.unitPrice ?? "1.000";
  const lineTotalNet =
    overrides.lineTotalNet ?? (Number(unitPrice) * quantity).toFixed(3);
  return {
    lineId: "line",
    kind: "addon",
    refId: "ref",
    label: "Line",
    quantity,
    unitPrice,
    lineTotalGross: lineTotalNet,
    lineTotalNet,
    taxBreakdown: [],
    ...overrides,
  };
}

function totals(netPayable: string): AdjustmentCompositionTotals {
  return {
    gross: netPayable,
    discount: "0.000",
    tax: "0.000",
    netPayable,
  };
}

function walk(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}
