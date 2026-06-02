import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const pageSource = readFileSync(
  "app/orders/[orderId]/sales/page.tsx",
  "utf8"
);
const stagedControlsSource = readFileSync(
  "src/components/orders/sales-staged-commit-controls.tsx",
  "utf8"
);
const orderCommitFinancialSidebarSource = readFileSync(
  "src/components/orders/order-commit-financial-sidebar.tsx",
  "utf8"
);
const orderCommitReviewDialogSource = readFileSync(
  "src/components/orders/order-commit-review-dialog.tsx",
  "utf8"
);
const unlockedSource = pageSource.slice(
  pageSource.indexOf("const salesPageView = await getSalesPageView"),
  pageSource.indexOf("function LockedCompositionView")
);
const lockedSource = pageSource.slice(
  pageSource.indexOf("if (workspace.invoice?.isLocked)"),
  pageSource.indexOf("const salesPageView = await getSalesPageView")
);

const ORDER_COMMIT_SALES_SURFACE_FILES = [
  "src/components/orders/sales-staged-commit-controls.tsx",
  "src/components/orders/order-commit-financial-sidebar.tsx",
  "src/components/orders/order-commit-review-dialog.tsx",
  "src/modules/order-commits/sales-staging-handler-adapter.ts",
  "src/modules/order-commits/projections/sales-page-view.loader.ts",
  "src/modules/order-commits/projections/sales-page-view.types.ts",
  "src/modules/order-commits/projections/to-sales-page-composition.ts",
  "src/modules/order-commits/projections/to-sales-page-financial-preview.ts",
  "src/modules/order-commits/projections/to-sales-page-staged-changes.ts",
];

test("unlocked Sales page mounts SalesPageView as the composition source", () => {
  assert.match(pageSource, /import \{ getSalesPageView \}/);
  assert.match(unlockedSource, /const salesPageView = await getSalesPageView/);
  assert.match(unlockedSource, /getPOSWorkspace:\s*async \(\) => workspace/);
  assert.match(
    unlockedSource,
    /const addOnMarketplace = toPOSAddOnMarketplace\(salesPageView\.composition\)/
  );
  assert.equal(
    [...unlockedSource.matchAll(/composition=\{salesPageView\.composition\}/g)]
      .length,
    2
  );
  assert.match(unlockedSource, /marketplace=\{addOnMarketplace\}/);
  assert.doesNotMatch(unlockedSource, /draftComposition/);
  assert.doesNotMatch(unlockedSource, /getDraftOrderCompositionViewModel/);
  assert.doesNotMatch(unlockedSource, /toDraftPOSComposition/);
});

test("unlocked Sales page load is read-only and does not create or stage drafts", () => {
  assert.match(unlockedSource, /const salesPageView = await getSalesPageView/);
  assert.doesNotMatch(unlockedSource, /getOrCreateOrderCommitDraft/);
  assert.doesNotMatch(unlockedSource, /stageOrderCommitDraftChange/);
  assert.doesNotMatch(unlockedSource, /await\s+stageSalesChangeAction/);
  assert.doesNotMatch(unlockedSource, /stageSalesChangeAction\(/);
});

test("unlocked Sales page uses OrderCommit staging handlers", () => {
  assert.match(pageSource, /import \{ stageSalesChangeAction \}/);
  assert.match(pageSource, /createOrderCommitSalesCompositionHandlers/);
  assert.match(pageSource, /createOrderCommitSalesAddOnHandlers/);
  assert.match(unlockedSource, /createOrderCommitSalesCompositionHandlers\(\{/);
  assert.match(
    unlockedSource,
    /expectedVersion:\s*salesPageView\.draft\?\.version \?\? 0/
  );
  assert.match(unlockedSource, /stageSalesChangeAction/);
  assert.match(unlockedSource, /createOrderCommitSalesAddOnHandlers\(\)/);
  assert.doesNotMatch(unlockedSource, /createPOSCompositionHandlers/);
  assert.doesNotMatch(unlockedSource, /createPOSAddOnHandlers/);
  assert.doesNotMatch(unlockedSource, /callPOSServerAction/);
  assert.doesNotMatch(unlockedSource, /updateOrderPackageAction/);
  assert.doesNotMatch(unlockedSource, /updateOrderSelectedPhotoCountAction/);
  assert.doesNotMatch(unlockedSource, /addOrderProductAddOnAction/);
  assert.doesNotMatch(unlockedSource, /removeOrderAddOnAction/);
});

test("unlocked Sales page forwards SalesPageView pieces to mounted surfaces", () => {
  assert.match(
    unlockedSource,
    /const addOnMarketplace = toPOSAddOnMarketplace\(salesPageView\.composition\)/
  );
  assert.match(unlockedSource, /composition=\{salesPageView\.composition\}/);
  assert.match(unlockedSource, /marketplace=\{addOnMarketplace\}/);
  assert.match(unlockedSource, /draft=\{salesPageView\.draft\}/);
  assert.match(unlockedSource, /preview=\{salesPageView\.preview\}/);
  assert.match(unlockedSource, /stagedChanges=\{salesPageView\.stagedChanges\}/);
  assert.match(
    unlockedSource,
    /financialPreview=\{salesPageView\.financialPreview\}/
  );
  assert.match(unlockedSource, /financialCase=\{salesPageView\.financialCase\}/);
});

test("unlocked Sales page mounts staged commit controls", () => {
  assert.match(pageSource, /getOpenWorkspaceForInvoice/);
  assert.match(pageSource, /FinancialSidebarLocked/);
  assert.match(pageSource, /SalesStagedCommitControls/);
  assert.match(unlockedSource, /<SalesStagedCommitControls/);
  assert.match(unlockedSource, /orderId=\{workspace\.orderId\}/);
  assert.match(unlockedSource, /draft=\{salesPageView\.draft\}/);
  assert.match(unlockedSource, /preview=\{salesPageView\.preview\}/);
  assert.match(unlockedSource, /stagedChanges=\{salesPageView\.stagedChanges\}/);
  assert.match(
    unlockedSource,
    /financialPreview=\{salesPageView\.financialPreview\}/
  );
  assert.doesNotMatch(pageSource, /commitSalesChangesAction/);
});

test("unlocked Sales page mounts OrderCommit financial sidebar only", () => {
  assert.match(pageSource, /OrderCommitFinancialSidebar/);
  assert.match(unlockedSource, /<OrderCommitFinancialSidebar/);
  assert.match(
    unlockedSource,
    /financialPreview=\{salesPageView\.financialPreview\}/
  );
  assert.match(unlockedSource, /financialCase=\{salesPageView\.financialCase\}/);
  assert.match(unlockedSource, /preview=\{salesPageView\.preview\}/);
  assert.doesNotMatch(pageSource, /FinancialSidebarDraft/);
  const sidebarMountSource = unlockedSource.slice(
    unlockedSource.indexOf("<OrderCommitFinancialSidebar"),
    unlockedSource.indexOf("</div>", unlockedSource.indexOf("<OrderCommitFinancialSidebar"))
  );
  assert.doesNotMatch(sidebarMountSource, /composition=\{salesPageView\.composition\}/);
});

test("Sales page mount keeps source boundaries", () => {
  assert.doesNotMatch(pageSource, /@\/lib\/db/);
  assert.doesNotMatch(pageSource, /commitOrderChanges/);
  assert.doesNotMatch(unlockedSource, /getOpenWorkspaceForInvoice/);
  assert.doesNotMatch(unlockedSource, /FinancialSidebarLocked/);
});

test("locked Sales branch remains on the legacy locked surface", () => {
  assert.match(lockedSource, /getLockedOrderCompositionViewModel/);
  assert.match(lockedSource, /getOpenWorkspaceForInvoice/);
  assert.match(lockedSource, /toSalesSidebarLocked/);
  assert.match(lockedSource, /<FinancialSidebarLocked/);
  assert.doesNotMatch(lockedSource, /getSalesPageView/);
  assert.doesNotMatch(lockedSource, /OrderCommitFinancialSidebar/);
  assert.doesNotMatch(lockedSource, /SalesStagedCommitControls/);
});

test("staged commit controls mount the Spec 128 dialog and exact discard version", () => {
  assert.match(stagedControlsSource, /OrderCommitReviewDialog/);
  assert.match(stagedControlsSource, /discardSalesDraftAction/);
  assert.match(stagedControlsSource, /discardAction\(orderId, draft\.version\)/);
  assert.match(stagedControlsSource, /draft=\{draft\}/);
  assert.match(stagedControlsSource, /preview=\{preview\}/);
  assert.match(stagedControlsSource, /stagedChanges=\{stagedChanges\}/);
  assert.match(stagedControlsSource, /financialPreview=\{financialPreview\}/);
});

test("staged changes panel stays display-only", () => {
  const stagedListSource = stagedControlsSource.slice(
    stagedControlsSource.indexOf("export function StagedChangesList"),
    stagedControlsSource.indexOf("function humanizeIdentifier")
  );

  assert.match(stagedListSource, /stagedChanges/);
  assert.doesNotMatch(stagedListSource, /preview/);
  assert.doesNotMatch(stagedListSource, /financialPreview/);
  assert.doesNotMatch(stagedListSource, /\.reduce\(/);
  assert.doesNotMatch(stagedListSource, /netDelta\s*[+\-*\/]/);
  assert.doesNotMatch(stagedListSource, /[+\-*\/]\s*row\.netDelta/);
  assert.doesNotMatch(stagedListSource, /documentPlan/);
  assert.doesNotMatch(stagedControlsSource, /@\/lib\/db/);
  assert.doesNotMatch(stagedControlsSource, /commitOrderChanges/);
  assert.doesNotMatch(stagedControlsSource, /AdjustmentWorkspace/);
});

test("OrderCommit financial sidebar stays display-only", () => {
  assert.match(orderCommitFinancialSidebarSource, /financialPreview\.baseline/);
  assert.match(orderCommitFinancialSidebarSource, /financialPreview\.overlay/);
  assert.match(orderCommitFinancialSidebarSource, /Previous total/);
  assert.match(orderCommitFinancialSidebarSource, /Pending delta/);
  assert.match(orderCommitFinancialSidebarSource, /After commit/);
  assert.match(orderCommitFinancialSidebarSource, /Document plan/);
  assert.match(orderCommitFinancialSidebarSource, /Payment impact/);
  assert.match(orderCommitFinancialSidebarSource, /Refund impact/);
  assert.doesNotMatch(orderCommitFinancialSidebarSource, /@\/lib\/db/);
  assert.doesNotMatch(orderCommitFinancialSidebarSource, /commitOrderChanges/);
  assert.doesNotMatch(orderCommitFinancialSidebarSource, /AdjustmentWorkspace/);
  assert.doesNotMatch(orderCommitFinancialSidebarSource, /\.reduce\(/);
  assert.doesNotMatch(orderCommitFinancialSidebarSource, /lineDiffs/);
  assert.doesNotMatch(orderCommitFinancialSidebarSource, /stagedChanges/);
  assert.doesNotMatch(orderCommitFinancialSidebarSource, /pendingTotal\s*[-+*/]/);
  assert.doesNotMatch(orderCommitFinancialSidebarSource, /pendingDelta\s*[-+*/]/);
  assert.doesNotMatch(orderCommitFinancialSidebarSource, /previousTotal\s*[-+*/]/);
});

test("OrderCommit review dialog receives display DTOs without line-diff arithmetic", () => {
  assert.match(orderCommitReviewDialogSource, /draft\.version/);
  assert.match(orderCommitReviewDialogSource, /stagedChanges\.map/);
  assert.match(orderCommitReviewDialogSource, /financialPreview\.overlay\.previousTotal/);
  assert.match(orderCommitReviewDialogSource, /preview\.totals\.baselineTotal/);
  assert.doesNotMatch(orderCommitReviewDialogSource, /@\/lib\/db/);
  assert.doesNotMatch(orderCommitReviewDialogSource, /commitOrderChanges/);
  assert.doesNotMatch(orderCommitReviewDialogSource, /lineDiffs/);
  assert.doesNotMatch(orderCommitReviewDialogSource, /\.reduce\(/);
  assert.doesNotMatch(orderCommitReviewDialogSource, /stagedChanges\.[a-zA-Z]+\([^)]*=>[^)]*[-+*/]/s);
  assert.doesNotMatch(orderCommitReviewDialogSource, /row\.netDelta\s*[-+*/]/);
  assert.doesNotMatch(orderCommitReviewDialogSource, /[-+*/]\s*row\.netDelta/);
  assert.doesNotMatch(orderCommitReviewDialogSource, /previousTotal\s*[-+*/]/);
  assert.doesNotMatch(orderCommitReviewDialogSource, /pendingDelta\s*[-+*/]/);
  assert.doesNotMatch(orderCommitReviewDialogSource, /pendingTotal\s*[-+*/]/);
});

test("app and components stay free of direct db imports", () => {
  for (const file of sourceFilesUnder(["app", "src/components"])) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /@\/lib\/db/, `${file} imports the db client`);
  }
});

test("pages and components do not import commit execution directly", () => {
  for (const file of sourceFilesUnder(["app", "src/components"])) {
    if (file.endsWith("/sales/actions.ts")) continue;

    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /commitOrderChanges/,
      `${file} imports commit execution directly`
    );
  }
});

test("OrderCommit Sales surface does not expose public Adjustment Workspace naming", () => {
  assert.doesNotMatch(unlockedSource, /Adjustment Workspace/);
  assert.doesNotMatch(unlockedSource, /AdjustmentWorkspace/);

  for (const file of ORDER_COMMIT_SALES_SURFACE_FILES) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /Adjustment Workspace/, `${file} has public legacy copy`);
    assert.doesNotMatch(source, /AdjustmentWorkspace/, `${file} has public legacy naming`);
  }
});

test("OrderCommit Sales page and components do not calculate preview money from rows", () => {
  const guardedFiles = [
    "app/orders/[orderId]/sales/page.tsx",
    "src/components/orders/sales-staged-commit-controls.tsx",
    "src/components/orders/order-commit-financial-sidebar.tsx",
    "src/components/orders/order-commit-review-dialog.tsx",
  ];

  for (const file of guardedFiles) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /lineDiffs/, `${file} reads preview line diffs`);
    assert.doesNotMatch(source, /\.reduce\(/, `${file} reduces display rows`);
    assert.doesNotMatch(source, /moneyDelta/, `${file} reads raw diff money`);
    assert.doesNotMatch(source, /row\.netDelta\s*[-+*/]/, `${file} calculates from staged rows`);
    assert.doesNotMatch(source, /[-+*/]\s*row\.netDelta/, `${file} calculates from staged rows`);
    assert.doesNotMatch(source, /previousTotal\s*[-+*/]/, `${file} calculates previous total`);
    assert.doesNotMatch(source, /pendingDelta\s*[-+*/]/, `${file} calculates pending delta`);
    assert.doesNotMatch(source, /pendingTotal\s*[-+*/]/, `${file} calculates pending total`);
  }
});

function sourceFilesUnder(roots: string[]): string[] {
  const files: string[] = [];
  for (const root of roots) {
    collectSourceFiles(root, files);
  }
  return files;
}

function collectSourceFiles(path: string, files: string[]) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const child of readdirSync(path)) {
      if (child === "node_modules" || child.startsWith(".")) continue;
      collectSourceFiles(join(path, child), files);
    }
    return;
  }

  if (/\.(ts|tsx)$/.test(path)) {
    files.push(path);
  }
}
