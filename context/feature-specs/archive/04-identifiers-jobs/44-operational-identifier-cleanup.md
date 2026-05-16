## Goal

Align the identifier model with the product direction: `jobNumber` is the only staff-facing operational ID, while booking/order record-level public IDs become transitional internals rather than ongoing product language.

---

## Read First

- `agents.md`
- `context/reviews/identifier-architecture-review.md`
- `context/project-overview-summary.md`
- `context/feature-specs/24-public-ids-and-job-number.md`
- `context/feature-specs/42-job-entity-booking-foundation.md`
- `context/feature-specs/43-downstream-jobid-adoption.md`

---

## Rules

- Do NOT change the underlying booking/order/payment workflow in this unit
- Keep invoice and payment identifiers separate from operational job identity
- Treat `jobNumber` as the single staff-facing operational reference
- Prefer deprecation and compatibility steps before destructive field removal
- Update `context/reviews/current-database-er-diagram.md` if the implemented schema shape or identifier inventory changes

---

## Scope

### In Scope

- Remove booking/order public identifiers from the long-term staff-facing design
- De-emphasize or remove employee-facing usage of `Booking.publicId` and `Order.publicId`
- Evaluate and likely retire `Invoice.publicId` if `invoiceNumber` already covers the finance-facing need
- Update search/read expectations so operational flows use `jobNumber`
- Define compatibility rules for any remaining internal references during transition

### Out of Scope

- Changing invoice numbering
- Changing payment numbering
- Merging invoice and payment identity
- Rebuilding the entire order/bookings UI
- Large workflow or permission changes

---

## Identifier Direction

The intended long-term roles are:

- `jobNumber` = shared operational identifier for staff
- `invoiceNumber` = finance-facing invoice identifier
- `Payment.publicId` = finance-facing payment/receipt identifier
- raw `id` fields = internal database identity

The following should be treated as deprecated/transitional:

- `Booking.publicId`
- `Order.publicId`
- likely `Invoice.publicId`

This means new features should stop depending on them as primary product concepts even if they still exist briefly for compatibility.

---

## Required Changes

This unit may include some combination of:

- schema deprecation/removal planning for `Booking.publicId` and `Order.publicId`
- removal of employee-facing reliance on those fields in read/search contracts
- invoice search cleanup so `invoiceNumber` remains the finance-facing invoice reference
- compatibility redirects or service lookups if any routes still depend on older identifiers

If field removal is performed here, do it only after confirming current code no longer requires the values.

If field removal is too risky in one pass, this unit may instead:

- mark the fields as deprecated in code/docs
- remove them from active service/UI usage
- leave the final schema drop to an immediately-following cleanup migration

---

## Service Layer

Expected service behavior:

- booking and order read/search paths should prefer `jobNumber`
- invoice read/search paths should prefer `invoiceNumber` and `jobNumber`
- no new service should be designed around `Booking.publicId` or `Order.publicId`

Do not create new public-id generation logic for identifiers that are being retired.

---

## Acceptance Criteria

- The product-level identifier policy is clear and consistent in code-facing behavior
- `jobNumber` is treated as the operational staff reference
- Invoice and payment identifiers remain separate and unchanged in purpose
- Booking/order public IDs are no longer required by new active flows
- If `Invoice.publicId` is removed or deprecated, invoice behavior continues to work through `invoiceNumber` and internal IDs
- `context/reviews/current-database-er-diagram.md` is updated if the implemented schema changes its described structure or identifier inventory
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Migration deploy/status checks pass if schema changes are included
- Update `context/progress-tracker.md`

---

## Assumptions

- Staff do not need separate booking and order reference numbers once one shared immutable `jobNumber` exists
- Finance still requires invoice-specific and payment-specific identifiers independent from operational job identity
