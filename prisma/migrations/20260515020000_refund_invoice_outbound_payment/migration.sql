ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'REFUND';

ALTER TABLE "payments"
  ADD COLUMN "refundOfPaymentId" TEXT;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_refundOfPaymentId_fkey"
  FOREIGN KEY ("refundOfPaymentId") REFERENCES "payments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "payments_refundOfPaymentId_idx" ON "payments"("refundOfPaymentId");
