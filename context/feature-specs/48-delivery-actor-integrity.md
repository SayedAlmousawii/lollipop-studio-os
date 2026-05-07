## Goal

Tighten delivery actor integrity by replacing loose completion-actor storage with a real staff reference where the acting user is known.

---

## Read First

- `agents.md`
- `context/project-overview-summary.md`
- `context/architecture-summary.md`
- `context/reviews/current-database-er-diagram.md`
- `context/feature-specs/33-delivery-workflow-tab.md`

---

## Rules

- Preserve existing delivery behavior unless a tighter integrity rule is required to reflect current intended logic
- Keep this unit narrowly focused on delivery actor tracking
- Prefer FK-backed and explicit schema rules over free-text workflow-critical fields
- Avoid broad workflow redesign in this unit
- Update `context/reviews/current-database-er-diagram.md` if the implemented schema shape changes

---

## Scope

### In Scope

- Formalize `deliveryCompletedBy` as a real actor reference if it represents a staff user
- Add constraints, indexes, or validations needed to make delivery actor storage safer
- Keep current delivery flows working after migration

### Out of Scope

- Invoice ownership tightening
- Reworking delivery status meanings
- Rebuilding the delivery UI
- Permissions redesign

---

## Required Schema Direction

- replace loose `Order.deliveryCompletedBy String?` with a user-linked field such as `deliveryCompletedById`
- preserve legacy completion text only if an exact actor mapping is impossible and that legacy context is still needed

If some transitional fallback field must remain briefly, it should not stay the active source of truth once the user-linked field exists.

---

## Migration Direction

- backfill delivery actor references safely where current stored values map to known users
- preserve legacy completion text only if an exact actor mapping is impossible

Do not silently discard legacy delivery/completion context.

---

## Service Layer

Expected service behavior:

- delivery completion writes a stable actor reference when available
- read models continue to expose clear delivery metadata to current pages

This unit should make current intended actor attribution stricter, not invent new business steps.

---

## Acceptance Criteria

- Delivery completion actor data is no longer stored as an unstructured workflow-critical string unless preserved only as legacy fallback context
- Current delivery flows still work after migration
- No intentional business-flow redesign is introduced
- `context/reviews/current-database-er-diagram.md` is updated if the implemented schema changes its described structure
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Migration deploy/status checks pass
- Update `context/progress-tracker.md`

---

## Assumptions

- Delivery completion should ultimately attribute to a real staff user when the acting user is known
