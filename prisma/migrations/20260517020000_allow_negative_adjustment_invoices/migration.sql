ALTER TABLE "invoices"
DROP CONSTRAINT IF EXISTS "invoices_total_amount_nonnegative_check";

ALTER TABLE "invoices"
ADD CONSTRAINT "invoices_total_amount_nonnegative_check"
CHECK ("totalAmount" >= 0 OR "invoiceType" = 'ADJUSTMENT');
