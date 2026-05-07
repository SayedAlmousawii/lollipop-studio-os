# Progress Tracker

Update this file after meaningful implementation changes. Keep it as a current-state snapshot, not a history log.

## Now
- Current phase: Feature 38 implemented.
- Current goal: review the customer edit page and duplicate-phone validation in-app.

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
- Orders now store separate workflow sub-statuses for selection, editing, production, and delivery.
- Order read models expose stored workflow sub-status labels plus computed payment status derived from invoice/payment state.
- Order workflow status writes go through service-layer transition validation.
- Order activity persistence now records order creation, package/add-on edits, invoice adjustments, payments, workflow changes, completion, and note updates.
- Order activity reads are available through a timeline-safe service ordered chronologically for one order.
- Order details now use a tabbed operational hub shell with a compact header, workflow strip, overview workspace, read-only workflow tabs, financials, and recent activity preview.
- Selection tab now supports selected-photo counts, add-ons, notes, completion, package decision guidance, and service-layer financial routing.
- Extra selected photos are treated as a per-photo service-computed add-on charge using the database-backed extra-photo add-on option.
- Selection add-ons are now chosen from database-backed add-on options while order selections continue to store the priced snapshot on the order.
- Selection photo entry now captures extra photos only; total selected photos are computed from the package limit plus extras.
- Editing tab now supports editor assignment/reassignment, start, revision request, completion for approval, customer approval, and explicit production handoff.
- Editing workflow state stores assignment date, progress counts, revision count, approval/handoff timestamps, and estimated completion date on the order.
- Editing start is blocked unless selection is completed, an editor is assigned, and an order-linked invoice has a recorded `PaymentType.BASE` payment.
- Production tab now supports album design, printing, album assembly, vendor/outsource work, framed prints, and final readiness tracking.
- Production workflow state stores section-level production statuses and a production-ready timestamp on the order.
- Production readiness for pickup updates production status, delivery readiness context, and high-level order status through service-layer transitions.
- Delivery tab now supports prepare-for-pickup, customer notification, pickup recording, and controlled order completion actions.
- Delivery workflow state stores prepared/notified/picked-up/completed timestamps, pickup notes, completion actor, and payment override reason on the order.
- Order completion is service-guarded by pickup recording, finished production sections, and settled payment or an explicit admin override reason.
- Customer edit is available from the customers list and updates only Customer model fields: name, phone, status, and notes.

## Recent Milestones
- Feature 38: Edit customer flow added at `/customers/[customerId]/edit` with service-layer single-customer loading, shared customer form/schema reuse, status editing, server action update handling, duplicate-phone conflict messaging, and redirect back to `/customers`.
- Feature 37: New customer flow added at `/customers/new` with shared customer creation schema, reusable customer form, server action, service-layer creation, duplicate-phone handling, active-by-default customers, and successful redirect back to `/customers`.
- Feature 36: Customers list filters are now URL-driven and server-rendered. `search` matches customer name or phone, `status` accepts only ACTIVE/INACTIVE, row actions link to profile and new booking routes, edit is explicitly disabled as coming soon, empty customer results show a clear state, and `/bookings/new?customerId=...` preselects a valid customer without changing booking workflow rules.
- Feature 35 review follow-up: bound booking id server-side in the base payment action, added row locking to the base payment transaction, blocked selection updates for cancelled orders, and made the auto-calculated amount field explicitly read-only in the UI.
- Feature 35 follow-up: base payment amount is now read-only in the booking detail and bookings list modals so staff records the service-computed remaining balance without editing it.
- Feature 35 follow-up: added `Record Base Payment` to the bookings list row menu for confirmed bookings only, reusing the same prefilled remaining-balance modal path as the booking detail page.
- Feature 35 review fix: sealed the old `updateBookingStatus()` completion path so `CONFIRMED` bookings can no longer bypass base-payment recording to become `COMPLETED`, and `recordBasePaymentAndComplete()` now writes an explicit order activity trail for base payment recorded, booking completed, and order created using the existing order activity system. No schema changes required.
- Feature 35: base payment gate implemented. `recordBasePaymentAndComplete()` service method runs a single transaction: creates a `BASE` payment against the booking invoice, transitions booking to `COMPLETED`, and creates the order with `WAITING_SELECTION` status. "Mark Completed" removed from `BookingStatusActions` for Confirmed bookings; "Record Base Payment" modal added to the booking detail page (amount pre-filled to `packagePrice − depositPaid`). Selection tab shows a locked panel for `ACTIVE` orders. `updateOrderSelectionWorkflow` rejects `ACTIVE` orders with a clear error. `resolveNextOrderAction` surfaces the base-payment hint as the second priority step. `orderStatus` added to `OrderSelectionWorkflow`. No schema changes required.
- Feature 34: Financials tab enriched with invoice number, full price breakdown (base package, upgrade charge, add-on total, extra photos, invoice total, paid, balance due), payment records list, and invoice link. Activity tab replaced with full chronological timeline with event-type filtering (All / Financial / Workflow / Package). `getOrderFinancialSummary` service function added; `OrderFinancialSummary` and `OrderPaymentStage` types added; `ActivityTabContent` client component created.
- Feature 33: operational Delivery workflow tab added with pickup readiness, notification, pickup notes, completion metadata, completion guards, payment override capture, and delivery activity records.
- Feature 32: operational Production workflow tab added with production section actions, early-start warnings, pickup readiness tracking, and production activity records.
- Feature 31: operational Editing workflow tab added with editor assignment, progress counts, revision tracking, customer approval, base-payment start gate, and explicit production handoff.
- Feature 30: operational Selection workflow tab added with service-computed limits, overage context, package upgrade guidance, add-on management, notes, and completion actions.
- Feature 30 follow-up: database-backed add-on options added, Selection add-on entry changed from free text to dropdown choices, and extra selected photos now affect the selection add-on total/invoice sync.
- Feature 30 follow-up: Photo Selection UX changed from editable total selected photos to editable extra photos with a read-only computed total.
- Feature 29: tabbed order hub UI shell added on top of the existing order, invoice, workflow sub-status, and activity read models.
- Feature 28: lightweight order activity foundation added with structured metadata and service-layer writes from key order, invoice, payment, and workflow flows.
- Feature 27: order workflow sub-status enums/fields added, legacy order rows backfilled with conservative defaults, order detail reads switched off flat-status-derived workflow labels, and payment status is computed from invoice state.
- Feature 26: order package/add-on edits now use invoice-recognized package baseline math, update invoice totals/balance due transactionally, preview financial consequences on the edit page, and provide a create/open invoice path from order details.
- Hydration fix: `CalendarGrid` now uses a deterministic initial period label and defers `FullCalendar` rendering until after mount to avoid server/client markup drift.
- Feature 25: studio departments implemented with database-backed booking department selection, `StudioDepartment.code` job-number prefixes, explicit unmapped legacy-department migration validation, and add/edit form serialization guards.
- Development tooling: workflow reset button added for development with confirmation, server-side development guard, and auto-dismissing feedback.
- Feature 24: public IDs and shared job numbers implemented with DB-backed sequences and immutable job-number enforcement.
- Feature 23: booking details page added as a read-only view.
- Feature 22: booking model and flow aligned around booking-owned fields, booking-linked invoices, and payment-derived deposit state.
- Feature 21: booking deposit recording implemented through invoice + payment creation in one transaction.

## Open Follow-Ups
- Manually submit the `/customers/[customerId]/edit` form in-app against the target database, including a duplicate phone case and an inactive-status update.
- Manually submit the `/customers/new` form in-app against the target database, including a duplicate phone case.
- Build Feature 39 customer profile route so the new `View Profile` customer row action has a full destination UI.
- Review the Delivery workflow tab in-app, including payment override handling and production-complete blockers.
- Review the Production workflow tab in-app, including early-start warnings and ready-for-pickup handoff into Delivery.
- Review the Editing workflow tab in-app, including base-payment blocked and approved-to-production paths.
- Review the public ID and job-number implementation against the latest gap-review notes.
- Confirm any remaining department/backfill edge cases for legacy booking data.
- Keep new work aligned with the current schema and service-layer workflow rules.

## Feature 37 Implementation Notes
- Files modified: `app/customers/page.tsx`, `src/modules/customers/customer.service.ts`, `context/progress-tracker.md`.
- Files created: `app/customers/actions.ts`, `app/customers/new/page.tsx`, `src/components/customers/customer-form.tsx`, `src/modules/customers/customer.schema.ts`.
- Assumptions: V1 creation defaults customers to `ACTIVE` and does not expose status selection; successful creation redirects to `/customers` because the customer profile route is not implemented yet; phone values are normalized by removing spaces, parentheses, and hyphens before persistence.
- Validation: `npx tsc --noEmit`, `npm run lint`, `npm run build`, `git diff --check`, and GET smoke checks for `/customers/new` and `/customers` completed successfully. I did not create a throwaway database customer during smoke testing.

## Feature 38 Implementation Notes
- Files modified: `app/customers/actions.ts`, `src/components/customers/customer-form.tsx`, `src/components/customers/customers-table.tsx`, `src/modules/customers/customer.schema.ts`, `src/modules/customers/customer.service.ts`, `context/progress-tracker.md`.
- Files created: `app/customers/[customerId]/edit/page.tsx`.
- Assumptions: Successful customer edits redirect to `/customers` because Feature 39's customer profile route is not implemented yet; edit exposes `ACTIVE`/`INACTIVE` status because the unit requires status updates; phone normalization remains the same as Feature 37.
- Validation: `npx tsc --noEmit`, `npm run lint`, and `npm run build` completed successfully.

## Feature 36 Implementation Notes
- Files modified: `app/customers/page.tsx`, `src/modules/customers/customer.service.ts`, `src/components/customers/customers-filters.tsx`, `src/components/customers/customers-table.tsx`, `app/bookings/new/page.tsx`, `src/components/bookings/new-booking-form.tsx`, `context/progress-tracker.md`.
- Assumptions: Customer edit remains unavailable in this unit because no `/customers/[customerId]/edit` route exists yet; `View Profile` intentionally links to the future customer detail route defined by the feature spec; booking preselection only seeds the customer combobox and does not alter booking validation or workflow behavior.
- Validation: `npx tsc --noEmit`, `npm run lint`, and `npm run build` completed successfully.

## Feature 33 Implementation Notes
- Files modified: `app/orders/[orderId]/actions.ts`, `app/orders/[orderId]/page.tsx`, `context/progress-tracker.md`, `prisma/schema.prisma`, `src/modules/orders/order.schema.ts`, `src/modules/orders/order.service.ts`, `src/modules/orders/order.types.ts`.
- Files created: `prisma/migrations/20260506220000_order_delivery_workflow_fields/migration.sql`, `src/components/orders/delivery-workflow-form.tsx`.
- Assumptions: V1 captures the completing staff member as a required form field because stable actor context is not wired into order actions yet; unsettled payment completion is allowed only through the explicit override checkbox plus reason; delivery completion requires all lightweight production section statuses to be complete.
- Validation: `npx prisma generate`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx prisma migrate deploy`, and `npx prisma migrate status` completed successfully.

## Feature 32 Implementation Notes
- Files modified: `app/orders/[orderId]/actions.ts`, `app/orders/[orderId]/page.tsx`, `context/progress-tracker.md`, `prisma/schema.prisma`, `src/modules/orders/order.constants.ts`, `src/modules/orders/order.schema.ts`, `src/modules/orders/order.service.ts`, `src/modules/orders/order.types.ts`.
- Files created: `prisma/migrations/20260506210000_order_production_workflow_fields/migration.sql`, `src/components/orders/production-workflow-form.tsx`.
- Assumptions: V1 stores production section state directly on `Order`; vendor/outsource status is a lightweight section status rather than a vendor directory; admin-first early production movement shows a warning but still records the transition.
- Validation: `npx prisma generate`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx prisma migrate deploy`, and `npx prisma migrate status` completed successfully.

## Feature 31 Implementation Notes
- Files modified: `app/orders/[orderId]/actions.ts`, `app/orders/[orderId]/page.tsx`, `context/progress-tracker.md`, `prisma/schema.prisma`, `src/modules/orders/order.constants.ts`, `src/modules/orders/order.schema.ts`, `src/modules/orders/order.service.ts`, `src/modules/orders/order.types.ts`.
- Files created: `prisma/migrations/20260506200000_order_editing_workflow_fields/migration.sql`, `src/components/orders/editing-workflow-form.tsx`.
- Assumptions: V1 stores editing assignment/progress metadata directly on `Order`; “base package payment verified” means at least one order-linked invoice payment with `paymentType = BASE`; “mark editing complete” moves work to customer approval, while “send to production” completes editing and starts production.
- Validation: `npx prisma generate`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx prisma migrate deploy`, and `npx prisma migrate status` completed successfully.

## Feature 30 Implementation Notes
- Files modified: `app/orders/[orderId]/actions.ts`, `app/orders/[orderId]/page.tsx`, `prisma/schema.prisma`, `prisma/seed.ts`, `src/components/orders/selection-workflow-form.tsx`, `src/modules/invoices/invoice.service.ts`, `src/modules/orders/order.schema.ts`, `src/modules/orders/order.service.ts`, `src/modules/orders/order.types.ts`.
- Files created: `prisma/migrations/20260506193000_order_add_on_options/migration.sql`, `src/components/orders/selection-workflow-form.tsx`.
- Assumptions: selection completion timestamp can be surfaced from the latest `SELECTION_COMPLETED` activity rather than adding a new database column; selected add-ons can remain stored as order JSON snapshots with `optionId`, `name`, and `price` until a fuller add-on catalog/order-line unit exists; Selection tab staff input should capture extra photos and derive stored total selected photos from the package limit.
- Validation: `npx prisma generate`, `npx tsc --noEmit`, `npx prisma migrate deploy`, `npm run lint`, `npm run build`, and `npx prisma migrate status` completed successfully. Latest UX-only follow-up also passed `npx tsc --noEmit`, `npm run lint`, and `npm run build`.

## Feature 29 Implementation Notes
- Files modified: `app/orders/[orderId]/page.tsx`, `src/modules/orders/order.service.ts`, `src/modules/orders/order.types.ts`.
- Assumption: customer and package records remain list-level links until dedicated customer/package detail routes exist.
- Validation: `npx tsc --noEmit`, `npm run lint`, and `npm run build` completed successfully.

## Feature 28 Implementation Notes
- Files modified: `prisma/schema.prisma`, `src/modules/orders/order.service.ts`, `src/modules/invoices/invoice.service.ts`, `src/modules/payments/payment.service.ts`.
- Files created: `prisma/migrations/20260506183000_order_activity_foundation/migration.sql`, `src/modules/orders/order-activity.service.ts`, `src/modules/orders/order-activity.types.ts`.
- Assumption: `userId` remains nullable in current admin-first flows until stable actor context is wired through actions/services.
- Validation: `npm run db:generate`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx prisma migrate deploy`, and `npx prisma migrate status` completed successfully.

## Feature 27 Implementation Notes
- Files modified: `prisma/schema.prisma`, `prisma/seed.ts`, `src/modules/orders/order.constants.ts`, `src/modules/orders/order.schema.ts`, `src/modules/orders/order.service.ts`, `src/modules/orders/order.types.ts`, `app/orders/[orderId]/page.tsx`.
- Files created: `prisma/migrations/20260506170000_order_workflow_sub_statuses/migration.sql`.
- Assumption: historical orders can be backfilled from their existing high-level status once during migration; future reads use stored workflow sub-status fields as source of truth.
- Validation: `npx prisma generate`, `npm run lint`, `npm run build`, `npx prisma migrate deploy`, and `npx prisma migrate status` completed successfully.

## Validation Pattern
- Use the relevant feature spec or review doc for detail.
- Validate with the smallest command set needed for the change.
- Prefer `build`, `lint`, and migration checks when schema/workflow changes are involved.
