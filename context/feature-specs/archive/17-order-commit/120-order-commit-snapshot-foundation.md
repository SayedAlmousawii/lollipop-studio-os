## Goal

Create the `OrderCommit` snapshot foundation for the Unified Order Commit architecture without changing POS behavior. This phase adds the persisted committed operational baseline, captures versioned snapshots from current `Order*` rows, bootstraps existing committed orders, and proves by tests that committed ownership and price baselines do not come from invoice line items.

## Read First

- `context/reviews/unified-order-commit-live-pos-roadmap.md` - approved Phase 1 scope and cross-phase rules.
- `context/reviews/unified-order-commit-architecture-plan.md` - target terminology, `OrderCommit` public interface, and snapshot boundary semantics.
- `context/target-data-model.md` - current operational-materialization contract for `Order*` rows and invoice line items.
- `prisma/schema.prisma` - `Order`, `OrderPackage`, `OrderAddOn`, `OrderPackageItemUpgrade`, `OrderPackageSessionConfigurationSelection`, `FinancialCase`, `Invoice`, `AdjustmentWorkspace`.
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts` - `captureCurrentOrderComposition` as the current row-backed composition capture reference.
- `src/modules/orders/composition/` - canonical composition read model and projector shape.
- `tests/adjustment-workspace/finalize-integration.test.ts` and `tests/orders/order-composition-view-model.test.ts` - existing operational-row and composition regression patterns.
- `tests/backend-invariants/run.ts` and `scripts/run-centralization-tests.ts` - where broader regression gates are wired.

## Rules

- Phase 1 is foundation only. Do not change `/orders/[orderId]/sales`, POS action routing, draft staging, commit preview, financial document emission, payment behavior, or employee-facing UI copy.
- Public names introduced in this phase must use `OrderCommit`. Do not add public services, DTOs, tests, logs, or specs with Adjustment Workspace naming.
- `Order*` rows are the only operational ownership source. Snapshot capture must not reconstruct package identity, add-on ownership, selected-photo ownership, package-item upgrades, session-configuration ownership, or linked-product ownership from `InvoiceLineItem`.
- Invoice rows may be read only to determine whether an order has an existing financial commitment that needs a bootstrap snapshot. Invoice line rows are not snapshot inputs.
- `OrderCommit.snapshotJson` is immutable once written. Correct mistakes by adding a later commit in future phases, not by mutating an existing snapshot row.
- Use highest `sequence` per order as the latest committed snapshot in Phase 1. Do not add a partial unique latest-row index unless explicitly approved in a later review gate.
- Backfill can be simple because there is no real production financial history yet, but it must be idempotent, transactional where practical, and test-covered so the pattern is safe for future environments.
- Existing open Adjustment Workspaces remain untouched. Phase 1 does not migrate or finalize them.
- Keep this unit additive. No destructive schema changes and no broad refactor of composition or invoice services.

## Scope

### In Scope

- Add `OrderCommit` to Prisma with:
  - `id`
  - `orderId`
  - `financialCaseId`
  - `previousCommitId`
  - `sequence`
  - `kind`
  - `status`
  - `snapshotVersion`
  - `snapshotJson`
  - `metadataJson`
  - `committedAt`
  - `committedByUserId`
  - `createdAt`
  - `updatedAt`
  - nullable `legacyAdjustmentWorkspaceId`
- Add supporting Prisma relations from `Order`, `FinancialCase`, `User`, and optionally `AdjustmentWorkspace` if needed for the nullable legacy pointer.
- Add constraints and indexes:
  - unique `[orderId, sequence]`
  - index `orderId`
  - index `financialCaseId`
  - index `previousCommitId`
  - index `committedAt`
  - index `legacyAdjustmentWorkspaceId` if the field is included as an FK.
- Add enum or constant-backed values for commit kind and status using `OrderCommit` terminology. Phase 1 needs at least a bootstrap/base kind and a committed status, but the naming should leave room for later delta and audit commits.
- Add `src/modules/order-commits/` with service, schema, types, constants, and index files as needed.
- Define a typed `OrderCommitSnapshotV1` shape with:
  - `schemaVersion`
  - `orderId`
  - `financialCaseId`
  - `capturedAt`
  - `currency`
  - `lines`
  - `totals`
- Define snapshot line fields:
  - `lineId`
  - `lineKind`
  - `orderEntityKind`
  - `orderEntityId`
  - `parentOrderPackageId`
  - `catalogEntityId`
  - `stableKey`
  - `label`
  - `quantity`
  - `unitPrice`
  - `lineTotal`
  - `priceSource`
  - `metadata`
- Cover line kinds for package lines, add-on lines, package item upgrades, selected photo extras, session configurations, and linked-product session configuration add-ons.
- Add service helpers:
  - `getLatestCommittedOrderSnapshot({ orderId })`
  - `getLatestCommittedOrderSnapshot({ financialCaseId })`
  - `captureOrderCommitSnapshotFromOrderRows({ orderId })`
  - `createOrderCommitSnapshot({ orderId, kind, actorContext, metadata? })`
  - `bootstrapOrderCommitIfMissing({ orderId, actorContext })`
  - a batch/backfill helper or script that calls the bootstrap helper for financially committed orders.
- Add focused tests for schema shape, snapshot capture, latest lookup, idempotent bootstrap, backfill selection, and invoice-line independence.

### Out of Scope

- No `OrderCommitDraft`.
- No pending snapshot storage.
- No diff engine or commit preview DTO.
- No financial document creation through `OrderCommit`.
- No POS routing changes or server-action rewiring.
- No changes to Adjustment Workspace finalize behavior.
- No changes to invoice totals, payments, allocations, document applications, refunds, or credit notes.
- No customer-facing or staff-facing UI changes.
- No progress-tracker update during this docs-only spec-writing task; implementation should update it after code lands.

## Implementation Direction

Implement Phase 1 as five small tasks. Each task should be independently reviewable and should stop once its acceptance checks pass.

### Task 1 - Schema And Contracts

Add the additive Prisma model first. Put `OrderCommit` near the other order/financial models and map it to `order_commits`. Add relation fields without changing existing model semantics.

Use an enum or constant-backed union for `kind` and `status`. If a Prisma enum is used, keep values intentionally small for Phase 1, such as a bootstrap/base kind and a committed status. If TypeScript constants are used over string columns, validate with Zod before writing. Either path is acceptable, but the choice must be consistent across service code and tests.

Keep `snapshotJson` and `metadataJson` as JSON fields. Default `metadataJson` to an empty object. `snapshotVersion` should be a numeric or string value that makes V1 detection explicit; the TypeScript snapshot type should also carry `schemaVersion`.

`previousCommitId` is nullable for the first commit. Later commits must be able to point at the immediately prior commit, so add the self-relation now even though Phase 1 mostly creates first snapshots.

`committedByUserId` should be nullable for migration/bootstrap work where a real actor is unavailable, but service-created commits should use `actorContext.actorUserId` when present.

### Task 2 - Snapshot Shape From Operational Rows

Create `captureOrderCommitSnapshotFromOrderRows({ orderId })` in `src/modules/order-commits/`. The helper should read current materialized operational rows directly:

- `OrderPackage` for package identity, current package label, current/final package price snapshot, selected photo count, extra digital count, extra print count, session type, sort order, and booking package lineage.
- `OrderAddOn` for add-on ownership, product identity, quantity, label snapshot, price snapshot, and optional owning order package.
- `OrderPackageItemUpgrade` for package item upgrade ownership, package item identity, owning order package, quantity, label snapshot, and price snapshot.
- `OrderPackageSessionConfigurationSelection` for session-configuration ownership, selected option/numeric/text value, financial behavior, price delta snapshot, linked product id, and linked `OrderAddOn` id.
- Extra photo pricing from the same service-layer pricing source currently used by composition/invoice capture, but store the captured unit price into the snapshot so future catalog changes cannot alter this baseline.

The implementation may reuse concepts from `captureCurrentOrderComposition`, but the new `OrderCommit` snapshot type should be explicit about persisted baseline identity. Do not store UI-only projector fields as the primary contract.

Line identity should be stable and explainable:

- Package line stable key should include the `OrderPackage` id.
- Add-on line stable key should include the `OrderAddOn` id.
- Package item upgrade line stable key should include the `OrderPackageItemUpgrade` id, with package item metadata in `metadata`.
- Extra photo lines should be scoped to `OrderPackage` id plus media type.
- Session-configuration lines should be scoped to the selection id.
- Linked-product session configuration add-ons should preserve both the selection id and linked `OrderAddOn` id when both exist.

Totals should be raw numeric money values, not formatted strings. Use the same rounding/decimal discipline as existing service-layer financial code and normalize JSON output so tests can assert exact values.

### Task 3 - Latest Lookup And Commit Creation

`getLatestCommittedOrderSnapshot` should support lookup by `orderId` or `financialCaseId`, sort by highest `sequence`, and return a typed parsed snapshot plus row metadata. It should not infer latest state from invoices.

`createOrderCommitSnapshot` should run in a transaction. It should:

- Resolve the order and its `FinancialCase`.
- Load the current latest commit for that order under the same transaction.
- Assign `sequence = latest.sequence + 1`, or `1` when no commit exists.
- Set `previousCommitId` to the latest commit id, or null for the first commit.
- Capture the snapshot from current `Order*` rows inside the transaction.
- Write the `OrderCommit` row with `status = committed`.
- Return the newly created row and parsed snapshot.

Use retry handling consistent with nearby service modules when unique sequence races are possible. Phase 1 does not need full pessimistic locking, but it must not silently create duplicate sequence rows.

`bootstrapOrderCommitIfMissing` should be idempotent. If any `OrderCommit` already exists for the order, return it and do not create another. If none exists, create sequence `1` with bootstrap metadata.

### Task 4 - Simple Idempotent Backfill

Add a simple implementation-time backfill path for existing orders that already have financial commitments. This can be either a one-off script under `scripts/` or a service helper with an explicit script wrapper; prefer the shape that is easiest to test and re-run.

The selector should treat an order as needing bootstrap when:

- it has at least one `FINAL`, `ADJUSTMENT`, `CREDIT_NOTE`, or `REFUND` invoice; or
- it has a locked `FINAL` invoice; or
- it otherwise has an existing financial commitment explicitly identified by the implementation after reading current data.

Use invoices only for selection. The captured snapshot must still come from `Order*` rows.

Backfill idempotency requirements:

- Running it a second time creates zero additional commits for already-bootstrapped orders.
- It skips orders with an existing `OrderCommit`, regardless of how that commit was created.
- It records enough metadata to identify the run source, such as reason `phase_1_bootstrap`, but does not require audit-log backfill.
- It reports counts for scanned, created, skipped-existing, skipped-no-financial-commitment, and failed rows.

Because there is no real production financial history yet, do not overbuild a production-grade migration framework in this phase. Keep it small, deterministic, and easy to inspect.

### Task 5 - Tests And Regression Guards

Add focused tests under `tests/order-commits/` and wire them into the smallest relevant existing test runner.

Required service tests:

- Latest lookup returns the highest sequence for an order.
- Latest lookup by financial case returns the same latest snapshot as lookup by order.
- First create writes sequence `1`, no previous commit, status committed, and a V1 snapshot.
- Second create writes sequence `2` and points `previousCommitId` to sequence `1`.
- `bootstrapOrderCommitIfMissing` is idempotent.
- Backfill creates commits only for financially committed orders and creates none on a second run.

Required snapshot tests:

- Package identity and label come from `OrderPackage.currentPackageId` and `currentPackageNameSnapshot`, not invoice lines.
- Add-on ownership comes from `OrderAddOn`, including scoped add-ons tied to an `OrderPackage`.
- Package item upgrade ownership comes from `OrderPackageItemUpgrade`.
- Selected photo and extra photo truth comes from `OrderPackage.selectedPhotoCount`, `extraDigitalCount`, and `extraPrintCount`.
- Session-configuration ownership comes from `OrderPackageSessionConfigurationSelection`.
- Linked-product session configuration add-on lines preserve the relationship between the selection and `OrderAddOn`.
- Creating or editing synthetic invoice-line test fixtures does not alter a newly captured operational snapshot unless the underlying `Order*` rows changed.
- Changing catalog package, product, package item, or extra-photo prices after snapshot creation does not mutate the already stored snapshot.

Required static or source guard:

- No `src/modules/order-commits/**` snapshot capture helper reads from `invoiceLineItem`.
- No new public `src/modules/order-commits/**` export uses Adjustment Workspace naming.
- No `app/**` or `src/components/**` DB imports are introduced.

## Observability Checklist

### Dashboards / Metrics

- No production dashboard is required in Phase 1.
- The backfill script/helper should print or return structured counts for scanned, created, skipped-existing, skipped-no-financial-commitment, and failed rows.
- If a discrepancy is found while resolving order to financial case, fail loudly with the order id and do not create a partial commit.

### Rollback Plan

- Schema rollback drops `order_commits` and any new `OrderCommit` enum values if the database permits enum rollback cleanly.
- If enum rollback is awkward in PostgreSQL, document the limitation in the migration comments and prefer string columns plus TypeScript/Zod constants for Phase 1.
- Data rollback for Phase 1 is deleting generated `order_commits` rows. No existing invoice, payment, order, or Adjustment Workspace rows should be mutated.
- A bad backfill can be corrected by deleting generated bootstrap commits and rerunning after the snapshot helper is fixed, because no later phase consumes the rows yet.

### Customer-Visible Surface

- None. Staff should see no UI, route, copy, payment, invoice, or POS behavior change after Phase 1.

## Post-Implementation

- Update `context/progress-tracker.md` Now / Key State and Feature History after code lands.
- Update `context/target-data-model.md` to document `OrderCommit` as the persisted committed operational baseline.
- If schema or read-layer ownership language changes beyond the existing roadmap text, update `context/architecture-context.md` narrowly.
- Leave `context/reviews/unified-order-commit-live-pos-roadmap.md` unchanged unless implementation discovers approved-roadmap drift.

## Acceptance Criteria

- `OrderCommit` exists in Prisma with the specified fields, relations, unique constraint, and indexes.
- `src/modules/order-commits/` exposes only public `OrderCommit` terminology.
- `OrderCommit.snapshotJson` is versioned, typed in TypeScript, and stores raw structured money/identity fields.
- `captureOrderCommitSnapshotFromOrderRows` captures package, add-on, item-upgrade, selected-photo, extra-photo, session-configuration, and linked-product ownership from `Order*` rows.
- Snapshot capture does not read `InvoiceLineItem` or infer operational ownership from invoices.
- Existing committed orders can be bootstrapped from current `Order*` rows.
- Bootstrap/backfill is idempotent and covered by tests.
- Latest snapshot lookup returns the highest sequence and works by order id and financial case id.
- Stored snapshots do not change after catalog price edits.
- Invoice line mutations do not affect captured operational snapshots.
- Existing POS UI behavior is unchanged.
- Existing Adjustment Workspace behavior is unchanged.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
