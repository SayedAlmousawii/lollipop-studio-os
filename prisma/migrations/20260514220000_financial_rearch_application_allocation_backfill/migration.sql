BEGIN;

LOCK TABLE "invoices", "payments", "document_applications", "payment_allocations" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  duplicate_deposit_count BIGINT;
  duplicate_final_count BIGINT;
  final_without_deposit_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO duplicate_deposit_count
  FROM (
    SELECT "financialCaseId"
    FROM "invoices"
    WHERE "invoiceType" = 'DEPOSIT'::"InvoiceType"
    GROUP BY "financialCaseId"
    HAVING COUNT(*) > 1
  ) AS duplicate_deposits;

  SELECT COUNT(*) INTO duplicate_final_count
  FROM (
    SELECT "financialCaseId"
    FROM "invoices"
    WHERE "invoiceType" = 'FINAL'::"InvoiceType"
    GROUP BY "financialCaseId"
    HAVING COUNT(*) > 1
  ) AS duplicate_finals;

  SELECT COUNT(*) INTO final_without_deposit_count
  FROM "invoices" AS final
  WHERE final."invoiceType" = 'FINAL'::"InvoiceType"
    AND NOT EXISTS (
      SELECT 1
      FROM "invoices" AS deposit
      WHERE deposit."financialCaseId" = final."financialCaseId"
        AND deposit."invoiceType" = 'DEPOSIT'::"InvoiceType"
    );

  IF duplicate_deposit_count <> 0 THEN
    RAISE EXCEPTION 'DocumentApplication backfill aborted: found % FinancialCase rows with multiple DEPOSIT invoices', duplicate_deposit_count;
  END IF;

  IF duplicate_final_count <> 0 THEN
    RAISE EXCEPTION 'DocumentApplication backfill aborted: found % FinancialCase rows with multiple FINAL invoices', duplicate_final_count;
  END IF;

  IF final_without_deposit_count <> 0 THEN
    RAISE EXCEPTION 'DocumentApplication backfill aborted: found % FinancialCase rows with FINAL invoices but no DEPOSIT invoice', final_without_deposit_count;
  END IF;
END $$;

INSERT INTO "document_applications" (
  "id",
  "source_invoice_id",
  "target_invoice_id",
  "amount_applied",
  "applied_at",
  "notes",
  "created_at"
)
SELECT
  gen_random_uuid()::text,
  deposit."id",
  final."id",
  deposit."paidAmount",
  COALESCE(deposit."closedAt", deposit."updatedAt"),
  'Phase 1 backfill: virtual deposit credit',
  NOW()
FROM "invoices" AS deposit
JOIN "invoices" AS final
  ON final."financialCaseId" = deposit."financialCaseId"
  AND final."invoiceType" = 'FINAL'::"InvoiceType"
WHERE deposit."invoiceType" = 'DEPOSIT'::"InvoiceType"
  AND deposit."paidAmount" > 0;

INSERT INTO "payment_allocations" (
  "id",
  "payment_id",
  "invoice_id",
  "amount",
  "created_at"
)
SELECT
  gen_random_uuid()::text,
  payment."id",
  payment."invoiceId",
  payment."amount",
  payment."paidAt"
FROM "payments" AS payment;

DO $$
DECLARE
  payment_count BIGINT;
  allocation_count BIGINT;
  payments_without_allocation_count BIGINT;
  duplicate_payment_allocation_count BIGINT;
  document_application_mismatch_count BIGINT;
  allocation_amount_mismatch_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO payment_count
  FROM "payments";

  SELECT COUNT(*) INTO allocation_count
  FROM "payment_allocations";

  SELECT COUNT(*) INTO payments_without_allocation_count
  FROM "payments" AS payment
  LEFT JOIN "payment_allocations" AS allocation
    ON allocation."payment_id" = payment."id"
  WHERE allocation."id" IS NULL;

  SELECT COUNT(*) INTO duplicate_payment_allocation_count
  FROM (
    SELECT "payment_id"
    FROM "payment_allocations"
    GROUP BY "payment_id"
    HAVING COUNT(*) <> 1
  ) AS invalid_payment_allocations;

  SELECT COUNT(*) INTO document_application_mismatch_count
  FROM (
    SELECT
      deposit."id" AS deposit_invoice_id,
      final."id" AS final_invoice_id,
      COUNT(application."id") AS application_count
    FROM "invoices" AS deposit
    JOIN "invoices" AS final
      ON final."financialCaseId" = deposit."financialCaseId"
      AND final."invoiceType" = 'FINAL'::"InvoiceType"
    LEFT JOIN "document_applications" AS application
      ON application."source_invoice_id" = deposit."id"
      AND application."target_invoice_id" = final."id"
    WHERE deposit."invoiceType" = 'DEPOSIT'::"InvoiceType"
      AND deposit."paidAmount" > 0
    GROUP BY deposit."id", final."id"
    HAVING COUNT(application."id") <> 1
  ) AS invalid_document_applications;

  SELECT COUNT(*) INTO allocation_amount_mismatch_count
  FROM "payment_allocations" AS allocation
  JOIN "payments" AS payment
    ON payment."id" = allocation."payment_id"
  WHERE allocation."amount" <> payment."amount";

  IF allocation_count <> payment_count THEN
    RAISE EXCEPTION 'PaymentAllocation backfill incomplete: expected % rows, found % rows', payment_count, allocation_count;
  END IF;

  IF payments_without_allocation_count <> 0 THEN
    RAISE EXCEPTION 'PaymentAllocation backfill incomplete: % payments have no allocation', payments_without_allocation_count;
  END IF;

  IF duplicate_payment_allocation_count <> 0 THEN
    RAISE EXCEPTION 'PaymentAllocation backfill invalid: % payments do not have exactly one allocation', duplicate_payment_allocation_count;
  END IF;

  IF document_application_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'DocumentApplication backfill incomplete: % paid DEPOSIT to FINAL pairs do not have exactly one application', document_application_mismatch_count;
  END IF;

  IF allocation_amount_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'PaymentAllocation backfill invalid: % allocations do not match payment amount', allocation_amount_mismatch_count;
  END IF;
END $$;

COMMIT;
