## Goal

Fix two guard bugs in the order workflow and enforce the architectural principle that each step requires the previous step to be complete before proceeding.

---

## Read First

- `context/reviews/workflow-guard-audit.md`

---

## Rules

- No schema changes
- No new error classes
- No UI component changes
- Business rule enforcement lives in service functions, not server actions or UI
- Error messages must be staff-readable and actionable

---

## Background

Two bugs exist in `src/modules/orders/order.service.ts` plus one unverified gap:

**Bug 1 — Delivery guard incorrectly enforces all sections complete (P1b)**
`isProductionReadyForDelivery` checks that every production section is individually `COMPLETED` before allowing delivery. This is wrong — `productionStatus = READY_FOR_PICKUP` is the production team's deliberate judgment that the job is ready, regardless of individual section states. Not all sections are required for every job.

**Bug 2 — No editing prerequisite for production readiness (P1)**
Nothing prevents production from being marked `READY_FOR_PICKUP` while editing is still `IN_PROGRESS` or `REVISION_REQUESTED`. Since delivery trusts production readiness, the editing check must live at the production gate.

**Gap — Duplicate record creation not handled gracefully (P5)**
`EditingJob` and `ProductionJob` have DB-level `@unique` on `orderId`, but the service may not catch the unique constraint violation cleanly on creation. Verify and fix if needed.

---

## Scope

### In Scope

1. Fix `isProductionReadyForDelivery` — remove the all-sections check; `productionStatus = READY_FOR_PICKUP` or `COMPLETED` is sufficient
2. Update `resolveDeliveryCompletionBlockers` — the blocker message should no longer reference "all sections"
3. Add editing prerequisite to `markProductionReadyForPickup` in `resolveProductionUpdate` — editing must be `APPROVED` or `COMPLETED`
4. Update `canMarkReadyForPickup` in `mapOrderProductionWorkflow` — the button must be disabled when editing is not yet done
5. Update `resolveProductionReadinessWarning` — surface a warning when production is in progress but editing is incomplete
6. Verify `EditingJob` and `ProductionJob` creation handles unique constraint errors cleanly — follow the existing pattern in `invoice.service.ts` if a gap is found

### Out of Scope

- Changes to `deliveryOrderSelect` — the editing check belongs at the production level, not delivery
- New typed error classes
- UI component changes
- Permission changes

---

## Implementation Direction

All changes are in `src/modules/orders/order.service.ts`. Read the file before writing anything — understand how each function is currently structured before deciding where the fix lands.

**Fix 1: `isProductionReadyForDelivery`**
This function currently has two conditions: a production status check and a section-completeness check. The section-completeness check is the bug. Remove it. `productionStatus = READY_FOR_PICKUP` or `COMPLETED` is the only condition that should matter here — that status was set deliberately by the production team. After removing the check, verify whether `hasIncompleteDeliveryProductionSections` still has any callers. If not, delete it.

**Fix 2: `resolveDeliveryCompletionBlockers`**
The blocker message for unsettled production currently references "all sections." Rewrite it to reflect the correct rule: production must be ready for pickup or completed, without any section language.

**Fix 3: Editing prerequisite in `markProductionReadyForPickup`**
Inside the `resolveProductionUpdate` switch, the `markProductionReadyForPickup` case has no editing check. Add one at the top of the case, before any data is returned. The `ProductionOrderState` already includes `editingJob.status` — no query change is needed. The rule: `editingStatus` must be `APPROVED` or `COMPLETED`. If it is not, throw with a clear staff-readable message explaining what is blocking.

**Fix 4: `canMarkReadyForPickup` in `mapOrderProductionWorkflow`**
This flag controls whether the "Ready for pickup" button is enabled. It currently only checks order/production status. Add an editing status condition to it so the button is disabled when editing is not `APPROVED` or `COMPLETED`. Follow the existing boolean structure in that function.

**Fix 5: `resolveProductionReadinessWarning`**
This function returns an early warning string for the production tab. Add a check: if editing is not yet `APPROVED` or `COMPLETED`, return a warning message before reaching any existing checks. The editing check should be first so it surfaces before section warnings.

**Fix 6: Duplicate record creation for `EditingJob` and `ProductionJob`**
Locate where each is created in the service. Check whether a Prisma unique constraint error (`P2002`) is caught and re-surfaced as a clean message. If not, apply the same catch-and-re-check pattern already used in `invoice.service.ts` for the same scenario.

---

## Post-Implementation

**`context/progress-tracker.md`**
- Update Now section: Feature 52a complete; next is 52b
- Add to Feature History: "Feature 52a: Production readiness guard — editing prerequisite for READY_FOR_PICKUP; delivery guard bug fix; duplicate record error handling."

---

## Acceptance Criteria

1. Marking production `READY_FOR_PICKUP` throws a clear error when `editingStatus` is not `APPROVED` or `COMPLETED`
2. The `READY_FOR_PICKUP` button is disabled in the UI when editing is not complete
3. A warning is shown on the production tab when editing is incomplete
4. Delivery completion succeeds when `productionStatus = READY_FOR_PICKUP` even if some sections are not individually completed
5. Delivery completion blocker no longer mentions "all sections complete"
6. Attempting to create a duplicate `EditingJob` or `ProductionJob` surfaces a clean error, not a raw DB crash
7. TypeScript passes
8. `npm run build` passes
9. `npm run lint` passes
10. Update `context/progress-tracker.md`
