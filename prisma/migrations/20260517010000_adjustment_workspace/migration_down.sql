ALTER TABLE "adjustment_workspace_events" DROP CONSTRAINT IF EXISTS "adjustment_workspace_events_actorUserId_fkey";
ALTER TABLE "adjustment_workspace_events" DROP CONSTRAINT IF EXISTS "adjustment_workspace_events_workspaceId_fkey";
ALTER TABLE "adjustment_workspaces" DROP CONSTRAINT IF EXISTS "adjustment_workspaces_finalizedAdjustmentInvoiceId_fkey";
ALTER TABLE "adjustment_workspaces" DROP CONSTRAINT IF EXISTS "adjustment_workspaces_currentOwnerUserId_fkey";
ALTER TABLE "adjustment_workspaces" DROP CONSTRAINT IF EXISTS "adjustment_workspaces_openedByUserId_fkey";
ALTER TABLE "adjustment_workspaces" DROP CONSTRAINT IF EXISTS "adjustment_workspaces_orderId_fkey";
ALTER TABLE "adjustment_workspaces" DROP CONSTRAINT IF EXISTS "adjustment_workspaces_invoiceId_fkey";

DROP TABLE IF EXISTS "adjustment_workspace_events";
DROP TABLE IF EXISTS "adjustment_workspaces";

ALTER TABLE "orders" DROP COLUMN IF EXISTS "refund_pending";

DROP TYPE IF EXISTS "adjustment_workspace_event_type";
DROP TYPE IF EXISTS "adjustment_workspace_status";
