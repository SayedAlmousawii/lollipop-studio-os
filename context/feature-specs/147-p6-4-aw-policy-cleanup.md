## Goal

Phase 6 step 4 (P6-4): remove AW affordances from the centralized edit-mode policy and the direct-mutator guard — blocker **B4**. Delete `shouldOpenAdjustmentWorkspace`, `openAdjustmentWorkspaceId`, the `adjustmentWorkspaceRoute` route target, and the `LOCKED_INVOICE_WORKSPACE_REQUIRED` branch from `assertDirectPOSMutationAllowed`, so the policy and guard no longer encode an "open the Adjustment Workspace" path. After this spec the direct-mutator draft guard is the sole gate.

Source of truth: `context/reviews/phase-6-readiness-report.md` (A5, B4; Section C → P6-4). Depends on P6-3 (Spec 146) shipped (the panel/order-detail consumers of these policy fields are already gone).

## Read First

- `context/reviews/phase-6-readiness-report.md` — A5, B4, Section C → P6-4.
- `src/modules/orders/policies/edit-mode-policy.ts`:
  - `:33` — `shouldOpenAdjustmentWorkspace: boolean` on the policy DTO.
  - `:46,238,245` — `openAdjustmentWorkspaceId` input/threading.
  - `:93-166` — branches that set `shouldOpenAdjustmentWorkspace` (`:147` sets `true`) and `routeTarget`.
  - `:254-260` — `adjustmentWorkspaceRoute(orderId)` builder (`/adjustment-workspace` href).
- `src/components/orders/pos-package-composition.tsx:195` — last reader of `shouldOpenAdjustmentWorkspace` (under the Sales OrderCommit overlay, which already neutralizes it).
- `src/modules/session-configurations/session-configuration-selection.service.ts:131,197` — `openAdjustmentWorkspaceId` field passed through the selection-route context (verify it is now display-only / removable).
- `src/modules/orders/order.service.ts`:
  - `:191` — `LOCKED_INVOICE_WORKSPACE_REQUIRED = ORDER_EDIT_MODE_MESSAGES.lockedDirectPOS`.
  - `:209-216` — `assertDirectPOSMutationAllowed(invoice)` throws `LOCKED_INVOICE_WORKSPACE_REQUIRED` when `invoice.isLocked`.
  - `:1233-1234, 1385-1386, 1583-1584, 1701-1702, 1858-1859` — the five mutators that call `assertNoActiveOrderCommitDraft` then `assertDirectPOSMutationAllowed`.
- `src/modules/orders/policies/order-commit-draft-guard.ts` — the surviving draft guard (the sole gate after this spec).
- `src/lib/auth/actor-context.ts:6` — `bypassOrderCommitDraftGuard` (still needed while AW finalize exists; removed in P6-5).

## Rules

- After this spec the edit-mode policy exposes **no** AW concepts: no `shouldOpenAdjustmentWorkspace`, no `openAdjustmentWorkspaceId`, no `adjustmentWorkspaceRoute`, no AW `routeTarget` for locked financial edits.
- The locked-invoice meaning is preserved but de-AW-ified: locked invoices still cannot be directly mutated — but the message/behavior must point at the OrderCommit flow, not "Edit in Adjustment Workspace". Decide whether `assertDirectPOSMutationAllowed` is **removed** (because `assertNoActiveOrderCommitDraft` + the Sales draft→commit flow now fully governs locked edits) or **retained with re-worded copy** that no longer references AW. Prefer removal only if locked direct mutation is provably unreachable on every surviving surface; otherwise retain with non-AW copy.
- `ORDER_EDIT_MODE_MESSAGES.lockedDirectPOS` copy must not mention Adjustment Workspace after this spec.
- Do **not** remove `bypassOrderCommitDraftGuard` yet — AW finalize still uses it until P6-5.
- Do not delete the AW module/route/tables.
- No `@/lib/db` in `app/**` or `src/components/**`. No Prisma schema change.

## Scope

### In Scope

- `edit-mode-policy.ts`: remove `shouldOpenAdjustmentWorkspace`, `openAdjustmentWorkspaceId`, `adjustmentWorkspaceRoute`, and the AW `routeTarget` assignments; simplify the affected branches so the policy describes draft/locked edit affordances without an AW route.
- `pos-package-composition.tsx:195`: remove the `shouldOpenAdjustmentWorkspace` read (the Sales overlay path already ignores it).
- `session-configuration-selection.service.ts`: drop the `openAdjustmentWorkspaceId` field from the selection-route context if it is now unused.
- `order.service.ts`: remove or re-word `LOCKED_INVOICE_WORKSPACE_REQUIRED` / `assertDirectPOSMutationAllowed` per the rule above; update `ORDER_EDIT_MODE_MESSAGES.lockedDirectPOS` copy to remove AW wording.
- Update tests that asserted `shouldOpenAdjustmentWorkspace`, the AW route target, or the AW-worded locked message (e.g. `tests/adjustment-workspace/edit-mode-policy-action.test.ts` — adjust or move; full AW test deletion is P6-5).
- Extend the source guard: `edit-mode-policy.ts`, `pos-package-composition.tsx`, and `order.service.ts` carry no `/adjustment-workspace` href or AW route naming (remove from the legacy allowlist).
- Wire new/changed tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md`.

### Out of Scope

- Deleting the AW module, route, AW components, AW tests, or `bypassOrderCommitDraftGuard` (P6-5).
- Dropping AW tables (P6-6).
- The five direct-mutator `assertNoActiveOrderCommitDraft` guards themselves (they stay; only the AW-route policy fields and the locked-direct message change here).
- Any Sales financial/preview/commit behavior change.

## Implementation Direction

The policy is the centralized source for edit affordances; its `shouldOpenAdjustmentWorkspace`/route fields are the last place the codebase "recommends" opening an AW. With P6-3 done, the only reader is `pos-package-composition.tsx:195`, already overridden by the Sales OrderCommit overlay. Strip the AW fields from the DTO and the branch logic, delete `adjustmentWorkspaceRoute`, and decide the fate of `assertDirectPOSMutationAllowed`: if locked direct mutation is unreachable (Sales routes everything through draft→commit; the five mutators already throw `OrderCommitDraftActiveError` when a draft exists), the guard + message can be removed; if any surviving non-Sales caller could still attempt a locked direct write, keep the guard but re-word the message to reference the commit flow, not AW. Keep `bypassOrderCommitDraftGuard` until AW finalize is deleted in P6-5.

## Observability Checklist

### Dashboards / Metrics

- None added. If `assertDirectPOSMutationAllowed` is retained, keep its existing locked-block log (re-worded).

### Rollback Plan

- No schema/migration. Rollback = revert the policy/guard/message changes. AW module still present until P6-5, so revert restores AW route affordances.

### Customer-Visible Surface

- Any residual UI affordance suggesting "Edit in Adjustment Workspace" for locked financial edits is gone; locked-edit messaging references the POS/commit flow. No change to the Sales workflow itself.

## Post-Implementation

- `context/progress-tracker.md` — "Now" line: edit-mode policy and locked-direct guard no longer reference Adjustment Workspace; B4 cleared; draft guard is the sole mutation gate.
- `context/reviews/unified-order-commit-live-pos-roadmap.md` — Phase 6: mark P6-4 shipped.

## Acceptance Criteria

- `edit-mode-policy.ts` exposes no `shouldOpenAdjustmentWorkspace`, `openAdjustmentWorkspaceId`, `adjustmentWorkspaceRoute`, or AW `routeTarget`.
- No component reads `shouldOpenAdjustmentWorkspace`.
- `ORDER_EDIT_MODE_MESSAGES.lockedDirectPOS` (if retained) contains no "Adjustment Workspace" wording; if removed, no surviving surface allows locked direct mutation.
- The five direct-mutator `assertNoActiveOrderCommitDraft` guards remain in place and pass.
- `bypassOrderCommitDraftGuard` is still present (deleted in P6-5).
- Source guard covers the cleaned policy/service files (removed from legacy allowlist).
- No AW module/route/test/table deleted; no schema change; no financial behavior change.
- New/changed tests wired into `test:centralization`.
- `npm run test:centralization` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Open Questions

- Remove vs retain-with-reworded-copy for `assertDirectPOSMutationAllowed`. Decide by proving whether any surviving caller can attempt a locked direct mutation; record the proof in the PR. Default: retain with non-AW copy (lower risk), defer removal to P6-5 if it becomes provably dead.
