-- Add the future materialization idempotency flag for finalized adjustment workspaces.
ALTER TABLE "adjustment_workspaces"
  ADD COLUMN "operational_state_applied_at" TIMESTAMP(3);
