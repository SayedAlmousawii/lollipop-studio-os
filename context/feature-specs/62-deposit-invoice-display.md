## Goal

Surface the Deposit Invoice on the booking detail page. The invoice amount (20 KD) is locked and immutable. Package context — package name, full price, and remaining balance — is shown alongside it as live display data read from the booking, not stored on the invoice. Requires Specs 59–61 to be complete.

---

## Read First

- `app/bookings/[bookingId]/page.tsx` — current booking detail page layout and component structure
- `src/modules/bookings/booking.service.ts` — the booking detail read model (`getBookingById` or equivalent); understand what fields are currently returned
- `src/modules/invoices/invoice.service.ts` — `getInvoiceById`, invoice display patterns
- `context/ui-context-summary.md` — UI conventions, card/section patterns in use

---

## Rules

- Package context (name, full price, remaining balance) is read live from `booking.package` at render time — it is NOT stored on the Deposit Invoice
- The Deposit Invoice is always shown as PAID and locked — no edit actions, no payment button
- Remaining balance display only applies before check-in — after check-in, the balance context moves to the Final Invoice (Spec 63)
- Do not add any new fields to the Invoice model — display only uses what already exists

---

## Scope

### In Scope

**Booking detail read model**
Extend the booking detail query to include:
- The Deposit Invoice (type `DEPOSIT`) linked to the booking via `financialCaseId` or `bookingId` — include `invoiceNumber`, `totalAmount`, `paidAmount`, `status`, `isLocked`
- `booking.package` — `name` and `price` for the live context display

**Deposit Invoice section on booking detail page**
Add a section to the booking detail page that shows:

Before check-in (status `CONFIRMED`):
- Invoice number (e.g. INV-00001)
- BK reference
- Deposit amount: 20.000 KD — Paid
- Package: `[package name]` — `[package price]` KD
- Remaining at session: `[package price - 20]` KD
- Locked indicator — no edit or payment actions

After check-in (status `CHECKED_IN`):
- Invoice number
- BK reference
- Deposit amount: 20.000 KD — Paid
- Remove the remaining balance line — balance context has moved to the Final Invoice
- Locked indicator

For all other statuses where no deposit exists yet: show nothing (pending booking has no invoice).

**Cancelled / No-Show**
If the booking is `CANCELLED` or `NO_SHOW`, show the Deposit Invoice in its locked state without the remaining balance line. It is a historical record.

### Out of Scope

- Final Invoice display (Spec 63)
- Any invoice editing
- Refund or credit note display

---

## Implementation Direction

**Reading package context live**
The booking detail query already includes `booking.package`. Use `booking.package.price` to compute the displayed remaining balance as `package.price - 20`. Do not store this computed value anywhere — derive it in the component or read model mapper. If `booking.package` is null (no package selected), omit the package context lines rather than erroring.

**Finding the Deposit Invoice**
The deposit invoice is linked to the booking via `bookingId` and has `invoiceType = DEPOSIT`. Query for it in the booking detail read model — include it conditionally; if none exists (pending booking), the section does not render. Do not assume there is always one.

**Section placement**
Read the current booking detail page layout to understand where the existing payment/financial information is shown. The Deposit Invoice section should sit in the same area, replacing any remnant of the old deposit recording UI that was removed in Spec 60.

**Remaining balance calculation timing**
Before check-in: shown as `package.price - 20 KD`. After check-in: omitted entirely on this section (the Final Invoice in Spec 63 will show the full breakdown). The component should gate this on `booking.status !== 'CHECKED_IN'`.

---

## Post-Implementation

- Update `context/progress-tracker.md`

---

## Acceptance Criteria

1. A confirmed booking's detail page shows the Deposit Invoice section with invoice number, BK reference, 20 KD paid, package name, package price, and remaining balance
2. Remaining balance is correctly computed as `package.price - 20`
3. No payment or edit actions are shown on the Deposit Invoice section
4. After check-in, the remaining balance line is no longer shown on the deposit section
5. A pending booking (no invoice yet) shows no deposit section
6. A cancelled or no-show booking shows the deposit invoice in locked historical state without remaining balance
7. TypeScript passes
8. `npm run build` passes
9. `npm run lint` passes
10. Update `context/progress-tracker.md`
