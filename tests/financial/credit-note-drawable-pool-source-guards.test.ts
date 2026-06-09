import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const RETIRED_KIND_PATTERN = new RegExp(
  `${["CAUSE", "REVERSAL"].join("_")}|${["CREDIT", "TO", "FINAL"].join("_")}`
);

test("document application kind retirement migration recreates the collapsed enum", () => {
  const migration = readFileSync(
    path.join(
      ROOT,
      "prisma/migrations/20260609020000_document_application_kind_retirement/migration.sql"
    ),
    "utf8"
  );

  assert.match(migration, /ALTER TYPE "DocumentApplicationKind" RENAME TO "DocumentApplicationKind_old"/);
  assert.match(migration, /CREATE TYPE "DocumentApplicationKind"/);
  assert.match(migration, /'DEPOSIT'/);
  assert.match(migration, /'SETTLEMENT'/);
  assert.doesNotMatch(migration, RETIRED_KIND_PATTERN);
  assert.match(migration, /DROP TYPE "DocumentApplicationKind_old"/);
});

test("retired document application kinds are absent from active runtime sources and tests", () => {
  const activeFiles = [
    ...listFiles(path.join(ROOT, "src")),
    ...listFiles(path.join(ROOT, "app")),
    ...listFiles(path.join(ROOT, "scripts")),
    ...listFiles(path.join(ROOT, "tests")),
    path.join(ROOT, "prisma/schema.prisma"),
  ].filter((file) => /\.(ts|tsx|sql|prisma)$/.test(file));

  const retiredReferences = activeFiles.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return RETIRED_KIND_PATTERN.test(source)
      ? [path.relative(ROOT, file)]
      : [];
  });

  assert.deepEqual(retiredReferences, []);
});

test("settlement production writes stay scoped to invoice service", () => {
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
    "src/modules/invoices/invoice.service.ts",
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
