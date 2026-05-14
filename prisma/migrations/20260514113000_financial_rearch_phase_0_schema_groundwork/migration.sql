BEGIN;

CREATE TYPE "PaymentDirection" AS ENUM ('IN', 'OUT');

ALTER TABLE "payments"
ADD COLUMN "direction" "PaymentDirection" NOT NULL DEFAULT 'IN';

ALTER TYPE "InvoiceType" ADD VALUE IF NOT EXISTS 'SALE';

LOCK TABLE "financial_cases", "invoices", "payments" IN SHARE ROW EXCLUSIVE MODE;

UPDATE "payments"
SET "direction" = 'IN'
WHERE "direction" IS NULL;

DO $$
DECLARE
  orphan_invoice RECORD;
  resolved_booking_id TEXT;
  resolved_financial_case_id TEXT;
  customer_booking_count INTEGER;
BEGIN
  FOR orphan_invoice IN
    SELECT
      "id",
      "customerId",
      "bookingId",
      "orderId",
      "jobId"
    FROM "invoices"
    WHERE "financialCaseId" IS NULL
    ORDER BY "createdAt", "id"
  LOOP
    resolved_booking_id := orphan_invoice."bookingId";

    IF resolved_booking_id IS NULL AND orphan_invoice."orderId" IS NOT NULL THEN
      SELECT "bookingId"
      INTO resolved_booking_id
      FROM "orders"
      WHERE "id" = orphan_invoice."orderId";
    END IF;

    IF resolved_booking_id IS NULL AND orphan_invoice."jobId" IS NOT NULL THEN
      SELECT "id"
      INTO resolved_booking_id
      FROM "bookings"
      WHERE "jobId" = orphan_invoice."jobId"
      LIMIT 1;
    END IF;

    IF resolved_booking_id IS NULL THEN
      SELECT COUNT(*), MIN("id")
      INTO customer_booking_count, resolved_booking_id
      FROM "bookings"
      WHERE "customerId" = orphan_invoice."customerId";

      IF customer_booking_count <> 1 THEN
        RAISE EXCEPTION
          'Invoice % needs a unique booking context to backfill financialCaseId; found % candidate bookings for customer %',
          orphan_invoice."id",
          customer_booking_count,
          orphan_invoice."customerId";
      END IF;
    END IF;

    IF resolved_booking_id IS NULL THEN
      RAISE EXCEPTION
        'Invoice % could not resolve a booking context for financialCaseId backfill',
        orphan_invoice."id";
    END IF;

    SELECT "id"
    INTO resolved_financial_case_id
    FROM "financial_cases"
    WHERE "bookingId" = resolved_booking_id;

    IF resolved_financial_case_id IS NULL THEN
      INSERT INTO "financial_cases" (
        "id",
        "bookingId",
        "customerId",
        "jobId",
        "createdAt",
        "updatedAt"
      )
      SELECT
        'migfc_' || SUBSTRING(md5(orphan_invoice."id" || ':' || b."id" || ':' || clock_timestamp()::TEXT), 1, 19),
        b."id",
        b."customerId",
        b."jobId",
        NOW(),
        NOW()
      FROM "bookings" AS b
      WHERE b."id" = resolved_booking_id
      RETURNING "id" INTO resolved_financial_case_id;
    END IF;

    UPDATE "invoices"
    SET "financialCaseId" = resolved_financial_case_id
    WHERE "id" = orphan_invoice."id";
  END LOOP;
END $$;

UPDATE "invoices" AS i
SET "invoiceType" = CASE
  WHEN i."parentInvoiceId" IS NULL
    AND i."bookingId" IS NOT NULL
    AND i."orderId" IS NULL THEN 'DEPOSIT'::"InvoiceType"
  WHEN i."parentInvoiceId" IS NULL
    AND EXISTS (
      SELECT 1
      FROM "invoices" AS sibling
      WHERE sibling."financialCaseId" = i."financialCaseId"
        AND sibling."id" <> i."id"
        AND sibling."invoiceType" = 'FINAL'::"InvoiceType"
    ) THEN 'DEPOSIT'::"InvoiceType"
  ELSE 'FINAL'::"InvoiceType"
END
WHERE i."invoiceType" IS NULL;

UPDATE "payments" AS p
SET "financialCaseId" = i."financialCaseId"
FROM "invoices" AS i
WHERE p."invoiceId" = i."id"
  AND p."financialCaseId" IS NULL;

DO $$
DECLARE
  invoice_financial_case_missing BIGINT;
  invoice_type_missing BIGINT;
  payment_financial_case_missing BIGINT;
  payment_direction_missing BIGINT;
BEGIN
  SELECT COUNT(*) INTO invoice_financial_case_missing
  FROM "invoices"
  WHERE "financialCaseId" IS NULL;

  SELECT COUNT(*) INTO invoice_type_missing
  FROM "invoices"
  WHERE "invoiceType" IS NULL;

  SELECT COUNT(*) INTO payment_financial_case_missing
  FROM "payments"
  WHERE "financialCaseId" IS NULL;

  SELECT COUNT(*) INTO payment_direction_missing
  FROM "payments"
  WHERE "direction" IS NULL;

  IF invoice_financial_case_missing <> 0 THEN
    RAISE EXCEPTION 'Invoice financialCaseId backfill incomplete: % rows remain null', invoice_financial_case_missing;
  END IF;

  IF invoice_type_missing <> 0 THEN
    RAISE EXCEPTION 'Invoice invoiceType backfill incomplete: % rows remain null', invoice_type_missing;
  END IF;

  IF payment_financial_case_missing <> 0 THEN
    RAISE EXCEPTION 'Payment financialCaseId backfill incomplete: % rows remain null', payment_financial_case_missing;
  END IF;

  IF payment_direction_missing <> 0 THEN
    RAISE EXCEPTION 'Payment direction backfill incomplete: % rows remain null', payment_direction_missing;
  END IF;
END $$;

ALTER TABLE "invoices"
ALTER COLUMN "financialCaseId" SET NOT NULL,
ALTER COLUMN "invoiceType" SET NOT NULL;

ALTER TABLE "payments"
ALTER COLUMN "financialCaseId" SET NOT NULL;

COMMIT;
