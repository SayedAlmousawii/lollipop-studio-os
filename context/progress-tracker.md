# Progress Tracker

Update this file after meaningful implementation changes. Keep it as a current-state snapshot, not a history log.

**Structure (do not drift from this):** Now · Key State (non-obvious decisions only) · Feature History (one line each, newest first) · Open Follow-Ups (actionable items only, remove when done) · Validation Pattern. No file lists, no per-feature implementation notes, no validation command logs — those belong in git.

## Now
- R7 complete: `OrderCompositionViewModel` projectors exist for POS, current-composition, overview, and production surfaces; `derivePOSWorkspaceFromAdjustmentWorkspace()` now adapts through the R7 model/projector path. R8 composition consumer swaps are next.
- **Current phase:** Phase 3 — Core operational completeness. Financial rearchitecture Phases 0–2 are complete (allocations, applications, ADJUSTMENT, CREDIT_NOTE, REFUND); Phase 3 audit attribution, locked-invoice DB immutability, over-collection prevention, and ADJUSTMENT-chain prevention are live.
- **Active roadmap:** `context/reviews/centralization-roadmap.md`. R0 (Context Reconciliation & Cleanup Gate) is complete: main docs are canonical, `*-summary.md` files archived, `AGENTS.md` default reads updated, Canonical Architecture Standards + Canonical Read Layer sections live in `architecture-context.md`.
- **Session Configurations subsystem complete (Features 88–94):** schema, admin CRUD, pricing engine, configure panel, post-lock routing, invoice display, linked-product retrofit as selection-owned `OrderAddOn` rows.
- **Adjustment Workspace subsystem complete (Features 82–84c):** staged post-lock edits with optimistic versioning, POS-shaped derived workspace read model, shared CurrentCompositionCard, draft/locked/adjustment financial sidebar split, and Stage Edits → Preview → Pending Changes → Adjustment Summary flow.

## Key State

### Financial architecture
- Phase 1 cutover is live: invoice effective-paid math comes only from explicit `PaymentAllocation` and `DocumentApplication` rows; virtual deposit credit is retired.
- `createPaymentWithAllocation` is the sanctioned Payment creation path; one paired allocation per payment is enforced at runtime and DB level.
- Deposit and Final invoices are separate FinancialCase-scoped records; the Final Invoice is the rolling order invoice; the locked Deposit Invoice is read-only context.
- Invoice payments are append-only; locked invoices are content-immutable but accept append-only payments and refresh payment-derived fields.
- `InvoiceLockSnapshot` baselines exist for every locked invoice; a PostgreSQL trigger rejects frozen-field mutation of locked invoices.
- DB triggers also reject `PaymentAllocation` over-collection and ADJUSTMENT-parented-to-ADJUSTMENT chains.
- Payment settlement acquires an invoice row lock before balance reads; fully paid FINAL invoices auto-close to `CLOSED + isLocked=true` inside the settlement transaction.
- Refund issuance uses canonical true overpayment capacity (`inbound allocations − CREDIT_NOTE-net owed − prior REFUND totals`) under a source invoice row lock.
- INV-18 treats manual goodwill CREDIT_NOTE applications as outside order composition; classifier/order-composition credits remain in revenue-document comparison.
- ADJUSTMENT cause linkage: line-targeted CREDIT_NOTE reversals apply to the originating ADJUSTMENT invoice line; legacy/manual ADJUSTMENT lines remain null-linked.
- `src/modules/financial/invariant-catalog.ts` is the canonical owner-facing index for registered financial invariants; `npm run docs:generate` refreshes `context/reviews/invariant-catalog.md`.
- Nightly reconciliation runs in a PostgreSQL `READ ONLY` transaction using `FINANCIAL_RECON_DATABASE_URL`; `RECONCILIATION_PING_URL` (Healthchecks.io) is the no-report monitor.

### POS / orders / composition
- POS is the canonical writable workspace for order package changes, selected photos, add-ons, invoice preview, and final payment. The legacy edit order route redirects there; order detail selection is read-only.
- Shared POS components that may mount in multiple persistence contexts use handler props from `src/modules/orders/pos-handlers.types.ts`. Sales passes commit-through server-action adapters with inline reductive approval enabled; AdjustmentWorkspace passes staged-edit adapters with inline approval disabled, finalize-time approval preserved.
- `derivePOSWorkspaceFromAdjustmentWorkspace()` is the canonical bridge for rendering staged post-lock edits through POS modules without mutating the locked invoice or reusing sales commit-through.
- Locked POS operational edits stay direct/audited; locked POS financial edits route to workspace; open workspaces disable locked direct edits.
- Multi-package is the only package model: `BookingPackage` and `OrderPackage` are the source of truth.
- Package-item upgrades reference `PackageItem` snapshots via `OrderPackageItemUpgrade`; true add-ons reference `Product` via `OrderAddOn`. The two are not overloaded.
- Selected-photo totals are derived from `OrderPackage.selectedPhotoCount`; `Order.selectedPhotoCount` is a synchronized cache, not a read source.
- Extra selected photos are stored per order package line as digital and print counts, priced from `SessionTypeExtraPhotoPricing`, emitted as per-line/per-media Final Invoice lines.
- Order package changes are scoped to each line's stored session type; cross-session overrides are blocked until a future permissioned, audited repricing workflow.

### Session Configurations
- `session-configuration-selection.service.ts` is the sole production writer for per-package selection diffs and the only writer of selection-owned add-ons; manual deletion of selection-owned add-ons is blocked.
- `session-configuration-pricing.ts` is the canonical snapshot-selection money path; `session-configuration-resolver.ts` gates live active required configs.
- `OrderPackageSessionConfigurationSelection.orderAddOnId` links linked-product selections to real `OrderAddOn` rows. Locked historical selections retain old `SESSION_CONFIGURATION` invoice lines.
- Admin CRUD lives at `/session-configurations` behind `PACKAGE_CATALOG_MANAGE`; `SessionConfiguration.code` is generated from session type code + name and frozen on update.

### Lifecycle / bookings
- `BookingStatus.CHECKED_IN` replaces old `COMPLETED`; `PaymentType.FINAL` replaces `BASE`; `identifier_sequences` is keyed by `scope/year/kind` and self-heals.
- Pending bookings are calendar holds only: no `publicId`, `jobNumber`, `Job`, `FinancialCase`, or invoice until deposit; pending cancellation is hard deletion.
- Booking confirmation is atomic: deposit recording creates `BK-DEPT-YEAR-XXXXX`, `FinancialCase`, locked closed Deposit Invoice, and deposit payment in one transaction.
- Booking check-in is atomic and payment-free: creates `Job`, stores `Booking.jobId/jobNumber`, creates `WAITING_SELECTION` Order, stamps `FinancialCase.jobId`.
- Deposit truth comes from `Payment` records, not `Booking.depositPaid`.
- Booking creation accepts customer phone, not customer id; existing customer names are display-only.
- Editing start requires: selection complete + editor assigned + settled DEPOSIT invoice + canonical full invoice balance settled.
- Order completion requires: pickup recorded + production `READY_FOR_PICKUP`/`COMPLETED` + settled payment or admin override.

### Admin / catalog
- Session types and extra-photo pricing are manager/admin editable; `SessionType.code` and `departmentId` are frozen after create; `isActive` is the archive flag; calendar display lives row-level.
- Packages are classified via `Package.packageFamilyId`; department and session type derive live through `PackageFamily → SessionType → StudioDepartment`.

### Auth / audit
- Clerk owns auth/session state; Prisma `User` is the source of truth for role and internal identity. `User.active` soft-delete is live.
- `ActorContext.actorRole` is required; permission checks throw on missing roles; `recordPayment()` is guarded at the service boundary.
- Structured `AuditLog` is append-only at the service layer with required `actorUserId`; audited writes happen in the same transaction as the action.
- Dashboard date windows use studio timezone (`Asia/Kuwait`).

## Feature History
- **102 R7b** — Added pure OrderCompositionViewModel projectors for POS, current-composition, overview, and production deliverables; rewired the adjustment-workspace POS adapter through the canonical model/projector path with regression coverage for package-item upgrade and downgrade pricing equivalence.
- **102 R7a** — Added the read-only OrderCompositionViewModel core for draft, locked/effective, and pending-adjustment composition state with structured metadata and no new label-derived swap parsing path.
- **101 R6** — Removed temporary FinancialCase discrepancy/parity logger and reconciliation invariant, refreshed the invariant catalog, and added static guards for projector purity plus removed-symbol regressions.
- **100 R5** — Removed direct app/component DB imports by moving configure-session routing, missing-session-setting messages, upgrade-payment outstanding-balance validation, and new-booking page data loading into service helpers; added a service-only DB access regression guard.
- **99 R4** — Centralized KD formatting, signed money display, and money-input parsing in `src/lib/formatting/money.ts`; migrated targeted UI/action/service display call sites and added formatter plus regression guard tests.
- **98 R3b** — Booking page financial readout now consumes `toBookingPageFinancial`; confirmed booking-stage and checked-in active-stage displays use canonical FinancialCase projection data, and the legacy package remaining balance label is removed.
- **98 R3a** — Order header and orders table financial readouts now consume `FinancialCaseSummary` projectors; orders-table projection loading is batched; R3b booking-page swap remains next.
- **96** — R1b FinancialCaseSummary projectors completed for header, draft sidebar financials, payment dialog, orders table, booking page, and invoice list; parity checker now covers header/table projections.
- **94** — Linked-product session configurations materialize as selection-owned `OrderAddOn` rows; display-mode enum/columns retired.
- **93** — Session-config selections snapshot option labels; invoice/detail lines use shared grouped renderer; staff-only operational config display; adjustment deltas get Added/Removed/Changed descriptions.
- **92a** — Configure Session panel made three-mode (`draft`/`locked`/`adjustment`); operational-only workspace finalization closes without issuing an empty adjustment invoice.
- **92** — Post-lock session-configuration routing through AdjustmentWorkspace; `SESSION_CONFIGURATION` adjustment invoice lines.
- **91** — Configure Session dialog, per-package summary/missing-required UI, live draft totals; selection service as sole writer.
- **90** — Session-configuration pricing engine, live required-selection resolver, Final Invoice integration; resync uses same pricing helper.
- **89** — Session Configurations admin CRUD at `/session-configurations`.
- **88** — Session Configuration schema/migration scaffolding (no runtime wiring).
- **87** — Order Details Financials reads canonical FinancialCase documents; legacy `getOrderFinancialSummary` removed.
- **86** — Extra-photo pricing admin CRUD with paired digital/print edits.
- **85** — Session Type admin CRUD; calendar display row-level; default zero-priced extra-photo pricing rows on create.
- **84c** — AdjustmentWorkspace Stage Edits → Preview → Pending Changes → Pending Adjustment Summary flow; FinancialSidebarAdjustment.
- **84b** — Locked sales uses CurrentCompositionCard + FinancialSidebarLocked; draft/locked sidebar split.
- **84a** — Shared CompositionView normalizer and presentational card.
- **83c** — AdjustmentWorkspace mounts shared POS modules via staged-edit handler adapters and POS-shaped derived read model.
- **83b** — POS composition/photo/add-on controls refactored behind typed handler contracts.
- **83a** — AdjustmentWorkspace edit DSL supports `change_package_tier`, `upgrade_package_item`, `change_selected_photo_count`.
- **82** — AdjustmentWorkspace foundation: schema/events, staged services, optimistic versioning, finalize-time approval, consolidated ADJUSTMENT emission.
- **81f** — INV-18 goodwill classification adjustment + audited F6 backfill script.
- **81e** — Financial invariant catalog + generated owner-facing index.
- **81d** — Healthchecks.io successful-report pings on reconciliation.
- **81c** — Canonical settled/outstanding displays across order header, list, invoice detail.
- **81b** — `createRefundInvoice` privatized; refund flows via `issueRefundWithPayment`.
- **81a** — Dual-read warning path and feature flag removed; classifier is canonical.
- **80c** — DB triggers for PaymentAllocation over-collection and ADJUSTMENT-parent chains.
- **80b** — `InvoiceLockSnapshot` + locked-invoice frozen-field trigger.
- **80a** — `AuditLog` with co-transactional audit writes across booking/payment/invoice/adjustment/credit-note/refund.
- **79d** — Manager credit-note approval modal for POS reductive locked edits.
- **79c** — True overpayment refund capacity under row lock; UI default/max validation.
- **79b** — Legacy deposit-deduction balance formulas removed; canonical `Invoice.remainingAmount` everywhere.
- **78a** — Settlement row lock + auto-close fully paid FINAL invoices.
- **78b** — Required `ActorContext.actorRole`; `recordPayment()` service-boundary guard.
- **77 (Phases A–G)** — Financial invariant CI; workflow integration matrix; edge-case expansion; regression suite for 74/75/76; concurrency/security/recovery suite; production reconciliation runner.
- **76 (a/b/c)** — REFUND invoice + outbound payment; CREDIT_NOTE invoice + DocumentApplication binding; reductions wired to credit notes.
- **75c** — POS adjustment settlement: `PaymentType.ADJUSTMENT`, settled invoice close/lock.
- **74 (a–e)** — Document/application allocation foundation, backfill, payment creation choke point, recalculation dual-read, Phase 1 cutover + nightly reconciliation.
- **73c** — Order add-on split: `OrderPackageItemUpgrade` separated from `OrderAddOn`.

## Open Follow-Ups
- R12/performance cleanup: remove legacy settlement imports and independent active-summary construction from `orders-table-projections.service.ts` only if it can preserve fixed-query batching.
- Decide whether to add snapshot-at-order-time extra-photo pricing so historical uninvoiced order composition is insulated from later price edits.
- Fix remaining Phase C/F high-risk findings before production financial expansion: open ADJUSTMENT cancellation disposition, commission persistence, voucher redemption schema.
- Configure production reconciliation secrets/env: `FINANCIAL_RECON_DATABASE_URL`, `FINANCIAL_RECON_SLACK_WEBHOOK`, `FINANCIAL_RECON_SLACK_CHANNEL`, `RECONCILIATION_PING_URL`.
- Manually smoke test booking confirmation, deposit recording, and POS settlement against the migrated dev database.
- Confirm final per-session-type digital and print extra-photo prices with the owner before Spec 70 ships.
- Consider explicit job categorization (`SESSION`, `VOUCHER`, `RETAIL`, `OTHER`) before future voucher or standalone sales invoice flows.

## Validation Pattern
- Validate with the smallest command set needed for the change.
- Prefer `build`, `lint`, and migration checks when schema/workflow changes are involved.
