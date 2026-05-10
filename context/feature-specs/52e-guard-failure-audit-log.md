## Goal

Log attempted workflow transitions that are blocked by high-risk guards, so staff can see a complete audit trail of not just what succeeded but what was attempted and rejected.

---

## Read First

- `context/reviews/workflow-guard-audit.md`
- `src/modules/orders/order-activity.service.ts` — understand `recordOrderActivity` and the `RecordOrderActivityInput` interface
- `src/modules/orders/order.service.ts` — read the `completeOrder` and `markProductionReadyForPickup` cases; understand the transaction structure and where guards throw
- `src/components/orders/activity-tab-content.tsx` — understand how `ACTIVITY_TYPE_LABELS` and filter groups are structured
- `prisma/schema.prisma` — read the `OrderActivityType` enum

---

## Rules

- High-risk guard failures only — not every thrown error
- The audit log write must happen outside the failed transaction — a transaction that rolls back takes any writes inside it with it
- `actorUserId` may be null; log it regardless
- Keep metadata structured and machine-usable — include only fields relevant to the specific block
- This unit requires a schema migration to add the new `GUARD_BLOCKED` activity type

---

## Background

Guard failures throw and stop execution but leave no trace. Only successful transitions are logged. P6 from the guard audit: "Guard failures throw and stop execution but leave no trace in the activity log. Only successful transitions are logged. Not all failures are worth logging — only high-risk attempted transitions matter for accountability."

---

## What to Log

Log these specific guard failures only:

| Attempted Action | Guard That Fired |
|---|---|
| `completeOrder` | Payment not settled and override not allowed |
| `completeOrder` | Override reason missing |
| `completeOrder` | Actor (staff user) missing from context |
| `markProductionReadyForPickup` | Editing not approved or completed (52a) |
| `markProductionReadyForPickup` | Assembly active, albumDesign not completed (52b) |

Do not log:
- `assertWorkflowTransition()` failures — these indicate a UI or logic bug, not a deliberate staff action
- `assertEditingReadyToStart()` — pre-blocked by UI; not a high-risk actor decision
- Generic DB or validation errors

---

## Scope

### In Scope

1. Add `GUARD_BLOCKED` to the `OrderActivityType` enum in `prisma/schema.prisma` and run the migration
2. Add a helper in `order-activity.service.ts` for writing guard-blocked activity records — modeled after the existing `recordOrderActivity` function but using the top-level `db` client, never a transaction client
3. In `order.service.ts`, catch the specific guard failures listed above at the exported function level and write a `GUARD_BLOCKED` activity record before re-throwing
4. Update `activity-tab-content.tsx` — add `GUARD_BLOCKED` to `ACTIVITY_TYPE_LABELS` and include it in an appropriate filter group

### Out of Scope

- Logging every thrown error
- New UI for filtering blocked events — the existing Activity tab already renders all types
- Guard failure logging in booking or invoice flows

---

## Schema Change

Add `GUARD_BLOCKED` to the `OrderActivityType` enum in `prisma/schema.prisma`. Run a migration with a descriptive name. No other schema changes are needed.

---

## Implementation Direction

Read `order-activity.service.ts` to understand the existing `recordOrderActivity` helper before adding a new one. Read the `order.service.ts` transaction structure for `updateOrderDeliveryWorkflow` and `updateOrderProductionWorkflow` before deciding where the catch goes.

**Helper in `order-activity.service.ts`**
Add a helper specifically for guard-blocked records. It must use the top-level `db` client — not a transaction client — because the transaction that caused the guard failure has already rolled back by the time this runs. Read how `recordOrderActivity` is implemented and follow the same pattern, using the new `GUARD_BLOCKED` type. Include the attempted action name, the blocking reason, and relevant state fields in metadata. Keep metadata minimal — only fields that help a future reader understand what was attempted and why it was blocked.

**Catch and log in the exported service functions**
The guards in `markProductionReadyForPickup` and `completeOrder` throw inside `db.$transaction`. Writes inside a rolled-back transaction are lost, so the log must happen in a catch block that wraps the transaction call at the exported function level, not inside it.

Read the current try/catch structure of `updateOrderProductionWorkflow` and `updateOrderDeliveryWorkflow`. Add a top-level catch that distinguishes the specific guard errors to log from generic errors — use the error message or, if 52c has already been implemented, the typed error class. After writing the activity record, re-throw the original error so the caller's error handling is unaffected.

Only catch and log the specific guard failures listed in "What to Log." Let all other errors propagate without logging a `GUARD_BLOCKED` record.

**`activity-tab-content.tsx`**
Read the file to understand how `ACTIVITY_TYPE_LABELS` is keyed and how filter groups are structured. Add `GUARD_BLOCKED` with a staff-readable label. Place it in the existing filter group that best fits (e.g., workflow events) — do not add a new filter group unless none of the existing ones are appropriate.

---

## Post-Implementation

**`context/progress-tracker.md`**
- Update Now section: Feature 52e complete; next is 52f
- Add to Feature History: "Feature 52e: Guard-blocked audit log — GUARD_BLOCKED activity type added; high-risk guard failures for delivery completion and production readiness now recorded in the order activity timeline."

---

## Acceptance Criteria

1. `GUARD_BLOCKED` is a valid `OrderActivityType` value (schema + migration)
2. Attempting `completeOrder` with unsettled payment and no override writes a `GUARD_BLOCKED` activity record
3. Attempting `completeOrder` with no override reason writes a `GUARD_BLOCKED` activity record
4. Attempting `markProductionReadyForPickup` while editing is incomplete writes a `GUARD_BLOCKED` activity record
5. Attempting `markProductionReadyForPickup` with assembly active but albumDesign incomplete writes a `GUARD_BLOCKED` activity record
6. Successful transitions are unaffected — no spurious `GUARD_BLOCKED` records on success
7. The Activity tab renders `GUARD_BLOCKED` events without crashing
8. TypeScript passes
9. `npm run build` passes
10. `npm run lint` passes
11. Update `context/progress-tracker.md`
