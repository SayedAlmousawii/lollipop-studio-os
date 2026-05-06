# Plan: Base Payment Gate — Record Base Payment Action

## Context

When a booking is marked **COMPLETED**, an order is created. By the studio's business rule, this implies the customer has already paid their remaining base balance. Architecture **Invariant #3** confirms: *"A session cannot move to editing until the base package payment is recorded."* The project overview is even stricter — base payment happens in the **Post-Session Phase**, before the order ever enters `WAITING_SELECTION`.

**The gap:** The `WAITING_SELECTION` order status exists in the schema but is never set — orders remain `ACTIVE` throughout the entire selection workflow. `PaymentType.BASE` exists in the Payment schema but is never enforced. Staff can currently complete photo selection without a single base payment record existing.

---

## Architecture Alignment

| Source | Rule |
|---|---|
| Architecture Invariant #3 | Base package payment must be **recorded** before editing can begin |
| Project Overview (Post-Session Phase) | Customer pays full package price → photos uploaded → status `WAITING_SELECTION` |
| Both docs | Base payment is a gate, not a suggestion |

---

## Design: Merged Explicit + Atomic Approach

Following the existing deposit recording pattern (Feature 21):

```
Booking CONFIRMED
  → Staff clicks "Record Base Payment" on booking page
  → Modal opens:
      Amount: [package price - deposit paid]  ← defaulted, editable
      Method: [CASH / KNET / LINK]
      Notes: [optional]
  → Staff hits "Record"
  → [atomic transaction]:
      1. Payment record created (type: BASE, amount, method)
      2. Booking marked COMPLETED
      3. Order created (existing flow)
      4. Order status set to WAITING_SELECTION (not ACTIVE)
  → Selection tab unlocks on the resulting order
```

This gives a real payment record (with method, amount, timestamp) while keeping the staff workflow to a single action. It mirrors the deposit flow they already know.

---

## Implementation Plan

### 1. Booking Page — Replace "Mark Completed" with "Record Base Payment"

On the booking detail page, replace the existing "Mark as Completed" button with a "Record Base Payment" button that opens a modal.

The modal shows:
- **Amount** — pre-filled with `booking.package.price - depositPaidAmount`, editable
- **Method** — CASH / KNET / LINK selector
- **Notes** — optional

File: `app/bookings/[bookingId]/page.tsx`

### 2. Booking Action — `recordBasePaymentAndCompleteAction`

New server action in `app/bookings/[bookingId]/actions.ts`:
- Validates booking is in `CONFIRMED` state
- Calls `recordBasePaymentAndComplete()` service method
- Redirects to the resulting order page on success

### 3. Booking Service — `recordBasePaymentAndComplete()`

New service method (booking service or order service):
- In a single transaction:
  1. Create `Payment` record (`paymentType: BASE`, amount, method, notes)
  2. Transition booking to `COMPLETED`
  3. Call existing `createOrderFromBookingWithClient()` with `initialStatus: WAITING_SELECTION`
- Record activity: `BASE_PAYMENT_RECORDED`, `BOOKING_COMPLETED`, `ORDER_CREATED`

Files:
- `src/modules/bookings/booking.service.ts`
- `src/modules/orders/order.service.ts` → `createOrderFromBookingWithClient()` (add optional `initialStatus` param)

### 4. Selection Tab Guard

In `app/orders/[orderId]/page.tsx`:
- If `order.status === 'ACTIVE'`: locked panel — *"Base payment not yet recorded. Use 'Record Base Payment' on the booking to unlock selection."*
- If `order.status === 'WAITING_SELECTION'` or beyond: render `SelectionWorkflowForm` normally

### 5. Selection Workflow Service Guard

In `src/modules/orders/order.service.ts` → `updateOrderSelectionWorkflow()` (~line 294):
- Assert `order.status` is `WAITING_SELECTION` or later before accepting any update
- Return a clear error if order is still `ACTIVE`

### 6. `resolveNextOrderAction` Update

Update priority in `src/modules/orders/order.service.ts` (~line 978):
1. No invoice → "Create invoice"
2. **Base payment not recorded (status ACTIVE) → "Record base payment on booking to begin selection"**
3. Not fully paid (upgrade/add-on balance remaining) → "Review payment adjustment"
4. Selection incomplete → "Continue photo selection"
5. ...rest unchanged

---

## What Does NOT Change

- Invoice sync logic (`syncOrderInvoiceForFinancialEdit`)
- `SelectionWorkflowForm` component internals
- Upgrade/add-on payment flow
- Commission hook
- Existing deposit recording flow

---

## Critical Files

| File | Change |
|---|---|
| `app/bookings/[bookingId]/page.tsx` | Replace "Mark Completed" with "Record Base Payment" button + modal |
| `app/bookings/[bookingId]/actions.ts` | New `recordBasePaymentAndCompleteAction` server action |
| `src/modules/bookings/booking.service.ts` | New `recordBasePaymentAndComplete()` transactional method |
| `src/modules/orders/order.service.ts` | Add `initialStatus` param to order creation; guard in `updateOrderSelectionWorkflow`; update `resolveNextOrderAction` |
| `app/orders/[orderId]/page.tsx` | Locked-state UI for Selection tab when `order.status === ACTIVE` |

---

## Pre-Implementation Checks

1. Confirm what "Mark as Completed" currently looks like on the booking detail page (Feature 23 added it as read-only view — check if the action exists)
2. Check whether the deposit modal is a reusable component or inline — reuse it for base payment modal if possible

---

## Verification

1. Open a `CONFIRMED` booking → "Record Base Payment" button visible
2. Modal opens with amount pre-filled to `packagePrice - depositPaid`
3. Select payment method → submit
4. Booking → `COMPLETED`, order created with status `WAITING_SELECTION`
5. Navigate to order → Selection tab unlocked
6. Open a legacy `ACTIVE` order → Selection tab shows locked state with guidance
7. Confirm `resolveNextOrderAction` returns correct hint at each stage
8. `npm run build` + `npm run lint` pass
9. Update `context/progress-tracker.md`
