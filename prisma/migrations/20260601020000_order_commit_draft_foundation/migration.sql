CREATE TABLE "order_commit_drafts" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "financialCaseId" TEXT NOT NULL,
  "baseCommitId" TEXT,
  "pendingSnapshotVersion" INTEGER NOT NULL DEFAULT 1,
  "pendingSnapshotJson" JSONB NOT NULL,
  "pendingOpsJson" JSONB NOT NULL DEFAULT '{"schemaVersion":"order_commit_draft_pending_ops_v1","operations":[]}',
  "version" INTEGER NOT NULL DEFAULT 0,
  "ownerUserId" TEXT NOT NULL,
  "openedByUserId" TEXT NOT NULL,
  "lastTouchedByUserId" TEXT NOT NULL,
  "legacyAdjustmentWorkspaceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "order_commit_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_commit_drafts_orderId_key"
  ON "order_commit_drafts"("orderId");

CREATE INDEX "order_commit_drafts_financialCaseId_idx"
  ON "order_commit_drafts"("financialCaseId");

CREATE INDEX "order_commit_drafts_baseCommitId_idx"
  ON "order_commit_drafts"("baseCommitId");

CREATE INDEX "order_commit_drafts_ownerUserId_idx"
  ON "order_commit_drafts"("ownerUserId");

CREATE INDEX "order_commit_drafts_legacyAdjustmentWorkspaceId_idx"
  ON "order_commit_drafts"("legacyAdjustmentWorkspaceId");

ALTER TABLE "order_commit_drafts"
  ADD CONSTRAINT "order_commit_drafts_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "order_commit_drafts_financialCaseId_fkey"
    FOREIGN KEY ("financialCaseId") REFERENCES "financial_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "order_commit_drafts_baseCommitId_fkey"
    FOREIGN KEY ("baseCommitId") REFERENCES "order_commits"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "order_commit_drafts_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "order_commit_drafts_openedByUserId_fkey"
    FOREIGN KEY ("openedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "order_commit_drafts_lastTouchedByUserId_fkey"
    FOREIGN KEY ("lastTouchedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "order_commit_drafts_legacyAdjustmentWorkspaceId_fkey"
    FOREIGN KEY ("legacyAdjustmentWorkspaceId") REFERENCES "adjustment_workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
