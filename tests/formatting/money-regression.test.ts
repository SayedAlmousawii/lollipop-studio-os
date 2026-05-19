import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const SCANNED_DIRS = ["app", "src/components"];
const LOCAL_FORMATTER_PATTERN =
  /\b(?:function|const)\s+format(?:KD|SignedKD|SignedMoney|SignedPrice)\b/;
const TO_FIXED_KD_PATTERN = /toFixed\(3\)[^\n]*KD|KD[^\n]*toFixed\(3\)/;
test("app and component code do not define local KD formatters or parse formatted money", () => {
  const violations: string[] = [];

  for (const relativeFilePath of listSourceFiles(SCANNED_DIRS)) {
    const contents = readFileSync(join(ROOT, relativeFilePath), "utf8");
    if (LOCAL_FORMATTER_PATTERN.test(contents)) {
      violations.push(`${relativeFilePath}: local money formatter`);
    }
    if (TO_FIXED_KD_PATTERN.test(contents)) {
      violations.push(`${relativeFilePath}: inline toFixed(3) KD display`);
    }
    if (contents.includes("replace(/[^\\d.-]/g")) {
      violations.push(`${relativeFilePath}: formatted-money replace parser`);
    }
    if (
      contents.includes("parseFloat(") &&
      contents.includes("replace(/[^\\d.-]/g")
    ) {
      violations.push(`${relativeFilePath}: parseFloat formatted-money parser`);
    }
  }

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
