import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";
import ts from "typescript";

const ROOT = process.cwd();
const PRODUCTION_DIRS = ["app", "src"];
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const BASE_PAYMENT_PATTERN = /\bbase payment\b/i;

const ALLOWED_BASE_PAYMENT_OCCURRENCES: string[] = [];

test("production user-visible strings do not reintroduce base payment terminology", () => {
  const violations = PRODUCTION_DIRS.flatMap((directory) =>
    walk(join(ROOT, directory))
  )
    .filter((filePath) => SOURCE_EXTENSIONS.has(extname(filePath)))
    .flatMap(findBasePaymentStringLiterals)
    .filter((violation) => !ALLOWED_BASE_PAYMENT_OCCURRENCES.includes(violation));

  assert.deepEqual(violations, []);
});

function findBasePaymentStringLiterals(filePath: string): string[] {
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS
  );
  const violations: string[] = [];

  function visit(node: ts.Node): void {
    if (isUserVisibleTextNode(node)) {
      const text = node.getText(sourceFile);
      if (BASE_PAYMENT_PATTERN.test(text)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile)
        );
        violations.push(
          `${relativePath(filePath)}:${line + 1}:${character + 1} ${text.trim()}`
        );
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function isUserVisibleTextNode(node: ts.Node): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isJsxText(node)
  );
}

function walk(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (path.includes("node_modules") || path.includes(".next")) return [];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

function relativePath(filePath: string): string {
  return filePath.startsWith(`${ROOT}/`) ? filePath.slice(ROOT.length + 1) : filePath;
}
