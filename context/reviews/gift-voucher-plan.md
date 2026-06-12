# Studio OS — Gift Voucher Design Plan

**Status:** Design locked, pre-spec. Created 2026-06-12.
**Purpose:** Confirmed design and business rules for the Gift Voucher system, ready for implementation spec(s). Counterpart to `customer-credit-plan.md`; reuses its `ValueApplication` settlement layer.

**Companion docs:**
- `context/reviews/archive/financial/gift-voucher-workflow-req.md` — binding business requirements.
- `context/reviews/archive/financial/financial-rearchitecture-master-plan.md` — Phase 4 voucher schema/state-machine/start-gate decisions.
- `context/reviews/Financial-brainstorming.md` — vouchers + customer-credit discussion.
- `context/reviews/customer-credit-plan.md` — locked customer-credit design; the shared `ValueApplication` + case-credit pool originate there and in Specs 153–164.

---

## 1. Concept

A gift voucher is a **prepaid, code-based, transferable studio-credit instrument** that doubles as **booking security**. It is sold for cash, valid one year, and redeemable toward sessions. It is **distinct from customer credit** (which belongs to a customer, is non-transferable, and arises from cancellations).

**The defining lifecycle insight:** *before attendance a voucher is a portable instrument; at attendance it commits to a Financial Case and its remaining value merges into that case's credit pool.* After commitment it is no longer a free-floating balance — it behaves exactly like case-owned credit (Specs 153–164), tagged with voucher provenance.

---

## 2. Foundational Accounting (locked)

- **A voucher sale is a liability (deferred revenue), NOT revenue.** Cash in at sale creates a voucher liability; revenue is recognized only at redemption — through the order's FINAL/ADJUSTMENT invoices as normal, while the voucher draw extinguishes the matching liability. No double-count: cash recognized once at sale, revenue once at delivery, liability bridges the gap.
- **Modeled as reporting classifications + an outstanding-liability metric, NOT a double-entry GL.** Fits the manual studio-OS model; classifications must be correct so the accountant sees true numbers.
- **Breakage recognized as income at the event** — no-show penalty, expiry, and forfeited leftover move from liability to a distinct "voucher breakage" income line when they occur.
- **Per-voucher identity:** `originalAmount = outstanding balance (liability) + redeemed-to-revenue + breakage`. `currentBalance` = outstanding liability.
- **Reporting integration:** `InvoiceType.SALE` voucher sales are **excluded from the session-revenue/invoiced subtotal** (liability-creating). New figures: Outstanding Voucher Liability (Σ `currentBalance` of ACTIVE+RESERVED), Redeemed Voucher Value (Σ `ValueApplication(GIFT_VOUCHER).amountApplied` + provenance-tagged pool consumption), Breakage, Voided/Refunded. A voucher-aware extension to the financial register + a small voucher report.

---

## 3. Locked Decisions

| Area | Decision |
|---|---|
| Validity | **1 year from purchase**, configurable default (365 days). |
| Purchase | **SALE invoice → Payment → GiftCard** on payment close. New `InvoiceType.SALE`. |
| Sell permission | **Any staff** (it's a normal sale). |
| Transferability | **Code-based**: before reservation, the code-holder can redeem and a manager `TRANSFER` can reassign the recipient; **locks on reservation**. |
| Deposit handling (Tension 1) | **Option G** — voucher settles the deposit at confirmation (the customer "pays the deposit from voucher balance"). Preserves the deposit invoice's canonical meaning (paid + locked + closed at confirmation). |
| Lifecycle (Tension 2) | Attendance = **commit to the financial case**, not "redeem against FINAL." Before attendance the voucher is portable; at attendance remaining value **merges into the case-credit pool** with `GIFT_VOUCHER` provenance. |
| No-show | **Lose only the deposit amount** (→ breakage). Voucher stays ACTIVE with remaining balance, re-bookable. Penalty = the deposit drawn (configurable, default/min 20 KD). |
| Cancellation (pre-session) | **Manager discretion** — fully release (restore deposit to voucher) or apply the no-show-equivalent penalty. |
| Balance model (Tension 3) | **Explicit typed rows + cached derived `currentBalance`.** `ValueApplication(GIFT_VOUCHER)` for invoice-settling draws; `VoucherEvent` for non-invoice changes. **Never mutate `currentBalance` without a corresponding typed source row.** |
| Reversal of voucher-funded settlement | A voucher-funded reversal creates **case credit (value owed), disposition later** — no auto-restore. Post-commit it's just pool credit; pre-commit (cancel) it restores the live voucher. Voucher-settled value is **never cash-refundable** (voucher draws aren't `Payment`s → contribute 0 to `caseNetCashOverpayment`). |
| Leftover (Tension 4) | **Forfeit as breakage** at case closure (unconsumed `GIFT_VOUCHER`-origin pool credit → breakage income). |
| Manager actions | **VOID, EXTEND, BALANCE ADJUSTMENT, TRANSFER** — all audited. Manager can EXTEND an expired voucher (no force-redeem). |
| Settlement plumbing | `GIFT_VOUCHER` is the second `ValueApplication` source-kind (shared with customer credit), using `amountDrawn` vs `amountApplied` for the forfeiture asymmetry. |
| Reservation uniqueness | At most one booking holds a voucher at a time (partial unique on `reservedBookingId`). |
| Unused-voucher refund | **VOID + cash refund** of the SALE (existing refund flow). |
| Redeem/commit permission | **Any staff** (it's part of booking confirmation / settlement, like applying customer credit). |

---

## 4. Domain Model (sketch)

```
enum VoucherStatus { ACTIVE | RESERVED | COMMITTED | EXPIRED | VOID }
// ACTIVE: sold, usable, portable.  RESERVED: held to a booking (deposit drawn), still releasable.
// COMMITTED: attended -> remaining value merged into the case-credit pool; terminal as a live balance.
// EXPIRED: past expiry without commitment (manager can EXTEND -> ACTIVE).  VOID: manager-voided.
// Edge: a voucher whose balance reaches 0 via no-shows is effectively depleted (terminal).

enum VoucherEventKind { NO_SHOW_FORFEIT | CANCEL_RESTORE | BALANCE_ADJUSTMENT | VOID | EXTEND | COMMIT_TO_CASE }

model GiftCard {
  id
  code                  String @unique
  originalAmount        Decimal
  currentBalance        Decimal        // CACHED — derived from ValueApplication + VoucherEvent rows; never mutated alone
  status                VoucherStatus
  purchasedAt / expiresAt
  purchaserCustomerId   -> Customer
  recipientCustomerId?  -> Customer
  reservedBookingId?    -> Booking      // partial-unique WHERE NOT NULL
  committedFinancialCaseId? -> FinancialCase
  saleInvoiceId         -> Invoice      // the SALE invoice that created it
  createdAt / updatedAt
}

model VoucherEvent {                     // non-invoice balance changes + lifecycle events
  id
  giftCardId            -> GiftCard
  kind                  VoucherEventKind
  amount                Decimal?         // signed effect on balance (null for pure status events)
  reason                String?
  actorUserId           -> User
  createdAt
}
```

### Shared settlement primitive (from `customer-credit-plan.md`, extended)

```
enum ValueApplicationSourceKind { CUSTOMER_CREDIT | GIFT_VOUCHER }

model ValueApplication {
  id
  sourceKind        ValueApplicationSourceKind
  sourceId          String        // -> CustomerCredit or GiftCard (polymorphic, unconstrained FK)
  targetInvoiceId   -> Invoice
  amountDrawn       Decimal        // deducted from the instrument
  amountApplied     Decimal        // credited to the invoice (== amountDrawn for customer credit; may differ for vouchers)
  appliedByUserId   -> User
  createdAt
}
```

### Case-credit pool provenance (existing, extended)

The case-credit pool already carries `creditOrigin` (REVERSAL / REMOVAL / GOODWILL). Add **`GIFT_VOUCHER`** as an origin. Committed voucher value becomes pool credit tagged `creditOrigin = GIFT_VOUCHER` + `sourceVoucherId` — preserving voucher provenance for reporting **without** a parallel balance.

---

## 5. Settlement & `effectivePaid`

`effectivePaid(invoice) = Σ PaymentAllocation (signed) + Σ DocumentApplication.amountApplied + Σ ValueApplication.amountApplied` — the same uniform read-model as customer credit. Vouchers add no new settlement math; they're the second `ValueApplication` source-kind. Post-commit, voucher value lives in the case-credit pool and settles via the existing pool/DocumentApplication rules.

---

## 6. Flows

### 6.1 Purchase (any staff)
SALE invoice → Payment → on close, create `GiftCard` (ACTIVE, balance = original, expiry = purchase + validity). Liability created; no revenue.

### 6.2 Voucher-backed booking confirmation (Option G)
Validate code → confirm booking; voucher draws the deposit (`ValueApplication GIFT_VOUCHER`, e.g. 20) settling the deposit invoice → deposit invoice issued → paid-by-voucher → CLOSED + locked → booking CONFIRMED. Voucher → RESERVED, balance −deposit. (Deposit truth for voucher bookings = the `ValueApplication`, not a cash `Payment` — `hasDepositPayment`-style checks need a voucher-aware equivalent.)

### 6.3 No-show
Deposit already drawn → kept as **breakage** (`VoucherEvent NO_SHOW_FORFEIT`). Voucher → ACTIVE at reduced balance, re-bookable.

### 6.4 Cancellation before session (manager discretion)
Either: full release — refund the deposit to the voucher (`VoucherEvent CANCEL_RESTORE`), voucher → ACTIVE at full balance; or apply the no-show-equivalent penalty.

### 6.5 Attendance — commit to case
Deposit credits to FINAL (existing DEPOSIT→FINAL `DocumentApplication`); voucher's remaining balance **commits**: merged into the case-credit pool (`creditOrigin = GIFT_VOUCHER`, `sourceVoucherId`), voucher → COMMITTED (`VoucherEvent COMMIT_TO_CASE`). Pool value then settles FINAL/ADJUSTMENT/future receivables in that case by existing rules.

### 6.6 Reversal of a voucher-funded settlement
Removed add-on etc. → CREDIT_NOTE (value owed) → sits in the case-credit pool; disposition later. Never auto-restored; never cash-refundable (no cash backing).

### 6.7 Case closure — leftover
Case-closure hook recognizes any unconsumed `GIFT_VOUCHER`-origin pool credit as **breakage income**.

### 6.8 Manager actions (audited)
VOID, EXTEND (expiry; EXPIRED→ACTIVE), BALANCE ADJUSTMENT (with reason), TRANSFER (recipient ref, pre-reservation). All write `VoucherEvent` + `AuditLog`.

---

## 7. Invariants

- `0 <= currentBalance <= originalAmount` (DB CHECK).
- `originalAmount − Σ(ValueApplication.amountDrawn) − Σ(VoucherEvent reductions) + Σ(VoucherEvent restores) = currentBalance` (derived; invariant-checked). **No balance change without a typed row.**
- At most one `RESERVED` reservation per voucher (partial unique on `reservedBookingId`).
- A `ValueApplication(GIFT_VOUCHER)` only against an invoice in the appropriate scope (deposit invoice pre-commit; the committed case post-commit — though post-commit draws are pool/DocumentApplication, not new `ValueApplication`s).
- Voucher draws are never `Payment`s → never contribute to `caseNetCashOverpayment` → voucher value is never cash-refundable.
- Expired vouchers cannot be redeemed; only manager EXTEND reactivates. Every state change writes co-transactional `AuditLog`.
- Outstanding voucher liability = Σ `currentBalance` of ACTIVE + RESERVED.

---

## 8. Permissions

| Action | Role |
|---|---|
| Sell voucher | Any staff |
| Reserve / redeem / commit at booking & settlement | Any staff |
| VOID / EXTEND / BALANCE ADJUSTMENT / TRANSFER | Manager / Admin |
| Cancellation disposition (release vs penalty) | Manager / Admin |

---

## 9. Out of Scope / Deferred

- Leftover → customer credit (declined; forfeit-as-breakage chosen). Additive later if desired.
- Refund-to-customer-credit for unused-voucher refunds (cash chosen).
- Deposits-as-liability accounting for cash bookings (separate, pre-existing deferral).
- Voucher REISSUE (use VOID + new voucher).
- System-enforced cancellation window (manager discretion in v1).

---

## 10. Open Implementation Details (resolve at spec time)

- **Voucher-aware "deposit paid" check** — `hasDepositPayment`-style logic must recognize a `ValueApplication(GIFT_VOUCHER)` as deposit settlement for voucher-backed bookings.
- **Case-closure hook** — exact trigger (job delivered / all receivables settled / no further invoices) and how it finalizes `GIFT_VOUCHER`-origin pool leftover to breakage.
- **Commit mechanics** — how remaining voucher value is written into the case-credit pool (one pool entry tagged `GIFT_VOUCHER` + `sourceVoucherId`) and how `currentBalance` zeroes at commit.
- **Mixed-source reversal attribution** — when a settlement funded by voucher + cash is reversed, which source is restored first (lean: non-cash first).
- **Reporting surfaces** — register classification of SALE invoices; the voucher report (active/reserved/committed/expired/voided, liability, sales, redemptions, breakage); customer/POS code-validation UI.
- **Depleted-voucher status** — terminal handling when balance reaches 0 via no-shows.
- **Confirmation variant** — the voucher-backed confirmation path that draws the deposit from the voucher instead of recording a cash deposit Payment, while keeping the deposit invoice locked+closed+paid.

---

## 11. Suggested Spec Breakdown

1. **Schema + settlement extension** — `GiftCard`, `VoucherEvent`, `VoucherStatus`, `InvoiceType.SALE`, `ValueApplicationSourceKind.GIFT_VOUCHER`, `creditOrigin.GIFT_VOUCHER`; derived-balance recalculation + invariants (behavior-neutral with zero rows). *(Depends on the customer-credit `ValueApplication` layer existing.)*
2. **Purchase** — SALE invoice → Payment → GiftCard; voucher report scaffolding.
3. **Voucher-backed booking + reservation** — Option G confirmation variant; deposit-from-voucher; reservation uniqueness; no-show + cancellation dispositions.
4. **Attendance commit + case-pool merge** — commit-to-case, provenance-tagged pool entry, post-commit settlement via existing pool rules; case-closure breakage hook.
5. **Manager actions + reporting surfaces** — VOID/EXTEND/ADJUST/TRANSFER; register classification; voucher report; code-validation UI.

Numbers assigned when written, per repo convention. Customer Credit ships first (it builds the shared `ValueApplication` layer).
