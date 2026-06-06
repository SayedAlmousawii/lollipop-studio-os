## Goal

Phase 6 step 3 (P6-3): remove the remaining AW wiring on the order-detail surface and the Configure Session panel — blockers **B2, B3, B5** from the readiness report. Delete the order-detail `configureSessionAction`→`applyEdit` (AW edit) path and its `adjustmentWorkspaceEditSchema` import, remove the `adjustment` panel mode + "Edit in Adjustment Workspace" deep-link from `ConfigureSessionPanel`, and collapse `CompositionViewMode` to `"locked"` only.

Source of truth: `context/reviews/phase-6-readiness-report.md` (A3, A4, A6; Section C → P6-3). Depends on P6-2 (Spec 145) shipped.

## Read First

- `context/reviews/phase-6-readiness-report.md` — A3, A4, A6, Section C → P6-3.
- `app/orders/[orderId]/actions.ts`:
  - `:11-13` — imports `applyEdit`, `adjustmentWorkspaceEditSchema`.
  - `:125-258` — `configureSessionAction`: validates a `change_session_configuration_selection` AW edit and calls `applyEdit(workspaceId, …)` (`:243`), revalidates the AW path (`:250`).
  - `createWorkspaceEditId()` (`≈:261`) — AW-edit id helper used only by that action.
- `src/components/session-configurations/configure-session-panel.tsx`:
  - `:15,85` — imports + binds `configureSessionAction`.
  - `:43` — `adjustmentWorkspaceHref?` prop; `:140-143` — href resolution; `:393` — the `<Link>Edit in Adjustment Workspace</Link>` rendered only when `mode.kind === "locked" && hasFinancialConfigurations`.
  - The `adjustment` panel-mode handling (`adjustmentState`, the `change_session_configuration_selection` submit path).
- `src/components/orders/pos-package-composition.tsx:80-110,160-185` — `configurePanelMode` union (`"auto" | "commit-staging" | "adjustment"`) and the `adjustment`-mode mount used only by the AW route page.
- `app/orders/[orderId]/adjustment-workspace/page.tsx:185` — mounts `ConfigureSessionPanel configurePanelMode="adjustment"` (the only `adjustment`-mode consumer; itself a P6-5 deletion target).
- `src/modules/composition-view/composition-view.model.ts:4,6` — `CompositionViewMode = "locked" | "adjustment"` and the AW type import.
- `src/components/orders/orders-table.tsx:66` — renders an open-AW badge from `order.hasOpenAdjustmentWorkspace`. Surfaced during Spec 144 plan review. The service read + type field are removed in P6-2 (Spec 145); this spec removes the component badge so the field is fully retired.
- Sales path for contrast: `app/orders/[orderId]/sales/page.tsx:103` mounts the panel with `configurePanelMode="commit-staging"` (the surviving mode) and `app/orders/[orderId]/sales/actions.ts` → `stageSessionConfigurationSelectionAction` (Spec 137, the live path).

## Rules

- The Sales `commit-staging` session-config path (Spec 137) is the surviving path and must be **untouched** functionally.
- Remove the `adjustment` value from the `configurePanelMode` union and the `CompositionViewMode` union; `ConfigureSessionPanel` keeps only `commit-staging` (and any `locked` read-only display that does not deep-link to AW) — drop the `adjustmentWorkspaceHref` prop and the deep-link `<Link>`.
- Delete `configureSessionAction`, `createWorkspaceEditId`, and the `applyEdit` / `adjustmentWorkspaceEditSchema` imports from `app/orders/[orderId]/actions.ts`. After this spec, `app/orders/[orderId]/actions.ts` has no `@/modules/adjustment-workspace` import.
- The `adjustment`-mode mount in `pos-package-composition.tsx` is removed; the only file that passed `"adjustment"` was the AW route page (neutralized in P6-1, deleted in P6-5) — ensure no other caller passes it.
- Do **not** delete the AW module/service in this spec (P6-5). After P6-3, the AW service should have no remaining importers in `app/**` or `src/components/**` except the AW route dir itself.
- `writeOrderPackageSelections` and the Spec 135 guard remain untouched (the order-detail page is read-only; its surviving non-AW selection action, if any, keeps the guard).
- No Prisma schema change. No `@/lib/db` in `app/**` or `src/components/**`.

## Scope

### In Scope

- Delete `configureSessionAction` + `createWorkspaceEditId` + the AW imports from `app/orders/[orderId]/actions.ts`.
- `ConfigureSessionPanel`: remove the `adjustment` mode branch, the `adjustmentWorkspaceHref` prop, the href resolver, and the "Edit in Adjustment Workspace" `<Link>`. Keep `commit-staging` (Sales) behavior identical; keep any non-AW `locked` read-only display.
- `pos-package-composition.tsx`: drop `"adjustment"` from `configurePanelMode` and remove the adjustment-mode mount/props.
- `composition-view.model.ts`: collapse `CompositionViewMode` to `"locked"` and remove the `@/modules/adjustment-workspace` type import.
- `orders-table.tsx`: remove the `order.hasOpenAdjustmentWorkspace` open-AW badge (`:66`). Pairs with the P6-2 removal of the service read + type field; if the type field is removed in P6-2, this component edit lands in the same review window to keep the build green.
- Update/remove tests that exercised the order-detail AW configure action or the panel's `adjustment` mode / deep-link.
- Add/extend a source guard: no `@/modules/adjustment-workspace` import or `AdjustmentWorkspace` reference in `app/orders/[orderId]/actions.ts`, `configure-session-panel.tsx`, `pos-package-composition.tsx`, `composition-view.model.ts`, or `orders-table.tsx` (remove these from the P6-1 known-legacy allowlist).
- Wire new/changed tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md`.

### Out of Scope

- Deleting the AW module, route files, route actions, AW components, or AW tests (P6-5).
- `edit-mode-policy` AW fields `shouldOpenAdjustmentWorkspace` / `adjustmentWorkspaceRoute` / `LOCKED_INVOICE_WORKSPACE_REQUIRED` (P6-4) — note the panel's deep-link currently falls back to `editPolicies.financial.routeTarget?.href`; removing the panel link here is independent of removing the policy field in P6-4.
- Dropping AW tables (P6-6).
- Any Sales `commit-staging` behavior change.

## Implementation Direction

These are the last AW couplings on a *non-AW-route* surface. The order-detail page is already read-only ("Open POS"), so `configureSessionAction` is reachable only via the panel binding; deleting the action and the panel's `adjustment` mode + deep-link removes the wiring without losing any live capability (Sales `commit-staging` covers session-config edits per Spec 137). Collapsing `CompositionViewMode` to `"locked"` and removing the `"adjustment"` `configurePanelMode` value makes the type system enforce that AW display modes are gone. Verify the only previous `"adjustment"`-mode mount was the AW route page (a P6-5 target). Tighten the P6-1 source guard by removing the now-clean files from its allowlist.

## Observability Checklist

### Dashboards / Metrics

- None added. Reuse existing Sales session-config staging metrics (`order_commit.session_configuration_edit_staged_from_sales`).

### Rollback Plan

- No schema/migration. Rollback = revert the action/panel/type removals. The AW module is still present (until P6-5), so a revert fully restores the order-detail AW configure path.

### Customer-Visible Surface

- The Configure Session dialog no longer shows an "Edit in Adjustment Workspace" button in locked/financial cases; session-config edits happen on the Sales/POS surface (already the live workflow). No change to the Sales dialog.

## Post-Implementation

- `context/progress-tracker.md` — "Now" line: order-detail AW configure path and the Configure Session AW deep-link/`adjustment` mode removed; `CompositionViewMode` collapsed to `locked`; B2/B3/B5 cleared.
- `context/reviews/unified-order-commit-live-pos-roadmap.md` — Phase 6: mark P6-3 shipped.

## Acceptance Criteria

- `app/orders/[orderId]/actions.ts` has no `@/modules/adjustment-workspace` import and no `configureSessionAction`.
- `ConfigureSessionPanel` has no `adjustment` mode, no `adjustmentWorkspaceHref`, and renders no "Edit in Adjustment Workspace" link; `commit-staging` behavior is unchanged.
- `configurePanelMode` no longer includes `"adjustment"`; no caller passes it.
- `CompositionViewMode` is `"locked"` only; `composition-view.model.ts` has no AW import.
- `orders-table.tsx` no longer reads `hasOpenAdjustmentWorkspace` and renders no open-AW badge; with the P6-2 field removal, `hasOpenAdjustmentWorkspace` exists nowhere in the codebase.
- Sales session-config staging (Spec 137) is functionally unchanged (its tests still pass).
- The source guard now also covers the four cleaned files (removed from the legacy allowlist).
- No AW module/route/test/table deleted; no schema change; no financial behavior change.
- New/changed tests wired into `test:centralization`.
- `npm run test:centralization` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Open Questions

- Whether `ConfigureSessionPanel` still needs a read-only `locked` display at all after the deep-link is removed, or whether locked orders should always render via the Sales surface. Default: keep a read-only locked display (no AW link) to avoid touching non-AW order-detail rendering in this spec.
