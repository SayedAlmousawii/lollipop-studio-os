# Unified Order Commit + Unified Live POS Roadmap

## Summary

Replace the employee-facing Adjustment Workspace mental model with a unified live POS workflow where staff always edits the order from `/orders/[orderId]/sales`, while immutable financial documents are emitted only when order changes are committed.

This roadmap is intentionally split into separate phases and separate PRs. Do not combine phases into one implementation PR.

## Source Context

- `context/reviews/unified-live-pos-architecture-brainstorm.md`
- `context/reviews/unified-order-commit-architecture-plan.md`
- `context/architecture-context.md`
- `context/code-standards.md`
- `context/target-data-model.md`
- Repo investigation findings for current Adjustment Workspace, POS, invoice delta, and composition behavior.

## Cross-Phase Architecture Rules

- Public target name: `OrderCommit`, never `AdjustmentWorkspace`.
- Staff works from `/orders/[orderId]/sales`.
- `Order*` rows remain current operational truth.
- Invoices are immutable financial outputs only.
- Invoices must not reconstruct package, add-on, photo, session-configuration, or current customer ownership.
- Latest committed baseline comes from `OrderCommit.snapshotJson`.
- Pending draft truth comes from `OrderCommitDraft.pendingSnapshotJson`.
- `pendingOpsJson` may be retained for audit, history, and UX, but commit diffing compares snapshot to snapshot.
- `OrderCommitDocument` links commits to emitted financial documents.
- Adjustment Workspace may be reused internally only as a temporary adapter.
- No new public service, DTO, route, prop, copy, or employee-facing UI should expose Adjustment Workspace naming.
- UI components must not recompute ownership, deltas, approval rules, payment impact, or financial documents.

## Review Gates

Review before implementation:

- Phase 1 schema and snapshot shape.
- Phase 3 financial diff and approval model.
- Phase 4 commit execution and document emission.
- Phase 6 UI design details, after the redesigned POS mockup is reviewed.

## Phase Dependencies

- Phase 1 is prerequisite for all later work.
- Phase 2 depends on Phase 1 latest snapshot helpers.
- Phase 3 depends on Phase 1 snapshots and Phase 2 drafts.
- Phase 4 depends on Phase 3 preview correctness.
- Phase 5 depends on Phase 4 commit execution.
- Phase 6 depends on Phase 5 service routing and the reviewed POS mockup.
- Phase 7 depends on parity from Phases 5 and 6.

---

## Phase 1 - OrderCommit Snapshot Foundation

### Objective

Create the persisted committed operational baseline without changing POS behavior.

### Scope

- Add `OrderCommit`.
- Define versioned committed snapshot shape.
- Create latest-commit lookup helpers.
- Create snapshot-from-`Order*` helpers.
- Bootstrap first committed snapshots where needed.
- Add tests proving snapshots use `Order*` rows, not invoice lines.
- Do not change POS UI behavior yet.

### Out Of Scope

- No POS routing changes.
- No draft staging changes.
- No financial document emission changes.
- No employee-facing UI or terminology changes.

### Files Likely Affected

- `prisma/schema.prisma`
- New `src/modules/order-commits/*`
- `src/modules/orders/composition/*`
- `tests/order-commits/*`
- Targeted financial or backend invariant tests as needed.

### Schema Impact

Add `OrderCommit` with fields:

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
- optional `legacyAdjustmentWorkspaceId`

Recommended constraints:

- `@@unique([orderId, sequence])`
- index `orderId`
- index `financialCaseId`
- index `previousCommitId`
- index `committedAt`

Use highest `sequence` as the latest committed snapshot. Do not require a partial unique latest-row index in the first phase unless the implementation team explicitly approves raw SQL for it.

### Snapshot JSON V1

`OrderCommit.snapshotJson` should be versioned and self-contained enough to compare future drafts without reading invoice lines.

Recommended shape:

- `schemaVersion`
- `orderId`
- `financialCaseId`
- `capturedAt`
- `currency`
- `lines[]`
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
- `totals`
  - `subtotal`
  - `discountTotal`
  - `netTotal`

Line kinds should cover:

- package line
- add-on line
- package item upgrade
- selected photo extra
- session configuration
- linked-product session configuration add-on

### Service-Layer Impact

Create `src/modules/order-commits/` with public OrderCommit naming.

Recommended helpers:

- `getLatestCommittedOrderSnapshot({ orderId })`
- `captureOrderCommitSnapshotFromOrderRows({ orderId })`
- `createOrderCommitSnapshot({ orderId, kind, actorContext })`
- `bootstrapOrderCommitIfMissing({ orderId, actorContext })`

Snapshot capture must read materialized operational rows:

- `OrderPackage`
- `OrderAddOn`
- `OrderPackageItemUpgrade`
- `OrderPackageSessionConfigurationSelection`
- selected-photo and extra-photo fields on `OrderPackage`
- order-level caches only where explicitly documented as synchronized caches

Snapshot capture must not derive package ownership, add-on ownership, selected-photo ownership, or session-configuration ownership from `InvoiceLineItem`.

### UI Impact

None.

### Migration / Backfill Impact

Backfill committed snapshots for orders that already have financial commitments.

Rules:

- Use invoices only to identify whether a financial commitment exists.
- Use `Order*` rows to capture the operational snapshot.
- Link to existing invoice identity later through `OrderCommitDocument` in Phase 4, unless Phase 1 explicitly adds a temporary metadata reference.
- Existing open Adjustment Workspaces remain untouched.
- Backfill must be idempotent.

### Tests / Invariants

Add tests proving:

- latest committed snapshot selection returns the highest sequence.
- package identity comes from `OrderPackage`.
- add-on ownership comes from `OrderAddOn`.
- selected-photo truth comes from `OrderPackage`.
- session-configuration ownership comes from selection rows.
- invoice line mutations do not alter captured operational snapshots.
- catalog price changes do not alter already captured committed snapshots.

### Acceptance Criteria

- `OrderCommit` records can be created and queried.
- Existing committed orders can be bootstrapped.
- Snapshot creation is covered by tests.
- Tests fail if snapshot composition is reconstructed from invoice line items.
- No POS UI behavior changes.
- `npm run build` passes.
- `npm run lint` passes.

### Rollback Risks

- Schema is additive and relatively low-risk.
- Backfill rollback requires deleting generated `OrderCommit` rows.
- Primary risk is incorrect bootstrap. Keep bootstrap idempotent and covered by focused tests.

### Recommended Codex Model Level

Codex GPT-5.5 High.

---

## Phase 2 - OrderCommitDraft Pending Snapshot Foundation

### Objective

Introduce the pending draft boundary that will eventually replace public Adjustment Workspace staging.

### Scope

- Add `OrderCommitDraft`.
- Define one active pending draft per order or financial case.
- Store `pendingSnapshotJson` and `pendingOpsJson`.
- Add version, owner, and concurrency fields.
- Add helpers to create, update, and discard drafts.
- Reuse Adjustment Workspace logic only behind an internal adapter if needed.
- Add tests proving draft snapshot updates do not rely on invoice lines.

### Out Of Scope

- No commit execution.
- No financial document emission.
- No employee-facing UI redesign.
- No public Adjustment Workspace naming in new APIs.

### Files Likely Affected

- `prisma/schema.prisma`
- `src/modules/order-commits/order-commit-draft.service.ts`
- `src/modules/order-commits/order-commit-draft.types.ts`
- `src/modules/order-commits/order-commit-draft.schema.ts`
- private adapter around `src/modules/adjustment-workspace/adjustment-workspace.service.ts`, if needed
- `tests/order-commits/*`

### Schema Impact

Add `OrderCommitDraft` with fields:

- `id`
- `orderId`
- `financialCaseId`
- `baseCommitId`
- `pendingSnapshotVersion`
- `pendingSnapshotJson`
- `pendingOpsJson`
- `version`
- `ownerUserId`
- `openedByUserId`
- `lastTouchedByUserId`
- `createdAt`
- `updatedAt`
- optional `legacyAdjustmentWorkspaceId`

Recommended constraints:

- `@@unique([orderId])` for one active draft per order.
- index `financialCaseId`
- index `baseCommitId`
- index `ownerUserId`

If future multi-financial-case orders become real, adjust the uniqueness to the agreed financial boundary. For current implementation, use the order as the active draft boundary unless repo schema review shows a stronger FinancialCase boundary is required.

### Service-Layer Impact

Recommended helpers:

- `getOrCreateOrderCommitDraft({ orderId, actorContext })`
- `getOrderCommitDraft({ orderId })`
- `stageOrderCommitDraftChange({ orderId, change, expectedVersion, actorContext })`
- `replaceOrderCommitDraftSnapshot({ orderId, pendingSnapshotJson, expectedVersion, actorContext })`
- `discardOrderCommitDraft({ orderId, expectedVersion, actorContext })`

Staging behavior:

- Drafts start from current operational composition or latest committed snapshot depending on whether this is first commit or post-commit staging.
- New catalog items use current catalog price at staging time.
- Once staged, the price is locked into `pendingSnapshotJson`.
- Existing committed lines retain their committed snapshot price in draft comparisons.
- `pendingOpsJson` stores the staff action history but is not the commit diff source.

### UI Impact

None required yet.

Existing UI behavior may continue through current services while draft APIs are introduced behind the scenes.

### Migration / Backfill Impact

- No broad backfill.
- Existing open Adjustment Workspaces may be lazily adapted into `OrderCommitDraft` later.
- Do not force conversion of open workspaces unless needed for targeted tests.

### Tests / Invariants

Add tests proving:

- one active draft exists per order.
- draft creation uses latest `OrderCommit` as baseline after commit.
- draft snapshot updates do not read invoice lines.
- newly staged item prices are locked in the pending snapshot.
- stale `expectedVersion` writes are rejected.
- owner/takeover behavior is preserved or explicitly blocked pending future support.
- draft discard removes pending state without mutating `Order*` rows.

### Acceptance Criteria

- `OrderCommitDraft` exists and stores pending snapshot truth.
- `pendingOpsJson` is audit and UX history only.
- No public service, DTO, route, or test name exposes Adjustment Workspace concepts.
- Tests cover invoice-line independence.
- `npm run build` passes.
- `npm run lint` passes.

### Rollback Risks

- Schema is additive.
- Draft rows can be discarded if routing has not moved yet.
- Main risk is drift between draft snapshot and base commit. Mitigate with `baseCommitId`, version checks, and recomputation guards.

### Recommended Codex Model Level

Codex GPT-5.5 High.

---

## Spec 122 - OrderCommitDraft Staging Reducers (Deferred)

### Purpose

Document the next planned phase after the OrderCommitDraft foundation so the architecture direction is not lost.

### Future Scope

- add-on staging reducers
- package item upgrade reducers
- package tier change reducers
- selected/extra photo reducers
- session configuration reducers
- catalog price resolution and locking for newly staged items
- pending snapshot recomputation from staged operations
- reducer architecture and operation typing
- tests proving pending snapshots update correctly without invoice-line ownership reconstruction

Detailed design is intentionally deferred until Spec 121 implementation is complete. The final reducer architecture should be based on the actual OrderCommitDraft foundation, lifecycle helpers, concurrency model, and pending operation structure that emerge from Spec 121.

---

## Phase 3 - Commit Preview And Diff Engine

### Objective

Centralize financial and operational diffing by comparing latest committed snapshot to pending draft snapshot.

### Scope

Implement centralized snapshot-to-snapshot diff:

- latest `OrderCommit.snapshotJson`
- versus `OrderCommitDraft.pendingSnapshotJson`

Detect:

- additive changes
- reductions
- package swaps
- package upgrades
- package downgrades
- selected-photo changes
- package item upgrade changes
- add-on changes
- session configuration changes
- net-zero changes

Use:

- locked snapshot prices for existing committed lines.
- catalog prices only for newly staged items at staging time.
- typed preview DTOs for all UI and service consumers.

### Out Of Scope

- No commit execution.
- No invoice, credit note, or refund record creation.
- No POS UI redesign.
- No direct component calculations.

### Files Likely Affected

- `src/modules/order-commits/order-commit-preview.service.ts`
- `src/modules/order-commits/order-commit-diff.service.ts`
- `src/modules/order-commits/order-commit.types.ts`
- `src/modules/order-commits/order-commit.schema.ts`
- `src/modules/financial/edit-classifier.ts`, only if adapter reuse is required
- `src/modules/orders/order.delta.ts`, likely to be bypassed or prepared for replacement
- targeted tests under `tests/order-commits/*` and `tests/financial/*`

### Schema Impact

None expected.

### Service-Layer Impact

Add:

- `getOrderCommitPreview({ orderId })`
- `diffOrderCommitSnapshots({ baseSnapshot, pendingSnapshot })`
- `classifyOrderCommitPreview({ diff, paymentState })`

Preview DTO should include:

- `commitKind`
- `requiresApproval`
- `approvalReasons`
- `documentPlan`
- `lineDiffs`
- `netDelta`
- `paymentImpact`
- `refundImpact`
- `zeroNetReason`
- `baselineCommitId`
- `draftId`
- `draftVersion`

Document plan should distinguish:

- first/base invoice
- adjustment invoice
- credit note
- refund-needed flow
- zero-net audit commit
- no-op

Rules:

- Existing committed lines compare using stored committed snapshot prices.
- New lines compare using prices already locked into draft snapshot.
- Diff should not read invoice lines as operational baseline.
- Diff should not read current catalog prices for existing committed lines.
- UI and server actions consume the preview DTO; they do not recompute.

### UI Impact

None required yet.

Future UI must consume the preview DTO instead of calculating money or approval rules.

### Migration / Backfill Impact

None.

### Tests / Invariants

Add tests for:

- first commit previews a full/base invoice.
- later additive commit previews only the delta.
- downgrade compares against cumulative latest `OrderCommit`, not latest invoice.
- catalog price changes do not affect committed-line comparison.
- newly staged prices are used from draft snapshot.
- net-zero swap creates an audit commit preview, not fake charge.
- selected-photo deltas use snapshot counts and prices.
- package item upgrade changes classify correctly.
- session configuration changes classify correctly.
- invoice-line baseline code is not called for preview.

### Acceptance Criteria

- One service owns upgrade and downgrade detection.
- One service owns cumulative baseline comparison.
- One service owns net-zero detection.
- One service owns approval requirement calculation.
- One service owns financial document preview.
- No page or component computes deltas, money, ownership, or approval rules.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

### Rollback Risks

- No data mutation risk.
- High correctness risk because this phase defines future financial behavior.
- Require review before Phase 4 implementation.

### Recommended Codex Model Level

Codex GPT-5.5 High or XHigh.

---

## Phase 4 - Commit Execution And Financial Document Emission

### Objective

Make order changes financially durable through an atomic commit transaction.

### Scope

Add commit action/service that atomically:

- validates permissions and approval.
- recomputes preview from persisted snapshots.
- materializes approved pending state into `Order*` rows where needed.
- persists a new `OrderCommit`.
- links emitted invoices, credits, refund-needed records, or audit-only outcomes through `OrderCommitDocument`.
- writes audit and activity records.
- clears or closes the draft.

Locked invoices must never mutate.

### Out Of Scope

- No large POS redesign.
- No employee-facing layout overhaul.
- No deletion of legacy Adjustment Workspace route yet.

### Files Likely Affected

- `prisma/schema.prisma`
- `src/modules/order-commits/order-commit-execution.service.ts`
- `src/modules/order-commits/order-commit-document.service.ts`
- `src/modules/order-commits/order-commit.types.ts`
- `src/modules/invoices/invoice.service.ts`
- `src/modules/refunds/*`
- `src/modules/audit/*`
- private materialization adapter around Adjustment Workspace logic, if needed
- targeted financial and backend invariant tests

### Schema Impact

Add `OrderCommitDocument` with fields:

- `id`
- `orderCommitId`
- `invoiceId`
- `role`
- `createdAt`

Recommended roles:

- `BASE_INVOICE`
- `ADJUSTMENT_INVOICE`
- `CREDIT_NOTE`
- `REFUND_RECORD`
- `AUDIT_ONLY`

Recommended constraints:

- index `orderCommitId`
- index `invoiceId`
- unique relation where the same document should not be linked twice to the same commit.

### Service-Layer Impact

Add:

- `commitOrderChanges({ orderId, expectedDraftVersion, approval, actorContext })`

Transaction order:

1. Lock order, draft, and latest commit.
2. Recompute preview from persisted snapshots.
3. Validate permissions and approval.
4. Materialize pending snapshot into `Order*` rows.
5. Emit immutable financial documents according to the preview document plan.
6. Create the new `OrderCommit`.
7. Create `OrderCommitDocument` links.
8. Write audit and activity logs.
9. Clear or close the draft.

Rules:

- Locked invoices are never mutated.
- First commit creates full/base invoice.
- Later positive commit creates adjustment invoice.
- Reduction creates credit note or refund-needed flow according to payment state.
- Zero-net commit persists audit/snapshot commit without fabricated financial delta.
- Operational ownership after commit is visible from `Order*` rows.

### UI Impact

Minimal action-level plumbing only.

Existing visible workflow can remain until Phase 5 and Phase 6.

### Migration / Backfill Impact

- Existing `OrderCommit` rows from Phase 1 remain valid.
- Existing financial documents are not rewritten.
- New `OrderCommitDocument` links are created for new commits going forward.
- Optional backfill of document links for bootstrapped commits can be done only if safe and explicitly scoped.

### Tests / Invariants

Add tests for:

- first commit creates base/final invoice and first `OrderCommit`.
- later additive commit creates adjustment invoice.
- approved reduction creates credit note or refund-needed outcome.
- zero-net commit creates audit commit with no fake invoice delta.
- locked invoice frozen fields remain unchanged.
- failed commit rolls back draft, `Order*`, documents, and audit writes.
- financial documents link through `OrderCommitDocument`.
- current order ownership remains from materialized `Order*` rows after commit.

### Acceptance Criteria

- Commit is atomic.
- `Order*` rows reflect committed operational ownership after success.
- `OrderCommit.snapshotJson` matches materialized committed ownership.
- Financial documents are linked through `OrderCommitDocument`.
- No invoice line is used as operational ownership truth.
- Locked invoices remain immutable.
- `npm run test:backend-invariants` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

### Rollback Risks

- Highest financial risk phase.
- Rollback after live commits is not simple because immutable financial documents may have been emitted.
- Keep routing disabled or feature-gated until Phase 5 is approved.
- If a bad commit is emitted, use compensating financial documents instead of mutating locked documents.

### Recommended Codex Model Level

Codex GPT-5.5 High or XHigh.

---

## Phase 5 - POS Routing Through OrderCommit Services

### Objective

Route `/orders/[orderId]/sales` staging, preview, and commit behavior through OrderCommit services while preserving current staff workflows.

### Scope

- Route sales staging actions through `OrderCommitDraft`.
- Route sales preview through `OrderCommitPreview`.
- Route commit action through `commitOrderChanges`.
- Keep the same employee workflow where possible.
- Hide Adjustment Workspace behind adapters.
- Preserve existing functionality for packages, add-ons, selected photos, item upgrades, session configuration, and payments.

### Out Of Scope

- No final POS visual redesign.
- No wholesale component rewrite.
- No legacy route deletion yet.

### Files Likely Affected

- `app/orders/[orderId]/sales/page.tsx`
- `app/orders/[orderId]/sales/actions.ts`
- `src/components/orders/*`
- `src/modules/orders/pos-handlers.types.ts`
- `src/modules/orders/policies/edit-mode-policy.ts`
- `src/modules/order-commits/*`
- targeted POS and composition tests

### Schema Impact

None expected.

### Service-Layer Impact

- Replace direct post-commit staging paths with `stageOrderCommitDraftChange`.
- Replace locked Adjustment Workspace routing decisions with OrderCommit state/policy.
- Keep current pre-commit direct-write behavior only where explicitly required during migration.
- Target direction is draft snapshot staging before financial commit.
- Payment actions continue through financial services and FinancialCase projections.

### UI Impact

- Staff stays on `/orders/[orderId]/sales`.
- No new employee-facing Adjustment Workspace links or copy.
- Same POS controls should work before and after commit, subject to service policy.
- UI consumes DTOs and projectors only.
- UI must not compute ownership, deltas, approval rules, or money.

### Migration / Backfill Impact

- Existing open Adjustment Workspaces may need lazy conversion or adapter-backed display.
- Do not destroy legacy workspaces until Phase 7.
- Preserve rollback path to legacy route during migration, but do not expose it as the target workflow.

### Tests / Invariants

Add or update tests proving:

- same package controls work before and after commit.
- same add-on controls work before and after commit.
- selected photo and extra-photo changes stage correctly.
- package item upgrade changes stage correctly.
- session configuration changes stage correctly.
- payments still flow through financial services.
- POS has no public Adjustment Workspace route or copy dependency.
- UI does not compute ownership, deltas, approval, or money.

### Acceptance Criteria

- `/orders/[orderId]/sales` is the single employee sales workspace.
- New public actions and DTOs use OrderCommit naming.
- Existing critical POS flows remain intact.
- Locked invoices remain immutable.
- Adjustment Workspace naming is private adapter-only.
- `npm run test:centralization` passes.
- `npm run test:backend-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

### Rollback Risks

- Workflow risk: staff may lose access to a current edit path if adapter coverage misses a case.
- Keep legacy route available but unlinked until parity is proven.
- Preserve legacy data and adapter logs until Phase 7.

### Recommended Codex Model Level

Codex GPT-5.5 High.

---

## Phase 6 - Unified Live POS UI Integration / Terminology Alignment

### Objective

Align employee-facing UI architecture with Unified Live POS without finalizing layout or component design before the redesigned POS mockup is reviewed.

### Scope

This phase is intentionally high-level for now.

Architectural UI requirements:

- POS must use OrderCommit DTOs and projectors.
- UI must not recompute ownership, deltas, approval rules, or financial impact.
- Adjustment Workspace language should eventually be removed from employee-facing UI.
- Future UI should support current ownership, pending changes, commit preview, balance/payment state, approval outcomes, credit outcomes, and refund-needed outcomes.
- Actual layout, component structure, and visual redesign are deferred until the redesigned POS mockup is reviewed.

### Out Of Scope

- No final UI specs yet.
- No component tree redesign yet.
- No visual polish requirements yet.
- No implementation until the redesigned POS mockup is reviewed.

### Files Likely Affected

- `app/orders/[orderId]/sales/page.tsx`
- `src/components/orders/*`
- `src/modules/order-commits/projections/*`
- `src/modules/financial-cases/projections/*`

### Schema Impact

None expected.

### Service-Layer Impact

- Add or adjust projectors only if required for UI consumption.
- No UI should call low-level diff helpers directly.
- UI consumes preview/state DTOs only.

### UI Impact

Final UI must express:

- current operational ownership.
- pending draft changes.
- commit preview.
- balance and payment state.
- approval-required state.
- refund-needed or credit-note outcomes.
- no Adjustment Workspace mental model.

### Migration / Backfill Impact

None expected.

### Tests / Invariants

Add tests for:

- no employee-facing Adjustment Workspace copy in POS.
- no employee-facing Adjustment Workspace route link in POS.
- components consume DTOs/projectors.
- same controls remain available before and after commit.
- no money or composition calculations in components.

### Acceptance Criteria

- Detailed UI spec remains deferred until mockup review.
- Architecture contract is clear enough for future UI design.
- No page or component owns financial or ownership semantics.
- `npm run test:centralization` passes.
- `npm run build` passes.
- `npm run lint` passes.

### Rollback Risks

- Low if kept to UI/projector alignment.
- Main risk is premature UI decisions before design review.

### Recommended Codex Model Level

- Codex GPT-5.5 Medium for spec refinement.
- Codex GPT-5.5 High for implementation after design approval.

---

## Phase 7 - Legacy Adjustment Workspace Quarantine / Removal

### Objective

Remove or isolate legacy Adjustment Workspace once OrderCommit parity is proven.

### Scope

- Remove or quarantine employee-facing Adjustment Workspace route and contracts.
- Delete temporary adapters when no longer needed.
- Rename remaining tests, docs, logs, and metrics toward OrderCommit where practical.
- Keep explicit legacy compatibility only if required for old data or rollback.

### Out Of Scope

- No new business behavior.
- No financial rule changes.
- No UI redesign.

### Files Likely Affected

- `app/orders/[orderId]/adjustment-workspace/page.tsx`
- `src/modules/adjustment-workspace/*`
- `tests/adjustment-workspace/*`
- `src/components/orders/financial-sidebar-locked.tsx`
- `src/modules/orders/policies/edit-mode-policy.ts`
- docs that still describe Adjustment Workspace as the target employee workflow

### Schema Impact

- Keep legacy tables initially if historical data or rollback needs them.
- Later migration may archive or drop `AdjustmentWorkspace` only after production data review.
- Do not delete historical financial documents.

### Service-Layer Impact

- Remove direct public imports of Adjustment Workspace services.
- Keep private migration readers only if old rows still need display or audit access.
- Ensure all active flows use `order-commits`.
- Quarantine any remaining legacy adapter under explicit legacy naming and ownership.

### UI Impact

- No employee-facing Adjustment Workspace route.
- No employee-facing Adjustment Workspace copy.
- Old workspace links should redirect to sales or an admin-only legacy view if required.

### Migration / Backfill Impact

- Convert or close open legacy workspaces before removal.
- Preserve audit history.
- Define rollback plan before dropping any columns or tables.
- Keep compatibility readers until production data is verified.

### Tests / Invariants

Add tests proving:

- no public UI route depends on Adjustment Workspace.
- no OrderCommit tests import page-level Adjustment Workspace contracts.
- legacy compatibility tests exist only while compatibility code remains.
- source guards block reintroduction of public Adjustment Workspace naming.

### Acceptance Criteria

- Active employee workflow is fully `/orders/[orderId]/sales`.
- All new public surfaces use OrderCommit naming.
- Legacy code is either deleted or explicitly quarantined.
- Historical audit and financial records remain accessible where required.
- `npm run test:centralization` passes.
- `npm run test:backend-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

### Rollback Risks

- Data access risk if old workspaces still need audit review.
- Keep schema and admin-only legacy reader until production confidence is high.
- Do not drop old tables in the same PR that removes employee-facing route dependencies.

### Recommended Codex Model Level

Codex GPT-5.5 High.

---

## Global Acceptance Criteria

- Each phase lands as its own PR.
- `Order*` rows remain current operational truth.
- Invoices are immutable financial outputs only.
- No invoice-line ownership reconstruction remains in active commit logic.
- Latest committed baseline comes from `OrderCommit.snapshotJson`.
- Pending draft truth comes from `OrderCommitDraft.pendingSnapshotJson`.
- Commit diffing is centralized and snapshot-to-snapshot.
- Financial documents are linked by `OrderCommitDocument`.
- Employee-facing UI exposes Unified Live POS, not Adjustment Workspace.
- Financial safety, immutable invoices, operational ownership, auditability, and projection consistency stay above convenience or shortcut migrations.
