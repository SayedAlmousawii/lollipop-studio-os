import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

test("document application kind migration classifies existing rows loudly", () => {
  const migration = readFileSync(
    path.join(
      ROOT,
      "prisma/migrations/20260608010000_document_application_kind/migration.sql"
    ),
    "utf8"
  );

  assert.match(migration, /CREATE TYPE "DocumentApplicationKind"/);
  assert.match(migration, /source\."invoiceType" = 'DEPOSIT'/);
  assert.match(migration, /'CAUSE_REVERSAL'/);
  assert.match(migration, /'CREDIT_TO_FINAL'/);
  assert.match(migration, /application\."kind" IS NULL/);
  assert.match(migration, /RAISE EXCEPTION 'DocumentApplication kind backfill failed/);
});

test("settlement production writes stay scoped to OrderCommit execution", () => {
  const moduleFiles = listFiles(path.join(ROOT, "src/modules")).filter((file) =>
    file.endsWith(".ts")
  );
  const productionSettlementWrites = moduleFiles.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return /kind:\s*DocumentApplicationKind\.SETTLEMENT/.test(source)
      ? [path.relative(ROOT, file)]
      : [];
  });

  assert.deepEqual(productionSettlementWrites, [
    "src/modules/order-commits/order-commit-execution.service.ts",
  ]);

  for (const file of moduleFiles.filter((item) =>
    item.includes(`${path.sep}order-commits${path.sep}`) &&
    !item.endsWith(
      `${path.sep}order-commits${path.sep}order-commit-execution.service.ts`
    )
  )) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /DocumentApplicationKind\.SETTLEMENT|kind:\s*["']SETTLEMENT["']/
    );
  }
  assert.doesNotMatch(
    readFileSync(
      path.join(ROOT, "src/modules/invoices/invoice.calculation.ts"),
      "utf8"
    ),
    /DocumentApplicationKind|kind/
  );
});

test("F1 does not add DB imports to app or component files", () => {
  const uiFiles = [
    ...listFiles(path.join(ROOT, "app")),
    ...listFiles(path.join(ROOT, "src/components")),
  ].filter((file) => /\.(ts|tsx)$/.test(file));

  const dbImportFiles = uiFiles.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return /@\/lib\/db/.test(source) ? [path.relative(ROOT, file)] : [];
  });

  assert.deepEqual(dbImportFiles, []);
});

function listFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  return entries.flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      return listFiles(fullPath);
    }
    return [fullPath];
  });
}
