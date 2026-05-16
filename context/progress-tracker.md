# Progress Tracker

Update this file after meaningful implementation changes. Keep it as a current-state snapshot, not a history log.

**Structure (do not drift from this):** Now · Key State (non-obvious decisions only) · Feature History (one line each, newest first) · Open Follow-Ups (actionable items only, remove when done) · Validation Pattern. No file lists, no per-feature implementation notes, no validation command logs — those belong in git.

## Now
- Feature 81d is complete: nightly reconciliation pings the external no-report monitor only after reconciliation runs and Slack delivery succeeds, with Healthchecks.io setup documented for on-call.
- Feature 81e review cleanup is complete: reconciliation invariant definitions moved out of `reconciliation.service.ts`, the circular catalog/service import path is gone, catalog entries use typed runtime/reconciliation variants, exported runtime invariants are immutable, and A3 no longer appears as unresolved debt.
- Feature 81e is complete: runtime and nightly reconciliation invariants are indexed through `INVARIANT_CATALOG`, reconciliation runs through the catalog, and `context/reviews/invariant-catalog.md` is generated from the registry.
- Feature 81b is complete: the refund invoice primitive is private inside `refund.service.ts`, public callers use `issueRefundWithPayment`, and refund validation now names the composed refund-with-payment workflow.
- Feature 81a is complete: the locked-edit dual-read comparison module and orphaned feature flag are removed, `syncOrderInvoiceForFinancialEdit()` runs the canonical classifier path directly, and Phase D warning-only regression coverage was deleted.
- Feature 80c is complete: PostgreSQL triggers now reject PaymentAllocation over-collection and ADJUSTMENT-to-ADJUSTMENT invoice parent chains, with focused DB-constraint regression coverage.
- Refund capacity hotfix is complete: overpayment capacity now uses canonical effective-paid allocation/application math, and regression coverage includes deposit-applied final invoices with credit notes plus refund-detail visibility.
- Feature 80b is complete: locked invoices now get `InvoiceLockSnapshot` frozen-field baselines at lock time, and a PostgreSQL trigger rejects direct frozen-field mutations while allowing sanctioned unlock/status/payment-derived updates.
- Feature 80a is complete: first-class `AuditLog` persistence now records co-transactional actor attribution and field snapshots for booking confirmation/no-show, payments, invoice locks, total mutations, adjustments, credit notes, refunds, and permitted locked-order mutations.
- Feature 79d is complete: POS reductive locked-edit actions now surface a manager credit-note approval modal, retry through a dedicated approved action, and keep failed approval retries inside the modal.
- Feature 79c is complete: refund capacity now uses canonical true overpayment (`inbound allocations - CREDIT_NOTE-net owed - prior REFUND totals`), refund creation rechecks the cap under a source invoice row lock, and invoice detail hides/defaults/caps the refund form from `overpaymentCapacity`.
- Feature 79b is complete: legacy order-service deposit-deduction formulas are removed, POS invoice summaries use canonical `Invoice.remainingAmount`, and editing readiness verifies DEPOSIT settlement plus canonical outstanding balance.
- Feature 78a is complete: `recordPayment()` now locks the invoice row before reading balances, fully paid FINAL invoices auto-close and lock even from `DRAFT`, and settlement regression coverage covers concurrent/full/overpay paths.
- Feature 78b is complete: `ActorContext.actorRole` is required, permission checks throw on missing roles, and `recordPayment()` is guarded at the service boundary with regression coverage.
- Feature 77 F6 investigation is complete: the dev INV-18 mismatch is classified as an active divergence, with finding/data docs and an intentionally failing repro test for Sprint 4.
- Feature 77 Phase G is complete for Layer 10 production reconciliation: read-only nightly runner, structured violation reports, severity classification, alert payload verification, monitoring recommendations, and review documentation are in place.
- Feature 77 Phase F is complete: Layers 7-9 concurrency, permission/security, stale-state, hidden mutation path, and failure-recovery tests now run through `tests/financial-phase-f/` inside `npm run test:backend-invariants`.
- Feature 77 Phase D is complete: Layer 5 regression coverage for Features 74/75/76 and multi-package workflows now runs through `tests/financial-phase-d/` inside `npm run test:backend-invariants`, with legacy deposit-deduction and duplicate balance-display findings documented.
- Dashboard date windows use the studio timezone (`Asia/Kuwait`) for today/week metrics and schedule time display, so late-night local payments land in the correct business day.
- Dashboard refund display and payment creation hotfixes are complete: revenue shows net inbound-minus-refund, outbound refunds derive `PaymentType.REFUND` before the Prisma write, and optional refund trace fields are omitted unless supplied.
- Current phase: Phase 3 — Core operational completeness. Financial rearchitecture Phases 0–2 are complete (allocations, applications, ADJUSTMENT, CREDIT_NOTE, REFUND); Phase 3 audit attribution, locked-invoice DB immutability, over-collection prevention, and ADJUSTMENT-chain prevention are live.

## Key State
- `src/modules/financial/invariant-catalog.ts` is the canonical owner-facing index for registered financial invariants; reconciliation definitions live in `src/modules/financial/reconciliation-invariants.ts`, and `npm run docs:generate` refreshes `context/reviews/invariant-catalog.md`.
- Multi-package is now the only package model: `BookingPackage` and `OrderPackage` are the source of truth; the former singular booking/order package fields and `BookingSessionType` enum are gone.
- Package-item upgrades are no longer overloaded into `OrderAddOn`: true add-ons reference `Product`, while package-item upgrades reference `PackageItem` snapshots through `OrderPackageItemUpgrade`.
- Extra selected photos are stored per order package line as digital and print counts, priced from `SessionTypeExtraPhotoPricing`, and emitted as per-line/per-media Final Invoice lines.
- Deposit invoice totals are no longer hardcoded to 20 KD; the dialog defaults to 20.000 KD, validates a 20.000 KD minimum, and stores the entered amount immutably on the locked Deposit Invoice.
- Extra-photo pricing is data-backed by `SessionTypeExtraPhotoPricing`: each session type has independent `DIGITAL` and `PRINT` unit prices (placeholder values — owner confirmation pending before Spec 70 wiring).
- Packages are classified through `Package.packageFamilyId`; department and session type are derived live through `PackageFamily -> SessionType -> StudioDepartment`; package duration is stored per package.
- Booking creation accepts customer phone instead of customer id; existing customer names are display-only and not overwritten from the new booking form.
- Development workflow reset must delete `FinancialCase` rows before `Booking` rows — financial cases use a restrictive FK on the booking lifecycle.
- Lifecycle revision foundation is live: `BookingStatus.CHECKED_IN` replaces old `COMPLETED`, `PaymentType.FINAL` replaces `BASE`, `InvoiceType` exists, and `identifier_sequences` is keyed by `scope/year/kind`.
- Pending bookings are calendar holds only: no `publicId`, `jobNumber`, `jobId`, `Job`, `FinancialCase`, or invoice until the deposit is recorded; pending cancellation uses hard deletion.
- Booking confirmation is atomic: deposit recording creates the `BK-DEPT-YEAR-XXXXX` reference, `FinancialCase`, locked closed Deposit Invoice, and deposit payment in one transaction.
- Booking check-in is atomic and payment-free: creates the canonical `Job`, stores `Booking.jobId/jobNumber`, creates the initial `WAITING_SELECTION` Order, stamps `FinancialCase.jobId`, and consumes the `JOB` reference permanently.
- Job records store the assigned photographer and explicit social-media consent captured at check-in; consent is not defaulted server-side.
- `User.active` soft-delete is live; `requireCurrentAppUser()` redirects inactive users to `/unauthorized`.
- Clerk owns auth/session state; Prisma `User` is the source of truth for role and internal identity. Auth centralised in `src/lib/auth`; permissions in `src/lib/permissions` backed by Prisma roles. Dashboard/app routes gated by Next.js `proxy.ts`.
- High-risk server actions pass `actorUserId` into service-layer operations for order activity and delivery-completion attribution.
- Session workflow: Deposit and Final invoices are separate FinancialCase-scoped records; the Final Invoice is the rolling order invoice; the locked Deposit Invoice is read-only context for deduction display.
- Phase 1 financial rearchitecture cutover is live: invoice effective-paid math comes only from explicit payment allocations and document applications; virtual deposit credit and the Phase 1 dual-read flag are retired.
- `Order.deliveryCompletedById` (FK to `User`) is the active delivery actor reference; `deliveryCompletedBy` (free-text) is a non-authoritative legacy fallback only.
- Deposit truth comes from `Payment` records, not `Booking.depositPaid`.
- Job/BK reference generation self-heals if `identifier_sequences` falls behind existing canonical rows.
- Invoice payments are append-only; financial order edits recalculate totals without overwriting payment records.
- Locked invoices remain content-immutable, but unpaid locked invoices can accept append-only payments and refresh payment-derived fields.
- Final Invoice customer-facing package lines show the final package value only; upgrade deltas are available from `OrderPackage.finalPackagePriceSnapshot - originalPackagePriceSnapshot` for adjustment metadata and reporting.
- POS is the canonical writable workspace for order package changes, selected photos, add-ons, invoice preview, and final payment; the legacy edit order route redirects there and order detail selection is read-only.
- Selected-photo totals are derived from `OrderPackage.selectedPhotoCount`; `Order.selectedPhotoCount` is a synchronized cache, not a read source.
- `Order.addOns` JSON is deprecated; `OrderAddOn` rows with snapshot fields are the active source of truth.
- Order package changes are scoped to each line's stored session type; cross-session overrides are intentionally blocked until a future permissioned, audited repricing workflow.
- Editing start requires: selection complete + editor assigned + settled DEPOSIT invoice (when present) + canonical full invoice balance settled.
- POS and editing balance display read canonical `Invoice.remainingAmount`; the retired virtual deposit-deduction path is gone.
- Payment settlement now acquires an invoice row lock before balance reads, and fully paid FINAL invoices auto-close to `CLOSED + isLocked=true` inside the settlement transaction.
- Structured `AuditLog` is append-only at the service layer and tied to a required `actorUserId`; audited writes happen inside the same transaction as the action they record.
- Locked invoices are protected below the service layer: every service lock path writes an `InvoiceLockSnapshot`, and the DB trigger blocks frozen-field mutation of locked invoices. Booking check-in no longer stamps `jobId/jobNumber` onto already-locked deposit invoices.
- DB-level financial guardrails now reject PaymentAllocation totals above an invoice's `totalAmount` and reject ADJUSTMENT invoices parented to another ADJUSTMENT.
- Refund issuance now acquires a source invoice row lock before checking true overpayment capacity; zero-capacity invoices have no refund UI path.
- Phase G reconciliation runs inside a PostgreSQL `READ ONLY` transaction, reports only, and must use `FINANCIAL_RECON_DATABASE_URL` in production.
- The nightly reconciliation no-report monitor is configured through `RECONCILIATION_PING_URL`; missing ping config disables monitor pinging without affecting local runs.
- F6 classified the dev INV-18 mismatch as active: paid-ADJUSTMENT cause removal and manual CREDIT_NOTE issuance can diverge revenue documents from current order composition.
- ADJUSTMENT cause linkage is live for classifier additions: line-targeted CREDIT_NOTE reversals apply to the originating ADJUSTMENT invoice line, while legacy/manual ADJUSTMENT lines remain null-linked.
- Order completion requires: pickup recorded + production status `READY_FOR_PICKUP` or `COMPLETED` + settled payment or explicit admin override reason.
- Production `READY_FOR_PICKUP` requires: editing approved or completed.

## Feature History
- Feature 81d: added successful-report Healthchecks.io ping support to the reconciliation runner, passed `RECONCILIATION_PING_URL` through the scheduled workflow, and documented monitor setup/on-call response.
- Feature 81e: added the financial invariant catalog, wired nightly reconciliation to iterate cataloged reconciliation entries, generated the owner-facing invariant Markdown index, and added catalog uniqueness/callability/clean-db coverage.
- Feature 81b: moved `createRefundInvoice` out of invoice-service exports into a private refund-service helper, routed action/tests through `issueRefundWithPayment`, and renamed refund validation to the composed workflow.
- Feature 81a: deleted the dual-read warning path and orphaned feature flag, removed `financial.rearch.dual_read.discrepancy` runtime emission, kept locked-edit classifier behavior canonical, and removed warning-only Phase D assertions.
- Feature 80c: added raw SQL triggers for PaymentAllocation over-collection and ADJUSTMENT-parent chaining, plus isolated-schema regression coverage for insert/update failures and service-level preflight errors.
- Refund capacity hotfix: replaced the parallel inbound-only capacity formula with effective-paid math, preserved prior REFUND invoice consumption, and added deposit + CREDIT_NOTE regression/invariant coverage.
- Feature 80b: added `InvoiceLockSnapshot`, wired lock snapshots across invoice lock paths, installed a DB trigger for locked-invoice frozen fields, registered the reconciliation invariant, and covered direct Prisma mutation/unlock behavior.
- Feature 80a: added `AuditLog`, `AuditEntityType`, and `AuditAction`, introduced `recordAuditLog`, wired co-transactional audit writes through booking/payment/invoice/adjustment/credit-note/refund paths, and added focused rollback/actor/audit integration coverage.
- Feature 79d: replaced the generic reductive POS failure with an `approval-required` action contract, added a blocking manager approval modal with reduction amounts, retried approved reductions through `confirmReductiveEditWithApproval`, and added focused action-boundary regression coverage.
- Feature 79c: replaced loose refundable inbound-payment capacity with true overpayment capacity, renamed the invoice detail API field to `overpaymentCapacity`, capped refund creation under row lock, added UI default/max validation, and covered zero/credit/prior-refund/concurrency regressions.
- Feature 79b: deleted legacy deposit-deduction balance formulas from order service, made POS invoice summaries return canonical `Invoice.remainingAmount`, replaced the 20 KD base-payment threshold with DEPOSIT invoice settlement, and added canonical balance/editing gate regression coverage.
- Feature 78a: locked invoice settlement with `SELECT ... FOR UPDATE`, auto-closed fully paid FINAL invoices from both `ISSUED` and `DRAFT`, added settlement regression coverage, and registered fully-paid-final lock invariants for runtime and nightly reconciliation.
- Feature 78b: required `ActorContext.actorRole`, moved shared permission enforcement to `src/lib/auth/assert-actor-permission.ts`, guarded `recordPayment()` in-service, and added auth regression coverage plus typed actor test builders.
- Feature 77 F6 investigation: classified INV-18 order/revenue mismatch as active, documented raw composition and finding, updated the roadmap, and added a Sprint 4 repro test.
- Feature 77 Phase G: Production reconciliation architecture — read-only runner, structured violation report, cross-table reconciliation invariants, severity/alert verification, and monitoring/risk documentation.
- Feature 77 Phase F: Concurrency/security/recovery suite — simultaneous payment and settlement races, stale browser/payment states, service permission matrix, forbidden transitions, hidden mutation-path search, rollback injection checks, and review documentation in `context/reviews/77-phase-f-concurrency-security-recovery-review.md`.
- Feature 77 Phase D: Regression suite — REG-74/75/76 and REG-70 multi-package coverage, static legacy-path searches, mixed document pairing checks, and review documentation in `context/reviews/77-phase-d-review.md`.
- Feature 77 Phase C: Edge-case expansion — E1-E12 classifier coverage, EC-13 through EC-42 service/characterization tests, stale-state checks, hidden corruption findings, and Phase C review documentation.
- Feature 77 Phase B: Workflow integration matrix — INT-01 through INT-15 service-layer scenarios, integration fixtures, rollback checks, payment allocation/document application assertions, financial workflow assertions, and audit-gap documentation.
- Feature 77 Phase A: Financial invariant CI — schema integrity, migration/backfill verification, and invariant coverage in `tests/financial-phase-a/`; locked-invoice immutability blocked on missing audit snapshots.
- Feature 76c: Wire reductions to credit notes — lifted Phase 2 hard-block into manager-approved POS flow, routed classifier reductions to CREDIT_NOTE creation, made mixed ADJUSTMENT + CREDIT_NOTE edits atomic with paired activity entries.
- Feature 76b: CREDIT_NOTE invoice and DocumentApplication binding — positive locked credit-note invoices, FINAL-only caps, non-monetary document application binding, manager action UI, overpayment display, ADR, shared fixture, invariant/choke-point tests.
- Feature 76a: REFUND invoice and outbound payment — positive REFUND invoices, OUT refund payments, source-payment traceability, service cap enforcement, manager action UI, ADRs, shared refunded fixture, invariant/choke-point tests.
- Feature 75c: POS adjustment settlement — `PaymentType.ADJUSTMENT`, open/paid ADJUSTMENT invoices in POS settlement panel, ADJUSTMENT payment recording through allocation, settled invoice closure/lock with activity entries.
- Financial rearchitecture review follow-ups: removed hardcoded reconciliation `NODE_ENV`, made Slack reconciliation posting retryable/non-fatal, added `PaymentAllocation.paymentId` uniqueness, tightened allocation/application balance checks, aligned POS add-on display with upgrade totals.
- Feature 74e: Phase 1 cutover and reconciliation — removed virtual deposit-credit path, deleted dual-read flag/helper, registered final Phase 1 invariants, added nightly 02:00 studio-local reconciliation workflow.
- Feature 74d: Recalculation dual-read — added allocation/application effective-paid calculation, dual-read helper, auto-created Deposit-to-Final `DocumentApplication` rows on FINAL invoice creation, registered net-balance/document-application invariants.
- Feature 74c: Payment creation choke point — `createPaymentWithAllocation` is the sanctioned Payment creation path, creates one paired `PaymentAllocation` atomically, runtime/choke-point invariants enforce the single-allocation contract.
- Feature 74b: Application/allocation backfill — transactional migration backfilling Deposit-to-Final `DocumentApplication` rows and one full-amount `PaymentAllocation` per existing payment, with pre/post assertion verification.
- Feature 74a: Document/application allocation tables — empty `document_applications` and `payment_allocations` tables, Prisma relations, positive amount CHECK constraints, document source/target uniqueness, allocation indexes.
- Feature 73c: Order add-on split — added `OrderPackageItemUpgrade`, migrated package-item upgrade writes/reads out of `OrderAddOn`, backfilled legacy upgrade rows, dropped `OrderAddOn.packageItemId`, enforced required true add-on product references.

## Open Follow-Ups
- Fix Phase C/Phase F/F6 high-risk findings before production financial expansion: INV-18 revenue-composition drift, open ADJUSTMENT cancellation disposition, commission persistence, and voucher redemption schema.
- Configure production reconciliation secrets/env: `FINANCIAL_RECON_DATABASE_URL`, `FINANCIAL_RECON_SLACK_WEBHOOK`, `FINANCIAL_RECON_SLACK_CHANNEL`, and the documented `RECONCILIATION_PING_URL` Healthchecks.io secret.
- Manually smoke test booking confirmation, deposit recording, and POS settlement against the migrated dev database to confirm schema tightening remains behavior-neutral in real flows.
- Confirm final per-session-type digital and print extra-photo prices with the owner before Spec 70 ships.
- Consider adding explicit job categorization (`SESSION`, `VOUCHER`, `RETAIL`, `OTHER`) before future voucher or standalone sales invoice flows.

## Validation Pattern
- Validate with the smallest command set needed for the change.
- Prefer `build`, `lint`, and migration checks when schema/workflow changes are involved.
