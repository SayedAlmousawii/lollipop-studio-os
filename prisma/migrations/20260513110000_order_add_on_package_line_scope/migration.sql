ALTER TABLE "order_add_ons" ADD COLUMN "orderPackageId" TEXT;

UPDATE "order_add_ons" oa
SET "orderPackageId" = (
  SELECT op."id"
  FROM "order_packages" op
  JOIN "package_items" pi ON pi."packageId" = op."packageId"
  WHERE pi."id" = oa."packageItemId"
    AND op."orderId" = oa."orderId"
  ORDER BY op."sortOrder" ASC, op."createdAt" ASC
  LIMIT 1
)
WHERE oa."packageItemId" IS NOT NULL
  AND oa."orderPackageId" IS NULL;

ALTER TABLE "order_add_ons"
  DROP CONSTRAINT IF EXISTS "order_add_ons_orderId_packageItemId_key";

CREATE UNIQUE INDEX "order_add_ons_orderId_orderPackageId_packageItemId_key"
  ON "order_add_ons"("orderId", "orderPackageId", "packageItemId");

CREATE INDEX "order_add_ons_orderPackageId_idx"
  ON "order_add_ons"("orderPackageId");

ALTER TABLE "order_add_ons"
  ADD CONSTRAINT "order_add_ons_orderPackageId_fkey"
  FOREIGN KEY ("orderPackageId") REFERENCES "order_packages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
