## Goal

Phase 6 step 6 (P6-6), the final step: drop the Adjustment Workspace database tables and enums and sever the last schema links to them. With all AW code deleted in P6-5, remove `AdjustmentWorkspace` and `AdjustmentWorkspaceEvent` (and their enums) and the `legacyAdjustmentWorkspaceId` FK columns on `OrderCommit` and `OrderCommitDraft`. After this migration, AW exists nowhere in the system.

Source of truth: `context/reviews/phase-6-readiness-report.md` (Section C → P6-6). Depends on P6-5 (Spec 148) shipped and stable. This is the only Phase 6 spec that touches `prisma/schema.prisma`.

## Read First

- `context/reviews/phase-6-readiness-report.md` — Section C → P6-6, Section B → migration note.
- `prisma/schema.prisma`:
  - `:228-243` — `enum AdjustmentWorkspaceStatus`, `enum AdjustmentWorkspaceEventType`.
  - `:992-1023` — `model AdjustmentWorkspace` (FKs **to** `Invoice` parent/finalized, `User` opened/owner — these are AW→other, fine to drop with the table).
  - `:1025-1036` — `model AdjustmentWorkspaceEvent` (FK to `AdjustmentWorkspace`, `onDelete: Cascade`).
  - **Inbound relations that must be severed first:**
    - `:269-271` — `User.openedAdjustmentWorkspaces / ownedAdjustmentWorkspaces / adjustmentWorkspaceEvents`.
    - `:646` — `Invoice.adjustmentWorkspaces`; `:965-966` — `Invoice.adjustmentWorkspaces` / `finalizedAdjustmentWorkspaces` relation back-refs.
    - `:873,884,892` — `OrderCommit.legacyAdjustmentWorkspaceId` + `legacyAdjustmentWorkspace` relation (`onDelete: SetNull`) + index.
    - `:908,918,924` — `OrderCommitDraft.legacyAdjustmentWorkspaceId` + relation + index.
    - `:1016-1017` — `AdjustmentWorkspace.legacyOrderCommits / legacyOrderCommitDrafts` back-refs.
- `context/development-utilities.md` — dev reset / migration workflow.
- `context/target-data-model.md` — update the canonical schema reference after the drop.

## Rules

- **Pre-flight data check:** verify zero rows in `AdjustmentWorkspace` and `AdjustmentWorkspaceEvent` in every environment that retains data (dev resets; production has no order data per the project data-reset note). The migration assumes empty tables; if any environment had rows, decide archival before drop.
- **Sever inbound FKs before dropping tables.** Remove `OrderCommit.legacyAdjustmentWorkspaceId` and `OrderCommitDraft.legacyAdjustmentWorkspaceId` (columns, relations, indexes) and the `User`/`Invoice` back-relation fields, then drop `AdjustmentWorkspace`, `AdjustmentWorkspaceEvent`, and the two enums. A single Prisma migration can express all of it in the correct order; verify the generated SQL drops FKs/columns before tables.
- Preserve all `Invoice`/`Payment` history. Dropping `Invoice.adjustmentWorkspaces` back-refs removes only the relation field, not any invoice row. Historical ADJUSTMENT / CREDIT_NOTE / REFUND invoices remain; `OrderCommitDocument` is the forward-going commit↔document link.
- Losing `legacyAdjustmentWorkspaceId` is acceptable: it was a bootstrap/debug backref to AW rows that no longer exist. Confirm nothing reads it (P6-5 deleted AW code; grep to be sure no service reads the column).
- Provide a coherent down-migration (recreate tables/enums/columns) even though restoring data is not expected — schema-revertibility only.
- No application code change in this spec beyond Prisma client regeneration and any type fallout from the removed relation fields (there should be none if P6-5 was clean).

## Scope

### In Scope

- Prisma migration that, in order: drops the `legacyAdjustmentWorkspaceId` columns/relations/indexes on `OrderCommit` and `OrderCommitDraft`; removes the `User` and `Invoice` AW back-relation fields; drops `AdjustmentWorkspaceEvent`; drops `AdjustmentWorkspace`; drops `AdjustmentWorkspaceStatus` and `AdjustmentWorkspaceEventType` enums.
- Regenerate the Prisma client; fix any residual type references (expected none post-P6-5).
- Pre-flight emptiness assertion (script or migration guard) for the two AW tables.
- Update `context/target-data-model.md` and `context/current-database-er-diagram.md` to drop AW entities.
- Update the workflow test-data reset if it referenced AW tables (verify the reset no longer needs to clear them).
- Update `context/progress-tracker.md`.

### Out of Scope

- Any application/business logic change (all AW code already gone in P6-5).
- Phase 7 (typed ops history, takeover, timeline).
- Touching `OrderCommit` / `OrderCommitDraft` beyond removing the `legacy*` columns.

## Implementation Direction

This is a schema-only, schema-last migration. First confirm the AW tables are empty and that no surviving code reads `legacyAdjustmentWorkspaceId` (grep; P6-5 should have removed all AW code). Author one Prisma migration that removes the inbound FK columns and back-relation fields **before** dropping the AW tables and enums, so Postgres has no dangling constraints. Inspect the generated SQL to confirm drop order (columns/constraints → tables → enums). Regenerate the client and run the full suite — a clean P6-5 means no type fallout. Update the data-model docs and the ER diagram to remove AW. Keep a working down-migration for schema revertibility only (data restoration is out of scope and unnecessary given empty tables).

## Observability Checklist

### Dashboards / Metrics

- None. Schema removal only.

### Rollback Plan

- **Schema-destructive.** Down-migration recreates `AdjustmentWorkspace`, `AdjustmentWorkspaceEvent`, the two enums, and the `legacyAdjustmentWorkspaceId` columns/relations/indexes — structure only; row data is not restored (tables were empty by precondition).
- A full AW restore (code + schema) requires reverting both P6-5 and P6-6.
- Land only after P6-5 has been stable through the agreed bake window.

### Customer-Visible Surface

- None. No UI or workflow references AW by this point.

## Post-Implementation

- `context/target-data-model.md` — remove AW models/enums; note `OrderCommit*` no longer carries `legacyAdjustmentWorkspaceId`.
- `context/current-database-er-diagram.md` — regenerate without AW entities.
- `context/progress-tracker.md` — "Now" line: AW tables/enums and the `OrderCommit*` legacy FKs dropped; Adjustment Workspace fully retired; Phase 6 complete.
- `context/reviews/unified-order-commit-live-pos-roadmap.md` — Phase 6: mark P6-6 shipped and Phase 6 complete; Phase 7 unblocked.

## Acceptance Criteria

- Pre-flight: `AdjustmentWorkspace` and `AdjustmentWorkspaceEvent` are empty in every data-retaining environment before the migration.
- The migration removes `legacyAdjustmentWorkspaceId` (columns, relations, indexes) from `OrderCommit` and `OrderCommitDraft`, the `User`/`Invoice` AW back-relations, both AW models, and both AW enums — with generated SQL dropping constraints/columns before tables.
- No Prisma model, enum, or relation references Adjustment Workspace after the migration.
- Historical `Invoice`/`Payment` rows (incl. ADJUSTMENT/CREDIT_NOTE/REFUND) are preserved; `OrderCommitDocument` linkage intact.
- Prisma client regenerates with no type errors; no application code references `legacyAdjustmentWorkspaceId`.
- A working down-migration recreates the dropped structures.
- Data-model docs and ER diagram updated.
- `npm run test:centralization` passes.
- `npm run test:backend-invariants` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Resolved Decisions

1. **Schema-last, single migration, correct drop order.** Inbound FKs (`OrderCommit*.legacyAdjustmentWorkspaceId`, `User`/`Invoice` back-refs) are removed before the AW tables/enums to avoid dangling constraints.
2. **`legacyAdjustmentWorkspaceId` is expendable.** It was a bootstrap/debug backref to rows that no longer exist; dropping it loses no live capability.

## Open Questions

- Whether any non-dev environment ever held AW rows that warrant archival before the drop. Default: none (dev resets; production has no order data) — confirm during the pre-flight check.
