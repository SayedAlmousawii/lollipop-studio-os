CREATE TYPE "CreditOrigin" AS ENUM (
  'REVERSAL',
  'REMOVAL',
  'GOODWILL'
);

ALTER TABLE "invoices"
  ADD COLUMN "creditOrigin" "CreditOrigin",
  ADD COLUMN "reversesInvoiceLineId" TEXT;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_reversesInvoiceLineId_fkey"
  FOREIGN KEY ("reversesInvoiceLineId")
  REFERENCES "invoice_line_items"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "invoices_reversesInvoiceLineId_idx"
  ON "invoices"("reversesInvoiceLineId");
