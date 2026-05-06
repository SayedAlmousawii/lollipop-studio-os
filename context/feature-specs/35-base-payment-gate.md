## Goal

Enforce the base payment gate: before an order can enter photo selection, staff must record the customer's base package payment. This creates a real payment record (type `BASE`), transitions the booking to `COMPLETED`, and sets the order to `WAITING_SELECTION` — unlocking the Selection tab.

---

## Read First

- `agents.md`
- `context/architecture-summary.md`
- `context/feature-specs/21-deposit-recording.md`
- `context/feature-specs/29-tabbed-order-hub-ui-shell.md`
- `context/reviews/base-payment-gate-plan.md`

---

## Rules

- Mirror the deposit recording pattern (Feature 21) — same modal shape, same atomic transaction approach
- The base payment record must be created before the order transitions; do not create the order first and patch later
- Do NOT touch invoice sync logic, the SelectionWorkflowForm internals, upgrade/add-on payment flow, or the commission hook
- The existing deposit recording flow is unchanged

---

## Scope

### In Scope

- Replace "Mark as Completed" on the booking detail page with a "Record Base Payment" button and modal
- New server action `recordBasePaymentAndCompleteAction`
- New service method `recordBasePaymentAndComplete()` running a single transaction
- Order creation sets `initialStatus: WAITING_SELECTION` instead of `ACTIVE`
- Selection tab locked-state UI when `order.status === 'ACTIVE'`
- Service-level guard in `updateOrderSelectionWorkflow` rejecting `ACTIVE` orders
- `resolveNextOrderAction` updated to surface the base-payment hint

### Out of Scope

- Invoice sync logic
- `SelectionWorkflowForm` internals
- Upgrade / add-on payment flow
- Commission hook
- Global payment reporting screens

---

## Booking Page Requirements

Replace the existing "Mark as Completed" button on `app/bookings/[bookingId]/page.tsx` with a **Record Base Payment** button that opens a modal containing:

- **Amount** — pre-filled with `booking.package.price - depositPaidAmount`, editable
- **Method** — CASH / KNET / LINK selector
- **Notes** — optional free text

On submit the modal calls `recordBasePaymentAndCompleteAction`. On success, redirect to the resulting order page.

---

## Server Action Requirements

New action in `app/bookings/[bookingId]/actions.ts`:

- Name: `recordBasePaymentAndCompleteAction`
- Validates booking is in `CONFIRMED` state before delegating
- Calls `recordBasePaymentAndComplete()` service method
- Redirects to the resulting order page on success
- Returns a typed error response on failure (same pattern as deposit action)

---

## Service Layer

### `recordBasePaymentAndComplete()` — booking service

Single transaction containing:

1. Create `Payment` record (`paymentType: BASE`, amount, method, notes, bookingId)
2. Transition booking status to `COMPLETED`
3. Call existing `createOrderFromBookingWithClient()` with `initialStatus: WAITING_SELECTION`

Activity records written: `BASE_PAYMENT_RECORDED`, `BOOKING_COMPLETED`, `ORDER_CREATED`

File: `src/modules/bookings/booking.service.ts`

### `createOrderFromBookingWithClient()` — order service

Add an optional `initialStatus` parameter (default: `ACTIVE` for backward compatibility). When called from `recordBasePaymentAndComplete()`, pass `WAITING_SELECTION`.

File: `src/modules/orders/order.service.ts`

### `updateOrderSelectionWorkflow()` — order service guard

Assert `order.status` is `WAITING_SELECTION` or later before accepting any selection update. Return a clear error string if the order is still `ACTIVE`.

### `resolveNextOrderAction()` — priority update

Insert new priority step after "No invoice":

1. No invoice → "Create invoice"
2. **Status `ACTIVE` (base payment not recorded) → "Record base payment on booking to begin selection"**
3. Not fully paid (upgrade/add-on balance remaining) → "Review payment adjustment"
4. Selection incomplete → "Continue photo selection"
5. …rest unchanged

---

## Selection Tab UI Requirements

In `app/orders/[orderId]/page.tsx`:

- If `order.status === 'ACTIVE'`: render a locked panel with the message *"Base payment not yet recorded. Use 'Record Base Payment' on the booking to unlock selection."*
- If `order.status === 'WAITING_SELECTION'` or any later status: render `SelectionWorkflowForm` as normal

---

## Acceptance Criteria

- Open a `CONFIRMED` booking → "Record Base Payment" button is visible (not "Mark as Completed")
- Modal opens with amount pre-filled to `packagePrice − depositPaid`
- Selecting a payment method and submitting creates a `Payment` record of type `BASE`
- Booking transitions to `COMPLETED` and order is created with status `WAITING_SELECTION`
- Navigating to the order → Selection tab is unlocked
- Opening a legacy `ACTIVE` order → Selection tab shows the locked state with guidance text
- `resolveNextOrderAction` returns the base-payment hint when order status is `ACTIVE`
- `updateOrderSelectionWorkflow` rejects calls on `ACTIVE` orders with a clear error
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Update `context/progress-tracker.md`

---

## Assumptions

- Legacy orders that are already `ACTIVE` and have completed selection will not be retroactively blocked — the guard applies to new attempts only
- The deposit modal component (Feature 21) is reusable or can be composed from shared modal primitives; prefer reuse over a new modal from scratch
