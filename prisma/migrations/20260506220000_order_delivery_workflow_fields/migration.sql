ALTER TABLE "orders"
ADD COLUMN "deliveryPreparedAt" TIMESTAMP(3),
ADD COLUMN "customerNotifiedAt" TIMESTAMP(3),
ADD COLUMN "pickedUpAt" TIMESTAMP(3),
ADD COLUMN "deliveryCompletedAt" TIMESTAMP(3),
ADD COLUMN "deliveryCompletedBy" TEXT,
ADD COLUMN "deliveryPickupNotes" TEXT,
ADD COLUMN "deliveryOverrideReason" TEXT;
