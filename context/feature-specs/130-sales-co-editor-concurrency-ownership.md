## Goal

Add the Phase 5 co-editor ownership UX for the OrderCommit-backed Sales surface. This spec makes `/orders/[orderId]/sales` clearly show when an active `OrderCommitDraft` is owned or last touched by another staff member, disables draft mutation controls for non-owner non-manager actors, and hardens stale/concurrent commit handling so staff get a clear refresh path. It builds on the mounted unlocked Sales surface from Spec 129 and the unlocked-FINAL replay fix from Spec 132. Locked-invoice branch unification remains Spec 131.

## Read First

- `context/reviews/unified-order-commit-live-pos-roadmap.md` - Phase 5 Spec 130 breakdown, co-editor design notes, draft lifecycle, and Spec 131 boundary.
- `context/ui-context.md` - dashboard banner, card, button, and operational UI conventions.
- `context/feature-specs/125-sales-page-view-model-and-projectors.md` - `SalesPageView` canonical-source boundary.
- `context/feature-specs/126-sales-staging-actions-and-direct-mutator-guard.md` - `stageSalesChangeAction`, `discardSalesDraftAction`, lazy draft creation, and draft owner/manager mutation guard.
- `context/feature-specs/128-sales-commit-action-and-review-dialog.md` - `commitSalesChangesAction` and Review & commit dialog error mapping.
- `context/feature-specs/129-sales-page-composition-surface.md` - current unlocked Sales page mount and explicit Spec 130 exclusions.
- `context/feature-specs/132-order-commit-unlocked-final-replay.md` - lock-state-aware commit emission now required before continuing Phase 5.
- `app/orders/[orderId]/sales/page.tsx` - current unlocked OrderCommit surface and still-legacy locked branch.
- `src/modules/order-commits/projections/sales-page-view.types.ts` and `src/modules/order-commits/projections/sales-page-view.loader.ts` - existing draft metadata DTO.
- `src/modules/order-commits/sales-staging-actions.ts` and `src/modules/order-commits/sales-commit-actions.ts` - action-level stale/permission/concurrent error mapping.
- `src/modules/order-commits/order-commit.service.ts` and `src/modules/order-commits/order-commit-execution.service.ts` - authoritative draft mutation and commit execution guards.
- `src/modules/order-commits/sales-staging-handler-adapter.ts` - current Sales handler adapter.
- `src/components/orders/sales-staged-commit-controls.tsx` and `src/components/orders/order-commit-review-dialog.tsx` - staged changes, discard, and Review & commit UI.
- `src/modules/orders/policies/edit-mode-policy.ts` - existing edit-policy DTOs consumed by POS controls.
- `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md`, `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`, and `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md` - relevant local Next.js guides before changing App Router server/client boundaries.

## Rules

- Keep this spec to co-editor ownership display, draft-mutation enablement, and stale/concurrent UX on the already-mounted unlocked OrderCommit Sales surface.
- Do not remove or rewrite the locked-invoice branch in `app/orders/[orderId]/sales/page.tsx`; Spec 131 owns locked-invoice unification and `getOpenWorkspaceForInvoice` removal.
- Do not add manager takeover. No takeover action ships in Phase 5.
- Do not add, delete, or modify database schema.
- Do not change OrderCommit draft snapshot, reducer, preview, financial emission, invoice, payment, refund, credit-note, or Adjustment Workspace behavior.
- Do not create drafts on page load. First stage action still creates the draft lazily through `stageSalesChangeAction`.
- Server-side draft ownership remains authoritative. UI disabling is a user-facing guard, not the source of truth.
- Non-owner non-manager actors must not be able to stage, discard, or commit another user's active Sales draft from the Sales surface.
- Managers and admins may mutate another actor's draft through the existing manager/admin server guard, but the UI must make that override state visible. Do not implement ownership transfer.
- Ownership UX must use `OrderCommitDraft.ownerUserId`, `openedByUserId`, `lastTouchedByUserId`, and `updatedAt`. If no existing service-layer user-display helper is available, use IDs/timestamps rather than adding a new user directory feature.
- Components and page code must not recompute financial deltas, approval rules, refund-needed state, document plans, invoice routing, or ownership truth from raw rows.
- No `@/lib/db` imports in `app/**` or `src/components/**`.

## Scope

### In Scope

- Add a Sales draft ownership DTO/projector field to `SalesPageView`, derived from the current actor and `SalesPageView.draft`.
- The ownership DTO should expose enough structured state for the page and components to render without recomputing:
  - whether a draft exists.
  - whether the current actor owns the draft.
  - whether the current actor is a manager/admin override actor.
  - whether the current actor may stage, discard, and commit the draft.
  - owner, opener, last-touched user IDs.
  - last-touched timestamp.
  - a display-ready banner state for owner, non-owner blocked, and manager/admin override modes.
- Add a Sales-specific ownership overlay helper for existing POS edit policies so package/photo/add-on controls become non-interactive for non-owner non-manager actors when a draft exists.
- Render a compact co-editor banner on the unlocked OrderCommit Sales path when an active draft exists:
  - owner sees current draft metadata without blocking controls.
  - non-owner non-manager sees who owns/last touched the draft and that edits are disabled until refresh/coordination.
  - manager/admin non-owner sees that they can continue as an override actor, without takeover copy.
- Disable draft mutation controls for non-owner non-manager actors:
  - package tier and photo controls through the policy overlay.
  - add-on controls through the same overlay, even though add-on staging remains unsupported from Spec 129.
  - discard draft.
  - Review & commit.
- Add or harden server-side commit ownership protection so a non-owner non-manager actor cannot commit someone else's active draft if they bypass the UI. Prefer enforcing this in `commitOrderChanges` after the draft is locked and loaded, mirroring the existing stage/discard owner-or-manager rule.
- Map commit/discard/stage ownership and stale/concurrent failures to stable Sales action states and user-visible copy:
  - stage/discard stale draft -> refresh-oriented message.
  - stage/discard permission -> blocked-by-owner message.
  - commit stale draft -> existing refresh message remains visible.
  - commit concurrent commit -> existing refresh message remains visible.
  - commit permission -> blocked-by-owner message.
- Add a refresh affordance where stale/concurrent/ownership copy is shown. This may be a small button that calls `router.refresh()` or a server-rendered link back to the same Sales route.
- Keep payment affordances in the financial sidebar unchanged unless they are directly coupled to draft mutation controls.
- Tests for:
  - `SalesPageView` ownership DTO for no draft, owner, non-owner, and manager/admin override.
  - non-owner non-manager policy overlay disables package/photo/add-on edit policies without changing the underlying edit-mode policy builder globally.
  - unlocked Sales page forwards ownership state to the banner and staged commit controls.
  - non-owner non-manager page source cannot leave Review & commit or discard enabled for another actor's draft.
  - manager/admin non-owner remains enabled and sees override copy, with no takeover action.
  - `commitOrderChanges` or the Sales commit action rejects non-owner non-manager commit attempts before materialization or financial writes.
  - stale and concurrent commit action states render refresh-oriented copy in the dialog or controls.
  - source guards prove no DB imports in app/components, no direct commit execution import in client components, no public Adjustment Workspace naming, and no financial arithmetic in the ownership/banner code.
- Wire new tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md` after implementation.

### Out of Scope

- No locked-invoice branch removal or locked Sales page unification.
- No Adjustment Workspace parity tests; Spec 131 owns that gate.
- No Adjustment Workspace deletion, route removal, table removal, or public API cleanup.
- No manager takeover, ownership transfer, or draft reassignment.
- No multi-user presence polling, live subscriptions, background refresh loop, or soft-lock timeout.
- No new user-management feature or broad user-directory read model.
- No new financial document behavior.
- No new `OrderCommitPreview`, `OrderCommitDraft`, or `OrderCommit` schema fields.
- No new Save draft semantics.
- No visual redesign or layout overhaul.
- No new package, dependency, or design system primitive.

## Implementation Direction

### Task 1 - Add the Sales draft ownership read model

Start in `sales-page-view.types.ts` and `sales-page-view.loader.ts`. Extend `SalesPageView` with a structured ownership DTO derived from `actorContext`, the loaded draft, and the actor role already available to the loader.

Keep the helper pure and display-oriented. It may compare actor ID/role to draft IDs and format banner copy, but it must not query user rows, mutate drafts, or decide financial consequences. If implementation finds an existing canonical user-display helper, use it narrowly; otherwise keep copy based on user IDs and timestamps.

Add focused loader/projector tests for no draft, owner draft, non-owner non-manager draft, and manager/admin override draft.

### Task 2 - Apply ownership to the unlocked Sales controls

Use the ownership DTO to render a compact banner on the unlocked Sales path. The banner should live near the staged workflow controls or above the composition controls, use existing card/badge/button primitives, and stay operational rather than decorative.

Add a Sales-specific ownership policy overlay that consumes existing `POSPackageCompositionEditPolicies` and `POSAddOnEditPolicies` and returns equivalent policy DTOs with `isInteractive: false` and ownership-specific copy when the current actor cannot mutate the active draft. Do not alter the global edit-mode policy builder for all surfaces.

Pass the ownership-aware policies to `POSPackageComposition`, `POSPhotoCountCard`, and `POSAddOnMarketplace`. Pass the same ownership DTO or explicit permission booleans into `SalesStagedCommitControls` and `OrderCommitReviewDialog` so discard and Review & commit are disabled for non-owner non-manager actors.

Manager/admin non-owner actors should keep controls enabled and see override copy. Do not show or wire a takeover button.

### Task 3 - Harden commit/discard/stale/concurrent handling

Align commit execution with the same owner-or-manager rule used by staging and discard. The safest place is inside `commitOrderChanges` after the draft is locked and loaded and before materialization or financial emission. If implementation chooses an action-level guard instead, tests must prove a bypass cannot reach materialization or financial writes.

Map ownership failures to stable action states in `sales-commit-actions.ts` and the staged controls where needed. Keep existing stale/concurrent messages, but ensure the UI actually displays a refresh-oriented message and affordance for stale draft and concurrent commit failures.

Do not change retry, serializable transaction, idempotency, final-invoice mode, or document-emission behavior from Spec 132.

### Task 4 - Tests and guards

Add tests close to the existing Phase 5 suites:

- loader/projector tests under `tests/order-commits/sales-page-view/`.
- page/component/static guards under `tests/order-commits/sales-page-surface/`.
- action/service tests under `tests/order-commits/sales-staging-actions/`, `tests/order-commits/sales-commit-actions/`, or the execution suite as appropriate.

Prefer synthetic `SalesPageView` fixtures for component behavior and service/action fakes for error mapping. Use database-backed execution coverage only where it is necessary to prove commit ownership blocks before writes.

Wire any new tests into `scripts/run-centralization-tests.ts`.

## Observability Checklist

### Dashboards / Metrics

- No new dashboards required.
- If the Sales page already emits render metrics, it is acceptable to add a narrow `sales_page.order_commit.co_editor_banner_rendered` metric with order id, draft presence, and ownership mode. Do not add a new logging subsystem.

### Rollback Plan

- Schema: no changes.
- Code rollback: revert the ownership DTO, policy overlay, banner, staged-control/dialog disabling, action/error mapping, and tests. The Spec 129 mounted unlocked Sales surface remains available.
- Data rollback: none. No new rows or persisted fields are introduced.
- Non-recoverable data: none. Any successful commit remains a normal `OrderCommit` commit.

### Customer-Visible Surface

- Staff see when an active Sales draft is owned or last touched by someone else.
- Non-owner non-manager staff see disabled edit/commit controls and refresh-oriented copy rather than discovering the conflict only after submit.
- Managers/admins can continue a draft as override actors but do not take ownership in Phase 5.

## Post-Implementation

- Update `context/progress-tracker.md` to mark Spec 130 complete and keep Spec 131 as locked-invoice path unification and parity tests.
- Do not edit the roadmap unless implementation proves the Spec 130/131 split is wrong.
- Keep implementation notes concise; do not add architecture docs unless a reviewed architecture decision changes.

## Acceptance Criteria

- `SalesPageView` exposes structured ownership state derived from actor context plus `OrderCommitDraft.ownerUserId`, `openedByUserId`, `lastTouchedByUserId`, and `updatedAt`.
- With no draft, the unlocked Sales page has no co-editor banner and all existing unlocked edit policies behave as they did after Spec 129.
- With a draft owned by the current actor, the unlocked Sales page shows draft metadata and keeps package/photo/discard/Review & commit controls enabled according to the existing edit policies.
- With a draft owned by another non-manager actor, the unlocked Sales page shows co-editor ownership copy and disables package/photo/add-on/discard/Review & commit controls.
- With a draft owned by another actor and viewed by a manager/admin, the unlocked Sales page shows manager/admin override copy, keeps controls enabled, and does not show a takeover action.
- Non-owner non-manager stage attempts remain blocked by the existing service guard.
- Non-owner non-manager discard attempts remain blocked by the existing service guard.
- Non-owner non-manager commit attempts are blocked server-side before materialization, financial emission, document links, audit/activity writes, and draft deletion.
- Stale stage/discard/commit results surface refresh-oriented copy instead of hidden internal error keys.
- Concurrent commit results surface the existing refresh message and offer a refresh affordance.
- No locked-invoice branch unification is performed; `getOpenWorkspaceForInvoice` and `FinancialSidebarLocked` remain in the locked branch for Spec 131.
- No manager takeover, ownership transfer, polling, or presence subscription is added.
- No new public surface exposes Adjustment Workspace naming.
- No `@/lib/db` imports in `app/**` or `src/components/**`.
- No component or page code recomputes financial deltas, approval rules, refund-needed state, document plans, invoice routing, or ownership truth from raw rows.
- New tests are wired into `scripts/run-centralization-tests.ts`.
- `npm run test:centralization` passes.
- `npm run test:backend-invariants` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.
