import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const RETIRED_MESSAGE = "Adjustment Workspace is retired — use POS";

const knownLegacyAwReferenceFiles = [
  "src/components/orders/financial-sidebar-adjustment.tsx",
  "src/components/orders/financial-sidebar-locked.tsx",
];

test("AW route redirects to Sales without rendering the legacy workspace", () => {
  const source = readFileSync(
    "app/orders/[orderId]/adjustment-workspace/page.tsx",
    "utf8"
  );

  assert.match(source, /redirect\(`\/orders\/\$\{orderId\}\/sales`\)/);
  assert.match(source, /adjustment_workspace\.route_redirected/);
  assert.doesNotMatch(source, /@\/modules\/adjustment-workspace/);
  assert.doesNotMatch(source, /FinancialSidebarAdjustment/);
  assert.doesNotMatch(source, /POSPackageComposition/);
});

test("AW route server actions refuse stale employee-surface mutations", async () => {
  const actions = await import(
    "../../../app/orders/[orderId]/adjustment-workspace/actions"
  );
  const actionCases: Array<{
    name: keyof typeof actions;
    args: unknown[];
  }> = [
    { name: "openAdjustmentWorkspaceAction", args: ["order-1", "invoice-1"] },
    { name: "takeOverAdjustmentWorkspaceAction", args: ["order-1", "workspace-1"] },
    { name: "addWorkspaceLineAction", args: ["order-1", "workspace-1", new FormData()] },
    { name: "removeWorkspaceLineAction", args: ["order-1", "workspace-1", new FormData()] },
    {
      name: "modifyWorkspaceLineQuantityAction",
      args: ["order-1", "workspace-1", new FormData()],
    },
    { name: "swapWorkspacePackageAction", args: ["order-1", "workspace-1", new FormData()] },
    {
      name: "stagePackageTierChangeAction",
      args: ["order-1", "workspace-1", {}],
    },
    {
      name: "stagePackageItemUpgradeAction",
      args: ["order-1", "workspace-1", {}],
    },
    {
      name: "stageSelectedPhotoCountChangeAction",
      args: ["order-1", "workspace-1", {}],
    },
    {
      name: "stageMarketplaceAddOnAction",
      args: ["order-1", "workspace-1", {}],
    },
    {
      name: "stageMarketplaceAddOnRemovalAction",
      args: ["order-1", "workspace-1", {}],
    },
    {
      name: "stageMarketplaceAddOnQuantityAction",
      args: ["order-1", "workspace-1", {}],
    },
    { name: "removeWorkspaceEditAction", args: ["order-1", "workspace-1", new FormData()] },
    {
      name: "cancelAdjustmentWorkspaceAction",
      args: ["order-1", "workspace-1", new FormData()],
    },
    {
      name: "finalizeAdjustmentWorkspaceAction",
      args: ["order-1", "workspace-1", new FormData()],
    },
  ];

  for (const { name, args } of actionCases) {
    const action = actions[name] as (...input: unknown[]) => Promise<unknown>;
    await assert.rejects(() => action(...args), {
      name: "AdjustmentWorkspaceRetiredError",
      message: RETIRED_MESSAGE,
    });
  }
});

test("app and components cannot add new AW imports or route hrefs", () => {
  const matches = sourceFilesUnder(["app", "src/components"])
    .filter((file) => hasAwReference(readFileSync(file, "utf8")))
    .map((file) => path.relative(repoRoot, file))
    .filter((file) => !isAllowedLegacyAwReference(file));

  assert.deepEqual(matches, []);
});

test("P6-4 cleaned policy and service files stay AW affordance-free", () => {
  const cleanedFiles = [
    "src/modules/orders/policies/edit-mode-policy.ts",
    "src/modules/orders/order.service.ts",
    "src/modules/session-configurations/session-configuration-selection.service.ts",
  ];

  for (const file of cleanedFiles) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /adjustment-workspace/, `${file} has an AW href`);
    assert.doesNotMatch(
      source,
      /Adjustment Workspace/,
      `${file} has public AW copy`
    );
    assert.doesNotMatch(
      source,
      /shouldOpenAdjustmentWorkspace|openAdjustmentWorkspaceId|adjustmentWorkspaceRoute|LOCKED_INVOICE_WORKSPACE_REQUIRED/,
      `${file} has a retired P6-4 policy symbol`
    );
  }
});

function hasAwReference(source: string): boolean {
  return (
    source.includes("adjustment-workspace") ||
    source.includes("/adjustment-workspace") ||
    source.includes("AdjustmentWorkspace")
  );
}

function isAllowedLegacyAwReference(file: string): boolean {
  return (
    file.startsWith("app/orders/[orderId]/adjustment-workspace/") ||
    knownLegacyAwReferenceFiles.includes(file)
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
