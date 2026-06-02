import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  diffOrderCommitSnapshots,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  type OrderCommitSnapshotLineV1,
  type OrderCommitSnapshotV1,
} from "@/modules/order-commits";

test("diff validates matching snapshot identity", () => {
  assert.throws(
    () =>
      diffOrderCommitSnapshots({
        baseSnapshot: snapshotFixture({ orderId: "order-1" }),
        pendingSnapshot: snapshotFixture({ orderId: "order-2" }),
      }),
    /orderId mismatch/
  );
});

test("diff compares Basic 100 to Premium 180 through real package stable key", () => {
  const baseSnapshot = snapshotFixture({
    lines: [
      packageLine({
        orderPackageId: "order-package-1",
        catalogEntityId: "package-basic",
        label: "Basic",
        unitPrice: 100,
        includedPhotoCount: 10,
      }),
    ],
  });
  const pendingSnapshot = snapshotFixture({
    lines: [
      packageLine({
        orderPackageId: "order-package-1",
        catalogEntityId: "package-premium",
        label: "Premium",
        unitPrice: 180,
        includedPhotoCount: 20,
      }),
    ],
  });

  const diff = diffOrderCommitSnapshots({ baseSnapshot, pendingSnapshot });

  assert.equal(diff.netDelta, 80);
  assert.equal(diff.lineDiffs.length, 1);
  assert.equal(
    diff.lineDiffs[0]?.stableKey,
    "order-package:order-package-1"
  );
  assert.equal(
    diff.lineDiffs[0]?.changeKind,
    ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.PACKAGE_CHANGED
  );
  assert.equal(diff.lineDiffs[0]?.moneyDelta, 80);
  assert.equal(diff.lineDiffs[0]?.operationalFlags.isPackageChange, true);
  assert.equal(diff.lineDiffs[0]?.operationalFlags.isPackageUpgrade, true);
  assert.equal(diff.lineDiffs[0]?.operationalFlags.isPackageSwap, true);
});

test("diff does not force package matching when stable keys differ", () => {
  const baseSnapshot = snapshotFixture({
    lines: [
      packageLine({
        orderPackageId: "order-package-basic",
        catalogEntityId: "package-basic",
        label: "Basic",
        unitPrice: 100,
      }),
    ],
  });
  const pendingSnapshot = snapshotFixture({
    lines: [
      packageLine({
        orderPackageId: "order-package-premium",
        catalogEntityId: "package-premium",
        label: "Premium",
        unitPrice: 180,
      }),
    ],
  });

  const diff = diffOrderCommitSnapshots({ baseSnapshot, pendingSnapshot });

  assert.equal(diff.netDelta, 80);
  assert.deepEqual(
    diff.lineDiffs.map((lineDiff) => ({
      stableKey: lineDiff.stableKey,
      changeKind: lineDiff.changeKind,
      moneyDelta: lineDiff.moneyDelta,
    })),
    [
      {
        stableKey: "order-package:order-package-basic",
        changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.REMOVED,
        moneyDelta: -100,
      },
      {
        stableKey: "order-package:order-package-premium",
        changeKind: ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED,
        moneyDelta: 180,
      },
    ]
  );
});

test("diff reports later additive commit delta without recharging unchanged lines", () => {
  const packageBase = packageLine({ unitPrice: 180 });
  const existingAddOn = addOnLine({
    orderAddOnId: "order-addon-existing",
    productId: "product-existing",
    unitPrice: 20,
  });
  const newAddOn = addOnLine({
    orderAddOnId: "draft:addon-new",
    productId: "product-new",
    unitPrice: 25,
  });

  const diff = diffOrderCommitSnapshots({
    baseSnapshot: snapshotFixture({ lines: [packageBase, existingAddOn] }),
    pendingSnapshot: snapshotFixture({
      lines: [packageBase, existingAddOn, newAddOn],
    }),
  });

  assert.equal(diff.netDelta, 25);
  assert.equal(
    diff.lineDiffs.find((lineDiff) => lineDiff.stableKey === packageBase.stableKey)
      ?.changeKind,
    ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.UNCHANGED
  );
  assert.equal(
    diff.lineDiffs.find((lineDiff) => lineDiff.stableKey === newAddOn.stableKey)
      ?.changeKind,
    ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED
  );
});

test("diff detects quantity, price, metadata, unchanged, added, and removed lines", () => {
  const removedLine = addOnLine({
    orderAddOnId: "removed-addon",
    productId: "product-removed",
    unitPrice: 8,
  });
  const addedLine = addOnLine({
    orderAddOnId: "added-addon",
    productId: "product-added",
    unitPrice: 9,
  });
  const quantityBase = packageItemUpgradeLine({
    orderPackageItemUpgradeId: "item-quantity",
    quantity: 1,
    unitPrice: 10,
  });
  const quantityPending = packageItemUpgradeLine({
    orderPackageItemUpgradeId: "item-quantity",
    quantity: 3,
    unitPrice: 10,
  });
  const priceBase = extraPhotoLine({ mediaType: "DIGITAL", unitPrice: 5 });
  const pricePending = extraPhotoLine({ mediaType: "DIGITAL", unitPrice: 6 });
  const metadataBase = sessionConfigurationLine({
    selectionId: "selection-1",
    metadata: { optionLabel: "Matte" },
  });
  const metadataPending = sessionConfigurationLine({
    selectionId: "selection-1",
    metadata: { optionLabel: "Glossy" },
  });
  const unchangedLine = linkedProductLine({
    selectionId: "selection-linked",
    addOnRef: "addon-linked",
    unitPrice: 15,
  });

  const diff = diffOrderCommitSnapshots({
    baseSnapshot: snapshotFixture({
      lines: [
        removedLine,
        quantityBase,
        priceBase,
        metadataBase,
        unchangedLine,
      ],
    }),
    pendingSnapshot: snapshotFixture({
      lines: [
        addedLine,
        quantityPending,
        pricePending,
        metadataPending,
        unchangedLine,
      ],
    }),
  });

  assertLineChange(
    diff.lineDiffs,
    removedLine.stableKey,
    ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.REMOVED
  );
  assertLineChange(
    diff.lineDiffs,
    addedLine.stableKey,
    ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED
  );
  assertLineChange(
    diff.lineDiffs,
    quantityBase.stableKey,
    ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.QUANTITY_CHANGED
  );
  assertLineChange(
    diff.lineDiffs,
    priceBase.stableKey,
    ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.PRICE_CHANGED
  );
  assertLineChange(
    diff.lineDiffs,
    metadataBase.stableKey,
    ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.METADATA_CHANGED
  );
  assertLineChange(
    diff.lineDiffs,
    unchangedLine.stableKey,
    ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.UNCHANGED
  );
});

test("diff sets operational flags by snapshot line kind", () => {
  const addOn = addOnLine({ orderAddOnId: "addon-1", unitPrice: 10 });
  const item = packageItemUpgradeLine({
    orderPackageItemUpgradeId: "item-1",
    unitPrice: 10,
  });
  const photo = extraPhotoLine({ mediaType: "PRINT", unitPrice: 10 });
  const selection = sessionConfigurationLine({
    selectionId: "selection-1",
    unitPrice: 10,
  });
  const linked = linkedProductLine({
    selectionId: "selection-2",
    addOnRef: "addon-linked",
    unitPrice: 10,
  });

  const diff = diffOrderCommitSnapshots({
    baseSnapshot: snapshotFixture({ lines: [] }),
    pendingSnapshot: snapshotFixture({
      lines: [addOn, item, photo, selection, linked],
    }),
  });

  assert.equal(findDiff(diff.lineDiffs, addOn.stableKey).operationalFlags.isAddOnChange, true);
  assert.equal(
    findDiff(diff.lineDiffs, item.stableKey).operationalFlags
      .isPackageItemUpgradeChange,
    true
  );
  assert.equal(findDiff(diff.lineDiffs, photo.stableKey).operationalFlags.isPhotoChange, true);
  assert.equal(
    findDiff(diff.lineDiffs, selection.stableKey).operationalFlags
      .isSessionConfigurationChange,
    true
  );
  assert.equal(
    findDiff(diff.lineDiffs, linked.stableKey).operationalFlags
      .isLinkedProductChange,
    true
  );
});

test("diff marks meaningful zero-net operational changes", () => {
  const baseSnapshot = snapshotFixture({
    lines: [
      packageLine({
        label: "Basic",
        catalogEntityId: "package-basic",
        unitPrice: 100,
      }),
    ],
  });
  const pendingSnapshot = snapshotFixture({
    lines: [
      packageLine({
        label: "Basic Updated",
        catalogEntityId: "package-basic",
        unitPrice: 100,
      }),
    ],
  });

  const diff = diffOrderCommitSnapshots({ baseSnapshot, pendingSnapshot });

  assert.equal(diff.netDelta, 0);
  assert.equal(diff.zeroNetReason, "MEANINGFUL_ZERO_NET_OPERATIONAL_CHANGE");
  assert.equal(diff.lineDiffs[0]?.operationalFlags.isFinanciallyRelevant, false);
  assert.equal(
    diff.lineDiffs[0]?.operationalFlags.isOperationallyMeaningful,
    true
  );
});

test("diff treats equal snapshots as no-op without zero-net reason", () => {
  const snapshot = snapshotFixture({
    lines: [packageLine({ unitPrice: 100 })],
  });

  const diff = diffOrderCommitSnapshots({
    baseSnapshot: snapshot,
    pendingSnapshot: snapshot,
  });

  assert.equal(diff.netDelta, 0);
  assert.equal(diff.zeroNetReason, null);
  assert.equal(diff.lineDiffs[0]?.changeKind, "UNCHANGED");
});

test("diff does not mutate input snapshots", () => {
  const baseSnapshot = snapshotFixture({
    lines: [packageLine({ unitPrice: 100 })],
  });
  const pendingSnapshot = snapshotFixture({
    lines: [packageLine({ unitPrice: 180 })],
  });
  const before = structuredClone({ baseSnapshot, pendingSnapshot });

  diffOrderCommitSnapshots({ baseSnapshot, pendingSnapshot });

  assert.deepEqual({ baseSnapshot, pendingSnapshot }, before);
});

test("preview diff source stays pure and isolated", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/order-commits/order-commit-preview-diff.service.ts"
    ),
    "utf8"
  );

  assert.equal(/@\/lib\/db/.test(source), false);
  assert.equal(/invoiceLineItem/i.test(source), false);
  assert.equal(
    /from\s+["'][^"']*(adjustment-workspace|invoice\.service|payment\.service|refund)[^"']*["']/i.test(
      source
    ),
    false
  );
});

function assertLineChange(
  lineDiffs: ReturnType<typeof diffOrderCommitSnapshots>["lineDiffs"],
  stableKey: string,
  expected: string
): void {
  assert.equal(findDiff(lineDiffs, stableKey).changeKind, expected);
}

function findDiff(
  lineDiffs: ReturnType<typeof diffOrderCommitSnapshots>["lineDiffs"],
  stableKey: string
) {
  const diff = lineDiffs.find((candidate) => candidate.stableKey === stableKey);
  assert.ok(diff, `Expected diff for ${stableKey}`);
  return diff;
}

function snapshotFixture(input: {
  orderId?: string;
  financialCaseId?: string;
  lines?: OrderCommitSnapshotLineV1[];
} = {}): OrderCommitSnapshotV1 {
  const lines = input.lines ?? [];
  const subtotal = money(lines.reduce((sum, line) => sum + line.lineTotal, 0));

  return {
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: input.orderId ?? "order-1",
    financialCaseId: input.financialCaseId ?? "financial-case-1",
    capturedAt: "2026-06-02T10:00:00.000Z",
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines,
    totals: {
      subtotal,
      discountTotal: 0,
      netTotal: subtotal,
    },
  };
}

function packageLine(input: {
  orderPackageId?: string;
  catalogEntityId?: string;
  label?: string;
  quantity?: number;
  unitPrice?: number;
  includedPhotoCount?: number;
  selectedPhotoCount?: number;
} = {}): OrderCommitSnapshotLineV1 {
  const orderPackageId = input.orderPackageId ?? "order-package-1";
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 100;
  const includedPhotoCount = input.includedPhotoCount ?? 10;

  return {
    lineId: `package:${orderPackageId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId: orderPackageId,
    parentOrderPackageId: null,
    catalogEntityId: input.catalogEntityId ?? "package-basic",
    stableKey: `order-package:${orderPackageId}`,
    label: input.label ?? "Basic",
    quantity,
    unitPrice,
    lineTotal: money(unitPrice * quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      includedPhotoCount,
      selectedPhotoCount: input.selectedPhotoCount ?? includedPhotoCount,
      extraDigitalCount: 0,
      extraPrintCount: 0,
      sessionTypeId: "session-type-1",
      sessionTypeName: "Portrait",
      sortOrder: 0,
    },
  };
}

function addOnLine(input: {
  orderAddOnId: string;
  productId?: string;
  quantity?: number;
  unitPrice?: number;
}): OrderCommitSnapshotLineV1 {
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 10;

  return {
    lineId: `addon:${input.orderAddOnId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_ADD_ON,
    orderEntityId: input.orderAddOnId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: input.productId ?? "product-1",
    stableKey: `order-add-on:${input.orderAddOnId}`,
    label: "Add-on",
    quantity,
    unitPrice,
    lineTotal: money(unitPrice * quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: { productId: input.productId ?? "product-1" },
  };
}

function packageItemUpgradeLine(input: {
  orderPackageItemUpgradeId: string;
  packageItemId?: string;
  quantity?: number;
  unitPrice?: number;
}): OrderCommitSnapshotLineV1 {
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 10;

  return {
    lineId: `item-upgrade:${input.orderPackageItemUpgradeId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
    orderEntityId: input.orderPackageItemUpgradeId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: input.packageItemId ?? "package-item-1",
    stableKey: `order-package-item-upgrade:${input.orderPackageItemUpgradeId}`,
    label: "Item Upgrade",
    quantity,
    unitPrice,
    lineTotal: money(unitPrice * quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: { packageItemId: input.packageItemId ?? "package-item-1" },
  };
}

function extraPhotoLine(input: {
  mediaType: "DIGITAL" | "PRINT";
  quantity?: number;
  unitPrice?: number;
}): OrderCommitSnapshotLineV1 {
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 5;
  const mediaKey = input.mediaType.toLowerCase();

  return {
    lineId: `extra-photo:order-package-1:${mediaKey}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_PHOTO_EXTRA,
    orderEntityId: `order-package-1:${input.mediaType}`,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: null,
    stableKey: `order-package:order-package-1:extra-photo:${mediaKey}`,
    label: `Extra photos - ${input.mediaType}`,
    quantity,
    unitPrice,
    lineTotal: money(unitPrice * quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.SESSION_TYPE_EXTRA_PHOTO_PRICING,
    metadata: { mediaType: input.mediaType },
  };
}

function sessionConfigurationLine(input: {
  selectionId: string;
  quantity?: number;
  unitPrice?: number;
  metadata?: Record<string, unknown>;
}): OrderCommitSnapshotLineV1 {
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 0;

  return {
    lineId: `session-config:${input.selectionId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: "configuration-1",
    stableKey: `session-configuration-selection:${input.selectionId}`,
    label: "Session Configuration",
    quantity,
    unitPrice,
    lineTotal: money(unitPrice * quantity),
    priceSource:
      ORDER_COMMIT_PRICE_SOURCE.SESSION_CONFIGURATION_SELECTION_SNAPSHOT,
    metadata: input.metadata ?? { configurationId: "configuration-1" },
  };
}

function linkedProductLine(input: {
  selectionId: string;
  addOnRef: string;
  quantity?: number;
  unitPrice?: number;
}): OrderCommitSnapshotLineV1 {
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 10;

  return {
    lineId: `session-config:${input.selectionId}:addon:${input.addOnRef}`,
    lineKind:
      ORDER_COMMIT_SNAPSHOT_LINE_KIND
        .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: "product-linked",
    stableKey: `session-configuration-selection:${input.selectionId}:add-on:${input.addOnRef}`,
    label: "Linked Product",
    quantity,
    unitPrice,
    lineTotal: money(unitPrice * quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      configurationId: "configuration-linked",
      productId: "product-linked",
    },
  };
}

function money(value: number): number {
  return Number(value.toFixed(3));
}
