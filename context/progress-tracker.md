# Progress Tracker

Update this file after meaningful implementation changes. Keep it as a current-state snapshot, not a history log.

## Now
- Current phase: Feature 25 implemented.
- Current goal: review follow-ups for public IDs, shared job numbers, and database-backed studio departments.

## Key State
- `publicId` and `jobNumber` are separate concepts.
- `jobNumber` is immutable and shared across the booking/order/invoice/payment workflow.
- Deposit truth comes from `Payment` records, not `Booking.depositPaid`.
- Studio departments are database-backed; active seeded departments are Newborn and Kids.
- Booking edits now use `departmentId` instead of free-text department values.
- New booking job numbers use `StudioDepartment.code`; the old hardcoded department-name mapping is retired.

## Recent Milestones
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
