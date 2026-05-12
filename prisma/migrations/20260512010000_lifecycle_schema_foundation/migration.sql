ALTER TYPE "BookingStatus" RENAME VALUE 'COMPLETED' TO 'CHECKED_IN';
ALTER TYPE "PaymentType" RENAME VALUE 'BASE' TO 'FINAL';

CREATE TYPE "InvoiceType" AS ENUM ('DEPOSIT', 'FINAL', 'ADJUSTMENT', 'REFUND', 'CREDIT_NOTE');

ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_bookingId_jobId_fkey";
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_invoiceId_jobId_fkey";
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_jobId_customerId_fkey";
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_bookingId_jobId_customerId_fkey";
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_orderId_bookingId_jobId_customerId_fkey";

DROP INDEX IF EXISTS "bookings_id_jobId_key";
DROP INDEX IF EXISTS "bookings_id_jobId_customerId_key";
DROP INDEX IF EXISTS "orders_id_jobId_key";
DROP INDEX IF EXISTS "orders_bookingId_jobId_key";
DROP INDEX IF EXISTS "orders_id_bookingId_jobId_customerId_key";
DROP INDEX IF EXISTS "invoices_id_jobId_key";

ALTER TABLE "bookings"
  ALTER COLUMN "publicId" DROP NOT NULL,
  ALTER COLUMN "jobNumber" DROP NOT NULL,
  ALTER COLUMN "jobId" DROP NOT NULL;

ALTER TABLE "orders"
  ADD COLUMN "originalPackagePriceSnapshot" DECIMAL(10, 3),
  ADD COLUMN "finalPackagePriceSnapshot" DECIMAL(10, 3);

CREATE TABLE "financial_cases" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "jobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "financial_cases_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "invoices"
  ADD COLUMN "financialCaseId" TEXT,
  ADD COLUMN "invoiceType" "InvoiceType",
  ALTER COLUMN "jobNumber" DROP NOT NULL,
  ALTER COLUMN "jobId" DROP NOT NULL;

ALTER TABLE "payments"
  ADD COLUMN "financialCaseId" TEXT,
  ALTER COLUMN "jobNumber" DROP NOT NULL,
  ALTER COLUMN "jobId" DROP NOT NULL;

ALTER TABLE "identifier_sequences"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'JOB';

ALTER TABLE "identifier_sequences" DROP CONSTRAINT "identifier_sequences_pkey";
ALTER TABLE "identifier_sequences"
  ADD CONSTRAINT "identifier_sequences_pkey" PRIMARY KEY ("scope", "year", "kind");

CREATE UNIQUE INDEX "identifier_sequences_scope_year_kind_key" ON "identifier_sequences"("scope", "year", "kind");
CREATE UNIQUE INDEX "financial_cases_bookingId_key" ON "financial_cases"("bookingId");
CREATE INDEX "financial_cases_customerId_idx" ON "financial_cases"("customerId");
CREATE INDEX "financial_cases_jobId_idx" ON "financial_cases"("jobId");
CREATE INDEX "invoices_financialCaseId_idx" ON "invoices"("financialCaseId");
CREATE INDEX "payments_financialCaseId_idx" ON "payments"("financialCaseId");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "financial_cases"
  ADD CONSTRAINT "financial_cases_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "financial_cases"
  ADD CONSTRAINT "financial_cases_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "financial_cases"
  ADD CONSTRAINT "financial_cases_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "jobs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_financialCaseId_fkey"
  FOREIGN KEY ("financialCaseId") REFERENCES "financial_cases"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "jobs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_financialCaseId_fkey"
  FOREIGN KEY ("financialCaseId") REFERENCES "financial_cases"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
