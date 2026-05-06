## Goal

Add a simple booking details view so staff can open a booking from the Bookings page the same way they can open an order from the Orders page.

---

## Read First

- `agents.md`

---

## Rules

- Keep this unit read-only
- Do NOT change booking workflow logic
- Do NOT change database schema
- Reuse existing booking data where possible
- Match the existing Orders "View Details" pattern

---

## Scope

### In Scope

- Add `View Details` action to the bookings table
- Create booking details route: `/bookings/[bookingId]`
- Show a simple read-only booking summary page
- Add back link to `/bookings`
- Add quick actions for:
  - Edit Booking
  - Record Deposit when eligible

### Out of Scope

- Booking edit changes
- Deposit workflow changes
- New status actions
- Order creation changes
- Invoice/payment history redesign

---

## Page Requirements

Create:

- `app/bookings/[bookingId]/page.tsx`

Show simple sections:

### 1. Booking Summary

- Customer
- Session date
- Session type
- Package
- Department
- Assigned photographer
- Booking status
- Deposit status

### 2. Notes

- Booking notes

### 3. Themes

- List booking themes if present

---

## Bookings Table

Update booking row actions to include:

- View Details
- Edit Booking
- Record Deposit (existing rule)
- Existing status actions unchanged

`View Details` should link to:

- `/bookings/[bookingId]`

---

## Service Layer

Use booking module.

Add a read function if needed:

- `getBookingById(bookingId)`

It should return page-safe display data only.

---

## Acceptance Criteria

- Each booking row has a `View Details` action
- `/bookings/[bookingId]` renders real booking data
- Missing booking shows `notFound()`
- Page is read-only
- No schema changes
- TypeScript passes
- `npm run build` passes
- Update `context/progress-tracker.md`

---

## Assumption

- V1 can reuse the current booking deposit/status labels and does not need a dedicated payment history section.
