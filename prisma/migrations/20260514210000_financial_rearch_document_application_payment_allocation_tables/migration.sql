CREATE TABLE "document_applications" (
  "id" TEXT NOT NULL,
  "source_invoice_id" TEXT NOT NULL,
  "target_invoice_id" TEXT NOT NULL,
  "amount_applied" DECIMAL(10,3) NOT NULL,
  "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_by_user_id" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_applications_amount_applied_positive_check" CHECK ("amount_applied" > 0)
);

CREATE UNIQUE INDEX "document_applications_source_invoice_id_target_invoice_id_key"
ON "document_applications"("source_invoice_id", "target_invoice_id");

CREATE INDEX "document_applications_source_invoice_id_idx"
ON "document_applications"("source_invoice_id");

CREATE INDEX "document_applications_target_invoice_id_idx"
ON "document_applications"("target_invoice_id");

ALTER TABLE "document_applications"
ADD CONSTRAINT "document_applications_source_invoice_id_fkey"
FOREIGN KEY ("source_invoice_id") REFERENCES "invoices"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_applications"
ADD CONSTRAINT "document_applications_target_invoice_id_fkey"
FOREIGN KEY ("target_invoice_id") REFERENCES "invoices"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_applications"
ADD CONSTRAINT "document_applications_applied_by_user_id_fkey"
FOREIGN KEY ("applied_by_user_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "payment_allocations" (
  "id" TEXT NOT NULL,
  "payment_id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "amount" DECIMAL(10,3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_allocations_amount_positive_check" CHECK ("amount" > 0)
);

CREATE INDEX "payment_allocations_payment_id_idx"
ON "payment_allocations"("payment_id");

CREATE INDEX "payment_allocations_invoice_id_idx"
ON "payment_allocations"("invoice_id");

ALTER TABLE "payment_allocations"
ADD CONSTRAINT "payment_allocations_payment_id_fkey"
FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_allocations"
ADD CONSTRAINT "payment_allocations_invoice_id_fkey"
FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
