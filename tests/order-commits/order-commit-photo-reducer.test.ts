import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  orderCommitDraftStagingChangeSchema,
  orderCommitSnapshotV1Schema,
  reduceOrderCommitDraftPhoto,
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

type PhotoStagingChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO }
>;

test("creates media-specific extra-photo lines from resolved pricing", () => {
  const snapshot = snapshotFixture({ lines: [packageLine()] });
  const before = structuredClone(snapshot);

  const reduced = reduceOrderCommitDraftPhoto(snapshot, {
    change: photoChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
      action: "SET_COUNTS",
      target: { stableKey: "order-package:order-package-1" },
      selectedPhotoCount: 13,
      extraDigitalCount: 2,
      extraPrintCount: 1,
    }),
    resolvedExtraPhotoPricing: {
      DIGITAL: { unitPrice: 5 },
      PRINT: { unitPrice: 7.5 },
    },
  });

  assert.deepEqual(snapshot, before);
  assert.doesNotThrow(() => orderCommitSnapshotV1Schema.parse(reduced));

  const packageResult = requireLine(reduced, "package:order-package-1");
  assert.equal(packageResult.metadata.selectedPhotoCount, 13);
  assert.equal(packageResult.metadata.extraDigitalCount, 2);
  assert.equal(packageResult.metadata.extraPrintCount, 1);

  const digitalLine = requireLine(reduced, "extra-photo:order-package-1:digital");
  assert.equal(
    digitalLine.lineKind,
    ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA
  );
  assert.equal(
    digitalLine.orderEntityKind,
    ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_PHOTO_EXTRA
  );
  assert.equal(digitalLine.orderEntityId, "order-package-1:DIGITAL");
  assert.equal(digitalLine.parentOrderPackageId, "order-package-1");
  assert.equal(digitalLine.catalogEntityId, null);
  assert.equal(
    digitalLine.stableKey,
    "order-package:order-package-1:extra-photo:digital"
  );
  assert.equal(digitalLine.label, "Extra photos - Digital (Package order-package-1)");
  assert.equal(digitalLine.quantity, 2);
  assert.equal(digitalLine.unitPrice, 5);
  assert.equal(digitalLine.lineTotal, 10);
  assert.equal(
    digitalLine.priceSource,
    ORDER_COMMIT_PRICE_SOURCE.SESSION_TYPE_EXTRA_PHOTO_PRICING
  );
  assert.deepEqual(digitalLine.metadata, {
    mediaType: "DIGITAL",
    sessionTypeId: "session-type-1",
  });

  const printLine = requireLine(reduced, "extra-photo:order-package-1:print");
  assert.equal(printLine.quantity, 1);
  assert.equal(printLine.unitPrice, 7.5);
  assert.equal(printLine.lineTotal, 7.5);
  assert.deepEqual(printLine.metadata, {
    mediaType: "PRINT",
    sessionTypeId: "session-type-1",
  });
  assert.deepEqual(reduced.totals, {
    subtotal: 117.5,
    discountTotal: 0,
    netTotal: 117.5,
  });
});

test("keeps photo changes isolated to the targeted package", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine({ orderEntityId: "order-package-1" }),
      extraPhotoLine({
        parentOrderPackageId: "order-package-1",
        mediaType: "DIGITAL",
        quantity: 1,
      }),
      packageLine({ orderEntityId: "order-package-2" }),
      extraPhotoLine({
        parentOrderPackageId: "order-package-2",
        mediaType: "DIGITAL",
        quantity: 2,
      }),
    ],
  });

  const reduced = reduceOrderCommitDraftPhoto(snapshot, {
    change: photoChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
      action: "SET_COUNTS",
      target: { stableKey: "order-package:order-package-2" },
      selectedPhotoCount: 13,
      extraDigitalCount: 1,
      extraPrintCount: 2,
    }),
    resolvedExtraPhotoPricing: {
      PRINT: { unitPrice: 9 },
    },
  });

  assert.equal(
    requireLine(reduced, "package:order-package-1").metadata.selectedPhotoCount,
    11
  );
  assert.equal(
    requireLine(reduced, "extra-photo:order-package-1:digital").quantity,
    1
  );
  assert.equal(
    requireLine(reduced, "package:order-package-2").metadata.selectedPhotoCount,
    13
  );
  assert.equal(
    requireLine(reduced, "extra-photo:order-package-2:digital").quantity,
    1
  );
  assert.equal(
    requireLine(reduced, "extra-photo:order-package-2:print").quantity,
    2
  );
});

test("maintains digital and print extra-photo counts independently", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine({
        metadata: packageMetadata({
          selectedPhotoCount: 13,
          extraDigitalCount: 2,
          extraPrintCount: 1,
        }),
      }),
      extraPhotoLine({ mediaType: "DIGITAL", quantity: 2, unitPrice: 4 }),
      extraPhotoLine({ mediaType: "PRINT", quantity: 1, unitPrice: 8 }),
    ],
  });

  const reduced = reduceOrderCommitDraftPhoto(snapshot, {
    change: photoChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
      action: "SET_COUNTS",
      target: { stableKey: "order-package:order-package-1" },
      selectedPhotoCount: 12,
      extraDigitalCount: 0,
      extraPrintCount: 2,
    }),
  });

  assert.equal(
    reduced.lines.some((line) => line.lineId === "extra-photo:order-package-1:digital"),
    false
  );
  const printLine = requireLine(reduced, "extra-photo:order-package-1:print");
  assert.equal(printLine.quantity, 2);
  assert.equal(printLine.unitPrice, 8);
  assert.equal(printLine.lineTotal, 16);
});

test("preserves existing extra-photo unit prices during quantity updates", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine({
        metadata: packageMetadata({
          selectedPhotoCount: 11,
          extraDigitalCount: 1,
          extraPrintCount: 0,
        }),
      }),
      extraPhotoLine({ mediaType: "DIGITAL", quantity: 1, unitPrice: 4.444 }),
    ],
  });

  const reduced = reduceOrderCommitDraftPhoto(snapshot, {
    change: photoChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
      action: "SET_COUNTS",
      target: { stableKey: "order-package:order-package-1" },
      selectedPhotoCount: 13,
      extraDigitalCount: 3,
      extraPrintCount: 0,
    }),
    resolvedExtraPhotoPricing: {
      DIGITAL: { unitPrice: 99 },
    },
  });

  const digitalLine = requireLine(reduced, "extra-photo:order-package-1:digital");
  assert.equal(digitalLine.quantity, 3);
  assert.equal(digitalLine.unitPrice, 4.444);
  assert.equal(digitalLine.lineTotal, 13.332);
});

test("removes media-specific extra-photo lines at zero quantity", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine({
        metadata: packageMetadata({
          selectedPhotoCount: 12,
          extraDigitalCount: 1,
          extraPrintCount: 1,
        }),
      }),
      extraPhotoLine({ mediaType: "DIGITAL", quantity: 1 }),
      extraPhotoLine({ mediaType: "PRINT", quantity: 1 }),
    ],
  });

  const reduced = reduceOrderCommitDraftPhoto(snapshot, {
    change: photoChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
      action: "SET_COUNTS",
      target: { stableKey: "order-package:order-package-1" },
      selectedPhotoCount: 10,
      extraDigitalCount: 0,
      extraPrintCount: 0,
    }),
  });

  assert.equal(
    reduced.lines.some(
      (line) => line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA
    ),
    false
  );
  const packageResult = requireLine(reduced, "package:order-package-1");
  assert.equal(packageResult.metadata.selectedPhotoCount, 10);
  assert.equal(packageResult.metadata.extraDigitalCount, 0);
  assert.equal(packageResult.metadata.extraPrintCount, 0);
});

test("enforces selected photo parity invariants", () => {
  const snapshot = snapshotFixture({ lines: [packageLine()] });

  assert.throws(
    () =>
      reduceOrderCommitDraftPhoto(snapshot, {
        change: photoChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
          action: "SET_COUNTS",
          target: { stableKey: "order-package:order-package-1" },
          selectedPhotoCount: 9,
          extraDigitalCount: 0,
          extraPrintCount: 0,
        }),
      }),
    /selectedPhotoCount must be greater than or equal/
  );

  assert.throws(
    () =>
      reduceOrderCommitDraftPhoto(snapshot, {
        change: photoChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
          action: "SET_COUNTS",
          target: { stableKey: "order-package:order-package-1" },
          selectedPhotoCount: 12,
          extraDigitalCount: 1,
          extraPrintCount: 0,
        }),
      }),
    /extraDigitalCount plus extraPrintCount must equal/
  );
});

test("does not use order-level selectedPhotoCount cache as draft truth", () => {
  const snapshot = {
    ...snapshotFixture({ lines: [packageLine()] }),
    selectedPhotoCount: 999,
  } as OrderCommitSnapshotV1 & { selectedPhotoCount: number };

  const reduced = reduceOrderCommitDraftPhoto(snapshot, {
    change: photoChange({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
      action: "SET_COUNTS",
      target: { stableKey: "order-package:order-package-1" },
      selectedPhotoCount: 12,
      extraDigitalCount: 2,
      extraPrintCount: 0,
    }),
    resolvedExtraPhotoPricing: {
      DIGITAL: { unitPrice: 5 },
    },
  });

  assert.equal(requireLine(reduced, "package:order-package-1").metadata.selectedPhotoCount, 12);
  assert.equal(requireLine(reduced, "extra-photo:order-package-1:digital").quantity, 2);
});

test("requires resolved pricing only for newly created media lines", () => {
  const snapshot = snapshotFixture({
    lines: [
      packageLine({
        metadata: packageMetadata({
          selectedPhotoCount: 11,
          extraDigitalCount: 1,
          extraPrintCount: 0,
        }),
      }),
      extraPhotoLine({ mediaType: "DIGITAL", quantity: 1 }),
    ],
  });

  assert.doesNotThrow(() =>
    reduceOrderCommitDraftPhoto(snapshot, {
      change: photoChange({
        domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
        action: "SET_COUNTS",
        target: { stableKey: "order-package:order-package-1" },
        selectedPhotoCount: 12,
        extraDigitalCount: 2,
        extraPrintCount: 0,
      }),
    })
  );

  assert.throws(
    () =>
      reduceOrderCommitDraftPhoto(snapshot, {
        change: photoChange({
          domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
          action: "SET_COUNTS",
          target: { stableKey: "order-package:order-package-1" },
          selectedPhotoCount: 12,
          extraDigitalCount: 1,
          extraPrintCount: 1,
        }),
      }),
    /creating PRINT extra-photo line requires resolved pricing/
  );
});

test("photo reducer source stays pure and invoice-independent", () => {
  const source = readFileSync(
    join(process.cwd(), "src/modules/order-commits/order-commit-photo-reducer.ts"),
    "utf8"
  );

  assert.doesNotMatch(source, /invoiceLineItem/i);
  assert.doesNotMatch(source, /from\s+["']@\/lib\/db["']|import\(["']@\/lib\/db["']\)/);
  assert.doesNotMatch(source, /order-commit\.service/);
  assert.doesNotMatch(source, /sessionTypeExtraPhotoPricing/);
  assert.doesNotMatch(source, /\bfindMany\b|\bfindUnique\b|\bprisma\b/i);
});

function photoChange(input: unknown): PhotoStagingChange {
  const parsed = orderCommitDraftStagingChangeSchema.parse(input);
  assert.equal(parsed.domain, ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO);
  return parsed as PhotoStagingChange;
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
    metadata: packageMetadata(),
    ...overrides,
  };
}

function packageMetadata(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    includedPhotoCount: 10,
    selectedPhotoCount: 11,
    extraDigitalCount: 1,
    extraPrintCount: 0,
    sessionTypeId: "session-type-1",
    ...overrides,
  };
}

function extraPhotoLine(input: {
  mediaType: "DIGITAL" | "PRINT";
  parentOrderPackageId?: string;
  quantity?: number;
  unitPrice?: number;
}): OrderCommitSnapshotLineV1 {
  const parentOrderPackageId = input.parentOrderPackageId ?? "order-package-1";
  const mediaKey = input.mediaType.toLowerCase();
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? (input.mediaType === "DIGITAL" ? 5 : 7.5);
  return {
    lineId: `extra-photo:${parentOrderPackageId}:${mediaKey}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_PHOTO_EXTRA,
    orderEntityId: `${parentOrderPackageId}:${input.mediaType}`,
    parentOrderPackageId,
    catalogEntityId: null,
    stableKey: `order-package:${parentOrderPackageId}:extra-photo:${mediaKey}`,
    label: `Extra photos - ${input.mediaType === "DIGITAL" ? "Digital" : "Print"}`,
    quantity,
    unitPrice,
    lineTotal: Number((unitPrice * quantity).toFixed(3)),
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
