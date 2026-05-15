CREATE OR REPLACE FUNCTION reject_payment_allocation_overcollection()
RETURNS TRIGGER AS $$
DECLARE
  invoice_total NUMERIC(10, 3);
  current_total NUMERIC(10, 3);
BEGIN
  SELECT "totalAmount" INTO invoice_total
    FROM "invoices"
    WHERE id = NEW."invoice_id";

  IF invoice_total IS NULL THEN
    RAISE EXCEPTION 'PaymentAllocation references non-existent invoice %', NEW."invoice_id"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO current_total
    FROM "payment_allocations"
    WHERE "invoice_id" = NEW."invoice_id"
      AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF (current_total + NEW.amount) > invoice_total THEN
    RAISE EXCEPTION
      'PaymentAllocation over-collection: invoice % total %, would become %',
      NEW."invoice_id", invoice_total, current_total + NEW.amount
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reject_payment_allocation_overcollection
BEFORE INSERT OR UPDATE ON "payment_allocations"
FOR EACH ROW
EXECUTE FUNCTION reject_payment_allocation_overcollection();
