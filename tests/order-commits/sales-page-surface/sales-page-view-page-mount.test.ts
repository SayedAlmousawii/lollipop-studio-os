import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  "app/orders/[orderId]/sales/page.tsx",
  "utf8"
);
const stagedControlsSource = readFileSync(
  "src/components/orders/sales-staged-commit-controls.tsx",
  "utf8"
);
const unlockedSource = pageSource.slice(
  pageSource.indexOf("const salesPageView = await getSalesPageView"),
  pageSource.indexOf("function LockedCompositionView")
);

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
    3
  );
  assert.match(unlockedSource, /marketplace=\{addOnMarketplace\}/);
  assert.doesNotMatch(unlockedSource, /draftComposition/);
  assert.doesNotMatch(unlockedSource, /getDraftOrderCompositionViewModel/);
  assert.doesNotMatch(unlockedSource, /toDraftPOSComposition/);
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

test("unlocked Sales page mounts staged commit controls", () => {
  assert.match(pageSource, /getOpenWorkspaceForInvoice/);
  assert.match(pageSource, /FinancialSidebarLocked/);
  assert.match(pageSource, /FinancialSidebarDraft/);
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

test("Sales page mount keeps source boundaries", () => {
  assert.doesNotMatch(pageSource, /@\/lib\/db/);
  assert.doesNotMatch(pageSource, /commitOrderChanges/);
  assert.doesNotMatch(unlockedSource, /getOpenWorkspaceForInvoice/);
  assert.doesNotMatch(unlockedSource, /FinancialSidebarLocked/);
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
