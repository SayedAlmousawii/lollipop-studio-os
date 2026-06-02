## Goal

Add the Phase 3 preview layer for Unified Order Commit by comparing the correct committed/original baseline snapshot against the active `OrderCommitDraft.pendingSnapshotJson`. This phase produces centralized operational diff, approval, and financial document preview DTOs only. It must not execute commits, emit documents, mutate `Order*` rows, or replay `pendingOpsJson` as business truth.

## Read First

- `context/reviews/unified-order-commit-live-pos-roadmap.md` - approved Phase 3 direction and cross-phase architecture rules.
- `context/reviews/unified-order-commit-architecture-plan.md` - Unified Order Commit naming and snapshot boundary semantics.
- `context/feature-specs/120-order-commit-snapshot-foundation.md` - committed snapshot shape and invoice-line independence.
- `context/feature-specs/121-order-commit-draft-foundation.md` - draft lifecycle, pending snapshot replacement, and generic pending operation history.
- `context/feature-specs/122-order-commit-draft-staging-reducers.md` - staging reducer contract and `pendingSnapshotJson` truth boundary.
- `context/target-data-model.md` - current `OrderCommit`, `OrderCommitDraft`, materialized `Order*`, and invoice-line ownership contracts.
- `src/modules/order-commits/` - existing snapshot, draft, staging, reducer, and normalizer surfaces.
- `tests/order-commits/` - current order-commit test and source-guard patterns.

## Rules

- This spec is docs-only until implementation is explicitly requested.
- Public naming must use `OrderCommit` / `OrderCommitDraft`.
- `OrderCommit.snapshotJson` remains committed truth when a committed baseline exists.
- `OrderCommitDraft.pendingSnapshotJson` remains draft truth and the only pending business source for preview.
- `pendingOpsJson` remains audit/history/UX metadata only. It must never be replayed to reconstruct draft state, compute diff, execute commit, or classify financial impact.
- Preview compares baseline snapshot to pending draft snapshot.
- Baseline selection order:
  1. If latest `OrderCommit` exists, baseline is latest `OrderCommit.snapshotJson`.
  2. If no `OrderCommit` exists but original booking/order operational composition exists, baseline is an original booking/order package snapshot.
  3. If no `OrderCommit` exists and no original booking/order operational composition exists, baseline is an explicit empty baseline snapshot.
- Do not default to an empty baseline when original booking/order composition exists. Example: booked package Basic 100 KD and draft package Premium 180 KD must preview as upgrade `+80 KD`, not full Premium `180 KD`.
- Booking-time original composition is package-only. During booking, customers can choose packages only. They cannot choose add-ons, albums, extra photos, package-item upgrades, or session-configuration extras.
- The first-commit original baseline contains only original booked package lines:
  - `selectedPhotoCount = includedPhotoCount`
  - `extraDigitalCount = 0`
  - `extraPrintCount = 0`
  - no add-on lines
  - no package-item-upgrade lines
  - no selected-photo extra lines
  - no session-configuration lines
  - no linked-product add-on lines
- Do not read `InvoiceLineItem` for baseline, ownership, package, add-on, photo, package-item upgrade, session-configuration, linked-product, or current customer ownership truth.
- Do not read current catalog prices for existing committed, original, or already-staged lines. Existing prices come from snapshots.
- Do not add schema changes, POS routing changes, UI changes, commit execution, document emission, payment behavior, refund behavior, or Adjustment Workspace finalization changes.
- Reducer, staging, and preview paths must not mutate `Order`, `OrderPackage`, `OrderAddOn`, `OrderPackageItemUpgrade`, `OrderPackageSessionConfigurationSelection`, invoices, payments, allocations, applications, refunds, credit notes, or Adjustment Workspace rows.
- UI/server actions must consume preview DTOs in later phases and must not recompute deltas, money, ownership, approval, or document planning.

## Scope

### In Scope

- Add Phase 3 preview/diff services under `src/modules/order-commits/`.
- Add typed DTOs/schemas for baseline source, snapshot diffs, preview classification, approval rules, document-plan preview, payment impact, and refund impact.
- Add service-layer helpers:
  - `getOrderCommitPreview({ orderId })`
  - `resolveOrderCommitPreviewBaseline({ orderId })`
  - `diffOrderCommitSnapshots({ baseSnapshot, pendingSnapshot })`
  - `classifyOrderCommitPreview({ diff })`
  - `buildOrderCommitApprovalAndDocumentPreview({ classification, paymentState })`
- Add tests proving baseline fallback order, cumulative baseline comparison, delta classification, net-zero handling, approval/document planning, invoice-line independence, and no mutation.
- Wire Phase 3 tests into the order-commit / centralization regression gate.

### Out of Scope

- No `OrderCommitDocument`.
- No new invoice, credit note, refund, payment, allocation, or application records.
- No `Order*` materialization.
- No draft creation/staging behavior changes.
- No POS server-action rewiring or component consumption.
- No public Adjustment Workspace naming.
- No progress-tracker update during this docs-only spec-writing task; implementation should update it after code lands.

## Implementation Direction

Implement Spec 123 as small tasks. Each task must be independently reviewable and stop after its acceptance checks pass.

### Task 1 - Preview DTOs And Baseline Contracts

Define public preview contracts before service behavior.

The preview DTO should include:

- `baselineSource`: `LATEST_ORDER_COMMIT`, `ORIGINAL_ORDER_COMPOSITION`, or `EMPTY`
- `baselineCommitId`, nullable
- `baselineSequence`, nullable
- `draftId`, `draftVersion`
- `commitKind`
- `lineDiffs`
- `netDelta`
- `requiresApproval`
- `approvalReasons`
- `documentPlan`
- `paymentImpact`
- `refundImpact`
- `zeroNetReason`

Line diffs should be typed around snapshot line identity:

- `stableKey`
- `lineId`
- `lineKind`
- `changeKind`: added, removed, quantity_changed, price_changed, package_changed, metadata_changed, unchanged
- baseline line summary
- pending line summary
- quantity delta
- money delta
- operational classification flags

Document-plan preview values should distinguish:

- base invoice
- adjustment invoice
- credit note
- refund-needed flow
- zero-net audit commit
- no-op

No DTO field should require replaying `pendingOpsJson`.

### Task 2 - First-Commit Baseline Resolver

Add `resolveOrderCommitPreviewBaseline({ orderId })`.

Resolution rules:

- Load latest committed `OrderCommit` by order. If present, return its parsed `snapshotJson` with `baselineSource = LATEST_ORDER_COMMIT`.
- If no commit exists, derive an original booking/order composition baseline from operational order rows using immutable original package metadata and original price snapshots where available.
- The original baseline must represent what the customer originally booked/owned before draft upgrades or swaps, not the current draft target.
- The original baseline is package-only:
  - build one package line per original booked `OrderPackage`
  - use `OrderPackage.originalPackageId` for package id
  - use `OrderPackage.originalPackageNameSnapshot` for package name
  - use `OrderPackage.originalPackagePriceSnapshot` for package price
  - set `selectedPhotoCount` to the resolved original `includedPhotoCount`
  - set `extraDigitalCount = 0`
  - set `extraPrintCount = 0`
  - omit add-ons, selected-photo extras, package-item upgrades, session configurations, and linked-product add-ons even if current operational rows contain them
- Resolve original `includedPhotoCount` from the original package reference when available. This is intentionally catalog-dependent because `OrderPackage` does not yet store an `originalIncludedPhotoCountSnapshot`.
- If original package/order composition cannot be identified, return an explicit empty V1 snapshot with zero totals and `baselineSource = EMPTY`.
- Do not read invoice lines.
- Do not mutate rows.
- Return a V1 snapshot compatible with `diffOrderCommitSnapshots`.

The first-commit baseline resolver is what prevents a Basic 100 KD to Premium 180 KD first preview from being treated as a full 180 KD charge.

### Task 3 - Pure Snapshot Diff Engine

Add `diffOrderCommitSnapshots({ baseSnapshot, pendingSnapshot })` as a pure function.

The diff engine must:

- validate both inputs with `orderCommitSnapshotV1Schema`.
- require matching `orderId`, `financialCaseId`, schema version, and currency.
- compare baseline lines to pending lines by stable snapshot identity, not invoice rows.
- use baseline snapshot prices for existing baseline lines.
- use draft snapshot prices for new staged lines.
- detect added, removed, package swap/upgrade/downgrade, add-on, package-item-upgrade, selected/extra photo, session-configuration, linked-product, and net-zero changes.
- return normalized raw numeric money values, never formatted strings.
- avoid DB access and avoid imports from invoice/payment/refund/Adjustment Workspace mutation services.

Diff assumptions:

- `LATEST_ORDER_COMMIT` baseline means later commits compare against cumulative committed state.
- `ORIGINAL_ORDER_COMPOSITION` baseline means first commit compares against original booking/order ownership, so upgrades produce deltas.
- `EMPTY` baseline is only allowed when no committed or original operational composition exists.
- `pendingOpsJson` cannot affect diff output.

### Task 4 - Preview Classification

Add `classifyOrderCommitPreview({ diff })`.

This task owns operational classification only:

- classify added, removed, and changed lines.
- classify package upgrades, downgrades, and swaps.
- classify add-on changes.
- classify package-item upgrade changes.
- classify selected/extra photo changes.
- classify session-configuration and linked-product changes.
- detect meaningful net-zero changes.
- determine `commitKind`.

It must not decide approval policy, payment impact, refund impact, or document-plan output.

### Task 5 - Approval Rules And Document Plan Preview

Add `buildOrderCommitApprovalAndDocumentPreview({ classification, paymentState })`.

This task owns financial and approval policy:

- compute `requiresApproval`.
- compute `approvalReasons`.
- preview adjustment invoice outcome.
- preview credit-note outcome.
- preview refund-needed outcome.
- preview base invoice outcome.
- preview no-op outcome.
- compute `paymentImpact`.
- compute `refundImpact`.

Classification and document-plan tests must be independent so operational change detection can be verified without payment/refund policy fixtures.

This is preview only. It must not create invoices, applications, payments, refunds, audit logs, or commits.

### Task 6 - Preview Loader

Add `getOrderCommitPreview({ orderId })` as the service entry point.

It should:

- load the active `OrderCommitDraft` by `orderId`.
- resolve the baseline with `resolveOrderCommitPreviewBaseline({ orderId })`.
- parse the baseline and pending snapshots.
- call the pure diff engine.
- classify operational changes.
- load only payment state needed for approval/document preview through existing financial read/service boundaries.
- build approval and document-plan preview.
- return the typed preview DTO.

This loader must not mutate draft rows, operational rows, financial documents, or Adjustment Workspace rows.

### Task 7 - Regression Guards And Tests

Add focused tests under `tests/order-commits/`.

Required first-commit baseline tests:

- first commit with latest `OrderCommit` uses `OrderCommit.snapshotJson`.
- first commit without `OrderCommit` but with original booking/order package composition uses the original baseline.
- Basic 100 KD original package to Premium 180 KD draft previews as `+80 KD`.
- booked Basic package with 10 included photos to Premium with 20 included photos compares the package price delta correctly.
- first-commit original baseline package metadata has `selectedPhotoCount` equal to the original included photo count.
- first-commit original baseline does not infer add-ons, selected-photo extras, session configurations, linked-product add-ons, or package-item upgrades from current operational rows.
- first commit uses empty baseline only when no committed or original operational composition exists.
- original-baseline derivation does not read invoice lines.
- catalog price changes do not change original or committed baseline comparison.

Required diff/classification tests:

- active `OrderCommitDraft.pendingSnapshotJson` is the pending source, not `pendingOpsJson`.
- changing `pendingOpsJson` without changing `pendingSnapshotJson` does not change preview.
- later additive commit previews only the delta.
- downgrade compares against cumulative latest `OrderCommit`, not latest invoice.
- package swap, add-on, package-item-upgrade, photo, session-configuration, and linked-product diffs classify correctly.
- net-zero meaningful changes classify as audit/zero-net operational changes, not fake charges.

Required approval/document-plan tests:

- positive delta previews adjustment invoice for later commits.
- first/base delta previews base invoice behavior according to baseline source.
- reduction previews credit-note or refund-needed outcome based on payment state.
- no-op preview has no financial document plan.
- approval reasons are produced by policy, not by the pure diff engine.

Required source/isolation guards:

- preview services do not mutate draft, operational, invoice, payment, allocation, application, credit-note, refund, or Adjustment Workspace rows.
- source guards reject `invoiceLineItem` usage and forbidden mutation-service imports in Phase 3 preview/diff files.
- no `app/**` or `src/components/**` DB imports are introduced.

## Observability Checklist

### Dashboards / Metrics

- No production dashboard is required.
- Validation errors should include `orderId`, baseline source, draft id/version when available, and classification type. Do not expose raw Prisma errors to users.

### Rollback Plan

- No schema rollback is expected.
- Code rollback removes the preview/diff/classification/document-plan services, contracts, and tests.
- No data repair should be required because Phase 3 is read-only.

### Customer-Visible Surface

- None. Staff should see no route, copy, payment, invoice, POS control, or Adjustment Workspace behavior change after Spec 123 implementation.

## Post-Implementation

- Update `context/progress-tracker.md` after code lands.
- Update `context/target-data-model.md` with Phase 3 preview semantics:
  - committed truth is `OrderCommit.snapshotJson`.
  - draft truth is `OrderCommitDraft.pendingSnapshotJson`.
  - first-commit baseline uses package-only original booking/order operational composition when no commit exists.
  - empty baseline is only a fallback when no committed or original composition exists.
  - `pendingOpsJson` remains history-only.
- Leave roadmap docs unchanged unless implementation discovers approved-roadmap drift.

## Future Follow-Up

- Consider adding `originalIncludedPhotoCountSnapshot` to `OrderPackage` or capturing a booking-time composition snapshot so first-commit original baselines do not depend on mutable package catalog data.

## Acceptance Criteria

- `getOrderCommitPreview`, `resolveOrderCommitPreviewBaseline`, `diffOrderCommitSnapshots`, `classifyOrderCommitPreview`, and `buildOrderCommitApprovalAndDocumentPreview` exist under `src/modules/order-commits/`.
- Preview baseline selection follows the three-step rule: latest commit, original booking/order composition, then empty baseline.
- Basic 100 KD original booking package to Premium 180 KD draft previews as upgrade `+80 KD`, not full Premium `180 KD`.
- First-commit original baseline includes only original booked package lines.
- First-commit original baseline uses original package id/name/price from `OrderPackage` original package fields.
- First-commit original baseline sets `selectedPhotoCount` equal to original included photos and extra digital/print counts to zero.
- First-commit original baseline omits add-ons, package-item upgrades, selected-photo extras, session configurations, and linked-product add-ons.
- Original included-photo count resolution is documented as catalog-dependent until a durable original included-photo snapshot exists.
- Preview compares baseline snapshot to active draft snapshot.
- `pendingOpsJson` is not replayed or treated as business truth.
- No invoice line items are used for ownership, baseline, or diff reconstruction.
- No Phase 3 path mutates `Order*`, draft staging, invoices, payments, allocations, applications, credit notes, refunds, or Adjustment Workspace rows.
- Pure diff owns snapshot comparison only.
- Preview classification owns operational change detection and `commitKind`.
- Approval/document-plan preview owns approval requirements, approval reasons, document plan, payment impact, and refund impact.
- No page or component computes deltas, money, ownership, approval rules, or financial document plans.
- New tests are wired into `test:centralization`.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run test:financial-invariants` passes if touched financial classification boundaries require it.
- `npm run build` passes.
- `npm run lint` passes.

## Assumptions And Defaults

- Name this as Spec 123 to follow completed Specs 120, 121, and 122.
- Keep Phase 3 service-only with no schema or UI changes.
- Treat `pendingOpsJson` as useful display/history metadata only, never as reconstructable state.
- If existing financial classifiers are reused, wrap them behind OrderCommit preview APIs so public consumers still depend on `OrderCommit` terminology.
