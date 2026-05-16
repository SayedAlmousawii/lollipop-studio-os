## Goal

Identify which workflow guard errors are reachable through the normal UI despite disabled buttons or pre-checks, then add typed error classes and contextual UI handling only for those cases.

---

## Read First

- `context/reviews/workflow-guard-audit.md`
- `src/modules/orders/order.service.ts` — read the guard logic in the production and delivery sections, and how `canMarkReadyForPickup` and `canCompleteOrder` are computed
- `src/components/orders/production-workflow-form.tsx`
- `src/components/orders/delivery-workflow-form.tsx`

---

## Rules

- No schema changes
- Add typed errors only where an error is genuinely UI-reachable
- If the UI already perfectly pre-blocks an action, a typed error for that case has no value — skip it
- Build any contextual error UI inside this unit, not separately
- Keep the typed error class minimal — one class, a `code` discriminant, no inheritance hierarchy

---

## Background

All current guard failures throw `new Error("string")` and surface in the UI as `errors._global[0]`. This is acceptable when the guard can never fire through the UI (button is disabled or the action is pre-blocked). It becomes a problem when a guard CAN fire despite the UI — the user sees a raw error string with no contextual action.

P4 from the guard audit: "Audit which guard errors are actually reachable through the UI. Add typed errors and contextual error UI handling only for those."

---

## Reachability Audit

Start by performing this audit before writing any code. For each guard in `order.service.ts`, trace whether it can fire through normal UI interaction — including race conditions and session edge cases. The result of this audit should drive exactly which guards get a typed error and which form gets contextual rendering.

### Guards that are likely NOT UI-reachable

Read the code to confirm, but these are expected to be pre-blocked by the UI:
- `assertEditingReadyToStart()` — editing tab disables actions until all prerequisites are met
- `assertWorkflowTransition()` for all status machines — actions are only offered for valid next states
- Editing prerequisite for `READY_FOR_PICKUP` (52a) — `canMarkReadyForPickup` already gates the button
- Assembly prerequisite (52b) — the assembly action button is suppressed when albumDesign is not done

If the audit confirms a guard is truly pre-blocked, a typed error there has no value. Do not add contextual handling for it.

### Guards that appear UI-reachable

These are expected to be reachable through normal form submission:

**Payment override path in `completeOrder`**
`canCompleteOrder` is enabled when the only blocker is unsettled payment — the form shows an override section in that state. Two guard errors can fire through this form path: one if the override is not explicitly allowed, and one if the override reason is missing. Read the form and the service together to confirm exactly which field controls each check.

**Actor missing for delivery completion**
If `actorUserId` is absent from the actor context when `completeOrder` runs, a guard throws. This is reachable when a session expires between page load and form submission. The current error message is accurate but falls into the generic `_global` banner with no recovery prompt.

### Verdict

Confirm the above during the audit. If additional guards from 52a or 52b turn out to be reachable in the actual UI after reading the code, include them in this unit too.

---

## Scope

### In Scope

1. Define a typed error class with a `code` discriminant for guard failures that are UI-reachable
2. Replace the relevant plain `throw new Error(...)` calls with typed errors — only for the cases confirmed UI-reachable by the audit
3. Update the server action wrapping `updateOrderDeliveryWorkflow` to propagate the error code back to the client alongside the message
4. Update `delivery-workflow-form.tsx` to detect the error code and render contextual output near the affected section, rather than only the generic `_global` banner

### Out of Scope

- Typed errors for guards that are perfectly pre-blocked by the UI
- Multiple typed error classes — one class, discriminated by code
- Changes to `order.service.ts` guard logic (that belongs to 52a/52b)

---

## Implementation Direction

Read `src/modules/orders/order.service.ts` and the two form components before designing anything.

**Typed error class**
Look for whether the project already has a convention for typed application errors (check `order.types.ts`, any `errors.ts` files, or similar). If a pattern exists, follow it. If not, define a minimal class that carries a `code` string alongside the standard `Error` message. The class name and code values should be self-explanatory to a future reader of the service code.

**Replacing the throws**
Only touch the guard throws confirmed UI-reachable by the audit. Each affected throw becomes a typed error with a code that the form can branch on. Keep the message unchanged — it should still be staff-readable prose.

**Server action propagation**
Read how the server action currently catches errors and maps them to `errors._global`. Extend that catch block to detect the typed error class and include the `code` in the returned state — alongside `_global`, not replacing it. The `_global` message should still render as the fallback for any caller that does not handle codes.

**Contextual rendering in `delivery-workflow-form.tsx`**
Read the form to understand how `state.errors._global` is currently rendered. When a guard code is present in the state, render additional contextual output near the relevant field section:
- For payment override errors: surface the issue near the override section, not only at the top of the form
- For actor/session errors: show a prompt that tells the user to reload or re-authenticate

Do not remove the `_global` rendering — it remains the fallback.

---

## Post-Implementation

**`context/progress-tracker.md`**
- Update Now section: Feature 52c complete; next is 52e
- Add to Feature History: "Feature 52c: Typed guard errors — UI-reachable payment override and actor-missing guard failures now surface contextual prompts instead of only raw global error banners."

---

## Acceptance Criteria

1. A typed error class with a `code` field exists and is used for UI-reachable guard failures
2. The UI-reachable guard throws in `order.service.ts` are replaced with typed errors
3. The server action propagates the error code back to the client alongside the message
4. `delivery-workflow-form.tsx` renders contextual output when a guard code is present
5. The generic `_global` error banner still renders as fallback for errors without a code
6. TypeScript passes
7. `npm run build` passes
8. `npm run lint` passes
9. Update `context/progress-tracker.md`
