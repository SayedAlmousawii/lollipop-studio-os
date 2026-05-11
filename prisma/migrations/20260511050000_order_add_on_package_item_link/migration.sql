-- Link POS package-item upgrade deltas to the package item they replace so
-- repeated edits update the same order add-on instead of compounding totals.
ALTER TABLE "order_add_ons"
ADD COLUMN "packageItemId" TEXT;

UPDATE "order_add_ons" AS addon
SET "packageItemId" = item.id
FROM "package_items" AS item
WHERE addon.notes LIKE 'POS_PACKAGE_ITEM_UPGRADE:%'
  AND item.id = regexp_replace(
    addon.notes,
    '^POS_PACKAGE_ITEM_UPGRADE:([^ ]+).*$',
    '\1'
  );

CREATE INDEX "order_add_ons_packageItemId_idx" ON "order_add_ons"("packageItemId");

CREATE UNIQUE INDEX "order_add_ons_orderId_packageItemId_key"
ON "order_add_ons"("orderId", "packageItemId");

ALTER TABLE "order_add_ons"
ADD CONSTRAINT "order_add_ons_packageItemId_fkey"
FOREIGN KEY ("packageItemId") REFERENCES "package_items"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
