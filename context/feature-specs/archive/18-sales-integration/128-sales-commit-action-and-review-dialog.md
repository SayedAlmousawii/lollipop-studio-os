## Goal

Add the commit-side surface for the unified Sales workflow: a thin `commitSalesChangesAction` over `commitOrderChanges`, plus an additive Review & commit dialog component that renders the existing `SalesPageView` preview data and submits the commit with optional manager approval. This spec does not rewire the Sales composition controls, replace legacy Sales actions, or unify locked/unlocked page routing; it gives Spec 129 a safe commit action and tested dialog to mount.

## Read First

- `context/reviews/unified-order-commit-live-pos-roadmap.md` - Phase 5 breakdown and Design Notes for Spec 128.
- `context/ui-context.md` - dialog, button, card, and dashboard UI conventions.
- `context/feature-specs/124-order-commit-execution.md` - `commitOrderChanges` behavior, transaction boundary, document emission, draft deletion, and commit-time error classes.
- `context/feature-specs/125-sales-page-view-model-and-projectors.md` - `SalesPageView`, `SalesPagePreviewState`, staged-changes, financial-preview, and canonical-source/projector rules.
- `context/feature-specs/126-sales-staging-actions-and-direct-mutator-guard.md` - existing Sales draft action dependency-injection and error-mapping pattern.
- `context/feature-specs/127-order-commit-preview-totals-amendment.md` - `preview.totals` contract consumed by the dialog summary.
- `app/orders/[orderId]/sales/actions.ts` - current Sales action style, permission checks, `POSMutationActionState`, and revalidation path.
- `src/modules/order-commits/sales-staging-actions.ts` - dependency-injected action helper pattern to follow.
- `src/modules/order-commits/order-commit-execution.service.ts` - `commitOrderChanges` input and commit-time errors.
- `src/modules/order-commits/projections/sales-page-view.types.ts` - dialog input shape.
- `src/components/orders/reductive-edit-approval-modal.tsx` and `src/components/orders/credit-note-approval-fields.tsx` - existing manager-approval interaction pattern to reuse conceptually.

## Rules

- The commit action is an orchestrator only: permission check, `commitOrderChanges`, `revalidatePath`, typed error mapping, return state. No financial, approval, refund, document-plan, ownership, or workflow logic belongs in the action.
- The action must consume the caller-supplied `expectedDraftVersion`; it must not load a draft version from the page or silently retry stale drafts.
- `approvalActorUserId` is optional and is forwarded only to `commitOrderChanges`. The action does not decide whether approval is required.
- The action must map the commit-time errors named in the roadmap: `OrderCommitStaleDraftError`, `OrderCommitConcurrentCommitError`, `OrderCommitApprovalRequiredError`, and `OrderCommitCreditCapacityExhaustedError`.
- The dialog reads already-projected data from `SalesPageView`: `draft`, `preview`, `stagedChanges`, and `financialPreview`. It must not call services, query the DB, build preview data, or compute totals from lines.
- The dialog may format raw money via `src/lib/formatting/money.ts`; it must not do financial arithmetic beyond display-only list rendering.
- The dialog must use existing shadcn/ui primitives and Lucide icons. Keep the UI compact and operational.
- The dialog component is additive and tested in isolation. Mounting it into the live Sales page footer, wiring staged composition controls, and replacing the legacy direct actions are Spec 129.
- No changes to `app/orders/[orderId]/sales/page.tsx` unless required only to export/import types for tests; do not change live page behavior in this spec.
- No changes to `POSPackageComposition`, `POSAddOnMarketplace`, photo cards, `FinancialSidebarDraft`, or `FinancialSidebarLocked`.
- No schema, migration, `OrderCommitPreview`, `OrderCommitDraft`, materializer, invoice, payment, refund, Adjustment Workspace, or direct-mutator guard changes.
- No new public surface exposes Adjustment Workspace naming.
- No `@/lib/db` imports in `app/**` or `src/components/**`.

## Scope

### In Scope

- New dependency-injected commit-action helper under `src/modules/order-commits/`, following the Spec 126 action-helper pattern:
  - accepts `orderId`, `expectedDraftVersion`, optional `approvalActorUserId`, and injected dependencies.
  - requires `PERMISSIONS.ORDER_FINANCIAL_UPDATE` through the injected permission function.
  - calls `commitOrderChanges` with `{ orderId, expectedDraftVersion, approvalActorUserId, actorContext }`.
  - revalidates `/orders/${orderId}/sales` after success.
  - returns a typed Sales commit action state.
- New exported server action in `app/orders/[orderId]/sales/actions.ts`:
  - `commitSalesChangesAction(orderId, expectedDraftVersion, approvalActorUserId?)`.
  - imports `commitOrderChanges` and commit error classes from `@/modules/order-commits`.
  - uses the helper above so tests can cover action behavior without invoking Next internals.
- New action-state type for commit results, compatible with existing POS action conventions:
  - success state.
  - error state with `_global` messages/copy keys.
  - approval-required state that keeps the dialog open and highlights the manager field.
  - credit-capacity/refund-needed state that can surface the server-provided refund/credit-capacity explanation.
- New additive client component, recommended path `src/components/orders/order-commit-review-dialog.tsx`:
  - receives `orderId`, `draft`, `preview`, `stagedChanges`, `financialPreview`, and an optional `commitAction` prop for test injection.
  - renders nothing disabled/interactive when `draft` or `preview` is null.
  - opens from a Review & commit button.
  - displays the preview totals trio from `financialPreview.overlay` or `preview.totals`: previous total, pending delta, after commit.
  - displays staged-change rows from `stagedChanges`; if none, shows the no-op/audit state from `preview.documentPlan` and `preview.zeroNetReason`.
  - displays `preview.documentPlan`, `preview.paymentImpact`, and `preview.refundImpact` as read-only commit consequences.
  - when `preview.requiresApproval` is true, displays a manager/admin user ID field before submit; empty submit maps to the same approval-required UX as a server rejection.
  - on successful commit, closes the dialog, refreshes the route, and shows a success toast.
  - on stale/concurrent/approval/credit-capacity errors, keeps the dialog open and shows an inline error.
- Tests for the commit helper:
  - happy path calls `commitOrderChanges` once with the exact expected draft version and optional approval actor.
  - success revalidates the Sales path.
  - stale draft maps to `"commit.stale"`.
  - concurrent commit maps to `"commit.concurrent"`.
  - approval required maps to an approval-required state and does not pretend the commit succeeded.
  - credit capacity exhausted maps to a credit/refund-capacity error state.
  - permission failure and unknown errors follow existing action conventions.
- Component tests for the dialog:
  - no draft/preview means no commit submit is available.
  - totals are displayed from canonical `preview.totals` / `financialPreview.overlay` values without summing staged rows.
  - document plan, payment impact, refund impact, and approval reasons render from the preview object.
  - approval-required preview requires manager/admin user ID before submit.
  - stale/concurrent/approval/credit-capacity action states render inline and keep the dialog open.
  - stale draft response specifically keeps the dialog open, preserves the current preview summary, preserves the current staged-change rows, and prompts the user to refresh instead of silently closing or resetting the dialog.
  - success closes or resets the dialog and triggers refresh/toast behavior through test doubles where needed.
- Static-source guards:
  - the commit helper and dialog do not import `@/lib/db`.
  - the dialog does not import `commitOrderChanges` directly; it calls the server action prop/import boundary only.
  - no new file introduced by this spec contains public `AdjustmentWorkspace` naming.
- Wire new tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md` after implementation.

### Out of Scope

- No Sales page composition rewiring.
- No live mounting of the dialog into `app/orders/[orderId]/sales/page.tsx`; Spec 129 mounts it with the projected Sales page surface.
- No replacement or removal of legacy Sales actions (`updateOrderPackageAction`, `upgradeOrderPackageItemAction`, `addOrderProductAddOnAction`, `removeOrderAddOnAction`, `updateOrderSelectedPhotoCountAction`).
- No changes to the five legacy direct-mutator service functions or their Spec 126 guard.
- No locked-invoice branch unification or parity tests. Spec 131 owns that gate.
- No co-editor banner, non-owner disabling, takeover, or two-actor UI. Spec 130 owns that.
- No financial sidebar folding. Spec 129 owns the unified sidebar.
- No `OrderCommitPreview` shape changes.
- No `OrderCommitDraft` schema or lifecycle changes.
- No commit execution, financial emission, document-link, invoice, payment, credit-note, refund, or Adjustment Workspace behavior changes.
- No database schema or migration changes.

## Implementation Direction

### Task 1 - Commit action state and helper

Add a small commit-action helper next to the Spec 126 Sales staging helper. Keep it dependency-injected for tests.

The helper should construct `actorContext` from the current app user, call `commitOrderChanges`, revalidate only after success, and map known commit errors into stable action states. It should not inspect `preview`, infer approval, or read the draft.

Use short copy keys/messages aligned to the Phase 5 Design Notes:

- stale draft: "Draft changed since you opened it. Refresh to see the latest."
- concurrent commit: "Another commit just landed. Refresh and try again."
- approval required: keep the dialog open and mark the manager/admin field.
- credit capacity exhausted: surface a refund/credit-capacity message using the error payload where useful.

### Task 2 - `commitSalesChangesAction`

Export `commitSalesChangesAction` from `app/orders/[orderId]/sales/actions.ts`.

It should mirror `stageSalesChangeAction` and `discardSalesDraftAction`: call `requireCurrentAppUserPermission(PERMISSIONS.ORDER_FINANCIAL_UPDATE)`, delegate to the helper, and use the same `revalidatePOSPaths` callback. Keep the action signature stable for the future dialog mount: `orderId`, `expectedDraftVersion`, optional `approvalActorUserId`.

Do not remove or change existing legacy Sales actions in this spec.

### Task 3 - Review & commit dialog

Create an additive client component for the Review & commit dialog.

The component receives the already-composed `SalesPageView` pieces rather than loading anything itself. It renders:

- a Review & commit trigger button.
- a totals summary from canonical preview totals.
- staged-change rows from `SalesPageView.stagedChanges`.
- document plan, payment impact, refund impact, and approval reasons from `preview`.
- a manager/admin user ID field only when approval is required or when a prior submit returned approval-required.
- inline error states for stale, concurrent, approval, and credit-capacity failures.

The submit path calls `commitSalesChangesAction` with `draft.version` as `expectedDraftVersion`. The component should not let a user submit when `draft` or `preview` is missing.

### Task 4 - Approval and error UX

Reuse the existing approval UX pattern conceptually: manager/admin ID field, inline warning panel, and a guarded confirm button. Do not reuse credit-note-specific wording if it would describe the wrong document plan.

For `OrderCommitApprovalRequiredError`, the component should keep the dialog open, keep the current staged preview visible, focus or mark the approval field, and allow resubmission with `approvalActorUserId`.

For `OrderCommitCreditCapacityExhaustedError`, the component should not tell users that a commit happened. It should explain that the credit/refund capacity changed and the order needs refresh/review.

### Task 5 - Tests and source guards

Add focused action-helper tests under `tests/order-commits/sales-commit-actions/`.

Add component tests near existing order component tests or under `tests/order-commits/sales-commit-dialog/`, whichever matches local test conventions after inspecting the harness. Prefer synthetic `SalesPageView` objects and injected action functions over database setup for component behavior.

Add static guards that prove no component or app code introduced by this spec imports the DB or commit execution service directly.

Wire the new tests into `scripts/run-centralization-tests.ts`.

### Task 6 - Documentation

Update `context/progress-tracker.md` to mark Spec 128 complete and to keep the next unit clear: Spec 129 mounts the projected Sales page surface and unified sidebar.

No roadmap edit is required unless implementation discovers that the Spec 129/130/131 split needs renumbering.

## Observability Checklist

### Dashboards / Metrics

- None required. This spec adds a user-triggered action and dialog but no recurring process.
- If existing action logging patterns already emit blocked action reasons, reuse them for stale/concurrent/approval/credit-capacity outcomes. Do not create a new logging subsystem.

### Rollback Plan

- Schema: no changes.
- Code rollback: revert the new helper, server action export, dialog component, and tests. Because the dialog is not mounted in this spec, rollback does not affect the live Sales page.
- Data rollback: none. Successful commits create real `OrderCommit` and financial document rows through Spec 124 execution, as intended. Failed action states create no data.
- Non-recoverable data: any successful commit is normal business data and should not be deleted as rollback.

### Customer-Visible Surface

- None in the live app if the dialog remains unmounted as required.
- The component itself is staff-facing once Spec 129 mounts it: staff will see a Review & commit dialog summarizing staged changes, document impact, payment/refund impact, and approval requirement before commit.

## Post-Implementation

- Update `context/progress-tracker.md`.
- Keep the roadmap unchanged unless the implementation exposes a necessary split change.
- Spec 129 should be able to mount the dialog and wire projected composition controls without adding commit execution logic.

## Acceptance Criteria

- `commitSalesChangesAction(orderId, expectedDraftVersion, approvalActorUserId?)` is exported from `app/orders/[orderId]/sales/actions.ts`.
- The action requires `ORDER_FINANCIAL_UPDATE`, calls `commitOrderChanges`, forwards the exact `expectedDraftVersion`, forwards optional `approvalActorUserId`, and revalidates the Sales path only after success.
- The action maps `OrderCommitStaleDraftError`, `OrderCommitConcurrentCommitError`, `OrderCommitApprovalRequiredError`, and `OrderCommitCreditCapacityExhaustedError` into stable UI states without swallowing unknown errors.
- The Review & commit dialog component renders from `SalesPageView`/`OrderCommitPreview` data only and performs no service calls or DB reads.
- The dialog displays totals from `preview.totals` or `financialPreview.overlay` without summing staged rows.
- The dialog displays staged changes, document plan, payment impact, refund impact, and approval reasons from existing preview/projector output.
- The dialog submits with `draft.version` as `expectedDraftVersion`.
- The dialog handles success, stale draft, concurrent commit, approval required, and credit-capacity-exhausted states.
- The stale draft dialog test proves the dialog remains open, keeps the current preview and staged changes visible, and tells the user to refresh rather than closing or resetting.
- No live Sales page behavior changes before Spec 129 mounts the dialog.
- No legacy Sales action or direct mutator is removed or changed.
- No OrderCommit execution, preview, draft, materialization, invoice, payment, credit-note, refund, schema, migration, or Adjustment Workspace behavior changes.
- No new public surface exposes Adjustment Workspace naming.
- No `@/lib/db` imports in `app/**` or `src/components/**`.
- New tests are wired into `scripts/run-centralization-tests.ts`.
- `npm run test:centralization` passes.
- `npm run test:backend-invariants` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.
