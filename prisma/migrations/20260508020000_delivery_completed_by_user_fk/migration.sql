-- AlterTable: add deliveryCompletedById as a nullable FK to users
ALTER TABLE "orders" ADD COLUMN "deliveryCompletedById" TEXT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_deliveryCompletedById_fkey"
  FOREIGN KEY ("deliveryCompletedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Legacy deliveryCompletedBy (free-text) is retained as a non-authoritative
-- fallback. No backfill is performed because stored values are free-text names
-- and cannot be safely mapped to user IDs programmatically.
-- New completions will write deliveryCompletedById; deliveryCompletedBy
-- remains readable only for orders completed before this migration.
