CREATE SEQUENCE IF NOT EXISTS "booking_public_id_seq";
CREATE SEQUENCE IF NOT EXISTS "order_public_id_seq";
CREATE SEQUENCE IF NOT EXISTS "invoice_public_id_seq";
CREATE SEQUENCE IF NOT EXISTS "payment_public_id_seq";

CREATE TABLE "identifier_sequences" (
  "scope" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "lastValue" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "identifier_sequences_pkey" PRIMARY KEY ("scope", "year")
);

ALTER TABLE "bookings"
  ADD COLUMN "publicId" TEXT,
  ADD COLUMN "jobNumber" TEXT;

ALTER TABLE "orders"
  ADD COLUMN "publicId" TEXT,
  ADD COLUMN "jobNumber" TEXT;

ALTER TABLE "invoices"
  ADD COLUMN "publicId" TEXT,
  ADD COLUMN "jobNumber" TEXT;

ALTER TABLE "payments"
  ADD COLUMN "publicId" TEXT,
  ADD COLUMN "jobNumber" TEXT;

WITH booking_numbered AS (
  SELECT
    "id",
    row_number() OVER (ORDER BY "createdAt", "id") AS public_seq,
    CASE lower(trim("department"))
      WHEN 'newborn' THEN 'NB'
      WHEN 'kids' THEN 'KD'
      WHEN 'family' THEN 'FM'
      WHEN 'maternity' THEN 'MT'
      WHEN 'photography' THEN 'PH'
      WHEN 'general' THEN 'GN'
      WHEN 'other' THEN 'OT'
      ELSE 'GN'
    END AS job_scope,
    EXTRACT(YEAR FROM "sessionDate")::INTEGER AS job_year
  FROM "bookings"
),
booking_job_numbered AS (
  SELECT
    "id",
    public_seq,
    job_scope,
    job_year,
    row_number() OVER (PARTITION BY job_scope, job_year ORDER BY public_seq) AS job_seq
  FROM booking_numbered
)
UPDATE "bookings"
SET
  "publicId" = 'BKG-' || lpad(booking_job_numbered.public_seq::TEXT, 5, '0'),
  "jobNumber" = booking_job_numbered.job_scope || '-' || booking_job_numbered.job_year::TEXT || '-' || lpad(booking_job_numbered.job_seq::TEXT, 5, '0')
FROM booking_job_numbered
WHERE "bookings"."id" = booking_job_numbered."id";

INSERT INTO "identifier_sequences" ("scope", "year", "lastValue", "createdAt", "updatedAt")
SELECT
  split_part("jobNumber", '-', 1),
  split_part("jobNumber", '-', 2)::INTEGER,
  MAX(split_part("jobNumber", '-', 3)::INTEGER),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "bookings"
GROUP BY split_part("jobNumber", '-', 1), split_part("jobNumber", '-', 2)::INTEGER
ON CONFLICT ("scope", "year") DO UPDATE SET
  "lastValue" = EXCLUDED."lastValue",
  "updatedAt" = CURRENT_TIMESTAMP;

WITH order_numbered AS (
  SELECT
    "orders"."id",
    row_number() OVER (ORDER BY "orders"."createdAt", "orders"."id") AS seq,
    "bookings"."jobNumber"
  FROM "orders"
  JOIN "bookings" ON "bookings"."id" = "orders"."bookingId"
)
UPDATE "orders"
SET
  "publicId" = 'ORD-' || lpad(order_numbered.seq::TEXT, 5, '0'),
  "jobNumber" = order_numbered."jobNumber"
FROM order_numbered
WHERE "orders"."id" = order_numbered."id";

WITH invoice_numbered AS (
  SELECT
    "invoices"."id",
    row_number() OVER (ORDER BY "invoices"."createdAt", "invoices"."id") AS seq,
    COALESCE("orders"."jobNumber", "bookings"."jobNumber") AS "jobNumber"
  FROM "invoices"
  LEFT JOIN "orders" ON "orders"."id" = "invoices"."orderId"
  LEFT JOIN "bookings" ON "bookings"."id" = "invoices"."bookingId"
)
UPDATE "invoices"
SET
  "publicId" = 'INV-PUB-' || lpad(invoice_numbered.seq::TEXT, 5, '0'),
  "jobNumber" = COALESCE(invoice_numbered."jobNumber", 'GN-1970-' || lpad(invoice_numbered.seq::TEXT, 5, '0'))
FROM invoice_numbered
WHERE "invoices"."id" = invoice_numbered."id";

WITH payment_numbered AS (
  SELECT
    "payments"."id",
    row_number() OVER (ORDER BY "payments"."createdAt", "payments"."id") AS seq,
    "invoices"."jobNumber"
  FROM "payments"
  JOIN "invoices" ON "invoices"."id" = "payments"."invoiceId"
)
UPDATE "payments"
SET
  "publicId" = 'PAY-' || lpad(payment_numbered.seq::TEXT, 5, '0'),
  "jobNumber" = payment_numbered."jobNumber"
FROM payment_numbered
WHERE "payments"."id" = payment_numbered."id";

SELECT setval(
  '"booking_public_id_seq"',
  GREATEST((SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) FROM "bookings"), 1),
  (SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) > 0 FROM "bookings")
);
SELECT setval(
  '"order_public_id_seq"',
  GREATEST((SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) FROM "orders"), 1),
  (SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) > 0 FROM "orders")
);
SELECT setval(
  '"invoice_public_id_seq"',
  GREATEST((SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) FROM "invoices"), 1),
  (SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) > 0 FROM "invoices")
);
SELECT setval(
  '"payment_public_id_seq"',
  GREATEST((SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) FROM "payments"), 1),
  (SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) > 0 FROM "payments")
);

ALTER TABLE "bookings"
  ALTER COLUMN "publicId" SET NOT NULL,
  ALTER COLUMN "jobNumber" SET NOT NULL;

ALTER TABLE "orders"
  ALTER COLUMN "publicId" SET NOT NULL,
  ALTER COLUMN "jobNumber" SET NOT NULL;

ALTER TABLE "invoices"
  ALTER COLUMN "publicId" SET NOT NULL,
  ALTER COLUMN "jobNumber" SET NOT NULL;

ALTER TABLE "payments"
  ALTER COLUMN "publicId" SET NOT NULL,
  ALTER COLUMN "jobNumber" SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "bookings"
    GROUP BY "jobNumber"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create unique bookings.jobNumber index while duplicate booking job numbers exist';
  END IF;
END;
$$;

CREATE UNIQUE INDEX "bookings_publicId_key" ON "bookings"("publicId");
CREATE UNIQUE INDEX "bookings_jobNumber_key" ON "bookings"("jobNumber");
CREATE UNIQUE INDEX "orders_publicId_key" ON "orders"("publicId");
CREATE INDEX "orders_jobNumber_idx" ON "orders"("jobNumber");
CREATE UNIQUE INDEX "invoices_publicId_key" ON "invoices"("publicId");
CREATE INDEX "invoices_jobNumber_idx" ON "invoices"("jobNumber");
CREATE UNIQUE INDEX "payments_publicId_key" ON "payments"("publicId");
CREATE INDEX "payments_jobNumber_idx" ON "payments"("jobNumber");

CREATE OR REPLACE FUNCTION prevent_job_number_update()
RETURNS trigger AS $$
BEGIN
  IF NEW."jobNumber" <> OLD."jobNumber" THEN
    RAISE EXCEPTION 'jobNumber is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bookings_jobNumber_immutable"
BEFORE UPDATE OF "jobNumber" ON "bookings"
FOR EACH ROW EXECUTE FUNCTION prevent_job_number_update();

CREATE TRIGGER "orders_jobNumber_immutable"
BEFORE UPDATE OF "jobNumber" ON "orders"
FOR EACH ROW EXECUTE FUNCTION prevent_job_number_update();

CREATE TRIGGER "invoices_jobNumber_immutable"
BEFORE UPDATE OF "jobNumber" ON "invoices"
FOR EACH ROW EXECUTE FUNCTION prevent_job_number_update();

CREATE TRIGGER "payments_jobNumber_immutable"
BEFORE UPDATE OF "jobNumber" ON "payments"
FOR EACH ROW EXECUTE FUNCTION prevent_job_number_update();
