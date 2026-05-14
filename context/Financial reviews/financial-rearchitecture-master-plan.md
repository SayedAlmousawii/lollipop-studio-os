# Studio OS — Financial Rearchitecture Master Plan

**Date:** 2026-05-14
**Status:** Discussion phase closed. Phase 0 + Phase 1 specs ready for implementation. Phases 2–5 specs to be written when their phase comes up.

This document is the single source of truth for the financial rearchitecture decided in the May 2026 review. It supersedes the recommendations in `financial_architecture_gap_analysis_and_recommendations_may_2026.md` where they conflict.

---

## Companion documents

- `financial_architecture_gap_analysis_and_recommendations_may_2026.md` — original gap analysis (informational; some recommendations were revised here)
- `gift-voucher-workflow-req.md` — voucher business requirements (binding)
- `context/feature-specs/73-financial-rearch-phase-0-schema-groundwork.md` — Phase 0 spec
- `context/feature-specs/74-financial-rearch-phase-1-document-application-payment-allocation.md` — Phase 1 spec

---

## Reality check vs gap-analysis (verified 2026-05-14)

Three deltas matter for migration risk:

| Claim in gap-analysis | Reality in code |
|---|---|
| `Invoice.financialCaseId` is a strong anchor | **Nullable** at `prisma/schema.prisma:619`. Enforced only by business logic. Phase 0 tightens it. |
| Deposit amount is hardcoded 20 KD | **Configurable with 20 KD floor** at `booking.service.ts:594-719`. Specs treat 20 KD as default/minimum, not a constant. |
| Multi-package not yet reflected | **Schema already supports it** — `Order.packages: OrderPackage[]` is one-to-many with no `(orderId, packageId)` unique. The financial layer assumes one package; the relational model does not. |

All other gap-analysis findings (no DocumentApplication, virtual deposit credit, positive-only Payment, no PaymentAllocation, locked invoice edits throw, no credit ledger, OrderAddOn overloads upgrades + add-ons) confirmed accurate.

---

## Resolved architectural decisions

Eighteen forks were resolved during the discussion phase. Summary:

| Fork | Decision |
|---|---|
| A — DocumentApplication shape | **Hybrid.** Generic `DocumentApplication` for invoice ↔ invoice. Separate `GiftCardRedemption` (and future `CreditApplication`) for voucher/credit domains. |
| B — Voucher leftover balance | **Deferred.** Voucher v1 ships forfeit-only. Schema must be designed so a `CustomerCreditAccount` + `CreditTransaction` + `CreditApplication` ledger can be added later without schema rewrite. |
| C — Refund model | **REFUND-type invoice + outbound Payment.** Symmetric with existing inbound flow. |
| D — Refund direction representation | **`Payment.direction: IN \| OUT` enum.** Amount stays always-positive. REFUND invoices carry positive totals. |
| E — Locked-invoice adjustment trigger | **Hybrid.** Additive edits auto-create ADJUSTMENT invoice. Reductions require explicit "issue credit note" action. |
| F — PaymentAllocation timing | **Phase 1, single-allocation invariant.** Multi-allocation unlocks in Phase 5 without schema rewrite. |
| G — Voucher-backed bookings × deposit invoice | **20 KD deposit invoice + GiftCardRedemption.** Every booking has a deposit invoice. Voucher-backed = voucher redemption is the deposit invoice's settlement source. |
| H — Multi-package financial shape | **One Final Invoice per Order, grouped line blocks.** Payments, vouchers, adjustments, refunds, settlement all operate at order level — never per-package. |
| I — OrderAddOn split | **Split now in Phase 0.** `OrderAddOn` (true add-ons) + `OrderPackageItemUpgrade` (package-item upgrades). |
| J — Voucher booking cancellation | **Release before threshold, forfeit after** (long-term intent). |
| K — Invoice numbering | **Shared sequence, prefixed display.** `DEP-YYYY-NNNNN`, `INV-YYYY-NNNNN`, `ADJ-…`, `REF-…`, `CN-…`, `SALE-…`. |
| L — DocumentApplication uniqueness | **Unique `(sourceDocumentId, targetDocumentId)`.** |
| M — Cancellation policy scope | **Defer.** Voucher v1 ships forfeit-on-cancel. Unified policy with cash deposits is a future business decision. |
| N — Expired voucher handling | **Manager can extend (no force-redeem).** Extension reactivates voucher; redemption flows through normal path. |
| O — Voucher manager actions v1 | **VOID, EXTEND, BALANCE ADJUSTMENT, TRANSFER.** REISSUE deferred. All audited; BALANCE ADJUSTMENT tightly permissioned with mandatory reason. |
| P — Voucher purchase | **SALE-type invoice + Payment.** New `InvoiceType.SALE`. Voucher creation is a side-effect of paying the SALE invoice. |
| Q — `Invoice.financialCaseId` NOT NULL | **Phase 0 with backfill.** Orphan invoices get FinancialCase rows backfilled before the constraint flips. |
| R — Spec output format | **Master plan + Phase 0 & 1 specs first, iterate.** This document is the master plan. |

The full decisions log (with reasoning per fork) is in `~/.claude/projects/.../memory/project_financial_review_2026_05.md`.

---

## Core architectural principles

These flow from the resolved decisions and govern every subsequent spec.

1. **One Final invoice per Order.** All settlement primitives (Payment, PaymentAllocation, DocumentApplication, GiftCardRedemption) target the order's single Final invoice. Never an OrderPackage. Line items are grouped by OrderPackage for display only.

2. **Every money movement has an invoice.** Inbound or outbound. Deposit → DEPOSIT invoice. Final settlement → FINAL invoice. Add-on/upgrade after lock → ADJUSTMENT invoice. Reduction → CREDIT_NOTE invoice. Money out → REFUND invoice. Voucher purchase → SALE invoice. There are no synthetic "ledger-only" payments.

3. **Immutable financial history.** Locked invoices are never recalculated or mutated. Every financial change after lock spawns a new sibling invoice + a DocumentApplication binding it to the original.

4. **Explicit applications, not virtual credits.** Deposit-to-final credit is a row in `DocumentApplication`, not a runtime SUM from FinancialCase. Same for adjustments, credit notes, refunds.

5. **Direction is a first-class field on Payment.** `direction: IN | OUT`. Always-positive amount. No negative-payment hacks.

6. **Voucher = booking security + payment instrument.** Voucher-backed booking creates a normal 20 KD deposit invoice settled by GiftCardRedemption. No-show forfeits identical to cash. Cancellation forfeits in v1 (window deferred).

7. **Single redemption with mutable pre-redemption balance.** Voucher balance can decrease before final redemption (no-show, manager adjustment) but voucher participates in exactly one booking lifecycle.

8. **Schema-ready, not feature-complete.** Phase 1–4 schema must support the deferred features (customer credit ledger, multi-allocation payments, multi-package financial layer, unified cancellation policy) without rewrites — additive migration only.

---

## Voucher state machine (synthesized)

```
                 (purchase via SALE invoice)
                            │
                            ▼
        ┌──────────────► ACTIVE ───── (time passes, no booking) ──► EXPIRED ──┐
        │                  │                                                    │
   (EXTEND by mgr,         │ (used to secure booking)                          (VOID by mgr,
    audited)               ▼                                                    any state)
        │              RESERVED ───── (booking cancelled — v1: forfeit) ──┐    │
        │                  │                                                    │
        │                  │         (no-show — 20 KD deposit forfeited;        │
        │                  │          voucher records redemption permanently)   │
        │                  │                                                    │
        │                  │         (POS settlement — remaining balance        │
        │                  ▼          applied to final invoice;                 │
        │              REDEEMED ◄──── voucher fully consumed)                   │
        │                                                                       │
        └──────────────────────────────────────────────────────────────────► VOIDED
```

Invariants:
- Only one voucher in `RESERVED` per booking. Only one booking can reserve a voucher at a time.
- Balance can only decrease (no-show, manager adjustment, partial-prior-redemption-via-no-show). It cannot increase except by manager BALANCE ADJUSTMENT with reason.
- `REDEEMED` and `EXPIRED` are terminal except via manager VOID (audit only — does not restore balance).
- `EXTEND` returns a voucher from `EXPIRED` to `ACTIVE` with new `expiresAt`. Original expiry is preserved in audit history.

---

## Phased implementation plan

### Phase 0 — Schema groundwork (no behavioral change)
**Goal:** Land all additive schema for the rearchitecture without changing any service behavior. Sets up Phase 1+ to be additive-only at the data layer.

**Scope:**
- `Invoice.financialCaseId` → NOT NULL (backfill orphans first)
- `Invoice.invoiceType` → NOT NULL (backfill any nulls based on lifecycle: DEPOSIT/FINAL)
- `Payment.financialCaseId` → NOT NULL (backfill from invoice's financialCaseId)
- Split `OrderAddOn` → `OrderAddOn` (true add-ons: `productId` required) + new `OrderPackageItemUpgrade` (upgrades: `packageItemId` required, references the snapshotted package item)
- Add `Payment.direction PaymentDirection` enum field, default `IN`, backfill all existing rows as `IN`
- Add `InvoiceType.SALE` enum value (no consumer yet)
- Invoice numbering prefix mapping: keep one shared `invoice_number_seq`; display layer maps `invoiceType` → prefix (`DEP-`, `INV-`, `ADJ-`, `REF-`, `CN-`, `SALE-`)

**Risk surface:**
- The OrderAddOn split is a data migration: every existing row with `packageItemId IS NOT NULL` becomes an `OrderPackageItemUpgrade` row; every row with `productId IS NOT NULL AND packageItemId IS NULL` stays in `OrderAddOn`. Cascade and unique-index implications need careful audit.
- The financialCaseId backfill assumes every Invoice can be matched to a FinancialCase. If any orphan exists, create one (`bookingId` from invoice, `customerId` from invoice) before flipping NOT NULL.

**Spec:** `context/feature-specs/73-financial-rearch-phase-0-schema-groundwork.md`

---

### Phase 1 — DocumentApplication + PaymentAllocation foundations
**Goal:** Replace the virtual deposit-credit logic with explicit application + allocation rows. Establishes the primitives every later phase depends on.

**Scope:**
- New `DocumentApplication` model: `id`, `sourceInvoiceId`, `targetInvoiceId`, `amountApplied`, `appliedAt`, `appliedByUserId?`, `notes?`. Unique `(sourceInvoiceId, targetInvoiceId)`.
- New `PaymentAllocation` model: `id`, `paymentId`, `invoiceId`, `amount`, `createdAt`. Single-allocation invariant enforced in app layer (NOT a DB unique on `paymentId` — that would block Phase 5).
- Backfill: for every FinancialCase that has both a DEPOSIT and FINAL invoice, create a DocumentApplication row (source=DEPOSIT, target=FINAL, amount=deposit.paidAmount).
- Backfill: every existing Payment gets exactly one PaymentAllocation row for its full amount against its `invoiceId`.
- Replace `recalculateInvoiceStatus` virtual deposit logic with `effectivePaid = SUM(PaymentAllocation against this invoice) + SUM(DocumentApplication.amountApplied where target = this invoice)`.
- Remove `getDepositCreditAmountForFinancialCase` after migration verification.

**Risk surface:**
- The `recalculateInvoiceStatus` cutover is the highest-risk single change in the entire rearchitecture. Strategy: implement new calculation alongside old, log discrepancies for one release, then cut over.
- PaymentAllocation single-allocation invariant must be enforced everywhere a Payment is created — search `payment.service.ts` for every creation path.

**Spec:** `context/feature-specs/74-financial-rearch-phase-1-document-application-payment-allocation.md`

---

### Phase 2 — Locked-invoice adjustment automation (additive)
**Goal:** Automate ADJUSTMENT invoice creation for additive order edits after Final lock.

**Scope:**
- Detect additive edits: new `OrderAddOn`, new `OrderPackageItemUpgrade`, new extra-photo line, package upgrade.
- On detection, when the Final invoice is `isLocked = true`, automatically create a new `ADJUSTMENT` invoice scoped to the same `financialCaseId`, with line items for the new commercial values only.
- Bind `ADJUSTMENT → FINAL` via `DocumentApplication` with `amountApplied = 0` initially (it's a *receivable*, not a *credit*, until paid — alternative: do not create DocumentApplication for ADJUSTMENT, leave it as a sibling invoice settled separately via PaymentAllocation).
- POS settlement flow updated to surface unpaid ADJUSTMENT invoices alongside the Final.
- Reductions remain blocked here — they route to Phase 3's explicit credit-note action.

**Risk surface:**
- The decision of whether ADJUSTMENT uses DocumentApplication or is purely a sibling-via-PaymentAllocation needs to be settled at the start of this phase. Recommendation: ADJUSTMENT is a sibling settled by allocation, not bound by DocumentApplication. Reserve DocumentApplication for *credit transfers* (DEPOSIT → FINAL, CREDIT_NOTE → FINAL).
- Defining "additive edit" precisely matters — partial removals of an existing add-on count as a reduction, not an addition.

---

### Phase 3 — Refund + credit-note architecture
**Goal:** Model money-out and explicit invoice reductions.

**Scope:**
- `Payment.direction = OUT` enabled (was already added in Phase 0).
- `REFUND` invoice creation flow: manager action, requires originating invoice reference, requires reason.
- Outbound Payment recorded against REFUND invoice.
- `CREDIT_NOTE` invoice creation flow: explicit "issue credit note" action against a locked invoice. Reduces the target invoice's effective receivable via DocumentApplication (`CREDIT_NOTE → FINAL`, `amountApplied = credit note total`).
- Reductions on locked Final invoices route through CREDIT_NOTE.
- Voucher cancellation (forfeit-on-cancel for v1) uses CREDIT_NOTE or VOID-deposit-invoice mechanics — settle at phase start.

**Risk surface:**
- Refund-to-original-payment traceability: should REFUND payments reference their originating Payment? Yes, via a nullable `Payment.refundOfPaymentId` field. Add in this phase.
- Adjustment of an adjustment (chained ADJUSTMENT invoices): allowed conceptually, but the spec must define how `parentInvoiceId` chains form.

---

### Phase 4 — Gift voucher v1 (forfeit-only, no credit ledger)
**Goal:** Ship the gift voucher feature.

**Scope:**
- `GiftCard` model: `id`, `code` (unique), `originalAmount`, `currentBalance`, `purchasedAt`, `expiresAt`, `status` (VoucherStatus enum), `purchaserCustomerId`, `recipientCustomerId?`, `reservedBookingId?`, `saleInvoiceId` (the SALE invoice that created it).
- `GiftCardRedemption` model: `id`, `giftCardId`, `targetInvoiceId`, `amountRedeemed`, `redeemedAt`, `redeemedByUserId`, `redemptionKind` (DEPOSIT_RESERVATION | FINAL_SETTLEMENT | NO_SHOW_FORFEIT | CANCEL_FORFEIT).
- `VoucherStatus` enum: `ACTIVE`, `RESERVED`, `REDEEMED`, `EXPIRED`, `VOIDED`.
- Voucher purchase: SALE invoice → Payment → GiftCard created on payment close.
- Voucher-backed booking: 20 KD DEPOSIT invoice → GiftCardRedemption (kind = `DEPOSIT_RESERVATION`, amount = 20 KD) settles it. Voucher moves to RESERVED.
- POS final settlement: remaining voucher balance → GiftCardRedemption (kind = `FINAL_SETTLEMENT`). Voucher moves to REDEEMED.
- No-show / cancel: GiftCardRedemption (kind = `NO_SHOW_FORFEIT` or `CANCEL_FORFEIT`), voucher records forfeit permanently.
- Manager actions: VOID, EXTEND (audited expiresAt change), BALANCE ADJUSTMENT (audited currentBalance change with reason), TRANSFER (audited recipientCustomerId change).
- Voucher reservation uniqueness: partial unique index — at most one row per voucher with `status = RESERVED`.

**Risk surface:**
- Voucher leftover after FINAL_SETTLEMENT: v1 forfeits. The GiftCardRedemption for FINAL_SETTLEMENT carries the full remaining balance even if it exceeds the invoice's remaining receivable. The excess is dropped. **Schema rule:** `GiftCardRedemption.amountRedeemed` is what was *deducted from the voucher*, not what was *credited to the invoice*. When the credit ledger arrives, a `forfeitedAmount` derived field becomes "leftover to ledger" — no schema change.
- Reserved-then-cancelled-quickly race: if a voucher is reserved on Booking A and Booking A is cancelled, voucher returns to ACTIVE atomically. Use SELECT FOR UPDATE on the voucher row during state transitions.

---

### Phase 5 — Multi-allocation PaymentAllocation
**Goal:** Lift the single-allocation invariant.

**Scope:**
- Remove app-layer single-allocation enforcement.
- Update payment creation flows to accept multiple `{invoiceId, amount}` allocations per Payment.
- POS UI: split-payment-by-invoice support.
- Refund flow updated to allow partial refund references against specific allocations.

---

## Future / unscoped here

- **Multi-package financial enablement.** Schema already supports many OrderPackage per Order. Financial layer must update to render line-block grouping per OrderPackage on the single Final invoice (per Fork H). No new financial primitives required — only invoice-rendering and order-edit detection logic. Drop into a Phase 2.5 or Phase 6 spec once business confirms multi-package operationally.
- **Customer credit ledger.** `CustomerCreditAccount` + `CreditTransaction` + `CreditApplication`. Enables: voucher leftover → store credit (Fork B v2), refund-to-credit, no-show penalty credit, future store credit operations. Phase 4 schema must be ledger-ready: `GiftCardRedemption` design allows redirecting leftover to a credit account without schema rewrite.
- **Voucher REISSUE workflow.** Deferred per Fork O. Workaround: VOID + manual new voucher creation.
- **Unified cancellation-window policy.** Voucher and cash deposits both get a configurable cancellation window. Business decision pending.
- **Deposits-as-liability accounting.** Full revenue-recognition treatment. Not required for v1; current architecture does not block it.

---

## Migration risk summary

| Phase | Highest risk | Mitigation |
|---|---|---|
| 0 | OrderAddOn split data migration | Migration script in transaction; verify row counts pre/post; integration test on real fixture |
| 1 | `recalculateInvoiceStatus` cutover | Dual-write/dual-read with discrepancy logging for one release before cutover |
| 2 | Defining "additive" precisely | Spec-level edit-classifier table; manager override path for ambiguous edits |
| 3 | CREDIT_NOTE math correctness | DocumentApplication uniqueness constraint catches double-application; reconciliation tests |
| 4 | Reservation race conditions | SELECT FOR UPDATE on voucher row during state transitions; partial unique index on RESERVED state |
| 5 | Existing payment flows breaking | Single-allocation invariant removal is purely additive at schema; app-layer flag-gate the multi-allocation paths |

---

## Risk management and invariant discipline

Phase 1 is the single most dangerous merge point in the entire rearchitecture — it replaces `recalculateInvoiceStatus`, the central money-math function, and touches every Payment creation path. A bug here corrupts customer balances silently. The discipline below is mandatory across all phases that mutate financial state.

### Risk profile per phase

| Phase | Risk | Why |
|---|---|---|
| 0 | Low | Additive schema. Only OrderAddOn split is real data migration. |
| 1 | **High** | Replaces central balance calculation. Touches every Payment creation path. Silent-corruption potential. |
| 2 | Medium | New auto-creation behavior. Risk of invoice sprawl + classifier correctness. |
| 3 | Medium-high | Outbound payments = real money out. CREDIT_NOTE math + DocumentApplication uniqueness must hold or money refunds twice. |
| 4 | Medium | Mostly isolated to voucher module. Reservation race + pre-redemption balance mutation are subtle. |
| 5 | Low | Pure invariant lift. Schema already supports it. |

### Database-level invariants (mandatory at table creation time)

Cheapest, strongest guard. Add at the migration that creates each new table or column:

- `CHECK (paidAmount >= 0)`, `CHECK (totalAmount >= 0)` on `Invoice`
- `CHECK (amount > 0)` on `Payment` — direction encodes in/out, sign stays positive
- `CHECK (amount > 0)` on `PaymentAllocation`
- `CHECK (amountApplied > 0)` on `DocumentApplication`
- `UNIQUE (sourceInvoiceId, targetInvoiceId)` on `DocumentApplication` (Phase 1)
- Partial unique: `CREATE UNIQUE INDEX ON gift_cards (reservedBookingId) WHERE reservedBookingId IS NOT NULL` (Phase 4) — at most one voucher reserved per booking
- `CHECK (currentBalance >= 0)` and `CHECK (currentBalance <= originalAmount)` on `GiftCard` (Phase 4)
- Foreign-key `ON DELETE` semantics audited per table — financial records should generally `RESTRICT`, never `CASCADE` away

**Important:** PaymentAllocation must NOT have `UNIQUE (paymentId)`. The single-allocation invariant is app-layer in Phase 1 so Phase 5 can lift it without a schema change.

### Invariant test suite (CI-blocking, every PR)

Single file `tests/financial-invariants.test.ts` runs against fixture-seeded DB. Failing any of these blocks merge:

1. For every `FinancialCase`: `SUM(PaymentAllocation IN) - SUM(PaymentAllocation OUT) + SUM(DocumentApplication received) >= 0`
2. For every `Invoice` (post-Phase 1): computed `effectivePaid` matches `SUM(PaymentAllocations against it, signed by direction) + SUM(DocumentApplications targeting it)`
3. For every locked `Invoice`: `totalAmount`, `closedAt`, line items unchanged from snapshot at close (use a hashed snapshot column or a separate immutable mirror)
4. For every `Payment`: `SUM(its PaymentAllocations) = Payment.amount`
5. For every `GiftCard` (Phase 4+): `originalAmount - SUM(GiftCardRedemption.amountRedeemed) = currentBalance`
6. For every `Booking` with voucher reservation: exactly one `GiftCardRedemption` row with `kind=DEPOSIT_RESERVATION` and non-forfeit status
7. No `Payment` with `direction=OUT` whose `invoice.invoiceType` is not `REFUND` (Phase 3+)
8. For every `DocumentApplication`: `amountApplied <= source.paidAmount`

### Runtime invariant assertions

Every financial mutation service ends with `assertFinancialCaseInvariants(financialCaseId, tx)` inside the same transaction. Catches bugs at write-time, not at next read. Implementation: a single function that runs the relevant subset of the CI invariant queries for one FinancialCase. Add in Phase 1 alongside `createPaymentWithAllocation`; reuse in every subsequent phase.

### Reconciliation job (prod safety net)

Nightly script runs the full invariant test suite against prod data and posts to Slack on any violation. This is the catch-all for bugs that escaped CI. Caught violations get a ticket within 24h instead of surfacing via customer complaint. Ship alongside Phase 1's cutover.

### Service-layer choke points

Only sanctioned helpers create the new financial records. Raw `prisma.X.create` for financial models is forbidden outside those helpers (lint rule or PR-checker enforced):

- `createPaymentWithAllocation` (Phase 1)
- `createAdjustmentInvoice` (Phase 2)
- `createRefundInvoice`, `createCreditNote` (Phase 3)
- `reserveVoucherForBooking`, `redeemVoucherToInvoice`, `forfeitVoucher`, `extendVoucher`, `voidVoucher`, `adjustVoucherBalance`, `transferVoucher` (Phase 4)

### Dual-read verification windows

For any phase that changes a calculation or auto-creates records:
- New code path runs alongside old, returning the old (authoritative) result
- Discrepancies log at WARN with both values + identifiers
- One release window with zero discrepancies before cutover
- Already specified in Phase 1; replicate the pattern for Phase 2 (classifier vs current "throw on locked edit") and Phase 4 (voucher math vs hand-calculated fixtures)

### Shadow mode for high-risk new flows

Phase 4 voucher purchase ships first as "create GiftCard records, block redemption" for one release. Verifies creation math under real load before redemption unlocks. Same pattern for any future flow that involves customer money.

### Feature-flagged trunk (not long-lived branches)

Every sub-spec lands in `main` behind a flag. Flags default OFF, flip after verification window. Long-lived rearch branches diverge and become their own risk surface. Phase 1's `FINANCIAL_REARCH_PHASE_1_DUAL_READ` flag is the template.

### Shared financial test fixtures

Single seed module `tests/fixtures/financial.ts` produces the canonical test bookings: cash-deposit confirmed, voucher-backed confirmed, adjusted, refunded, multi-package, credit-noted. Every phase's tests consume from it. Prevents per-developer fixture drift and the silent disagreement on what "correct" looks like. Establish in Phase 1.

### Type-level guarantees

TypeScript discriminated unions for `InvoiceType`, `PaymentDirection`, `VoucherStatus`. Impossible states unrepresentable in code, not just unlikely. Use `Decimal` library consistently (no `number` for money math).

### Observability before each phase ships

Each phase's spec must declare its dashboards/metrics as in-scope:
- Phase 1: DocumentApplication creation rate, dual-read discrepancy count, PaymentAllocation orphan count
- Phase 2: ADJUSTMENT invoice creation rate, time from order-edit to ADJUSTMENT creation
- Phase 3: refund rate, average refund, CREDIT_NOTE issuance rate
- Phase 4: voucher state distribution, redemption success rate, reservation collision count

If you can't see it, you can't catch regressions.

### Reversibility

Every phase's spec must include an explicit rollback note: what the down-migration looks like, what the flag-flip-back looks like, and which data is non-recoverable if reverted (e.g., once a REFUND Payment ships, reverting the Phase 3 flag must not strand outbound payment rows).

### Architecture Decision Records co-located with code

Memory and this master plan capture the "why" for the team that's here today. A year from now, a new developer modifying `invoice.service.ts` won't read either. Co-locate short ADR markdown files under `src/modules/invoices/decisions/`, `src/modules/payments/decisions/`, `src/modules/vouchers/decisions/` capturing the load-bearing rules: no virtual deposit credit, DocumentApplication is for credit transfers only, voucher leftover forfeits in v1. One ADR per rule. Keeps decisions discoverable from the code.

---

## Spec granularity — split behavior-changing phases

Project pattern (per `feature-specs/`) is to split work across letter-suffixed sequential specs (59 → 60 → 61 → ...; 70a → 70b → 70c → ...). Bundling all of a phase into one spec multiplies merge-point risk. Heuristic: **split when a step represents a separately-revertable change in production behavior; bundle when steps share a single migration boundary.**

Final spec list:

```
73    Phase 0  Schema groundwork                                  (bundled — invoice/payment NOT NULLs, PaymentDirection, InvoiceType.SALE)
73b   Phase 0  Financial discipline infrastructure                (framework: invariant registry, fixtures module, choke-point checker, dual-read helper, reconciliation harness, ADR dirs, type aliases)
73c   Phase 0  OrderAddOn split                                   (3 steps: add table → migrate service code → backfill + drop column; depends on 73, must land before 75a)

74a   Phase 1  DocumentApplication + PaymentAllocation tables (schema only)
74b   Phase 1  Backfill DocApplication + PaymentAllocation rows
74c   Phase 1  Migrate Payment creation to createPaymentWithAllocation
74d   Phase 1  Refactor recalculateInvoiceStatus behind dual-read flag
74e   Phase 1  Cutover + remove virtual deposit logic + reconciliation job

75a   Phase 2  ADJUSTMENT invoice primitives + createAdjustmentInvoice
75b   Phase 2  Edit-classifier + auto-ADJUSTMENT trigger
75c   Phase 2  POS surfacing of unpaid adjustments

76a   Phase 3  REFUND invoice + outbound Payment + refundOfPaymentId
76b   Phase 3  CREDIT_NOTE invoice + DocumentApplication binding
76c   Phase 3  Wire reductions on locked invoices to CREDIT_NOTE

77a   Phase 4  GiftCard + GiftCardRedemption schema + VoucherStatus
77b   Phase 4  Voucher purchase flow (SALE invoice → GiftCard)
77c   Phase 4  Voucher-backed booking + reservation + DEPOSIT redemption
77d   Phase 4  POS voucher final settlement + forfeit on no-show/cancel
77e   Phase 4  Manager actions (VOID, EXTEND, BALANCE ADJUSTMENT, TRANSFER)

78    Phase 5  Multi-allocation lift                              (bundled — small, atomic)
```

Phase 0 stays bundled (single Prisma migration). Phase 5 stays bundled (small, single invariant lift).

---

## Phase-start decisions queue

Each later phase has a small number of sub-decisions that were intentionally left open during the May 2026 review. They were not pushed to closure because they are field-choice or mechanism-level decisions that are best made with codebase-level grounding at the moment that phase begins — not in the abstract now.

A future session writing a Phase N spec **must** close that phase's queued decisions with the user before producing the spec. The recommended default is captured for each so the session can ask "confirm or override?" rather than re-discovering the question.

### Phase 2 — start-gate decisions ✓ RESOLVED (2026-05-14)

1. **ADJUSTMENT settlement mechanism (Fork S):** Pure sibling settled by PaymentAllocation. `DocumentApplication` is reserved for credit transfers only.
2. **Edit classifier + 12 edge cases (Fork T, E1–E12):** Resolved. See `project_financial_review_2026_05.md` (memory) for the full classifier rules. Highlights:
   - Manual surcharges and manual discounts both require explicit manager action; only *order-edit-triggered* additions auto-spawn ADJUSTMENT.
   - Net-zero upgrade swaps produce no financial records (activity log only).
   - Non-equal upgrade swaps produce two records (ADJUSTMENT + CREDIT_NOTE), never net-delta.
   - All ADJUSTMENTs are siblings of FINAL; never chain ADJUSTMENT → ADJUSTMENT.
   - All CREDIT_NOTEs target FINAL, even when reducing what was added by an ADJUSTMENT.
   - `priceSnapshot` on a locked-invoice line cannot be edited directly — staff must delete + re-add or issue CREDIT_NOTE.

### Phase 3 — start-gate decisions ✓ RESOLVED (2026-05-14)

3. **Refund traceability field (Fork U):** Yes — nullable `Payment.refundOfPaymentId` FK.
4. **Voucher-backed booking forfeit mechanism v1 (Fork V):** Lock deposit (NO_SHOW-equivalent state) + record `GiftCardRedemption` with kind=NO_SHOW_FORFEIT/CANCEL_FORFEIT. No CREDIT_NOTE. Phase 4 mechanics; Phase 3 does NOT need to model this.

### Phase 4 — start-gate decisions

5. **`GiftCardRedemption` field set for ledger-readiness.**
   Master plan says `amountRedeemed` is "what was deducted from the voucher, not what was credited to the invoice." This implies leftover can be inferred. Pin the exact field set so a future credit-ledger phase can introspect redemptions without schema rewrite.
   - **Recommended default field set:** `id`, `giftCardId`, `targetInvoiceId` (nullable — `NO_SHOW_FORFEIT`/`CANCEL_FORFEIT` may not have a target), `amountRedeemed` (deducted from voucher), `amountAppliedToInvoice` (credited to invoice — may be less than `amountRedeemed` when leftover is forfeited), `redemptionKind` (DEPOSIT_RESERVATION | FINAL_SETTLEMENT | NO_SHOW_FORFEIT | CANCEL_FORFEIT | MANAGER_VOID), `redeemedAt`, `redeemedByUserId`, `notes?`. When the credit ledger arrives later, `forfeitedAmount = amountRedeemed - amountAppliedToInvoice` can redirect to a `CreditTransaction` without altering this schema.
   - **Why open:** Whether to store `amountAppliedToInvoice` explicitly or derive it. Explicit is safer for v2 ledger migration; derived is leaner.

### Phase 5 — start-gate decisions

None substantive. Phase 5 is a purely additive lift of the single-allocation invariant and the validation in `createPaymentWithAllocation`. The only decision is UI-shape for split-payment-by-invoice in POS, which is a UX question, not an architectural one.

---

## Operational principles preserved

The rearchitecture preserves these existing operational behaviors:
- Booking confirmation creates the FinancialCase + Deposit invoice exactly as today.
- Cash-deposit no-show forfeits exactly as today.
- POS settlement flow visually unchanged — primitives underneath change.
- Locked invoice immutability — same behavior, new mechanism for change (adjustment/credit-note invoices).
- Activity logging — extends to cover DocumentApplication, PaymentAllocation, voucher state transitions.
