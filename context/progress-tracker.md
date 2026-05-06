# Progress Tracker

Update this file after meaningful implementation changes. Keep it as a current-state snapshot, not a history log.

## Now
- Current phase: Feature 26 implemented.
- Current goal: validate order package/add-on invoice sync against real workflow data.

## Key State
- `publicId` and `jobNumber` are separate concepts.
- `jobNumber` is immutable and shared across the booking/order/invoice/payment workflow.
- Deposit truth comes from `Payment` records, not `Booking.depositPaid`.
- Studio departments are database-backed; active seeded departments are Newborn and Kids.
- Booking edits now use `departmentId` instead of free-text department values.
- New booking job numbers use `StudioDepartment.code`; the old hardcoded department-name mapping is retired.
- Order package and add-on edits now sync the active order invoice total, paid amount, remaining balance, and status in the same transaction.
- Existing invoice payments remain append-only; financial order edits recalculate invoice math without overwriting payment records.
- Upgrade commission integration is represented by a service-layer hook for future commission persistence.

## Recent Milestones
- Feature 26: order package/add-on edits now use invoice-recognized package baseline math, update invoice totals/balance due transactionally, preview financial consequences on the edit page, and provide a create/open invoice path from order details.
- Hydration fix: `CalendarGrid` now uses a deterministic initial period label and defers `FullCalendar` rendering until after mount to avoid server/client markup drift.
- Feature 25: studio departments implemented with database-backed booking department selection, `StudioDepartment.code` job-number prefixes, explicit unmapped legacy-department migration validation, and add/edit form serialization guards.
- Development tooling: workflow reset button added for development with confirmation, server-side development guard, and auto-dismissing feedback.
- Feature 24: public IDs and shared job numbers implemented with DB-backed sequences and immutable job-number enforcement.
- Feature 23: booking details page added as a read-only view.
- Feature 22: booking model and flow aligned around booking-owned fields, booking-linked invoices, and payment-derived deposit state.
- Feature 21: booking deposit recording implemented through invoice + payment creation in one transaction.

## Open Follow-Ups
- Review the public ID and job-number implementation against the latest gap-review notes.
- Confirm any remaining department/backfill edge cases for legacy booking data.
- Keep new work aligned with the current schema and service-layer workflow rules.

## Validation Pattern
- Use the relevant feature spec or review doc for detail.
- Validate with the smallest command set needed for the change.
- Prefer `build`, `lint`, and migration checks when schema/workflow changes are involved.
