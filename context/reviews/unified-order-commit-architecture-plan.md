# Unified Order Commit Architecture Plan

## Summary

Replace the post-lock Adjustment Workspace mental model with Unified Order Commit. Staff always works from `/orders/[orderId]/sales`; `Order*` rows remain the current operational truth; each commit checkpoints a locked operational snapshot and emits immutable financial documents.

`AdjustmentWorkspace` may be reused only as a temporary internal adapter during migration. It is not the target architecture, public naming model, or employee-facing workflow.

## Target Architecture

### POS is the single live sales UI

- Staff always works from `/orders/[orderId]/sales`.
- There is no separate employee-facing adjustment mode.
- The same package, photo, session configuration, add-on, payment, and commit controls render before and after financial commit.
- No new employee-facing contract, page copy, route, or component prop should expose Adjustment Workspace concepts.

### `Order*` rows are current operational truth

- Current customer ownership comes only from materialized `Order*` rows through canonical order composition projectors.
- Invoices are financial outputs only.
- Invoices must never reconstruct package identity, add-on ownership, selected-photo truth, session configuration ownership, or current customer ownership.

### `OrderCommit` is the persisted checkpoint boundary

- Add or define `OrderCommit` as the baseline checkpoint for committed operational state.
- Each commit stores locked composition identity and price snapshots.
- There must be one latest committed snapshot per order or FinancialCase used for future comparisons.
- Later commits compare pending draft composition against the latest committed `OrderCommit` snapshot, not against the latest invoice or latest adjustment document.

## Canonical States

### Current Operational Composition

What the customer currently owns now. This is read from materialized `Order*` rows through `OrderCompositionViewModel` and its surface projectors.

### Pending Draft Composition

Live POS changes that have not yet been financially committed. This is what staff edits from the Sales page.

### Last Committed Operational Snapshot

The last financially committed order-state checkpoint. It stores stable line identity, source order row ids, quantities, labels, and locked prices. This snapshot is the baseline for future commit comparisons.

## Public Interfaces

Create the canonical module:

```text
src/modules/order-commits/
```

Public names should use `OrderCommit`: services, DTOs, actions, tests, logs, metrics, and specs.

Recommended service entry points:

- `getOrderCommitState(orderId)`
- `getOrderCommitPreview(orderId)`
- `stageOrderCommitChange(orderId, input)`
- `discardOrderCommitDraft(orderId)`
- `commitOrderChanges(orderId, input, actorContext)`
- `getLatestCommittedOrderSnapshot(orderId | financialCaseId)`

Temporary compatibility code may call into existing `AdjustmentWorkspace` services behind adapters, but that naming must not leak into new public interfaces.

## Commit Rules

- Commit is atomic: validate approval, apply approved pending draft to `Order*` rows, persist the new `OrderCommit` snapshot, emit immutable financial documents, write audit/log records, and return the updated commit state.
- Locked invoices are never mutated.
- First commit creates the full/base invoice and first committed operational snapshot.
- Later additive commits compare pending draft against the latest committed snapshot and emit a positive delta document.
- Later reductions compare against the cumulative committed snapshot, require manager approval, then emit a credit note or refund-needed flow as appropriate.
- Equal-value swaps create an audit/snapshot commit with no payment due and no fabricated financial delta.
- Post-commit operational ownership is visible from `Order*` rows, not financial documents.

## Centralized Diff and Approval Logic

One service owns:

- package replacement diffing
- upgrade and downgrade detection
- cumulative baseline comparison
- net-zero swap detection
- reduction approval requirements
- credit note and refund-needed classification
- financial document generation preview

Pages and components must not recompute deltas, money, ownership, or approval logic.

## Snapshot Pricing Rules

- Existing committed lines compare using stored snapshot prices.
- Catalog prices are used only when staging newly added items.
- Newly staged item prices become locked into the next commit snapshot.
- Later catalog price edits must not change historical committed baselines or pending comparisons for already committed lines.

## Phased PR Plan

### Phase 1: `OrderCommit` schema and snapshot foundation

- Add the `OrderCommit` model and typed snapshot shape.
- Add latest-commit lookup helpers and first snapshot creation helpers.
- Add bootstrap/backfill behavior from current materialized `Order*` rows where needed.
- Do not use invoice lines as ownership truth.

Tests:

- latest committed snapshot selection
- snapshot price persistence
- snapshot composition identity shape
- guard proving ownership is not reconstructed from invoice lines

### Phase 2: Commit preview and diff engine

- Implement centralized diff from Pending Draft Composition vs Last Committed Operational Snapshot.
- Return typed preview DTOs for first/base commit, additive adjustment, downgrade, credit note, refund-needed, and net-zero audit commits.
- Use snapshot prices for existing committed lines and catalog prices only for newly staged items.

Tests:

- first commit previews a full/base invoice
- later commit previews only the delta
- downgrade compares against the cumulative committed snapshot, not latest invoice
- catalog price changes do not affect existing committed line comparisons
- newly staged prices are locked into the next commit snapshot

### Phase 3: POS action routing through order commits

- Route POS staging and commit actions through `order-commits`.
- Reuse `AdjustmentWorkspace` only behind temporary adapter code if needed.
- Commit action atomically materializes pending draft into `Order*`, persists `OrderCommit`, and emits financial documents.
- Preserve permission checks, audit logging, and financial invariant protections.

Tests:

- first commit creates full/base invoice and first `OrderCommit`
- later commit creates delta document and next `OrderCommit`
- commit does not mutate locked invoices
- approved downgrade emits the expected credit/refund-needed outcome
- current order ownership remains from materialized `Order*` rows after commit

### Phase 4: Unified live POS UI

- `/orders/[orderId]/sales` renders the same controls before and after commit.
- Replace adjustment-facing copy with operational commit language:
  - Pending Changes
  - Commit Order Changes
  - Approval Required
  - Credit/Refund Needed
  - No Balance Change
- UI consumes order-commit preview DTOs and composition/financial projectors only.
- Remove normal UI links to `/orders/[orderId]/adjustment-workspace`.

Tests:

- POS UI has no Adjustment Workspace copy, links, or visible mental model
- components consume DTOs/projectors instead of recomputing deltas, money, ownership, or approvals
- same controls are available before and after commit, subject to policy output

### Phase 5: Legacy AdjustmentWorkspace cleanup or removal

- Remove or quarantine employee-facing Adjustment Workspace route and contracts.
- Delete temporary adapter paths once parity is proven.
- Rename remaining metrics/tests/docs to `OrderCommit` where practical.
- Keep only explicit legacy compatibility notes for data migration or rollback.

Tests:

- no public UI route depends on Adjustment Workspace
- no new order-commit tests import page-level Adjustment Workspace contracts
- legacy adapter coverage exists only while the adapter remains

## Acceptance Criteria

- New public services, DTOs, actions, tests, logs, and specs use `OrderCommit` naming.
- No new employee-facing or page-level contract exposes Adjustment Workspace concepts.
- `Order*` rows remain the source for current operational ownership.
- Invoices are immutable financial outputs and are not used to reconstruct customer ownership.
- A persisted `OrderCommit` snapshot boundary exists and future comparisons use the latest committed snapshot.
- Commit applies pending changes, materializes `Order*` rows, persists the new snapshot, and emits financial documents atomically.
- Diff and approval logic are centralized in one service.
- Snapshot pricing is mandatory and regression-covered.
- POS UI has no adjustment-workspace mental model.

## Validation

- Targeted `order-commits` unit and integration tests.
- Existing adjustment/finalization tests updated to assert `OrderCommit` behavior where relevant.
- `npm run test:centralization`
- `npm run test:backend-invariants`
- `npm run build`
- `npm run lint`

## Execution Guidance

Use Claude Opus 4.7 first to inspect the repo and convert this architecture into phased feature specs.

Use Codex GPT-5.5 High for implementation because the work touches schema, financial invariants, immutable snapshots, and workflow logic.
