## Goal

Phase 6 step 2 (P6-2): cut the **only true code blocker** to AW deletion — the canonical order-composition read service still imports the AW service and routes to an AW-derived composition when an open `AdjustmentWorkspace` row exists (Section A → A2 / Section B → B1 of the readiness report). Remove that branch so `getOrderCompositionViewModel` reads operational `Order*` rows exclusively and no longer depends on `modules/adjustment-workspace`.

Source of truth: `context/reviews/phase-6-readiness-report.md` (B1, A2). Depends on P6-1 (Spec 144) shipped.

## Read First

- `context/reviews/phase-6-readiness-report.md` — A2, B1, Section C → P6-2.
- `src/modules/orders/composition/order-composition.service.ts`:
  - `:9-17` — imports `AdjustmentWorkspaceStatus`, `getAdjustmentWorkspaceView`, `getPendingAdjustmentOrderCompositionViewModel` deps, and `AdjustmentWorkspaceEdit` type.
  - `:93-128` — `getPendingAdjustmentOrderCompositionViewModel(workspaceId)` (the AW-snapshot composition path).
  - `:131-160` — `getOrderCompositionViewModel`: the `input.workspaceId` branch (`:133`) and the open-workspace lookup `db.adjustmentWorkspace.findFirst({ status: OPEN })` (`:143`) that routes to AW composition (`:147`).
  - `buildCompositionSnapshotFromAdjustmentSnapshot` and the `AdjustmentWorkspaceEdit`-typed helpers (≈`:464, 664, 766, 892, 977, 1015`).
- `src/modules/orders/composition/index.ts:6-7` — barrel exports `getOrderCompositionViewModel`, `getPendingAdjustmentOrderCompositionViewModel`.
- `app/orders/[orderId]/page.tsx:55,112` — order-detail page calls `getOrderCompositionViewModel({ orderId })` (the live consumer).
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts:32,276` — AW service imports `getPendingAdjustmentOrderCompositionViewModel` back from composition (circular legacy coupling to untangle).
- `context/architecture-context.md` §7.3 — `OrderCompositionViewModel` contract (current ownership = `Order*` rows).

## Rules

- After this spec, `order-composition.service.ts` has **no** `@/modules/adjustment-workspace` import.
- `getOrderCompositionViewModel({ orderId })` must read current operational ownership from `Order*` rows only (the existing `buildCompositionSnapshotFromPOSWorkspace` / `getPOSWorkspace` path). The open-`AdjustmentWorkspace` lookup and the `workspaceId` branch are removed.
- `getPendingAdjustmentOrderCompositionViewModel` and the `AdjustmentWorkspaceEdit`-typed snapshot helpers (`buildCompositionSnapshotFromAdjustmentSnapshot` and its callees) are AW-only. **Move** the ones still needed by the (soon-to-be-deleted) AW route into the AW module, or delete them if the AW route — neutralized in P6-1 and deleted in P6-5 — is their only remaining caller. Prefer deletion where the only caller is AW route/page code already slated for P6-5; otherwise relocate into `src/modules/adjustment-workspace/` to keep the composition module AW-free.
- Break the circular dependency: AW service must not import composition's pending-adjustment helper after this spec (either it owns the relocated helper or the path is gone with P6-5).
- No Prisma schema change. No financial behavior change. AW tables remain.
- No `@/lib/db` imports in `app/**` or `src/components/**`.

## Scope

### In Scope

- Remove from `getOrderCompositionViewModel`: the `input.workspaceId` branch and the `db.adjustmentWorkspace.findFirst({ status: OPEN })` routing; it returns the operational (`Order*`/POS-workspace-derived) composition for `{ orderId }` / `{ invoiceId }` inputs.
- Remove the `@/modules/adjustment-workspace` imports from `order-composition.service.ts`.
- Relocate-or-delete `getPendingAdjustmentOrderCompositionViewModel`, `buildCompositionSnapshotFromAdjustmentSnapshot`, and the `AdjustmentWorkspaceEdit`-typed helpers based on remaining callers (AW route/page only → fold into AW module ahead of its P6-5 deletion, or delete if dead).
- Update `src/modules/orders/composition/index.ts` to stop exporting the removed/relocated AW-only symbols.
- Update the AW service/route imports to consume the relocated helper (if relocated) instead of the composition barrel.
- Tests: order-detail composition for an order returns `Order*`-row ownership with no AW lookup; a guard test asserts `order-composition.service.ts` does not import `@/modules/adjustment-workspace`.
- Update existing composition tests that asserted the open-workspace branch.
- Wire new/changed tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md`.

### Out of Scope

- Deleting the AW module, route, or tables (P6-5/P6-6).
- Order-detail `configureSessionAction`/`applyEdit` removal (P6-3).
- `edit-mode-policy` AW fields (P6-4).
- `CompositionViewMode` collapse (P6-3).
- Any change to Sales composition (already AW-free).

## Implementation Direction

The Sales surface already derives composition from `OrderCommitDraft` snapshots / `Order*` rows and never creates AW rows, so the open-AW branch in `getOrderCompositionViewModel` is dead-in-practice but still compiled and still couples the composition module to AW. Delete the `workspaceId` branch and the `findFirst({ OPEN })` lookup; keep the `{ orderId }`/`{ invoiceId }` → `getPOSWorkspace` → `buildCompositionSnapshotFromPOSWorkspace` path as the sole route. For the AW-only snapshot helpers, check remaining callers: if only the AW route/page (P6-5 deletion targets) and AW service use them, relocate them into `src/modules/adjustment-workspace/` so composition is AW-free now and they disappear with the module in P6-5; delete outright anything already callerless. Add a source guard asserting the no-AW-import invariant on the composition module so it can't regress.

## Observability Checklist

### Dashboards / Metrics

- None added. Removal of a dead read branch; no new counters.

### Rollback Plan

- No schema/migration. Rollback = revert the branch removal and import changes. Because dev data resets and production has no open AW rows, no data path depends on the removed branch.

### Customer-Visible Surface

- None expected. Order-detail composition already reflects `Order*` rows; this removes a branch that only triggered for open AW rows, which the live workflow no longer creates.

## Post-Implementation

- `context/progress-tracker.md` — "Now" line: order-composition read model is AW-free; `getOrderCompositionViewModel` reads `Order*` rows only; B1 cleared.
- `context/reviews/unified-order-commit-live-pos-roadmap.md` — Phase 6: mark P6-2 shipped.

## Acceptance Criteria

- `order-composition.service.ts` contains no `@/modules/adjustment-workspace` import (guard test enforces it).
- `getOrderCompositionViewModel({ orderId })` returns `Order*`-row composition with no `adjustmentWorkspace` query.
- The order-detail page renders composition unchanged for orders with no AW rows (i.e. all live orders).
- AW-only composition helpers are relocated into the AW module or deleted; the composition barrel no longer exports them.
- No circular import remains between composition and the AW service.
- No AW module/route/table deleted; no schema change; no financial behavior change.
- New/changed tests wired into `test:centralization`.
- `npm run test:centralization` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Open Questions

- Relocate vs delete for `buildCompositionSnapshotFromAdjustmentSnapshot` & friends: decide by caller analysis during implementation. If the AW route (P6-1-neutralized) is the sole consumer, deletion-with-P6-5 is cleaner than relocation. Document the choice in the PR.
