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

## Phase Status (revised 2026-06-02)

- Phase 1 — **Complete** (Spec 120, OrderCommit snapshot foundation).
- Phase 2 — **Complete** (Spec 121, OrderCommitDraft foundation).
- Phase 2.5 / Staging reducers — **Complete** (Spec 122).
- Phase 3 — **Complete** (Spec 123, preview/diff engine).
- Phase 4 — **Complete** (Spec 124, commit execution).
- Phase 5 — **Revised below**: unified Sales page over OrderCommit for both locked and unlocked orders.
- Phase 6 — **Revised below**: Adjustment Workspace retirement after parity checks.
- Phase 7 — **Revised below**: polish, redesign, history, and takeover.

The original Phase 5 ("POS routing through OrderCommit services") assumed the locked-invoice workflow would remain in Adjustment Workspace. Capability review against shipped Specs 120–124 confirms that assumption is outdated — `commitOrderChanges` already handles locked-invoice ADJ / CREDIT_NOTE / refund-needed routing. Phase 5 now unifies both states under OrderCommit. See "Assumptions Changed" at the end of this document.

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
- Adjustment Workspace remains as **frozen legacy** through Phase 5 and is deleted in Phase 6. No new code calls it.
- No new public service, DTO, route, prop, copy, or employee-facing UI should expose Adjustment Workspace naming.

### Canonical Sources (single source of truth per concern)

- Current ownership → `Order*` rows / composition projection
- Pending ownership → `OrderCommitDraft.pendingSnapshotJson`
- Commit consequences (deltas, approval, refund-needed, document plan) → `OrderCommitPreview`
- Financial state (invoices, payments, balances) → `FinancialCaseSummary`

### Projector Rule

UI helpers introduced in Phase 5+ are **display/projector helpers only**. They map, label, and format. They MUST NOT recompute:

- financial deltas
- approval rules
- refund-needed state
- document plans
- invoice / credit-note routing
- ownership truth
- workflow state

Any logic in those categories belongs in `src/modules/order-commits/` or its peer financial modules — not in `app/`, `src/components/`, or projector files.

## Review Gates

Review before implementation:

- Phase 5 service-action shape and projector boundary, before draft staging is wired into the Sales page.
- Phase 5 parity-test plan (AW finalize vs `commitOrderChanges` on identical input proposals), before AW retirement is approved.
- Phase 6 deletion plan, after parity tests pass.

## Phase Dependencies

- Phases 1–4 are complete and prerequisite for Phase 5.
- Phase 5 depends on Specs 120–124 being shipped and stable.
- Phase 6 depends on Phase 5 parity tests proving AW finalize and `commitOrderChanges` produce equivalent financial outcomes.
- Phase 7 depends on Phase 6 retirement landing cleanly.

---

## Phase 1 - OrderCommit Snapshot Foundation

**Status: Complete — shipped as Spec 120.** Section retained for historical reference.

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

**Status: Complete — shipped as Spec 121.** Section retained for historical reference.

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

## Spec 122 - OrderCommitDraft Staging Reducers

**Status: Complete — shipped as Spec 122.** Section retained for historical reference.

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

**Status: Complete — shipped as Spec 123.** Section retained for historical reference.

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

**Status: Complete — shipped as Spec 124.** Section retained for historical reference.

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

## Phase 5 - Unified Sales Page Over OrderCommit

**Status: Planned. Specs 125–12N to be drafted.**

### Objective

Make `/orders/[orderId]/sales` the single continuous sales workflow — current composition → stage changes → preview impact → commit — backed by OrderCommit for **both locked and unlocked orders**. Adjustment Workspace remains in the codebase as frozen legacy until Phase 6.

### Scope

- One unified Sales page driving the draft → preview → commit pipeline for every order, regardless of invoice lock state.
- Lazy draft creation on first stage action (not on page load).
- Display-only `SalesPageView` view-model assembled in an RSC loader, composed from canonical sources:
  - current ownership: `Order*` composition projection
  - pending ownership: `OrderCommitDraft.pendingSnapshotJson`
  - commit consequences: `OrderCommitPreview`
  - financial state: `FinancialCaseSummary`
- Display-only projectors:
  - composition-from-snapshot (maps `OrderCommitSnapshotV1.lines[]` into existing `POSPackage` / `POSAddOn` shapes)
  - staged-changes (formats `preview.lineDiffs` into right-rail rows)
  - financial-preview (binds `preview.totals` and `preview.documentPlan` to sidebar fields)
- Single server-action wrapper `stageSalesChangeAction(orderId, change, expectedVersion)` replacing the five legacy direct-mutator actions on the Sales page (`updateOrderPackageAction`, `upgradeOrderPackageItemAction`, `addOrderProductAddOnAction`, `removeOrderAddOnAction`, `updateOrderSelectedPhotoCountAction`).
- New actions: `commitSalesChangesAction(orderId, expectedDraftVersion, approvalActorUserId?)` and `discardSalesDraftAction(orderId, expectedVersion)`.
- Approval flow driven by `preview.requiresApproval` and `preview.approvalReasons`, surfaced in the Review & commit confirmation dialog. Manager-actor selection reuses the existing `PendingCreditNoteApprovalError` UI pattern.
- Co-editor banner powered by `draft.ownerUserId`, `draft.lastTouchedByUserId`, and `draft.updatedAt`. Non-owner-non-manager actors see stage controls disabled.
- Legacy direct-mutator guard: when an `OrderCommitDraft` exists for an order, the underlying service functions (`updateOrderPackage`, `addOrderProductAddOn`, etc.) refuse to execute. AW finalize is exempted as the only remaining legitimate caller until Phase 6.
- Maximum reuse of existing components: `POSPackageComposition`, `POSAddOnMarketplace`, `CurrentCompositionCard`, package cards, photo-selection cards, add-on marketplace, approval dialog scaffolding, permission/actor plumbing.
- Folded financial sidebar: `FinancialSidebarDraft` and `FinancialSidebarLocked` collapse into a single `FinancialSidebar` reading `FinancialCaseSummary` + (optionally) `preview.totals`.
- Parity tests: identical input proposals applied via AW `finalizeAdjustmentWorkspace` vs `commitOrderChanges` must produce equivalent `Invoice` rows, `Order.refundPending` state, and `OrderCommitDocument` linkage outcomes.

### Out Of Scope

- No visual redesign or layout overhaul (deferred to Phase 7).
- No AW deletion (deferred to Phase 6).
- No new financial behavior — Phase 5 is a routing and projection change only.
- No typed `pendingOpsJson` operation kinds (deferred to Phase 7 if needed).
- No takeover action (deferred to Phase 7 if needed).
- No order-timeline / history surface (deferred to Phase 7).

### Files Likely Affected

- `app/orders/[orderId]/sales/page.tsx`
- `app/orders/[orderId]/sales/actions.ts`
- `src/components/orders/financial-sidebar-*.tsx` (fold into one)
- new: `src/modules/order-commits/projections/sales-page-view.projector.ts`
- new: `src/modules/order-commits/projections/staged-changes.projector.ts`
- new: `src/modules/order-commits/projections/composition-from-snapshot.projector.ts`
- `src/modules/orders/composition/*` (consumed by projectors; not modified semantically)
- `src/modules/orders/order.service.ts` (add draft-presence guard at direct-mutator entry points)
- targeted Sales-page and projector tests

### Schema Impact

None.

### Service-Layer Impact

- No new domain logic. All behavior comes from existing OrderCommit services.
- Projectors are pure mappers — no DB writes, no business rules.
- Direct-mutator guard added at service entry, not in projectors.
- Sales-page actions become thin orchestrators of `getOrCreateOrderCommitDraft` + `stageOrderCommitDraftChange` / `commitOrderChanges` / `discardOrderCommitDraft`.

### UI Impact

- Single Sales page for all order states.
- Center composition surface is editable; renders current ownership when no draft, projected ownership when draft exists. Component shape is unchanged.
- Right rail renders staged-changes panel + folded financial sidebar.
- Footer hosts Save draft (no-op or `replaceOrderCommitDraftSnapshot`) and Review & commit (opens confirmation dialog).
- Review & commit dialog: renders preview diff summary, document plan, approval requirement; on confirm calls `commitSalesChangesAction`.
- Co-editor banner appears when current viewer is not the draft owner.
- No new mental model. No employee-facing Adjustment Workspace copy or route.

### Migration / Backfill Impact

- No data migration in Phase 5.
- Any existing open `AdjustmentWorkspace` rows remain reachable only via the legacy AW route (frozen, no new code paths).
- Dev environments reset between specs; production has no order data per [[project_dev_data_reset]].

### Tests / Invariants

- Projector purity: projectors do not call services, do not mutate, do not compute deltas.
- Loader correctness: `SalesPageView` populates `composition` from the right canonical source based on draft presence.
- Lazy draft creation: page load does not create a draft.
- Stage / commit / discard happy paths.
- Approval-required path: dialog requires manager-actor selection; commit rejects without it.
- Concurrency: two-actor scenario produces co-editor banner; non-owner-non-manager stage attempts are rejected.
- Legacy direct-mutator guard: when a draft exists, legacy service functions refuse non-AW-finalize callers.
- Parity (with AW finalize) on the locked-invoice path: ADJ / CREDIT_NOTE / refund-needed outcomes are equivalent.
- No UI surface recomputes financial, approval, refund, document-plan, ownership, or workflow state.

### Acceptance Criteria

- `/orders/[orderId]/sales` is the single Sales workspace for locked and unlocked orders.
- Every staged change goes through `OrderCommitDraft`; every commit goes through `commitOrderChanges`.
- All financial / approval / refund / document-plan / ownership values shown to the user come from canonical sources (`Order*`, `OrderCommitDraft.pendingSnapshotJson`, `OrderCommitPreview`, `FinancialCaseSummary`).
- No new projector or component recomputes any of those values.
- AW finalize is the only legacy caller of legacy direct-mutator service functions.
- Parity tests against AW finalize pass.
- `npm run test:centralization` passes.
- `npm run test:backend-invariants` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

### Rollback Risks

- Parity drift between AW finalize and `commitOrderChanges` on edge cases (voucher-forfeit, partial credit capacity, multi-document emission). Parity tests are the defense.
- Projector temptation: a projector quietly recomputing a delta. Review gate: reject any projector that performs arithmetic on financial fields.
- Eager draft creation: must remain lazy or page loads will pollute orders with orphan drafts.
- Co-editor confusion: insufficient banner clarity → users stage on top of each other. Disable stage controls for non-owners as primary defense.

### Recommended Codex Model Level

Codex GPT-5.5 High.

---

## Phase 6 - Adjustment Workspace Retirement

**Status: Planned. Begins after Phase 5 parity tests pass.**

### Objective

Delete Adjustment Workspace. After Phase 5, AW has zero live callers from the Sales page; Phase 6 removes the module, its tables, and its public route once parity is proven and no other surface depends on it.

### Scope

- Migrate or freeze any remaining open `AdjustmentWorkspace` rows. Dev environments reset; production data is empty per [[project_dev_data_reset]].
- Delete `src/modules/adjustment-workspace/**` including:
  - workspace lifecycle service
  - per-domain materializers (package tier, add-on, item upgrade, photo count, session config)
  - `createWorkspaceAdjustmentInvoice` (the workspace-specific invoice emitter)
  - `getOpenWorkspaceForInvoice`
- Delete the legacy direct-mutator service functions if no callers remain (`updateOrderPackage`, `upgradeOrderPackageItem`, `addOrderProductAddOn`, `removeOrderAddOn`, `updateOrderSelectedPhotoCount`) — these stay live in Phase 5 only because AW finalize calls them.
- Replace the Phase 5 draft-presence guard with the sole gate: all mutation flows go through `OrderCommitDraft` staging.
- Remove `assertDirectPOSMutationAllowed`'s `LOCKED_INVOICE_WORKSPACE_REQUIRED` branch.
- Delete `app/orders/[orderId]/adjustment-workspace/` if it still exists.
- Drop `AdjustmentWorkspace` and `AdjustmentWorkspaceEvent` tables.
- Delete `tests/adjustment-workspace/**`.
- Confirm `createAdjustmentInvoiceWithClient` and `createCreditNoteWithClient` (shared financial primitives) remain in place — they are not AW-specific.

### Out Of Scope

- No new business behavior.
- No UI redesign.
- No replacement for AW's typed event history (deferred to Phase 7 if needed).

### Files Likely Affected

- `src/modules/adjustment-workspace/**` (deleted)
- `tests/adjustment-workspace/**` (deleted)
- `app/orders/[orderId]/adjustment-workspace/**` (deleted if present)
- `src/modules/orders/order.service.ts` (legacy mutator guard becomes unconditional draft guard, or mutators removed)
- `src/modules/orders/policies/edit-mode-policy.ts` (lock-state branching removed)
- `prisma/schema.prisma` (drop AW tables)
- `src/components/orders/financial-sidebar-locked.tsx` (deleted; folded in Phase 5)

### Schema Impact

- Drop `AdjustmentWorkspace`.
- Drop `AdjustmentWorkspaceEvent`.
- Verify no foreign keys point at these tables before drop.

### Service-Layer Impact

- AW module deleted.
- All locked-invoice and unlocked-invoice flows go through `commitOrderChanges` exclusively.

### UI Impact

- No employee-facing AW route or copy anywhere.
- Source guards (lint rule or grep test) block re-introduction of AW naming in `app/` and `src/components/`.

### Migration / Backfill Impact

- Verify zero open `AdjustmentWorkspace` rows in any environment that retains data.
- Preserve historical financial documents — they are not AW-owned and remain valid.
- `OrderCommitDocument` is the forward-going link between commits and emitted documents.

### Tests / Invariants

- Repo-level grep test: no `AdjustmentWorkspace` import in `app/`, `src/components/`, or `src/modules/order-commits/`.
- All centralization, backend-invariant, and financial-invariant suites pass without AW.
- No regression in locked-invoice flow on Sales page.

### Acceptance Criteria

- AW module, tables, route, and tests are deleted.
- Legacy direct-mutator service functions are deleted (or have no callers).
- All Sales page flows route through `commitOrderChanges`.
- `npm run test:centralization` passes.
- `npm run test:backend-invariants` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

### Rollback Risks

- Deletion is destructive. Rollback requires restoring schema + module from git history; immutable financial documents already emitted remain valid because they don't reference AW.
- Mitigate by landing Phase 6 only after Phase 5 has been in production for an agreed bake period (or, given dev-only data, after parity tests prove equivalence).

### Recommended Codex Model Level

Codex GPT-5.5 High.

---

## Phase 7 - Polish, Redesign, History, Takeover

**Status: Planned. Sequenced after Phase 6.**

### Objective

Layer UX polish and optional capabilities onto the unified Sales workflow once AW is gone. Items in this phase are independent and may ship in any order or be deferred.

### Scope

Independent workstreams, prioritize per business need:

1. **Visual redesign / layout overhaul** of the Sales page, informed by the target mockup. Composition surface, staged-changes rail, financial sidebar, footer adjustment-mode treatment.
2. **Typed `pendingOpsJson` operation kinds** (e.g. `PACKAGE_UPGRADED`, `ADDON_ADDED`, `PHOTO_COUNT_CHANGED`) for richer staff-facing history. Replaces the current generic `SNAPSHOT_REPLACED` / `NOTE_APPENDED` ops. Audit-only; not used for state reconstruction (per Spec 124 invariant).
3. **`takeOverOrderCommitDraft` action** for explicit manager handoff (parity with the removed `takeOverWorkspace`).
4. **Order timeline / commit history** surface backed by `OrderCommit` sequence + `OrderCommitDocument` joins. Read-only.
5. **"Save draft" semantics**: either confirm it's a label-only no-op (drafts are persisted on every stage) or wire it to `replaceOrderCommitDraftSnapshot` for explicit checkpoints. Decide and document.
6. **Optimistic UI on stage** if latency becomes a UX issue.

### Out Of Scope

- Any change to canonical sources or projector rules.
- Any financial behavior change.
- Any reintroduction of AW.

### Files Likely Affected

- Sales page and components
- `src/modules/order-commits/order-commit-draft.service.ts` (typed ops, takeover)
- New: timeline component + projector

### Schema Impact

- Optional: extend `pendingOpsJson` type union.
- Optional: no schema changes required for takeover (just owner reassignment).

### Service-Layer Impact

- Additive only.
- Projector rule still applies: new helpers are display-only.

### UI Impact

- Visual redesign per mockup.
- Timeline view.
- Optional optimistic UI.

### Migration / Backfill Impact

- None if typed ops are forward-only.
- Backfill of typed ops for existing drafts not required (audit-only field).

### Tests / Invariants

- Typed ops do not feed state reconstruction.
- Takeover requires manager role.
- Timeline is read-only and consumes canonical sources only.

### Acceptance Criteria

- Each workstream ships independently with its own acceptance.
- Canonical-source and projector rules unchanged.
- `npm run build` and `npm run lint` pass.

### Rollback Risks

- Low — additive polish.
- Visual redesign carries normal UX-regression risk; gate behind design review.

### Recommended Codex Model Level

- Codex GPT-5.5 Medium for individual polish items.
- Codex GPT-5.5 High for redesign and timeline.

---

## Assumptions Changed From The Old Roadmap

Captured here so future readers understand why Phases 5–7 were rewritten.

1. **"AW handles locked orders, OrderCommit handles unlocked orders" → false.** Capability review of shipped Specs 120–124 confirms `commitOrderChanges` already handles locked-invoice ADJ / CREDIT_NOTE / refund-needed routing, including reversal of prior open ADJ lines and credit-capacity exhaustion. The lock-state split exists in routing, not in capability.
2. **"Phase 5 is service-layer routing only; UI integration is Phase 6" → folded.** With the target mockup defining the workflow (current → stage → preview → commit) and the backend already supporting both order states, Phase 5 now owns both service rewiring and the projector-only UI integration. Visual redesign remains a Phase 7 concern.
3. **"AW retirement is the final phase" → moved earlier.** Old Phase 7. New Phase 6. AW has no remaining capability advantage; keeping it past Phase 5 only invites parity drift.
4. **"Drafts may be lazily adapted from open `AdjustmentWorkspace` rows" → dropped.** Dev environments reset between specs and production has no order data, so adapter complexity is not justified.
5. **"`pendingOpsJson` may eventually drive UX history" → deferred and re-scoped.** Spec 124 fixed `pendingOpsJson` as audit-only; it must not be replayed for state. Typed ops in Phase 7 are for display, not reconstruction.
6. **"UI integration deferred until redesigned POS mockup is reviewed" → mockup is now in hand for workflow purposes.** The mockup is treated as workflow architecture (not visual design) for Phase 5; visual redesign stays deferred to Phase 7.
7. **"Existing pre-commit direct-write behavior may be preserved where required during migration" → tightened.** Phase 5 disables direct mutators on the Sales page entirely. AW finalize is the only allowed remaining caller, and only until Phase 6 deletes both.
8. **New canonical-source contract added.** The roadmap now names the four canonical sources (Order\*, pendingSnapshotJson, OrderCommitPreview, FinancialCaseSummary) and an explicit projector rule forbidding UI recomputation of financial deltas, approval, refund-needed, document plans, invoice routing, ownership, or workflow state.

---

## Recommended Phase 5 Spec Breakdown

Phase 5 splits cleanly along seams that can each land as its own PR. Recommended ordering — earlier specs unblock later ones.

### Spec 125 — Sales page view-model and projector foundation

- New: `SalesPageView` type and RSC loader composing `Order*` projection, `OrderCommitDraft`, `OrderCommitPreview`, `FinancialCaseSummary`, permissions.
- New projectors (display-only): composition-from-snapshot, staged-changes, financial-preview.
- No UI rewiring yet — projectors are exported but unused.
- Projector purity tests.
- Establishes the canonical-source / projector boundary for the rest of Phase 5.

### Spec 126 — Sales staging actions over OrderCommitDraft

- New: `stageSalesChangeAction(orderId, change, expectedVersion)` wrapping `getOrCreateOrderCommitDraft` + `stageOrderCommitDraftChange`.
- New: `discardSalesDraftAction(orderId, expectedVersion)`.
- Replaces the five legacy direct-mutator actions on the Sales page.
- Legacy direct-mutator guard at the service layer (AW finalize exempted).
- Lazy draft creation invariant test.

### Spec 127 — Sales commit action and Review & commit dialog

- New: `commitSalesChangesAction(orderId, expectedDraftVersion, approvalActorUserId?)` calling `commitOrderChanges`.
- Review & commit confirmation dialog: renders preview diff, `documentPlan`, approval requirement; reuses existing manager-actor selection.
- Error mapping for `OrderCommitStaleDraftError`, `OrderCommitConcurrentCommitError`, `OrderCommitApprovalRequiredError`, `OrderCommitCreditCapacityExhaustedError`.
- `revalidatePath` after success.

### Spec 128 — Sales page composition surface wired to projected ownership

- Wires `POSPackageComposition`, `POSAddOnMarketplace`, photo-selection cards to consume `SalesPageView.composition` regardless of source (current `Order*` or projected from `pendingSnapshotJson`).
- Folds `FinancialSidebarDraft` and `FinancialSidebarLocked` into a single `FinancialSidebar` reading `FinancialCaseSummary` + `preview.totals` when draft exists.
- Staged-changes panel renders from staged-changes projector output.
- Adjustment-mode visual cue (per mockup) driven by draft presence.

### Spec 129 — Co-editor concurrency and ownership UX

- Co-editor banner from `draft.ownerUserId` / `lastTouchedByUserId` / `updatedAt`.
- Stage controls disabled for non-owner-non-manager actors.
- Concurrent commit and stale-draft error handling end-to-end.
- Two-actor integration tests.

### Spec 130 — Locked-invoice path unification and parity tests

- Removes the locked-invoice branch from the Sales page (no more `getOpenWorkspaceForInvoice` on the Sales surface).
- Sales page drives locked orders through the same draft → preview → commit pipeline.
- Parity tests: identical input proposals on AW finalize vs `commitOrderChanges` produce equivalent `Invoice` rows, `Order.refundPending`, document linkage.
- Gates Phase 6 approval.

### Optional Spec 131 — "Save draft" semantics decision

- Either confirm Save draft is a label-only no-op (drafts persist on every stage) or wire it to `replaceOrderCommitDraftSnapshot` for explicit checkpoints.
- Lightweight; may collapse into Spec 128 if decided early.

---

## Phase 5 Design Notes

Inter-spec judgment calls that are too small for their own spec section but load-bearing for drafting Specs 126–131 consistently. Pinned here so future drafting sessions don't drift.

### Mockup interpretation

- The target Sales-page mockup is treated as **workflow architecture and information architecture**, not visual design.
- Visual redesign (layout overhaul, styling, polish) is deferred to Phase 7.
- Phase 5 must maximize reuse of existing components: `POSPackageComposition`, `POSAddOnMarketplace`, `CurrentCompositionCard`, package cards, photo-selection cards, add-on marketplace, approval dialog scaffolding, permission / actor plumbing.

### Draft lifecycle

- **Lazy creation only.** Page load must not create an `OrderCommitDraft`. First stage action calls `getOrCreateOrderCommitDraft` + `stageOrderCommitDraftChange` in the same server action.
- **Single draft per order.** Concurrency is via `OrderCommitDraft.version` + the existing `committedFromDraftVersion` DB constraint from Spec 124.
- **Discard paths:** explicit `discardSalesDraftAction` (Spec 126); implicit on commit success (`commitOrderChanges` deletes the draft per Spec 124).

### `stageSalesChangeAction` shape (Spec 126)

- Single thin wrapper replacing the five legacy direct-mutator actions on the Sales page.
- Body: `getOrCreateOrderCommitDraft({ orderId, actorContext })` → `stageOrderCommitDraftChange({ orderId, change, expectedVersion, actorContext })` → `revalidatePath`.
- No business logic in the action — it is an orchestrator only.

### Legacy direct-mutator guard (Spec 126, safety rail)

- Lands in Spec 126 **before** any UI rewiring in Spec 128.
- Guard sits at the service entry of `updateOrderPackage`, `upgradeOrderPackageItem`, `addOrderProductAddOn`, `removeOrderAddOn`, `updateOrderSelectedPhotoCount`.
- When an `OrderCommitDraft` exists for the order, the guard refuses execution.
- Sole exemption: calls made from `finalizeAdjustmentWorkspace` (AW finalize). The exemption is removed when AW is deleted in Phase 6.
- Rationale: prevents any code path from bypassing the staged workflow once a draft exists.

### Commit-confirmation dialog (Spec 127)

- Trigger: Review & commit button in the footer.
- Renders preview diff summary, `preview.documentPlan`, `preview.requiresApproval`, `preview.approvalReasons`.
- Reuses the existing `PendingCreditNoteApprovalError` manager-actor selection pattern.
- Confirms → `commitSalesChangesAction(orderId, expectedDraftVersion, approvalActorUserId?)` → `commitOrderChanges`.

### OrderCommit error classes the UI must map (Spec 127)

UI surfaces — toast or in-dialog error — for each of these. UI does not decide the message content; it maps the error to a copy key.

- `OrderCommitStaleDraftError` — "Draft changed since you opened it. Refresh to see the latest."
- `OrderCommitConcurrentCommitError` — "Another commit just landed. Refresh and try again."
- `OrderCommitApprovalRequiredError` — re-open the dialog with the approval-actor field highlighted.
- `OrderCommitCreditCapacityExhaustedError` — surface the refund-needed explanation from `preview.documentPlan`.

### Co-editor concurrency (Spec 129)

- Banner sources: `draft.ownerUserId`, `draft.lastTouchedByUserId`, `draft.updatedAt`.
- Non-owner-non-manager actors: stage controls disabled at the UI layer; server-side guard inside `stageOrderCommitDraftChange` is the authoritative defense.
- No takeover action in Phase 5. Takeover, if needed, ships in Phase 7.

### "Save draft" semantics (open question)

- Drafts are already persisted on every stage. A button labeled "Save draft" therefore has no inherent server work to do.
- Two acceptable resolutions:
  1. Label-only no-op (reassurance UI), or
  2. Wire to `replaceOrderCommitDraftSnapshot` for an explicit checkpoint.
- Decide and document during Spec 128. May collapse into optional Spec 131 if deferred.

### Locked-invoice unification (Spec 130)

- Phase 5 removes the locked-invoice branch from the Sales page. There is no `getOpenWorkspaceForInvoice` call from the Sales surface after Spec 130.
- Both lock states drive the same draft → preview → commit pipeline.
- Spec 130 includes the **parity test suite**: identical input proposals applied via AW `finalizeAdjustmentWorkspace` vs `commitOrderChanges` must produce equivalent `Invoice` rows, `Order.refundPending` state, and `OrderCommitDocument` linkage outcomes. These tests gate Phase 6 approval.

### Implementation cadence

- Specs are drafted and merged one at a time. Each spec's design depends on what the previous one actually shipped.
- Each spec implements all its tasks on a single `spec/<NN>-<slug>` branch cut from `development`. One PR per spec, not per task.
- Acceptance criteria are spec-level gates, not task-level.
- Update `context/progress-tracker.md` inside the implementing PR, not as a follow-up.

### What stays out of Phase 5 (re-stated for clarity)

- Visual redesign — Phase 7.
- Typed `pendingOpsJson` operation kinds — Phase 7 if needed.
- `takeOverOrderCommitDraft` — Phase 7 if needed.
- Order timeline / commit-history surface — Phase 7.
- AW deletion — Phase 6.
- Any new financial / approval / refund / document-plan behavior — none in Phase 5.

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
