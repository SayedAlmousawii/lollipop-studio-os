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

## Phase Status (revised 2026-06-04)

- Phase 1 — **Complete** (Spec 120, OrderCommit snapshot foundation).
- Phase 2 — **Complete** (Spec 121, OrderCommitDraft foundation).
- Phase 2.5 / Staging reducers — **Complete** (Spec 122).
- Phase 3 — **Complete** (Spec 123, preview/diff engine).
- Phase 4 — **Complete** (Spec 124, commit execution; Spec 132 emission-routing correction).
- Phase 5 — **Complete** (Specs 125–133 unified the Sales page over OrderCommit for both locked and unlocked orders; Spec 134 was a package-tier photo-normalization follow-up — see below). Phase 5 wired only the `PACKAGE` and `PHOTO` staging domains to the Sales surface.
- Phase 5.5 — **Complete**: full domain staging coverage wired the remaining staging domains (`PACKAGE_ITEM_UPGRADE`, `SESSION_CONFIGURATION`, `ADD_ON`) to the Sales surface and closed the session-configuration draft-bypass. Specs 135–138.
- Phase 6 — **Complete**: Adjustment Workspace route, module, tests, schema tables/enums, and legacy `OrderCommit*` backrefs are removed. Spec 149 completes the phase.
- Post-Phase-6 cleanup — **Complete**: Spec 150 removed the dead inline reductive-edit approval island; Spec 151 deleted the five legacy direct mutators + `assertDirectPOSMutationAllowed` and migrated the financial/audit test scaffolding onto `commitOrderChanges`.
- **OrderCommit chapter closed.** `commitOrderChanges` is the sole production financial-emission path. The legacy direct-edit engine `syncOrderInvoiceForFinancialEdit` has **no production caller** and remains test-only. **Spec 152** (retire that engine + migrate its remaining direct non-mutator test callers) is **deferred** — low urgency, no production exposure; placeholder at `context/feature-specs/152-retire-sync-order-invoice-for-financial-edit-placeholder.md`.
- Phase 7 — **Revised below**: polish, redesign, history, and takeover.

### Spec 134 (already shipped, previously unrecorded here)

- `spec/134-ordercommit-package-photo-normalization` — Normalized package-tier included-photo changes during package staging (raise selected photos to the new included count, default remaining billable extras to print, remove absorbed extra-photo lines, preserve explicit intended photo outcomes, keep extra-photo pricing resolution in staging). A follow-up fix to Spec 122/129 staging, not a Phase 5 breakdown spec. Recorded here because the roadmap numbering had not yet reflected it; **134 is consumed** and the next available sequence is **135**.

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
- Staged UI/action targets must match active `OrderCommit` snapshot line identity. When draft ids materialize into `Order*` rows, remap staged snapshot identities before persisted `OrderCommit.snapshotJson` is written so future drafts do not inherit stale `draft:` targets.
- `OrderCommitDocument` links commits to emitted financial documents.
- Adjustment Workspace is fully retired. New post-lock changes use `OrderCommit` / `OrderCommitDraft` and emitted document links use `OrderCommitDocument`.
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
- Phase 5.5 depends on Phase 5 (the unified Sales surface and staging adapter) being shipped. Specs 135–138 wire the remaining domains to that surface.
- Phase 6 depends on **both** (a) Phase 5 parity tests proving AW finalize and `commitOrderChanges` produce equivalent financial outcomes, and (b) Phase 5.5 completing domain coverage — until session-configuration financial edits and add-on/item-upgrade edits all stage through OrderCommit, AW is still the only path for some workflows and cannot be deleted.
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

**Status: Complete — shipped as Spec 124, with one financial-emission routing correction tracked as Spec 132 (see "Financial emission lifecycle" below).** Section retained for historical reference.

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
- Zero-net commit persists audit/snapshot commit without fabricated financial delta.
- Operational ownership after commit is visible from `Order*` rows.

### Financial emission lifecycle (Spec 124 as shipped + Spec 132 correction)

Spec 124 as originally shipped chose the emission path from whether a prior `OrderCommit` existed: no prior commit → create the base FINAL; any prior commit → adjustment mode, which requires exactly one **locked** FINAL invoice. Manual testing after Spec 129 exposed the gap: the first commit creates a FINAL that correctly stays **unlocked** (locking is a payment/finalization milestone, not a commit milestone), so a second commit on a still-unlocked order falls into adjustment mode and fails with "expected exactly one locked FINAL invoice."

The corrected lifecycle (Spec 132) routes emission by the **FINAL invoice's lock state**, not by the existence of a prior `OrderCommit`. The three modes:

- **CREATE_BASE** — no FINAL invoice exists for the FinancialCase → create the base FINAL invoice. Emits a `BASE_INVOICE` document link.
- **REBUILD_UNLOCKED** — a FINAL exists and is **unlocked** → update/rebuild that same FINAL invoice in place from the materialized `Order*` rows. No ADJUSTMENT, no CREDIT_NOTE, and (by policy) no new `OrderCommitDocument` row, because no new financial document is emitted — only an existing unlocked draft is updated. A reduction simply lowers the unlocked FINAL total.
- **EMIT_ADJUSTMENT** — a FINAL exists and is **locked** → ADJUSTMENT / CREDIT_NOTE / refund-needed emission exactly as implemented today, including prior-open-ADJ reversal and credit-capacity handling.

Financial decision (locked in): the FINAL is **not** locked immediately after the first commit. An unpaid/unlocked FINAL remains editable through repeated commits; only once it is locked (payment-settled or explicitly closed) do later changes become immutable ADJ/CREDIT_NOTE flows.

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

## Phase 5.5 - Full Domain Staging Coverage

**Status: Complete for Sales domain coverage. Specs 135–138 drafted 2026-06-04 from the blocked-workflow investigation (`/tmp/pos-domain-blocked-workflows-investigation.md`); Specs 136–138 now cover package-item upgrade, session-configuration, and order-level add-on staging on the Sales surface. Spec 141 closes display bugs B1/A6 by restoring catalog-current included deliverables in snapshot-derived Sales composition.**

### Objective

Phase 5 unified the Sales page over OrderCommit but wired only two of the five staging domains to it: `PACKAGE` (changePackageTier) and `PHOTO` (changeSelectedPhotoCount). The Sales handler adapter still blocks add-on and package-item-upgrade staging, and session configuration still writes live (bypassing the draft) or deep-links to the Adjustment Workspace. Phase 5.5 completes domain coverage so every Sales-surface edit flows through draft → preview → commit, which is the precondition for retiring AW in Phase 6.

The backend is overwhelmingly already built. All five domains have schema + reducer + staging-service + materializer support (Specs 122–124). The remaining work is UI-contract / adapter wiring, one session-configuration re-route, and one small add-on schema/reducer relaxation. The investigation is the source of truth for scope and classification.

### Approved conclusions (from the investigation)

- Session-configuration live-write bypass is hotfixed first (Spec 135).
- Package-item upgrade/replacement is adapter-only and ships first among the feature specs (Spec 136).
- Session-configuration staging routes through OrderCommit draft/preview/commit and stops bypassing drafts; **financial** selections stage into the draft instead of deep-linking to AW from the Sales surface (Spec 137).
- Marketplace add-ons are historically **order-level**; `OrderAddOn.orderPackageId` exists primarily for linked-product/session-configuration scenarios. Order-level add-on staging must not force package ownership, and linked-product behavior must keep working (Spec 138).

### Spec breakdown and ordering

Numbering is sequential from the next available sequence (135) and matches dependency order.

#### Spec 135 — Session Configuration draft-bypass hotfix

- Adds `assertNoActiveOrderCommitDraft` to `writeOrderPackageSelections`, mirroring the five-mutator guard from Spec 126, so session-configuration writes can no longer bypass an active draft on the Sales surface.
- Minimal safety rail. Reuses the existing guard helper and `OrderCommitDraftActiveError`. No staging, no UI.
- Lands **now / first** — it is independent and closes a live correctness gap. Superseded on the Sales surface by Spec 137's draft routing; remains the rail for non-Sales callers until Phase 6.

#### Spec 136 — Sales package-item upgrade staging (first feature spec)

- Adapter-only: replaces the blocked `upgradePackageItem` stub with a mapping to the existing `PACKAGE_ITEM_UPGRADE` staging domain. The UI event already carries `orderPackageId` + `packageItemId` + `toProductId` + `quantity`; reducer and materializer already exist.
- No schema, no UI-contract change, no shared-table risk. The lowest-risk unblock; validates the domain-completion pattern end-to-end.

#### Spec 137 — Sales session-configuration staging unification (C + E + D)

- Routes operational, financial, and linked-product session-configuration selections through the draft on the Sales surface (one spec; they share `ConfigureSessionPanel` and cannot be UI-split).
- Financial selections stage into the draft; commit emits by FINAL lock state (REBUILD_UNLOCKED / EMIT_ADJUSTMENT). Linked products keep `draftOrderAddOnId` (new) / `orderAddOnId` (materialized) discipline.
- No schema change. Supersedes the Spec 135 refusal on the Sales surface and makes the AW session-configuration deep-link Sales-dead (deletable in Phase 6).

#### Spec 138 — Sales order-level add-on staging (A + quantity)

- **Complete.** Makes `parentPackageTarget` optional in the `ADD_ON` staging change and teaches the reducer to stage order-level add-on lines (`parentOrderPackageId = null`); wires the marketplace `addAddOn` / `removeAddOn` handlers.
- The only spec with a schema + reducer change. Sequenced **after** Spec 137 so linked-product (D) staging lands first and de-risks the shared `OrderAddOn` table. Also closes an existing gap: previously committed order-level add-ons become removable through staging.
- Does not force package-scoped marketplace add-ons; does not migrate existing null-package rows. Newly committed staged add-ons remap draft ids to materialized `OrderAddOn.id` before `OrderCommit.snapshotJson` persistence, and Remove One preserves legacy decrement behavior.

#### Spec 141 — Sales included deliverables display restoration (B1/A6)

- **Complete.** The Sales read loader fetches catalog-current package items for active draft snapshot package ids and locked current compositions, and `toSalesPageComposition` overlays `PACKAGE_ITEM_UPGRADE` rows by `packageItemId`.
- Resolves B1: Basic → Standard → Basic restored drafts show Basic deliverables again without discard. Resolves A6: locked FINAL composition has deliverable rows for the existing Upgrade/Replace cards to attach to.
- Catalog-current limitation is accepted: included deliverable display is not commit-historical; Option B snapshot-embedded deliverables remains deferred.

### Dependencies within Phase 5.5

- 135 is independent (lands first / immediately).
- 136 is independent of 137/138 (adapter-only; may land any time after Phase 5).
- 137 supersedes 135 on the Sales surface; depends on Phase 5's staging action surface.
- 138 depends on 137 (shared `OrderAddOn` table; linked-product staging should land first).

### Out of scope for Phase 5.5

- No AW deletion (Phase 6).
- No visual redesign (Phase 7).
- No new financial behavior — emission routing is the engine's existing lock-state logic.
- No multi-package membership add/remove — intentionally rejected (`OrderCommitUnsupportedPackageMembershipError`).
- No `changeAddOnQuantity` UI control unless trivially added with Spec 138 (no control exists today).

### Phase 6 implications

- Phase 6 can now proceed with domain coverage complete: every Sales-surface domain stages through OrderCommit, and AW has no remaining Sales capability.
- Phase 6 gains additional deletion targets once 137 lands: the AW session-configuration deep-link, `applySessionConfigurationWorkspaceEditAction`, and (once no caller remains) the legacy `configureSessionAction` / `writeOrderPackageSelections` live-write path.
- The Spec 135 hotfix guard on `writeOrderPackageSelections` is removed in Phase 6 alongside the other legacy direct-mutator guards.

### Recommended Codex Model Level

- Spec 135: Codex GPT-5.5 Medium (small, well-bounded).
- Spec 136: Codex GPT-5.5 Medium (adapter-only).
- Spec 137: Codex GPT-5.5 High (multi-workflow routing, linked-product correctness).
- Spec 138: Codex GPT-5.5 High (schema + reducer change on a shared table).

---

## Phase 6 - Adjustment Workspace Retirement

**Status: Complete.** P6-1 shipped as Spec 144, P6-2 as Spec 145, P6-3 as Spec 146, P6-4 as Spec 147, P6-5 as Spec 148, and P6-6 as Spec 149. The retired workspace route, module, tests, schema tables/enums, and `OrderCommit*` legacy schema backrefs are gone.

### Objective

Retire the old post-lock workspace path and leave `OrderCommit` as the only post-lock order-change pipeline.

### Scope

- Specs 144-148 removed route, module, UI, policy, and test references.
- Spec 149 confirmed empty workspace tables, dropped the retired tables/enums, removed the legacy `OrderCommit*` schema backrefs, and regenerated Prisma client types.
- `OrderCommitDraft` staging is the sole gate for Sales-surface post-lock order edits.
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

- Retired workspace tables/enums and the `OrderCommit*` legacy backref columns are removed.

### Service-Layer Impact

- All locked-invoice and unlocked-invoice flows go through `commitOrderChanges` exclusively.

### UI Impact

- No employee-facing AW route or copy anywhere.
- Source guards (lint rule or grep test) block re-introduction of AW naming in `app/` and `src/components/`.

### Migration / Backfill Impact

- Migration guards abort if retired workspace rows exist in any data-retaining environment.
- Preserve historical financial documents — they are not AW-owned and remain valid.
- `OrderCommitDocument` is the forward-going link between commits and emitted documents.

### Tests / Invariants

- Repo-level grep tests block retired workspace imports/naming in active order-commit and UI surfaces.
- All centralization, backend-invariant, and financial-invariant suites pass without AW.
- No regression in locked-invoice flow on Sales page.

### Acceptance Criteria

- Retired workspace module, tables, route, and tests are deleted.
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
9. **"A prior `OrderCommit` means adjustment mode" → false.** Spec 124 as shipped chose the emission path from prior-commit existence, which broke a second commit on a still-unlocked order. Financial emission mode is determined by the **FINAL invoice's lock state**, not by whether a prior `OrderCommit` exists: no FINAL → CREATE_BASE; unlocked FINAL → REBUILD_UNLOCKED (rebuild in place, no ADJ/CREDIT); locked FINAL → EMIT_ADJUSTMENT. Locking stays a payment/finalization milestone — the FINAL is not locked just because a commit happened. Tracked as Spec 132 (see Phase 4 → "Financial emission lifecycle").

---

## Recommended Phase 5 Spec Breakdown

Phase 5 splits cleanly along seams that can each land as its own PR. Recommended ordering — earlier specs unblock later ones. Specs 126 and 127 are independent and may land in either order; both must land before Spec 129.

### Spec 125 — Sales page view-model and projector foundation ✓ shipped

- `SalesPageView` type and RSC loader composing `Order*` projection, `OrderCommitDraft`, `OrderCommitPreview`, `FinancialCaseSummary`, permissions.
- Display-only projectors: composition-from-snapshot, staged-changes, financial-preview.
- No UI rewiring; projectors exported but unused.
- Establishes the canonical-source / projector boundary for the rest of Phase 5.

### Spec 126 — Sales staging actions over OrderCommitDraft

- New: `stageSalesChangeAction(orderId, expectedVersion, change)` wrapping `getOrCreateOrderCommitDraft` + `stageOrderCommitDraftChange`.
- New: `discardSalesDraftAction(orderId, expectedVersion)`.
- Legacy direct-mutator guard at the service layer (AW finalize exempted).
- Lazy draft creation invariant test.
- Independent of Spec 127; may land before or after it.

### Spec 127 — OrderCommitPreview totals amendment

- Adds `preview.totals = { baselineTotal, netDelta, pendingTotal }` to `OrderCommitPreview`.
- Totals computed inside the preview layer from `baselineSnapshot.totals.netTotal` and `pendingSnapshot.totals.netTotal`.
- Sales-page financial-preview projector updated to pass `totals` through to `overlay.{previousTotal, pendingDelta, pendingTotal}` with no arithmetic.
- Top-level `preview.netDelta` retained as back-compat alias; internal consumers unchanged.
- Parity invariant: `preview.totals.netDelta === preview.netDelta`.
- Identified during Spec 125 review as a Spec 129 prerequisite.
- Independent of Spec 126; may land before or after it. Must land before Spec 129.

### Spec 128 — Sales commit action and Review & commit dialog

- New: `commitSalesChangesAction(orderId, expectedDraftVersion, approvalActorUserId?)` calling `commitOrderChanges`.
- Review & commit confirmation dialog: renders preview diff, `documentPlan`, approval requirement; reuses existing manager-actor selection.
- Error mapping for `OrderCommitStaleDraftError`, `OrderCommitConcurrentCommitError`, `OrderCommitApprovalRequiredError`, `OrderCommitCreditCapacityExhaustedError`.
- `revalidatePath` after success.

### Spec 129 — Sales page composition surface wired to projected ownership

- Wires `POSPackageComposition`, `POSAddOnMarketplace`, photo-selection cards to consume `SalesPageView.composition` regardless of source (current `Order*` or projected from `pendingSnapshotJson`).
- Folds `FinancialSidebarDraft` and `FinancialSidebarLocked` into a single `FinancialSidebar` reading `FinancialCaseSummary` + `preview.totals` when draft exists.
- Staged-changes panel renders from staged-changes projector output.
- Adjustment-mode visual cue (per mockup) driven by draft presence.
- Addresses the projected-composition residual gaps surfaced in Spec 125 review (`extraPhotoTotal`, `upgradeDelta`, total internal consistency, `parentLabel` quality, `photographerName`).
- Depends on Spec 127 for the financial sidebar trio.

### Spec 130 — Co-editor concurrency and ownership UX

- Co-editor banner from `draft.ownerUserId` / `lastTouchedByUserId` / `updatedAt`.
- Stage controls disabled for non-owner-non-manager actors.
- Concurrent commit and stale-draft error handling end-to-end.
- Two-actor integration tests.

### Spec 131 — Locked-invoice path unification and parity tests

- Removes the locked-invoice branch from the Sales page (no more `getOpenWorkspaceForInvoice` on the Sales surface).
- Sales page drives locked orders through the same draft → preview → commit pipeline.
- Parity tests: identical input proposals on AW finalize vs `commitOrderChanges` produce equivalent `Invoice` rows, `Order.refundPending`, document linkage.
- Gates Phase 6 approval.
- **Depends on Spec 132.** Unifying locked and unlocked orders under one Sales surface assumes the unlocked-FINAL replay (REBUILD_UNLOCKED) path exists; without it, repeated commits on an unlocked order still fail. Land Spec 132 before (or with) Spec 131.

### Spec 132 — Unlocked-FINAL replay (Spec 124 emission-routing correction)

**Status: Complete.**

- Resolves the Spec 124 financial-emission routing gap found during Spec 129 manual testing.
- Makes commit emission lock-state-aware (CREATE_BASE / REBUILD_UNLOCKED / EMIT_ADJUSTMENT) instead of keying on whether a prior `OrderCommit` exists. See Phase 4 → "Financial emission lifecycle."
- No invoice locking, no schema change, no Sales UI change. Prerequisite/follow-up for Spec 131.

### Optional Spec 133 — "Save draft" semantics decision

- Either confirm Save draft is a label-only no-op (drafts persist on every stage) or wire it to `replaceOrderCommitDraftSnapshot` for explicit checkpoints.
- Lightweight; may collapse into Spec 129 if decided early.
- (Renumbered from the original optional Spec 132 to free that number for the unlocked-FINAL replay correction above.)

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

### Preview totals contract (Spec 127)

- `OrderCommitPreview` exposes `totals: { baselineTotal, netDelta, pendingTotal }`, computed inside the preview layer from `baselineSnapshot.totals.netTotal` and `pendingSnapshot.totals.netTotal`.
- `baselineSource === "EMPTY"` (first commit) → `baselineTotal = 0`.
- Parity invariant enforced at assembly time: `preview.totals.netDelta === preview.netDelta`.
- Top-level `preview.netDelta` retained as back-compat alias for existing internal consumers (financial emission, classification, approval/document preview, execution).
- UI / Sales-page projectors read `preview.totals.*` and pass through. No projector or component may recompute the trio.
- Identified during Spec 125 review as the prerequisite that lets the unified financial sidebar render Previous total / Pending delta / After commit without violating the projector rule.

### `stageSalesChangeAction` shape (Spec 126)

- Single thin wrapper replacing the five legacy direct-mutator actions on the Sales page.
- Body: `getOrCreateOrderCommitDraft({ orderId, actorContext })` → `stageOrderCommitDraftChange({ orderId, change, expectedVersion, actorContext })` → `revalidatePath`.
- No business logic in the action — it is an orchestrator only.

### Legacy direct-mutator guard (Spec 126, safety rail)

- Lands in Spec 126 **before** any UI rewiring in Spec 129.
- Guard sits at the service entry of `updateOrderPackage`, `upgradeOrderPackageItem`, `addOrderProductAddOn`, `removeOrderAddOn`, `updateOrderSelectedPhotoCount`.
- When an `OrderCommitDraft` exists for the order, the guard refuses execution.
- Sole exemption: calls made from `finalizeAdjustmentWorkspace` (AW finalize). The exemption is removed when AW is deleted in Phase 6.
- Rationale: prevents any code path from bypassing the staged workflow once a draft exists.

### Commit-confirmation dialog (Spec 128)

- Trigger: Review & commit button in the footer.
- Renders preview diff summary, `preview.documentPlan`, `preview.requiresApproval`, `preview.approvalReasons`.
- Reuses the existing `PendingCreditNoteApprovalError` manager-actor selection pattern.
- Confirms → `commitSalesChangesAction(orderId, expectedDraftVersion, approvalActorUserId?)` → `commitOrderChanges`.

### OrderCommit error classes the UI must map (Spec 128)

UI surfaces — toast or in-dialog error — for each of these. UI does not decide the message content; it maps the error to a copy key.

- `OrderCommitStaleDraftError` — "Draft changed since you opened it. Refresh to see the latest."
- `OrderCommitConcurrentCommitError` — "Another commit just landed. Refresh and try again."
- `OrderCommitApprovalRequiredError` — re-open the dialog with the approval-actor field highlighted.
- `OrderCommitCreditCapacityExhaustedError` — surface the refund-needed explanation from `preview.documentPlan`.

### Co-editor concurrency (Spec 130)

- Banner sources: `draft.ownerUserId`, `draft.lastTouchedByUserId`, `draft.updatedAt`.
- Non-owner-non-manager actors: stage controls disabled at the UI layer; server-side guard inside `stageOrderCommitDraftChange` is the authoritative defense.
- No takeover action in Phase 5. Takeover, if needed, ships in Phase 7.

### "Save draft" semantics (open question)

- Drafts are already persisted on every stage. A button labeled "Save draft" therefore has no inherent server work to do.
- Two acceptable resolutions:
  1. Label-only no-op (reassurance UI), or
  2. Wire to `replaceOrderCommitDraftSnapshot` for an explicit checkpoint.
- Decide and document during Spec 129. May collapse into optional Spec 133 if deferred.

### Commit financial behavior is invoice-lifecycle-dependent (Spec 124 correction / Spec 132)

- The single Review & Commit action does not map to a single financial outcome. Depending on the FINAL invoice's lifecycle state at commit time, one click may:
  - **create** a FINAL invoice (no FINAL exists yet → CREATE_BASE),
  - **rebuild** an existing unlocked FINAL in place (unlocked FINAL → REBUILD_UNLOCKED, no ADJ/CREDIT), or
  - **emit** an ADJUSTMENT / CREDIT_NOTE / refund-needed document (locked FINAL → EMIT_ADJUSTMENT).
- The same UI affordance therefore produces different financial behavior based on invoice state, not on user intent or which control was used. The UI must remain a projector: it shows the preview the engine computed and never decides the emission mode itself.
- This is the lock-state-aware routing described in Phase 4 → "Financial emission lifecycle." Spec 132 is the implementation of that correction.

### Locked-invoice unification (Spec 131)

- Phase 5 removes the locked-invoice branch from the Sales page. There is no `getOpenWorkspaceForInvoice` call from the Sales surface after Spec 131.
- Spec 131 assumes the unlocked-FINAL replay behavior (REBUILD_UNLOCKED) already exists, so a unified Sales surface can drive an unlocked order through repeated commits without hitting the "expected exactly one locked FINAL invoice" failure. **Spec 132 is a prerequisite/follow-up that resolves the Spec 124 routing gap and must land before (or with) Spec 131.**
- Both lock states drive the same draft → preview → commit pipeline.
- Spec 131 includes the **parity test suite**: identical input proposals applied via AW `finalizeAdjustmentWorkspace` vs `commitOrderChanges` must produce equivalent `Invoice` rows, `Order.refundPending` state, and `OrderCommitDocument` linkage outcomes. These tests gate Phase 6 approval.

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
