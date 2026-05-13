BEGIN;

LOCK TABLE "booking_packages" IN ACCESS EXCLUSIVE MODE;

WITH duplicate_booking_packages AS (
  SELECT
    "bookingId",
    "packageId",
    MIN("id") AS "keepId",
    SUM("quantity") AS "totalQuantity",
    MIN("sortOrder") AS "firstSortOrder"
  FROM "booking_packages"
  GROUP BY "bookingId", "packageId"
  HAVING COUNT(*) > 1
)
UPDATE "booking_packages" AS kept
SET
  "quantity" = duplicates."totalQuantity",
  "sortOrder" = duplicates."firstSortOrder",
  "updatedAt" = now()
FROM duplicate_booking_packages AS duplicates
WHERE kept."id" = duplicates."keepId";

WITH duplicate_booking_packages AS (
  SELECT
    "id",
    MIN("id") OVER (PARTITION BY "bookingId", "packageId") AS "keepId"
  FROM "booking_packages"
)
DELETE FROM "booking_packages" AS duplicate
USING duplicate_booking_packages AS duplicates
WHERE duplicate."id" = duplicates."id"
  AND duplicate."id" <> duplicates."keepId";

CREATE UNIQUE INDEX "booking_packages_bookingId_packageId_key"
  ON "booking_packages"("bookingId", "packageId");

COMMIT;
