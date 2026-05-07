ALTER TABLE "orders" ADD COLUMN "jobId" TEXT;
ALTER TABLE "invoices" ADD COLUMN "jobId" TEXT;
ALTER TABLE "payments" ADD COLUMN "jobId" TEXT;

UPDATE "orders" o
SET "jobId" = b."jobId"
FROM "bookings" b
WHERE b."id" = o."bookingId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "orders"
    WHERE "jobId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot backfill orders.jobId because one or more orders did not map to a canonical job';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "invoices" i
    LEFT JOIN "orders" o ON o."id" = i."orderId"
    LEFT JOIN "bookings" b ON b."id" = i."bookingId"
    LEFT JOIN "jobs" j ON j."jobNumber" = i."jobNumber"
    WHERE (
      o."jobId" IS NOT NULL
      AND b."jobId" IS NOT NULL
      AND o."jobId" <> b."jobId"
    )
    OR (
      (o."jobId" IS NOT NULL OR b."jobId" IS NOT NULL)
      AND j."id" IS NOT NULL
      AND j."id" <> COALESCE(o."jobId", b."jobId")
    )
    OR COALESCE(o."jobId", b."jobId", j."id") IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot backfill invoices.jobId because one or more invoices did not map to a single canonical job';
  END IF;
END;
$$;

WITH invoice_job_candidates AS (
  SELECT
    i."id",
    COALESCE(o."jobId", b."jobId", j."id") AS "jobId"
  FROM "invoices" i
  LEFT JOIN "orders" o ON o."id" = i."orderId"
  LEFT JOIN "bookings" b ON b."id" = i."bookingId"
  LEFT JOIN "jobs" j ON j."jobNumber" = i."jobNumber"
)
UPDATE "invoices" i
SET "jobId" = invoice_job_candidates."jobId"
FROM invoice_job_candidates
WHERE invoice_job_candidates."id" = i."id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "invoices"
    WHERE "jobId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot backfill invoices.jobId because one or more invoices did not map to a canonical job';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "payments" p
    LEFT JOIN "invoices" i ON i."id" = p."invoiceId"
    LEFT JOIN "jobs" j ON j."jobNumber" = p."jobNumber"
    WHERE COALESCE(i."jobId", j."id") IS NULL
      OR (i."jobId" IS NOT NULL AND j."id" IS NOT NULL AND i."jobId" <> j."id")
  ) THEN
    RAISE EXCEPTION 'Cannot backfill payments.jobId because one or more payments did not map to a single canonical job';
  END IF;
END;
$$;

WITH payment_job_candidates AS (
  SELECT
    p."id",
    COALESCE(i."jobId", j."id") AS "jobId"
  FROM "payments" p
  LEFT JOIN "invoices" i ON i."id" = p."invoiceId"
  LEFT JOIN "jobs" j ON j."jobNumber" = p."jobNumber"
)
UPDATE "payments" p
SET "jobId" = payment_job_candidates."jobId"
FROM payment_job_candidates
WHERE payment_job_candidates."id" = p."id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "payments"
    WHERE "jobId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot backfill payments.jobId because one or more payments did not map to a canonical job';
  END IF;
END;
$$;

ALTER TABLE "orders"
  ALTER COLUMN "jobId" SET NOT NULL;

ALTER TABLE "invoices"
  ALTER COLUMN "jobId" SET NOT NULL;

ALTER TABLE "payments"
  ALTER COLUMN "jobId" SET NOT NULL;

CREATE UNIQUE INDEX "orders_jobId_key" ON "orders"("jobId");
CREATE INDEX "invoices_jobId_idx" ON "invoices"("jobId");
CREATE INDEX "payments_jobId_idx" ON "payments"("jobId");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "jobs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "jobs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "jobs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
