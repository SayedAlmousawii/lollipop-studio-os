CREATE TABLE "editing_jobs" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "assignedEditorId" TEXT,
  "status" "OrderEditingStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "editedPhotoCount" INTEGER NOT NULL DEFAULT 0,
  "revisionCount" INTEGER NOT NULL DEFAULT 0,
  "editingAssignedAt" TIMESTAMP(3),
  "editingStartedAt" TIMESTAMP(3),
  "editingCompletedAt" TIMESTAMP(3),
  "customerApprovedAt" TIMESTAMP(3),
  "sentToProductionAt" TIMESTAMP(3),
  "estimatedEditingCompletionAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "editing_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "editing_jobs_jobId_key" ON "editing_jobs"("jobId");
CREATE UNIQUE INDEX "editing_jobs_orderId_key" ON "editing_jobs"("orderId");
CREATE INDEX "editing_jobs_assignedEditorId_idx" ON "editing_jobs"("assignedEditorId");

ALTER TABLE "editing_jobs" ADD CONSTRAINT "editing_jobs_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "editing_jobs" ADD CONSTRAINT "editing_jobs_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "editing_jobs" ADD CONSTRAINT "editing_jobs_assignedEditorId_fkey"
FOREIGN KEY ("assignedEditorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "editing_jobs" (
  "id",
  "jobId",
  "orderId",
  "assignedEditorId",
  "status",
  "editedPhotoCount",
  "revisionCount",
  "editingAssignedAt",
  "editingStartedAt",
  "editingCompletedAt",
  "customerApprovedAt",
  "sentToProductionAt",
  "estimatedEditingCompletionAt",
  "notes",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT('editing-', "orders"."id"),
  "orders"."jobId",
  "orders"."id",
  "orders"."assignedEditorId",
  "orders"."editingStatus",
  "orders"."editedPhotoCount",
  "orders"."revisionCount",
  "orders"."editingAssignedAt",
  "orders"."editingStartedAt",
  "orders"."editingCompletedAt",
  "orders"."customerApprovedAt",
  "orders"."sentToProductionAt",
  "orders"."estimatedEditingCompletionAt",
  NULL,
  "orders"."createdAt",
  "orders"."updatedAt"
FROM "orders";

ALTER TABLE "orders" DROP CONSTRAINT "orders_assignedEditorId_fkey";
DROP INDEX IF EXISTS "orders_assignedEditorId_idx";

ALTER TABLE "orders"
  DROP COLUMN "assignedEditorId",
  DROP COLUMN "editingStatus",
  DROP COLUMN "editingAssignedAt",
  DROP COLUMN "editingStartedAt",
  DROP COLUMN "editingCompletedAt",
  DROP COLUMN "customerApprovedAt",
  DROP COLUMN "sentToProductionAt",
  DROP COLUMN "editedPhotoCount",
  DROP COLUMN "revisionCount",
  DROP COLUMN "estimatedEditingCompletionAt";
