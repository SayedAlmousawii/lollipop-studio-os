import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  "app/orders/[orderId]/sales/page.tsx",
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

test("Task 3 keeps later Spec 129 surfaces unmounted", () => {
  assert.match(pageSource, /getOpenWorkspaceForInvoice/);
  assert.match(pageSource, /FinancialSidebarLocked/);
  assert.match(pageSource, /FinancialSidebarDraft/);
  assert.doesNotMatch(pageSource, /OrderCommitReviewDialog/);
  assert.doesNotMatch(pageSource, /discardSalesDraftAction/);
  assert.doesNotMatch(pageSource, /commitSalesChangesAction/);
});

test("Sales page mount keeps source boundaries", () => {
  assert.doesNotMatch(pageSource, /@\/lib\/db/);
  assert.doesNotMatch(pageSource, /commitOrderChanges/);
  assert.doesNotMatch(unlockedSource, /getOpenWorkspaceForInvoice/);
  assert.doesNotMatch(unlockedSource, /FinancialSidebarLocked/);
});
