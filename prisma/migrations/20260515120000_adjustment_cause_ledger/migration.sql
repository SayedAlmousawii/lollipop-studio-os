CREATE TYPE "OrderEntityKind" AS ENUM (
  'ADDON',
  'UPGRADE',
  'EXTRA_PHOTO',
  'PACKAGE_TIER_UPGRADE'
);

ALTER TABLE "invoice_line_items"
  ADD COLUMN "causeOrderEntityKind" "OrderEntityKind",
  ADD COLUMN "causeOrderEntityId" TEXT;

ALTER TABLE "document_applications"
  ADD COLUMN "target_invoice_line_id" TEXT;

ALTER TABLE "document_applications"
  ADD CONSTRAINT "document_applications_target_invoice_line_id_fkey"
  FOREIGN KEY ("target_invoice_line_id")
  REFERENCES "invoice_line_items"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "invoice_line_items_causeOrderEntityKind_causeOrderEntityId_idx"
  ON "invoice_line_items"("causeOrderEntityKind", "causeOrderEntityId");

CREATE INDEX "document_applications_target_invoice_line_id_idx"
  ON "document_applications"("target_invoice_line_id");
