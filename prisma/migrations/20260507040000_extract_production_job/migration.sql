CREATE TABLE "production_jobs" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "status" "OrderProductionStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "albumDesignStatus" "OrderProductionSectionStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "printingStatus" "OrderProductionSectionStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "assemblyStatus" "OrderProductionSectionStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "vendorStatus" "OrderProductionSectionStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "framedPrintsStatus" "OrderProductionSectionStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "finalStatus" "OrderProductionSectionStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "productionStartedAt" TIMESTAMP(3),
  "readyForPickupAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "vendorName" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_jobs_jobId_key" ON "production_jobs"("jobId");
CREATE UNIQUE INDEX "production_jobs_orderId_key" ON "production_jobs"("orderId");

ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "production_jobs" (
  "id",
  "jobId",
  "orderId",
  "status",
  "albumDesignStatus",
  "printingStatus",
  "assemblyStatus",
  "vendorStatus",
  "framedPrintsStatus",
  "finalStatus",
  "productionStartedAt",
  "readyForPickupAt",
  "completedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT('production-', "orders"."id"),
  "orders"."jobId",
  "orders"."id",
  "orders"."productionStatus",
  "orders"."productionAlbumDesignStatus",
  "orders"."productionPrintingStatus",
  "orders"."productionAssemblyStatus",
  "orders"."productionVendorStatus",
  "orders"."productionFramedPrintsStatus",
  "orders"."productionFinalStatus",
  CASE
    WHEN "orders"."productionStatus" IN ('IN_PROGRESS', 'WAITING_FOR_VENDOR', 'READY_FOR_PICKUP', 'COMPLETED')
      THEN "orders"."updatedAt"
    ELSE NULL
  END,
  "orders"."productionReadyAt",
  CASE
    WHEN "orders"."productionStatus" = 'COMPLETED'
      THEN COALESCE("orders"."deliveryCompletedAt", "orders"."productionReadyAt", "orders"."updatedAt")
    ELSE NULL
  END,
  "orders"."createdAt",
  "orders"."updatedAt"
FROM "orders";

ALTER TABLE "orders"
  DROP COLUMN "productionStatus",
  DROP COLUMN "productionAlbumDesignStatus",
  DROP COLUMN "productionPrintingStatus",
  DROP COLUMN "productionAssemblyStatus",
  DROP COLUMN "productionVendorStatus",
  DROP COLUMN "productionFramedPrintsStatus",
  DROP COLUMN "productionFinalStatus",
  DROP COLUMN "productionReadyAt";
