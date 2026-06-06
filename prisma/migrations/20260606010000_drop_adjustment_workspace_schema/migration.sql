DO $$
DECLARE
  workspace_count integer;
  event_count integer;
BEGIN
  SELECT count(*) INTO workspace_count FROM "adjustment_workspaces";
  SELECT count(*) INTO event_count FROM "adjustment_workspace_events";

  IF workspace_count > 0 OR event_count > 0 THEN
    RAISE EXCEPTION
      'Cannot drop Adjustment Workspace schema while rows exist: adjustment_workspaces=%, adjustment_workspace_events=%',
      workspace_count,
      event_count;
  END IF;
END $$;

ALTER TABLE "order_commits"
  DROP CONSTRAINT IF EXISTS "order_commits_legacyAdjustmentWorkspaceId_fkey";

ALTER TABLE "order_commit_drafts"
  DROP CONSTRAINT IF EXISTS "order_commit_drafts_legacyAdjustmentWorkspaceId_fkey";

DROP INDEX IF EXISTS "order_commits_legacyAdjustmentWorkspaceId_idx";
DROP INDEX IF EXISTS "order_commit_drafts_legacyAdjustmentWorkspaceId_idx";

ALTER TABLE "order_commits"
  DROP COLUMN IF EXISTS "legacyAdjustmentWorkspaceId";

ALTER TABLE "order_commit_drafts"
  DROP COLUMN IF EXISTS "legacyAdjustmentWorkspaceId";

DROP TABLE "adjustment_workspace_events";
DROP TABLE "adjustment_workspaces";

DROP TYPE "adjustment_workspace_event_type";
DROP TYPE "adjustment_workspace_status";
