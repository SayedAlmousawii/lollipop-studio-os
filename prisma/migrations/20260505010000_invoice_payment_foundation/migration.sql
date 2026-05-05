-- Invoice/payment foundation for locked invoices and adjustment invoices.

ALTER TYPE "InvoiceStatus" RENAME TO "InvoiceStatus_old";
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIAL', 'PAID', 'CLOSED');

ALTER TABLE "invoices" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "invoices"
  ALTER COLUMN "status" TYPE "InvoiceStatus"
  USING (
    CASE "status"::text
      WHEN 'UNPAID' THEN 'ISSUED'
      WHEN 'PARTIAL' THEN 'PARTIAL'
      WHEN 'PAID' THEN 'PAID'
      WHEN 'REFUNDED' THEN 'CLOSED'
      ELSE 'DRAFT'
    END
  )::"InvoiceStatus";
ALTER TABLE "invoices" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "InvoiceStatus_old";

DROP INDEX IF EXISTS "invoices_orderId_key";

ALTER TABLE "invoices"
  ADD COLUMN "invoiceNumber" TEXT,
  ADD COLUMN "remainingAmount" DECIMAL(10,3) NOT NULL DEFAULT 0,
  ADD COLUMN "isLocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "parentInvoiceId" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "issuedAt" TIMESTAMP(3),
  ADD COLUMN "closedAt" TIMESTAMP(3);

UPDATE "invoices"
SET
  "invoiceNumber" = 'INV-' || upper(substr("id", 1, 8)),
  "remainingAmount" = GREATEST("totalAmount" - "paidAmount", 0),
  "issuedAt" = CASE WHEN "status" <> 'DRAFT' THEN "createdAt" ELSE NULL END,
  "isLocked" = CASE WHEN "status" = 'CLOSED' THEN true ELSE false END,
  "closedAt" = CASE WHEN "status" = 'CLOSED' THEN "updatedAt" ELSE NULL END;

ALTER TABLE "invoices" ALTER COLUMN "invoiceNumber" SET NOT NULL;
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_parentInvoiceId_fkey"
  FOREIGN KEY ("parentInvoiceId") REFERENCES "invoices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_orderId_fkey";
ALTER TABLE "payments" RENAME COLUMN "type" TO "paymentType";
ALTER TABLE "payments" RENAME COLUMN "createdAt" TO "paidAt";
ALTER TABLE "payments"
  ADD COLUMN "reference" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "payments" DROP COLUMN IF EXISTS "updatedAt";
ALTER TABLE "payments" DROP COLUMN IF EXISTS "orderId";
