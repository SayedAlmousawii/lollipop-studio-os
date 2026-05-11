## Goal

Replace the "Record Base Payment" button on the booking detail page with a "Check In" button. Checking in is the moment the client arrives and the session begins. It creates the order and generates the job number. Payment moves downstream to the POS/sales phase.

This implements the workflow correction identified in owner-feedback-review-doc.md Problems 2 and 5.

---

## Read First

- `prisma/schema.prisma` — `Booking`, `Order`, `Job` models and their relations
- `app/bookings/` — booking detail page and server actions
- `src/modules/bookings/booking.service.ts`
- `src/modules/orders/order.service.ts` — order creation logic
- `context/owner-feedback-reviews/owner-feedback-review-doc.md` — Problems 2 and 5

---

## Rules

- No schema changes beyond what is listed below
- Do not touch invoice or payment logic — payment moves to POS, out of scope here
- Keep existing order creation service logic; only the trigger changes
- Business rules live in service layer. The server action stays thin
- Do not break any existing booking or order reads

---

## Workflow Change

**Before:**
```
Booking confirmed → [Record Base Payment] → Payment recorded + Order created
```

**After:**
```
Booking confirmed → [Check In] → Order created + Job number generated → POS/Sales
```

The check-in action is the sole trigger for order creation. No payment is collected at this step.

---

## Scope

### 1 — Booking Status: Add `CHECKED_IN`

In `prisma/schema.prisma`, add `CHECKED_IN` to the `BookingStatus` enum:

```prisma
enum BookingStatus {
  PENDING
  CONFIRMED
  CHECKED_IN   // ← add
  COMPLETED
  CANCELLED
}
```

Run a migration. Existing records are unaffected — no backfill needed.

### 2 — Check In Server Action

Create a `checkInBooking(bookingId: string)` server action.

Logic:
1. Load booking — assert status is `CONFIRMED`, throw if not
2. Assert no order already exists for this booking — throw if one does (idempotency guard)
3. Call the existing order creation service to create the order and generate the job number
4. Set `booking.status = CHECKED_IN`
5. Revalidate the booking detail page

Do not record any payment. Do not require any payment input.

### 3 — Replace Button on Booking Detail Page

**Location:** booking detail page — wherever the current "Record Base Payment" button renders.

Replace it with:

```tsx
<CheckInButton bookingId={booking.id} />
```

Visibility rules:
- Show "Check In" button only when `booking.status === "CONFIRMED"`
- When `booking.status === "CHECKED_IN"` (order exists), show a static badge: `Checked In` and a link/button to open the order
- When status is `COMPLETED`, `CANCELLED`, or `PENDING` — show neither button

The button should have a simple confirmation before submitting (e.g. `confirm()` or a small dialog) since the action is not reversible without a cancellation flow.

### 4 — Display Job Number After Check In

Once an order exists for the booking, surface the job number on the booking detail page alongside or below the booking reference. Read the current order detail display patterns and follow the same style.

---

## Out of Scope

- Base payment recording (moves to POS — future feature)
- No-show handling
- Cancellation or refund flows
- Staff assignment gating
- Any change to the POS or invoice modules

---

## Acceptance Criteria

1. A confirmed booking shows a "Check In" button; no payment input is required
2. Clicking Check In creates an order and job number, sets booking status to `CHECKED_IN`
3. After check-in, the job number is visible on the booking detail page
4. After check-in, the Check In button is replaced by a "Checked In" indicator and order link
5. Attempting to check in a booking that already has an order returns an error without creating a duplicate
6. Attempting to check in a non-confirmed booking returns an error
7. TypeScript passes
8. `npm run build` passes
9. `npm run lint` passes
10. Update `context/progress-tracker.md`
