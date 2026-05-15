-- CreateTable
CREATE TABLE "invoice_lock_snapshots" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedByUserId" TEXT,
    "totalAmount" DECIMAL(10,3) NOT NULL,
    "invoiceType" "InvoiceType" NOT NULL,
    "parentInvoiceId" TEXT,
    "financialCaseId" TEXT NOT NULL,
    "jobId" TEXT,
    "orderId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,

    CONSTRAINT "invoice_lock_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_lock_snapshots_invoiceId_lockedAt_idx" ON "invoice_lock_snapshots"("invoiceId", "lockedAt");

-- AddForeignKey
ALTER TABLE "invoice_lock_snapshots" ADD CONSTRAINT "invoice_lock_snapshots_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Locked invoice frozen-field guard
CREATE OR REPLACE FUNCTION reject_frozen_field_mutation_on_locked_invoice()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."isLocked" = true THEN
    IF NEW."totalAmount" <> OLD."totalAmount"
       OR NEW."invoiceType" <> OLD."invoiceType"
       OR NEW."parentInvoiceId" IS DISTINCT FROM OLD."parentInvoiceId"
       OR NEW."financialCaseId" <> OLD."financialCaseId"
       OR NEW."jobId" IS DISTINCT FROM OLD."jobId"
       OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
       OR NEW."invoiceNumber" <> OLD."invoiceNumber"
       OR NEW."publicId" <> OLD."publicId"
    THEN
      RAISE EXCEPTION 'Frozen field mutation on locked invoice % is not permitted', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reject_frozen_field_mutation_on_locked_invoice
BEFORE UPDATE ON "invoices"
FOR EACH ROW
EXECUTE FUNCTION reject_frozen_field_mutation_on_locked_invoice();
