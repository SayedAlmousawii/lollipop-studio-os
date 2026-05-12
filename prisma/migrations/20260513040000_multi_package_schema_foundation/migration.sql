-- Create package-line tables for multi-package bookings and orders.
CREATE TABLE "booking_packages" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "sessionTypeId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "booking_packages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_packages" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "sessionTypeId" TEXT NOT NULL,
  "originalPackagePriceSnapshot" DECIMAL(10,3),
  "finalPackagePriceSnapshot" DECIMAL(10,3),
  "selectedPhotoCount" INTEGER,
  "extraDigitalCount" INTEGER NOT NULL DEFAULT 0,
  "extraPrintCount" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "order_packages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "booking_packages_bookingId_sortOrder_idx"
  ON "booking_packages"("bookingId", "sortOrder");

CREATE INDEX "booking_packages_packageId_idx"
  ON "booking_packages"("packageId");

CREATE INDEX "booking_packages_sessionTypeId_idx"
  ON "booking_packages"("sessionTypeId");

CREATE INDEX "order_packages_orderId_sortOrder_idx"
  ON "order_packages"("orderId", "sortOrder");

CREATE INDEX "order_packages_packageId_idx"
  ON "order_packages"("packageId");

CREATE INDEX "order_packages_sessionTypeId_idx"
  ON "order_packages"("sessionTypeId");

ALTER TABLE "booking_packages"
  ADD CONSTRAINT "booking_packages_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_packages"
  ADD CONSTRAINT "booking_packages_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "packages"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "booking_packages"
  ADD CONSTRAINT "booking_packages_sessionTypeId_fkey"
  FOREIGN KEY ("sessionTypeId") REFERENCES "session_types"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_packages"
  ADD CONSTRAINT "order_packages_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_packages"
  ADD CONSTRAINT "order_packages_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "packages"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_packages"
  ADD CONSTRAINT "order_packages_sessionTypeId_fkey"
  FOREIGN KEY ("sessionTypeId") REFERENCES "session_types"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill one line per existing singular booking package.
INSERT INTO "booking_packages" (
  "id",
  "bookingId",
  "packageId",
  "sessionTypeId",
  "quantity",
  "sortOrder",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  b."id",
  b."packageId",
  st."id",
  1,
  0,
  NOW(),
  NOW()
FROM "bookings" b
JOIN "session_types" st
  ON st."code" = CASE b."sessionType"
    WHEN 'NEWBORN' THEN 'NB_NEWBORN'
    WHEN 'KIDS' THEN 'KD_REGULAR'
    WHEN 'FAMILY' THEN 'KD_FAMILY'
    WHEN 'MATERNITY' THEN 'NB_MATERNITY'
    WHEN 'OTHER' THEN 'KD_REGULAR'
  END
WHERE b."packageId" IS NOT NULL;

-- Backfill one line per existing singular order package.
INSERT INTO "order_packages" (
  "id",
  "orderId",
  "packageId",
  "sessionTypeId",
  "originalPackagePriceSnapshot",
  "finalPackagePriceSnapshot",
  "selectedPhotoCount",
  "extraDigitalCount",
  "extraPrintCount",
  "sortOrder",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  o."id",
  o."originalPackageId",
  st."id",
  o."originalPackagePriceSnapshot",
  o."finalPackagePriceSnapshot",
  o."selectedPhotoCount",
  0,
  0,
  0,
  NOW(),
  NOW()
FROM "orders" o
JOIN "bookings" b ON b."id" = o."bookingId"
JOIN "session_types" st
  ON st."code" = CASE b."sessionType"
    WHEN 'NEWBORN' THEN 'NB_NEWBORN'
    WHEN 'KIDS' THEN 'KD_REGULAR'
    WHEN 'FAMILY' THEN 'KD_FAMILY'
    WHEN 'MATERNITY' THEN 'NB_MATERNITY'
    WHEN 'OTHER' THEN 'KD_REGULAR'
  END
WHERE o."originalPackageId" IS NOT NULL;
