## Feature Goal

Build the workflow logic that controls booking status changes and creates an order when a booking is completed.

This feature connects the pre-session booking flow to the post-session order workflow.


## Read First

- agents.md

---

## Rules

- Do NOT modify shadcn/ui components
- Use server actions + service layer
- Booking module owns booking status
- Orders module owns order creation
- Invoice/payment logic stays separate
- Do NOT auto-create invoices in this feature
- Respect workflow rules and keep transitions explicit

---

## Scope

### In Scope

- Add booking status update action
- Add safe booking status transition rules
- Add UI control for changing booking status
- Create an order when booking becomes COMPLETED
- Prevent duplicate orders for the same booking
- Update progress tracker when done

### Out of Scope

- Payment recording
- Invoice creation
- Deposit collection
- Editing workflow
- Production workflow
- Audit log table
- Role-based permissions

---

## Workflow Context

Booking = before the session  
Order = after the session happens  
Invoice = financial truth

When a booking is completed, the system should create the matching order record.

---

## Status Transition Rules

Allowed transitions:

text PENDING → CONFIRMED PENDING → CANCELLED  CONFIRMED → COMPLETED CONFIRMED → CANCELLED  COMPLETED → no changes in V1 CANCELLED → no changes in V1 

---

## Important Business Rules

### 1. Confirming a Booking

A booking should only become CONFIRMED if the deposit requirement is satisfied.

For V1:

- If deposit tracking exists on booking, check it
- If deposit/payment logic is not reliable yet, keep this as a clear TODO guard
- Do not silently bypass this rule

---

### 2. Completing a Booking

When booking status changes to COMPLETED:

- Create an order if one does not already exist
- Use the booking package as both:
  - original package
  - final package
- Set initial selected photo count to 0
- Set order status to initial/default order state
- Link order to booking and customer

---

### 3. Prevent Duplicate Orders

If an order already exists for the booking:

- Do not create another order
- Only update the booking status if valid

---

### 4. Cancelled Bookings

If booking becomes CANCELLED:

- Do not create an order
- Do not delete existing data

---

## Service Layer

### Booking Service

File:

text src/modules/bookings/booking.service.ts 

Add:

ts updateBookingStatus(bookingId: string, nextStatus: BookingStatus) 

Responsibilities:

- Fetch booking
- Validate booking exists
- Validate status transition
- Enforce deposit rule for confirmation
- Update booking status
- If status becomes COMPLETED, call order creation logic
- Return updated booking

---

### Order Service

File:

text src/modules/orders/order.service.ts 

Add:

ts createOrderFromBooking(bookingId: string) 

Responsibilities:

- Fetch booking with customer and package
- Check whether order already exists
- Create order from booking
- Return existing order if already created

---

## Server Action

File:

text app/bookings/actions.ts 

Add:

ts updateBookingStatusAction 

Responsibilities:

- Parse booking ID and next status
- Call updateBookingStatus
- Revalidate /bookings
- Revalidate /calendar
- Redirect or return action state as needed

---

## UI Updates

### Bookings Table

File:

text src/components/bookings/bookings-table.tsx 

Add status action options:

- Confirm Booking
- Mark Completed
- Cancel Booking

Only show actions that are valid for the current status.

Example:

- PENDING shows:
  - Confirm Booking
  - Cancel Booking

- CONFIRMED shows:
  - Mark Completed
  - Cancel Booking

- COMPLETED shows:
  - No status actions

- CANCELLED shows:
  - No status actions

---

## Optional UI Component

File:

text src/components/bookings/booking-status-actions.tsx 

Purpose:

- Keep status action logic out of the table
- Render valid buttons/dropdown items
- Submit server action

---

## Validation

Create or update schema file:

text src/modules/bookings/booking.schema.ts 

Add:

ts updateBookingStatusSchema 

Validate:

- bookingId is required
- nextStatus must be valid BookingStatus enum

---

## Edge Cases

- Booking not found → show error or 404
- Invalid transition → return error
- Confirm without deposit → return error/TODO guard
- Completing already completed booking → no duplicate order
- Completing cancelled booking → blocked
- Order creation fails → booking status should not partially update if possible

---

## Database Notes

Use Prisma transaction when completing a booking:

- update booking status
- create order if needed

This avoids status/order mismatch.

---

## Definition of Done

- Staff can change booking status from the bookings page
- Invalid status transitions are blocked
- Completing a booking creates one linked order
- Duplicate orders are prevented
- No invoice/payment logic added
- Calendar and bookings page update after status change
- TypeScript passes
- npm run lint passes
- npm run build passes
- context/progress-tracker.md updated
