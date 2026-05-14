BEGIN;

CREATE UNIQUE INDEX "invoices_id_financialCaseId_key"
  ON "invoices"("id", "financialCaseId");

CREATE INDEX "payments_invoiceId_financialCaseId_idx"
  ON "payments"("invoiceId", "financialCaseId");

ALTER TABLE "payments"
DROP CONSTRAINT "payments_invoiceId_fkey";

ALTER TABLE "payments"
ADD CONSTRAINT "payments_invoiceId_financialCaseId_fkey"
FOREIGN KEY ("invoiceId", "financialCaseId")
REFERENCES "invoices"("id", "financialCaseId")
ON DELETE RESTRICT
ON UPDATE CASCADE;

COMMIT;
