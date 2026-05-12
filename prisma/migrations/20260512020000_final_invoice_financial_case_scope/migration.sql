DROP INDEX IF EXISTS "invoices_primary_booking_context_key";
DROP INDEX IF EXISTS "invoices_primary_order_context_key";

CREATE UNIQUE INDEX "invoices_primary_booking_deposit_context_key"
  ON "invoices"("bookingId")
  WHERE "parentInvoiceId" IS NULL
    AND "bookingId" IS NOT NULL
    AND "invoiceType" = 'DEPOSIT';

CREATE UNIQUE INDEX "invoices_primary_order_final_context_key"
  ON "invoices"("orderId")
  WHERE "parentInvoiceId" IS NULL
    AND "orderId" IS NOT NULL
    AND "invoiceType" = 'FINAL';

CREATE UNIQUE INDEX "invoices_primary_financial_case_invoice_type_key"
  ON "invoices"("financialCaseId", "invoiceType")
  WHERE "parentInvoiceId" IS NULL
    AND "financialCaseId" IS NOT NULL
    AND "invoiceType" IN ('DEPOSIT', 'FINAL');
