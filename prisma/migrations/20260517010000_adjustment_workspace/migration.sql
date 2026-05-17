CREATE TYPE "adjustment_workspace_status" AS ENUM ('open', 'finalized', 'cancelled');

CREATE TYPE "adjustment_workspace_event_type" AS ENUM (
  'opened',
  'edit_added',
  'edit_removed',
  'edit_modified',
  'package_swapped',
  'taken_over',
  'finalized',
  'cancelled',
  'parent_invoice_voided'
);

ALTER TABLE "orders"
ADD COLUMN "refund_pending" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "adjustment_workspaces" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "status" "adjustment_workspace_status" NOT NULL DEFAULT 'open',
  "opened_by_user_id" TEXT NOT NULL,
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "current_owner_user_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "base_snapshot_json" JSONB NOT NULL,
  "pending_changes_json" JSONB NOT NULL DEFAULT '{"edits":[]}',
  "finalized_adjustment_invoice_id" TEXT,
  "cancelled_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "adjustment_workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "adjustment_workspace_events" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "event_type" "adjustment_workspace_event_type" NOT NULL,
  "payload_json" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "adjustment_workspace_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "adjustment_workspaces_invoiceId_open_key"
ON "adjustment_workspaces"("invoice_id")
WHERE "status" = 'open';

CREATE INDEX "adjustment_workspaces_invoiceId_status_idx" ON "adjustment_workspaces"("invoice_id", "status");
CREATE INDEX "adjustment_workspaces_orderId_status_idx" ON "adjustment_workspaces"("order_id", "status");
CREATE INDEX "adjustment_workspaces_currentOwnerUserId_idx" ON "adjustment_workspaces"("current_owner_user_id");
CREATE INDEX "adjustment_workspace_events_workspaceId_at_idx" ON "adjustment_workspace_events"("workspace_id", "at");
CREATE INDEX "adjustment_workspace_events_actorUserId_at_idx" ON "adjustment_workspace_events"("actor_user_id", "at");
CREATE INDEX "adjustment_workspace_events_eventType_at_idx" ON "adjustment_workspace_events"("event_type", "at");

ALTER TABLE "adjustment_workspaces"
ADD CONSTRAINT "adjustment_workspaces_invoiceId_fkey"
FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "adjustment_workspaces"
ADD CONSTRAINT "adjustment_workspaces_orderId_fkey"
FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "adjustment_workspaces"
ADD CONSTRAINT "adjustment_workspaces_openedByUserId_fkey"
FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "adjustment_workspaces"
ADD CONSTRAINT "adjustment_workspaces_currentOwnerUserId_fkey"
FOREIGN KEY ("current_owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "adjustment_workspaces"
ADD CONSTRAINT "adjustment_workspaces_finalizedAdjustmentInvoiceId_fkey"
FOREIGN KEY ("finalized_adjustment_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "adjustment_workspace_events"
ADD CONSTRAINT "adjustment_workspace_events_workspaceId_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "adjustment_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "adjustment_workspace_events"
ADD CONSTRAINT "adjustment_workspace_events_actorUserId_fkey"
FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
