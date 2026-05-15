DROP TRIGGER IF EXISTS trg_reject_frozen_field_mutation_on_locked_invoice ON "invoices";
DROP FUNCTION IF EXISTS reject_frozen_field_mutation_on_locked_invoice();
DROP TABLE IF EXISTS "invoice_lock_snapshots";
