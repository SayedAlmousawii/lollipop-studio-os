CREATE TYPE "OrderProductionSectionStatus" AS ENUM (
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETED'
);

ALTER TABLE "orders"
ADD COLUMN "productionAlbumDesignStatus" "OrderProductionSectionStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN "productionPrintingStatus" "OrderProductionSectionStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN "productionAssemblyStatus" "OrderProductionSectionStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN "productionVendorStatus" "OrderProductionSectionStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN "productionFramedPrintsStatus" "OrderProductionSectionStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN "productionFinalStatus" "OrderProductionSectionStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN "productionReadyAt" TIMESTAMP(3);
