## Goal

Unify the locked-invoice Sales path with the OrderCommit-backed Sales workflow. After this spec, `/orders/[orderId]/sales` uses one draft -> preview -> commit surface for locked and unlocked orders, removes the Sales page dependency on the legacy Adjustment Workspace branch, and adds the locked-path parity tests that gate Phase 6 retirement planning. This builds on Spec 130 ownership UX and the Spec 132 unlocked-FINAL replay fix.

## Read First

- `context/reviews/unified-order-commit-live-pos-roadmap.md` - Phase 5 Spec 131 scope, locked-invoice unification notes, projector rule, and Phase 6 gate.
- `context/ui-context.md` - operational dashboard, sidebar, banner, card, and button conventions.
- `context/feature-specs/125-sales-page-view-model-and-projectors.md` - `SalesPageView` canonical-source boundary.
- `context/feature-specs/126-sales-staging-actions-and-direct-mutator-guard.md` - lazy draft creation, direct-mutator guard, and AW-finalize exemption.
- `context/feature-specs/128-sales-commit-action-and-review-dialog.md` - `commitSalesChangesAction`, Review & commit dialog, and action error mapping.
- `context/feature-specs/129-sales-page-composition-surface.md` - current unlocked OrderCommit Sales surface and explicit locked-branch boundary.
- `context/feature-specs/130-sales-co-editor-concurrency-ownership.md` - ownership DTO, co-editor banner, and non-owner control disabling that must survive unification.
- `context/feature-specs/132-order-commit-unlocked-final-replay.md` - lock-state-aware emission modes required before this spec.
- `app/orders/[orderId]/sales/page.tsx` - current split between the OrderCommit unlocked path and legacy locked path.
- `src/modules/order-commits/projections/sales-page-view.loader.ts` and `src/modules/order-commits/projections/sales-page-view.types.ts` - existing loader support for locked composition and `isLocked`.
- `src/modules/order-commits/projections/sales-draft-ownership-policy.ts` - Sales-only ownership policy overlay.
- `src/modules/order-commits/sales-staging-handler-adapter.ts` - current package/photo staging adapter and intentionally blocked package-item/add-on handlers.
- `src/components/orders/order-commit-financial-sidebar.tsx`, `src/components/orders/sales-staged-commit-controls.tsx`, and `src/components/orders/sales-draft-ownership-banner.tsx` - unified Sales components to reuse.
- `src/components/orders/financial-sidebar-locked.tsx` - legacy locked sidebar to remove from the Sales page only.
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts` and `app/orders/[orderId]/adjustment-workspace/actions.ts` - legacy finalize path used only for parity tests and still frozen until Phase 6.
- `tests/adjustment-workspace/finalize-integration.test.ts` - existing locked-invoice scenarios and helper patterns.
- `tests/order-commits/order-commit-execution.test.ts`, `tests/order-commits/order-commit-invoice-emission.test.ts`, and `tests/order-commits/sales-page-surface/sales-page-view-page-mount.test.ts` - current OrderCommit execution and Sales surface coverage.
- `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md`, `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`, and `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md` - local Next.js guides before changing App Router server/client boundaries.

## Rules

- Keep this spec to locked-invoice Sales path unification and parity coverage. Do not delete Adjustment Workspace, its route, tables, services, or tests.
- Remove the locked-invoice branch from the Sales page. After this spec, `app/orders/[orderId]/sales/page.tsx` must not call `getOpenWorkspaceForInvoice`, must not render `FinancialSidebarLocked`, and must not branch into a separate locked composition UI.
- Both locked and unlocked orders must load through `getSalesPageView` and render the same OrderCommit Sales components.
- Do not create drafts on page load. Lazy draft creation remains owned by `stageSalesChangeAction`.
- Preserve Spec 130 ownership behavior for both lock states: non-owner non-manager actors cannot stage, discard, or commit another user's active draft; manager/admin override remains visible and does not transfer ownership.
- Preserve the current Sales staging adapter domain support. Do not make unsupported package-item or add-on controls interactive unless the existing component event contract already carries enough parent-package context and the implementation can keep the change narrowly tested.
- Do not add, delete, or modify database schema.
- Do not change OrderCommit snapshot, draft, reducer, preview, financial emission, invoice, payment, refund, credit-note, or approval behavior except for wiring the locked Sales path through the already-shipped services.
- Do not alter Adjustment Workspace finalize behavior. It is a frozen legacy comparator for this spec.
- Components and page code must not recompute financial deltas, approval rules, refund-needed state, document plans, invoice routing, ownership truth, or workflow state.
- The parity suite may inspect database rows after each path runs, but production page/components must not import `@/lib/db`.
- No new public route, prop, component title, or employee-facing copy exposes Adjustment Workspace naming.
- No `@/lib/db` imports in `app/**` or `src/components/**`.

## Scope

### In Scope

- Rewrite `app/orders/[orderId]/sales/page.tsx` so the page:
  - loads `getPOSWorkspace` and `requireCurrentAppUser` once as today.
  - calls `getSalesPageView({ orderId, actorContext, dependencies: { getPOSWorkspace: async () => workspace } })` for every order state.
  - uses `salesPageView.composition`, `salesPageView.financialPreview`, `salesPageView.financialCase`, `salesPageView.preview`, `salesPageView.draft`, and `salesPageView.ownership` for the rendered Sales surface.
  - applies the Spec 130 ownership policy overlay to package/photo/add-on policies regardless of invoice lock state.
  - passes `salesPageView.draft?.version ?? 0` into the existing OrderCommit staging handlers regardless of invoice lock state.
  - renders `SalesDraftOwnershipBanner`, `POSPackageComposition`, `POSPhotoCountCard`, `POSAddOnMarketplace`, `SalesStagedCommitControls`, and `OrderCommitFinancialSidebar` for both locked and unlocked orders.
- Remove the Sales page imports and code paths for:
  - `getOpenWorkspaceForInvoice`.
  - `FinancialSidebarLocked`.
  - `toSalesSidebarLocked`.
  - `getLockedOrderCompositionViewModel` and `toCurrentCompositionCard` when used only by the Sales page branch.
  - `LockedCompositionView` if it no longer has callers.
- Preserve existing payment affordances exposed by `OrderCommitFinancialSidebar`; do not redesign payment recording.
- Preserve current blocked behavior for package-item/add-on staging if still unsupported by `sales-staging-handler-adapter.ts`. Locked and unlocked orders should behave identically.
- Add or update Sales surface tests proving:
  - there is no locked branch before the `getSalesPageView` path.
  - locked orders call/render the same OrderCommit Sales surface as unlocked orders.
  - the page no longer imports or calls `getOpenWorkspaceForInvoice`.
  - the page no longer imports or renders `FinancialSidebarLocked`.
  - locked orders pass ownership state to banner, controls, and dialog.
  - locked orders apply ownership overlays to package/photo/add-on policies.
  - page load remains read-only for locked and unlocked orders.
  - source guards still block DB imports, direct commit execution imports in components, public Adjustment Workspace naming, and financial arithmetic in page/component code.
- Add locked-path parity tests comparing equivalent legacy AW finalize proposals with OrderCommit commit proposals. At minimum cover:
  - locked FINAL additive proposal -> ADJUSTMENT invoice outcome.
  - locked FINAL reductive proposal within credit capacity -> equivalent reduction outcome, where AW's legacy negative ADJUSTMENT and OrderCommit's target-model CREDIT_NOTE are normalized as equivalent reductions.
  - locked FINAL reduction beyond available credit capacity -> refund-needed / `Order.refundPending` outcome.
  - no-op or zero-net proposal -> no emitted financial document.
  - commit document links for OrderCommit path match emitted document roles (`ADJUSTMENT_INVOICE` / `CREDIT_NOTE`) and omit links when no document is emitted.
- The parity assertions should compare normalized outcomes, not raw row ids:
  - net financial effect on the FinancialCase.
  - parent FINAL relationship.
  - reduction amount.
  - `Order.refundPending`.
  - emitted OrderCommitDocument role on the OrderCommit side.
  - invoice types only for additive and no-emission cases where the target and legacy paths agree.
  - emitted document presence and role for the OrderCommit path.
  - no mutation of the locked FINAL invoice body in either path.
- Document the intentional legacy divergences in tests:
  - AW emits negative ADJUSTMENT invoices for locked reductions; OrderCommit emits CREDIT_NOTE and is the target model.
  - AW sets `refundPending` when `FINAL.remainingAmount <= 0`; OrderCommit sets refund-needed when `remainingAfterCommit = remaining - reduction < 0` and is the source of truth.
  - Use fixtures where both paths agree for strict parity assertions, plus one explicitly named legacy-divergence test for the refund threshold difference.
- Wire new tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md` after implementation.

### Out of Scope

- No Adjustment Workspace deletion, route removal, table removal, service removal, or test deletion. Phase 6 owns retirement.
- No removal of the AW-finalize exemption from the legacy direct-mutator guard. Phase 6 owns that after deletion.
- No new financial document behavior, preview behavior, approval behavior, payment behavior, refund issuance behavior, or invoice locking behavior.
- No schema or migration changes.
- No manager takeover, ownership transfer, polling, presence subscriptions, or draft timeout behavior.
- No visual redesign or layout overhaul; Phase 7 owns polish.
- No order timeline, commit history, or typed `pendingOpsJson` history surface.
- No new Save draft semantics.
- No new package, dependency, or design system primitive.

## Implementation Direction

### Task 1 - Collapse the Sales page onto `SalesPageView`

Start in `app/orders/[orderId]/sales/page.tsx`. Keep the page as a server component and preserve the existing initial `getPOSWorkspace` / `requireCurrentAppUser` pattern.

Delete the locked-only return branch and move the OrderCommit Sales rendering path so it runs for every order. The page should still use the `workspace` object where existing POS components require the `POSWorkspace` contract, but composition, staged changes, financial preview, ownership, and preview state must come from `SalesPageView`.

Do not replace `getSalesPageView` with page-local composition loading. The loader already has a locked composition dependency path; use it as the single read-model entry point.

### Task 2 - Keep edit policies and ownership consistent across lock states

Build the edit-policy context once from the workspace with the actual invoice lock state. Then apply `applySalesDraftOwnershipToPackagePolicies` and `applySalesDraftOwnershipToAddOnPolicies` before passing policies to POS components.

Locked orders should no longer get the old open-workspace policy branch from `getOpenWorkspaceForInvoice`. If the edit-mode policy still disables financial edits for locked invoices, the Sales ownership overlay should sit on top of that policy without weakening service-side guards. The resulting UI must show the same staged workflow shell for locked and unlocked orders, even when a specific control remains blocked.

Keep package-item/add-on blocked behavior as currently implemented unless the implementation can safely provide the missing scope through existing component props. If any unsupported controls remain blocked, tests must prove locked and unlocked orders render the same blocked result.

### Task 3 - Reuse the unified OrderCommit sidebar and staged controls

Render `OrderCommitFinancialSidebar` for locked and unlocked orders. It should continue to read from `SalesPageView.financialPreview`, `SalesPageView.financialCase`, optional `SalesPageView.preview`, and the current workspace payment affordance inputs.

Render `SalesStagedCommitControls` and `OrderCommitReviewDialog` through the existing component path for locked and unlocked orders. Keep refresh-oriented stale/concurrent/permission copy from Spec 130.

Do not copy logic from `FinancialSidebarLocked` into the page. If a small display gap exists, add it to the unified sidebar through projector-fed props only.

### Task 4 - Remove Sales-page Adjustment Workspace coupling

After the page is unified, add static guards that fail if the Sales page imports or calls legacy locked branch symbols:

- `getOpenWorkspaceForInvoice`
- `FinancialSidebarLocked`
- `toSalesSidebarLocked`
- `LockedCompositionView`
- public Adjustment Workspace route/copy in the Sales page or OrderCommit Sales components

Adjustment Workspace may still exist in its own route/module/tests. The guard should target active Sales surfaces, not the legacy module itself.

### Task 5 - Add locked-path parity tests

Create parity tests close to the existing OrderCommit and Adjustment Workspace suites. Prefer a shared helper that can build the same locked-order starting state twice:

1. Path A stages and finalizes through the legacy Adjustment Workspace service/action layer.
2. Path B stages an equivalent OrderCommit draft, commits through `commitOrderChanges`, and inspects emitted documents.

Normalize the comparison so ids, invoice numbers, timestamps, audit ids, and activity ids do not matter. The point is equivalent financial outcome, not byte-identical rows.

Cover at least the acceptance scenarios listed below. Use focused fixtures and existing helpers from `tests/adjustment-workspace/finalize-integration.test.ts`, `tests/order-commits/order-commit-execution.test.ts`, and `tests/order-commits/order-commit-invoice-emission.test.ts` rather than creating a broad new data factory. If a domain cannot be safely expressed through both paths yet, mark it as an explicit Phase 6 blocker in the test name or implementation note instead of silently skipping it.

For reductive parity, normalize AW negative ADJUSTMENT invoices and OrderCommit CREDIT_NOTE invoices into a common reduction outcome DTO. Do not change production behavior to make the two paths emit the same invoice type. OrderCommit CREDIT_NOTE behavior is the target model.

### Task 6 - Update centralization wiring and tracker

Wire new tests into `scripts/run-centralization-tests.ts`.

Update `context/progress-tracker.md` after implementation to mark Spec 131 complete and to state whether Phase 6 is unblocked or which parity gaps remain. Do not edit the roadmap unless implementation proves the approved Phase 5/6 split is wrong.

## Observability Checklist

### Dashboards / Metrics

- No new dashboards required.
- Remove or replace locked-only Sales render metrics that imply the legacy branch is still active.
- If a render metric remains useful, use a single OrderCommit Sales metric with `orderId`, `financialCaseId`, and `isLocked`; do not log Adjustment Workspace ids from the Sales page.

### Rollback Plan

- Schema: no changes.
- Code rollback: revert the Sales page unification and restore the legacy locked branch imports/rendering.
- Test rollback: remove the new parity and static guard tests from `scripts/run-centralization-tests.ts`.
- Data rollback: none. Any committed rows are normal OrderCommit / invoice rows. Legacy AW remains available during rollback because this spec does not delete it.
- Non-recoverable data: none beyond normal immutable financial documents emitted by successful commits.

### Customer-Visible Surface

- Staff use the same Sales page workflow for locked and unlocked orders.
- Locked orders no longer send staff into the Adjustment Workspace mental model from the Sales page.
- Locked-order changes show staged changes, preview impact, ownership state, and Review & commit through the same OrderCommit components used by unlocked orders.

## Post-Implementation

- Update `context/progress-tracker.md` to mark Spec 131 complete and record whether the parity gate is sufficient for Phase 6 retirement planning.
- Do not edit `context/reviews/unified-order-commit-live-pos-roadmap.md` unless implementation discovers approved-roadmap drift.
- Keep implementation notes concise; do not add architecture docs unless a reviewed architecture decision changes.

## Acceptance Criteria

- `/orders/[orderId]/sales` renders one OrderCommit-backed Sales surface for locked and unlocked orders.
- `app/orders/[orderId]/sales/page.tsx` no longer imports or calls `getOpenWorkspaceForInvoice`.
- `app/orders/[orderId]/sales/page.tsx` no longer imports or renders `FinancialSidebarLocked`.
- `app/orders/[orderId]/sales/page.tsx` no longer has a separate locked branch that bypasses `getSalesPageView`.
- Locked orders use `SalesPageView.composition`, `SalesPageView.financialPreview`, `SalesPageView.preview`, `SalesPageView.draft`, and `SalesPageView.ownership`.
- Locked and unlocked orders both render `SalesDraftOwnershipBanner`, `POSPackageComposition`, `POSPhotoCountCard`, `POSAddOnMarketplace`, `SalesStagedCommitControls`, and `OrderCommitFinancialSidebar`.
- Page load remains read-only and does not create an `OrderCommitDraft` for locked or unlocked orders.
- Staging from locked orders goes through `stageSalesChangeAction` and existing `OrderCommitDraftStagingChange` payloads.
- Committing from locked orders goes through `commitSalesChangesAction` / `commitOrderChanges`.
- Non-owner non-manager locked-order stage/discard/commit attempts are blocked consistently with Spec 130.
- Manager/admin locked-order override remains enabled and visible without ownership transfer.
- Existing unsupported package-item/add-on staging behavior is either safely implemented with tests or remains consistently blocked for both lock states.
- Locked FINAL additive parity passes: AW finalize and OrderCommit commit produce equivalent ADJUSTMENT outcomes, and OrderCommit writes the expected `OrderCommitDocument` role.
- Locked FINAL reductive parity passes: AW finalize and OrderCommit commit produce equivalent normalized reduction outcomes; AW may emit a legacy negative ADJUSTMENT while OrderCommit emits the target-model CREDIT_NOTE, and OrderCommit writes the expected `OrderCommitDocument` role.
- Refund-needed parity passes: AW finalize and OrderCommit commit produce equivalent `Order.refundPending` state when credit capacity is exhausted.
- A legacy-divergence test documents that AW's refund threshold is `FINAL.remainingAmount <= 0`, while OrderCommit's target rule is `remainingAfterCommit = remaining - reduction < 0`; production behavior is not changed to make them match.
- No-op / zero-net parity passes: neither path emits an unnecessary financial document, and OrderCommit writes no document link for no-emission commits.
- Locked FINAL invoice immutability is preserved; no path mutates locked FINAL line content or total.
- The Sales page and OrderCommit Sales components expose no public Adjustment Workspace naming.
- Adjustment Workspace code remains present and unchanged except for test-only imports or comparator usage.
- No `@/lib/db` imports in `app/**` or `src/components/**`.
- No component or page code recomputes financial deltas, approval rules, refund-needed state, document plans, invoice routing, ownership truth, or workflow state.
- New tests are wired into `scripts/run-centralization-tests.ts`.
- `npm run test:centralization` passes.
- `npm run test:backend-invariants` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.
