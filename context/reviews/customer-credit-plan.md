# Studio OS — Customer Credit Design Plan

**Status:** Design locked, pre-spec. Created 2026-06-12.
**Purpose:** Capture the confirmed design and business rules for the Customer Credit system so the implementation spec(s) can be written against a stable target. This is a planning document, not a spec.

**Companion docs:**
- `context/reviews/Financial-brainstorming.md` — the working discussion (vouchers + customer credit) this plan resolves the customer-credit half of.
- `context/reviews/archive/financial/financial-rearchitecture-master-plan.md` — the financial rearchitecture this builds on (Fork B "customer credit ledger" deferred-but-ledger-ready intent; "Future / unscoped → Customer credit ledger").
- `context/reviews/credit-settlement-application-plan.md` — the order/case-scoped settlement model (Specs 153–164). Customer Credit is a **new, additive** layer above this; it does **not** reopen that engine.

---

## 1. Concept

Customer Credit is a **distinct domain from Gift Vouchers**. It:

- **belongs to a customer** (non-transferable),
- is **reusable across future bookings/orders**,
- **expires** (default one year),
- is **store value only** — never converted back to cash.

Gift Vouchers (a later phase) are code-based, single-lifecycle, transferable prepaid instruments. The two stay separate **source** domains but **share the settlement plumbing** (`ValueApplication`, below).

**Driving use case (v1):** a confirmed booking pays a locked 20 KD deposit, then cancels. A manager converts that deposit into customer credit, which the customer can spend on a future booking within the validity window.

---

## 2. Locked Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Credit model | **Credit certificate** (each credit is its own row, drawn down by applications) | Per-credit expiry is trivial; mirrors the existing credit-note drawable pool. Not a derived-balance ledger. |
| 2 | Credit amount on cancellation | **Full deposit** | Entire paid deposit converts to credit. Simplest rule; matches the business scenario. |
| 3 | Who can issue | **Manager / admin only** | Consistent with today's refund permission; this rides the refund path. |
| 4 | Expiry | **Configurable, default 1 year** | Default 365 days from issue; a studio setting can override later. |
| 5 | Cancellation window | **Manager discretion** (no hard system cutoff) | Keep it simple; manager judges eligibility at cancel time. A system-enforced window can be added later as policy. |
| 6 | Extend expired credit | **Manager can extend** (audited) | Reactivates an expired credit with a new expiry. Cheap, customer-friendly, parallels voucher EXTEND. |
| 7 | Credit sources (v1) | **Cancelled deposit only** | Smallest surface. Schema keeps `sourceType` so goodwill/manual credits are an additive change later. |
| 8 | Who can spend | **Any staff** | Applying credit at settlement is just paying a bill; reception can do it like recording a payment. |
| 9 | Transferable | **Non-transferable** | Credit belongs to the customer who earned it. Transferability is a voucher trait, keeping the domains distinct. |
| 10 | Cash-out | **No cash-out** | Spendable on future invoices only, never refunded to cash. Standard store-credit convention; avoids refund-of-refund loops. |
| 11 | Disposition mechanism | **Refund-gate + REFUND invoice** | Widen the refund source-gate to accept a DEPOSIT invoice; emit a REFUND invoice as the reversing document; mint the CustomerCredit as the sink. Keeps the books balanced; stays out of the OrderCommit/Final engine. |
| 12 | Settlement plumbing | **Shared `ValueApplication` table** | One application table for customer credit now and gift vouchers later; the invoice settlement read model sums cash + document + value sources uniformly. |
| — | Sequencing | **Customer Credit before Gift Vouchers** | Delivers the named business need; builds the shared settlement layer; de-risks vouchers. |
| — | Redemption rules | **Any invoice, partial allowed, FIFO by expiry, mixed sources allowed** | Confirmed earlier in discussion. |
| 13 | Credit funds a new booking's deposit | **Yes** — at confirmation, via a pending `ValueApplication(CUSTOMER_CREDIT)` hold (Option-G-style variant). No-show / attendance disposition → **POST** the held deposit; cancel-in-window → **VOID** the hold and restore credit; credit < deposit → **credit + cash top-up**; credit stays **portable** (only deposit amount held). | Review findings H1 and H4 (2026-06-12). Makes deposit settlement symmetric across cash/credit/voucher and avoids bespoke restore paths. |
| 14 | Retry / double-submit safety | **Every credit money movement has an idempotency key** enforced by a unique constraint. | Review finding H4 (2026-06-12). Prevents double issue, double hold, double redemption, and duplicate breakage on retries/concurrent submits. |

---

## 3. Domain Model (sketch)

> Final Prisma shape is the spec's job; this is the intended shape.

```
enum CustomerCreditStatus { ACTIVE | REDEEMED | EXPIRED | VOID }
enum CustomerCreditSourceType { CANCELLED_DEPOSIT }   // v1; future: GOODWILL, VOUCHER_LEFTOVER, ...

model CustomerCredit {
  id
  customerId            -> Customer
  sourceType            CustomerCreditSourceType
  originalAmount        Decimal
  remainingAmount       Decimal        // decremented by applications
  expiresAt             DateTime
  status                CustomerCreditStatus
  sourceBookingId?      -> Booking      // the cancelled booking (provenance)
  sourceRefundInvoiceId?-> Invoice      // the REFUND invoice that reversed the deposit
  issuedByUserId        -> User         // manager/admin who issued
  createdAt / updatedAt
  // indexes: customerId, status, expiresAt
}
```

### Shared settlement primitive

```
enum ValueApplicationSourceKind { CUSTOMER_CREDIT }   // v1; GIFT_VOUCHER added in the voucher phase
enum ValueApplicationStatus { PENDING | POSTED | VOIDED }

model ValueApplication {
  id
  sourceKind        ValueApplicationSourceKind
  sourceId          String        // polymorphic -> CustomerCredit (or GiftCard later); unconstrained FK,
                                   // mirroring existing polymorphic refs (e.g. OrderCommitSnapshotLineV1.orderEntityId)
  targetInvoiceId?  -> Invoice      // required for invoice-settling POSTs; nullable for source-only breakage/void bookkeeping if needed
  amountHeld        Decimal        // reserved from the source while PENDING
  amountPosted      Decimal        // credited/forfeited when POSTED
  amountVoided      Decimal        // released back to source when VOIDED
  status            ValueApplicationStatus
  idempotencyKey    String @unique
  createdByUserId   -> User
  resolvedByUserId? -> User
  createdAt
  resolvedAt?
  // indexes: targetInvoiceId, (sourceKind, sourceId)
}
```

For ordinary **customer-credit invoice redemption**, `amountHeld == amountPosted` and `amountVoided == 0`. The split exists because deposit funding is two-phase: confirmation creates a **PENDING hold**; attendance/no-show **POSTS** it; cancel-in-window **VOIDS** it and restores the source credit. Gift vouchers reuse the same shape and may later post only part of a hold while voiding the remainder.

`PaymentAllocation` (cash) and `DocumentApplication` (invoice↔invoice) are **unchanged**.

---

## 4. Settlement Architecture (read-layer unify)

The invoice settlement read model becomes:

```
effectivePaid(invoice) =
    Σ PaymentAllocation against it (signed by Payment.direction)
  + Σ DocumentApplication.amountApplied targeting it
  + Σ posted ValueApplication.amountPosted targeting it
```

- This is the single place "invoices don't care where value came from" lives (per `Financial-brainstorming.md` future-proofing requirement).
- `recalculateInvoiceStatus` and the canonical financial read model (`FinancialCaseSummary`) extend to include the `ValueApplication` term. No invoice redesign.
- A future 5th settlement source = a new `ValueApplicationSourceKind` + a branch in the aggregator. Nothing else moves.

---

## 5. Flows

### 5.1 Issuance — cancel deposit → credit (manager only)

1. Manager cancels a confirmed booking and chooses **"Convert deposit to credit."**
2. Disposition (booking-stage, no Job/Final):
   - Source = the locked **DEPOSIT** invoice. Widen the refund source-gate to accept DEPOSIT (today it only accepts FINAL/ADJUSTMENT/CREDIT_NOTE — `refund.service.ts:192-199`).
   - Emit a **REFUND invoice** (the reversing document; the deposit invoice itself stays immutable per invariant #3). Amount = full deposit, capped by `caseNetCashOverpayment` (its no-Final branch already returns the net cash — `invoice.service.ts:2878`).
   - The REFUND invoice is settled by a **non-cash outbound `Payment` (method = credit-issuance)** so the Payment→allocation invariant holds and the invoice closes — **but no cash physically leaves** (the studio keeps the 20 KD; it reclassifies a deposit into a credit liability). This non-cash method is excluded from cash-out reporting.
   - **Mint** `CustomerCredit { sourceType: CANCELLED_DEPOSIT, originalAmount = amount, remainingAmount = amount, expiresAt = issuedAt + validity, status: ACTIVE, sourceBookingId, sourceRefundInvoiceId, issuedByUserId }`.
3. All in one transaction, audited (`AuditLog`), with `assertFinancialCaseInvariants`.

> **Why not direct-mint with no REFUND invoice:** the paid deposit invoice would still read as settled, double-representing the 20 KD (cash received + credit liability) and breaking register reconciliation. The REFUND invoice is the reversing document that keeps the books straight.

### 5.2 Redemption — spend credit (any staff)

1. At settlement of any future invoice, staff applies the customer's available credit.
2. Selection is **FIFO by `expiresAt`** across the customer's `ACTIVE`, non-expired credits.
3. For each consumed credit, create and immediately post `ValueApplication { sourceKind: CUSTOMER_CREDIT, sourceId, targetInvoiceId, amountHeld = amountPosted }`, decrement available value; when it hits 0, set status `REDEEMED`.
4. **Partial** allowed; a single settlement may span **multiple** credits and **mix** with cash / (future) voucher (e.g. 160 = 20 credit + 100 voucher + 40 cash).
5. The settlement read model counts posted `ValueApplication.amountPosted` toward `effectivePaid`.

### 5.3 Fund a new booking's deposit (the driving use case — H1)

The primary way a customer "uses the credit toward a new booking." Mirrors the voucher Option-G confirmation variant; key difference: **credit never commits to the case — it stays portable.**

1. At new-booking confirmation, reserve from the customer's `ACTIVE` non-expired credits **FIFO** using `ValueApplication(CUSTOMER_CREDIT, status=PENDING)`. The deposit invoice is issued and considered settled by the pending value hold plus any cash top-up → CLOSED + locked → CONFIRMED.
2. If available credit **< deposit**, hold all available credit and collect the remainder in **cash** (mixed settlement: pending `ValueApplication(credit)` + cash `Payment`). Confirmation still requires the deposit fully settled.
3. Only the **deposit amount** is held; any remaining credit stays `ACTIVE` and portable (still applies to other invoices/bookings).
4. The booking-confirmation "deposit paid" gate (`booking.service.ts:864`) must recognize a `ValueApplication` as settlement — generalize to one **"deposit settled by any source"** check shared with vouchers.
5. **Dispositions** for a credit-funded booking:
   - **Attendance** → **POST** the hold; the credit-funded deposit credits to FINAL via the **effective-settlement** path (see M2), as a cash deposit would.
   - **No-show** → **POST** the hold to breakage income (parity with cash/voucher no-show).
   - **Cancel-in-window** → **VOID** the hold; source credit is restored by the same operation, not by bespoke balance repair, and no cash is returned.
6. A hold must resolve exactly once. Partial-post + auto-void remainder is allowed at spec time if the penalty is less than the held deposit.

### 5.4 Manager actions

- **Extend** (audited): set a new `expiresAt`, return an `EXPIRED` credit to `ACTIVE`. Original expiry preserved in audit history.

---

## 6. Invariants

- `0 <= remainingAmount <= originalAmount` (DB CHECK).
- `originalAmount − Σ posted/held source consumption + Σ voided releases (for this credit) = remainingAmount`; the spec should define whether pending holds reduce `remainingAmount` directly or are exposed as a separate `availableAmount = remainingAmount - heldAmount`.
- `ValueApplication.amountHeld > 0`; at hold/apply time `amountHeld <= source.availableAmount` and the source is `ACTIVE` and not past `expiresAt`.
- A `ValueApplication` resolves exactly once: `PENDING -> POSTED` or `PENDING -> VOIDED`; no `POSTED -> VOIDED` or `VOIDED -> POSTED`.
- `ValueApplication.idempotencyKey` is unique and required for every credit money movement.
- A credit past `expiresAt` cannot be applied (enforced at application time; status lazily reflected as `EXPIRED` — no background job per architecture §5).
- Issuance and every state change write co-transactional `AuditLog` rows.
- Existing financial invariants extend to include the `ValueApplication` term in `effectivePaid`.

---

## 7. Permissions

| Action | Role |
|---|---|
| Issue credit (cancel → credit) | Manager / Admin |
| Extend expired credit | Manager / Admin |
| Apply (spend) credit at settlement | Any staff |

---

## 8. Out of Scope / Deferred (additive later, no redesign)

- **Goodwill / manual credits** — schema-ready via `sourceType`; not wired in v1.
- **Cash-out of credit** — disallowed in v1.
- **Transfer to another customer** — disallowed in v1.
- **System-enforced cancellation window** — manager discretion in v1; a configurable cutoff is a future policy.
- **Voucher leftover → credit** — arrives with the gift-voucher phase; `ValueApplication` is the shared landing.
- **Gift Vouchers** — entirely separate phase; reuses `ValueApplication` + the settlement read layer built here.

---

## 9. Open Implementation Details (resolve at spec time)

- **Non-cash refund payment method** — the exact method/enum for the credit-issuance outbound Payment, and ensuring it is excluded from cash-out reporting/reconciliation.
- **`computeOverpaymentCapacity(source)`** (`refund.service.ts:207`) — confirm it tolerates a DEPOSIT source, or rely solely on the `caseNetCashOverpayment` half of the `Decimal.min`.
- **Manager VOID of a credit** (issued-in-error) — confirm whether v1 needs it; cheap to add, audited.
- **Hold accounting shape** — whether `remainingAmount` is decremented at hold creation with held amount reported separately, or remains gross with `availableAmount` derived from pending holds.
- **Re-credit on later reversal** — if a booking the credit was *spent on* is itself cancelled/refunded, how the posted application unwinds. Likely out of v1 scope; confirm.
- **Customer-facing surfacing** — where the customer's available credits appear (customer profile, POS settlement). Read-layer/projector work.

---

## 10. Suggested Spec Breakdown

The shared settlement layer and the customer-credit domain split cleanly along migration boundaries:

1. **Schema + settlement read-layer** — `CustomerCredit`, `ValueApplication`, hold-status enum, idempotency keys, migration; extend `recalculateInvoiceStatus` / `FinancialCaseSummary` to include the posted `ValueApplication` term (with zero rows, behavior-neutral).
2. **Issuance** — booking-stage deposit disposition: widen refund source-gate to DEPOSIT, non-cash credit-issuance Payment, mint `CustomerCredit`; manager-gated; audited.
3. **Redemption** — apply credit at settlement (FIFO, partial, mixed-source), `ValueApplication` writes, status transitions; any-staff.
4. **Manager actions + surfacing** — extend (and VOID if confirmed); customer-facing read surfaces.

Numbers assigned when written, per repo convention.
