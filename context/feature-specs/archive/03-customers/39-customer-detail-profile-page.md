## Goal

Create the main customer profile hub so staff can view core customer context, linked children, and related bookings/orders from one place.

---

## Read First

- `agents.md`
- `context/feature-specs/36-customer-filters-and-row-actions.md`
- `context/feature-specs/38-edit-customer-flow.md`
- `context/reviews/customers-page-gap-review.md`

---

## Rules

- The customer page is a read-first profile hub; do not rebuild booking or order management inside it
- Show linked data from its owning modules without duplicating their business logic
- Keep invoice, payment, production, and delivery ownership outside the customer module
- If a richer notes experience is planned for Feature 41, keep this unit focused on the profile shell and core linked data

---

## Scope

### In Scope

- Add `getCustomerById()` or an equivalent customer profile read model in the customer service
- Create `app/customers/[customerId]/page.tsx`
- Render:
  - customer profile summary card
  - contact details
  - children preview list
  - linked bookings list
  - linked orders list
  - a basic recent history section based on related customer records
- Provide actions for:
  - Edit Customer
  - New Booking
  - Add Child only if Feature 40 is already implemented or intentionally shipped together later

### Out of Scope

- Full children CRUD
- Invoice editing
- Payment management
- Production workflow controls
- Embedded order/booking edit flows

---

## Read Model Requirements

The customer service should return enough data for the profile page to render:

- customer core fields
- linked children count and preview rows
- linked bookings summary rows
- linked orders summary rows

Prefer lightweight summaries over large nested payloads.

The page should not query Prisma directly.

---

## Page Requirements

The profile page should answer these staff questions quickly:

- who is this customer?
- how do I contact them?
- which children are linked?
- what bookings or orders are already associated with them?
- what is the next sensible action?

A practical first version can use simple cards/sections rather than a dense dashboard.

---

## Acceptance Criteria

- Visiting `/customers/[customerId]` shows a real customer profile page
- Missing customers render a proper not-found path
- The page shows customer summary, contact details, children preview, bookings, and orders
- The page links outward to the existing booking/order routes instead of duplicating those workflows
- The page exposes obvious next actions such as edit customer and new booking
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Update `context/progress-tracker.md`

---

## Assumptions

- A simple recent-history section may be composed from recent bookings/orders if there is no customer-specific activity log yet
- Notes can remain minimal in this unit if Feature 41 is intended to deepen that area next
