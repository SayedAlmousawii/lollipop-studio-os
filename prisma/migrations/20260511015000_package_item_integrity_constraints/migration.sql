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
