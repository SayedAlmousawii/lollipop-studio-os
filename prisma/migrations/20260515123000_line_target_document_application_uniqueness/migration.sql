DROP INDEX IF EXISTS "document_applications_source_invoice_id_target_invoice_id_key";

CREATE UNIQUE INDEX "document_applications_source_target_no_line_key"
ON "document_applications"("source_invoice_id", "target_invoice_id")
WHERE "target_invoice_line_id" IS NULL;

CREATE UNIQUE INDEX "document_applications_source_target_line_key"
ON "document_applications"("source_invoice_id", "target_invoice_id", "target_invoice_line_id")
WHERE "target_invoice_line_id" IS NOT NULL;
