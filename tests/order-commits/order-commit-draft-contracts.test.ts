import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  ORDER_COMMIT_DRAFT_OPERATION_TYPE,
  ORDER_COMMIT_DRAFT_PENDING_OPS_SCHEMA_VERSION,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  orderCommitDraftOperationTypeSchema,
  orderCommitDraftOperationV1Schema,
  orderCommitDraftPendingOpsV1Schema,
  orderCommitSnapshotV1Schema,
} from "@/modules/order-commits";

test("order commit draft pending ops accepts the generic V1 history contract", () => {
  const parsed = orderCommitDraftPendingOpsV1Schema.parse({
    schemaVersion: ORDER_COMMIT_DRAFT_PENDING_OPS_SCHEMA_VERSION,
    operations: [
      {
        id: "op-1",
        type: ORDER_COMMIT_DRAFT_OPERATION_TYPE.SNAPSHOT_REPLACED,
        payload: { reason: "manual_replace" },
        createdAt: "2026-06-01T10:00:00.000Z",
        actorUserId: "user-1",
      },
      {
        id: "op-2",
        type: ORDER_COMMIT_DRAFT_OPERATION_TYPE.NOTE_APPENDED,
        payload: { note: "manager note" },
        createdAt: "2026-06-01T10:05:00.000Z",
        actorUserId: "user-2",
      },
    ],
  });

  assert.equal(parsed.schemaVersion, "order_commit_draft_pending_ops_v1");
  assert.deepEqual(
    parsed.operations.map((operation) => operation.type),
    ["SNAPSHOT_REPLACED", "NOTE_APPENDED"]
  );
});

test("order commit draft operation contract stays generic for Spec 121", () => {
  assert.deepEqual(
    Object.values(ORDER_COMMIT_DRAFT_OPERATION_TYPE).sort(),
    ["NOTE_APPENDED", "SNAPSHOT_REPLACED"].sort()
  );

  for (const operationType of Object.values(ORDER_COMMIT_DRAFT_OPERATION_TYPE)) {
    assert.equal(
      orderCommitDraftOperationTypeSchema.parse(operationType),
      operationType
    );
  }

  assert.equal(
    orderCommitDraftOperationTypeSchema.safeParse("ADD_CATALOG_ADD_ON").success,
    false
  );
  assert.equal(
    orderCommitDraftOperationTypeSchema.safeParse("CHANGE_PACKAGE_TIER").success,
    false
  );
});

test("order commit draft operation schema rejects invalid history shapes", () => {
  const parsed = orderCommitDraftOperationV1Schema.safeParse({
    id: "",
    type: ORDER_COMMIT_DRAFT_OPERATION_TYPE.NOTE_APPENDED,
    payload: [],
    createdAt: "not-a-date",
    actorUserId: "",
  });

  assert.equal(parsed.success, false);
});

test("order commit draft pending snapshot uses the V1 order commit snapshot contract", () => {
  const parsed = orderCommitSnapshotV1Schema.parse({
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-01T10:00:00.000Z",
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines: [],
    totals: {
      subtotal: 0,
      discountTotal: 0,
      netTotal: 0,
    },
  });

  assert.equal(parsed.schemaVersion, "order_commit_snapshot_v1");
  assert.equal(parsed.orderId, "order-1");
});

test("schema defines the additive order commit draft table and indexes", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

  assert.match(schema, /model OrderCommitDraft \{/);
  assert.match(schema, /@@map\("order_commit_drafts"\)/);
  assert.match(schema, /@@unique\(\[orderId\]\)/);
  assert.match(schema, /@@index\(\[financialCaseId\]\)/);
  assert.match(schema, /@@index\(\[baseCommitId\]\)/);
  assert.match(schema, /@@index\(\[ownerUserId\]\)/);
  assert.match(schema, /@@index\(\[legacyAdjustmentWorkspaceId\]\)/);
});

test("order commit draft public module avoids legacy workspace terminology", () => {
  const sources = listSourceFiles("src/modules/order-commits").map((file) => ({
    file,
    source: readFileSync(join(process.cwd(), file), "utf8").replaceAll(
      "legacyAdjustmentWorkspaceId",
      ""
    ),
  }));

  const publicWorkspaceNaming = sources
    .filter(({ source }) => /AdjustmentWorkspace/.test(source))
    .map(({ file }) => file);

  assert.deepEqual(publicWorkspaceNaming, []);
});

test("order commit draft foundation does not introduce app or component DB imports", () => {
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

test("append operation helper remains generic history only", () => {
  const source = readFileSync(
    join(process.cwd(), "src/modules/order-commits/order-commit.service.ts"),
    "utf8"
  );
  const helper = source.slice(
    source.indexOf("export async function appendOrderCommitDraftOperation"),
    source.indexOf("export async function createOrderCommitSnapshot")
  );

  assert.doesNotMatch(helper, /invoiceLineItem/i);
  assert.doesNotMatch(helper, /OrderAddOn|OrderPackage|Product|PackageItem/);
  assert.doesNotMatch(helper, /priceSelections|sessionConfiguration/i);
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
