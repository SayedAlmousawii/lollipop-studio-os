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
let adjustmentCompositionModule: typeof import("@/modules/adjustment-workspace/adjustment-composition.service") | null =
  null;

before(async () => {
  compositionModule = await import("@/modules/orders/composition");
  adjustmentCompositionModule = await import(
    "@/modules/adjustment-workspace/adjustment-composition.service"
  );
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
  const snapshot = adjustmentComposition().buildCompositionSnapshotFromAdjustmentSnapshot({
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

  const snapshot = adjustmentComposition().buildCompositionSnapshotFromAdjustmentSnapshot(proposed, {
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

  const selectedPhotoChange = snapshot.adjustmentLines.find(
    (line) => line.metadata.adjustmentEditId === "edit-photos"
  );
  const selectedPhotoEdit = edits.find((edit) => edit.id === "edit-photos");
  assert.equal(
    selectedPhotoChange?.metadata.toLabel,
    selectedPhotoEdit?.op === "change_selected_photo_count"
      ? String(selectedPhotoEdit.selectedPhotoCount)
      : undefined
  );
  if (selectedPhotoChange?.metadata.fromLabel) {
    assert.notEqual(selectedPhotoChange.metadata.fromLabel, "1");
  }
});

test("unclassified adjustment line falls back to displayKind 'line' and is not dropped", () => {
  const snapshot = adjustmentComposition().buildCompositionSnapshotFromAdjustmentSnapshot({
    capturedAt: "2026-05-19T00:00:00.000Z",
    lines: [
      adjustmentLine({
        lineId: "manual-credit-line",
        kind: "item",
        refId: "manual-credit",
        label: "Manual Credit",
        unitPrice: "-5.000",
        lineTotalNet: "-5.000",
      }),
    ],
    totals: totals("-5.000"),
  });

  const line = snapshot.lines.find((row) => row.id === "manual-credit-line");
  assert.ok(line);
  assert.equal(line.metadata.displayKind, "line");
  assert.equal(line.metadata.sourceKind, "packageItem");
});

test("R7b projectors expose raw POS, overview, and production composition DTOs", () => {
  const effectiveComposition =
    composition().buildCompositionSnapshotFromPOSWorkspace(posWorkspaceFixture());
  const model = {
    orderId: "order-1",
    jobNumber: "JOB-1",
    state: "draft" as const,
    baseComposition: null,
    effectiveComposition,
    pendingAdjustmentComposition: null,
    totals: effectiveComposition.totals,
  };

  const draftPOS = composition().toDraftPOSComposition(model);
  assert.equal(draftPOS.packageLines[0]?.packageName, "Current Package");
  assert.equal(draftPOS.packageLines[0]?.selectedPhotoCount, 13);
  assert.equal(draftPOS.packageLines[0]?.extraDigitalCount, 3);
  assert.equal(draftPOS.addOns[0]?.unitAmount, 12);
  assert.equal(draftPOS.totals.netCompositionTotal, 151);

  const overview = composition().toOverviewTab(model);
  assert.equal(overview.packageLines[0]?.packageItems[0]?.productName, "Album");
  assert.equal(overview.sessionConfigurations[0]?.priceDelta, 8);
  assert.deepEqual(overview.summary, {
    packageCount: 1,
    includedPhotoCount: 10,
    selectedPhotoCount: 13,
    extraPhotoCount: 3,
    selectedPhotosLabel: "13 (3 extra)",
  });

  const production = composition().toProductionDeliverables(model);
  assert.equal(production.summaryLabel, "1 package item · 1 paid add-on");
  assert.equal(production.includedPhotoCount, 10);
  assert.equal(production.extraPhotoCount, 3);
  assert.deepEqual(production.rows.map((row) => row.label), ["Album", "USB"]);
});

test("adjustment POS projection preserves package included-photo baseline for selected-photo edits", () => {
  const base = adjustmentSnapshot({
    lines: [
      adjustmentLine({
        lineId: "package:op-basic",
        kind: "package",
        refId: "pkg-basic",
        refMetadata: {
          includedPhotoCount: 20,
          selectedPhotoCount: 20,
          sessionTypeId: "session-regular",
          sessionTypeName: "Regular",
        },
        label: "Basic Package",
        unitPrice: "100.000",
        lineTotalNet: "100.000",
      }),
      adjustmentLine({
        lineId: "extra-photo:op-basic:print",
        kind: "item",
        refId: "Extra photos - Print (Basic Package)",
        label: "Extra photos - Print (Basic Package)",
        quantity: 1,
        unitPrice: "3.000",
        lineTotalNet: "3.000",
      }),
    ],
  });
  const pendingAdjustmentComposition =
    adjustmentComposition().buildCompositionSnapshotFromAdjustmentSnapshot(base);
  const model = {
    orderId: "order-1",
    jobNumber: "JOB-1",
    state: "adjustment" as const,
    baseComposition: pendingAdjustmentComposition,
    effectiveComposition: pendingAdjustmentComposition,
    pendingAdjustmentComposition,
    totals: pendingAdjustmentComposition.totals,
  };

  const pos = composition().toLockedPOSComposition(model);
  const line = pos.packageLines[0];

  assert.equal(line?.packageName, "Basic Package");
  assert.equal(line?.sessionTypeName, "Regular");
  assert.equal(line?.includedPhotoCount, 20);
  assert.equal(line?.selectedPhotoCount, 21);
  assert.equal(line?.extraPhotoCount, 1);
  assert.equal(line?.extraPrintCount, 1);
  assert.equal(line?.extraDigitalCount, 0);
  assert.equal(
    (line?.extraDigitalCount ?? 0) + (line?.extraPrintCount ?? 0),
    (line?.selectedPhotoCount ?? 0) - (line?.includedPhotoCount ?? 0)
  );
});

test("R11 operational configuration projector filters operational selections and maps input values", () => {
  const workspace = posWorkspaceFixture();
  workspace.packageLines[0]!.sessionConfigurationSummary = [
    {
      configurationId: "financial-config",
      code: "FINANCIAL",
      label: "Financial config",
      optionLabel: "Gold",
      numericValue: null,
      textValue: null,
      priceDelta: 8,
      financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
      inputType: SessionConfigurationInputType.SELECT,
    },
    {
      configurationId: "toggle-config",
      code: "TOGGLE",
      label: "Hair fan",
      optionLabel: null,
      numericValue: null,
      textValue: null,
      priceDelta: 0,
      financialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
      inputType: SessionConfigurationInputType.TOGGLE,
    },
    {
      configurationId: "select-config",
      code: "SELECT",
      label: "Room",
      optionLabel: "VIP Room",
      numericValue: null,
      textValue: null,
      priceDelta: 0,
      financialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
      inputType: SessionConfigurationInputType.SELECT,
    },
    {
      configurationId: "number-config",
      code: "NUMBER",
      label: "Assistants",
      optionLabel: null,
      numericValue: "2",
      textValue: null,
      priceDelta: 0,
      financialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
      inputType: SessionConfigurationInputType.NUMBER,
    },
    {
      configurationId: "counter-config",
      code: "COUNTER",
      label: "Outfit changes",
      optionLabel: null,
      numericValue: "4",
      textValue: null,
      priceDelta: 0,
      financialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
      inputType: SessionConfigurationInputType.COUNTER,
    },
    {
      configurationId: "text-config",
      code: "TEXT",
      label: "Staff notes",
      optionLabel: null,
      numericValue: null,
      textValue: "Prepare white backdrop",
      priceDelta: 0,
      financialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
      inputType: SessionConfigurationInputType.TEXT,
    },
    {
      configurationId: "blank-select-config",
      code: "BLANK_SELECT",
      label: "Blank select",
      optionLabel: null,
      numericValue: null,
      textValue: null,
      priceDelta: 0,
      financialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
      inputType: SessionConfigurationInputType.SELECT,
    },
  ];

  const projection = composition().toOperationalConfigurationsDisplay(workspace);

  assert.deepEqual(projection, [
    {
      packageName: "Current Package",
      sessionTypeName: "Portrait",
      operationalSelections: [
        { configName: "Hair fan", valueDisplay: "Enabled" },
        { configName: "Room", valueDisplay: "VIP Room" },
        { configName: "Assistants", valueDisplay: "2" },
        { configName: "Outfit changes", valueDisplay: "4" },
        { configName: "Staff notes", valueDisplay: "Prepare white backdrop" },
      ],
    },
  ]);
  assert.deepEqual(composition().toOperationalConfigurationsDisplay(null), []);
});

test("R11 empty composition projection helpers return stable order-scoped DTOs", () => {
  assert.deepEqual(
    composition().emptyOverviewCompositionProjection({
      orderId: "order-empty",
      jobNumber: "JOB-EMPTY",
    }),
    {
      orderId: "order-empty",
      jobNumber: "JOB-EMPTY",
      summary: {
        packageCount: 0,
        includedPhotoCount: 0,
        selectedPhotoCount: 0,
        extraPhotoCount: 0,
        selectedPhotosLabel: "—",
      },
      packageLines: [],
      addOns: [],
      sessionConfigurations: [],
      totals: {
        packageBaseTotal: 0,
        packageUpgradeDeltaTotal: 0,
        deliverablesTotal: 0,
        addOnTotal: 0,
        extraPhotoTotal: 0,
        sessionConfigurationTotal: 0,
        netCompositionTotal: 0,
      },
    }
  );
  assert.deepEqual(
    composition().emptyProductionDeliverablesProjection({
      orderId: "order-empty",
      jobNumber: "JOB-EMPTY",
    }),
    {
      orderId: "order-empty",
      jobNumber: "JOB-EMPTY",
      summaryLabel: "No structured deliverables",
      includedPhotoCount: 0,
      extraPhotoCount: 0,
      rows: [],
    }
  );
});

test("R8c overview and production projectors cover multi-package composition rows", () => {
  const effectiveComposition =
    composition().buildCompositionSnapshotFromPOSWorkspace(
      multiPackagePOSWorkspaceFixture()
    );
  const model = {
    orderId: "order-1",
    jobNumber: "JOB-1",
    state: "draft" as const,
    baseComposition: null,
    effectiveComposition,
    pendingAdjustmentComposition: null,
    totals: effectiveComposition.totals,
  };

  const overview = composition().toOverviewTab(model);
  assert.equal(overview.summary.packageCount, 2);
  assert.equal(overview.summary.includedPhotoCount, 18);
  assert.equal(overview.summary.selectedPhotoCount, 24);
  assert.equal(overview.summary.extraPhotoCount, 6);
  assert.equal(overview.summary.selectedPhotosLabel, "24 (6 extra)");
  assert.deepEqual(
    overview.packageLines.map((line) => ({
      packageName: line.packageName,
      itemNames: line.packageItems.map((item) => item.productName),
      extraPhotoCount: line.extraPhotoCount,
    })),
    [
      {
        packageName: "Current Package",
        itemNames: ["Album"],
        extraPhotoCount: 3,
      },
      {
        packageName: "Family Package",
        itemNames: ["Canvas"],
        extraPhotoCount: 3,
      },
    ]
  );
  assert.deepEqual(
    overview.addOns.map((addOn) => ({
      name: addOn.name,
      quantity: addOn.quantity,
      totalAmount: addOn.totalAmount,
    })),
    [
      { name: "USB", quantity: 1, totalAmount: 12 },
      { name: "Frame", quantity: 1, totalAmount: 18 },
    ]
  );
  assert.deepEqual(
    overview.sessionConfigurations.map((selection) => ({
      label: selection.label,
      optionLabel: selection.optionLabel,
      priceDelta: selection.priceDelta,
    })),
    [
      { label: "Backdrop", optionLabel: "Gold", priceDelta: 8 },
      { label: "Location", optionLabel: "Outdoor", priceDelta: 15 },
    ]
  );

  const production = composition().toProductionDeliverables(model);
  assert.equal(production.summaryLabel, "3 package items · 2 paid add-ons");
  assert.equal(production.includedPhotoCount, 18);
  assert.equal(production.extraPhotoCount, 6);
  assert.deepEqual(
    production.rows.map((row) => ({
      label: row.label,
      quantity: row.quantity,
      packageName: row.packageName,
    })),
    [
      { label: "Album", quantity: 1, packageName: "Current Package" },
      { label: "Canvas", quantity: 2, packageName: "Family Package" },
      { label: "USB", quantity: 1, packageName: null },
      { label: "Frame", quantity: 1, packageName: null },
    ]
  );
});

test("R8c production deliverables expose a no-structured-deliverable fallback", () => {
  const effectiveComposition =
    adjustmentComposition().buildCompositionSnapshotFromAdjustmentSnapshot({
      capturedAt: "2026-05-19T00:00:00.000Z",
      lines: [
        adjustmentLine({
          lineId: "package:op-empty",
          kind: "package",
          refId: "pkg-empty",
          label: "Empty Package",
          unitPrice: "100.000",
          lineTotalNet: "100.000",
        }),
      ],
      totals: totals("100.000"),
    });
  const model = {
    orderId: "order-1",
    jobNumber: "JOB-1",
    state: "locked" as const,
    baseComposition: effectiveComposition,
    effectiveComposition,
    pendingAdjustmentComposition: null,
    totals: effectiveComposition.totals,
  };

  const production = composition().toProductionDeliverables(model);
  assert.equal(production.summaryLabel, "No structured deliverables");
  assert.deepEqual(production.rows, []);
});

test("R8c overview uses effective composition while an adjustment is pending", () => {
  const baseComposition =
    composition().buildCompositionSnapshotFromPOSWorkspace(posWorkspaceFixture());
  const pendingAdjustmentComposition =
    composition().buildCompositionSnapshotFromPOSWorkspace(
      multiPackagePOSWorkspaceFixture()
    );
  const model = {
    orderId: "order-1",
    jobNumber: "JOB-1",
    state: "adjustment" as const,
    baseComposition,
    effectiveComposition: baseComposition,
    pendingAdjustmentComposition,
    totals: pendingAdjustmentComposition.totals,
  };

  const overview = composition().toOverviewTab(model);
  const production = composition().toProductionDeliverables(model);

  assert.equal(overview.summary.packageCount, 1);
  assert.deepEqual(overview.packageLines.map((line) => line.packageName), [
    "Current Package",
  ]);
  assert.deepEqual(production.rows.map((row) => row.label), ["Album", "USB"]);
});

test("current composition card projector uses structured swap and upgrade metadata", () => {
  const base = adjustmentSnapshot({
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
        lineId: "item:op-1:item-album",
        kind: "item",
        refId: "prod-standard",
        label: "Standard Album",
        unitPrice: "20.000",
        lineTotalNet: "20.000",
      }),
    ],
  });
  const proposed = adjustmentSnapshot({
    lines: [
      adjustmentLine({
        lineId: "package:op-1",
        kind: "package",
        refId: "pkg-gold",
        label: "Gold Package",
        unitPrice: "150.000",
        lineTotalNet: "150.000",
      }),
      base.lines[1] ?? assert.fail("missing package item fixture"),
    ],
  });
  const pendingAdjustmentComposition =
    adjustmentComposition().buildCompositionSnapshotFromAdjustmentSnapshot(proposed, {
      baseSnapshot: base,
      edits: [
        {
          id: "edit-tier",
          op: "change_package_tier",
          orderPackageId: "op-1",
          toPackageRefId: "pkg-gold",
        },
        {
          id: "edit-upgrade",
          op: "upgrade_package_item",
          orderPackageId: "op-1",
          packageItemId: "item-album",
          toProductId: "prod-premium",
          quantity: 1,
        },
      ],
      adjustmentLines: [
        adjustmentLine({
          lineId: "delta:package:pkg-basic",
          kind: "package",
          refId: "pkg-basic",
          label: "Basic Package removal",
          quantity: -1,
          unitPrice: "100.000",
          lineTotalNet: "-100.000",
        }),
        adjustmentLine({
          lineId: "delta:package:pkg-gold",
          kind: "package",
          refId: "pkg-gold",
          label: "Gold Package addition",
          unitPrice: "150.000",
          lineTotalNet: "150.000",
        }),
        adjustmentLine({
          lineId: "item:op-1:item-album",
          kind: "item",
          refId: "prod-premium",
          label: "Premium Album",
          unitPrice: "15.000",
          lineTotalNet: "15.000",
        }),
      ],
      metadataContext: {
        products: new Map([
          ["prod-premium", { id: "prod-premium", name: "Premium Album" }],
        ]),
        packages: new Map([
          ["pkg-basic", { id: "pkg-basic", name: "Basic Package" }],
          ["pkg-gold", { id: "pkg-gold", name: "Gold Package" }],
        ]),
        packageItems: new Map([
          [
            "item-album",
            {
              id: "item-album",
              productId: "prod-standard",
              productName: "Standard Album",
              categoryLabel: "Album",
            },
          ],
        ]),
      },
    });
  const model = {
    orderId: "order-1",
    jobNumber: "JOB-1",
    state: "adjustment" as const,
    baseComposition: adjustmentComposition().buildCompositionSnapshotFromAdjustmentSnapshot(base),
    effectiveComposition: adjustmentComposition().buildCompositionSnapshotFromAdjustmentSnapshot(base),
    pendingAdjustmentComposition,
    totals: pendingAdjustmentComposition.totals,
  };

  const card = composition().toCurrentCompositionCard(model, {
    source: "pendingDeltas",
  });
  assert.equal(card.mode, "adjustment");
  assert.deepEqual(
    card.rows.map((row) => ({
      kind: row.kind,
      from: row.delta?.from,
      to: row.delta?.to,
      amount: row.delta?.amount,
    })),
    [
      {
        kind: "swap",
        from: "Basic Package",
        to: "Gold Package",
        amount: 50,
      },
      {
        kind: "upgrade",
        from: "Standard Album",
        to: "Premium Album",
        amount: 15,
      },
    ]
  );

  const pendingCard = composition().toCurrentCompositionCard(model, {
    source: "pending",
  });
  assert.equal(pendingCard.mode, "adjustment");
  assert.equal(pendingCard.total, 170);
  assert.deepEqual(
    pendingCard.rows
      .filter((row) => row.kind === "package" || row.kind === "swap")
      .map((row) => ({
        kind: row.kind,
        label: row.label,
        lineTotal: row.lineTotal,
      })),
    [
      {
        kind: "package",
        label: "Gold Package",
        lineTotal: 150,
      },
    ]
  );
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

test("R7b projector files stay pure", () => {
  const violations = walk(
    join(process.cwd(), "src/modules/orders/composition/projections")
  )
    .filter((filePath) => filePath.endsWith(".ts"))
    .flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      const forbidden = [
        "@/lib/db",
        "@/components/",
        "@/app/",
        "app/",
        "adjustment-workspace.service",
        "order.service",
        "server action",
      ].filter((pattern) => source.includes(pattern));
      return forbidden.map(
        (pattern) => `${filePath.replace(`${process.cwd()}/`, "")}: ${pattern}`
      );
    });

  assert.deepEqual(violations, []);
});

test("Spec 145 order composition service is Adjustment Workspace-free", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/orders/composition/order-composition.service.ts"
    ),
    "utf8"
  );

  for (const forbidden of [
    "@/modules/adjustment-workspace",
    "AdjustmentWorkspaceStatus",
    "AdjustmentWorkspaceEdit",
    "getPendingAdjustmentOrderCompositionViewModel",
    "workspaceId",
    ".adjustmentWorkspace",
  ]) {
    assert.doesNotMatch(source, new RegExp(escapeRegExp(forbidden)));
  }
});

test("Spec 145 orders table projection does not read Adjustment Workspace rows", () => {
  const source = readFileSync(
    join(process.cwd(), "src/modules/orders/order.service.ts"),
    "utf8"
  );
  const fetchOrdersBody = functionBody(source, "fetchOrders", "fetchOrdersByCustomerId");
  const mapOrderBody = functionBody(source, "mapOrderRow", "formatOrderPackageNames");

  assert.doesNotMatch(fetchOrdersBody, /adjustmentWorkspaces/);
  assert.doesNotMatch(fetchOrdersBody, /AdjustmentWorkspaceStatus/);
  assert.match(mapOrderBody, /hasOpenAdjustmentWorkspace:\s*false/);
  assert.doesNotMatch(mapOrderBody, /adjustmentWorkspaces/);
});

test("adjustment POS adapter consumes the R7 model and projector path", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/adjustment-workspace/adjustment-workspace.service.ts"
    ),
    "utf8"
  );
  const body = source.slice(
    source.indexOf("export async function derivePOSWorkspaceFromAdjustmentWorkspace"),
    source.indexOf("export async function derivePendingAdjustmentPreview")
  );

  assert.match(body, /getPendingAdjustmentOrderCompositionViewModel/);
  assert.match(body, /toLockedPOSComposition/);
  assert.doesNotMatch(body, /workspace\.proposal\.proposed\.lines/);
});

test("R8c order detail page consumes overview and production projector DTOs", () => {
  const source = readFileSync(
    join(process.cwd(), "app/orders/[orderId]/page.tsx"),
    "utf8"
  );
  const overviewBody = functionBody(source, "OverviewTab", "PackageLineList");
  const productionBody = functionBody(source, "ProductionTab", "DeliveryTab");

  assert.match(source, /getOrderCompositionViewModel/);
  assert.match(source, /toOverviewTab/);
  assert.match(source, /toProductionDeliverables/);
  assert.doesNotMatch(source, /formatDeliverablesSummary/);
  assert.match(overviewBody, /composition\.packageLines/);
  assert.match(overviewBody, /composition\.addOns/);
  assert.match(overviewBody, /composition\.sessionConfigurations/);
  assert.doesNotMatch(overviewBody, /order\.packageLines/);
  assert.doesNotMatch(overviewBody, /order\.packageItems/);
  assert.doesNotMatch(overviewBody, /order\.paidAddOns/);
  assert.doesNotMatch(overviewBody, /order\.selectedPhotoCount/);
  assert.doesNotMatch(overviewBody, /order\.includedPhotoCount/);
  assert.doesNotMatch(overviewBody, /order\.extraPhotoCount/);
  assert.match(productionBody, /deliverables\.summaryLabel/);
  assert.match(productionBody, /deliverables\.includedPhotoCount/);
  assert.match(productionBody, /deliverables\.extraPhotoCount/);
  assert.doesNotMatch(productionBody, /order\.packageItems/);
  assert.doesNotMatch(productionBody, /order\.paidAddOns/);
  assert.doesNotMatch(productionBody, /order\.includedPhotoCount/);
  assert.doesNotMatch(productionBody, /order\.extraPhotoCount/);
});

test("R11 order detail page does not reintroduce page-local projection helpers", () => {
  const source = readFileSync(
    join(process.cwd(), "app/orders/[orderId]/page.tsx"),
    "utf8"
  );
  const forbiddenDeclarations = [
    "deriveOperationalPackageLines",
    "valueDisplayForOperationalSelection",
    "emptyOverviewComposition",
    "emptyProductionDeliverables",
  ];

  for (const declaration of forbiddenDeclarations) {
    assert.doesNotMatch(
      source,
      new RegExp(`function\\s+${declaration}\\b`),
      `${declaration} must stay out of order detail page`
    );
  }
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

function multiPackagePOSWorkspaceFixture(): POSWorkspace {
  const fixture = posWorkspaceFixture();
  return {
    ...fixture,
    packageLines: [
      ...fixture.packageLines,
      {
        ...fixture.packageLines[0]!,
        id: "op-2",
        sessionTypeId: "session-2",
        sessionTypeName: "Family",
        originalPackage: {
          id: "pkg-family-original",
          name: "Family Original",
          price: 150,
          priceLabel: "150.000 KD",
          photoCount: 8,
          bundleAdjustment: 0,
        },
        currentPackage: {
          id: "pkg-family",
          name: "Family Package",
          price: 180,
          priceLabel: "180.000 KD",
          photoCount: 8,
          bundleAdjustment: 0,
        },
        packageItems: [
          {
            id: "item-2",
            productId: "prod-canvas",
            productName: "Canvas",
            category: "WALL_ART",
            quantity: 2,
            priceSnapshot: 20,
            priceSnapshotLabel: "20.000 KD",
          },
        ],
        includedPhotoCount: 8,
        selectedPhotoCount: 11,
        extraDigitalCount: 1,
        extraPrintCount: 2,
        extraPhotoCount: 3,
        extraDigitalUnitPrice: 2,
        extraPrintUnitPrice: 4,
        extraPhotoTotal: 10,
        packageSubtotal: 190,
        upgradeDelta: 30,
        upgradeDeltaLabel: "+30.000 KD",
        sessionConfigurationSummary: [
          {
            configurationId: "config-2",
            code: "LOCATION",
            label: "Location",
            optionLabel: "Outdoor",
            numericValue: null,
            textValue: null,
            priceDelta: 15,
            financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
            inputType: SessionConfigurationInputType.SELECT,
          },
        ],
        sessionConfigurationSubtotal: 15,
      },
    ],
    rawDeliverableTotal: 70,
    includedPhotoCount: 18,
    selectedPhotoCount: 24,
    extraPhotoCount: 6,
    extraPhotoTotal: 16,
    addOns: [
      ...fixture.addOns,
      {
        id: "addon-2",
        addOnRowId: "addon-row-2",
        productId: "prod-frame",
        name: "Frame",
        price: 18,
        priceLabel: "18.000 KD",
      },
    ],
    addOnTotal: 30,
    sessionConfigurationTotal: 23,
  };
}

function composition(): typeof import("@/modules/orders/composition") {
  assert.ok(compositionModule);
  return compositionModule;
}

function adjustmentComposition(): typeof import(
  "@/modules/adjustment-workspace/adjustment-composition.service"
) {
  assert.ok(adjustmentCompositionModule);
  return adjustmentCompositionModule;
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

function functionBody(
  source: string,
  functionName: string,
  nextFunctionName: string
): string {
  const start = source.indexOf(`function ${functionName}`);
  const end = source.indexOf(`function ${nextFunctionName}`, start);
  assert.notEqual(start, -1, `${functionName} must exist`);
  assert.notEqual(end, -1, `${nextFunctionName} must follow ${functionName}`);
  return source.slice(start, end);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
