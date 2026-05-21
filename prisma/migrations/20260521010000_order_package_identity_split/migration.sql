ALTER TABLE "order_packages"
  ADD COLUMN "originalPackageId" TEXT,
  ADD COLUMN "currentPackageId" TEXT,
  ADD COLUMN "bookingPackageId" TEXT,
  ADD COLUMN "originalPackageNameSnapshot" TEXT,
  ADD COLUMN "currentPackageNameSnapshot" TEXT;

UPDATE "order_packages" op
SET
  "originalPackageId" = op."packageId",
  "currentPackageId" = op."packageId",
  "originalPackageNameSnapshot" = p."name",
  "currentPackageNameSnapshot" = p."name"
FROM "packages" p
WHERE p."id" = op."packageId";

UPDATE "order_packages" op
SET "bookingPackageId" = bp."id"
FROM "orders" o
JOIN "booking_packages" bp
  ON bp."bookingId" = o."bookingId"
WHERE o."id" = op."orderId"
  AND bp."packageId" = op."packageId"
  AND bp."sessionTypeId" = op."sessionTypeId"
  AND bp."sortOrder" = op."sortOrder";

ALTER TABLE "order_packages"
  ALTER COLUMN "originalPackageId" SET NOT NULL,
  ALTER COLUMN "currentPackageId" SET NOT NULL,
  ALTER COLUMN "originalPackageNameSnapshot" SET NOT NULL,
  ALTER COLUMN "currentPackageNameSnapshot" SET NOT NULL;

DROP INDEX IF EXISTS "order_packages_packageId_idx";
ALTER TABLE "order_packages" DROP CONSTRAINT IF EXISTS "order_packages_packageId_fkey";
ALTER TABLE "order_packages" DROP COLUMN "packageId";

ALTER TABLE "order_packages"
  ADD CONSTRAINT "order_packages_originalPackageId_fkey"
    FOREIGN KEY ("originalPackageId") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "order_packages_currentPackageId_fkey"
    FOREIGN KEY ("currentPackageId") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "order_packages_bookingPackageId_fkey"
    FOREIGN KEY ("bookingPackageId") REFERENCES "booking_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "order_packages_originalPackageId_idx" ON "order_packages"("originalPackageId");
CREATE INDEX "order_packages_currentPackageId_idx" ON "order_packages"("currentPackageId");
CREATE INDEX "order_packages_bookingPackageId_idx" ON "order_packages"("bookingPackageId");
