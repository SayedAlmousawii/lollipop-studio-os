## Goal

Replace `Order.addOns` JSON storage with structured persisted add-on rows so selected add-ons become queryable, auditable, and safer to evolve.

---

## Read First

- `agents.md`
- `context/project-overview-summary.md`
- `context/target-data-model.md`
- `context/reviews/current-database-er-diagram.md`
- `context/reviews/identifier-architecture-review.md`
- `context/feature-specs/26-order-package-changes-invoice-sync.md`
- `context/feature-specs/30-selection-workflow-tab.md`

---

## Rules

- Preserve current pricing behavior and invoice sync behavior unless a schema change requires a mechanical service update
- Keep this unit focused on add-on persistence structure
- Snapshot historical add-on pricing/details at time of selection
- Do NOT turn this into a package catalog redesign
- Keep current selection workflow behavior intact for staff
- Update `context/reviews/current-database-er-diagram.md` if the implemented schema shape changes

---

## Scope

### In Scope

- Add a structured order-owned add-on table/model
- Persist chosen add-ons as rows instead of raw order JSON
- Preserve enough snapshot data so historical invoice/order meaning does not change if catalog options are edited later
- Update service-layer add-on writes and reads
- Backfill existing JSON add-ons into structured rows

### Out of Scope

- Redesigning package templates
- Repricing historical records
- Reworking extra-photo business logic beyond storage compatibility
- Building advanced add-on analytics dashboards

---

## Required Schema Direction

Create an `OrderAddOn`-style structure with fields similar to:

- `id`
- `orderId`
- `addOnOptionId` nullable for catalog linkage
- `nameSnapshot`
- `priceSnapshot`
- `quantity`
- `notes` nullable
- timestamps as needed

The persisted row must remain understandable even if the source add-on catalog entry later changes or is deleted.

---

## Migration Direction

- Backfill existing `Order.addOns` JSON entries into structured rows
- Keep invoice totals and order summaries consistent during migration
- Remove or deprecate the old JSON field only after structured reads/writes are stable

If current JSON contains mixed shapes, normalize conservatively and document any unsupported legacy shapes.

---

## Service Layer

Expected service behavior:

- selection/add-on update flows should write structured rows
- invoice recalculation should read from structured add-on data
- order read models should expose add-ons in the same practical shape the current UI needs

Do not duplicate pricing formulas across migration helpers and runtime services.

---

## Acceptance Criteria

- Order add-ons are stored as structured rows
- Historical add-on name/price meaning is preserved through snapshot fields
- Existing add-on editing flows still work after migration
- Invoice/order calculations remain consistent
- `Order.addOns` JSON is no longer the active source of truth
- `context/reviews/current-database-er-diagram.md` is updated if the implemented schema changes its described structure
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Migration deploy/status checks pass
- Update `context/progress-tracker.md`

---

## Assumptions

- The current add-on option catalog remains the selectable source, while the order-owned add-on rows become the transactional historical record
- Extra-photo handling may continue to use the existing business rule as long as persisted storage becomes structured
