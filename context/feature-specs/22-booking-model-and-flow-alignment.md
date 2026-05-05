## Feature Goal

Align the booking flow and booking-related schema with the target architecture while keeping the unit limited to booking, deposit, invoice, and completion lifecycle rules.

This unit fixes the current mismatch where deposit collection creates an order too early and where booking deposit state still depends on a redundant boolean.

---

## Read First

- agents.md
- context/target-data-model.md

---

## Rules

- Keep scope limited to booking + deposit/invoice lifecycle alignment
- Do NOT implement editing jobs, production jobs, commissions, or audit logs in this unit
- Use server actions + service layer
- Booking module owns booking creation, editing, status changes, and booking-derived reads
- Orders module owns order creation, but order creation must only happen when a booking becomes `COMPLETED`
- Invoice/payment modules remain the financial source of truth
- Do NOT keep `Booking.depositPaid` as the source of truth

---

## Implementation Scope

### In Scope

- Remove the deposit-flow dependency on early order creation
- Create an invoice only when the first financial transaction is recorded for a booking
- Keep payments attached to invoices
- Move booking confirmation/deposit logic to derived payment-based checks
- Expand `Booking` to include:
  - `department`
  - `assignedPhotographerId`
  - `notes`
- Add simple `BookingTheme` support
- Update create/edit booking form flow to capture the new booking fields
- Update booking list/calendar/status reads that currently depend on old booking shape or `depositPaid`
- Update progress tracker when done

### Out of Scope

- Order editing changes beyond what is needed to keep completion creation working
- Invoice adjustment flow changes
- Editing jobs
- Production jobs
- Photographer commission logic
- Audit log implementation
- Advanced theme catalog management
- Staff scheduling or photographer availability checks
- Payment history redesign

---

## Lifecycle Rules

### 1. Booking Creation

Creating a booking should only create booking-owned records:

- `Booking`
- optional `BookingTheme` rows

Creating a booking must **not** create:

- `Order`
- `Invoice`
- `Payment`

### 2. Deposit Recording

When the first deposit is recorded:

1. Find the booking
2. Ensure the booking is eligible for deposit recording
3. Create a booking-linked invoice if none exists yet
4. Record a `Payment` with `paymentType = DEPOSIT`
5. Recalculate invoice totals/status

Deposit recording must **not** create an order.

### 3. Deposit Source of Truth

Deposit state must be derived from the existence of at least one payment where:

- `paymentType = DEPOSIT`
- the payment belongs to an invoice linked to the booking

`Booking.depositPaid` must not be read or written by application logic after this unit.

### 4. Booking Confirmation

A booking may move to `CONFIRMED` only if a deposit payment exists for that booking.

The confirmation guard must use derived payment existence, not a booking boolean.

### 5. Booking Completion

When a booking transitions to `COMPLETED`:

- create the order if it does not already exist
- reuse the existing order if one already exists
- copy booking/customer/package linkage needed for the order

This is the first point where an order should exist.

### 6. Cancellation

Cancelling a booking does not delete:

- deposit payments
- invoices
- themes
- existing order, if one was already created later in the lifecycle

This unit only aligns creation timing and source-of-truth rules. It does not define refund or reversal workflows.

---

## Database / Schema Changes

### Booking

Update `Booking` in `prisma/schema.prisma`:

- add `department`
- add `assignedPhotographerId` as nullable FK to `User`
- keep `notes` as booking-owned notes field
- remove `depositPaid` from the schema, or mark it as transitional and stop using it everywhere in code if the unit needs a staged migration

Preferred direction for this unit:

- schema migration removes `depositPaid`
- all reads derive deposit status from payments

### BookingTheme

Add a new `BookingTheme` model with:

- `id`
- `bookingId`
- `themeName`
- `notes`

Keep this simple:

- no separate theme catalog table
- no complex ordering logic
- one booking can have many themes

### Invoice Linkage

The target model expects `Invoice.bookingId`.

For this unit, implement the minimum schema change needed so invoices can be created from a booking before an order exists.

Preferred approach:

- add nullable `bookingId` to `Invoice`
- keep `orderId` nullable until booking completion, then link the existing booking invoice to the order when the order is created

If the existing invoice model cannot support this safely without broader churn, document the chosen compatibility approach in implementation notes, but the lifecycle outcome must still be:

- invoice can exist before order
- order is not created during deposit flow

### Supporting Constraints

- prevent duplicate order creation for the same booking
- preserve append-only payment behavior
- preserve invoice status recalculation

---

## Affected Files / Modules

### Likely Schema / Data Files

- `prisma/schema.prisma`
- `prisma/migrations/*`
- `prisma/seed.ts`

### Booking Module

- `src/modules/bookings/booking.service.ts`
- `src/modules/bookings/booking.schema.ts`
- `src/modules/bookings/booking.types.ts` if needed
- `src/modules/bookings/booking.constants.ts` if needed for new booking fields/status helpers

### Order / Invoice / Payment Modules

- `src/modules/orders/order.service.ts`
- `src/modules/invoices/invoice.service.ts`
- `src/modules/invoices/invoice.schema.ts` if invoice inputs/types change
- `src/modules/payments/payment.service.ts`

### Booking UI / Actions

- `app/bookings/new/page.tsx`
- `app/bookings/new/actions.ts`
- `app/bookings/[bookingId]/edit/page.tsx`
- `app/bookings/[bookingId]/edit/actions.ts`
- `app/bookings/actions.ts`
- `src/components/bookings/new-booking-form.tsx`
- `src/components/bookings/edit-booking-form.tsx`
- `src/components/bookings/bookings-table.tsx`
- `src/components/bookings/booking-status-actions.tsx`
- `src/components/bookings/record-deposit-form.tsx`

### Read Models That May Need Alignment

- `src/modules/calendar/calendar.service.ts`
- `app/bookings/page.tsx`
- `app/calendar/page.tsx`

---

## UI Updates

### Create Booking Page

Update the create booking form to support:

- department
- assigned photographer
- notes
- simple theme entry

Keep V1 theme UI simple. Accept either:

- repeatable text inputs, or
- a small comma-separated / add-chip style input

No advanced theme management UI is needed.

### Edit Booking Page

Update the edit booking form to support the same booking-owned fields:

- department
- assigned photographer
- notes
- themes

### Booking List / Status UI

Update booking status/deposit display to use derived deposit-payment existence.

Expected behavior:

- unpaid if no deposit payment exists
- paid if at least one deposit payment exists

Do not display or depend on `Booking.depositPaid`.

### Deposit Flow UI

Keep the existing deposit recording entry point in bookings UI, but the flow behind it must:

- create/reuse the invoice
- record the payment
- not create an order

---

## Validation / Business Rules

- `department` is required for booking creation and editing if the target workflow depends on explicit departmental routing
- `assignedPhotographerId` is optional
- assigned photographer must reference an active existing user if provided
- theme rows must belong to the booking being created/edited
- blank theme names are not allowed
- booking cannot be confirmed without a deposit payment
- duplicate deposit submission for the same booking should be blocked if the business rule remains one deposit per booking in V1
- financial writes that create invoice + payment together must remain transactional
- completing a booking must not create duplicate orders
- deposit/payment logic must not depend on order existence

Assumption for this unit:

- deposit remains a single V1 payment event, matching the current duplicate-prevention rule

---

## Testing Checklist

- Create booking with department, optional photographer, notes, and themes
- Edit booking and verify new fields persist correctly
- Booking list shows correct deposit state when no deposit payment exists
- Recording deposit creates an invoice if none exists
- Recording deposit records a `DEPOSIT` payment
- Recording deposit does not create an order
- Confirm booking is blocked before deposit payment exists
- Confirm booking succeeds after deposit payment exists
- Completing booking creates the order
- Completing booking does not create a second order if retried
- Existing invoice/payment records remain linked correctly through completion
- Calendar/bookings reads still render with the expanded booking model
- TypeScript passes
- Build passes

---

## Completion Checklist

- [x] Booking schema aligned with this unit's target fields
- [x] `Booking.depositPaid` removed from runtime logic
- [x] Booking deposit state derived from `Payment.paymentType = DEPOSIT`
- [x] Deposit flow creates/reuses invoice without creating order
- [x] Order creation happens only on booking completion
- [x] Simple `BookingTheme` support added
- [x] Create Booking UI updated
- [x] Edit Booking UI updated
- [x] Booking confirmation guard uses payment-derived deposit state
- [x] Progress tracker updated
- [x] No unrelated workflow systems added
