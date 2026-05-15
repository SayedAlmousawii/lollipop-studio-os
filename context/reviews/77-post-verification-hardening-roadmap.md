# 77 Post-Verification Hardening Roadmap

Consolidated master plan for the stabilization phase that follows Feature 77 verification (Phases A–G). It merges findings from `77-financial-risk-report.md`, `77-testing-coverage-report.md`, `77-architecture-gap-analysis.md`, and `77-operational-risk-analysis.md` into a single, prioritized roadmap.

Severity legend: **CRITICAL** = production-money corruption or workflow bypass that can ship today; **HIGH** = systemic integrity gap, can corrupt under realistic load or misuse; **MEDIUM** = correctness/maintainability risk with known mitigations; **LOW** = cleanup / cosmetic.

---

## 1. Executive Summary

Feature 77 verification (Phases A–G) raised confidence in the choke-point architecture significantly: `PaymentAllocation` and `DocumentApplication` are reliably enforced through CI invariants, service workflows have been exercised end-to-end, reconciliation runs read-only against the production database, and rollback injection leaves no partial writes. The financial *shape* is sound.

However, the verification effort also exposed a small number of **structural weaknesses that are real production hazards today**:

- **Invoice settlement row locking is now closed by Feature 78a** — `recordPayment()` takes a row-level lock before balance reads, removing the demonstrated double-click and final-1% race window.
- **Locked invoice immutability is service-only** — a direct Prisma write can unset `isLocked` or mutate `totalAmount`; there is no DB trigger and no audit snapshot to even prove it happened.
- **POS settlement auto-lock is now closed by Feature 78a**. Fully paid FINAL invoices now close and lock inside the settlement transaction, including the prior `Draft` edge case.
- **Refund capacity is computed from inbound allocations, not real overpayment**. Managers can issue refunds larger than true overpaid amount, and the UI defaults to the unsafe number (Phase E: 210 KD default vs 45 KD actual overpayment).
- **Retired virtual-deposit deduction is now closed by Feature 79b** — POS and editing readiness consume canonical `Invoice.remainingAmount`, and DEPOSIT readiness reads the DEPOSIT invoice settlement state.
- **`assertActorPermission()` short-circuits when `actorRole` is missing**, and `recordPayment()` has no role guard at all — internal callers can bypass authorization.
- **No `AuditLog` model exists.** Booking-level financial actions and locked-field history are unprovable.
- **"Production ready" can be set with required sections incomplete**, and delivery then unlocks — a non-financial but real workflow-integrity bypass.

The recommendation is to **freeze new feature work until the CRITICAL list is closed**. The HIGH list should be closed in the same stabilization window before commissions/reporting/vouchers expansion begins. Reconciliation is a safety net, not a substitute for these fixes.

---

## 2. Highest Priority Financial Risks

| # | Severity | Risk | Source | Required Fix |
|---|---|---|---|---|
| F1 | **COMPLETED** | Fully paid FINAL invoices now auto-close and lock inside the settlement transaction, including the prior `Draft` edge case | Closed by Feature 78a | `recordPayment()` now settles FINAL invoices to `CLOSED + isLocked=true` at `remainingAmount = 0` |
| F2 | **CRITICAL** | `computeRefundableAmountForInvoice` treats inbound allocations as refundable capacity; managers can refund beyond true overpayment, and invoice-detail UI defaults to the unsafe amount | Phase C EC-18/EC-19; Phase E (210 vs 45 KD) | New service `computeOverpaymentCapacity()` that derives capacity from `payments − CREDIT_NOTE-net invoice total − prior REFUND`. UI must default to this value and cap input |
| F3 | **CRITICAL** | Locked invoice immutability is service-layer only. EC-27 proves direct Prisma can unset `isLocked`; `totalAmount` is also writable. No `AuditLog` snapshot exists to even detect after the fact | Risk §B, §D; Phase F | DB-level: trigger or `UPDATE` policy rejecting mutation when `isLocked=true` (except controlled fields). Add `InvoiceLockSnapshot` table written inside lock transaction |
<<<<<<< HEAD
| F4 | **COMPLETED** | Paid ADJUSTMENT removal now has an adjustment-cause ledger and line-targeted reversal path | Closed by Feature 79a | Classifier-issued ADJUSTMENT lines carry cause metadata; removals issue CREDIT_NOTE applications to the originating ADJUSTMENT line and REFUND/outbound payment when paid |
| F5 | **HIGH** | Order-layer balance display still subtracts Deposit paid amount from Final Invoice remaining (`calculateFinalBalanceDue`, `mapPOSInvoiceSummary`, `hasBasePayment`). Order can show "no outstanding" while canonical Final Invoice has 20 KD due | Phase D REG-LEGACY-01; Phase E ("Paid 255 of 230") | Delete legacy formulas. All balance display must consume canonical `Invoice.remainingAmount` + `DocumentApplication`. Editing readiness must read canonical balance only |
=======
| F4 | **HIGH** | Paid ADJUSTMENT removal produces no CREDIT_NOTE/REFUND reversal because classifier has no adjustment-cause ledger | Phase C E11; Phase E | Add adjustment-cause linkage so reductive edits to a paid-ADJUSTMENT cause trigger the standard reversal flow |
| F5 | **COMPLETED** | Order-layer balance display no longer subtracts Deposit paid amount from Final Invoice remaining; the legacy `calculateFinalBalanceDue`, POS remaining recomputation, and base-payment threshold helpers were removed by Feature 79b | Closed by Feature 79b | POS and editing readiness now consume canonical `Invoice.remainingAmount`; deposit settlement is read from the DEPOSIT invoice's own remaining balance |
>>>>>>> a99bb65 (79b)
| F6 | **HIGH** | Reconciliation `INV-18` mismatch found in dev: order `cmp6tm9n30007n7t3ramturmp` total 230 KD vs revenue-documents total 225 KD | Phase G; [F6 finding](77-f6-investigation-finding.md) | Classified active: paid-ADJUSTMENT cause removal plus manual CREDIT_NOTE can diverge revenue documents from current order composition. Sprint 4 fixes the underlying paths and backfills |
| F7 | **MEDIUM** | `Invoice.paidAmount` is a cached field; reconciliation derives from joins but service/UI paths can read stale cache | Risk §C; Phase G | Either remove cached field and compute, or guarantee write-side update under transaction; reconcile every write that touches payments/applications |

---

## 3. Critical Workflow Integrity Risks

| # | Severity | Risk | Source | Required Fix |
|---|---|---|---|---|
| W1 | **DEFERRED** | "Mark ready for pickup" succeeds while required production sections (Album Design, Printing, Assembly, Vendor, Framed Prints) are still "Not started". Delivery then becomes available | Phase E | Deferred: not all orders require all sections; formalizing per-order-type required-section taxonomy is out of scope for stabilization. See §12 |
| W2 | **HIGH** | Reductive locked-invoice edit in POS fails with "Unable to remove order add-on" instead of opening the manager credit-note workflow | Phase E | Surface the manager-approval/credit-note prompt in the POS reductive path |
| W3 | **COMPLETED** | Editing-start readiness now rejects unsettled DEPOSIT invoices and outstanding canonical Final Invoice balance | Closed by Feature 79b | Covered by canonical balance display/editing gate regression tests |
| W4 | **COMPLETED** | POS settlement now closes and locks FINAL invoices as part of the payment transaction instead of requiring a separate close step | Closed by Feature 78a | Full payment now performs settlement and lock in one operation |
| W5 | **MEDIUM** | Photographer reassignment after check-in is financially neutral but unaudited when written directly | Phase C EC-31 | Service-only reassignment path, or audit on write |

---

## 4. Concurrency / Transactional Risks

| # | Severity | Risk | Source | Required Fix |
|---|---|---|---|---|
| C1 | **COMPLETED** | `recordPayment()` now acquires `SELECT … FOR UPDATE` on the invoice row before balance reads, removing the demonstrated settlement race window | Closed by Feature 78a | Balance-read → payment-write → recalculation → close now happens under the same locked transaction |
| C2 | **HIGH** | Invoice-level over-collection prevention is app-layer only; no DB constraint enforces `sum(allocations) ≤ invoice.totalAmount` | Risk §B; Arch §E | Add a deferred CHECK or trigger; or enforce by writing settled `remainingAmount` under the same lock as C1 |
| C3 | **MEDIUM** | ADJUSTMENT chaining is blocked at service/CI level but not at DB | Risk §D; Phase C E8 | DB CHECK: `parentInvoiceId` must reference an invoice whose `invoiceType != ADJUSTMENT` |
| C4 | **LOW** | Cross-booking simultaneous reference generation relies on self-healing `identifier_sequences` upsert. Same-booking race already covered | Phase F | Acceptable; revisit only if higher booking volume is targeted |

---

## 5. Security / Permission Risks

| # | Severity | Risk | Source | Required Fix |
|---|---|---|---|---|
| S1 | **COMPLETED** | `actorRole` is now required on `ActorContext`, and `assertActorPermission()` throws `MissingActorRoleError` if an untyped caller passes a missing role | Closed by Feature 78b | Shared auth helper moved to `src/lib/auth/assert-actor-permission.ts`; typed callers must pass a real role |
| S2 | **COMPLETED** | `recordPaymentWithClient()` now enforces `PAYMENT_CREATE` at the service boundary, closing the internal-caller bypass path | Closed by Feature 78b | Explicit role-check now runs inside the payment service before invoice reads/writes |
| S3 | **MEDIUM** | Browser URL-level financial visibility for `PHOTOGRAPHER`/`EDITOR` is untested | Phase F | Add Playwright role-negative tests on invoice/order/POS pages |
| S4 | **MEDIUM** | No `AuditLog` model means actor attribution for booking-level financial actions is unprovable | Arch §F | Introduce `AuditLog` (see A1) |

---

## 6. Architecture Cleanup & Refactor Priorities

| # | Severity | Item | Source | Action |
|---|---|---|---|---|
| A1 | **HIGH** | No `AuditLog` model; `OrderActivity` covers order-scoped actions only. Booking confirmation, no-show, lock events, reassignment are unprovable | Arch §F; Risk §B | Introduce `AuditLog(actorUserId, entityType, entityId, action, before, after, at)` plus `InvoiceLockSnapshot` row written on lock |
| A2 | **COMPLETED** | Duplicate order-service balance formulas were removed by Feature 79b | Closed by Feature 79b | Order-level callers now sum canonical `Invoice.remainingAmount`; POS invoice summaries return each invoice's stored remaining amount |
| A3 | **MEDIUM** | Invariant verification surface spans Phase A/B/C/D/F/G suites + runtime `src/modules/financial/invariants.ts`. Ownership is unclear | Arch §C; Phase G | Single owner-facing invariant catalog/index; keep phase folders but document which is canonical |
| A4 | **MEDIUM** | `financial.rearch.dual_read.discrepancy` fires during *valid* locked-edit workflows. Pollutes log-based gating | Phase B/D/E; Arch §D | Remove the dual-read path now that classifier is canonical; or scope the warning to actual divergences only |
| A5 | **MEDIUM** | `issueRefundWithPayment` is the only correct refund entry point; `createRefundInvoice` alone is a primitive and is treated as the workflow by some paths | Arch §B; Phase B INT-12 | Mark `createRefundInvoice` `@internal`; route public callers through `issueRefundWithPayment` only |
| A6 | **LOW** | Reconciliation alerting is Slack-only with no persisted run history | Phase G; Arch §F | Add `reconciliation_runs` table (deferred to post-stabilization) |

---

## 7. Deprecated Logic / Transitional Path Removal

| # | Severity | Item to Remove | Source |
|---|---|---|---|
| D1 | **COMPLETED** | `calculateFinalBalanceDue` (order.service.ts) | Closed by Feature 79b |
| D2 | **COMPLETED** | Deposit subtraction in `mapPOSInvoiceSummary` | Closed by Feature 79b |
| D3 | **COMPLETED** | `hasBasePayment` / `REQUIRED_BASE_PAYMENT_AMOUNT` editing-readiness helpers | Closed by Feature 79b |
| D4 | **MEDIUM** | Dual-read locked-edit warning path (A4) | Phase D/E |
| D5 | **LOW** | Legacy backend smoke fixtures that pair default-`PENDING` bookings with `FinancialCase` rows | Phase A, Arch §D |
| D6 | **LOW** | Old `Financial invariants: OK` reconciliation script output path — already removed in Phase G; verify no callers remain | Arch §D |

All removals must land with characterization tests flipped to failure-expecting tests (REG-LEGACY-01 in particular).

---

## 8. Operational / UX Risks

| # | Severity | Risk | Source | Action |
|---|---|---|---|---|
| O1 | **HIGH** | Refund default in invoice detail exceeds visible overpayment (210 vs 45 KD) | Phase E; F2 | UI must default to and cap by `computeOverpaymentCapacity()` |
| O2 | **HIGH** | Order header shows "Paid 255 of 230" after refund/credit-note actions — no canonical settlement view | Phase E | One canonical financial summary component fed by invoice-service totals |
| O3 | **COMPLETED** | POS no longer leaves a fully paid FINAL invoice in a misleading Draft/unlocked state after settlement | Closed by Feature 78a | Resolved by F1 |
| O4 | **MEDIUM** | Locked-edit reductive path returns generic error instead of manager-approval prompt | Phase E; W2 | UI copy + flow change |
| O5 | **MEDIUM** | Slack delivery has no external "no-report-in-24h" monitor | Phase G; Ops §D | Add external monitor (Healthchecks.io / cron-monitor) |
| O6 | **LOW** | No first-class financial AuditLog view for accountants; activity feed only | Phase E; Arch §F | Deferred until A1 lands |

---

## 9. Remaining Untested / Low-Confidence Areas

- **INV-14 locked-field immutability** — cannot be exactly verified without lock-time snapshot. Blocked on A1.
- **INV-18 full revenue composition** — runner reports; dev mismatch found (F6).
- **Browser role-negative UX** — non-manager credit-note/refund attempts, photographer URL access (S3).
- **Commission persistence at package upgrade** — EC-32/EC-33; no `Commission` model. Defer to commission expansion phase.
- **Voucher/GiftCardRedemption schema** — EC-39; defer to voucher expansion phase.
- **True simultaneous DB races** — Phase F service-level races run, but DB-level concurrency observation is limited.
- **Live Slack webhook delivery** — in-memory transport only.
- **Pending cancellation / confirmed cancellation / no-show / package downgrade** — service paths exist, browser paths not exercised.

---

## 10. Recommended Hardening Implementation Order

The order is chosen to (a) close the largest production hazards first, (b) avoid building on top of soon-to-be-deleted code, and (c) make later removals safe.

**Sprint 1 — Stop active corruption vectors**
1. F1 — Completed in Feature 78a: auto-lock Final Invoice on full payment (settlement transaction)
2. C1 — Completed in Feature 78a: row-level lock on invoice settlement (`SELECT … FOR UPDATE`)
3. S1 + S2 — Completed in Feature 78b: required `actorRole` + role guard on `recordPayment()`
4. F6 — **Investigation complete** for dev `INV-18` mismatch (order `cmp6tm9n30007n7t3ramturmp`, 230 vs 225 KD): active bug, root cause and repro test documented in [F6 finding](77-f6-investigation-finding.md). Fix lands in Sprint 4

**Sprint 2 — Fix money correctness**
4. F2 + O1 — Real overpayment-capacity service; UI default/cap
<<<<<<< HEAD
5. F4 — Completed in Feature 79a: adjustment-cause ledger; reversal on paid-ADJUSTMENT removal
6. F5 + D1 + D2 + D3 + A2 — Delete legacy deposit-deduction formulas; route through canonical balance
=======
5. F4 — Adjustment-cause ledger; reversal on paid-ADJUSTMENT removal
6. F5 + D1 + D2 + D3 + A2 — Completed in Feature 79b: legacy deposit-deduction formulas deleted; callers route through canonical balance
>>>>>>> a99bb65 (79b)
7. W2 + O4 — Reductive locked-edit UX surfaces manager prompt

**Sprint 3 — Workflow integrity & immutability proofs**
8. A1 + F3 — `AuditLog` model + `InvoiceLockSnapshot` + DB-level locked-invoice mutation prevention
9. C2 — DB-level over-collection prevention
10. C3 — DB-level ADJUSTMENT chain prevention

**Sprint 4 — Cleanup & operability**
11. A4 + D4 — Remove dual-read warning path
12. A5 — `createRefundInvoice` marked internal
13. O2 — Canonical order-header settlement summary
14. O5 — External "no-report" monitor for nightly reconciliation
15. A3 — Invariant catalog/index
16. F6 — Resolve active `INV-18` mismatch: fix paid-ADJUSTMENT cause removal/manual CREDIT_NOTE divergence, backfill dev row, and flip `tests/financial/inv-18-regression.test.ts` to pass
17. S3 — Browser role-negative test suite

**Freeze the financial architecture** after Sprint 3 lands and Sprint 4 cleanup is at least underway. Re-run the full invariant + reconciliation suite against production-shape data before opening feature expansion.

---

## 11. Must Fix Before Expansion

These must all be closed before commissions, reporting, vouchers, or integrations work begins. Each one would compound or be reintroduced by expansion work.

- **F1** Completed in Feature 78a: auto-lock Final Invoice on full payment
- **F2** Real overpayment-capacity service + UI cap
- **F3** DB-level locked-invoice immutability + lock snapshot
<<<<<<< HEAD
- **F4** Completed in Feature 79a: paid-ADJUSTMENT reversal
- **F5 / D1-D3 / A2** Legacy deposit-deduction removal
=======
- **F4** Paid-ADJUSTMENT reversal
- **F5 / D1-D3 / A2** Completed in Feature 79b: legacy deposit-deduction removal
>>>>>>> a99bb65 (79b)
- **C1** Completed in Feature 78a: invoice row-level locking on settlement
- **C2** DB-level over-collection prevention
- **C3** DB-level ADJUSTMENT chain prevention
- **S1, S2** Completed in Feature 78b: required actor role + `recordPayment()` guard
- **A1** `AuditLog` model (commissions and reporting both depend on it)
- **O1, O2** Canonical refund-default and order-header settlement display

Rationale: every expansion feature on the roadmap (commissions, reporting, vouchers, integrations) reads from balance, applies money, or relies on auditability. Shipping any of them on top of the current weaknesses guarantees they inherit the same gaps and make later fixes far more invasive.

---

## 12. Acceptable For Now Technical Debt

These are real gaps, but the cost of fixing them now outweighs the residual risk, and the reconciliation runner provides a detection backstop.

- **W1** Server-side "production ready" gating — not all order types require all production sections; formalizing the per-order-type required-section taxonomy is its own project. Revisit after voucher/commission expansion when order-type definitions are touched anyway.
- **C4** Cross-booking reference generation race — self-healing path holds at current volume.
- **A3** Multi-folder invariant verification surface — owner-facing index is nice-to-have; phase folders work.
- **A6** Persisted `reconciliation_runs` table — Slack + stdout is sufficient given operator response time.
- **O5** External no-report monitor — add when ops has bandwidth; alternative is to alert from CI on the nightly schedule.
- **EC-32/EC-33** Commission persistence — not in scope until commissions expansion phase.
- **EC-39** Voucher/GiftCardRedemption schema — not in scope until voucher expansion phase.
- **S3** Browser role-negative tests — service-level coverage in Phase F is sufficient short-term; add before public-internet exposure expands.
- **O6** First-class AuditLog UI for accountants — depends on A1; deferred view.
- **F7** Cached `paidAmount` field — keep it but ensure every write recomputes; full removal is a larger refactor.

---

## 13. Recommended Next Major Development Phase After Stabilization

Once Sections 11 are closed and Section 10 Sprint 4 is at least in progress, the architecture is safe to extend. Selected order (owner decision 2026-05-15):

1. **Voucher / GiftCardRedemption schema (Phase 4)** — owner priority. New write path; must adopt the (now DB-enforced) invariants and locked-invoice protections from the start. This is the first real stress test of the stabilized financial foundation, so the gating list (§11) is non-negotiable before it begins.
2. **Commission persistence (`Commission` model)** — EC-32/EC-33 already characterized; package-upgrade flows already exercised; depends on A1 (`AuditLog`) which lands during stabilization.
3. **Reporting / accountant view** — read-only consumer of the now-frozen architecture; depends on A1 and canonical balance display (A2/F5/O2).
4. **Integrations (external accounting / payment processors)** — last; depends on stable AuditLog and reconciliation as contract surface.

*Note: items 2 and 3 ordering may be revisited.*

Each expansion phase should begin by adding its own invariant tests to the catalog (A3) and its own reconciliation checks to the nightly runner before any user-facing flow ships.

---

*Generated 2026-05-15 from Phases A–G review documents. This roadmap supersedes ad-hoc TODOs in the four source reports for prioritization purposes; the source reports remain authoritative for finding-level detail.*
