# Target Data Model

Current schema-facing notes for implementation work. This document records non-obvious data-shape contracts; `prisma/schema.prisma` remains the executable source of truth.

## Order Commit Baseline

`OrderCommit` is the persisted committed operational baseline for Unified Order Commit. Each row stores a versioned `snapshotJson` captured from current materialized `Order*` rows, with `sequence` ordered per order and the highest sequence representing the latest committed baseline.

`OrderCommit` is additive in Phase 1. It does not change POS routing, invoice emission, payment behavior, or Adjustment Workspace finalization. Invoices remain immutable financial documents; invoice line items are not an operational ownership source for `OrderCommit` snapshots.

## Order Commit Draft Boundary

`OrderCommitDraft` is the additive pending snapshot boundary for Unified Order Commit. V1 allows one active draft per `Order`, stores `pendingSnapshotJson` as the same V1 `OrderCommit` snapshot contract, and stores `pendingOpsJson` as generic history metadata only.

Spec 121 Task 1 does not add lifecycle helpers, POS routing, invoice/payment behavior, or domain-specific staging reducers. Draft rows are schema/contract foundation only until later Phase 2 tasks wire creation, mutation, and commit behavior.

## Adjustment Workspace Materialization

`AdjustmentWorkspace` is a staging and audit boundary for post-lock order changes. Its `baseSnapshotJson` and `pendingChangesJson` support preview/proposal workflows, while `operationalStateAppliedAt` is retained as an idempotency and debugging marker for finalize-time operational materialization.

Finalized workspace edits that change the operational order are materialized into their owning rows:

- Package swaps update `OrderPackage.currentPackageId`, `currentPackageNameSnapshot`, `finalPackagePriceSnapshot`, and related package-line photo fields while preserving `originalPackageId` / `originalPackageNameSnapshot`.
- Add-on edits create, update, or delete `OrderAddOn` rows.
- Package-item upgrade edits create, update, or delete `OrderPackageItemUpgrade` rows.
- Selected-photo and extra-photo edits update `OrderPackage.selectedPhotoCount`, `extraDigitalCount`, and `extraPrintCount`, then resync the `Order.selectedPhotoCount` cache.
- Session-configuration edits update `OrderPackageSessionConfigurationSelection` rows and, for linked products, the related `OrderAddOn` row.

`InvoiceLineItem` rows on `FINAL`, `ADJUSTMENT`, `CREDIT_NOTE`, and `REFUND` invoices are financial-document snapshots only. They preserve what was charged, credited, or refunded, but they are not a source for current operational composition. Locked composition projections read current `Order*` rows through the composition read layer.
