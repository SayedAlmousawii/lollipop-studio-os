import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

test("Spec 148 deletes the AW module, route, and dead sidebars", () => {
  for (const deletedPath of [
    "src/modules/adjustment-workspace",
    "app/orders/[orderId]/adjustment-workspace",
    "src/components/orders/financial-sidebar-adjustment.tsx",
    "src/components/orders/financial-sidebar-locked.tsx",
    "src/components/orders/financial-sidebar-draft.tsx",
  ]) {
    assert.equal(existsSync(path.join(repoRoot, deletedPath)), false, deletedPath);
  }
});

test("src and app cannot import the deleted AW module or route", () => {
  const matches = sourceFilesUnder(["app", "src"])
    .filter((file) => hasDeletedAwReference(readFileSync(file, "utf8")))
    .map((file) => path.relative(repoRoot, file));

  assert.deepEqual(matches, []);
});

test("P6 policy and guard files stay AW affordance-free", () => {
  const cleanedFiles = [
    "src/modules/orders/policies/edit-mode-policy.ts",
    "src/modules/orders/policies/order-commit-draft-guard.ts",
    "src/modules/orders/order.service.ts",
    "src/modules/session-configurations/session-configuration-selection.service.ts",
    "src/lib/auth/actor-context.ts",
  ];

  for (const file of cleanedFiles) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /bypassOrderCommitDraftGuard/, `${file} has bypass`);
    assert.doesNotMatch(source, /adjustment-workspace/, `${file} has an AW href`);
    assert.doesNotMatch(
      source,
      /Adjustment Workspace/,
      `${file} has public AW copy`
    );
    assert.doesNotMatch(
      source,
      /shouldOpenAdjustmentWorkspace|openAdjustmentWorkspaceId|adjustmentWorkspaceRoute|LOCKED_INVOICE_WORKSPACE_REQUIRED/,
      `${file} has a retired policy symbol`
    );
  }
});

function hasDeletedAwReference(source: string): boolean {
  return (
    source.includes("@/modules/adjustment-workspace") ||
    /from\s+["'][^"']*src\/modules\/adjustment-workspace/.test(source) ||
    /import\([^)]*adjustment-workspace/.test(source) ||
    source.includes("/adjustment-workspace")
  );
}

function sourceFilesUnder(roots: string[]): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const absolute = path.join(directory, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (absolute.endsWith(".ts") || absolute.endsWith(".tsx")) {
        files.push(absolute);
      }
    }
  };

  for (const root of roots) {
    visit(path.join(repoRoot, root));
  }
  return files.sort();
}
