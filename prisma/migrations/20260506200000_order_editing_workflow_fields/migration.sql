ALTER TABLE "orders"
ADD COLUMN "assignedEditorId" TEXT,
ADD COLUMN "editingAssignedAt" TIMESTAMP(3),
ADD COLUMN "editingStartedAt" TIMESTAMP(3),
ADD COLUMN "editingCompletedAt" TIMESTAMP(3),
ADD COLUMN "customerApprovedAt" TIMESTAMP(3),
ADD COLUMN "sentToProductionAt" TIMESTAMP(3),
ADD COLUMN "editedPhotoCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "revisionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "estimatedEditingCompletionAt" TIMESTAMP(3);

CREATE INDEX "orders_assignedEditorId_idx" ON "orders"("assignedEditorId");

ALTER TABLE "orders"
ADD CONSTRAINT "orders_assignedEditorId_fkey"
FOREIGN KEY ("assignedEditorId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
