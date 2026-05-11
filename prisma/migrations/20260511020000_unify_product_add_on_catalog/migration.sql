-- Extend Product so it can serve both package composition and standalone add-ons.
ALTER TABLE "products"
  ADD COLUMN "isPackageDeliverable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "isAddOn" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Move standalone add-on catalog rows into Product.
INSERT INTO "products" (
  "id",
  "name",
  "category",
  "canonicalPrice",
  "description",
  "isActive",
  "isPackageDeliverable",
  "isAddOn",
  "sortOrder",
  "createdAt",
  "updatedAt"
)
SELECT
  CASE
    WHEN "category" = 'EXTRA_PHOTO' THEN 'addon-extra-photo'
    ELSE "id"
  END,
  "name",
  CASE
    WHEN "category" = 'ALBUM' THEN 'ALBUM'::"ProductCategory"
    WHEN "category" = 'CANVAS' THEN 'CANVAS'::"ProductCategory"
    WHEN "category" = 'DIGITAL' THEN 'DIGITAL'::"ProductCategory"
    WHEN "category" = 'PRINT' THEN 'PRINT'::"ProductCategory"
    WHEN "category" = 'FRAME' THEN 'FRAME'::"ProductCategory"
    WHEN "category" = 'USB' THEN 'USB'::"ProductCategory"
    ELSE 'OTHER'::"ProductCategory"
  END,
  "price",
  CASE
    WHEN "category" = 'EXTRA_PHOTO' THEN 'Extra-photo unit price'
    ELSE NULL
  END,
  "isActive",
  false,
  true,
  "sortOrder",
  "createdAt",
  "updatedAt"
FROM "order_add_on_options"
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "canonicalPrice" = EXCLUDED."canonicalPrice",
  "description" = EXCLUDED."description",
  "isActive" = EXCLUDED."isActive",
  "isPackageDeliverable" = EXCLUDED."isPackageDeliverable",
  "isAddOn" = true,
  "sortOrder" = EXCLUDED."sortOrder",
  "updatedAt" = CURRENT_TIMESTAMP;

-- Repoint existing order add-on snapshots at Product.
ALTER TABLE "order_add_ons" ADD COLUMN "productId" TEXT;

-- Extra-photo charges are service-computed from the stable system product,
-- so legacy snapshot rows must be removed to avoid double-counting.
DELETE FROM "order_add_ons"
USING "order_add_on_options"
WHERE "order_add_ons"."addOnOptionId" = "order_add_on_options"."id"
  AND "order_add_on_options"."category" = 'EXTRA_PHOTO';

UPDATE "order_add_ons"
SET "productId" = "addOnOptionId"
WHERE "addOnOptionId" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "products"
    WHERE "products"."id" = "order_add_ons"."addOnOptionId"
  );

ALTER TABLE "order_add_ons" DROP CONSTRAINT "order_add_ons_addOnOptionId_fkey";
DROP INDEX IF EXISTS "order_add_ons_productId_idx";
CREATE INDEX "order_add_ons_productId_idx" ON "order_add_ons"("productId");
ALTER TABLE "order_add_ons" ADD CONSTRAINT "order_add_ons_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "order_add_ons" DROP COLUMN "addOnOptionId";
DROP TABLE "order_add_on_options";

CREATE INDEX "products_isAddOn_isActive_sortOrder_idx" ON "products"("isAddOn", "isActive", "sortOrder");
