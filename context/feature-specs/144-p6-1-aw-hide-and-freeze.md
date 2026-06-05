## Goal

Phase 6 step 1 (P6-1): make Adjustment Workspace (AW) safe to leave dormant without deleting anything. Close the one open retirement risk — **R1: the AW route is still reachable by direct URL** — by neutralizing the employee-facing route, and add a source guard that blocks new AW references from re-entering `app/` and `src/components/`. This is the non-destructive "hide & freeze" gate that precedes every later Phase 6 deletion spec.

Source of truth: `context/reviews/phase-6-readiness-report.md` (Section C → Spec P6-1; Section B → R1). Note R2 is already resolved by the recovered Spec 135 and is **not** in scope here.

## Read First

- `context/reviews/phase-6-readiness-report.md` — Sections A (A1), B (R1), C (P6-1), D.
- `app/orders/[orderId]/adjustment-workspace/page.tsx` — the employee-facing AW page (still server-rendered and navigable).
- `app/orders/[orderId]/adjustment-workspace/actions.ts` — `openAdjustmentWorkspaceAction` (`:97`) and the full stage/finalize/takeover/cancel action set still callable.
- `src/modules/orders/policies/edit-mode-policy.ts:254-260` — `adjustmentWorkspaceRoute()` (the `/adjustment-workspace` href the policy can still emit).
- `src/components/orders/financial-sidebar-locked.tsx:152` — the only remaining AW `<Link>` in the app (in a component that is **never mounted**; dead but should not be resurrected).
- `tests/order-commits/order-commit-draft-guard/aw-finalize-bypasses-guard.test.ts` — existing source-guard test style to mirror.

## Rules

- **Non-destructive only.** No module, route file, component, table, or test is deleted in this spec. Deletions begin in P6-2+.
- The AW route must stop being a usable employee surface. Preferred: replace the page body with a server-side `redirect()` to `/orders/[orderId]/sales`, and make the AW server actions refuse (throw a clear "Adjustment Workspace is retired — use POS" error) so a stale client cannot drive a workspace. Do **not** yet remove the action functions (later specs depend on a clean dependency cut order).
- AW **finalize** must remain functional internally only insofar as nothing else calls it on the Sales surface (it does not). Do not special-case finalize here; the route-level refusal covers the employee entry points.
- Add a repo-level source guard (grep test wired into `test:centralization`) asserting **no new** `adjustment-workspace` import or `/adjustment-workspace` href appears in `app/**` or `src/components/**` beyond an explicit allowlist of the files that later Phase 6 specs will delete (record them in the test as known-legacy).
- Do not touch `writeOrderPackageSelections` (R2 already handled by Spec 135).
- No `@/lib/db` imports in `app/**` or `src/components/**`.
- No Prisma schema change.

## Scope

### In Scope

- **Neutralize the AW route:** `app/orders/[orderId]/adjustment-workspace/page.tsx` redirects to the order's Sales page; the route's server actions throw a retired-surface error instead of mutating.
- **Source guard:** new test that fails if `adjustment-workspace` imports / `/adjustment-workspace` hrefs appear in `app/**` or `src/components/**` outside the known-legacy allowlist (the AW route dir, `financial-sidebar-locked.tsx`, `financial-sidebar-adjustment.tsx`, `configure-session-panel.tsx`, `edit-mode-policy.ts`, `order-composition.service.ts`, `actions.ts`, `composition-view.model.ts` — i.e. the A2–A7 set scheduled for P6-2…P6-5).
- Wire the new test into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md`.

### Out of Scope

- Deleting any AW code, route files, components, tests, or tables (P6-2…P6-6).
- Removing the policy `adjustmentWorkspaceRoute()` / `shouldOpenAdjustmentWorkspace` fields (P6-4).
- Removing the open-AW composition branch (P6-2).
- Any change to `writeOrderPackageSelections` or the Spec 135 guard.
- Any financial behavior change.

## Implementation Direction

The AW route is the last live employee entry point to AW (no inbound links remain except a dead component). Convert `page.tsx` to a thin server component that calls `redirect(`/orders/${orderId}/sales`)`, and make each exported action in the route's `actions.ts` throw an `AdjustmentWorkspaceRetiredError` (new, local to the route or a small shared error) so a cached browser tab cannot still POST. Mirror the existing grep/source-guard test pattern (`aw-finalize-bypasses-guard.test.ts`, and the Spec 129 source guards) for the no-new-AW-references check; seed its allowlist with the exact A2–A7 files so the later specs can remove entries as they delete code. Keep the change reversible by a single revert.

## Observability Checklist

### Dashboards / Metrics

- Optional: emit a one-line `console.info({ metric: "adjustment_workspace.route_redirected", orderId })` on the redirect so any real navigation attempt is visible during the bake period. No new dashboard required.

### Rollback Plan

- No schema/migration. Rollback = revert the redirect + action-refusal + the source-guard test. AW becomes navigable again exactly as before.
- No data is created, mutated, or destroyed.

### Customer-Visible Surface

- Staff who navigate (or hold a bookmark) to `/orders/[orderId]/adjustment-workspace` are redirected to the order's POS/Sales page. There is no other visible change; no normal workflow links here today.

## Post-Implementation

- `context/progress-tracker.md` — "Now" line: AW route is hidden (redirects to Sales) and source-guarded against re-introduction; AW remains in the codebase as frozen legacy pending P6-2…P6-6.
- `context/reviews/unified-order-commit-live-pos-roadmap.md` — Phase 6: mark P6-1 shipped; note R1 closed.

## Acceptance Criteria

- Navigating to `/orders/[orderId]/adjustment-workspace` server-redirects to `/orders/[orderId]/sales`.
- Every AW route server action refuses (throws the retired-surface error) instead of opening/mutating a workspace.
- The source-guard test fails if a new `adjustment-workspace` import or `/adjustment-workspace` href is added to `app/**` or `src/components/**` outside the seeded legacy allowlist.
- No AW module file, route file, component, test, or table is deleted.
- `writeOrderPackageSelections` and the Spec 135 guard are untouched.
- New test wired into `test:centralization`.
- `npm run test:centralization` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Resolved Decisions

1. **R2 is excluded.** The non-Sales session-config draft-bypass is already guarded by the recovered Spec 135 (`session-configuration-selection.service.ts:293`), so P6-1 carries no `writeOrderPackageSelections` work.
2. **Route is redirected, not deleted, in this spec.** Deleting the route file is sequenced into P6-5 so the dependency cut order (composition → order-detail → policy → module/route) stays clean and each step is independently revertible.

## Open Questions

- Whether to also gate the AW route behind a feature flag for a short bake period instead of an immediate redirect. Default: immediate redirect, since there is no remaining legitimate AW workflow and dev data resets.
