## Goal

Replace the removed "Record Base Payment" trigger with a Check In action. Check-in is the moment the client arrives and operational work begins. It generates the JOB reference, creates the Job and Order, and stamps the FinancialCase. No payment is collected at this step. Requires Specs 59 and 60 to be complete.

---

## Read First

- `prisma/schema.prisma` — Booking, Job, Order, FinancialCase models
- `src/modules/bookings/booking.service.ts` — status transition logic, booking detail read model
- `src/modules/orders/order.service.ts` — `createOrderFromBookingWithClient` — this is the existing order creation logic to reuse
- `src/modules/identifiers/identifier.service.ts` — the BK generation pattern from Spec 60 is the same pattern for JOB generation with `kind = 'JOB'`
- `app/bookings/[bookingId]/page.tsx` — current booking detail page structure
- `app/bookings/[bookingId]/actions.ts` — where the new server action lives

---

## Rules

- No payment collected at check-in
- Check-in is not reversible through the booking flow — the JOB reference is consumed permanently once generated
- Business logic lives in the service layer — the server action stays thin
- Reuse the existing `createOrderFromBookingWithClient` — do not rewrite order creation logic
- Initial Order status after check-in is `WAITING_SELECTION` — not `ACTIVE`
- The required permission for the check-in action is `BOOKING_STATUS_UPDATE`
- A simple confirmation prompt is required before submitting (the action is not reversible)

---

## Scope

### In Scope

**`checkInBooking` service function**
New function in `booking.service.ts`. All steps 1–8 must execute inside a single `db.$transaction()` — this ensures the JOB sequence increment, Job creation, Order creation, FinancialCase stamp, and status change are fully atomic. If any step fails, the entire transaction rolls back and no reference is consumed.

Logic:
1. Load and lock the booking — assert status is `CONFIRMED`, throw if not
2. Idempotency guard — if `booking.jobId` is already set OR an Order already exists for this booking, throw without creating anything
3. Generate JOB reference using `kind = 'JOB'`, department code, and session date year (same pattern as BK generation in Spec 60)
4. Create `Job` with the new `jobNumber`
5. Stamp `booking.jobId` and `booking.jobNumber`
6. Call `createOrderFromBookingWithClient` with status `WAITING_SELECTION`
7. Load the booking's `FinancialCase` — stamp `financialCase.jobId` with the new Job id
8. Set `booking.status = CHECKED_IN`
9. Revalidate the booking detail page (outside the transaction)

**`checkInBooking` server action**
Thin action in `app/bookings/[bookingId]/actions.ts`. Validates permission (`BOOKING_STATUS_UPDATE`), calls the service function, handles errors.

**Booking detail page — button replacement**
Replace the removed "Record Base Payment" button area with a `<CheckInButton>` component.

Visibility rules:
- `booking.status === CONFIRMED` → show "Check In" button with confirmation prompt
- `booking.status === CHECKED_IN` → show a "Checked In" static badge and a link to the order
- All other statuses → show neither

**`originalPackagePriceSnapshot` on Order creation**
When the Order is created via `createOrderFromBookingWithClient`, set `Order.originalPackagePriceSnapshot` from `booking.package.price` at that moment. This is the permanent snapshot of the booked package price — it does not change even if the package is upgraded in POS. Commission calculations in later specs read this field, not the live package price.

**Booking detail page — reference display**
After check-in, both the BK reference (`booking.publicId`) and the JOB reference (`booking.jobNumber`) should be visible on the booking detail page. Read the current reference display pattern on the page and follow the same style. Before check-in, only the BK reference is shown.

### Out of Scope

- Payment at check-in
- Deposit invoice display (Spec 62)
- Final invoice creation (Spec 63)
- CHECKED_IN → CANCELLED (job order cancellation flow — deferred, out of scope)
- Multi-package scenario

---

## Implementation Direction

**JOB reference generation**
This is the same logic as the BK reference generation introduced in Spec 60, with `kind = 'JOB'`. If Spec 60 extended `generateJobNumber` to accept a `kind` parameter, use it here with `'JOB'`. The resulting format is `JOB-DEPT-YEAR-XXXXX`. Confirm the identifier_sequences SQL conflict clause uses `(scope, year, kind)` — this was established in Spec 59.

**Reusing existing order creation**
`createOrderFromBookingWithClient` in `order.service.ts` already handles order creation from a booking. Read it carefully — it expects the booking to have a `jobId` set (which we now set in step 4/5 above, before calling it). Pass `OrderStatus.WAITING_SELECTION` explicitly — do not rely on the default.

**FinancialCase stamping**
After the Job is created, load the FinancialCase by `bookingId` and update `jobId` to the new Job's id. This must happen in the same transaction to remain atomic.

**CheckInButton component**
Follow the same component pattern used by other booking action buttons on the detail page. The confirmation prompt can use the browser's `confirm()` or a small inline dialog — either is acceptable. The key requirement is that the user must explicitly confirm before the action fires, since the JOB reference is consumed immediately and cannot be undone.

**Idempotency guard**
Before creating the Job, check if `booking.jobId` is already set or if an Order already exists for this booking. If either is true, throw a clear error. This prevents double-submission from creating duplicate jobs.

---

## Post-Implementation

- Update `context/progress-tracker.md`

---

## Acceptance Criteria

1. A confirmed booking shows a "Check In" button; no payment input is required
2. Clicking Check In (after confirmation prompt) generates a `JOB-DEPT-YEAR-XXXXX` reference, creates a Job and Order, sets booking status to `CHECKED_IN`
3. The Order is created with status `WAITING_SELECTION`
4. `FinancialCase.jobId` is stamped with the new Job id after check-in
5. `booking.jobNumber` and `booking.jobId` are set after check-in
6. After check-in, the booking detail page shows both BK reference and JOB reference
7. After check-in, the Check In button is replaced by a "Checked In" badge and a link to the order
8. Attempting to check in a booking that already has a Job/Order returns an error without creating a duplicate
9. Attempting to check in a non-confirmed booking returns an error
10. TypeScript passes
11. `npm run build` passes
12. `npm run lint` passes
13. Update `context/progress-tracker.md`
