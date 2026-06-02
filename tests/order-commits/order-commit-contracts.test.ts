import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  ORDER_COMMIT_KIND,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  ORDER_COMMIT_STATUS,
  orderCommitKindSchema,
  orderCommitSnapshotLineKindSchema,
  orderCommitSnapshotV1Schema,
  orderCommitStatusSchema,
} from "@/modules/order-commits";

test("order commit kind and status accept the execution contract values", () => {
  assert.equal(
    orderCommitKindSchema.parse(ORDER_COMMIT_KIND.BASELINE),
    "BASELINE"
  );
  assert.equal(
    orderCommitKindSchema.parse(ORDER_COMMIT_KIND.ADJUSTMENT),
    "ADJUSTMENT"
  );
  assert.equal(
    orderCommitKindSchema.parse(ORDER_COMMIT_KIND.AUDIT),
    "AUDIT"
  );
  assert.equal(
    orderCommitStatusSchema.parse(ORDER_COMMIT_STATUS.COMMITTED),
    "COMMITTED"
  );

  assert.equal(orderCommitKindSchema.safeParse("OPEN").success, false);
  assert.equal(orderCommitStatusSchema.safeParse("OPEN").success, false);
});

test("snapshot line kind contract covers all Phase 1 operational row types", () => {
  assert.deepEqual(
    Object.values(ORDER_COMMIT_SNAPSHOT_LINE_KIND).sort(),
    [
      "ADD_ON",
      "LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON",
      "PACKAGE",
      "PACKAGE_ITEM_UPGRADE",
      "SELECTED_PHOTO_EXTRA",
      "SESSION_CONFIGURATION",
    ].sort()
  );

  for (const lineKind of Object.values(ORDER_COMMIT_SNAPSHOT_LINE_KIND)) {
    assert.equal(orderCommitSnapshotLineKindSchema.parse(lineKind), lineKind);
  }
});

test("snapshot schema accepts the required V1 raw identity and money fields", () => {
  const parsed = orderCommitSnapshotV1Schema.parse({
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-01T10:00:00.000Z",
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines: [
      {
        lineId: "line-package-1",
        lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
        orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
        orderEntityId: "order-package-1",
        parentOrderPackageId: null,
        catalogEntityId: "package-1",
        stableKey: "order-package:order-package-1",
        label: "Classic Package",
        quantity: 1,
        unitPrice: 100,
        lineTotal: 100,
        priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
        metadata: { sortOrder: 0 },
      },
      {
        lineId: "line-linked-selection-1",
        lineKind:
          ORDER_COMMIT_SNAPSHOT_LINE_KIND
            .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON,
        orderEntityKind:
          ORDER_COMMIT_ORDER_ENTITY_KIND
            .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
        orderEntityId: "selection-1",
        parentOrderPackageId: "order-package-1",
        catalogEntityId: "product-1",
        stableKey: "session-configuration-selection:selection-1:add-on:add-on-1",
        label: "Extra Album",
        quantity: 1,
        unitPrice: 25.5,
        lineTotal: 25.5,
        priceSource:
          ORDER_COMMIT_PRICE_SOURCE.SESSION_CONFIGURATION_SELECTION_SNAPSHOT,
        metadata: { orderAddOnId: "add-on-1" },
      },
    ],
    totals: {
      subtotal: 125.5,
      discountTotal: 0,
      netTotal: 125.5,
    },
  });

  assert.equal(parsed.schemaVersion, "order_commit_snapshot_v1");
  assert.equal(parsed.lines[0]?.unitPrice, 100);
  assert.equal(parsed.totals.netTotal, 125.5);
});

test("snapshot schema rejects invalid V1 contract shapes", () => {
  const parsed = orderCommitSnapshotV1Schema.safeParse({
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "not-a-date",
    currency: "USD",
    lines: [
      {
        lineId: "",
        lineKind: "INVOICE_LINE",
        orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
        orderEntityId: "order-package-1",
        parentOrderPackageId: null,
        catalogEntityId: null,
        stableKey: "",
        label: "",
        quantity: 1.25,
        unitPrice: Number.NaN,
        lineTotal: 100,
        priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
        metadata: {},
      },
    ],
    totals: {
      subtotal: 100,
      discountTotal: 0,
      netTotal: 100,
    },
  });

  assert.equal(parsed.success, false);
});

test("order commit contract module avoids invoice-line and legacy workspace ownership inputs", () => {
  const sources = listSourceFiles("src/modules/order-commits").map((file) => ({
    file,
    source: readFileSync(join(process.cwd(), file), "utf8"),
  }));

  const invoiceLineReads = sources
    .filter(({ source }) => /invoiceLineItem/i.test(source))
    .map(({ file }) => file);
  const publicWorkspaceNaming = sources
    .filter(({ source }) => /AdjustmentWorkspace/.test(source))
    .map(({ file }) => file);

  assert.deepEqual(invoiceLineReads, []);
  assert.deepEqual(publicWorkspaceNaming, []);
});

test("order commit foundation does not introduce app or component DB imports", () => {
  const sources = [
    ...listSourceFiles("app"),
    ...listSourceFiles("src/components"),
  ].map((file) => ({
    file,
    source: readFileSync(join(process.cwd(), file), "utf8"),
  }));

  const dbImportFiles = sources
    .filter(({ source }) =>
      /from\s+["']@\/lib\/db["']|import\(["']@\/lib\/db["']\)/.test(source)
    )
    .map(({ file }) => file);

  assert.deepEqual(dbImportFiles, []);
});

function listSourceFiles(relativePath: string): string[] {
  const absolutePath = join(process.cwd(), relativePath);
  const stat = statSync(absolutePath);
  if (stat.isFile()) {
    return /\.(?:ts|tsx)$/.test(relativePath) ? [relativePath] : [];
  }

  return readdirSync(absolutePath).flatMap((entry) =>
    listSourceFiles(join(relativePath, entry))
  );
}
