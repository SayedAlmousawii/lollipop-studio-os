# 162 · R3 — Reversal Refund Channel (drawable credit carried until staff refund; no auto-refund)

> Plan label **R3** (reversal-credit model phase); repo number **162** is provisional.
> Fourth spec of the phase in
> `context/reviews/reversal-credit-and-refund-model-decision.md` (model **C′ + Option 1**, §3/§5).
> **Behavioral, backend/service/invariant-only.** Depends on **R0 (159)**, **R1 (160)**,
> **R2 (161)** merged. After R3, **no path emits `CAUSE_REVERSAL`** — which unblocks R4.

## Goal

Make **all** adjustment-reversal value drawable settlement-capable credit (the paid path joins the
unpaid path from R2), stop the last `CAUSE_REVERSAL` emission, and remove the manufactured-overpayment
refund entirely. Reversal value is **carried as drawable credit indefinitely** — it settles open
receivables now and in the future via the existing sweep — and is **refunded only when staff
explicitly decide**, drawing from the credit note's drawable balance. R3 builds the *capability and
the conservation guarantees*; it issues **no** REFUND invoices or OUT payments automatically.

## Why no auto-refund (the correcting principle)

An automatic post-sweep refund of "leftover" re-introduces stranding. Worked case 2:

```
downgrade → 100 drawable credit
60 settles the open ADJ
40 carried as drawable credit
later a +40 charge appears → the 40 settles it → no stranding, no refund
```

If R3 auto-refunded the 40 right after the sweep, the later +40 charge would have nothing to draw
and would strand (or force the customer to pay again) — the exact failure that killed variant C,
relocated. The system cannot know at downgrade time whether a future charge is coming, so leftover
value **must carry** as drawable credit. A refund is a deliberate staff decision (worked case 4 =
"nothing more is coming, refund the carried balance"), **not** an automatic step on commit/edit.

## What R2 left, and what R3 changes

R2 split adjustment reversals by `requiresRefund` (= `adjustmentLine.isPaid`): unpaid → drawable
`REVERSAL` note (swept); **paid → still a line-targeted `CAUSE_REVERSAL` note that manufactures
overpayment + an immediate inline refund** (direct path) or a `refundPending` flag (OrderCommit).
R3 removes that paid-path special case entirely: paid reversals become drawable `REVERSAL` notes
too, no `CAUSE_REVERSAL`, and **no automatic refund** on either path.

## Read First

- `context/reviews/reversal-credit-and-refund-model-decision.md` — §3 (refund source = the credit
  note's unapplied balance), §5 worked cases **2 and 4**, §7 (R3 row; locked decision #2:
  goodwill-style **null** `refundOfPaymentId` for credit-note-sourced refunds).
- `src/modules/invoices/invoice.service.ts`:
  - `applyAdjustmentReversalsWithClient` (l.3376+) — R2's paid/unpaid split + the inline paid refund
    (`issueRefundWithPayment`, ~l.3358) that R3 **removes**.
  - `computeCreditNoteAvailable` (l.2534) — `total − Σ source applications`; **does NOT net REFUND
    children today** (R3 change).
  - `computeOverpaymentCapacity` (l.2494) — `max(effectivePaid − total − Σ REFUND children, 0)`;
    REFUND children reduce capacity via `parentInvoiceId`, not via any application. **Untouched.**
  - `appendCreditApplicationWithClient` (~l.2687) — the `FOR UPDATE` lock pattern to mirror.
- `src/modules/order-commits/order-commit-execution.service.ts` — R2's reversal split (~l.958),
  post-emission sweep (~l.1020), `refundPending` flag (~l.1054).
- `src/modules/refunds/refund.service.ts` — `createRefundInvoice` / `issueRefundWithPaymentWithClient`:
  source must be FINAL/ADJ + locked (l.178–186); capacity = `computeOverpaymentCapacity` (l.188);
  REFUND `parentInvoiceId = source.id` (l.206). R3 adds a CREDIT_NOTE source branch.
- `src/modules/financial/invariants.ts` — `refund-source-is-final-or-adjustment` (l.743),
  `refund-amount-not-over-source` (l.665), `refund-trace-points-to-inbound-payment` (l.714).

## The refund mechanism (built now, triggered later)

The credit-note refund branch is implemented and unit-tested in R3 but has **no production caller**
yet — neither auto-issued nor UI-exposed. The staff trigger (and the cash-refund-eligibility policy,
see Out of Scope) lands in a follow-up. The mechanism, when invoked:

- **REFUND invoice parents to the credit note** (`parentInvoiceId = creditNote.id`); the OUT payment
  closes it exactly as the FINAL/ADJ path does. The CN→REFUND link is `parentInvoiceId` only — **not**
  a document application — so the REFUND invoice is settled solely by its OUT payment (no double count).
- **`computeCreditNoteAvailable` is extended** to also subtract REFUND children parented to the CN,
  as an aggregate `_sum` over `parentInvoiceId = CN`:
  `available = totalAmount − Σ source applications − Σ (REFUND children).totalAmount`.
  This makes the drawable pool the single source of truth for "value not yet spent as settlement or
  refund," so the sweep can never re-draw refunded value (no double-spend), and N partial refunds are
  natively summed.
- **Cap = `computeCreditNoteAvailable(CN)`**, recomputed under a **`FOR UPDATE` lock on the credit-note
  row inside the transaction**, so multiple partial refunds / concurrent draws cannot over-draw against
  stale state. Conservation `total = Σsettlements + Σrefunds + drawable` holds for any interleaving.
- `refundOfPaymentId = null` (locked decision #2).

## Rules

- **All adjustment-reversal value is drawable.** Both paths emit drawable `REVERSAL` notes (origin +
  `reversesInvoiceLineId` from R0); **no `CAUSE_REVERSAL`** is emitted anywhere after R3.
- **No automatic refund.** Neither the direct edit path nor OrderCommit creates a REFUND invoice or
  an OUT payment. The direct path's existing inline `issueRefundWithPayment` call is **removed**.
- **Leftover carries indefinitely.** After the sweep settles open receivables, the remaining drawable
  balance stays on the credit note, available to settle future receivables (preserve case 2).
- **Reversal value never manufactures invoice overpayment** — now true on the paid path too.
- **Genuine cash overpayment is untouched** — `computeOverpaymentCapacity` and the FINAL/ADJ refund
  path keep working for "customer paid more than the invoice."
- **`requiresRefund` / `isPaid` no longer drives emission or refund** in R3. Leave the signal in place
  (the follow-up trigger uses it for cash-refund eligibility); do not key any R3 behavior on it.

## Scope

### In Scope (backend / service / invariant only)

- **Unify reversal emission** in `applyAdjustmentReversalsWithClient` and the OrderCommit reversal
  emission: emit a drawable `REVERSAL` credit note per parent adjustment invoice (origin REVERSAL +
  `reversesInvoiceLineId`, unapplied, no line-targeted application). Remove the paid-branch
  `CAUSE_REVERSAL` emission **and** the direct path's inline refund. Leave the sweep call in place
  on both paths (settles receivables; leftover carries).
- **Extend `computeCreditNoteAvailable`** to net REFUND children parented to the CN (additive term;
  equals today's value when no REFUND child exists).
- **Add a CREDIT_NOTE refund-source branch** to `refund.service.ts` (dormant — tests only in R3):
  allow a locked, same-case `CREDIT_NOTE` source whose `creditOrigin ∈ {REVERSAL, REMOVAL}`; lock the
  CN row `FOR UPDATE` and recompute drawable in-txn; cap at `computeCreditNoteAvailable(CN)`; parent
  the REFUND invoice to the CN; `refundOfPaymentId = null`. Keep the FINAL/ADJ overpayment branch and
  its error messages unchanged.
- **Invariant updates:**
  - `refund-source-is-final-or-adjustment` → also allow a CREDIT_NOTE parent whose
    `creditOrigin ∈ {REVERSAL, REMOVAL}`.
  - `refund-amount-not-over-source` → for a CREDIT_NOTE source, assert the conservation identity
    **`computeCreditNoteAvailable(CN) ≥ 0`** (`Σsettlements + Σrefunds ≤ total`), not the weaker
    "refund ≤ CN total." Keep the FINAL/ADJ inbound-payment branch as-is.
  - `refund-trace-points-to-inbound-payment` → **unchanged** (only checks non-null
    `refundOfPaymentId`; the null-linked CN refund passes — add a test proving it).
  - **`paid-adjustment-line-removal-must-have-reversal` → match provenance by line-item cause,
    not the single CN-level FK.** R3 stops emitting line-targeted `CAUSE_REVERSAL`, so this
    invariant must read reversal provenance from the drawable note instead. Emission stays **one
    drawable `REVERSAL` note per parent adjustment invoice**, listing every reversal as a line item
    (each line item already carries `causeOrderEntityKind/Id` copied from the reversed line). For a
    removed paid line with cause `(K, I)`, sum the line items on REVERSAL-origin credit notes in the
    same order whose cause matches `(K, I)` and assert `≥ lineTotal`. Do **not** rely on the
    CN-level `reversesInvoiceLineId` (a single anchor that only covers one line of a multi-line
    note — using it fails the 2nd+ removed line on a shared invoice). `reversesInvoiceLineId` stays
    as a representative anchor for `valid-credit-origin` only.
  - Regenerate the catalog; check `reconciliation-invariants.ts` for any refund-source rule that
    rejects a CN-parented REFUND and adjust only if needed.

### Out of Scope

- **The refund trigger** — neither auto-issue nor UI. Exposing "refund from credit note" to staff
  (surfacing the CN as a refundable source with its drawable balance and the cash-refund-eligibility
  cap) is a **follow-up spec**. Include here only the *tiny* read-layer glue strictly required for a
  test, if any — otherwise none.
- **Cash-refund eligibility (paid-origin cap).** A credit note's drawable balance is fungible for
  *settlement*, but only value the customer actually **paid** should be refundable as **cash**
  (unpaid-origin reversal credit is settlement-only — refunding it hands back money never received).
  R3 does not expose a refund trigger, so this is not yet reachable; the follow-up that adds the
  trigger **must** enforce it (derive paid-origin from the reversed line(s)' paid state, or a marker
  it introduces). Documented here so it is not lost.
- **Retiring `CAUSE_REVERSAL` / `CREDIT_TO_FINAL` enum values** (**R4**) — R3 only stops emitting
  `CAUSE_REVERSAL`.
- **Genuine cash overpayment** behavior — unchanged.

## Implementation Direction

1. Extend `computeCreditNoteAvailable` to net REFUND children; unit-test equality with today when no
   REFUND child exists.
2. In both emission paths, emit drawable `REVERSAL` notes for all reversals; delete the
   `CAUSE_REVERSAL` branch and the direct-path inline `issueRefundWithPayment`. Keep the sweep calls.
3. Add the dormant CREDIT_NOTE refund branch to `refund.service.ts` (lock + recompute + cap + CN
   parent + null trace).
4. Update the two invariants + catalog; confirm reconciliation rules.
5. Do **not** touch `computeOverpaymentCapacity`, the sweep body, the deposit/payment paths, or the
   genuine-overpayment refund branch. Do **not** add an auto-refund call anywhere.

## Observability Checklist

### Rollback Plan
- Code-only revert (no schema change): restore R2's paid/unpaid split + `CAUSE_REVERSAL` emission +
  the inline refund; revert `computeCreditNoteAvailable` and the two invariants.
- Non-recoverable data: none (forward-only dev data, locked decision #1).

### Customer-Visible Surface
- None in R3. A paid downgrade now leaves carried drawable credit instead of an automatic refund; the
  staff-facing refund-from-credit-note action arrives with the follow-up.

## Post-Implementation
- Update the decision doc §7: R3 done — all reversal value carried as drawable credit; `CAUSE_REVERSAL`
  no longer emitted; **R4 unblocked**. Note the deferred refund-trigger + paid-origin-eligibility follow-up.
- Update `context/progress-tracker.md`: paid reversals now carry drawable credit (no auto-refund, no
  manufactured overpayment); credit-note refund capability exists but is not yet triggered.

## Acceptance Criteria

- **No auto-refund:** committing an edit / OrderCommit that reverses a **paid** adjustment line creates
  a drawable `REVERSAL` credit note and **no** REFUND invoice and **no** OUT payment. The direct path's
  inline refund is gone.
- **No `CAUSE_REVERSAL`** is emitted by any path (assert zero new `CAUSE_REVERSAL` applications across
  the reversal tests) — the precondition for R4.
- **Carry + future settlement (case 2):** a downgrade settles the open receivable, the remainder stays
  drawable, and a later charge settles from it — no stranding, no refund.
- **Multi-line removal on one invoice:** removing **two** cause-attributed paid lines from the **same**
  ADJ invoice in one edit emits one drawable `REVERSAL` note with both as line items, and
  `paid-adjustment-line-removal-must-have-reversal` passes for **both** lines (provenance matched by
  cause, not the single CN-level anchor).
- **`computeCreditNoteAvailable`** equals today's value with no REFUND child, and subtracts REFUND
  children when present (unit-tested).
- **Refund capability (service-level test, not a production trigger):** calling the CREDIT_NOTE refund
  branch directly draws from drawable balance, parents the REFUND to the CN, sets `refundOfPaymentId =
  null`, and — across multiple partial refunds interleaved with settlements — upholds
  `total = Σsettlements + Σrefunds + drawable` at each step, rejects an over-cap draw, and a later sweep
  does **not** re-draw the refunded balance.
- **Invariants:** `refund-source-is-final-or-adjustment` (loosened), `refund-amount-not-over-source`
  (CN `drawable ≥ 0` branch), `refund-trace-points-to-inbound-payment` (unchanged, passes on null
  trace), the R1 credit invariants, and the full financial + OrderCommit + reconciliation suite green.
- **Genuine cash overpayment** still refunds via `computeOverpaymentCapacity` on the FINAL/ADJ, unchanged.
- `npm run build` and `npm run lint` pass.
