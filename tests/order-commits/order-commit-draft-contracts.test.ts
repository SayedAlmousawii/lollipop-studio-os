import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  ORDER_COMMIT_DRAFT_OPERATION_TYPE,
  ORDER_COMMIT_DRAFT_PENDING_OPS_SCHEMA_VERSION,
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN,
  ORDER_COMMIT_DRAFT_STAGING_HISTORY_SCHEMA_VERSION,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  orderCommitDraftOperationTypeSchema,
  orderCommitDraftOperationV1Schema,
  orderCommitDraftPendingOpsV1Schema,
  orderCommitDraftStagingChangeSchema,
  orderCommitDraftStagingHistoryPayloadSchema,
  orderCommitDraftStagingSnapshotReplacementOperationSchema,
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

test("order commit draft operation types stay generic while staging lives in payloads", () => {
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

  const operation = orderCommitDraftStagingSnapshotReplacementOperationSchema.parse({
    id: "op-stage-package",
    type: ORDER_COMMIT_DRAFT_OPERATION_TYPE.SNAPSHOT_REPLACED,
    payload: stagingHistoryPayload(
      orderCommitDraftStagingChangeSchema.parse({
        domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
        action: "CHANGE_PACKAGE",
        target: { stableKey: "order-package:order-package-1" },
        packageId: "package-2",
        packageLabel: "Signature Package",
      })
    ),
    createdAt: "2026-06-01T11:00:00.000Z",
    actorUserId: "user-1",
  });

  assert.equal(operation.payload.historyKind, "STAGING_CHANGE");
  assert.equal(operation.payload.domain, ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE);
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

test("order commit draft staging change contract covers the five reducer domains", () => {
  const changes = [
    {
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
      action: "CHANGE_PACKAGE",
      target: { stableKey: "order-package:order-package-1" },
      packageId: "package-2",
      sessionTypeId: "session-type-1",
    },
    {
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
      action: "ADD",
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      productId: "product-1",
      quantity: 2,
      draftOrderAddOnId: "draft:addon-1",
    },
    {
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
      action: "ADD",
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      packageItemId: "package-item-1",
      toProductId: "product-replacement",
      quantity: 1,
      draftPackageItemUpgradeId: "draft:item-upgrade-1",
    },
    {
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
      action: "SET_COUNTS",
      target: { stableKey: "order-package:order-package-1" },
      selectedPhotoCount: 12,
      extraDigitalCount: 1,
      extraPrintCount: 1,
    },
    {
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
      action: "UPSERT",
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      configurationId: "configuration-1",
      optionId: "option-1",
      draftSelectionId: "draft:selection-1",
      linkedProduct: {
        productId: "product-linked",
        draftOrderAddOnId: "draft:addon-linked",
      },
    },
  ];

  assert.deepEqual(
    changes.map((change) => orderCommitDraftStagingChangeSchema.parse(change).domain),
    [
      "PACKAGE",
      "ADD_ON",
      "PACKAGE_ITEM_UPGRADE",
      "PHOTO",
      "SESSION_CONFIGURATION",
    ]
  );
});

test("order commit draft staging change contract rejects invalid targets and counts", () => {
  assert.equal(
    orderCommitDraftStagingChangeSchema.safeParse({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
      action: "CHANGE_PACKAGE",
      target: {},
      packageId: "package-2",
    }).success,
    false
  );
  assert.equal(
    orderCommitDraftStagingChangeSchema.safeParse({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
      action: "ADD",
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      productId: "product-1",
      quantity: -1,
    }).success,
    false
  );
  assert.equal(
    orderCommitDraftStagingChangeSchema.safeParse({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
      action: "SET_COUNTS",
      target: { stableKey: "order-package:order-package-1" },
      selectedPhotoCount: 12.5,
      extraDigitalCount: 1,
      extraPrintCount: 1,
    }).success,
    false
  );
  assert.equal(
    orderCommitDraftStagingChangeSchema.safeParse({
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
      action: "REMOVE",
      parentPackageTarget: { stableKey: "order-package:order-package-1" },
      configurationId: "configuration-1",
    }).success,
    false
  );
});

test("add-on staging accepts order-level add-ons without parent scope", () => {
  const valid = orderCommitDraftStagingChangeSchema.safeParse({
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
    action: "ADD",
    productId: "product-1",
    quantity: 1,
    draftOrderAddOnId: "draft:addon-1",
  });

  assert.equal(valid.success, true);
});

test("package item upgrade add requires a replacement product id", () => {
  const valid = orderCommitDraftStagingChangeSchema.safeParse({
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
    action: "ADD",
    parentPackageTarget: { stableKey: "order-package:order-package-1" },
    packageItemId: "package-item-1",
    toProductId: "product-replacement",
    quantity: 1,
  });
  assert.equal(valid.success, true);

  const missingReplacement = orderCommitDraftStagingChangeSchema.safeParse({
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
    action: "ADD",
    parentPackageTarget: { stableKey: "order-package:order-package-1" },
    packageItemId: "package-item-1",
    quantity: 1,
  });
  assert.equal(missingReplacement.success, false);
});

test("order commit draft staging history payload describes snapshot replacement", () => {
  const change = orderCommitDraftStagingChangeSchema.parse({
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
    action: "UPDATE_QUANTITY",
    target: { stableKey: "order-add-on:add-on-1" },
    parentPackageTarget: { stableKey: "order-package:order-package-1" },
    quantity: 3,
  });

  const payload = orderCommitDraftStagingHistoryPayloadSchema.parse(
    stagingHistoryPayload(change, {
      target: { stableKey: "order-add-on:add-on-1" },
      catalogEntityIds: { productId: "product-1" },
      before: { quantity: 1 },
      after: { quantity: 3 },
    })
  );

  assert.equal(
    payload.schemaVersion,
    ORDER_COMMIT_DRAFT_STAGING_HISTORY_SCHEMA_VERSION
  );
  assert.equal(payload.domain, ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON);
  assert.deepEqual(payload.before, { quantity: 1 });
  assert.equal(payload.change.action, "UPDATE_QUANTITY");
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

test("order commit draft public module does not read invoice line items", () => {
  const sources = listSourceFiles("src/modules/order-commits").map((file) => ({
    file,
    source: readFileSync(join(process.cwd(), file), "utf8"),
  }));

  const invoiceLineReads = sources
    .filter(({ source }) => /invoiceLineItem/i.test(source))
    .map(({ file }) => file);

  assert.deepEqual(invoiceLineReads, []);
});

test("order commit reducers do not import the database client", () => {
  const sources = listSourceFiles("src/modules/order-commits")
    .filter((file) => /-reducer\.ts$/.test(file))
    .map((file) => ({
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

test("draft mutating helpers stay isolated from operational and financial mutation surfaces", () => {
  const source = readFileSync(
    join(process.cwd(), "src/modules/order-commits/order-commit.service.ts"),
    "utf8"
  );
  const helpers = [
    sourceForFunction(source, "discardOrderCommitDraft"),
    sourceForFunction(source, "replaceOrderCommitDraftSnapshot"),
    sourceForFunction(source, "appendOrderCommitDraftOperation"),
  ].join("\n");

  assert.doesNotMatch(helpers, /invoiceLineItem/i);
  assert.doesNotMatch(
    helpers,
    /\.(?:invoice|payment|paymentAllocation|documentApplication|refund|creditNote|adjustmentWorkspace)\b/
  );
  assert.doesNotMatch(helpers, /OrderAddOn|OrderPackage|Product|PackageItem/);
  assert.doesNotMatch(helpers, /priceSelections|sessionConfiguration/i);
});

test("draft staging service writes snapshots through replacement only", () => {
  const source = readFileSync(
    join(process.cwd(), "src/modules/order-commits/order-commit.service.ts"),
    "utf8"
  );
  const helper = sourceForFunction(source, "stageOrderCommitDraftChange");

  assert.match(helper, /replaceOrderCommitDraftSnapshot/);
  assert.doesNotMatch(helper, /appendOrderCommitDraftOperation/);
  assert.doesNotMatch(helper, /invoiceLineItem/i);
  assert.doesNotMatch(
    helper,
    /\.(?:invoice|payment|paymentAllocation|documentApplication|refund|creditNote|adjustmentWorkspace)\b/
  );
});

test("draft staging helper does not import financial or Adjustment Workspace mutation services", () => {
  const sources = listSourceFiles("src/modules/order-commits").map((file) => ({
    file,
    imports: readFileSync(join(process.cwd(), file), "utf8")
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line))
      .join("\n"),
  }));

  const forbiddenImportFiles = sources
    .filter(({ imports }) =>
      /@\/modules\/(?:invoices|payments|refunds|adjustment-workspace)\//.test(
        imports
      ) ||
      /from\s+["'][^"']*(?:invoice|payment|refund|credit-note|adjustment-workspace)\.service["']/.test(
        imports
      )
    )
    .map(({ file }) => file);

  assert.deepEqual(forbiddenImportFiles, []);
});

function stagingHistoryPayload(
  change: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schemaVersion: ORDER_COMMIT_DRAFT_STAGING_HISTORY_SCHEMA_VERSION,
    historyKind: "STAGING_CHANGE",
    domain: change.domain,
    stagedAt: "2026-06-01T11:00:00.000Z",
    actorUserId: "user-1",
    change,
    ...overrides,
  };
}

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

function sourceForFunction(source: string, functionName: string): string {
  const start = source.indexOf(`export async function ${functionName}`);
  assert.notEqual(start, -1, `Expected ${functionName} to be exported`);

  const nextExport = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}
