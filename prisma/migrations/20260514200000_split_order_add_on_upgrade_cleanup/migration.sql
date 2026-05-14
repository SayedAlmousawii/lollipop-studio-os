-- Step 3: backfill upgrade rows, remove them from order_add_ons, then enforce
-- true add-on constraints on order_add_ons.
BEGIN;

DO $$
DECLARE
  preflight_count INTEGER;
  postflight_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO preflight_count
  FROM "order_add_ons"
  WHERE "packageItemId" IS NOT NULL;

  INSERT INTO "order_package_item_upgrades" (
    "id",
    "orderId",
    "orderPackageId",
    "packageItemId",
    "nameSnapshot",
    "priceSnapshot",
    "quantity",
    "notes",
    "createdAt",
    "updatedAt"
  )
  SELECT
    gen_random_uuid()::text,
    "orderId",
    "orderPackageId",
    "packageItemId",
    "nameSnapshot",
    "priceSnapshot",
    "quantity",
    "notes",
    "createdAt",
    "updatedAt"
  FROM "order_add_ons"
  WHERE "packageItemId" IS NOT NULL
    AND "orderPackageId" IS NOT NULL
  ON CONFLICT ("orderId", "orderPackageId", "packageItemId") DO NOTHING;

  DELETE FROM "order_add_ons"
  WHERE "packageItemId" IS NOT NULL;

  SELECT COUNT(*) INTO postflight_count
  FROM "order_add_ons"
  WHERE "packageItemId" IS NOT NULL;

  IF postflight_count <> 0 THEN
    RAISE EXCEPTION 'Expected zero upgrade rows in order_add_ons after backfill, found %', postflight_count;
  END IF;

  RAISE NOTICE 'Backfilled % order add-on upgrade rows into order_package_item_upgrades', preflight_count;
END $$;

DO $$
DECLARE
  null_product_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_product_count
  FROM "order_add_ons"
  WHERE "productId" IS NULL;

  IF null_product_count <> 0 THEN
    RAISE EXCEPTION 'Cannot enforce true add-on productId constraint; found % rows with NULL productId', null_product_count;
  END IF;
END $$;

ALTER TABLE "order_add_ons"
DROP CONSTRAINT IF EXISTS "order_add_ons_packageItemId_fkey";

DROP INDEX IF EXISTS "order_add_ons_orderId_orderPackageId_packageItemId_key";
DROP INDEX IF EXISTS "order_add_ons_orderId_packageItemId_key";
DROP INDEX IF EXISTS "order_add_ons_packageItemId_idx";

ALTER TABLE "order_add_ons"
DROP COLUMN IF EXISTS "packageItemId";

ALTER TABLE "order_add_ons"
ALTER COLUMN "productId" SET NOT NULL;

ALTER TABLE "order_add_ons"
DROP CONSTRAINT IF EXISTS "order_add_ons_productId_fkey";

ALTER TABLE "order_add_ons"
ADD CONSTRAINT "order_add_ons_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "products"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "order_add_ons_orderId_orderPackageId_productId_key"
ON "order_add_ons"("orderId", "orderPackageId", "productId");

COMMIT;
