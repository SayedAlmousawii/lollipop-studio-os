import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const PRODUCTION_DIRS = ["app", "src"];
const PROJECTOR_DIR = "src/modules/financial-cases/projections";
const INVARIANT_CATALOG_DOC = "context/reviews/invariant-catalog.md";

const REMOVED_PRODUCTION_SYMBOLS = [
  "centralization.financial_case_summary.discrepancy",
  "centralization.financial_case_summary.projector_parity",
  "checkFinancialCaseSummaryProjectorParity",
  "CENT-FCS-01",
  "discrepancy-logger",
];
const REMOVED_DOC_SYMBOLS = [
  "centralization.financial_case_summary.projector_parity",
  "CENT-FCS-01",
];
const REMOVED_ORDER_FINANCIAL_SHIM = ["getOrder", "FinancialSummary"].join("");

const PROJECTOR_FORBIDDEN_IMPORTS = [
  {
    label: "db client",
    pattern: /from\s+["']@\/lib\/db["']/,
  },
  {
    label: "summary service loader",
    pattern: /from\s+["'][^"']*financial-case-summary\.service["']/,
  },
  {
    label: "orders table service loader",
    pattern: /from\s+["'][^"']*orders-table-projections\.service["']/,
  },
  {
    label: "order settlement helper",
    pattern: /from\s+["']@\/modules\/orders\/order-settlement["']/,
  },
  {
    label: "invoice module",
    pattern: /from\s+["']@\/modules\/invoices\//,
  },
  {
    label: "payment module",
    pattern: /from\s+["']@\/modules\/payments\//,
  },
  {
    label: "financial reconciliation module",
    pattern: /from\s+["']@\/modules\/financial\//,
  },
  {
    label: "discrepancy logger",
    pattern: /from\s+["'][^"']*discrepancy-logger["']/,
  },
];

test("temporary FinancialCase parity and discrepancy symbols stay out of production code", () => {
  const violations = listSourceFiles(PRODUCTION_DIRS).flatMap((relativeFilePath) => {
    const source = readFileSync(join(ROOT, relativeFilePath), "utf8");

    return REMOVED_PRODUCTION_SYMBOLS.filter((symbol) => source.includes(symbol)).map(
      (symbol) => `${relativeFilePath}: ${symbol}`
    );
  });

  assert.deepEqual(violations, []);
});

test("generated invariant catalog no longer lists FinancialCase projector parity", () => {
  const source = readFileSync(join(ROOT, INVARIANT_CATALOG_DOC), "utf8");
  const violations = REMOVED_DOC_SYMBOLS.filter((symbol) => source.includes(symbol));

  assert.deepEqual(violations, []);
});

test("FinancialCase projector files remain pure projections", () => {
  const violations = listSourceFiles([PROJECTOR_DIR]).flatMap((relativeFilePath) => {
    const source = readFileSync(join(ROOT, relativeFilePath), "utf8");

    return PROJECTOR_FORBIDDEN_IMPORTS.filter(({ pattern }) =>
      pattern.test(source)
    ).map(({ label }) => `${relativeFilePath}: ${label}`);
  });

  assert.deepEqual(violations, []);
});

test("legacy order financial summary shim is not reintroduced", () => {
  const violations = listSourceFiles(["app", "src", "tests"]).filter(
    (relativeFilePath) => {
      const source = readFileSync(join(ROOT, relativeFilePath), "utf8");
      return source.includes(REMOVED_ORDER_FINANCIAL_SHIM);
    }
  );

  assert.deepEqual(violations, []);
});

function listSourceFiles(dirs: string[]): string[] {
  return dirs.flatMap((dir) => walk(dir));
}

function walk(relativePath: string): string[] {
  const absolutePath = join(ROOT, relativePath);
  const stat = statSync(absolutePath);
  if (stat.isFile()) {
    return /\.(?:ts|tsx)$/.test(relativePath) ? [relativePath] : [];
  }

  return readdirSync(absolutePath).flatMap((entry) =>
    walk(join(relativePath, entry))
  );
}
