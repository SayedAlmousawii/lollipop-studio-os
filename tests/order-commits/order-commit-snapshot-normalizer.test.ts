import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeOrderCommitSnapshot,
  orderCommitSnapshotV1Schema,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  type OrderCommitSnapshotLineV1,
  type OrderCommitSnapshotV1,
} from "@/modules/order-commits";

test("normalizes order commit snapshot lines, metadata, and totals deterministically", () => {
  const snapshot = snapshotFixture({
    lines: [
      lineFixture({
        lineId: "line-b",
        stableKey: "stable:b",
        lineTotal: 10.1114,
        metadata: {
          z: {
            b: 2,
            a: [{ d: 4, c: 3 }],
          },
          a: 1,
        },
      }),
      lineFixture({
        lineId: "line-a",
        stableKey: "stable:a",
        lineTotal: 20.2224,
        metadata: { c: 3, b: 2 },
      }),
    ],
    totals: {
      subtotal: 999,
      discountTotal: 15,
      netTotal: 984,
    },
  });
  const before = structuredClone(snapshot);

  const normalized = normalizeOrderCommitSnapshot(snapshot);

  assert.deepEqual(snapshot, before);
  assert.deepEqual(
    normalized.lines.map((line) => line.lineId),
    ["line-a", "line-b"]
  );
  assert.deepEqual(Object.keys(normalized.lines[1].metadata), ["a", "z"]);
  assert.deepEqual(Object.keys(normalized.lines[1].metadata.z as object), [
    "a",
    "b",
  ]);
  const nestedArray = (normalized.lines[1].metadata.z as { a: object[] }).a;
  assert.deepEqual(Object.keys(nestedArray[0]), ["c", "d"]);
  assert.deepEqual(normalized.totals, {
    subtotal: 30.334,
    discountTotal: 0,
    netTotal: 30.334,
  });
  assert.doesNotThrow(() => orderCommitSnapshotV1Schema.parse(normalized));
});

test("rejects duplicate snapshot line ids", () => {
  const snapshot = snapshotFixture({
    lines: [
      lineFixture({ lineId: "duplicate", stableKey: "stable:a" }),
      lineFixture({ lineId: "duplicate", stableKey: "stable:b" }),
    ],
  });

  assert.throws(
    () => normalizeOrderCommitSnapshot(snapshot),
    /duplicate lineId duplicate/
  );
});

test("rejects duplicate snapshot stable keys", () => {
  const snapshot = snapshotFixture({
    lines: [
      lineFixture({ lineId: "line-a", stableKey: "duplicate" }),
      lineFixture({ lineId: "line-b", stableKey: "duplicate" }),
    ],
  });

  assert.throws(
    () => normalizeOrderCommitSnapshot(snapshot),
    /duplicate stableKey duplicate/
  );
});

test("rejects negative quantities", () => {
  const snapshot = snapshotFixture({
    lines: [lineFixture({ quantity: -1 })],
  });

  assert.throws(() => normalizeOrderCommitSnapshot(snapshot));
});

test("rejects non-finite money values", () => {
  const snapshot = snapshotFixture({
    lines: [lineFixture({ unitPrice: Number.POSITIVE_INFINITY })],
  });

  assert.throws(() => normalizeOrderCommitSnapshot(snapshot));
});

test("rejects unsupported currencies", () => {
  const snapshot = {
    ...snapshotFixture(),
    currency: "USD",
  } as OrderCommitSnapshotV1;

  assert.throws(() => normalizeOrderCommitSnapshot(snapshot));
});

test("rejects unknown line kinds", () => {
  const snapshot = snapshotFixture({
    lines: [
      {
        ...lineFixture(),
        lineKind: "UNKNOWN_LINE_KIND",
      } as OrderCommitSnapshotLineV1,
    ],
  });

  assert.throws(() => normalizeOrderCommitSnapshot(snapshot));
});

function snapshotFixture(
  overrides: Partial<OrderCommitSnapshotV1> = {}
): OrderCommitSnapshotV1 {
  const lines = overrides.lines ?? [lineFixture()];
  return {
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-01T00:00:00.000Z",
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines,
    totals: {
      subtotal: 0,
      discountTotal: 0,
      netTotal: 0,
    },
    ...overrides,
  };
}

function lineFixture(
  overrides: Partial<OrderCommitSnapshotLineV1> = {}
): OrderCommitSnapshotLineV1 {
  return {
    lineId: "line-1",
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId: "order-package-1",
    parentOrderPackageId: null,
    catalogEntityId: "package-1",
    stableKey: "stable:1",
    label: "Package",
    quantity: 1,
    unitPrice: 10,
    lineTotal: 10,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {},
    ...overrides,
  };
}
