# Progress Tracker

Update this file after meaningful implementation changes. Keep it as a current-state snapshot, not a history log.

## Now
- Current phase: Feature 51b implemented.
- Current goal: all auth/permission gaps from Feature 50–51 review are closed; ready for workflow guard hardening or next unit.

## Key State
- `jobNumber` is the sole staff-facing operational identifier.
- Clerk now owns authentication/session state; Prisma `User` remains the source of truth for Studio OS staff role and internal identity.
- `User.clerkId` is the nullable unique long-term link between a Clerk user and one Studio OS staff user.
- Sensitive server actions now authorize through a shared `src/lib/permissions` layer backed by Prisma app-user roles rather than ad hoc Clerk-only checks.
- The centralized permission map covers booking status updates, payment recording, invoice creation/issue/close/adjustment creation, financially meaningful order edits, delivery workflow updates, delivery completion, delivery payment overrides, editing workflow updates, and production workflow updates.
- `RECEPTIONIST` now holds `invoice:create` explicitly (resolves implicit invoice creation debt).
- Dashboard layout calls `requireCurrentAppUser()` as defense-in-depth behind `proxy.ts`.
- Unlinked Clerk users are redirected to `/unauthorized` instead of crashing with a 500.
- `app/unauthorized.tsx` exists and renders an access-denied page.
- High-risk server actions now pass `actorUserId` into service-layer financial and workflow operations so order activity writes and delivery completion attribution can use the signed-in Prisma user.
- Delivery completion now attributes the completing actor to the authenticated linked staff user instead of trusting a manually selected completion actor when auth context is available.
- Dashboard/app routes are protected by the Next.js 16 `proxy.ts` convention; `/sign-in` is the only intended public app route.
- Server-side auth/app-user lookup is centralized in `src/lib/auth`, with first local linking by matching Clerk primary email to an unlinked Prisma user.
- Canonical `Job` rows now own immutable `jobNumber` values; `Booking.jobId` is required and is the source-of-truth booking attachment.
- `Order`, `Invoice`, and `Payment` now also carry canonical `jobId` links back to `Job` for downstream joins; the transitional booking/order/invoice public IDs remain only for compatibility storage, not active staff-facing reads.
- Invoice ownership is anchored by required `customerId` + `jobId`; `bookingId` and `orderId` remain nullable workflow context links that are validated when present.
- Session workflow invoices use one rolling primary invoice that starts at booking and attaches to the order when the order exists; duplicate primary workflow invoices are blocked by service validation and partial unique indexes.
- `EditingJob` now owns editing assignment, progress, revision, and approval/handoff state; the old order-level editing fields were removed from the read/write path.
- `ProductionJob` now owns production status, section progress, and pickup-readiness timestamps; the old order-level production fields were removed from the read/write path.
- `Order.deliveryCompletedById` (FK to `User`) is now the active delivery actor reference; `Order.deliveryCompletedBy` (free-text) is retained as a non-authoritative legacy fallback only.
- `jobNumber` is immutable and shared across the booking/order/invoice/payment workflow.
- Deposit truth comes from `Payment` records, not `Booking.depositPaid`.
- Studio departments are database-backed; active seeded departments are Newborn and Kids.
- Booking edits now use `departmentId` instead of free-text department values.
- New booking job numbers use `StudioDepartment.code`; the old hardcoded department-name mapping is retired.
- Job number generation now self-heals if `identifier_sequences` falls behind existing canonical `Job.jobNumber` rows.
- Development workflow reset now clears canonical `Job` rows in addition to bookings/orders/invoices/payments and sequence state, so test data resets also restart job-number allocation.
- Order package and add-on edits now sync the active order invoice total, paid amount, remaining balance, and status in the same transaction.
- Existing invoice payments remain append-only; financial order edits recalculate invoice math without overwriting payment records.
- Upgrade commission integration is represented by a service-layer hook for future commission persistence.
- Orders now store separate workflow sub-statuses for selection, editing, production, and delivery.
- Order read models expose stored workflow sub-status labels plus computed payment status derived from invoice/payment state.
- Order workflow status writes go through service-layer transition validation.
- Order activity persistence now records order creation, package/add-on edits, invoice adjustments, payments, workflow changes, completion, and note updates.
- Order activity reads are available through a timeline-safe service ordered chronologically for one order.
- Order details now use a tabbed operational hub shell with a compact header, workflow strip, overview workspace, read-only workflow tabs, financials, and recent activity preview.
- Feature 44 cleanup: booking and order tables/details now show `jobNumber` only, invoice read/search uses `invoiceNumber` plus `jobNumber`, and booking/order/invoice public IDs are no longer exposed in active staff-facing reads.
- Selection tab now supports selected-photo counts, add-ons, notes, completion, package decision guidance, and service-layer financial routing.
- Extra selected photos are treated as a per-photo service-computed add-on charge using the database-backed extra-photo add-on option.
- Selection add-ons are now chosen from database-backed add-on options while order selections continue to store the priced snapshot on the order.
- Order add-ons are now persisted as structured `OrderAddOn` rows with snapshot fields (`nameSnapshot`, `priceSnapshot`, `quantity`, nullable `addOnOptionId`) — `Order.addOns` JSON is deprecated and no longer the active source of truth.
- Existing JSON add-ons are backfilled into structured rows by migration `20260508010000_structured_order_add_ons`.
- All service-layer reads (order detail, selection workflow, editable order, invoice creation, invoice sync) now source add-ons from `OrderAddOn` rows; writes delete and recreate rows inside the same transaction while keeping the JSON field updated for compatibility.
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
- Customer edit opens in a dialog from the customers list and customer profile page, and updates only Customer model fields: name, phone, status, and notes.
- Customer profiles are read-first hubs that show core contact context, linked children, bookings, orders, and recent booking/order history without owning invoice, payment, or workflow controls.
- Customer profiles now support child add/edit dialogs using the existing Child model fields: name and optional date of birth.
- Customer profiles now show internal notes as a dedicated persisted staff context section, edited through the existing customer update flow.

## Recent Milestones
- Feature 51b: auth hardening and permission completion — `app/unauthorized.tsx` created; dashboard layout guard added; unlinked-user crash replaced with redirect; `RECEPTIONIST` granted `invoice:create`; `workflow:editing-update` and `workflow:production-update` added with role assignments; both workflow actions now require permission instead of auth-only.
- Feature 51: shared permission guard foundation added under `src/lib/permissions`; sensitive booking, invoice, payment, order-financial, and delivery server actions now require linked app-user authorization; actor-aware service signatures now propagate `actorUserId` into order activity and delivery completion writes.
- Feature 50: Clerk auth and staff identity foundation added with `@clerk/nextjs`, `ClerkProvider`, Next.js 16 `proxy.ts`, Clerk sign-in route, topbar `UserButton`, nullable unique `User.clerkId`, centralized server-only auth helpers, and email-based first local app-user linking.
- Feature 49 concurrency review fix: invoice financial-edit updates now use a lock-guarded write, and workflow invoice creation recovers from duplicate-create races by re-reading the winning invoice.
- Feature 49 locked-invoice guard: primary workflow invoice normalization now refuses to attach an `orderId` to locked invoices.
- Feature 49 follow-up: primary workflow invoice reuse now updates with an unlocked predicate and aborts cleanly if the invoice locks between lookup and reuse.
- Feature 49: invoice ownership integrity tightened around customer-owned job threads; booking/order invoice context is normalized and composite-FK validated when present; rolling booking/order invoice reuse is enforced in service paths.
- Feature 47: structured `OrderAddOn` table added with snapshot fields; JSON backfill migration; all service-layer add-on reads/writes switched to structured rows; `Order.addOns` JSON deprecated; ER diagram updated.
- Feature 45: editing workflow extraction moved assignment, timestamps, progress, revision count, and approval/handoff state into a dedicated `EditingJob` row with a backfill migration and service-layer read/write updates.
- Feature 46: production workflow extraction moved production status, section progress, and pickup-readiness data into a dedicated `ProductionJob` row with a backfill migration and service-layer read/write updates.
- Feature 43: downstream canonical `jobId` adoption added for `Order`, `Invoice`, and `Payment` with service-layer write path updates, safe backfill, consistency-validation, and composite-FK integrity migrations, Prisma schema/documentation refresh, and seed data updates.
- Feature 42: canonical `Job` ownership added with `Booking.jobId`, safe booking backfill migration, transactional job creation during new booking writes, booking-customer sync into the canonical job row, and updated schema documentation for the new relationship.
- Feature 44: identifier cleanup removed booking/order public IDs from active UI/search/read models, switched invoice references to `invoiceNumber`/`jobNumber`, and left the transitional schema fields intact for compatibility.
- Feature 44 bugfix: new booking creation now submits `sessionType` explicitly and job-number generation advances from existing `jobs.jobNumber` values when the sequence table is empty or stale.
- Development workflow reset bugfix: the reset service now deletes canonical `Job` rows too, so resetting workflow test data also resets subsequent `jobNumber` allocation.
- Feature 41: customer internal notes surfaced as a dedicated profile section with preserved line breaks and a focused edit action using the existing persisted customer update dialog.
- Feature 40: child management added inside `/customers/[customerId]` with service-layer create/update methods, Zod validation, profile revalidation, full child list rendering, and inline add/edit dialogs.
- Customer edit dialog hydration fix: `CustomersTable` now runs as a Client Component so dropdown/dialog event handlers are created on the client side instead of crossing the server/client boundary.
- Feature 39 follow-up: Customer editing now uses a popup dialog from both `/customers` and `/customers/[customerId]`, reusing the shared customer form with dialog cancel behavior; the old full-page `/customers/[customerId]/edit` route was removed.
- Feature 39: Customer profile hub added at `/customers/[customerId]` with service-layer profile read model, summary metrics, contact and notes section, children preview, linked bookings/orders tables, recent history, and next-action links to edit customer or create a booking.
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
- Consider adding explicit job categorization (`SESSION`, `VOUCHER`, `RETAIL`, `OTHER`) before future voucher or standalone sales invoice flows.
- Review whether any remaining reads should be switched from `jobNumber` to canonical `jobId` joins in a later cleanup unit.
- Manually test editing internal notes from `/customers/[customerId]`, including line breaks, clearing notes, and refresh persistence.
- Manually test adding and editing children from `/customers/[customerId]`, including required-name validation and optional date-of-birth clearing.
- Manually test the customer edit dialog from the customers list and the profile page, including duplicate phone validation and successful save return paths.
- Manually review `/customers/[customerId]` in-app against customers with and without linked children, bookings, and orders.
- Manually submit the `/customers/new` form in-app against the target database, including a duplicate phone case.
- Review the Delivery workflow tab in-app, including payment override handling and production-complete blockers.
- Review the Production workflow tab in-app, including early-start warnings and ready-for-pickup handoff into Delivery.
- Review the Editing workflow tab in-app, including base-payment blocked and approved-to-production paths.
- Review the public ID and job-number implementation against the latest gap-review notes.
- Confirm any remaining department/backfill edge cases for legacy booking data.
- Keep new work aligned with the current schema and service-layer workflow rules.

## Feature 43 Implementation Notes
- Files modified: `context/reviews/current-database-er-diagram.md`, `prisma/schema.prisma`, `prisma/seed.ts`, `src/modules/invoices/invoice.service.ts`, `src/modules/orders/order.service.ts`, `src/modules/payments/payment.service.ts`, `context/progress-tracker.md`.
- Files created: `prisma/migrations/20260507020000_downstream_jobid_adoption/migration.sql`, `prisma/migrations/20260507021000_downstream_jobid_consistency_validation/migration.sql`, `prisma/migrations/20260507022000_downstream_jobid_composite_integrity/migration.sql`.
- Assumptions: `Order.jobId` remains a one-to-one canonical link because each booking/job still produces a single active order in the current workflow; downstream invoice/payment rows can share the same job through many-to-one links.
- Validation: `npx prisma format`, `npx prisma generate`, `npx tsc --noEmit`, `npm run lint`, `npx prisma migrate deploy`, `npm run build`, `npx prisma migrate status`, and `git diff --check` completed successfully. Review follow-ups also passed `npx prisma format`, `npx prisma generate`, `npx tsc --noEmit`, `npm run lint`, `npx prisma migrate deploy`, `npm run build`, `npx prisma migrate status`, and `git diff --check`.

## Feature 49 Implementation Notes
- Files modified: `context/feature-specs/49-invoice-ownership-integrity.md`, `context/reviews/current-database-er-diagram.md`, `context/progress-tracker.md`, `prisma/schema.prisma`, `src/modules/invoices/invoice.service.ts`, `src/modules/orders/order.service.ts`.
- Files created: `prisma/migrations/20260508030000_invoice_ownership_integrity/migration.sql`.
- Assumptions: `Job` is the canonical customer-owned invoice thread; `bookingId` and `orderId` remain optional so future voucher/retail invoices can exist without session workflow context; current session invoices continue as one rolling primary invoice.
- Validation: `npx prisma format`, `npx prisma validate`, `npx prisma generate`, `npx tsc --noEmit`, `npx prisma migrate deploy`, `npm run lint`, `npm run build`, and `npx prisma migrate status` completed successfully.

## Feature 50 Implementation Notes
- Files modified: `.env.example`, `app/layout.tsx`, `context/progress-tracker.md`, `context/reviews/current-database-er-diagram.md`, `package-lock.json`, `package.json`, `prisma/schema.prisma`, `src/components/layout/app-shell.tsx`, `src/components/layout/topbar.tsx`.
- Files created: `app/sign-in/[[...sign-in]]/page.tsx`, `proxy.ts`, `prisma/migrations/20260509010000_user_clerk_identity_link/migration.sql`, `src/lib/auth/current-user.ts`, `src/lib/auth/index.ts`.
- Assumptions: the first local Clerk admin should use the seeded `admin+clerk_test@lollipopstudioos.dev` email with Clerk's development verification code, or another existing seeded staff email, so the helper can link that unlinked Prisma user on first authenticated lookup.
- Validation: `npx prisma format`, `npx prisma generate`, `npx prisma validate`, `npx tsc --noEmit`, `npx prisma migrate deploy`, `npm run lint`, `npm run build`, and `npx prisma migrate status` completed successfully. Runtime smoke: `/sign-in` returned 200; signed-out `/bookings` was intercepted by Clerk as signed-out in dev mode.

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

## Feature 39 Implementation Notes
- Files modified: `app/customers/actions.ts`, `src/modules/customers/customer.service.ts`, `src/modules/customers/customer.types.ts`, `context/progress-tracker.md`.
- Files created: `app/customers/[customerId]/page.tsx`.
- Assumptions: Recent history is composed from recent bookings and orders because there is no customer-specific activity log yet; children are preview-only because Feature 40 owns children management; notes stay read-only/minimal because Feature 41 is intended to expand notes, preferences, and tags.
- Validation: `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check` completed successfully.

## Feature 39 Follow-Up Notes
- Files modified: `app/customers/[customerId]/page.tsx`, `app/customers/actions.ts`, `src/components/customers/customer-form.tsx`, `src/components/customers/customers-table.tsx`, `src/modules/customers/customer.service.ts`, `src/modules/customers/customer.types.ts`, `context/progress-tracker.md`.
- Files created: `src/components/customers/customer-edit-dialog.tsx`.
- Files deleted: `app/customers/[customerId]/edit/page.tsx`.
- Assumptions: Saving from the customers list returns to `/customers`; saving from the profile returns to that customer profile; duplicate phone and field validation continue to render inside the dialog.
- Hydration fix: `src/components/customers/customers-table.tsx` is now a Client Component so the dropdown edit-dialog trigger keeps its event handlers on the client side.
- Validation: `npm run build`, `npx tsc --noEmit`, `npm run lint`, and `git diff --check` completed successfully.

## Feature 40 Implementation Notes
- Files modified: `app/customers/[customerId]/page.tsx`, `app/customers/actions.ts`, `src/modules/customers/customer.schema.ts`, `src/modules/customers/customer.service.ts`, `src/modules/customers/customer.types.ts`, `context/progress-tracker.md`.
- Files created: `src/components/customers/child-form-dialog.tsx`.
- Assumptions: Child management stays inside the customer profile; date of birth remains optional and can be cleared; children are ordered newest-first and returned as customer-owned records for future booking selectors.
- Validation: `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check` completed successfully.

## Feature 41 Implementation Notes
- Files modified: `app/customers/[customerId]/page.tsx`, `src/components/customers/customer-edit-dialog.tsx`, `context/progress-tracker.md`.
- Assumptions: `Customer.notes` is the only persisted customer-context field available in the current schema; preferences and tags remain future work because no persisted schema support was approved.
- Validation: `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check` completed successfully.

## Feature 42 Implementation Notes
- Files modified: `prisma/schema.prisma`, `prisma/seed.ts`, `src/modules/bookings/booking.service.ts`, `context/reviews/current-database-er-diagram.md`, `context/progress-tracker.md`.
- Files created: `prisma/migrations/20260507010000_job_entity_booking_foundation/migration.sql`.
- Assumptions: Current workflow remains one canonical job per booking, so `Booking.jobId` is enforced as unique; downstream `Order`/`Invoice`/`Payment` `jobId` adoption remains intentionally out of scope for this unit.
- Validation: `npx prisma format`, `npx prisma generate`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx prisma migrate deploy`, `npx prisma migrate status`, and `git diff --check` completed successfully.

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

## Feature 51b Implementation Notes
- Files created: `app/unauthorized.tsx`.
- Files modified: `app/(dashboard)/layout.tsx`, `app/orders/[orderId]/actions.ts`, `src/lib/auth/current-user.ts`, `src/lib/permissions/index.ts`, `context/reviews/auth-review.md`, `context/reviews/role-permissions-design.md`, `context/progress-tracker.md`.
- Assumptions: `workflow:production-update` is granted broadly (all roles except `ACCOUNTANT`) as a temporary stance while production workflow ownership is still undefined.
- Validation: `npx tsc --noEmit`, `npm run lint`, and `npm run build` completed successfully.

## Feature 51 Implementation Notes
- Files modified: `app/bookings/[bookingId]/actions.ts`, `app/bookings/actions.ts`, `app/invoices/actions.ts`, `app/orders/[orderId]/actions.ts`, `app/orders/[orderId]/edit/actions.ts`, `context/progress-tracker.md`, `src/components/orders/delivery-workflow-form.tsx`, `src/lib/auth/index.ts`, `src/modules/bookings/booking.service.ts`, `src/modules/invoices/invoice.service.ts`, `src/modules/orders/order.service.ts`, `src/modules/orders/order.types.ts`, `src/modules/payments/payment.service.ts`.
- Files created: `src/lib/auth/actor-context.ts`, `src/lib/permissions/index.ts`.
- Assumptions: This unit starts with the highest-risk existing mutation paths instead of full-app RBAC coverage; managers share the first delivery payment-override permission with admins; editing and production workflow actions now carry stable actor IDs through the auth helper, but broader role-specific policy for those paths remains deferred.
- Validation: `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check` completed successfully.

## Feature 45 Implementation Notes
- Files modified: `context/reviews/current-database-er-diagram.md`, `context/progress-tracker.md`, `prisma/schema.prisma`, `prisma/seed.ts`, `src/modules/orders/order.service.ts`.
- Files created: `prisma/migrations/20260507030000_extract_editing_job/migration.sql`.
- Assumptions: every existing order should receive one backfilled editing job row so the editing tab keeps rendering, even when the prior order row carried default editing state; new order creation seeds an empty editing job immediately; editing history display can keep using the same UI contract while the storage owner changes.
- Validation: `npx prisma generate`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx prisma migrate deploy`, and `npx prisma migrate status` completed successfully.

## Feature 46 Implementation Notes
- Files modified: `context/reviews/current-database-er-diagram.md`, `context/progress-tracker.md`, `prisma/schema.prisma`, `prisma/seed.ts`, `src/modules/orders/order.service.ts`.
- Files created: `prisma/migrations/20260507040000_extract_production_job/migration.sql`.
- Assumptions: V1 keeps one `ProductionJob` row per order as the pragmatic persisted owner for the existing production tab, even though future versions may expand to multiple production sub-jobs; send-to-production still marks the extracted production owner in progress before individual section actions are started.
- Validation: `npx prisma format`, `npx prisma generate`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx prisma migrate deploy`, `npx prisma migrate status`, and `git diff --check` completed successfully.

## Feature 44 Implementation Notes
- Files modified: `app/bookings/[bookingId]/page.tsx`, `app/customers/[customerId]/page.tsx`, `app/invoices/[id]/page.tsx`, `app/orders/[orderId]/page.tsx`, `context/reviews/current-database-er-diagram.md`, `context/progress-tracker.md`, `src/components/bookings/bookings-table.tsx`, `src/components/orders/orders-table.tsx`, `src/modules/bookings/booking.service.ts`, `src/modules/customers/customer.service.ts`, `src/modules/customers/customer.types.ts`, `src/modules/invoices/invoice.service.ts`, `src/modules/invoices/invoice.types.ts`, `src/modules/orders/order.service.ts`, `src/modules/orders/order.types.ts`, `src/modules/payments/payment.service.ts`.
- Assumptions: booking/order/invoice public IDs remain in the database for compatibility, but active staff-facing flows now use `jobNumber` and `invoiceNumber` exclusively; payment receipt public IDs remain unchanged.
- Validation: `npx tsc --noEmit`, `npm run lint`, and `npm run build` completed successfully.

## Feature 48 Implementation Notes
- Files modified: `context/reviews/current-database-er-diagram.md`, `context/progress-tracker.md`, `prisma/schema.prisma`, `src/modules/orders/order.schema.ts`, `src/modules/orders/order.service.ts`, `src/modules/orders/order.types.ts`, `src/components/orders/delivery-workflow-form.tsx`, `app/orders/[orderId]/actions.ts`.
- Files created: `prisma/migrations/20260508020000_delivery_completed_by_user_fk/migration.sql`.
- Assumptions: free-text `deliveryCompletedBy` values from before this migration cannot be programmatically mapped to user IDs; they are preserved as a non-authoritative legacy fallback and the read model falls back to them only when the FK is null. The "Completed by" form input is now a staff dropdown rather than a free-text field.
- Validation: `npx prisma generate`, `npm run lint`, `npm run build` completed successfully.