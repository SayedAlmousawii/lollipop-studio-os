DELETE FROM "package_items"
WHERE "quantity" <= 0
   OR "priceSnapshot" < 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "package_items"
    GROUP BY "packageId", "productId"
    HAVING COUNT(DISTINCT "priceSnapshot") > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot apply package item integrity constraints. Duplicate package_items rows disagree on priceSnapshot.';
  END IF;
END $$;

WITH ranked_duplicates AS (
  SELECT
    "id",
    "packageId",
    "productId",
    SUM("quantity") OVER (PARTITION BY "packageId", "productId") AS total_quantity,
    ROW_NUMBER() OVER (
      PARTITION BY "packageId", "productId"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS duplicate_rank
  FROM "package_items"
),
updated_keepers AS (
  UPDATE "package_items"
  SET "quantity" = ranked_duplicates.total_quantity
  FROM ranked_duplicates
  WHERE "package_items"."id" = ranked_duplicates."id"
    AND ranked_duplicates.duplicate_rank = 1
  RETURNING "package_items"."id"
)
DELETE FROM "package_items"
USING ranked_duplicates
WHERE "package_items"."id" = ranked_duplicates."id"
  AND ranked_duplicates.duplicate_rank > 1;

DO $$
DECLARE
  invalid_product_ids TEXT;
BEGIN
  SELECT string_agg("id", ', ' ORDER BY "id")
  INTO invalid_product_ids
  FROM "products"
  WHERE "canonicalPrice" < 0;

  IF invalid_product_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot apply package item integrity constraints. Negative canonicalPrice rows exist in products: %',
      invalid_product_ids;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_canonicalPrice_check'
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_canonicalPrice_check"
      CHECK ("canonicalPrice" >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "package_items"
    WHERE "quantity" <= 0
       OR "priceSnapshot" < 0
  ) THEN
    RAISE EXCEPTION 'Cannot apply package item integrity constraints. Invalid package_items numeric rows still exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "package_items"
    GROUP BY "packageId", "productId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot apply package item integrity constraints. Duplicate package_items rows still exist.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'package_items_packageId_productId_key'
  ) THEN
    ALTER TABLE "package_items"
      ADD CONSTRAINT "package_items_packageId_productId_key"
      UNIQUE ("packageId", "productId");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'package_items_quantity_check'
  ) THEN
    ALTER TABLE "package_items"
      ADD CONSTRAINT "package_items_quantity_check"
      CHECK ("quantity" > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'package_items_priceSnapshot_check'
  ) THEN
    ALTER TABLE "package_items"
      ADD CONSTRAINT "package_items_priceSnapshot_check"
      CHECK ("priceSnapshot" >= 0);
  END IF;
END $$;
