ALTER TABLE "order_commits"
  ADD COLUMN "committedFromDraftId" TEXT;

DROP INDEX "order_commits_orderId_committedFromDraftVersion_key";

CREATE UNIQUE INDEX "order_commits_orderId_committedFromDraftId_key"
  ON "order_commits"("orderId", "committedFromDraftId");
