import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const pageSource = readFileSync(
  "app/(app)/orders/[orderId]/sales/page.tsx",
  "utf8"
);
const layoutSource = readFileSync(
  "app/(app)/orders/[orderId]/sales/layout.tsx",
  "utf8"
);
const stylesSource = readFileSync(
  "app/(app)/orders/[orderId]/sales/sales-page.module.css",
  "utf8"
);
const salesWorkspaceHeaderSource = readFileSync(
  "app/(app)/orders/[orderId]/sales/sales-workspace-header.tsx",
  "utf8"
);
const stagedControlsSource = readFileSync(
  "src/components/orders/sales-staged-commit-controls.tsx",
  "utf8"
);
const ownershipBannerSource = readFileSync(
  "src/components/orders/sales-draft-ownership-banner.tsx",
  "utf8"
);
const salesRightColumnSource = readFileSync(
  "app/(app)/orders/[orderId]/sales/sales-right-column.tsx",
  "utf8"
);
const orderCommitReviewDialogSource = readFileSync(
  "src/components/orders/order-commit-review-dialog.tsx",
  "utf8"
);
const posPackageCompositionSource = readFileSync(
  "src/components/orders/pos-package-composition.tsx",
  "utf8"
);
const salesViewSource = pageSource.slice(
  pageSource.indexOf("const salesPageView = await getSalesPageView")
);

const ORDER_COMMIT_SALES_SURFACE_FILES = [
  "src/components/orders/sales-staged-commit-controls.tsx",
  "src/components/orders/sales-draft-ownership-banner.tsx",
  "app/(app)/orders/[orderId]/sales/sales-right-column.tsx",
  "src/components/orders/order-commit-review-dialog.tsx",
  "src/modules/order-commits/sales-staging-handler-adapter.ts",
  "src/modules/order-commits/projections/sales-page-view.loader.ts",
  "src/modules/order-commits/projections/sales-page-view.types.ts",
  "src/modules/order-commits/projections/to-sales-page-composition.ts",
  "src/modules/order-commits/projections/to-sales-page-financial-preview.ts",
  "src/modules/order-commits/projections/to-sales-right-column-receipt.ts",
  "src/modules/order-commits/projections/to-sales-page-staged-changes.ts",
];

test("Sales route owns the fixed shell and bypasses PageContainer", () => {
  assert.doesNotMatch(layoutSource, /PageContainer/);
  assert.match(layoutSource, /className="flex h-full flex-col overflow-hidden bg-background"/);
  assert.match(layoutSource, /className="min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6"/);
  assert.doesNotMatch(layoutSource, /getPOSWorkspace/);
  assert.doesNotMatch(layoutSource, /notFound/);
  assert.doesNotMatch(layoutSource, /<header/);
  assert.doesNotMatch(layoutSource, /Sales Workspace/);
});

test("Sales workspace header is pinned inside the left column only", () => {
  assert.match(pageSource, /import \{ SalesWorkspaceHeader \} from "\.\/sales-workspace-header"/);
  assert.match(salesViewSource, /<div className=\{styles\.leftColumn\}>\s*<SalesWorkspaceHeader workspace=\{workspace\} \/>\s*<main className=\{styles\.compositionPanel\}>/);
  assert.match(salesViewSource, /<\/main>\s*<\/div>\s*<SalesRightColumn/);
  assert.match(salesWorkspaceHeaderSource, /<header className="flex-shrink-0/);
  assert.doesNotMatch(salesWorkspaceHeaderSource, /<header[^>]+bg-surface/);
  assert.match(salesWorkspaceHeaderSource, /<h1[\s\S]*\{workspace\.customerPhone\}[\s\S]*<\/h1>/);
  assert.match(salesWorkspaceHeaderSource, /Job \{workspace\.jobNumber\}/);
  assert.match(salesWorkspaceHeaderSource, /\{workspace\.orderStatus\}/);
  assert.match(salesWorkspaceHeaderSource, /\{workspace\.sessionDate\}/);
  assert.match(salesWorkspaceHeaderSource, /workspace\.photographerName \?/);
  assert.doesNotMatch(salesWorkspaceHeaderSource, /Sales Workspace/);
  assert.doesNotMatch(layoutSource, /sessionType/i);
});

test("Sales page delegates scroll to left and right shell regions", () => {
  assert.match(salesViewSource, /<div className=\{styles\.leftColumn\}>/);
  assert.match(salesViewSource, /<main className=\{styles\.compositionPanel\}>/);
  assert.match(salesViewSource, /<SalesRightColumn/);
  assert.match(stylesSource, /\.salesGrid \{[\s\S]*height: 100%;[\s\S]*min-height: 0;[\s\S]*overflow: hidden;/);
  assert.match(stylesSource, /\.leftColumn \{[\s\S]*flex: 1 1 auto;[\s\S]*flex-direction: column;[\s\S]*min-height: 0;[\s\S]*min-width: 0;[\s\S]*overflow: hidden;/);
  assert.match(stylesSource, /\.compositionPanel \{[\s\S]*flex: 1 1 auto;[\s\S]*min-height: 0;[\s\S]*overflow-y: auto;/);
  assert.match(stylesSource, /\.rightColumn \{[\s\S]*flex: 0 0 380px;[\s\S]*min-height: 0;[\s\S]*overflow: hidden;[\s\S]*width: 380px;/);
  assert.match(stylesSource, /\.receiptCard \{[\s\S]*flex: 1 1 auto;[\s\S]*min-height: 0;/);
  assert.match(stylesSource, /\.receiptList \{[\s\S]*flex: 1 1 auto;[\s\S]*overflow-y: auto;/);
  assert.match(stylesSource, /@media \(max-width: 767px\)/);
});

test("Sales page mounts SalesPageView as the unified composition source", () => {
  assert.match(pageSource, /getSalesPageView,\n\} from "@\/modules\/order-commits\/projections"/);
  assert.match(salesViewSource, /const salesPageView = await getSalesPageView/);
  assert.match(salesViewSource, /getPOSWorkspace:\s*async \(\) => workspace/);
  assert.match(
    salesViewSource,
    /const addOnMarketplace = toPOSAddOnMarketplace\(salesPageView\.composition\)/
  );
  assert.equal(
    [...salesViewSource.matchAll(/composition=\{salesPageView\.composition\}/g)]
      .length,
    3
  );
  assert.match(salesViewSource, /marketplace=\{addOnMarketplace\}/);
  assert.doesNotMatch(salesViewSource, /draftComposition/);
  assert.doesNotMatch(salesViewSource, /getDraftOrderCompositionViewModel/);
  assert.doesNotMatch(salesViewSource, /toDraftPOSComposition/);
});

test("Sales page load is read-only and does not create or stage drafts", () => {
  assert.match(salesViewSource, /const salesPageView = await getSalesPageView/);
  assert.doesNotMatch(salesViewSource, /getOrCreateOrderCommitDraft/);
  assert.doesNotMatch(salesViewSource, /stageOrderCommitDraftChange/);
  assert.doesNotMatch(salesViewSource, /await\s+stageSalesChangeAction/);
  assert.doesNotMatch(salesViewSource, /stageSalesChangeAction\(/);
});

test("Sales page uses OrderCommit staging handlers for all invoice states", () => {
  assert.match(pageSource, /import \{ stageSalesChangeAction \}/);
  assert.match(pageSource, /createOrderCommitSalesCompositionHandlers/);
  assert.match(pageSource, /createOrderCommitSalesAddOnHandlers/);
  assert.match(salesViewSource, /createOrderCommitSalesCompositionHandlers\(\{/);
  assert.match(
    salesViewSource,
    /expectedVersion:\s*salesPageView\.draft\?\.version \?\? 0/
  );
  assert.match(salesViewSource, /stageSalesChangeAction/);
  assert.match(salesViewSource, /createOrderCommitSalesAddOnHandlers\(\{/);
  assert.doesNotMatch(salesViewSource, /createPOSCompositionHandlers/);
  assert.doesNotMatch(salesViewSource, /createPOSAddOnHandlers/);
  assert.doesNotMatch(salesViewSource, /callPOSServerAction/);
  assert.doesNotMatch(salesViewSource, /updateOrderPackageAction/);
  assert.doesNotMatch(salesViewSource, /updateOrderSelectedPhotoCountAction/);
  assert.doesNotMatch(salesViewSource, /addOrderProductAddOnAction/);
  assert.doesNotMatch(salesViewSource, /removeOrderAddOnAction/);
});

test("Sales page forwards SalesPageView pieces to mounted surfaces", () => {
  assert.match(
    salesViewSource,
    /const addOnMarketplace = toPOSAddOnMarketplace\(salesPageView\.composition\)/
  );
  assert.match(salesViewSource, /composition=\{salesPageView\.composition\}/);
  assert.match(salesViewSource, /marketplace=\{addOnMarketplace\}/);
  assert.match(salesViewSource, /draft=\{salesPageView\.draft\}/);
  assert.match(salesViewSource, /preview=\{salesPageView\.preview\}/);
  assert.match(salesViewSource, /stagedChanges=\{salesPageView\.stagedChanges\}/);
  assert.match(
    salesViewSource,
    /financialPreview=\{salesPageView\.financialPreview\}/
  );
  assert.match(salesViewSource, /ownership=\{salesPageView\.ownership\}/);
});

test("Sales page applies co-editor ownership UI and policy overlay", () => {
  assert.match(pageSource, /SalesDraftOwnershipBanner/);
  assert.match(salesViewSource, /<SalesDraftOwnershipBanner/);
  assert.match(salesViewSource, /ownership=\{salesPageView\.ownership\}/);
  assert.match(pageSource, /applySalesDraftOwnershipToPackagePolicies/);
  assert.match(pageSource, /applySalesDraftOwnershipToAddOnPolicies/);
  assert.doesNotMatch(pageSource, /applyOrderCommitSalesSurfaceToFinancialPolicies/);
  assert.match(
    salesViewSource,
    /applySalesDraftOwnershipToPackagePolicies\([\s\S]*buildPOSPackageCompositionEditPolicies/
  );
  assert.match(
    salesViewSource,
    /applySalesDraftOwnershipToAddOnPolicies\([\s\S]*buildPOSAddOnEditPolicies/
  );
  assert.doesNotMatch(salesViewSource, /Take Over|takeOver/);
});

test("Sales page relocates staged commit controls into the right column", () => {
  assert.doesNotMatch(pageSource, /getOpenWorkspaceForInvoice/);
  assert.doesNotMatch(pageSource, /FinancialSidebarLocked/);
  assert.doesNotMatch(pageSource, /import \{ SalesStagedCommitControls \}/);
  assert.doesNotMatch(salesViewSource, /<SalesStagedCommitControls/);
  assert.match(pageSource, /SalesRightColumn/);
  assert.match(salesViewSource, /<SalesRightColumn/);
  assert.match(salesViewSource, /workspace=\{workspace\}/);
  assert.match(salesViewSource, /composition=\{salesPageView\.composition\}/);
  assert.match(salesViewSource, /draft=\{salesPageView\.draft\}/);
  assert.match(salesViewSource, /preview=\{salesPageView\.preview\}/);
  assert.match(salesViewSource, /stagedChanges=\{salesPageView\.stagedChanges\}/);
  assert.match(
    salesViewSource,
    /financialPreview=\{salesPageView\.financialPreview\}/
  );
  assert.match(salesViewSource, /ownership=\{salesPageView\.ownership\}/);
  assert.doesNotMatch(pageSource, /commitSalesChangesAction/);
});

test("Sales package item rows render deliverable cards with upgrade dialog", () => {
  assert.match(
    posPackageCompositionSource,
    /line\.packageItems\.map\(\(item\) => \(\s*<DeliverableCard/
  );
  assert.match(posPackageCompositionSource, /function DeliverableCard/);
  assert.match(posPackageCompositionSource, /<ItemUpgradeDialog/);
  assert.match(posPackageCompositionSource, /handlers\.upgradePackageItem/);
});

test("Sales page mounts the Spec 175 right column instead of the old financial sidebar", () => {
  assert.doesNotMatch(pageSource, /OrderCommitFinancialSidebar/);
  assert.doesNotMatch(salesViewSource, /<OrderCommitFinancialSidebar/);
  assert.doesNotMatch(pageSource, /buildPOSFinancialSidebarEditPolicies/);
  assert.doesNotMatch(pageSource, /applyOrderCommitSalesSurfaceToFinancialPolicies/);
  assert.match(pageSource, /SalesRightColumn/);
  assert.match(salesViewSource, /<SalesRightColumn/);
  assert.match(
    salesViewSource,
    /composition=\{salesPageView\.composition\}/
  );
  assert.match(
    salesViewSource,
    /financialPreview=\{salesPageView\.financialPreview\}/
  );
  assert.match(salesViewSource, /preview=\{salesPageView\.preview\}/);
  assert.doesNotMatch(pageSource, /FinancialSidebarDraft/);
  assert.doesNotMatch(pageSource, /FinancialSidebarLocked/);
  const rightColumnMountSource = salesViewSource.slice(
    salesViewSource.indexOf("<SalesRightColumn"),
    salesViewSource.indexOf("/>", salesViewSource.indexOf("<SalesRightColumn"))
  );
  assert.doesNotMatch(rightColumnMountSource, /financialCase=\{salesPageView\.financialCase\}/);
});

test("Sales page mount keeps source boundaries", () => {
  assert.doesNotMatch(pageSource, /@\/lib\/db/);
  assert.doesNotMatch(pageSource, /commitOrderChanges/);
  assert.doesNotMatch(salesViewSource, /getOpenWorkspaceForInvoice/);
  assert.doesNotMatch(salesViewSource, /FinancialSidebarLocked/);
});

test("locked Sales branch is removed from the active Sales page", () => {
  assert.doesNotMatch(pageSource, /if \(workspace\.invoice\?\.isLocked\)/);
  assert.doesNotMatch(pageSource, /getLockedOrderCompositionViewModel/);
  assert.doesNotMatch(pageSource, /getOpenWorkspaceForInvoice/);
  assert.doesNotMatch(pageSource, /toSalesSidebarLocked/);
  assert.doesNotMatch(pageSource, /<FinancialSidebarLocked/);
  assert.doesNotMatch(pageSource, /LockedCompositionView/);
  assert.match(salesViewSource, /getSalesPageView/);
  assert.match(salesViewSource, /SalesRightColumn/);
  assert.doesNotMatch(salesViewSource, /OrderCommitFinancialSidebar/);
});

test("staged commit controls mount the Spec 128 dialog and exact discard version", () => {
  assert.match(stagedControlsSource, /OrderCommitReviewDialog/);
  assert.match(stagedControlsSource, /discardSalesDraftAction/);
  assert.match(stagedControlsSource, /ownership\.canDiscard/);
  assert.match(stagedControlsSource, /discardAction\(orderId, draft\.version\)/);
  assert.match(stagedControlsSource, /canCommit=\{ownership\.canCommit\}/);
  assert.match(stagedControlsSource, /draft=\{draft\}/);
  assert.match(stagedControlsSource, /preview=\{preview\}/);
  assert.match(stagedControlsSource, /stagedChanges=\{stagedChanges\}/);
  assert.match(stagedControlsSource, /financialPreview=\{financialPreview\}/);
});

test("co-editor banner shows owner and manager override copy without takeover", () => {
  assert.match(ownershipBannerSource, /ownership\.banner\.title/);
  assert.match(ownershipBannerSource, /ownership\.banner\.description/);
  assert.match(ownershipBannerSource, /Manager override/);
  assert.match(ownershipBannerSource, /Refresh/);
  assert.doesNotMatch(ownershipBannerSource, /Take Over|takeOver/);
});

test("review dialog disables commit for blocked ownership and offers refresh on conflicts", () => {
  assert.match(orderCommitReviewDialogSource, /canCommit/);
  assert.match(
    orderCommitReviewDialogSource,
    /const canSubmit = Boolean\(draft && preview && canCommit\)/
  );
  assert.match(orderCommitReviewDialogSource, /commitErrorNeedsRefresh/);
  assert.match(orderCommitReviewDialogSource, /commit\.permission/);
  assert.match(orderCommitReviewDialogSource, /router\.refresh\(\)/);
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
  assert.doesNotMatch(ownershipBannerSource, /@\/lib\/db/);
  assert.doesNotMatch(ownershipBannerSource, /commitOrderChanges/);
  assert.doesNotMatch(ownershipBannerSource, /AdjustmentWorkspace/);
});

test("Sales right column stays display-only", () => {
  assert.match(salesRightColumnSource, /financialPreview\.settlement/);
  assert.match(salesRightColumnSource, /Previous total/);
  assert.match(salesRightColumnSource, /Pending diff/);
  assert.match(salesRightColumnSource, /After commit/);
  assert.match(salesRightColumnSource, /Due after commit/);
  assert.match(salesRightColumnSource, /SalesStagedCommitControls/);
  assert.match(salesRightColumnSource, /POSRecordPaymentDialog/);
  assert.doesNotMatch(salesRightColumnSource, /CreateOrderInvoiceForm|Create Invoice/);
  assert.doesNotMatch(salesRightColumnSource, /Document plan/);
  assert.doesNotMatch(salesRightColumnSource, /Payment impact/);
  assert.doesNotMatch(salesRightColumnSource, /Refund impact/);
  assert.doesNotMatch(salesRightColumnSource, /@\/lib\/db/);
  assert.doesNotMatch(salesRightColumnSource, /commitOrderChanges/);
  assert.doesNotMatch(salesRightColumnSource, /AdjustmentWorkspace/);
  assert.doesNotMatch(salesRightColumnSource, /lineDiffs/);
  assert.doesNotMatch(salesRightColumnSource, /row\.netDelta\s*[-+*/]/);
  assert.doesNotMatch(salesRightColumnSource, /[-+*/]\s*row\.netDelta/);
  assert.doesNotMatch(salesRightColumnSource, /pendingTotal\s*[-+*/]/);
  assert.doesNotMatch(salesRightColumnSource, /pendingDelta\s*[-+*/]/);
  assert.doesNotMatch(salesRightColumnSource, /previousTotal\s*[-+*/]/);
});

test("OrderCommit review dialog receives display DTOs without line-diff arithmetic", () => {
  assert.match(orderCommitReviewDialogSource, /draft\.version/);
  assert.match(orderCommitReviewDialogSource, /stagedChanges\.map/);
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
  assert.doesNotMatch(salesViewSource, /Adjustment Workspace/);
  assert.doesNotMatch(salesViewSource, /AdjustmentWorkspace/);

  for (const file of ORDER_COMMIT_SALES_SURFACE_FILES) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /Adjustment Workspace/, `${file} has public legacy copy`);
    assert.doesNotMatch(source, /AdjustmentWorkspace/, `${file} has public legacy naming`);
  }
});

test("OrderCommit Sales page and components do not calculate preview money from rows", () => {
  const guardedFiles = [
    "app/(app)/orders/[orderId]/sales/page.tsx",
    "app/(app)/orders/[orderId]/sales/sales-right-column.tsx",
    "src/components/orders/sales-staged-commit-controls.tsx",
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
