# Progress Tracker

Update this file after meaningful implementation changes. Keep it as a current-state snapshot, not a history log.

**Structure (do not drift from this):** Now · Key State (non-obvious decisions only) · Feature History (one line each, newest first) · Open Follow-Ups (actionable items only, remove when done) · Validation Pattern. No file lists, no per-feature implementation notes, no validation command logs — those belong in git.

## Now
- Feature 63 final invoice POS is complete: POS now creates and syncs a fresh `InvoiceType.FINAL` invoice scoped by `FinancialCase`, keeps Deposit Invoice records separate, displays the paid deposit deduction by invoice number in the sales summary, and records final-balance payments as `PaymentType.FINAL`.
- Feature 62 deposit invoice display is complete: booking detail pages now show the locked Deposit Invoice with BK reference, paid deposit amount, live package context, and remaining-at-session only while the booking is `CONFIRMED`.
- Feature 61 check-in rewrite is complete: confirmed bookings now check in without payment, atomically generate a `JOB-DEPT-YEAR-XXXXX` reference, create the Job and `WAITING_SELECTION` Order, stamp the FinancialCase, and move the booking to `CHECKED_IN`.
- Feature 60 booking confirmation rewrite is complete: pending bookings now remain reference-free, deposit recording atomically generates the BK reference, creates the FinancialCase, issues/pays/closes the locked Deposit Invoice, and confirmed bookings no longer use the removed base-payment-at-booking flow.
- Feature 59 schema foundation is complete: bookings can exist without job references, `FinancialCase` is in place, invoice/payment grouping fields are nullable for the 60–63 rollout, and job-scoped composite ownership constraints have been removed.
- Current phase: Phase 3 — Core operational completeness. Feature 57g dashboard phone suggestion dropdown is complete: dashboard phone lookup now has 300ms live phone suggestions, keyboard selection, outside/Escape dismissal, and exact customer-id order loading while preserving the submit fallback. Feature 57e dashboard phone search entry point is complete, with lookup validation hardened to reject punctuation-only phone values. Feature 57d POS financial summary sidebar is complete: `/orders/[orderId]/sales` now shows invoice-status context, locked-invoice messaging, snapshot invoice line items when available, computed package/add-on totals when no snapshot exists, includes bundle adjustment in the computed fallback total and breakdown, and routes payment work into the existing invoice flow. Feature 57c POS action buttons and add-on marketplace is complete: `/orders/[orderId]/sales` now supports category product pickers, marketplace one-click add/add-another, selected-photo-count extra photo pricing, standalone add-on removal, locked-invoice blocking, and service-layer invoice recalculation. Feature 57a POS route foundation is complete: `/orders/[orderId]/sales` now has a standalone sales layout, real order identity loading, skeleton commercial sections, and direct order detail/list entry points. Feature 56e downstream adoption is complete with the invoice snapshot timing corrected: payments no longer freeze order invoice recalculation, while delivery/close remains the final snapshot point. Feature 56d invoice line item schema and snapshot logic is complete and hardened: invoice line positions are unique per invoice and delivered/closed invoices are blocked from financial recalculation. Feature 56c package management UI rebuild is complete: `/packages` now manages structured bundle packages with deliverable composition, bundle adjustment preview, safe archive/delete actions, and dedicated create/edit pages for the longer package form flows. Feature 56b package schema redesign is complete; Feature 56a product catalog foundation is complete and now uses Product as the shared catalog for package deliverables and standalone add-ons; Feature 55 is complete across 55a–55g. Feature 54 complete: 54a (editing queue), 54b (production queue), 54c (booking no-show UI), 54d (orders date+editor filters), and 54e (ready-for-pickup quick filter) are complete. Feature 53 (deliverable-driven sections) deferred pending schema review.
- Feature 57f POS embedded record payment dialog is complete: `/orders/[orderId]/sales` records invoice payments in-place with POS-focused amount/method/date-time controls, sales route revalidation, fully-paid/no-invoice disabled states, server-side overpayment protection, and append-only locked-invoice payment support when balance remains.
- Remaining open auth gap (deferred): `ActorContext.actorUserId` is still optional on audit-critical service signatures (Gap #8 in auth-review.md).

## Key State
- Lifecycle revision foundation is live: `BookingStatus.CHECKED_IN` replaces the old booking `COMPLETED` state, `PaymentType.FINAL` replaces `BASE`, `InvoiceType` exists, and `identifier_sequences` is keyed by `scope/year/kind`.
- Pending bookings are calendar holds only: no `publicId`, `jobNumber`, `jobId`, `Job`, `FinancialCase`, or invoice is created until the 20 KD deposit is recorded; pending cancellation uses hard deletion.
- Booking confirmation is atomic: deposit recording creates the `BK-DEPT-YEAR-XXXXX` reference, `FinancialCase`, locked closed Deposit Invoice, and deposit payment in one transaction.
- Booking check-in is atomic and payment-free: check-in creates the canonical `Job`, stores `Booking.jobId/jobNumber`, creates the initial `WAITING_SELECTION` Order, stamps `FinancialCase.jobId`, and consumes the `JOB` reference permanently.
- `Booking.publicId`, `Booking.jobNumber`, `Booking.jobId`, `Invoice.jobNumber`, `Invoice.jobId`, `Payment.jobNumber`, and `Payment.jobId` are nullable while Specs 60–63 move reference creation to the correct lifecycle stages.
- `User.active` soft-delete is live; `requireCurrentAppUser()` redirects inactive users to `/unauthorized`; audit history is preserved.
- Clerk owns auth/session state; Prisma `User` is the source of truth for Studio OS staff role and internal identity. `User.clerkId` is a nullable unique link, first resolved by matching Clerk primary email to an unlinked Prisma user.
- Auth centralised: server-side lookup in `src/lib/auth`; permission checks in `src/lib/permissions` backed by Prisma roles (not Clerk roles). Unlinked Clerk users redirect to `/unauthorized`. Dashboard/app routes gated by Next.js 16 `proxy.ts`.
- High-risk server actions pass `actorUserId` into service-layer operations for order activity and delivery-completion attribution.
- Session workflow: Deposit and Final invoices are separate FinancialCase-scoped records; the Final Invoice is the rolling order invoice, while the locked Deposit Invoice is read-only context for deduction display.
- `Order.deliveryCompletedById` (FK to `User`) is the active delivery actor reference; `deliveryCompletedBy` (free-text) is a non-authoritative legacy fallback only.
- Deposit truth comes from `Payment` records, not `Booking.depositPaid`.
- Job/BK reference generation self-heals if `identifier_sequences` falls behind existing canonical `Job.jobNumber` or `Booking.publicId` rows.
- Invoice payments are append-only; financial order edits recalculate totals without overwriting payment records.
- Locked invoices remain content-immutable, but unpaid locked invoices can accept append-only payments and refresh payment-derived paid/remaining/status fields.
- Extra selected photos are a per-photo service-computed add-on charge using the database-backed extra-photo product-backed add-on catalog row.
- `Order.addOns` JSON is deprecated; `OrderAddOn` rows with snapshot fields are the active source of truth.
- Editing start requires: selection complete + editor assigned + full invoice balance settled; assignment stays allowed while any outstanding balance is surfaced in-tab with an upgrade-payment modal.
- Order completion requires: pickup recorded + production status READY_FOR_PICKUP or COMPLETED + settled payment or explicit admin override reason.
- Production READY_FOR_PICKUP requires: editing approved or completed.

## Feature History
- Feature 63: Final invoice POS — order invoice creation/sync now targets a fresh FinancialCase-scoped `InvoiceType.FINAL`, POS displays the Deposit Invoice deduction by number without mutating final invoice totals, final payments use `PaymentType.FINAL`, package price snapshots are set through selection, and old invoice promotion helpers were removed.
- Feature 62: Deposit invoice display — booking detail now renders the locked Deposit Invoice from the booking read model, shows paid deposit context plus live package price and remaining balance only for confirmed bookings, and omits the section when no deposit invoice exists.
- Feature 61: Check-in rewrite — confirmed bookings now expose a Check In action that creates the JOB reference, Job, Order, FinancialCase job stamp, and `CHECKED_IN` status atomically; checked-in detail pages show both BK and JOB references plus the order link.
- Feature 60: Booking confirmation rewrite — pending bookings no longer consume references or create jobs; deposit recording creates the BK reference, FinancialCase, locked closed Deposit Invoice, and deposit payment atomically; base-payment booking flow was removed; pending bookings can be hard-deleted.
- Feature 59: Schema foundation — added FinancialCase, nullable lifecycle reference fields, InvoiceType, order package price snapshots, identifier sequence kind, CHECKED_IN/FINAL enum replacements, and removed jobId composite ownership anchors for booking/order/invoice/payment.
- Feature 57g: Dashboard phone suggestion dropdown — phone lookup now fetches up to 5 phone-only customer suggestions after 300ms, supports mouse and keyboard selection, cancels in-flight suggestion requests, closes on Escape/outside click, and loads selected customers by id before fetching orders.
- Feature 57f follow-up: POS payment time picker now supports every hour and minute with AM/PM display while booking time pickers keep their existing limited increments.
- Feature 57f: POS embedded record payment dialog — the sales workspace now opens an in-place payment modal with invoice context, full/half/custom amount controls, KNET/Cash/Link payment methods, date/time normalization, success toast refresh, fully-paid/no-invoice disabled states, server-side overpayment blocking, and locked-invoice append-only payment support.
- Feature 57e follow-up: Dashboard phone lookup validation now requires at least one digit while preserving optional leading plus and existing phone punctuation support.
- Feature 57e: Dashboard phone search entry point — the main dashboard now has a phone lookup that returns a matched customer, recent order history with session/package/status/payment context, empty states for no customer/no orders, and direct `Open Sales` links to each POS workspace.
- Feature 57d: POS financial summary sidebar — the sales workspace now renders invoice snapshot line items when present, falls back to computed commercial rows otherwise, surfaces locked-invoice messaging clearly, and routes payment work into the existing invoice flow.
- Feature 57d follow-up: POS computed sales totals now include bundle adjustment in both the fallback total and the non-snapshot sidebar breakdown.
- Feature 57c: POS action buttons and add-on marketplace — category product pickers add standalone products at canonical price, marketplace cards support repeated add/add-another and remove-one states, extra photos are updated by selected photo count, current standalone add-ons are removable, locked invoices are visibly blocked, and invoice totals recalculate through order services.
- Feature 56c follow-up: Package create/edit now use dedicated `/packages/new` and `/packages/[packageId]/edit` pages, with save redirecting back to the package list so long commercial bundle forms no longer depend on dialog scrolling.
- Feature 57a: POS route foundation — standalone `/orders/[orderId]/sales` layout with real order identity data, POS workspace service read model, skeleton commercial/financial sections, and order detail/list navigation entry points.
- Feature 57b: POS package composition area — added structured package deliverable cards, visible pricing lines, upgrade pickers, locked-invoice blocking, service-layer package mutations, and durable package-item upgrade reconciliation.
- Feature 56e follow-up: Corrected invoice snapshot timing so first payment no longer freezes order edits; non-delivered premature snapshots are cleared on recalculation, and invoices snapshot/lock at order delivery or explicit invoice close.
- Feature 56e: Downstream adoption — order selection and overview now render structured package deliverables and bundle adjustments, paid add-ons are separated from included items, and order financials prefer immutable invoice line item snapshots when present.
- Feature 56d: Invoice line item snapshots — added `InvoiceLineItem` / `InvoiceLineType`, immutable snapshot creation on invoice issue or first payment, `PACKAGE_UPGRADE` delta lines for package upgrades, and invoice detail reads with sorted line items.
- Feature 56c: Package management UI rebuild — `/packages` now supports create/edit package forms with structured deliverables, product price snapshots, client-side bundle adjustment preview, table deliverable summaries, active/inactive status, and safe archive/delete actions.
- Feature 56b: Package schema redesign — `Package.bundleAdjustment` migration plus package service create/update/archive flows with structured PackageItem snapshots, adjustment calculation, locked-invoice edit guard, and active-reference archive guard.
- Feature 56a.2: Hardened product catalog flows with safe action error messages, stricter form contracts, atomic archive behavior, and package item integrity constraints.
- Feature 56a.1: Unified package deliverables and standalone add-ons into Product; legacy add-on catalog rows migrate into products and OrderAddOn now references Product snapshots.
- Feature 56a: Product catalog foundation — Product/ProductCategory schema plus supporting PackageItem relation, product service/actions, admin `/products` UI, and admin/manager navigation/permission gate.
- Feature 55g follow-up: Added a shared TimePicker and migrated booking create/edit session time fields off native time inputs.
- Feature 55g: Migrated all raw date inputs to the shared DatePicker component across booking, editing workflow, invoice payment, and child forms.
- Feature 55f: Editing queue investigation complete — current query returns `1` row in `19ms`, has no pagination, shows no N+1 pattern, and points to cold-start overhead as the present bottleneck with pagination as the likely future fix target.
- Follow-up: bookings, orders, and invoices tables/pages now use customer phone as the primary displayed identifier and search target.
- Feature 55e: Phone number required on all customer saves; search prioritizes phone.
- Feature 55d: Editing start now requires full payment; assignment stays allowed, outstanding balance is surfaced in-tab with an upgrade-payment modal.
- Feature 55c: Initial deliverables card on overview tab; its description-based selection display has been superseded by Feature 56e structured package items.
- Feature 55b follow-up: Delivery completion transitions now stay on the dedicated pickup-completes path, while legacy `PICKED_UP` orders retain a valid route to close.
- Feature 55b: Editing date default (today+14), booking session time field added.
- Feature 55a: Fixed selection count init (0 display), selection save idempotency drift, and simplified delivery by removing redundant prepare/complete actions so pickup closes the order.
- Feature 54e: Orders list now includes a prominent "Ready for Pickup" quick filter that sets `orderStatus=READY` in the URL using the existing orders filter flow.
- Feature 54d: Orders list now supports URL-driven session date range and assigned-editor filters, now using a reusable shadcn-style calendar range picker over the same `sessionDateFrom` / `sessionDateTo` query params plus active ADMIN/EDITOR dropdown options.
- Feature 54c: Confirmed bookings now expose a destructive "Record No-Show" action with confirmation, preserve a distinct `No-Show` label, and automatically close+lock any existing primary booking invoice when the no-show transition is confirmed.
- Feature 54b: Added a production queue page so signed-in users with access can see in-flight production orders from the main app navigation.
- Feature 54a: Editing queue page at `/editing` — `getEditingQueue()` service function, `EditingQueueItem` type, `EditingQueueTable` component; gated by `WORKFLOW_EDITING_UPDATE` permission (EDITOR + ADMIN only).
- Feature 54 (review): Operational page completion review — gap analysis across all 8 areas; sub-units 54a (editing queue), 54b (production queue), 54c (booking no-show UI), 54d (orders date+editor filters), 54e (ready-for-pickup quick filter) defined in `context/reviews/feature-54-operational-review.md`.
- Feature 52f: Service-layer permission enforcement — ActorContext extended with role; editing, production, and delivery workflow service functions now assert permissions independently of the call site.
- Feature 52e: Guard-blocked audit log — GUARD_BLOCKED activity type added; high-risk guard failures for delivery completion and production readiness now recorded in the order activity timeline.
- Feature 52c: Typed guard errors — UI-reachable payment override and actor-missing guard failures now surface contextual prompts instead of only raw global error banners.
- Feature 52b: Section dependency order — albumDesign prerequisite enforced before assembly can start, complete, or contribute to READY_FOR_PICKUP.
- Feature 52a: Production readiness guard — editing prerequisite for READY_FOR_PICKUP; delivery guard bug fix (removed all-sections check); duplicate EditingJob creation error handling.
- Guard Review (unlisted step): Workflow guard audit complete — full inventory and 8 gaps (P1, P1b, P2a, P2b, P3–P6) documented in context/reviews/workflow-guard-audit.md; Feature 52 enforcement units proposed.
- Feature 51c: Soft-delete foundation — `User.active` field added and migrated; inactive users redirected to `/unauthorized`.
- Feature 51b: Auth hardening — `unauthorized.tsx`, dashboard guard, unlinked-user redirect, `RECEPTIONIST` invoice:create, editing/production permission gates.
- Feature 51: Shared permission guard (`src/lib/permissions`); high-risk actions require linked app-user authorization; `actorUserId` propagated.
- Feature 50: Clerk auth and staff identity foundation — `@clerk/nextjs`, `proxy.ts`, `User.clerkId`, email-based first local linking.
- Feature 49: Invoice ownership integrity tightened; rolling primary invoice reuse enforced; concurrency race handled.
- Feature 48: `Order.deliveryCompletedById` FK added; delivery completion now uses a staff dropdown instead of free text.
- Feature 47: Structured `OrderAddOn` table with snapshot fields; `Order.addOns` JSON deprecated and backfilled.
- Feature 46: `ProductionJob` extraction — production status and section progress moved out of `Order`.
- Feature 45: `EditingJob` extraction — editing assignment, timestamps, progress, and approval state moved out of `Order`.
- Feature 44: Identifier cleanup — booking/order public IDs removed from active UI; `jobNumber`/`invoiceNumber` are now staff-facing only.
- Feature 43: Downstream `jobId` adoption for `Order`, `Invoice`, and `Payment` with composite-FK integrity migrations.
- Feature 42: Canonical `Job` entity added; `Booking.jobId` enforced as the immutable ownership link.
- Feature 41: Customer internal notes surfaced as a dedicated persisted section on the profile page.
- Feature 40: Child management inside customer profile — add/edit dialogs with optional date of birth.
- Feature 39: Customer profile hub at `/customers/[customerId]` with linked bookings, orders, and recent history.
- Feature 38: Edit customer flow with status editing and dialog-based UX from both list and profile.
- Feature 37: New customer flow at `/customers/new` with duplicate-phone handling.
- Feature 36: Customer list filters URL-driven and server-rendered; booking preselection via `customerId` query param.
- Feature 35: Base payment gate — `recordBasePaymentAndComplete()` creates payment, transitions booking, and creates order atomically.
- Feature 34: Financials tab enriched with full price breakdown; chronological activity timeline with event-type filtering.
- Feature 33: Operational Delivery workflow tab — pickup recording, payment override, order completion guards.
- Feature 32: Operational Production workflow tab — section actions, early-start warnings, pickup readiness.
- Feature 31: Operational Editing workflow tab — editor assignment, progress, revision tracking, base-payment gate.
- Feature 30: Operational Selection workflow tab — photo counts, Product-backed add-ons, extra-photo invoice sync.
- Feature 29: Tabbed order hub UI shell added on top of existing read models.
- Feature 28: Order activity foundation with structured metadata and service-layer writes.
- Feature 27: Order workflow sub-statuses added for selection, editing, production, and delivery; payment status computed from invoice state.
- Feature 26: Order package/add-on edits update invoice totals transactionally; financial preview on edit page.
- Feature 25: Studio departments implemented with database-backed booking department selection and `StudioDepartment.code` job-number prefixes.
- Feature 24: Public IDs and shared job numbers with DB-backed sequences and immutable enforcement.
- Feature 23: Booking details page added as a read-only view.
- Feature 22: Booking model aligned around booking-owned fields, linked invoices, and payment-derived deposit state.
- Feature 21: Booking deposit recording via invoice + payment in one transaction.

## Open Follow-Ups
- Write and implement `55f-fix` to add a targeted editing-queue performance fix, starting with pagination because the current query has no limit.
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

## Validation Pattern
- Validate with the smallest command set needed for the change.
- Prefer `build`, `lint`, and migration checks when schema/workflow changes are involved.
