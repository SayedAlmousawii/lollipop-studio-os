# 162 · R3 — Reversal Refund Channel (credit-note-balance refund, no manufactured overpayment)

> Plan label **R3** (reversal-credit model phase); repo number **162** is provisional.
> Fourth spec of the phase in
> `context/reviews/reversal-credit-and-refund-model-decision.md` (model **C′ + Option 1**, §3/§5).
> **Behavioral.** Depends on **R0 (159)**, **R1 (160)**, **R2 (161)** merged.
> After R3, **no path emits `CAUSE_REVERSAL`** — which is what unblocks R4 (enum retirement).

## Goal

Finish the C′ model: make **all** adjustment-reversal value drawable settlement-capable credit
(dropping R2's paid/unpaid split and the last `CAUSE_REVERSAL` emission), and refund the
customer's owed cash **from the credit note's unapplied balance** instead of from a manufactured
invoice overpayment. Open receivables still settle **first** (the existing sweep); only what
remains drawable on a *paid-origin* reversal note becomes refundable. Genuine cash overpayment
(pay 120 on a 100 invoice) keeps the existing `computeOverpaymentCapacity` path, untouched.

This removes the last place reversal value inflates an invoice's effective-paid, so the register
reconciles in the paid case exactly as it now does in the unpaid case (R2).

## What R2 left for R3 (the starting point)

R2 split adjustment reversals by `requiresRefund` (= `adjustmentLine.isPaid`):
- **Unpaid** → drawable `REVERSAL` credit note, swept as `SETTLEMENT`. Done.
- **Paid** → **still** a line-targeted `CAUSE_REVERSAL` note (manufactures overpayment on the
  ADJ) **+** an immediate `computeOverpaymentCapacity` refund from that ADJ. This is the legacy
  path R3 replaces.

## Read First

- `context/reviews/reversal-credit-and-refund-model-decision.md` — §3 (two-channel table; refund
  source = the credit note's unapplied balance), §5 worked cases **2 and 4**, §7 (R3 row;
  locked decision #2: goodwill-style **null** `refundOfPaymentId` for credit-note-sourced refunds).
- `src/modules/refunds/refund.service.ts` — `issueRefundWithPaymentWithClient` / `createRefundInvoice`:
  source must be FINAL/ADJ + locked (l.178–186); capacity = `computeOverpaymentCapacity` (l.188);
  REFUND `parentInvoiceId = source.id` (l.206); OUT payment closes the REFUND invoice.
- `src/modules/invoices/invoice.service.ts`:
  - `computeOverpaymentCapacity` (l.2494) — `max(effectivePaid − total − Σ REFUND children, 0)`;
    note **REFUND children reduce capacity purely via `parentInvoiceId`**, not via any application.
  - `computeCreditNoteAvailable` (l.2534) — `total − Σ source applications`; **does NOT currently
    net REFUND children** (the key change below).
  - `applyAdjustmentReversalsWithClient` (l.3376+) — R2's paid/unpaid partition + the paid refund.
  - `settleAvailableCreditAgainstOpenReceivablesWithClient` (l.2606) — the sweep (unchanged).
- `src/modules/order-commits/order-commit-execution.service.ts` — R2's reversal split (~l.958) +
  post-emission sweep (~l.1020).
- `src/modules/financial/invariants.ts` — `refund-source-is-final-or-adjustment` (l.743),
  `refund-amount-not-over-source` (l.665), `refund-trace-points-to-inbound-payment` (l.714),
  `out-payment-targets-refund-invoice` (l.641).
- Decision records `003-refund-traceability.md` (nullable `refundOfPaymentId`) and
  `002-direction-out-requires-refund-invoice.md`.

## The mechanism (recommended — flag for review)

The refund must (a) cap the refund at the credit note's drawable balance and (b) reduce that
balance so the **sweep cannot re-draw refunded value**. The cleanest shape mirrors the existing
overpayment mechanism (where REFUND children reduce `computeOverpaymentCapacity` via
`parentInvoiceId`):

- **REFUND invoice parents to the credit note** (`parentInvoiceId = creditNote.id`) for the
  reversal channel. The OUT payment closes the REFUND invoice exactly as today.
- **`computeCreditNoteAvailable` is extended to also subtract REFUND children** parented to the
  credit note (an **aggregate** `_sum` over `parentInvoiceId = CN`, so *N* partial refunds are
  natively summed — no first/final-refund special case):
  `available = totalAmount − Σ source applications − Σ (REFUND children).totalAmount`.
  This single change makes the drawable pool the *single source of truth* for "value not yet
  spent as settlement or refund," so the sweep automatically excludes refunded value — no
  double-spend.
- **Capacity for a credit-note-sourced refund = `computeCreditNoteAvailable(CN)`** (post-sweep),
  not `computeOverpaymentCapacity`.
- **Atomicity (multiple partial refunds / concurrency guard).** The credit-note refund path must
  **lock the credit-note row (`FOR UPDATE`) and recompute `computeCreditNoteAvailable` inside the
  same transaction** before applying the cap — mirroring `appendCreditApplicationWithClient`'s
  lock when the sweep draws the pool (invoice.service ~l.2687). The model supports any number of
  partial refunds interleaved with settlements over time; the identity
  `total = Σsettlements + Σrefunds + drawable` is order-independent, but the cap must be evaluated
  against committed state so two concurrent draws cannot both pass a stale check.
- `refundOfPaymentId = null` (locked decision #2) — the value is sourced from the credit-note
  balance, not a specific prior IN payment.

Rejected alternative (consume CN balance via a `SETTLEMENT` application onto the REFUND invoice):
double-counts the REFUND invoice's effective-paid (OUT payment **and** document application both
fund the same total) and forces an INV-09 carve-out for REFUND targets. Parenting to the CN +
netting REFUND children reuses the proven overpayment mechanics and touches less.

## Rules

- **All adjustment-reversal value is drawable.** Both emission paths stop the `requiresRefund`
  split and stop emitting `CAUSE_REVERSAL`; every reversal becomes a drawable `REVERSAL` note
  (origin + `reversesInvoiceLineId` from R0). `isPaid` is retained only to drive the **refund
  decision**, not the emission shape.
- **Settle before refund.** The sweep runs first (already does, both paths). Only the credit
  note's **post-sweep** drawable balance is refundable.
- **Refund only paid-origin value.** A reversal of a **paid** line refunds its remaining drawable
  balance from the credit note. A reversal of an **unpaid** line is never auto-refunded — its
  leftover stays drawable for future receivables (worked case 2).
- **Reversal value never manufactures invoice overpayment** — the property R2 established for the
  unpaid path now holds for the paid path too.
- **Genuine cash overpayment is untouched** — `computeOverpaymentCapacity` and the FINAL/ADJ
  refund path keep working for "customer paid more than the invoice."

## Scope

### In Scope

- **Unify reversal emission.** In `applyAdjustmentReversalsWithClient` and the OrderCommit reversal
  emission, drop the paid/unpaid partition: emit a single drawable `REVERSAL` credit note per
  parent adjustment invoice (no `CAUSE_REVERSAL`, no line-targeted application). Carry the paid
  amount forward for the refund step.
- **Extend `computeCreditNoteAvailable`** to subtract REFUND children parented to the credit note
  (see mechanism). This is the one change to a previously-frozen function; it is additive
  (subtracts a term that is zero for every credit note today).
- **Add a credit-note-balance refund path** in `refund.service.ts`:
  - Allow a **CREDIT_NOTE** source whose `creditOrigin ∈ {REVERSAL, REMOVAL}` (locked + same case).
  - Cap the refund at `computeCreditNoteAvailable(CN)` (post-sweep).
  - Parent the REFUND invoice to the CN; OUT payment as today; `refundOfPaymentId = null`.
  - Keep the existing FINAL/ADJ overpayment refund path as a separate branch, unchanged.
- **Drive the refund** after the sweep: for each paid-origin reversal credit note, if drawable
  balance remains, issue the credit-note-balance refund for that remainder (capped at the paid
  amount). Run on both the direct edit path and OrderCommit, after the post-emission sweep.
- **Invariant updates:**
  - `refund-source-is-final-or-adjustment` → also allow a **CREDIT_NOTE** parent when its
    `creditOrigin ∈ {REVERSAL, REMOVAL}`.
  - `refund-amount-not-over-source` → for a CREDIT_NOTE source, assert the **conservation
    identity directly**: `computeCreditNoteAvailable(CN) ≥ 0`, i.e.
    `Σ settlements + Σ refunds ≤ total`. (This is stronger than "refund total ≤ CN total," which
    ignores settlements — the example showed the weaker form would let settlements + refunds
    exceed the total.) Inbound payment allocations are zero on a credit note, so that branch does
    not apply. Keep the FINAL/ADJ branch as-is.
  - `refund-trace-points-to-inbound-payment` → **unchanged** (it only checks non-null
    `refundOfPaymentId`; the null-linked reversal refund passes as written — verify with a test).
  - Regenerate the invariant catalog; check `reconciliation-invariants.ts` for any refund-source
    reconciliation rule that also needs the CREDIT_NOTE allowance.

### Out of Scope

- **Retiring the `CAUSE_REVERSAL` / `CREDIT_TO_FINAL` enum values** (**R4**). R3 stops *emitting*
  `CAUSE_REVERSAL`; the enum value and any historical handling are removed in R4.
- **`CREDIT_TO_FINAL` / FINAL removal credit** behavior (**R4**).
- **Genuine cash overpayment** behavior — unchanged.
- Any read-layer / receipt / register change.

## Implementation Direction

1. Extend `computeCreditNoteAvailable` to net REFUND children (additive term). Add focused unit
   coverage that it equals today's value when no REFUND child exists.
2. Collapse the reversal emission in both paths to a single drawable `REVERSAL` note; delete the
   `CAUSE_REVERSAL` emission branch and the immediate `computeOverpaymentCapacity` refund for
   paid reversals. Thread the paid amount to the refund step.
3. Add the credit-note source branch to `createRefundInvoice` / `issueRefundWithPaymentWithClient`
   (source CREDIT_NOTE + origin gate + drawable-balance cap + CN parent + null trace).
4. After the post-emission sweep, issue the credit-note-balance refund for paid-origin leftover on
   both paths.
5. Update the two invariants + catalog; confirm reconciliation rules.
6. Do **not** touch `computeOverpaymentCapacity`, the sweep body, the deposit/payment paths, or
   the genuine-overpayment refund branch.

## Observability Checklist

### Rollback Plan
- Code-only revert (no schema change): restore R2's paid/unpaid partition + `CAUSE_REVERSAL`
  emission + overpayment refund, revert `computeCreditNoteAvailable` and the two invariants.
- Non-recoverable data: none (forward-only dev data, locked decision #1).

### Customer-Visible Surface
- A fully-paid order that is later downgraded with nothing re-added now shows the refund sourced
  from the reversal credit note, with **no** phantom overpayment on the original invoice. Same
  cash to the customer, origin-correct channel (worked case 4).

## Post-Implementation
- Update the decision doc §7: mark R3 done — both reversal channels now origin-correct;
  `CAUSE_REVERSAL` no longer emitted anywhere; **R4 (enum retirement) unblocked.**
- Update `context/progress-tracker.md`: paid-reversal refund now drawn from credit-note balance;
  reversal value never manufactures overpayment; only R4 cleanup remains.

## Acceptance Criteria

- **Worked case 4:** order paid in full, then a downgrade with nothing re-added → a `REVERSAL`
  credit note holds the value, the sweep finds no open receivable, and the leftover is refunded
  from the credit note (REFUND parented to the CN, `refundOfPaymentId = null`). **No** manufactured
  overpayment on the original invoice; the case nets to zero owed/zero overpaid.
- **Worked case 2:** downgrade settles an open receivable first; the remainder stays **drawable**
  (no refund) and a later upgrade settles from it. (Unpaid-origin leftover is never auto-refunded.)
- **Paid reversal with a partial open receivable:** the sweep settles the receivable, and only the
  post-sweep remainder is refunded from the credit note — no double-spend (the refunded balance is
  not re-drawn by a subsequent sweep, proving the `computeCreditNoteAvailable` change).
- **Multiple partial refunds interleaved with settlements:** a single credit note can take several
  partial refunds over time, interleaved with settlements, and the conservation identity
  `total = Σsettlements + Σrefunds + drawable` holds at every step; each draw is capped at the live
  drawable (a draw exceeding it is rejected), and `computeCreditNoteAvailable(CN) ≥ 0` always.
- **Concurrency:** two refunds racing on the same credit note cannot over-draw — the second
  serializes behind the first's `FOR UPDATE` lock and is capped against committed state.
- **No `CAUSE_REVERSAL` is emitted** by any path (assert zero new `CAUSE_REVERSAL` applications
  across the reversal tests) — the precondition for R4.
- **Genuine cash overpayment** still refunds via `computeOverpaymentCapacity` on the FINAL/ADJ,
  unchanged.
- **Invariants:** `refund-source-is-final-or-adjustment` (loosened), `refund-amount-not-over-source`
  (CN branch), `refund-trace-points-to-inbound-payment` (unchanged, passes on null trace), the R1
  credit invariants, and the full financial + OrderCommit + reconciliation suite are green.
- `npm run build` and `npm run lint` pass.
