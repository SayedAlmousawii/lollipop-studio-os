ALTER TABLE "order_commits"
  ADD COLUMN "committedFromDraftVersion" INTEGER;

CREATE UNIQUE INDEX "order_commits_orderId_committedFromDraftVersion_key"
  ON "order_commits"("orderId", "committedFromDraftVersion");

CREATE TABLE "order_commit_documents" (
  "id" TEXT NOT NULL,
  "orderCommitId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "order_commit_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_commit_documents_orderCommitId_invoiceId_role_key"
  ON "order_commit_documents"("orderCommitId", "invoiceId", "role");

CREATE INDEX "order_commit_documents_orderCommitId_idx"
  ON "order_commit_documents"("orderCommitId");

CREATE INDEX "order_commit_documents_invoiceId_idx"
  ON "order_commit_documents"("invoiceId");

ALTER TABLE "order_commit_documents"
  ADD CONSTRAINT "order_commit_documents_orderCommitId_fkey"
    FOREIGN KEY ("orderCommitId") REFERENCES "order_commits"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "order_commit_documents_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
