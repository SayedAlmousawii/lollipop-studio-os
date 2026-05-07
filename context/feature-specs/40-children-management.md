## Goal

Allow customer profiles to create and update linked child records using the existing `Child` model.

---

## Read First

- `agents.md`
- `context/feature-specs/39-customer-detail-profile-page.md`
- `context/reviews/customers-page-gap-review.md`

---

## Rules

- Use only fields already supported by the current `Child` model
- Keep child management owned by the customer module
- Do NOT redesign booking workflows in this unit
- Do NOT add new schema fields without explicit approval

---

## Scope

### In Scope

- Add child create flow
- Add child edit flow
- Render children list inside the customer profile
- Support the current child fields:
  - `name`
  - `dateOfBirth`
- Persist child records linked to the customer
- Expose child records in a shape future booking flows can reuse later

### Out of Scope

- Booking workflow changes that persist a child selection onto a booking
- Orders, invoices, or payment logic
- Loyalty or marketing integrations
- Additional child profile fields not present in the current schema

---

## Implementation Direction

Recommended additions:

- child validation schema in the customer module or a dedicated child schema file
- child create/update server actions
- customer profile UI for:
  - add child
  - edit child
  - view current children

The UI can be inline, drawer-based, or route-based depending on what best matches the existing app patterns. Keep it simple and reviewable.

---

## Customer Profile Integration

After this unit:

- the customer profile should show actual child names instead of only counts
- staff should be able to add a new child without leaving the customer area
- future booking work should be able to consume these child records as selectable customer-owned entities

Do not attempt to retrofit booking persistence for child linkage unless a later approved unit covers that explicitly.

---

## Acceptance Criteria

- Staff can add a child from the customer profile
- Staff can edit an existing child from the customer profile
- Child records save against the correct customer
- The profile page shows the updated child list after save
- Validation errors surface clearly
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Update `context/progress-tracker.md`

---

## Assumptions

- The first release is limited to the existing `Child` model fields: `name` and optional `dateOfBirth`
- Any booking-side child selector can be deferred to a later booking-focused unit as long as customer-owned child data is now available
