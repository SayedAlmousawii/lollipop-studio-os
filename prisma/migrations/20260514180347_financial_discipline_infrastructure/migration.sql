BEGIN;

ALTER TABLE "invoices"
ADD CONSTRAINT "invoices_paid_amount_nonnegative_check" CHECK ("paidAmount" >= 0),
ADD CONSTRAINT "invoices_total_amount_nonnegative_check" CHECK ("totalAmount" >= 0),
ADD CONSTRAINT "invoices_remaining_amount_nonnegative_check" CHECK ("remainingAmount" >= 0);

ALTER TABLE "payments"
ADD CONSTRAINT "payments_amount_positive_check" CHECK ("amount" > 0);

COMMIT;
