## Goal

Add the `OrderCommitDraft` foundation for Unified Order Commit without building POS staging reducers or changing staff workflows. This spec creates the draft persistence boundary, lifecycle helpers, snapshot replacement with optimistic concurrency, owner/manager mutation rules, minimal pending operation history, and regression guards proving drafts remain independent of invoice lines.

## Read First

- `context/reviews/unified-order-commit-live-pos-roadmap.md` - approved Phase 2 scope and cross-phase rules.
- `context/reviews/unified-order-commit-architecture-plan.md` - `OrderCommit` public naming and POS-only target architecture.
- `context/feature-specs/120-order-commit-snapshot-foundation.md` - existing `OrderCommit` snapshot foundation.
- `context/target-data-model.md` - current `OrderCommit` and materialized `Order*` ownership contracts.
- `prisma/schema.prisma` - current `OrderCommit`, `Order`, `FinancialCase`, `User`, and `AdjustmentWorkspace` relations.
- `src/modules/order-commits/` - existing constants, schemas, types, latest lookup, bootstrap, and snapshot capture helpers.

## Rules

- This spec is docs-only until implementation is explicitly requested.
- Spec 121 is foundation only. Do not add domain-specific POS staging/reducer logic.
- Do not change `/orders/[orderId]/sales`, POS actions, UI copy, routes, financial document emission, or Adjustment Workspace finalization.
- Public names must use `OrderCommitDraft` / `OrderCommit`; no new public DTO, service, route, metric, or test should expose Adjustment Workspace terminology.
- `pendingSnapshotJson` stores pending draft truth and must parse as the V1 `OrderCommit` snapshot contract.
- `pendingOpsJson` is append/history metadata only in Spec 121. It must not be interpreted as business logic or used to compute financial diffs.
- Draft writes must not mutate `Order*`, invoices, payments, allocations, document applications, refunds, credit notes, or Adjustment Workspace rows.
- Draft services must not read `InvoiceLineItem`.
- Use one active draft per `orderId` for V1.
- Require `expectedVersion` for mutating helpers.
- Creator is the owner; owner or manager/admin may mutate; non-owner staff may read but cannot mutate.

## Scope

### In Scope

- Add Prisma model `OrderCommitDraft` mapped to `order_commit_drafts` with:
  - `id`, `orderId`, `financialCaseId`, `baseCommitId`
  - `pendingSnapshotVersion`, `pendingSnapshotJson`, `pendingOpsJson`
  - `version`, `ownerUserId`, `openedByUserId`, `lastTouchedByUserId`
  - nullable `legacyAdjustmentWorkspaceId`
  - `createdAt`, `updatedAt`
- Add relations from `Order`, `FinancialCase`, `OrderCommit`, `User`, and optionally `AdjustmentWorkspace`.
- Add constraints/indexes:
  - `@@unique([orderId])`
  - indexes on `financialCaseId`, `baseCommitId`, `ownerUserId`
  - index `legacyAdjustmentWorkspaceId` if FK is present.
- Add draft constants, schemas, types, service, and index exports under `src/modules/order-commits/`.
- Add helpers:
  - `getOrderCommitDraft({ orderId })`
  - `getOrCreateOrderCommitDraft({ orderId, actorContext })`
  - `replaceOrderCommitDraftSnapshot({ orderId, pendingSnapshotJson, expectedVersion, actorContext, operation? })`
  - `appendOrderCommitDraftOperation({ orderId, operation, expectedVersion, actorContext })`
  - `discardOrderCommitDraft({ orderId, expectedVersion, actorContext })`
- Add tests and static source guards under `tests/order-commits/`.
- Wire tests into `scripts/run-centralization-tests.ts`.

### Out of Scope

- No domain-specific reducer for add-ons, package item upgrades, line removal, quantity changes, package tier changes, selected/extra photo changes, or session configuration changes.
- No catalog-price locking for newly staged items.
- No `stageOrderCommitDraftChange` with business semantics.
- No `OrderCommitDocument`.
- No commit preview or snapshot diff engine.
- No commit execution.
- No invoice, credit note, refund, payment, or document-application creation.
- No POS server-action rewiring.
- No UI changes.
- No forced conversion of open Adjustment Workspaces.

## Implementation Direction

### Task 1 - Schema And Contracts

Add `OrderCommitDraft` as an additive model. `baseCommitId` is nullable so first-commit drafts can start from current operational rows before any `OrderCommit` exists.

Define:

- `OrderCommitDraftPendingOpsV1`
- `OrderCommitDraftOperationV1`
- `orderCommitDraftPendingOpsV1Schema`
- `orderCommitDraftOperationV1Schema`

The minimal operation contract should be generic history only:

- `id`
- `type`
- `payload`
- `createdAt`
- `actorUserId`

Allowed Spec 121 operation types should stay generic, such as `SNAPSHOT_REPLACED` and `NOTE_APPENDED`. Do not add domain operation types for add-ons, packages, photos, quantities, or session configurations.

### Task 2 - Lifecycle Helpers

`getOrderCommitDraft` loads one active draft by `orderId`, parses `pendingSnapshotJson` and `pendingOpsJson`, and returns typed row metadata.

`getOrCreateOrderCommitDraft` runs in a transaction:

- validate actor/permission.
- resolve `Order` and `FinancialCase`.
- return existing draft if present.
- load latest `OrderCommit` for the order.
- if latest exists, set `baseCommitId` and copy latest snapshot into `pendingSnapshotJson`.
- if latest does not exist, capture current operational rows and set `baseCommitId = null`.
- initialize `pendingOpsJson` to empty V1 history.
- set `ownerUserId`, `openedByUserId`, and `lastTouchedByUserId`.

`discardOrderCommitDraft` validates `expectedVersion`, checks owner/manager authorization, deletes the draft row, and leaves all operational and financial rows untouched.

### Task 3 - Snapshot Replacement

`replaceOrderCommitDraftSnapshot` is the only Spec 121 helper that changes `pendingSnapshotJson`.

It must:

- require an existing draft.
- validate `expectedVersion`.
- enforce owner/manager mutation rules.
- parse replacement snapshot as V1.
- require matching `orderId`, `financialCaseId`, schema version, and currency.
- increment `version`.
- update `lastTouchedByUserId`.
- append a generic `SNAPSHOT_REPLACED` operation when `operation` is provided or when the helper needs an audit/history entry.
- avoid any invoice-line reads and avoid any business-specific reducer behavior.

### Task 4 - Minimal Pending Operation History

`appendOrderCommitDraftOperation` appends or replaces a generic history operation by operation id without changing `pendingSnapshotJson`.

It must:

- validate `expectedVersion`.
- enforce owner/manager mutation rules.
- parse the operation with the generic operation schema.
- increment `version`.
- update `lastTouchedByUserId`.
- leave `pendingSnapshotJson` unchanged.
- not resolve catalog prices, inspect products/packages/session configurations, or compute deltas.

This helper exists only so Phase 2 has tested `pendingOpsJson` mechanics before Phase 2B adds real staging behavior.

### Task 5 - Tests And Guards

Add tests for:

- schema contract accepts valid `OrderCommitDraft` pending snapshot and pending ops shapes.
- one active draft per order.
- repeated `getOrCreate` returns the same active draft.
- draft after an existing commit uses latest `OrderCommit` as `baseCommitId`.
- first-commit draft uses current operational snapshot with `baseCommitId = null`.
- snapshot replacement rejects stale `expectedVersion`.
- append operation rejects stale `expectedVersion`.
- non-owner staff cannot replace/discard/append.
- manager/admin can replace/discard/append.
- discard removes draft state and does not mutate `Order*` rows.
- append operation changes `pendingOpsJson` but not `pendingSnapshotJson`.
- replacement does not read `InvoiceLineItem`.
- no public `src/modules/order-commits/**` export exposes Adjustment Workspace naming, except the allowed legacy FK field.
- no `app/**` or `src/components/**` DB imports are introduced.

## Deferred To Spec 122 / Phase 2B

Spec 122 should own the real domain-specific staging/reducer layer, including:

- add catalog add-on.
- package item upgrade.
- remove line.
- quantity changes.
- package tier changes.
- selected/extra photo changes.
- session configuration changes.
- catalog-price resolution and locking for newly staged items.
- converting generic pending operation history into typed domain staging operations, if still desired.
- reducer tests proving pending snapshots update correctly without invoice-line ownership.

## Observability Checklist

### Dashboards / Metrics

- No dashboard required.
- Optional structured logs may use only `order_commit_draft.*` names.
- Conflict/validation errors should include `orderId` and draft id when available, without exposing raw Prisma errors.

### Rollback Plan

- Drop `order_commit_drafts` and related FK/index additions.
- Delete draft rows only; no operational or financial repair should be required.
- Since no POS route consumes drafts yet, rollback is isolated to the new table/module.

### Customer-Visible Surface

- None. Staff should see no behavior, route, copy, invoice, payment, or POS change.

## Post-Implementation

- Update `context/progress-tracker.md` after code lands.
- Update `context/target-data-model.md` with the `OrderCommitDraft` pending snapshot contract.
- Leave roadmap docs unchanged unless implementation reveals approved-roadmap drift.

## Acceptance Criteria

- `OrderCommitDraft` exists with the specified fields, relations, unique order constraint, and indexes.
- Draft lifecycle helpers exist for get, getOrCreate, discard, snapshot replacement, and generic pending-op append.
- `pendingSnapshotJson` is typed, versioned, and parsed as V1 order commit snapshot data.
- `pendingOpsJson` is typed generic history only and does not drive business logic in Spec 121.
- Draft creation uses latest `OrderCommit` when present and current operational rows when no commit exists.
- Mutating helpers require `expectedVersion`.
- Owner/manager mutation rules are enforced.
- Draft writes do not mutate operational or financial rows.
- Draft services do not read `InvoiceLineItem`.
- No domain-specific POS staging reducers are implemented.
- Existing POS and Adjustment Workspace behavior is unchanged.
- New tests are wired into `test:centralization`.
- `npm run build` passes.
- `npm run lint` passes.

## Assumptions And Defaults

- Use `orderId` as the V1 active draft boundary.
- Omit `stageOrderCommitDraftChange` in Spec 121; add it in Spec 122 if the implementation needs that public name for domain staging.
- Keep `baseCommitId` nullable.
- Keep owner takeover out of Spec 121.
