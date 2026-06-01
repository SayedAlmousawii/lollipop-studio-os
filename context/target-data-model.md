# Target Data Model

Current schema-facing notes for implementation work. This document records non-obvious data-shape contracts; `prisma/schema.prisma` remains the executable source of truth.

## Order Commit Baseline

`OrderCommit` is the persisted committed operational baseline for Unified Order Commit. Each row stores a versioned `snapshotJson` captured from current materialized `Order*` rows, with `sequence` ordered per order and the highest sequence representing the latest committed baseline.

`OrderCommit` is additive in Phase 1. It does not change POS routing, invoice emission, payment behavior, or Adjustment Workspace finalization. Invoices remain immutable financial documents; invoice line items are not an operational ownership source for `OrderCommit` snapshots.

## Order Commit Draft Boundary

`OrderCommitDraft` is the additive pending snapshot boundary for Unified Order Commit. V1 allows one active draft per `Order`, stores `pendingSnapshotJson` as the same V1 `OrderCommit` snapshot contract, and stores `pendingOpsJson` as generic history metadata only.

Spec 121 Task 2 adds lifecycle helpers that load one active draft by order, initialize a missing draft from the latest `OrderCommit` snapshot or current operational `Order*` rows, and discard drafts with expected-version plus owner/manager mutation checks. Draft lifecycle writes do not change POS routing, invoice/payment behavior, operational ownership rows, or domain-specific staging reducers.

Spec 121 Task 3 adds snapshot replacement for an existing draft. Replacement parses `pendingSnapshotJson` as the V1 `OrderCommit` snapshot contract, requires matching `orderId`, `financialCaseId`, schema version, and currency, increments the draft `version` through an expected-version write, and appends generic `SNAPSHOT_REPLACED` pending-operation history. Replacement does not compute business deltas, read invoice line items, or mutate operational, invoice, payment, allocation, document-application, refund, credit-note, or Adjustment Workspace rows.

Spec 121 Task 4 adds generic pending-operation history mutation. The helper appends a parsed V1 operation or replaces an existing operation with the same operation id, requires expected-version plus owner/manager mutation checks, increments the draft `version`, and updates `lastTouchedByUserId`. It does not change `pendingSnapshotJson`, interpret operations as business reducers, read catalog/order domain rows for diffs, or mutate operational or financial rows.

Spec 122 Task 1 adds typed staging-change contracts for package, add-on, package-item-upgrade, photo-count, and session-configuration draft staging. These contracts are service input commands only. After a stage request succeeds, the replacement `pendingSnapshotJson` remains the durable draft business truth. `pendingOpsJson` keeps generic `SNAPSHOT_REPLACED` / `NOTE_APPENDED` operations; domain staging history is stored as a typed payload on snapshot-replacement history and must not be replayed as the source for commit preview, commit execution, or draft reconstruction.

## Adjustment Workspace Materialization

`AdjustmentWorkspace` is a staging and audit boundary for post-lock order changes. Its `baseSnapshotJson` and `pendingChangesJson` support preview/proposal workflows, while `operationalStateAppliedAt` is retained as an idempotency and debugging marker for finalize-time operational materialization.

Finalized workspace edits that change the operational order are materialized into their owning rows:

- Package swaps update `OrderPackage.currentPackageId`, `currentPackageNameSnapshot`, `finalPackagePriceSnapshot`, and related package-line photo fields while preserving `originalPackageId` / `originalPackageNameSnapshot`.
- Add-on edits create, update, or delete `OrderAddOn` rows.
- Package-item upgrade edits create, update, or delete `OrderPackageItemUpgrade` rows.
- Selected-photo and extra-photo edits update `OrderPackage.selectedPhotoCount`, `extraDigitalCount`, and `extraPrintCount`, then resync the `Order.selectedPhotoCount` cache.
- Session-configuration edits update `OrderPackageSessionConfigurationSelection` rows and, for linked products, the related `OrderAddOn` row.

`InvoiceLineItem` rows on `FINAL`, `ADJUSTMENT`, `CREDIT_NOTE`, and `REFUND` invoices are financial-document snapshots only. They preserve what was charged, credited, or refunded, but they are not a source for current operational composition. Locked composition projections read current `Order*` rows through the composition read layer.
