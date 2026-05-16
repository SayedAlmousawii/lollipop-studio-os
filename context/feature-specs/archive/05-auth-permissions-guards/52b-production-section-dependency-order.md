## Goal

Enforce section dependency order within the production workflow so that downstream sections cannot be started before their upstream prerequisites are completed.

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

The guard audit identified two related gaps at priority P2:

**P2a — No section dependency order enforcement**
Assembly (`assemblyStatus`) depends on album design (`albumDesignStatus`) being completed first. Nothing currently prevents assembly from being started or completed while album design is still in progress or not started. This creates a logical inconsistency — you cannot bind an album that has not been designed.

**P2b — No deliverable-driven required sections enforcement**
Which sections are required depends on what deliverables the order carries (e.g. album add-on requires albumDesign + assembly). This is deferred — the link between `OrderAddOnOption.category` and required production sections is not yet modeled in the schema. Do not implement P2b in this unit.

This unit implements P2a only.

---

## Scope

### In Scope

1. Guard assembly start — `markAssemblyStarted` throws if `albumDesignStatus` is not `COMPLETED`
2. Guard assembly completion — `markAssemblyCompleted` throws if `albumDesignStatus` is not `COMPLETED`
3. Guard `READY_FOR_PICKUP` — if `assemblyStatus` is not `NOT_STARTED`, `albumDesignStatus` must be `COMPLETED`
4. UI signal — the assembly section's action button should be suppressed when the albumDesign prerequisite is not met; this is controlled through the existing `canUpdateProduction` mechanism in `buildProductionSections`, not through UI components
5. Warning — `resolveProductionReadinessWarning` surfaces an early warning when assembly is active but albumDesign is not completed

### Out of Scope

- P2b: deliverable-driven required sections (schema support required first)
- Changes to delivery guards
- New typed error classes
- UI component changes

---

## Dependency Rule

Only one dependency rule is in scope for this unit:

```text
albumDesignStatus = COMPLETED  →  required before assemblyStatus can advance past NOT_STARTED
```

This rule fires at:
- `markAssemblyStarted` (blocks start)
- `markAssemblyCompleted` (blocks completion even if somehow started)
- `markProductionReadyForPickup` (blocks READY_FOR_PICKUP if assembly advanced without albumDesign being done)

---

## Implementation Direction

All changes are in `src/modules/orders/order.service.ts`. Read the file before writing anything — understand how existing guards are structured in `resolveProductionUpdate` and how `buildProductionSections` controls which section buttons are enabled.

**Assembly case guards in `resolveProductionUpdate`**
The `markAssemblyStarted` and `markAssemblyCompleted` cases currently return a production section update with no prerequisite check. Before each returns, check whether `albumDesignStatus` is `COMPLETED` on the production job. If it is not, throw with a staff-readable message. Read the existing guard pattern used in other cases of this switch (e.g. the editing prerequisite added in 52a) and follow it consistently.

**`markProductionReadyForPickup` guard**
This case (already modified in 52a for the editing prerequisite) needs a second check for the dependency order: if `assemblyStatus` is anything other than `NOT_STARTED`, then `albumDesignStatus` must be `COMPLETED`. If the condition is not met, throw before returning the update. This guard only fires when assembly was actually used — orders that never touched assembly are not affected.

**`buildProductionSections` — suppress assembly action when prerequisite not met**
Read how `buildProductionSections` currently passes `canUpdateProduction` into `productionSection()` to control whether each section's action button is enabled. Apply the same mechanism to gate the assembly section on whether albumDesign is completed. Compute this from the order state already available in `buildProductionSections` — no extra query is needed. The goal is to disable the assembly start/complete button in the UI when albumDesign is not done, without changing any UI component.

**`resolveProductionReadinessWarning`**
This function returns an early warning string. Add a check: if assembly is active (not `NOT_STARTED`) but albumDesign is not yet `COMPLETED`, return a warning message. Position this check after the editing-incomplete warning already present (added in 52a).

---

## Post-Implementation

**`context/progress-tracker.md`**
- Update Now section: Feature 52b complete; next is 52c
- Add to Feature History: "Feature 52b: Section dependency order — albumDesign prerequisite enforced before assembly can start, complete, or contribute to READY_FOR_PICKUP."

---

## Acceptance Criteria

1. `markAssemblyStarted` throws a clear error when `albumDesignStatus` is not `COMPLETED`
2. `markAssemblyCompleted` throws a clear error when `albumDesignStatus` is not `COMPLETED`
3. `markProductionReadyForPickup` throws when assembly has been used but albumDesign is not completed
4. `markProductionReadyForPickup` does not throw for orders where assembly was not touched (`NOT_STARTED`)
5. The assembly action button is disabled in the UI when albumDesign is not yet complete
6. A warning is visible on the production tab when assembly is active but albumDesign is incomplete
7. TypeScript passes
8. `npm run build` passes
9. `npm run lint` passes
10. Update `context/progress-tracker.md`

---

## Assumptions

- Assembly sections are optional — if `assemblyStatus` is `NOT_STARTED` at `READY_FOR_PICKUP`, no dependency check is needed
- The dependency rule is one-directional: albumDesign → assembly only; printing, vendor, and framedPrints have no enforced dependency on each other in this unit
- P2b (deliverable-driven required sections) remains deferred until schema changes are in place
