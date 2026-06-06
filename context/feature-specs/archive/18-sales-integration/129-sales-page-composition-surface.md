## Goal

Mount the OrderCommit-backed Sales page surface for the existing Sales composition workflow. This spec wires the live Sales composition controls to `SalesPageView.composition`, routes package/add-on/photo changes through `stageSalesChangeAction`, mounts the staged-changes rail and Review & commit dialog from Spec 128, and introduces the unified financial-preview sidebar for the OrderCommit surface. It also hardens the projected-composition mapper gaps found after Spec 128. Locked-invoice branch removal and Adjustment Workspace parity tests remain Spec 131.

## Read First

- `context/reviews/unified-order-commit-live-pos-roadmap.md` - Phase 5 breakdown, Spec 129 notes, projector rule, draft lifecycle, and locked-invoice split.
- `context/ui-context.md` - Sales page, sidebar, card, dialog, and dashboard UI conventions.
- `context/feature-specs/125-sales-page-view-model-and-projectors.md` - `SalesPageView`, `toSalesPageComposition`, staged-changes, financial-preview, and canonical-source rules.
- `context/feature-specs/126-sales-staging-actions-and-direct-mutator-guard.md` - `stageSalesChangeAction`, `discardSalesDraftAction`, lazy draft creation, expected-version semantics, and direct-mutator guard.
- `context/feature-specs/127-order-commit-preview-totals-amendment.md` - canonical `preview.totals` contract for Previous total / Pending delta / After commit.
- `context/feature-specs/128-sales-commit-action-and-review-dialog.md` - `commitSalesChangesAction` and `OrderCommitReviewDialog` mount contract.
- `app/orders/[orderId]/sales/page.tsx` - current split between unlocked direct POS composition and locked Adjustment Workspace path.
- `app/orders/[orderId]/sales/actions.ts` - existing action exports and `POSMutationActionState` conventions.
- `src/modules/order-commits/projections/sales-page-view.loader.ts` - `getSalesPageView` loader and dependency pattern.
- `src/modules/order-commits/projections/to-sales-page-composition.ts` - projected composition mapper to harden before mounting.
- `src/modules/order-commits/order-commit-draft.schema.ts` - staging-change shape that UI handlers must build.
- `src/components/orders/pos-package-composition.tsx` and `src/components/orders/pos-add-on-marketplace.tsx` - existing component contracts to reuse.
- `src/components/orders/order-commit-review-dialog.tsx` - dialog component to mount.
- `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md`, `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`, and `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md` - relevant local Next.js guides before changing App Router server/client boundaries.

## Rules

- Keep this spec to Sales page mounting, projected-composition hardening, UI handler routing, and display-only sidebar/panel work.
- Implement this spec one task at a time. Each task should be completed, minimally verified, and committed before starting the next task.
- Do not auto-advance from one task to the next in the same implementation turn unless the user explicitly asks for the next task.
- A task commit may leave later task acceptance criteria incomplete, but it must not knowingly leave its own touched surface broken.
- Do not remove the locked-invoice branch from `app/orders/[orderId]/sales/page.tsx`; Spec 131 owns locked-invoice unification and `getOpenWorkspaceForInvoice` removal.
- Do not add, delete, or modify database schema.
- Do not change `commitOrderChanges`, draft reducers, preview classification, financial emission, invoice, payment, refund, credit-note, or Adjustment Workspace behavior.
- Do not create drafts on page load. First user stage action still creates the draft lazily through `stageSalesChangeAction`.
- UI stage handlers must pass an explicit expected version: `0` when `SalesPageView.draft` is null, otherwise `SalesPageView.draft.version`.
- UI stage handlers translate existing component events into existing `OrderCommitDraftStagingChange` payloads only. Do not introduce a new client-side change DSL.
- Components and page code must not recompute financial deltas, approval rules, refund-needed state, document plans, invoice routing, or ownership truth.
- `toSalesPageComposition` may compute fields required by existing POS composition component contracts from snapshot line values, but it must not decide financial consequences or recompute preview totals.
- The unified sidebar reads `SalesPageView.financialPreview`, `SalesPageView.financialCase`, and `SalesPageView.preview`. It must not read raw invoice rows or re-derive `preview.totals`.
- Mount `OrderCommitReviewDialog` using the existing Spec 128 component. Do not duplicate commit dialog logic.
- No new public route, prop, component title, or employee-facing copy exposes Adjustment Workspace naming.
- No `@/lib/db` imports in `app/**` or `src/components/**`.

## Scope

### In Scope

- Harden `toSalesPageComposition` before live use:
  - populate `extraPhotoTotal` from digital and print extra-photo snapshot lines.
  - populate per-package `packageSubtotal` from package, item-upgrade, extra-photo, and package-scoped session-configuration snapshot values needed by the existing POS cards.
  - populate `upgradeDelta` from package-item-upgrade snapshot lines instead of leaving it as a placeholder.
  - keep `totals.netCompositionTotal` sourced from `draftSnapshot.totals.netTotal`.
  - improve `parentLabel` quality for staged-change rows where snapshot metadata already carries package labels.
  - populate `SalesPageView.order.photographerName` from the existing workspace/order source if available, rather than the current hardcoded null.
- Add focused projector tests for the residual gaps called out in the roadmap: `extraPhotoTotal`, `upgradeDelta`, total internal consistency, `parentLabel`, and `photographerName`.
- Add a small Sales page handler adapter that converts existing POS component events into `OrderCommitDraftStagingChange` payloads and calls `stageSalesChangeAction`.
- Wire the unlocked Sales page path to `getSalesPageView` and render:
  - `POSPackageComposition` from `salesPageView.composition`.
  - `POSPhotoCountCard` from `salesPageView.composition`.
  - `POSAddOnMarketplace` from `salesPageView.composition` and `toPOSAddOnMarketplace` or an equivalent projector-only adapter.
  - staged-change rail from `salesPageView.stagedChanges`.
  - unified financial-preview sidebar from `salesPageView.financialPreview`.
  - `OrderCommitReviewDialog` with `draft`, `preview`, `stagedChanges`, and `financialPreview`.
- Preserve the existing unlocked visual layout as much as possible. Add only a compact adjustment-mode visual cue driven by `salesPageView.composition.source === "projected"` or draft presence.
- Add a discard draft control wired to `discardSalesDraftAction` when a draft exists.
- Leave the existing locked-invoice branch and `FinancialSidebarLocked` in place until Spec 131.
- Tests for mounted behavior:
  - no-draft unlocked render uses current composition and does not create a draft.
  - first package/add-on/photo stage call uses expected version `0`.
  - existing draft render uses projected composition and expected version `draft.version`.
  - projected composition is passed to package, photo, and add-on components.
  - staged-changes panel renders rows from the staged-changes projector.
  - unified financial sidebar displays baseline plus overlay trio from `financialPreview`.
  - Review & commit dialog receives the exact SalesPageView pieces.
  - discard draft calls `discardSalesDraftAction` with the exact draft version.
  - source guards prove the new page/component files do not import `@/lib/db`, do not import commit execution directly, and do not expose public Adjustment Workspace naming.
- Wire new tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md` after implementation.

### Out of Scope

- No locked-invoice branch removal.
- No parity tests comparing Adjustment Workspace finalize to `commitOrderChanges`; Spec 131 owns that gate.
- No co-editor banner, non-owner disabling, manager takeover, or two-actor UI; Spec 130 owns that.
- No visual redesign or layout overhaul; Phase 7 owns design polish.
- No new Save draft semantics beyond discard and the already-persisted-on-stage behavior. If a Save draft button is needed for layout parity, it must be label-only and disabled or explicitly deferred to optional Spec 132.
- No removal of legacy Sales page actions or legacy direct-mutator service functions.
- No deletion or modification of Adjustment Workspace module, route, tables, or tests.
- No new financial document behavior.
- No new `OrderCommitPreview`, `OrderCommitDraft`, or `OrderCommit` schema fields.
- No changes to payment recording behavior.
- No new package, dependency, or design system primitive.

## Implementation Direction

### Implementation Cadence

This spec is intentionally implemented as six task commits on one `spec/129-sales-page-composition-surface` branch. For each task:

- read only the task-relevant files listed above.
- implement only that task's scope.
- run the smallest verification set that proves that task.
- update `context/progress-tracker.md` for the task status after code changes.
- commit with a Conventional Commit message before moving on.

Recommended task commit subjects:

- `fix: harden sales page projected composition`
- `feat: add order commit sales staging handlers`
- `feat: mount sales page order commit composition`
- `feat: add sales staged changes and commit controls`
- `feat: add sales order commit financial sidebar`
- `test: add sales page order commit surface guards`

### Task 1 - Harden projected composition before mounting

Start in `to-sales-page-composition.ts` and its tests. Keep the function pure and synchronous.

Use snapshot line fields and metadata that already exist in `OrderCommitSnapshotV1`; do not query catalog or operational rows. Existing POS cards expect totals such as `extraPhotoTotal`, `packageSubtotal`, and `upgradeDelta` to be internally coherent for display. Populate those from the grouped snapshot lines instead of placeholder zeroes.

For total consistency, the package row may derive display-only package subtotal from its own package line plus scoped children because the component contract needs that value. The page-level composition total must remain `draftSnapshot.totals.netTotal`; do not re-sum it from package rows.

Improve staged-change parent labels only from diff line metadata or labels already present in the preview. Do not infer package identity by reading rows or parsing formatted labels.

### Task 2 - Add OrderCommit Sales page handlers

Add a local adapter in the Sales page or a small component module that builds `OrderCommitDraftStagingChange` payloads for the existing component events.

Mapping direction:

- package change maps to `PACKAGE / CHANGE_PACKAGE` with the package line target and selected package id.
- package item upgrade maps to `PACKAGE_ITEM_UPGRADE / ADD` or `UPDATE_QUANTITY` using the parent package target, package item id, and quantity supplied by the component contract.
- photo count change maps to `PHOTO / SET_COUNTS` with the package target and all three count fields.
- add-on add maps to `ADD_ON / ADD` with parent package target, product id, quantity, and a draft add-on id only when the UI already has one.
- add-on remove maps to `ADD_ON / REMOVE` with the add-on target and parent package target.

Use `salesPageView.draft?.version ?? 0` for the expected version. Let the server action own validation and permission failures. Convert `POSMutationActionState` to existing `HandlerResult` without adding new error semantics.

If the existing add-on marketplace event does not carry enough parent package context for an `ADD_ON / ADD` staging payload, keep the add-on add affordance disabled with a clear scoped blocked reason and document the follow-up inside this spec's implementation notes. Do not invent package ownership client-side.

### Task 3 - Mount `SalesPageView` on the existing unlocked path

Replace the unlocked branch's direct composition reads with `getSalesPageView({ orderId, actorContext })`. Continue to use `getPOSWorkspace` only where existing component contracts still require the `POSWorkspace` shape; do not use it as a second source for composition truth once `SalesPageView.composition` is available.

Render the existing `POSPackageComposition`, `POSPhotoCountCard`, and `POSAddOnMarketplace` from `salesPageView.composition`. The components should not know whether the source is current or projected beyond any explicit visual cue passed by the page.

Keep the locked branch unchanged in this spec. This is intentional: Spec 131 removes the legacy locked path after parity tests.

### Task 4 - Staged changes, discard, and Review & commit

Add a compact staged-changes panel in the right rail or footer-adjacent surface. It renders `salesPageView.stagedChanges`, displays empty/no-op state from `preview.documentPlan` when applicable, and never computes totals.

Mount `OrderCommitReviewDialog` with the exact pieces from `SalesPageView`. The dialog already owns commit submission and error handling.

When a draft exists, show a discard action wired to `discardSalesDraftAction(orderId, draft.version)`. A successful discard should refresh the Sales route through the server action's existing revalidation path.

### Task 5 - Unified financial-preview sidebar for the OrderCommit surface

Create a unified sidebar component for the OrderCommit Sales surface. It should consume `SalesPageFinancialPreview`, `FinancialCaseSummary`, current `POSWorkspace` payment affordances where still required, and optional `OrderCommitPreview` document impact.

Render:

- baseline payment summary from `financialPreview.baseline`.
- Previous total, Pending delta, and After commit from `financialPreview.overlay`.
- approval/document/payment/refund impact from `financialPreview.overlay`.
- existing payment action affordances only from sanctioned current payment components, without re-deriving balances.

Do not delete `FinancialSidebarDraft` or `FinancialSidebarLocked` yet. It is acceptable for the new component to replace the unlocked branch's `FinancialSidebarDraft` while the locked branch keeps `FinancialSidebarLocked` until Spec 131.

### Task 6 - Tests and guards

Add or extend projector tests under `tests/order-commits/sales-page-view/`.

Add page/component tests close to the existing order component tests or under `tests/order-commits/sales-page-surface/`. Prefer test doubles for server actions and synthetic `SalesPageView` fixtures over database-heavy setup unless an integration path is necessary to prove lazy draft creation.

Add static source guards for new files:

- no `@/lib/db` imports in `app/**` or `src/components/**`.
- no direct import of `commitOrderChanges` in client components.
- no public Adjustment Workspace naming in new OrderCommit Sales surface files.
- no financial arithmetic over staged-change rows or preview line diffs inside components.

Wire new tests into `scripts/run-centralization-tests.ts`.

## Observability Checklist

### Dashboards / Metrics

- No new dashboards required.
- Reuse existing action success/error behavior. Do not add new logging subsystems.
- If the current Sales page emits render metrics, keep them scoped to existing names or add a narrowly named OrderCommit Sales render metric only if the implementation already has a local convention for it.

### Rollback Plan

- Schema: no changes.
- Code rollback: revert the page mount, new sidebar/panel/handler adapters, projector hardening, and tests. The legacy unlocked Sales page actions and locked branch remain available.
- Data rollback: none. Staged draft data created through this surface is normal `OrderCommitDraft` data and can be discarded through `discardSalesDraftAction`.
- Non-recoverable data: successful commits through the mounted dialog create normal `OrderCommit` and financial document rows through Spec 124 execution; they should not be deleted as rollback.

### Customer-Visible Surface

- Staff on unlocked Sales orders see the same composition controls, now backed by staged OrderCommit draft changes.
- When a draft exists, staff see a projected composition, staged-change summary, financial preview overlay, discard action, and Review & commit entry point.
- Locked orders still show the existing locked Sales / Adjustment Workspace path until Spec 131.

## Post-Implementation

- Update `context/progress-tracker.md` to mark Spec 129 complete and keep Spec 130 as co-editor concurrency / ownership UX.
- Do not edit the roadmap unless implementation proves the Spec 129/130/131 split is wrong.
- Keep implementation notes concise; do not add architecture docs unless a reviewed architecture decision changes.

## Acceptance Criteria

- `app/orders/[orderId]/sales/page.tsx` uses `getSalesPageView` for the existing unlocked Sales composition path.
- Page load does not create an `OrderCommitDraft`.
- With no draft, the unlocked Sales page renders current composition with `composition.source === "current"`.
- With a draft, the unlocked Sales page renders projected composition with `composition.source === "projected"`.
- `POSPackageComposition`, `POSPhotoCountCard`, and `POSAddOnMarketplace` consume `SalesPageView.composition` rather than separately derived composition data.
- Package, package-item, photo, and supported add-on controls call `stageSalesChangeAction` with existing `OrderCommitDraftStagingChange` payloads.
- First stage from no draft passes expected version `0`; stages from an existing draft pass `SalesPageView.draft.version`.
- `toSalesPageComposition` no longer leaves `extraPhotoTotal`, `packageSubtotal`, or `upgradeDelta` as incorrect placeholders for projected snapshots.
- Projected composition total remains sourced from `draftSnapshot.totals.netTotal`.
- Staged-change parent labels prefer existing preview/snapshot package labels over raw ids when labels are available.
- `SalesPageView.order.photographerName` uses an existing canonical source when available and is covered by a loader/projector test.
- The staged-changes panel renders from `SalesPageView.stagedChanges` and performs no financial arithmetic.
- The unified financial-preview sidebar renders baseline and overlay values from `SalesPageView.financialPreview`, including Previous total, Pending delta, and After commit.
- The Review & commit dialog is mounted using the Spec 128 component and receives `draft`, `preview`, `stagedChanges`, and `financialPreview`.
- Discard draft is available only when a draft exists and calls `discardSalesDraftAction` with the exact draft version.
- The locked-invoice branch and `FinancialSidebarLocked` remain in place; locked branch unification is not performed in this spec.
- No new public surface exposes Adjustment Workspace naming.
- No `@/lib/db` imports in `app/**` or `src/components/**`.
- No component or page code recomputes financial deltas, approval rules, refund-needed state, document plans, invoice routing, or ownership truth.
- New tests are wired into `scripts/run-centralization-tests.ts`.
- `npm run test:centralization` passes.
- `npm run test:backend-invariants` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.
