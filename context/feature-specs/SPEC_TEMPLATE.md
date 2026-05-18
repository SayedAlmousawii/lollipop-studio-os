## Goal

One short paragraph describing what the unit achieves.

## Read First

- Spec-specific references only

## Rules

- Unit-specific constraints and guardrails

## Scope

### In Scope

- Explicitly list what this unit changes

### Out of Scope

- Explicitly list what this unit does not change

## Implementation Direction

Describe the desired behavior and point to the existing functions, modules, or patterns to follow.

## Observability Checklist

### Dashboards / Metrics

- What counters, gauges, timers, or discrepancy logs this phase emits

### Rollback Plan

- Schema down-migration shape
- Flag-flip-back behavior
- Non-recoverable data to call out

### Customer-Visible Surface

- What staff or customers will see change

## Post-Implementation

- Docs or trackers that must be updated after completion

## Acceptance Criteria

- Specific, checkable conditions
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes
- `npm run lint` passes
