-- Spec 94: LINKED_PRODUCT session configurations now materialize as real OrderAddOn rows.
-- Data migration scope: pre-lock orders only. A pre-lock order is one whose primary
-- FINAL invoice is absent or unlocked. Locked FINAL invoices keep their immutable
-- historical SESSION_CONFIGURATION line items and selection snapshots.

ALTER TABLE "order_package_session_configuration_selections"
ADD COLUMN "orderAddOnId" TEXT;

DROP INDEX IF EXISTS "order_add_ons_orderId_orderPackageId_productId_key";

WITH qualifying_selections AS (
  SELECT
    selection."id" AS "selectionId",
    gen_random_uuid()::text AS "orderAddOnId",
    order_package."orderId",
    selection."orderPackageId",
    selection."snapshotLinkedProductId" AS "productId",
    COALESCE(product."name", 'Session product') AS "nameSnapshot",
    selection."snapshotPriceDelta" AS "priceSnapshot"
  FROM "order_package_session_configuration_selections" selection
  INNER JOIN "order_packages" order_package
    ON order_package."id" = selection."orderPackageId"
  LEFT JOIN "products" product
    ON product."id" = selection."snapshotLinkedProductId"
  WHERE selection."snapshotPricingMode" = 'LINKED_PRODUCT'
    AND selection."snapshotLinkedProductId" IS NOT NULL
    AND selection."orderAddOnId" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "invoices" invoice
      WHERE invoice."orderId" = order_package."orderId"
        AND invoice."parentInvoiceId" IS NULL
        AND invoice."invoiceType" = 'FINAL'
        AND invoice."isLocked" = true
    )
),
inserted_add_ons AS (
  INSERT INTO "order_add_ons" (
    "id",
    "orderId",
    "orderPackageId",
    "productId",
    "nameSnapshot",
    "priceSnapshot",
    "quantity",
    "createdAt",
    "updatedAt"
  )
  SELECT
    "orderAddOnId",
    "orderId",
    "orderPackageId",
    "productId",
    "nameSnapshot",
    "priceSnapshot",
    1,
    NOW(),
    NOW()
  FROM qualifying_selections
  RETURNING "id"
)
UPDATE "order_package_session_configuration_selections" selection
SET
  "orderAddOnId" = qualifying."orderAddOnId",
  "snapshotPriceDelta" = 0,
  "updatedAt" = NOW()
FROM qualifying_selections qualifying
WHERE selection."id" = qualifying."selectionId";

ALTER TABLE "session_configurations"
DROP COLUMN "linkProductDisplay";

ALTER TABLE "order_package_session_configuration_selections"
DROP COLUMN "snapshotLinkProductDisplay";

DROP TYPE "SessionConfigurationLinkProductDisplay";

CREATE INDEX "order_package_session_configuration_selections_orderAddOnId_idx"
ON "order_package_session_configuration_selections"("orderAddOnId");

ALTER TABLE "order_package_session_configuration_selections"
ADD CONSTRAINT "order_package_session_configuration_selections_orderAddOnId_fkey"
FOREIGN KEY ("orderAddOnId") REFERENCES "order_add_ons"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
