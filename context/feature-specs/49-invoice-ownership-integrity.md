## Goal

Make invoice ownership rules explicit and enforced so booking/order/customer linkage matches the software’s intended current business flow.

---

## Read First

- `agents.md`
- `context/project-overview-summary.md`
- `context/architecture-summary.md`
- `context/reviews/current-database-er-diagram.md`
- `context/reviews/identifier-architecture-review.md`
- `context/feature-specs/34-financials-activity-tabs.md`

---

## Rules

- Preserve existing invoice/payment business behavior unless a tighter integrity rule is required to reflect current intended logic
- Keep invoice and payment identity separate
- Keep this unit narrowly focused on invoice ownership integrity
- Avoid broad financial redesign in this unit
- Update `context/reviews/current-database-er-diagram.md` if the implemented schema shape changes

---

## Scope

### In Scope

- Tighten invoice linkage expectations between booking/order/customer ownership
- Add constraints, indexes, or validations that make current intended invoice relationships safer
- Keep current invoice and payment flows working after migration

### Out of Scope

- Reworking invoice totals or payment formulas
- Replacing invoice adjustment chains
- Rebuilding the financials UI
- Permissions redesign
- Full audit-log redesign

---

## Required Schema Direction

This unit should address at least these review findings:

- clarify whether an invoice must belong to a booking, an order, or both in allowed scenarios
- enforce the chosen invoice ownership rule in schema/service validation where practical

If some invoice rule cannot be expressed purely in Prisma schema constraints, service-layer validation must make the rule explicit and unavoidable.

---

## Migration Direction

- normalize invoice ownership data to the selected valid patterns before tightening constraints

Do not silently discard legacy invoice context.

---

## Service Layer

Expected service behavior:

- invoice creation/update paths validate the intended ownership combination consistently
- read models continue to expose clear invoice context to current pages

This unit should make current intended rules stricter, not invent new business steps.

---

## Acceptance Criteria

- Invoice ownership rules are explicit and enforced consistently
- Current invoice and payment flows still work after migration
- No intentional business-flow redesign is introduced
- `context/reviews/current-database-er-diagram.md` is updated if the implemented schema changes its described structure
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Migration deploy/status checks pass
- Update `context/progress-tracker.md`

---

## Assumptions

- The current software already has an intended invoice ownership pattern even if the schema has not enforced it yet
