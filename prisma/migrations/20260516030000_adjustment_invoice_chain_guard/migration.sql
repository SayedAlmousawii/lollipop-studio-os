CREATE OR REPLACE FUNCTION reject_adjustment_invoice_chaining()
RETURNS TRIGGER AS $$
DECLARE
  parent_type "InvoiceType";
BEGIN
  IF NEW."invoiceType" = 'ADJUSTMENT' AND NEW."parentInvoiceId" IS NOT NULL THEN
    SELECT "invoiceType" INTO parent_type
      FROM "invoices"
      WHERE id = NEW."parentInvoiceId";

    IF parent_type = 'ADJUSTMENT' THEN
      RAISE EXCEPTION
        'ADJUSTMENT invoice cannot reference another ADJUSTMENT as parent (% -> %)',
        NEW.id, NEW."parentInvoiceId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reject_adjustment_invoice_chaining
BEFORE INSERT OR UPDATE ON "invoices"
FOR EACH ROW
EXECUTE FUNCTION reject_adjustment_invoice_chaining();
