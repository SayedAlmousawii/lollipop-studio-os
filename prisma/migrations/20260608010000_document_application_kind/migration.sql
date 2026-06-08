CREATE TYPE "DocumentApplicationKind" AS ENUM (
  'DEPOSIT',
  'CAUSE_REVERSAL',
  'CREDIT_TO_FINAL',
  'SETTLEMENT'
);

ALTER TABLE "document_applications"
  ADD COLUMN "kind" "DocumentApplicationKind";

UPDATE "document_applications" AS application
SET "kind" = 'DEPOSIT'
FROM "invoices" AS source
WHERE application.source_invoice_id = source.id
  AND source."invoiceType" = 'DEPOSIT'
  AND application."kind" IS NULL;

UPDATE "document_applications" AS application
SET "kind" = 'CAUSE_REVERSAL'
FROM "invoices" AS source,
     "invoices" AS target
WHERE application.source_invoice_id = source.id
  AND application.target_invoice_id = target.id
  AND source."invoiceType" = 'CREDIT_NOTE'
  AND target."invoiceType" = 'ADJUSTMENT'
  AND application.target_invoice_line_id IS NOT NULL
  AND application."kind" IS NULL;

UPDATE "document_applications" AS application
SET "kind" = 'CREDIT_TO_FINAL'
FROM "invoices" AS source,
     "invoices" AS target
WHERE application.source_invoice_id = source.id
  AND application.target_invoice_id = target.id
  AND source."invoiceType" = 'CREDIT_NOTE'
  AND target."invoiceType" = 'FINAL'
  AND application.target_invoice_id = source."parentInvoiceId"
  AND application.target_invoice_line_id IS NULL
  AND application."kind" IS NULL;

DO $$
DECLARE
  unclassified_application_ids TEXT;
BEGIN
  SELECT STRING_AGG(id, ', ' ORDER BY id)
  INTO unclassified_application_ids
  FROM "document_applications"
  WHERE "kind" IS NULL;

  IF unclassified_application_ids IS NOT NULL THEN
    RAISE EXCEPTION 'DocumentApplication kind backfill failed; unclassifiable application ids: %', unclassified_application_ids;
  END IF;
END;
$$;

ALTER TABLE "document_applications"
  ALTER COLUMN "kind" SET NOT NULL;
