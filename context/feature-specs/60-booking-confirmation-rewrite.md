## Goal

Rewrite the booking confirmation flow so that recording a deposit generates a BK reference, creates a FinancialCase, and produces a locked Deposit Invoice. Pending bookings no longer consume any references at creation time. Requires Spec 59 to be complete.

---

## Read First

- `prisma/schema.prisma` — Booking, FinancialCase, Invoice, Payment, IdentifierSequence models
- `src/modules/bookings/booking.service.ts` — `createBookingInDb`, `recordBookingDeposit`, `updateBookingStatus`
- `src/modules/invoices/invoice.service.ts` — `createInvoiceForBookingWithClient`, `issueInvoiceWithClient`, `recalculateInvoiceStatus`, `closeInvoice`
- `src/modules/identifiers/identifier.service.ts` — `generateJobNumber` is the pattern to follow for BK reference generation
- `src/modules/identifiers/identifier.constants.ts`
- `app/bookings/new/actions.ts` — current booking creation action
- `app/bookings/[bookingId]/actions.ts` — current deposit recording action

---

## Rules

- Business logic lives in service layer only — actions stay thin
- The deposit is always 20 KD — do not derive invoice total from package price
- The Deposit Invoice must be auto-closed (PAID + CLOSED + locked) within the same transaction as the deposit payment — no separate step
- The BK reference uses the same `DEPT-YEAR-XXXXX` format as the job number, with `kind = 'BK'` in `identifier_sequences`, generated using the session date year and the booking's department code
- `FinancialCase` is created in the same transaction as the deposit — not before, not after
- Do not touch any order creation logic
- Do not touch `updateBookingStatus` beyond removing the COMPLETED transition

---

## Scope

### In Scope

**Booking creation (`createBookingInDb`)**
Remove all three of: `generatePublicId`, `generateJobNumber`, and `Job.create` from the booking creation transaction. A pending booking is created with only customer, package, session, department, theme, and status fields. `publicId`, `jobNumber`, and `jobId` are null at creation.

**BK reference generation**
Extend `generateJobNumber` (or introduce a thin wrapper) to accept a `kind` parameter (`'BK'` or `'JOB'`). The generation logic is identical — department code + session date year + sequence from `identifier_sequences` scoped by `(scope, year, kind)`. The resulting format is `BK-DEPT-YEAR-XXXXX`. Update `identifier.constants.ts` to reflect the new kind values. Retire the old `PUBLIC_ID_KIND.BOOKING` sequence approach for booking references — it is replaced by this.

**Deposit recording (`recordBookingDeposit`)**
Rewrite this function to perform the following in a single transaction, in order:
1. Load and lock the booking — assert status is `PENDING`, throw if not
2. Assert no deposit payment already exists on this booking — idempotency guard
3. Generate BK reference using `kind = 'BK'`, department code, and session date year
4. Stamp `booking.publicId` with the BK reference
5. Create `FinancialCase` — `bookingId`, `customerId`, `jobId` null
6. Create Deposit Invoice — `type = DEPOSIT`, `totalAmount = 20 KD`, `financialCaseId` set, `bookingId` set, `jobId` null, `jobNumber` null, status `DRAFT`
7. Issue the invoice (DRAFT → ISSUED)
8. Record the deposit payment against the invoice — `paymentType = DEPOSIT`, `financialCaseId` set, `jobId` null
9. Recalculate invoice status — invoice reaches `PAID` since 20 KD = totalAmount
10. Close and lock the invoice — `status = CLOSED`, `isLocked = true`
11. Set `booking.status = CONFIRMED`

**Remove `COMPLETED` from status transition logic**
`updateBookingStatus` currently triggers `createOrderFromBookingWithClient` when transitioning to `COMPLETED`. Remove the `COMPLETED` branch entirely — order creation moves to check-in (Spec 61). Also remove the implicit order creation that was gated behind base payment recording.

**Remove `recordBasePaymentAndComplete`**
This function, its server action, and the `RecordBasePaymentDialog` component are all removed. The base payment gate at the booking stage no longer exists. Search for all call sites and remove them. The `canRecordBasePayment` computed field on the booking detail read model is also removed.

**Pending booking hard deletion**
When a pending booking is cancelled, it must be hard-deleted — not transitioned to `CANCELLED` status. `CANCELLED` status only applies to confirmed bookings (which have a BK reference, FinancialCase, and Deposit Invoice). Add a `deletePendingBooking(bookingId)` service function that:
1. Loads the booking — asserts status is `PENDING`, throws if not
2. Hard-deletes the booking row and its associated themes (themes cascade on the schema)
3. Confirms no Job, FinancialCase, or Invoice exists before deleting — if any are found, throw rather than silently delete financial history

Add a corresponding server action and a cancellation/delete affordance on the booking detail page for pending bookings. The UI should require confirmation before proceeding.

### Out of Scope

- Deposit invoice display on the booking detail page (Spec 62)
- Check-in and Job/Order creation (Spec 61)
- Any POS or order-level changes

---

## Implementation Direction

**Pattern for BK reference generation**
Read `generateJobNumber` in `identifier.service.ts` in full before writing anything. The BK reference follows the same SQL upsert pattern against `identifier_sequences`, just with `kind = 'BK'` in the conflict clause and insert. The function can be extended to accept `kind` as a parameter — the format string just changes the prefix from the department code alone to `BK-DEPT-YEAR-XXXXX`. Keep the same self-healing logic where the sequence catches up to existing rows.

**Deposit Invoice total amount**
The invoice `totalAmount` is hardcoded to 20 KD (as a `Prisma.Decimal`). Do not read it from `booking.package.price`. The package price is irrelevant to the financial amount of the deposit invoice — it is only relevant to the display layer (Spec 62).

**Auto-close on PAID**
After `recalculateInvoiceStatus` runs and the invoice reaches `PAID`, immediately call `closeInvoice` (or the `WithClient` variant inline in the transaction). The deposit invoice should never sit in an open state after the deposit is recorded. This is intentional — it is a completed payment receipt, not an evolving financial document.

**FinancialCase creation**
Create it inline in the `recordBookingDeposit` transaction using `tx.financialCase.create`. At this point `jobId` is null — it will be stamped at check-in. Pass `financialCaseId` to the invoice and payment create calls in the same transaction.

**Removing base payment flow**
`recordBasePaymentAndComplete` touches: booking service, a server action in `app/bookings/[bookingId]/actions.ts`, and the `RecordBasePaymentDialog` component. Remove all three. Also remove the `canRecordBasePayment` field from the booking detail read model in `booking.service.ts`. Run TypeScript after removal to find any remaining references.

---

## Post-Implementation

- Update `context/progress-tracker.md`

---

## Acceptance Criteria

1. Creating a new booking produces no `publicId`, no `jobNumber`, no `Job` record — all three are null
2. Recording a deposit on a pending booking generates a `BK-DEPT-YEAR-XXXXX` reference, stamps it on `booking.publicId`, and sets status to `CONFIRMED`
3. A `FinancialCase` row exists after deposit recording, linked to the booking
4. A Deposit Invoice exists with `type = DEPOSIT`, `totalAmount = 20.000`, `status = CLOSED`, `isLocked = true`, `financialCaseId` set, `jobId` null
5. The deposit payment has `paymentType = DEPOSIT`, `financialCaseId` set, `jobId` null
6. Attempting to record a deposit on an already-confirmed booking throws an error
7. `recordBasePaymentAndComplete`, its server action, and `RecordBasePaymentDialog` are fully removed with no remaining references
8. `canRecordBasePayment` no longer exists on the booking read model
9. A pending booking can be hard-deleted via a confirmed action on the booking detail page
10. Attempting to hard-delete a non-pending booking returns an error
11. TypeScript passes
10. `npm run build` passes
11. `npm run lint` passes
12. Update `context/progress-tracker.md`
