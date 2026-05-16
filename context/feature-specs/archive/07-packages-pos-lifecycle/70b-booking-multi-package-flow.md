## Goal

Wire the Booking creation and edit flows onto `BookingPackage`. The add/edit booking form switches from a single package picker to a multi-package picker, booking duration becomes the aggregate of selected package durations, and the calendar/scheduler reads the aggregate. The record-deposit dialog gains an editable amount input so the staff can record a deposit higher than the 20 KD default at payment time.

The singular `Booking.packageId` and `Booking.sessionType` remain on the model and are dual-written by this spec for compatibility with downstream code that still reads them (POS, invoice generation, commission). 70d removes them after 70c finishes the order-side migration.

---

## Read First

- `context/feature-specs/70a-multi-package-schema-foundation.md`
- `prisma/schema.prisma` — current `Booking` and the new `BookingPackage`
- `src/modules/bookings/booking.service.ts`
- `src/modules/bookings/booking.schema.ts`
- `src/components/bookings/new-booking-form.tsx`
- `src/components/bookings/edit-booking-form.tsx`
- `src/modules/calendar/calendar.service.ts` — overlap and duration logic
- `context/feature-specs/60-booking-confirmation-rewrite.md` — Deposit Invoice creation; the 20 KD constant becomes the booking's `depositAmount`
- `context/feature-specs/21-booking-deposit-recording.md`

---

## Rules

- Spec 70a must be merged first
- `Booking.packageId` and `Booking.sessionType` are not removed. Every write that creates or updates `BookingPackage` rows must also keep the singular fields in sync with the first line:
  - `Booking.packageId` = `BookingPackage[0].packageId`
  - `Booking.sessionType` (`BookingSessionType` enum) = mapped from `BookingPackage[0].sessionType.code` via the reverse of the Spec 70a mapping table; default to `OTHER` if no mapping exists
- A booking must have at least one `BookingPackage` row after creation. The form does not allow saving with zero packages.
- Duration is the sum of `package.durationMinutes` across all `BookingPackage` rows, multiplied by `quantity`. No setup/teardown buffer between packages (per owner Q5).
- Deposit amount is captured at payment time inside the record-deposit dialog. Default is 20 KD; minimum is 20 KD; no upper bound. Once the Deposit Invoice is created, the amount is locked — same rule as today, but no longer hardcoded to 20.
- Do not touch any Order, OrderPackage, POS, invoice line builder, or commission code in this spec.

---

## Scope

### In Scope

- Booking create + edit forms switch to a multi-package picker
- Booking service: create, update, and confirm flows write `BookingPackage` rows and dual-write the singular fields
- Booking duration helper: `getBookingDurationMinutes(bookingId)` returns the aggregate
- Calendar overlap and rendering reads the aggregated duration
- Record-deposit dialog: the existing amount display becomes an editable input, defaults to 20.000, validated `>= 20`, no upper bound
- Booking confirmation flow (Spec 60): Deposit Invoice `totalAmount` comes from the amount entered in the dialog, not from a hardcoded 20
- Booking detail view shows all selected packages
- Update audit log to capture changes to the package list

### Out of Scope

- Any change to Order / OrderPackage (70c)
- Invoice line builder changes (70c)
- POS package change flow (70c)
- Removing singular `packageId` / `sessionType` (70d)
- Retiring `BookingSessionType` enum (70d)
- Per-line extra-photo counts on bookings (not a booking concern; lives on OrderPackage)

---

## UI Requirements

### Add Booking / Edit Booking — Package Section

- Replace the single package dropdown with a list of selected packages plus an "Add package" button
- Each row in the list shows: package name (with department + session type derived display), quantity selector (default 1, min 1), remove button
- "Add package" opens a picker scoped by Department → Session Type → Package Family → Package (reusing the Spec 68 cascade). The user can pick from any session type — packages from different session types coexist in one booking.
- Below the list, show the aggregated duration: "Total session duration: X minutes (Y hours Z min)"
- A booking must have at least one package to save — surface this inline
- Reordering: drag-and-drop or up/down buttons for `sortOrder`

### Record Deposit Payment Dialog

- The existing amount display becomes an editable numeric input labeled "Amount (KD)"
- Default: 20.000
- Validation: `>= 20.000`, max 3 decimal places, no upper bound
- Help text: "Default is 20 KD. Increase only if agreed with the customer."
- On submit, the Deposit Invoice is created with this amount as `totalAmount` and locked (same lock mechanism as today)
- After lock, the dialog cannot be reopened — same behavior as today

### Booking Detail Page

- Replace the single package display with a packages list (same columns: name, dept, session type, quantity, duration contribution)
- Show: Total duration | All other existing fields. Deposit amount remains a property of the Deposit Invoice — surface it from there as today.

### Calendar

- Calendar slots render at the aggregated duration. No visual change beyond longer/shorter time blocks.
- Overlap prevention uses the aggregate.

---

## Service Layer

`src/modules/bookings/booking.service.ts`:

- `createBooking` accepts `packages: { packageId: string; quantity?: number; sortOrder?: number }[]`. The form must send at least one. Service:
  1. Resolves each `packageId` to its `sessionTypeId` via the Spec 68 helper `getPackageSessionType`
  2. Creates the `Booking` row
  3. Creates `BookingPackage` rows in order
  4. Stamps the singular fields from the first line
- `updateBooking` accepts a full replacement of the packages array. Service:
  1. Diffs the existing rows vs the incoming list
  2. Removes rows not in the new list, creates new ones, updates `quantity`/`sortOrder` on retained rows
  3. Re-stamps the singular fields from the new first line
  4. Recomputes any downstream computed fields that depend on duration (none stored, just calendar reads)
- `getBookingDurationMinutes(bookingId)` — new helper. Sums `(durationMinutes × quantity)` across all `BookingPackage` rows. Used by calendar and the booking detail view.
- `recordDeposit(bookingId, amount, ...)` (Spec 60 flow): accepts `amount` from the dialog input, validates `>= 20`, and uses it as the `totalAmount` of the Deposit Invoice instead of the hardcoded 20.

`src/modules/calendar/calendar.service.ts`:

- Overlap detection: replace any hardcoded duration assumption with `getBookingDurationMinutes`
- Calendar event rendering: same

`src/modules/bookings/booking.schema.ts`:

- Add zod validation for `packages` array (min length 1).
- Add zod validation for the deposit `amount` on the record-deposit action (`>= 20`, max 3 decimals).

---

## Audit Log

Add new entries to the existing booking activity / order activity log (whichever owns booking-level audit):

- `BOOKING_PACKAGES_CHANGED` — fired on any add/remove/reorder/quantity change. Metadata: before/after package list.

Deposit amount no longer needs a dedicated audit type — it is captured once, immutably, on the Deposit Invoice itself when the payment is recorded.

If the booking activity log table doesn't already exist, defer audit to a follow-up spec — do not introduce a new log model here.

---

## Acceptance Criteria

- Booking add/edit form supports multiple packages with quantity and reorder
- Form rejects save with zero packages
- Aggregated duration displays in the form and on the booking detail page
- Calendar overlap and rendering uses the aggregated duration
- Record-deposit dialog accepts an editable amount (`>= 20`, default 20)
- Deposit Invoice (Spec 60 flow) uses the dialog amount as `totalAmount`
- Singular `Booking.packageId` and `Booking.sessionType` stay in sync with the first `BookingPackage` row
- Audit log captures package list changes (if log infrastructure exists)
- All existing booking flows continue to work
- `npm run build` passes
- `npm run lint` passes
- `context/progress-tracker.md` is updated

---

## Decisions

- **Dual-write to singular fields.** Downstream code (POS, invoices, commission) is still on the singular `packageId` until Spec 70c. Dual-writing during 70b keeps the system functional through the migration. The cost is a few lines of stamping logic that 70d will delete.
- **At least one package required.** A booking with zero packages is meaningless. Surfacing this in the form is cheaper than allowing it and surfacing it downstream.
- **No setup/teardown buffer.** Per owner Q5, duration is a pure sum. Buffers can be added later as a Package.bufferMinutes field if the business introduces them.
- **Reverse enum mapping uses the first line.** Some bookings will mix session types; we have to pick one to store in the legacy `Booking.sessionType` enum. Using the first line (lowest sortOrder) is consistent and predictable. The legacy enum is going away in 70d, so the imprecision is temporary.
- **Deposit amount lives in the record-deposit dialog, not on the booking form.** Before payment there is no agreed deposit in the system — the agreement lives in the conversation. Capturing it at the moment of payment avoids a second source of truth (booking field vs invoice) that has to stay in sync. The Deposit Invoice already stores the amount immutably once recorded.
- **Deposit minimum of 20 KD.** No upper bound. Below 20 is rejected because the business rule is "20 is the default, can be higher" — anything lower would be a different deposit model.
- **Per-package quantity, not per-line duplication.** Two of the same package in one booking is `quantity: 2`, not two separate rows. Different packages are different rows.

---

## Assumptions

- The Deposit Invoice locking mechanism from Spec 60 is in place and exposes a queryable flag (e.g., the Deposit Invoice exists and `isLocked = true`).
- The calendar overlap logic does not currently encode any package-duration assumption beyond a single duration value; the rewrite to read the aggregate is straightforward.
- The booking audit log exists; if not, audit entries are deferred to a follow-up rather than gating this spec.
