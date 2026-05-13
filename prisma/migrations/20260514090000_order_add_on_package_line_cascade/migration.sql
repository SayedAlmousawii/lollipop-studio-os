ALTER TABLE "order_add_ons"
  DROP CONSTRAINT IF EXISTS "order_add_ons_orderPackageId_fkey";

DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute att
      ON att.attrelid = rel.oid
      AND att.attnum = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND rel.relname = 'order_add_ons'
      AND nsp.nspname = current_schema()
      AND att.attname = 'orderPackageId'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      current_schema(),
      'order_add_ons',
      constraint_record.conname
    );
  END LOOP;
END $$;

ALTER TABLE "order_add_ons"
  ADD CONSTRAINT "order_add_ons_orderPackageId_fkey"
  FOREIGN KEY ("orderPackageId") REFERENCES "order_packages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
