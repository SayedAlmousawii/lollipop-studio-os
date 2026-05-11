-- CreateEnum
CREATE TYPE "InvoiceLineType" AS ENUM (
  'PACKAGE_BASE',
  'BUNDLE_ADJUSTMENT',
  'PACKAGE_UPGRADE',
  'ADD_ON',
  'EXTRA_PHOTOS',
  'MANUAL_DISCOUNT',
  'MANUAL_SURCHARGE'
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "lineType" "InvoiceLineType" NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(10,3) NOT NULL,
  "lineTotal" DECIMAL(10,3) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_line_items_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "invoice_line_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "invoice_line_items_invoiceId_idx" ON "invoice_line_items"("invoiceId");
