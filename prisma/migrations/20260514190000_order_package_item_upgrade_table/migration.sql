-- Step 1: introduce the dedicated table for package-item upgrades.
CREATE TABLE "order_package_item_upgrades" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderPackageId" TEXT NOT NULL,
  "packageItemId" TEXT NOT NULL,
  "nameSnapshot" TEXT NOT NULL,
  "priceSnapshot" DECIMAL(10,3) NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "order_package_item_upgrades_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_package_item_upgrades_orderId_orderPackageId_packageItemId_key"
ON "order_package_item_upgrades"("orderId", "orderPackageId", "packageItemId");

CREATE INDEX "order_package_item_upgrades_orderId_idx"
ON "order_package_item_upgrades"("orderId");

CREATE INDEX "order_package_item_upgrades_orderPackageId_idx"
ON "order_package_item_upgrades"("orderPackageId");

CREATE INDEX "order_package_item_upgrades_packageItemId_idx"
ON "order_package_item_upgrades"("packageItemId");

ALTER TABLE "order_package_item_upgrades"
ADD CONSTRAINT "order_package_item_upgrades_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "orders"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_package_item_upgrades"
ADD CONSTRAINT "order_package_item_upgrades_orderPackageId_fkey"
FOREIGN KEY ("orderPackageId") REFERENCES "order_packages"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_package_item_upgrades"
ADD CONSTRAINT "order_package_item_upgrades_packageItemId_fkey"
FOREIGN KEY ("packageItemId") REFERENCES "package_items"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
