import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  orderCommitDraftStagingChangeSchema,
  orderCommitSnapshotV1Schema,
  reduceOrderCommitDraftPackage,
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  type OrderCommitDraftStagingChange,
  type OrderCommitSnapshotLineV1,
  type OrderCommitSnapshotV1,
  type ResolvedOrderCommitDraftPackage,
} from "@/modules/order-commits";

type PackageStagingChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE }
>;

test("updates package identity and locks resolved package pricing", () => {
  const snapshot = snapshotFixture({ lines: [packageLine()] });
  const before = structuredClone(snapshot);

  const reduced = reduceOrderCommitDraftPackage(snapshot, {
    change: packageChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
      action: "CHANGE_PACKAGE",
      target: { stableKey: "order-package:order-package-1" },
      packageId: "package-premium",
      sessionTypeId: "session-type-1",
    }),
    resolvedPackage: resolvedPackage({
      packageId: "package-premium",
      packageName: "Premium Package",
      packagePrice: 150.125,
      includedPhotoCount: 10,
    }),
  });

  assert.deepEqual(snapshot, before);
  assert.doesNotThrow(() => orderCommitSnapshotV1Schema.parse(reduced));

  const line = requireLine(reduced, "package:order-package-1");
  assert.equal(line.lineKind, ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE);
  assert.equal(line.orderEntityKind, ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE);
  assert.equal(line.orderEntityId, "order-package-1");
  assert.equal(line.catalogEntityId, "package-premium");
  assert.equal(line.stableKey, "order-package:order-package-1");
  assert.equal(line.label, "Premium Package");
  assert.equal(line.quantity, 1);
  assert.equal(line.unitPrice, 150.125);
  assert.equal(line.lineTotal, 150.125);
  assert.equal(line.priceSource, ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT);
  assert.deepEqual(line.metadata, {
    bookingPackageId: "booking-package-1",
    currentPackageId: "package-premium",
    currentPackageNameSnapshot: "Premium Package",
    extraDigitalCount: 1,
    extraPrintCount: 0,
    finalPackagePriceSnapshot: 150.125,
    includedPhotoCount: 10,
    originalPackageId: "package-original",
    originalPackageNameSnapshot: "Original Package",
    originalPackagePriceSnapshot: 80,
    selectedPhotoCount: 11,
    sessionTypeId: "session-type-1",
    sessionTypeName: "Portrait",
    sortOrder: 1,
  });
  assert.deepEqual(reduced.totals, {
    subtotal: 150.125,
    discountTotal: 0,
    netTotal: 150.125,
  });
});

test("removes scoped package item upgrades only when package identity changes", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine({ orderEntityId: "order-package-1" }),
      packageLine({ orderEntityId: "order-package-2" }),
      packageItemUpgradeLine({
        orderEntityId: "upgrade-package-1",
        parentOrderPackageId: "order-package-1",
      }),
      packageItemUpgradeLine({
        orderEntityId: "upgrade-package-2",
        parentOrderPackageId: "order-package-2",
      }),
    ],
  });

  const reduced = reduceOrderCommitDraftPackage(snapshot, {
    change: packageChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
      action: "CHANGE_PACKAGE",
      target: { stableKey: "order-package:order-package-1" },
      packageId: "package-premium",
      sessionTypeId: "session-type-1",
    }),
    resolvedPackage: resolvedPackage({
      packageId: "package-premium",
      packageName: "Premium Package",
      includedPhotoCount: 10,
    }),
  });

  assert.equal(
    reduced.lines.some((line) => line.lineId === "item-upgrade:upgrade-package-1"),
    false
  );
  assert.ok(requireLine(reduced, "item-upgrade:upgrade-package-2"));
});

test("preserves scoped package item upgrades when package identity is unchanged", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine({ catalogEntityId: "package-current" }),
      packageItemUpgradeLine({
        orderEntityId: "upgrade-package-1",
        parentOrderPackageId: "order-package-1",
      }),
    ],
  });

  const reduced = reduceOrderCommitDraftPackage(snapshot, {
    change: packageChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
      action: "CHANGE_PACKAGE",
      target: { stableKey: "order-package:order-package-1" },
      packageId: "package-current",
      sessionTypeId: "session-type-1",
    }),
    resolvedPackage: resolvedPackage({
      packageId: "package-current",
      packageName: "Current Package Refreshed",
      packagePrice: 111,
      includedPhotoCount: 10,
    }),
  });

  assert.ok(requireLine(reduced, "item-upgrade:upgrade-package-1"));
  assert.equal(requireLine(reduced, "package:order-package-1").unitPrice, 111);
});

test("preserves true add-ons, valid session configurations, linked pairs, and photo lines", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      addOnLine(),
      sessionConfigurationLine({
        selectionId: "selection-backdrop",
        configurationId: "configuration-backdrop",
        validPackageIds: ["package-premium"],
        validSessionTypeIds: ["session-type-1"],
      }),
      sessionConfigurationLine({
        selectionId: "selection-album",
        configurationId: "configuration-album",
        linkedOrderAddOnId: "addon-album",
        snapshotLinkedProductId: "product-album",
      }),
      linkedProductAddOnLine({
        selectionId: "selection-album",
        orderAddOnId: "addon-album",
        productId: "product-album",
      }),
      extraPhotoLine({ mediaType: "DIGITAL", quantity: 1 }),
    ],
  });

  const reduced = reduceOrderCommitDraftPackage(snapshot, {
    change: packageChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
      action: "CHANGE_PACKAGE",
      target: { stableKey: "order-package:order-package-1" },
      packageId: "package-premium",
      sessionTypeId: "session-type-1",
    }),
    resolvedPackage: resolvedPackage({
      packageId: "package-premium",
      packageName: "Premium Package",
      packagePrice: 150,
      includedPhotoCount: 10,
    }),
  });

  assert.deepEqual(requireLine(reduced, "addon:addon-1"), addOnLine());
  assert.ok(requireLine(reduced, "session-config:selection-backdrop"));
  assert.ok(requireLine(reduced, "session-config:selection-album"));
  assert.ok(requireLine(reduced, "session-config:selection-album:addon:addon-album"));
  assert.ok(requireLine(reduced, "extra-photo:order-package-1:digital"));
  const packageResult = requireLine(reduced, "package:order-package-1");
  assert.equal(packageResult.metadata.selectedPhotoCount, 11);
  assert.equal(packageResult.metadata.extraDigitalCount, 1);
  assert.equal(packageResult.metadata.extraPrintCount, 0);
});

test("rejects invalid session configurations instead of removing them", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine(),
      sessionConfigurationLine({
        selectionId: "selection-invalid",
        configurationId: "configuration-invalid",
        validPackageIds: ["package-other"],
      }),
    ],
  });

  assert.throws(
    () =>
      reduceOrderCommitDraftPackage(snapshot, {
        change: packageChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
          action: "CHANGE_PACKAGE",
          target: { stableKey: "order-package:order-package-1" },
          packageId: "package-premium",
          sessionTypeId: "session-type-1",
        }),
        resolvedPackage: resolvedPackage({
          packageId: "package-premium",
          includedPhotoCount: 10,
        }),
      }),
    /session configuration .* is invalid/
  );
});

test("preserves selected and extra photo counts and rejects invariant violations", () => {
  const snapshot = snapshotFixture({ lines: [packageLine()] });

  const reduced = reduceOrderCommitDraftPackage(snapshot, {
    change: packageChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
      action: "CHANGE_PACKAGE",
      target: { stableKey: "order-package:order-package-1" },
      packageId: "package-current",
      sessionTypeId: "session-type-1",
    }),
    resolvedPackage: resolvedPackage({
      packageId: "package-current",
      packageName: "Current Package",
      includedPhotoCount: 10,
    }),
  });

  const packageResult = requireLine(reduced, "package:order-package-1");
  assert.equal(packageResult.metadata.selectedPhotoCount, 11);
  assert.equal(packageResult.metadata.extraDigitalCount, 1);
  assert.equal(packageResult.metadata.extraPrintCount, 0);

  assert.throws(
    () =>
      reduceOrderCommitDraftPackage(snapshot, {
        change: packageChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
          action: "CHANGE_PACKAGE",
          target: { stableKey: "order-package:order-package-1" },
          packageId: "package-current",
          sessionTypeId: "session-type-1",
        }),
        resolvedPackage: resolvedPackage({
          packageId: "package-current",
          includedPhotoCount: 9,
        }),
      }),
    /existing extra photo counts are invalid/
  );
});

test("rejects cross-session package changes", () => {
  const snapshot = snapshotFixture({ lines: [packageLine()] });

  assert.throws(
    () =>
      reduceOrderCommitDraftPackage(snapshot, {
        change: packageChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
          action: "CHANGE_PACKAGE",
          target: { stableKey: "order-package:order-package-1" },
          packageId: "package-other-session",
          sessionTypeId: "session-type-2",
        }),
        resolvedPackage: resolvedPackage({
          packageId: "package-other-session",
          sessionType: { id: "session-type-2", name: "Wedding" },
        }),
      }),
    /cross-session package changes are not supported/
  );
});

test("rejects missing and duplicate package targets", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine({ orderEntityId: "order-package-1" }),
      packageLine({ orderEntityId: "order-package-2" }),
    ],
  });

  assert.throws(
    () =>
      reduceOrderCommitDraftPackage(snapshot, {
        change: packageChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
          action: "CHANGE_PACKAGE",
          target: { stableKey: "order-package:missing" },
          packageId: "package-premium",
        }),
        resolvedPackage: resolvedPackage({ packageId: "package-premium" }),
      }),
    /package target not found/
  );

  assert.throws(
    () =>
      reduceOrderCommitDraftPackage(snapshot, {
        change: packageChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
          action: "CHANGE_PACKAGE",
          target: {
            stableKey: "order-package:order-package-1",
            orderEntityId: "order-package-2",
          },
          packageId: "package-premium",
        }),
        resolvedPackage: resolvedPackage({ packageId: "package-premium" }),
      }),
    /matched multiple lines/
  );
});

test("package reducer source stays pure and lookup-free", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/order-commits/order-commit-package-reducer.ts"
    ),
    "utf8"
  );

  assert.doesNotMatch(source, /invoiceLineItem/i);
  assert.doesNotMatch(source, /from\s+["']@\/lib\/db["']|import\(["']@\/lib\/db["']\)/);
  assert.doesNotMatch(source, /order-commit\.service/);
  assert.doesNotMatch(source, /\.service["']/);
  assert.doesNotMatch(
    source,
    /invoice|payment|refund|credit-note|adjustment-workspace/i
  );
});

function packageChange(input: unknown): PackageStagingChange {
  const parsed = orderCommitDraftStagingChangeSchema.parse(input);
  assert.equal(parsed.domain, ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE);
  return parsed as PackageStagingChange;
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

function resolvedPackage(
  overrides: Partial<ResolvedOrderCommitDraftPackage> = {}
): ResolvedOrderCommitDraftPackage {
  return {
    packageId: "package-premium",
    packageName: "Premium Package",
    packagePrice: 150,
    sessionType: { id: "session-type-1", name: "Portrait" },
    includedPhotoCount: 10,
    ...overrides,
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
    catalogEntityId: "package-current",
    stableKey: `order-package:${orderEntityId}`,
    label: "Current Package",
    quantity: 1,
    unitPrice: 100,
    lineTotal: 100,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: packageMetadata(),
    ...overrides,
  };
}

function packageMetadata(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    originalPackageId: "package-original",
    originalPackageNameSnapshot: "Original Package",
    originalPackagePriceSnapshot: 80,
    bookingPackageId: "booking-package-1",
    selectedPhotoCount: 11,
    includedPhotoCount: 10,
    extraDigitalCount: 1,
    extraPrintCount: 0,
    sessionTypeId: "session-type-1",
    sessionTypeName: "Portrait",
    sortOrder: 1,
    ...overrides,
  };
}

function packageItemUpgradeLine(input: {
  orderEntityId: string;
  parentOrderPackageId: string;
}): OrderCommitSnapshotLineV1 {
  return {
    lineId: `item-upgrade:${input.orderEntityId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
    orderEntityId: input.orderEntityId,
    parentOrderPackageId: input.parentOrderPackageId,
    catalogEntityId: "package-item-1",
    stableKey: `order-package-item-upgrade:${input.orderEntityId}`,
    label: "Album Upgrade",
    quantity: 1,
    unitPrice: 20,
    lineTotal: 20,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: { packageItemId: "package-item-1" },
  };
}

function addOnLine(): OrderCommitSnapshotLineV1 {
  return {
    lineId: "addon:addon-1",
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_ADD_ON,
    orderEntityId: "addon-1",
    parentOrderPackageId: "order-package-1",
    catalogEntityId: "product-addon",
    stableKey: "order-add-on:addon-1",
    label: "Canvas Add-On",
    quantity: 2,
    unitPrice: 12,
    lineTotal: 24,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {},
  };
}

function sessionConfigurationLine(input: {
  selectionId: string;
  configurationId: string;
  linkedOrderAddOnId?: string;
  snapshotLinkedProductId?: string | null;
  validPackageIds?: string[];
  validSessionTypeIds?: string[];
}): OrderCommitSnapshotLineV1 {
  return {
    lineId: `session-config:${input.selectionId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: input.configurationId,
    stableKey: `session-configuration-selection:${input.selectionId}`,
    label: "Backdrop",
    quantity: 1,
    unitPrice: 0,
    lineTotal: 0,
    priceSource:
      ORDER_COMMIT_PRICE_SOURCE.SESSION_CONFIGURATION_SELECTION_SNAPSHOT,
    metadata: {
      configurationId: input.configurationId,
      optionId: "option-1",
      numericValue: null,
      textValue: null,
      snapshotOptionLabel: "Gold",
      snapshotConfigurationCode: "BACKDROP",
      snapshotLabel: "Backdrop",
      snapshotPriceDelta: 0,
      snapshotFinancialBehavior: "OPERATIONAL",
      snapshotInputType: "SELECT",
      snapshotPricingMode: input.linkedOrderAddOnId ? "LINKED_PRODUCT" : "NONE",
      snapshotLinkedProductId: input.snapshotLinkedProductId ?? null,
      orderAddOnId: input.linkedOrderAddOnId ?? null,
      ...(input.validPackageIds ? { validPackageIds: input.validPackageIds } : {}),
      ...(input.validSessionTypeIds
        ? { validSessionTypeIds: input.validSessionTypeIds }
        : {}),
    },
  };
}

function linkedProductAddOnLine(input: {
  selectionId: string;
  orderAddOnId: string;
  productId: string;
}): OrderCommitSnapshotLineV1 {
  return {
    lineId: `session-config:${input.selectionId}:addon:${input.orderAddOnId}`,
    lineKind:
      ORDER_COMMIT_SNAPSHOT_LINE_KIND
        .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: input.productId,
    stableKey: `session-configuration-selection:${input.selectionId}:add-on:${input.orderAddOnId}`,
    label: "Linked Product",
    quantity: 1,
    unitPrice: 30,
    lineTotal: 30,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      configurationId: "configuration-album",
      optionId: "option-album",
      numericValue: null,
      textValue: null,
      snapshotOptionLabel: "Album",
      snapshotConfigurationCode: "ALBUM",
      snapshotLabel: "Album",
      snapshotPriceDelta: 0,
      snapshotFinancialBehavior: "FINANCIAL",
      snapshotInputType: "SELECT",
      snapshotPricingMode: "LINKED_PRODUCT",
      snapshotLinkedProductId: input.productId,
      orderAddOnId: input.orderAddOnId,
      productId: input.productId,
    },
  };
}

function extraPhotoLine(input: {
  mediaType: "DIGITAL" | "PRINT";
  quantity: number;
}): OrderCommitSnapshotLineV1 {
  const mediaKey = input.mediaType.toLowerCase();
  const unitPrice = input.mediaType === "DIGITAL" ? 5 : 7.5;
  return {
    lineId: `extra-photo:order-package-1:${mediaKey}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_PHOTO_EXTRA,
    orderEntityId: `order-package-1:${input.mediaType}`,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: null,
    stableKey: `order-package:order-package-1:extra-photo:${mediaKey}`,
    label: `Extra photos - ${input.mediaType === "DIGITAL" ? "Digital" : "Print"}`,
    quantity: input.quantity,
    unitPrice,
    lineTotal: Number((unitPrice * input.quantity).toFixed(3)),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.SESSION_TYPE_EXTRA_PHOTO_PRICING,
    metadata: {
      mediaType: input.mediaType,
      sessionTypeId: "session-type-1",
    },
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
