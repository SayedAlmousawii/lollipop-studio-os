CREATE SEQUENCE IF NOT EXISTS "invoice_number_seq";

ALTER TABLE "invoices" ADD COLUMN "invoiceSeq" INTEGER;

WITH numbered AS (
  SELECT
    "id",
    row_number() OVER (ORDER BY "createdAt", "id") AS seq
  FROM "invoices"
)
UPDATE "invoices"
SET "invoiceSeq" = numbered.seq
FROM numbered
WHERE "invoices"."id" = numbered."id";

UPDATE "invoices"
SET "invoiceNumber" = 'INV-' || lpad("invoiceSeq"::text, 5, '0');

SELECT setval(
  '"invoice_number_seq"',
  COALESCE((SELECT MAX("invoiceSeq") FROM "invoices"), 1),
  EXISTS (SELECT 1 FROM "invoices")
);

ALTER TABLE "invoices"
  ALTER COLUMN "invoiceSeq" SET NOT NULL,
  ALTER COLUMN "invoiceSeq" SET DEFAULT nextval('"invoice_number_seq"');

CREATE UNIQUE INDEX "invoices_invoiceSeq_key" ON "invoices"("invoiceSeq");
