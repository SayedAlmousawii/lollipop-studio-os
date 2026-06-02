import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  ORDER_COMMIT_DOCUMENT_ROLE,
  orderCommitDocumentRoleSchema,
} from "@/modules/order-commits";

test("order commit document role contract accepts only Task 1 values", () => {
  assert.deepEqual(
    Object.values(ORDER_COMMIT_DOCUMENT_ROLE).sort(),
    ["ADJUSTMENT_INVOICE", "BASE_INVOICE", "CREDIT_NOTE"].sort()
  );

  for (const role of Object.values(ORDER_COMMIT_DOCUMENT_ROLE)) {
    assert.equal(orderCommitDocumentRoleSchema.parse(role), role);
  }

  assert.equal(orderCommitDocumentRoleSchema.safeParse("PAYMENT").success, false);
  assert.equal(orderCommitDocumentRoleSchema.safeParse("REFUND").success, false);
});

test("schema defines the order commit document link model", () => {
  const schema = readPrismaSchema();
  const model = schemaModelBlock(schema, "OrderCommitDocument");

  assert.match(model, /id\s+String\s+@id\s+@default\(cuid\(\)\)/);
  assert.match(model, /orderCommitId\s+String/);
  assert.match(model, /invoiceId\s+String/);
  assert.match(model, /role\s+String/);
  assert.match(model, /createdAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(
    model,
    /orderCommit\s+OrderCommit\s+@relation\("OrderCommitDocumentOrderCommit", fields: \[orderCommitId\], references: \[id\], onDelete: Cascade\)/
  );
  assert.match(
    model,
    /invoice\s+Invoice\s+@relation\("OrderCommitDocumentInvoice", fields: \[invoiceId\], references: \[id\], onDelete: Restrict\)/
  );
  assert.match(model, /@@unique\(\[orderCommitId, invoiceId, role\]\)/);
  assert.match(model, /@@index\(\[orderCommitId\]\)/);
  assert.match(model, /@@index\(\[invoiceId\]\)/);
  assert.match(model, /@@map\("order_commit_documents"\)/);
});

test("schema links order commits and invoices to order commit documents", () => {
  const schema = readPrismaSchema();
  const orderCommit = schemaModelBlock(schema, "OrderCommit");
  const invoice = schemaModelBlock(schema, "Invoice");

  assert.match(orderCommit, /committedFromDraftVersion\s+Int\?/);
  assert.match(orderCommit, /@@unique\(\[orderId, committedFromDraftVersion\]\)/);
  assert.match(
    orderCommit,
    /orderCommitDocuments\s+OrderCommitDocument\[\]\s+@relation\("OrderCommitDocumentOrderCommit"\)/
  );
  assert.match(
    invoice,
    /orderCommitDocuments\s+OrderCommitDocument\[\]\s+@relation\("OrderCommitDocumentInvoice"\)/
  );
});

test("Task 1 order commit contract surface avoids invoice-line reads and legacy naming", () => {
  const sources = [
    "src/modules/order-commits/order-commit.constants.ts",
    "src/modules/order-commits/order-commit.schema.ts",
    "src/modules/order-commits/order-commit.types.ts",
  ].map((file) => ({
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

function readPrismaSchema(): string {
  return readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
}

function schemaModelBlock(schema: string, modelName: string): string {
  const match = new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`).exec(
    schema
  );
  assert.ok(match, `Expected Prisma model ${modelName} to exist.`);
  return match[0];
}
