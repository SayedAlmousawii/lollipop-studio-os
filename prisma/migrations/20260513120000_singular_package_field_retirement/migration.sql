ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_packageId_fkey";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_originalPackageId_fkey";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_finalPackageId_fkey";

ALTER TABLE "bookings" DROP COLUMN IF EXISTS "packageId";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "sessionType";

ALTER TABLE "orders" DROP COLUMN IF EXISTS "originalPackageId";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "finalPackageId";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "originalPackagePriceSnapshot";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "finalPackagePriceSnapshot";

DROP TYPE IF EXISTS "BookingSessionType";

DELETE FROM "products" WHERE "id" = 'addon-extra-photo';
