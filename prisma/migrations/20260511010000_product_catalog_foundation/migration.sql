-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('ALBUM', 'CANVAS', 'DIGITAL', 'PRINT', 'FRAME', 'USB', 'OTHER');

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "canonicalPrice" DECIMAL(10,3) NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "products_canonicalPrice_check" CHECK ("canonicalPrice" >= 0)
);

-- CreateTable
CREATE TABLE "package_items" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceSnapshot" DECIMAL(10,3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "package_items_packageId_productId_key" UNIQUE ("packageId", "productId"),
    CONSTRAINT "package_items_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "package_items_priceSnapshot_check" CHECK ("priceSnapshot" >= 0),
    CONSTRAINT "package_items_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "package_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "products_category_isActive_idx" ON "products"("category", "isActive");

-- CreateIndex
CREATE INDEX "package_items_packageId_idx" ON "package_items"("packageId");

-- CreateIndex
CREATE INDEX "package_items_productId_idx" ON "package_items"("productId");
