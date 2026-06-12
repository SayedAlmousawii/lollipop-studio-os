-- CreateEnum
CREATE TYPE "NoteKind" AS ENUM ('CUSTOMER', 'PHOTOGRAPHER', 'EDITING', 'PRODUCTION', 'DELIVERY', 'INTERNAL');

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderPackageId" TEXT,
    "kind" "NoteKind" NOT NULL,
    "body" TEXT NOT NULL,
    "authorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notes_orderId_kind_idx" ON "notes"("orderId", "kind");

-- CreateIndex
CREATE INDEX "notes_orderPackageId_idx" ON "notes"("orderPackageId");

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_orderPackageId_fkey" FOREIGN KEY ("orderPackageId") REFERENCES "order_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
