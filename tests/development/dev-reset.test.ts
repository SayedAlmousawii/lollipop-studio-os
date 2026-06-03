import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

test("workflow reset clears OrderCommitDocument links before invoices", () => {
  const source = readFileSync(
    join(process.cwd(), "src/modules/development/dev-reset.service.ts"),
    "utf8"
  );

  const documentLinkDeleteIndex = source.indexOf(
    "tx.orderCommitDocument.deleteMany"
  );
  const invoiceDeleteIndex = source.indexOf("tx.invoice.deleteMany");

  assert.notEqual(documentLinkDeleteIndex, -1);
  assert.notEqual(invoiceDeleteIndex, -1);
  assert.ok(documentLinkDeleteIndex < invoiceDeleteIndex);
});
