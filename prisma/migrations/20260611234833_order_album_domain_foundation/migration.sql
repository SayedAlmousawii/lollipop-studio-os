-- CreateEnum
CREATE TYPE "OrderAlbumSourceType" AS ENUM ('PACKAGE', 'ADDON');

-- CreateEnum
CREATE TYPE "OrderAlbumBackingLineKind" AS ENUM ('PACKAGE_ITEM', 'ORDER_PACKAGE_ITEM_UPGRADE', 'ORDER_ADD_ON');

-- CreateTable
CREATE TABLE "order_albums" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderPackageId" TEXT,
    "sourceType" "OrderAlbumSourceType" NOT NULL,
    "backingLineKind" "OrderAlbumBackingLineKind" NOT NULL,
    "backingLineId" TEXT NOT NULL,
    "coverMaterial" TEXT,
    "threadColor" TEXT,
    "layout" TEXT,
    "coverText" TEXT,
    "coverImageRef" TEXT,
    "instructions" TEXT,
    "extraPages" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_albums_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_albums_orderId_idx" ON "order_albums"("orderId");

-- CreateIndex
CREATE INDEX "order_albums_orderPackageId_idx" ON "order_albums"("orderPackageId");

-- CreateIndex
CREATE UNIQUE INDEX "order_albums_orderId_orderPackageId_backingLineKind_backing_key" ON "order_albums"("orderId", "orderPackageId", "backingLineKind", "backingLineId");

-- AddForeignKey
ALTER TABLE "order_albums" ADD CONSTRAINT "order_albums_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_albums" ADD CONSTRAINT "order_albums_orderPackageId_fkey" FOREIGN KEY ("orderPackageId") REFERENCES "order_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
