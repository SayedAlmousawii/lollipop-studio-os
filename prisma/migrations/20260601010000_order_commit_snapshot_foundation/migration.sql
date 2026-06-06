CREATE TABLE "order_commits" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "financialCaseId" TEXT NOT NULL,
  "previousCommitId" TEXT,
  "sequence" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
  "snapshotJson" JSONB NOT NULL,
  "metadataJson" JSONB NOT NULL DEFAULT '{}',
  "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "committedByUserId" TEXT,
  "legacyAdjustmentWorkspaceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "order_commits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_commits_orderId_sequence_key"
  ON "order_commits"("orderId", "sequence");

CREATE INDEX "order_commits_orderId_idx"
  ON "order_commits"("orderId");

CREATE INDEX "order_commits_financialCaseId_idx"
  ON "order_commits"("financialCaseId");

CREATE INDEX "order_commits_previousCommitId_idx"
  ON "order_commits"("previousCommitId");

CREATE INDEX "order_commits_committedAt_idx"
  ON "order_commits"("committedAt");

CREATE INDEX "order_commits_legacyAdjustmentWorkspaceId_idx"
  ON "order_commits"("legacyAdjustmentWorkspaceId");

ALTER TABLE "order_commits"
  ADD CONSTRAINT "order_commits_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "order_commits_financialCaseId_fkey"
    FOREIGN KEY ("financialCaseId") REFERENCES "financial_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "order_commits_previousCommitId_fkey"
    FOREIGN KEY ("previousCommitId") REFERENCES "order_commits"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "order_commits_committedByUserId_fkey"
    FOREIGN KEY ("committedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "order_commits_legacyAdjustmentWorkspaceId_fkey"
    FOREIGN KEY ("legacyAdjustmentWorkspaceId") REFERENCES "adjustment_workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
