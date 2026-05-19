import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const SCANNED_DIRS = ["app", "src/components"];
const DB_IMPORT_PATTERN = /from\s+["']@\/lib\/db["']/;

test("app and component production files do not import the db client", () => {
  const violations = listSourceFiles(SCANNED_DIRS).filter((relativeFilePath) =>
    DB_IMPORT_PATTERN.test(readFileSync(join(ROOT, relativeFilePath), "utf8"))
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
