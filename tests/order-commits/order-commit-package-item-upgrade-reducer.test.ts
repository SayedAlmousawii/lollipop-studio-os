import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  orderCommitDraftStagingChangeSchema,
  orderCommitSnapshotV1Schema,
  reduceOrderCommitDraftPackageItemUpgrade,
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  type OrderCommitDraftStagingChange,
  type OrderCommitSnapshotLineV1,
  type OrderCommitSnapshotV1,
} from "@/modules/order-commits";

type PackageItemUpgradeStagingChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE }
>;

test("adds a new package item upgrade line from resolved package item data", () => {
  const snapshot = snapshotFixture({ lines: [packageLine()] });
  const before = structuredClone(snapshot);

  const reduced = reduceOrderCommitDraftPackageItemUpgrade(snapshot, {
    change: packageItemUpgradeChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
      action: "ADD",
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      packageItemId: "package-item-album",
      quantity: 2,
      draftPackageItemUpgradeId: "draft:item-upgrade-1",
    }),
    resolvedPackageItem: {
      packageItemId: "package-item-album",
      packageId: "package-catalog-order-package-1",
      label: "Album Upgrade",
      unitPrice: 15.125,
    },
  });

  assert.deepEqual(snapshot, before);
  assert.doesNotThrow(() => orderCommitSnapshotV1Schema.parse(reduced));
  const line = requireLine(reduced, "item-upgrade:draft:item-upgrade-1");
  assert.equal(
    line.lineKind,
    ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE
  );
  assert.equal(
    line.orderEntityKind,
    ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_ITEM_UPGRADE
  );
  assert.equal(line.orderEntityId, "draft:item-upgrade-1");
  assert.equal(line.parentOrderPackageId, "order-package-1");
  assert.equal(line.catalogEntityId, "package-item-album");
  assert.equal(
    line.stableKey,
    "order-package-item-upgrade:draft:item-upgrade-1"
  );
  assert.equal(line.label, "Album Upgrade");
  assert.equal(line.quantity, 2);
  assert.equal(line.unitPrice, 15.125);
  assert.equal(line.lineTotal, 30.25);
  assert.equal(line.priceSource, ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT);
  assert.deepEqual(line.metadata, {
    draftPackageItemUpgradeId: "draft:item-upgrade-1",
    packageItemId: "package-item-album",
  });
  assert.deepEqual(reduced.totals, {
    subtotal: 130.25,
    discountTotal: 0,
    netTotal: 130.25,
  });
});

test("replaces existing package item upgrades by package scope and package item", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      packageItemUpgradeLine({
        orderEntityId: "upgrade-existing",
        packageItemId: "package-item-album",
        label: "Old Album Upgrade",
        quantity: 3,
        unitPrice: 9,
        metadata: {
          packageItemId: "package-item-album",
          notes: "keep staff note",
        },
      }),
    ],
  });

  const reduced = reduceOrderCommitDraftPackageItemUpgrade(snapshot, {
    change: packageItemUpgradeChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
      action: "ADD",
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      packageItemId: "package-item-album",
      quantity: 2,
      draftPackageItemUpgradeId: "draft:item-upgrade-new",
    }),
    resolvedPackageItem: {
      packageItemId: "package-item-album",
      packageId: "package-catalog-order-package-1",
      label: "Basic Album to Premium Album",
      unitPrice: 99,
    },
  });

  const line = requireLine(reduced, "item-upgrade:upgrade-existing");
  assert.equal(line.lineId, "item-upgrade:upgrade-existing");
  assert.equal(line.orderEntityId, "upgrade-existing");
  assert.equal(line.stableKey, "order-package-item-upgrade:upgrade-existing");
  assert.equal(line.catalogEntityId, "package-item-album");
  assert.equal(line.label, "Basic Album to Premium Album");
  assert.equal(line.quantity, 2);
  assert.equal(line.unitPrice, 99);
  assert.equal(line.lineTotal, 198);
  assert.deepEqual(line.metadata, {
    packageItemId: "package-item-album",
    notes: "keep staff note",
  });
  assert.equal(
    reduced.lines.filter(
      (candidate) =>
        candidate.lineKind ===
        ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE
    ).length,
    1
  );
  assert.deepEqual(reduced.totals, {
    subtotal: 298,
    discountTotal: 0,
    netTotal: 298,
  });
});

test("does not merge the same package item across different package scopes", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine({ orderEntityId: "order-package-1" }),
      packageLine({ orderEntityId: "order-package-2" }),
      packageItemUpgradeLine({
        orderEntityId: "upgrade-package-1",
        parentOrderPackageId: "order-package-1",
        packageItemId: "package-item-album",
        quantity: 1,
      }),
    ],
  });

  const reduced = reduceOrderCommitDraftPackageItemUpgrade(snapshot, {
    change: packageItemUpgradeChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
      action: "ADD",
      parentPackageTarget: { stableKey: "order-package:order-package-2" },
      packageItemId: "package-item-album",
      quantity: 3,
      draftPackageItemUpgradeId: "draft:item-upgrade-package-2",
    }),
    resolvedPackageItem: {
      packageItemId: "package-item-album",
      packageId: "package-catalog-order-package-2",
      label: "Album Upgrade",
      unitPrice: 20,
    },
  });

  assert.equal(requireLine(reduced, "item-upgrade:upgrade-package-1").quantity, 1);
  assert.equal(
    requireLine(reduced, "item-upgrade:draft:item-upgrade-package-2").quantity,
    3
  );
  assert.equal(
    reduced.lines.filter(
      (candidate) =>
        candidate.lineKind ===
        ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE
    ).length,
    2
  );
});

test("updates package item upgrade quantity exactly while preserving stored unit price", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      packageItemUpgradeLine({
        orderEntityId: "upgrade-existing",
        packageItemId: "package-item-album",
        quantity: 3,
        unitPrice: 7.5,
      }),
    ],
  });

  const reduced = reduceOrderCommitDraftPackageItemUpgrade(snapshot, {
    change: packageItemUpgradeChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
      action: "UPDATE_QUANTITY",
      target: { stableKey: "order-package-item-upgrade:upgrade-existing" },
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      quantity: 4,
    }),
  });

  const line = requireLine(reduced, "item-upgrade:upgrade-existing");
  assert.equal(line.quantity, 4);
  assert.equal(line.unitPrice, 7.5);
  assert.equal(line.lineTotal, 30);
});

test("removes a package item upgrade when updated to zero quantity", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      packageItemUpgradeLine({
        orderEntityId: "upgrade-existing",
        packageItemId: "package-item-album",
      }),
    ],
  });

  const reduced = reduceOrderCommitDraftPackageItemUpgrade(snapshot, {
    change: packageItemUpgradeChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
      action: "UPDATE_QUANTITY",
      target: { lineId: "item-upgrade:upgrade-existing" },
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      quantity: 0,
    }),
  });

  assert.equal(
    reduced.lines.some((line) => line.lineId === "item-upgrade:upgrade-existing"),
    false
  );
});

test("removes a draft package item upgrade by service-provided draft entity id", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      packageItemUpgradeLine({
        orderEntityId: "draft:item-upgrade-existing",
        packageItemId: "package-item-album",
      }),
    ],
  });

  const reduced = reduceOrderCommitDraftPackageItemUpgrade(snapshot, {
    change: packageItemUpgradeChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
      action: "REMOVE",
      target: { draftEntityId: "draft:item-upgrade-existing" },
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
    }),
  });

  assert.equal(
    reduced.lines.some(
      (line) => line.orderEntityId === "draft:item-upgrade-existing"
    ),
    false
  );
});

test("rejects package item upgrades outside the targeted package scope", () => {
  const snapshot = snapshotFixture({ lines: [packageLine()] });

  assert.throws(
    () =>
      reduceOrderCommitDraftPackageItemUpgrade(snapshot, {
        change: packageItemUpgradeChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
          action: "ADD",
          parentPackageTarget: { stableKey: "order-package:order-package-1" },
          packageItemId: "package-item-other",
          quantity: 1,
          draftPackageItemUpgradeId: "draft:item-upgrade-other",
        }),
        resolvedPackageItem: {
          packageItemId: "package-item-other",
          packageId: "package-catalog-other",
          label: "Other Package Upgrade",
          unitPrice: 25,
        },
      }),
    /is not scoped to package/
  );
});

test("rejects target package scope mismatches on updates and removals", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine({ orderEntityId: "order-package-1" }),
      packageLine({ orderEntityId: "order-package-2" }),
      packageItemUpgradeLine({
        orderEntityId: "upgrade-package-1",
        parentOrderPackageId: "order-package-1",
        packageItemId: "package-item-album",
      }),
    ],
  });

  assert.throws(
    () =>
      reduceOrderCommitDraftPackageItemUpgrade(snapshot, {
        change: packageItemUpgradeChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
          action: "UPDATE_QUANTITY",
          target: { stableKey: "order-package-item-upgrade:upgrade-package-1" },
          parentPackageTarget: { stableKey: "order-package:order-package-2" },
          quantity: 2,
        }),
      }),
    /is not scoped to package order-package-2/
  );

  assert.throws(
    () =>
      reduceOrderCommitDraftPackageItemUpgrade(snapshot, {
        change: packageItemUpgradeChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
          action: "REMOVE",
          target: { stableKey: "order-package-item-upgrade:upgrade-package-1" },
          parentPackageTarget: { stableKey: "order-package:order-package-2" },
        }),
      }),
    /is not scoped to package order-package-2/
  );
});

test("rejects contradictory package item upgrade target identity fields", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      packageItemUpgradeLine({
        orderEntityId: "upgrade-existing",
        packageItemId: "package-item-album",
      }),
      packageItemUpgradeLine({
        orderEntityId: "upgrade-other",
        packageItemId: "package-item-frame",
      }),
    ],
  });

  assert.throws(
    () =>
      reduceOrderCommitDraftPackageItemUpgrade(snapshot, {
        change: packageItemUpgradeChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
          action: "UPDATE_QUANTITY",
          target: {
            stableKey: "order-package-item-upgrade:upgrade-existing",
            lineId: "item-upgrade:upgrade-other",
          },
          parentPackageTarget: { stableKey: "order-package:order-package-1" },
          quantity: 2,
        }),
      }),
    /matched multiple lines from contradictory target identity fields/
  );
});

test("package item upgrade reducer source stays pure and invoice-independent", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/order-commits/order-commit-package-item-upgrade-reducer.ts"
    ),
    "utf8"
  );

  assert.doesNotMatch(source, /invoiceLineItem/i);
  assert.doesNotMatch(source, /from\s+["']@\/lib\/db["']|import\(["']@\/lib\/db["']\)/);
});

function packageItemUpgradeChange(
  input: unknown
): PackageItemUpgradeStagingChange {
  const parsed = orderCommitDraftStagingChangeSchema.parse(
    input &&
      typeof input === "object" &&
      "action" in input &&
      input.action === "ADD" &&
      !("toProductId" in input)
      ? { ...input, toProductId: "product-replacement" }
      : input
  );
  assert.equal(
    parsed.domain,
    ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE
  );
  return parsed as PackageItemUpgradeStagingChange;
}

function snapshotFixture(input: {
  lines: OrderCommitSnapshotLineV1[];
}): OrderCommitSnapshotV1 {
  return {
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-01T00:00:00.000Z",
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines: input.lines,
    totals: {
      subtotal: 0,
      discountTotal: 0,
      netTotal: 0,
    },
  };
}

function packageLine(
  overrides: Partial<OrderCommitSnapshotLineV1> = {}
): OrderCommitSnapshotLineV1 {
  const orderEntityId = overrides.orderEntityId ?? "order-package-1";
  return {
    lineId: `package:${orderEntityId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId,
    parentOrderPackageId: null,
    catalogEntityId: `package-catalog-${orderEntityId}`,
    stableKey: `order-package:${orderEntityId}`,
    label: `Package ${orderEntityId}`,
    quantity: 1,
    unitPrice: 100,
    lineTotal: 100,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {},
    ...overrides,
  };
}

function packageItemUpgradeLine(
  input: Partial<OrderCommitSnapshotLineV1> & {
    orderEntityId: string;
    packageItemId: string;
  }
): OrderCommitSnapshotLineV1 {
  const parentOrderPackageId = input.parentOrderPackageId ?? "order-package-1";
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 20;
  return {
    lineId: `item-upgrade:${input.orderEntityId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
    orderEntityId: input.orderEntityId,
    parentOrderPackageId,
    catalogEntityId: input.packageItemId,
    stableKey: `order-package-item-upgrade:${input.orderEntityId}`,
    label: `Package Item Upgrade ${input.orderEntityId}`,
    quantity,
    unitPrice,
    lineTotal: Number((unitPrice * quantity).toFixed(3)),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      packageItemId: input.packageItemId,
    },
    ...input,
  };
}

function requireLine(
  snapshot: OrderCommitSnapshotV1,
  lineId: string
): OrderCommitSnapshotLineV1 {
  const line = snapshot.lines.find((candidate) => candidate.lineId === lineId);
  assert.ok(line, `Expected line ${lineId}`);
  return line;
}
