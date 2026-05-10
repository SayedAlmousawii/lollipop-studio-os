# Progress Tracker

Update this file after meaningful implementation changes. Keep it as a current-state snapshot, not a history log.

**Structure (do not drift from this):** Now · Key State (non-obvious decisions only) · Feature History (one line each, newest first) · Open Follow-Ups (actionable items only, remove when done) · Validation Pattern. No file lists, no per-feature implementation notes, no validation command logs — those belong in git.

## Now
- Current phase: Phase 3 — Core operational completeness. Feature 54 in progress; 54a (editing queue), 54b (production queue), 54c (booking no-show UI), and 54d (orders date+editor filters) complete. Sub-unit 54e remains. Feature 53 (deliverable-driven sections) deferred pending schema review.
- Remaining open auth gap (deferred): `ActorContext.actorUserId` is still optional on audit-critical service signatures (Gap #8 in auth-review.md).

## Key State
- `User.active` soft-delete is live; `requireCurrentAppUser()` redirects inactive users to `/unauthorized`; audit history is preserved.
- Clerk owns auth/session state; Prisma `User` is the source of truth for Studio OS staff role and internal identity. `User.clerkId` is a nullable unique link, first resolved by matching Clerk primary email to an unlinked Prisma user.
- Auth centralised: server-side lookup in `src/lib/auth`; permission checks in `src/lib/permissions` backed by Prisma roles (not Clerk roles). Unlinked Clerk users redirect to `/unauthorized`. Dashboard/app routes gated by Next.js 16 `proxy.ts`.
- High-risk server actions pass `actorUserId` into service-layer operations for order activity and delivery-completion attribution.
- Session workflow: one rolling primary invoice per job thread; duplicate primary workflow invoices are blocked by service validation and partial unique indexes.
- `Order.deliveryCompletedById` (FK to `User`) is the active delivery actor reference; `deliveryCompletedBy` (free-text) is a non-authoritative legacy fallback only.
- Deposit truth comes from `Payment` records, not `Booking.depositPaid`.
- Job number generation self-heals if `identifier_sequences` falls behind existing canonical `Job.jobNumber` rows.
- Invoice payments are append-only; financial order edits recalculate totals without overwriting payment records.
- Extra selected photos are a per-photo service-computed add-on charge using the database-backed extra-photo add-on option.
- `Order.addOns` JSON is deprecated; `OrderAddOn` rows with snapshot fields are the active source of truth.
- Editing start requires: selection complete + editor assigned + `PaymentType.BASE` payment recorded on order-linked invoice.
- Order completion requires: pickup recorded + production status READY_FOR_PICKUP or COMPLETED + settled payment or explicit admin override reason.
- Production READY_FOR_PICKUP requires: editing approved or completed.

## Feature History
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
- Feature 30: Operational Selection workflow tab — photo counts, database-backed add-ons, extra-photo invoice sync.
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
