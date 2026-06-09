# 164 · Reversal Refund Trigger (staff-initiated credit-note refund + paid-origin cash-eligibility cap)

> Follow-up to the reversal-credit phase (R0–R4, model **C′ + Option 1**). **Not** part of R0–R4.
> Depends on R3 (Spec 162), which built the credit-note refund *service branch* but left it
> **dormant** (no production caller, no UI), and R4 (Spec 163).
> **Behavioral** — activates the dormant capability and adds the cash-eligibility guard.

## Goal

Let staff issue a refund **from a reversal/removal credit note's drawable balance** through the
existing manual refund flow, and cap that refund at the **cash the customer actually overpaid** so
the business never refunds value the customer never paid (unpaid-origin reversal credit is
settlement-only, not cash-refundable). The model decision (C′) already says reversal value is
*refundable when staff decide*; R3 carried the value and built the service branch — this spec
exposes the trigger and adds the eligibility ceiling.

## Background (what R3 left)

- `createRefundInvoice` / `issueRefundWithPaymentWithClient` already accept a `CREDIT_NOTE` source
  with `creditOrigin ∈ {REVERSAL, REMOVAL}`, lock the CN row, cap at `computeCreditNoteAvailable(CN)`,
  parent the REFUND to the CN, and force `refundOfPaymentId = null`.
- `issueRefundAction` (app/invoices/actions.ts) is **already generic** — it takes a `sourceInvoiceId`
  and calls `issueRefundWithPayment`, so it works for a CN source the moment the form is rendered on
  a CN invoice with the CN's id.
- **Missing:** (1) the UI never surfaces a CN as a refundable source, and (2) the only cap today is
  the CN's drawable balance — there is **no paid-origin eligibility cap**, so a direct call could
  refund unpaid-origin credit as cash.

## The eligibility cap (the load-bearing design point)

Refundable-as-cash from a reversal CN must be bounded by the **case-level net cash overpayment** —
what the customer paid in cash beyond what they still owe:

```
caseNetCashOverpayment =
  max( Σ IN payment allocations (case)
       − Σ OUT payment allocations (case)
       − Σ remaining owed on open FINAL/ADJ charge invoices (case),
       0 )

creditNoteRefundable(CN) = min( computeCreditNoteAvailable(CN), caseNetCashOverpayment )
```

**Critical: use actual payment allocations (cash), NOT `computeEffectivePaidFromAllocations`.**
Effective-paid includes `SETTLEMENT` document applications — i.e. credit the CN itself applied — so
using it would let reversal credit masquerade as cash and defeat the whole guard. The cap is about
*cash in vs cash out vs cash owed*, full stop.

Why this is correct without per-line paid-origin tracking:
- **Unpaid-origin reversal** (customer never paid the reversed line): cash-in is low, so
  `caseNetCashOverpayment` is ~0 → refundable ~0. The credit stays drawable for future settlement,
  never cash. ✓
- **Paid-origin reversal** (customer paid, now reversed, nothing left to settle): cash-in exceeds
  what's owed by exactly the reversed amount → refundable up to the CN drawable. ✓
- **Cross-channel safety:** every refund (this channel *and* the genuine-overpayment FINAL/ADJ
  channel) records an OUT payment that reduces `caseNetCashOverpayment` on the next computation, so
  the two channels can never collectively refund more than the customer overpaid. Recompute under
  the same transaction lock before capping.

(Considered and rejected: tracking a per-CN "paid-origin amount." It needs a schema marker or
per-line paid state that R3 deliberately didn't add; the case-cash ceiling is computable from
existing data and is the true financial bound.)

## Read First

- `context/reviews/reversal-credit-and-refund-model-decision.md` §3 (two-channel model; reversal
  value refundable from CN balance), §5 worked cases 2 & 4, locked decision #2 (null trace).
- `src/modules/refunds/refund.service.ts` — `createRefundInvoice` CN branch +
  `computeCreditNoteRefundCapacity` (R3); this is where the eligibility cap is added.
- `src/modules/invoices/invoice.service.ts` — the invoice-view builder (~l.905–960:
  `overpaymentCapacity`, `creditNoteCapacity` fields) where a `creditNoteRefundable` field is added;
  `computeCreditNoteAvailable`; `computeOverpaymentCapacity` (cash-overpayment reference shape).
- `app/invoices/[id]/page.tsx` + `src/components/invoices/refund-invoice-form.tsx` +
  `src/lib/invoices/refund-utils.ts` (`shouldShowRefundForm`) + `app/invoices/actions.ts`
  (`issueRefundAction`) — the manual refund UI flow to extend to CN invoices.
- `src/modules/financial-cases/financial-case-summary.service.ts` — case-level aggregation patterns
  (`computeCaseEffectivePaid`) to mirror for the cash-based case totals.

## Rules

- **Cash-based eligibility.** The cap uses payment allocations (IN/OUT), never effective-paid.
- **Settle before refund still holds.** The sweep already runs on commit/edit; this spec doesn't
  auto-refund — staff initiate it. Leftover stays drawable until they do.
- **Conservation preserved.** A CN refund is an OUT payment + REFUND parented to the CN;
  `computeCreditNoteAvailable` already nets REFUND children (R3), so `drawable ≥ 0` holds and the
  sweep can't re-draw refunded value.
- **No change to the genuine cash-overpayment channel** beyond it sharing the same case ceiling.
- `refundOfPaymentId = null` for CN-sourced refunds (locked decision #2).

## Scope

### In Scope

- **Eligibility cap in the service.** Extend `computeCreditNoteRefundCapacity` (or its caller) to
  return `min(computeCreditNoteAvailable(CN), caseNetCashOverpayment)`, computed under the existing
  CN row lock. Add a `caseNetCashOverpayment` helper (cash allocations − owed; **not** effective-paid).
- **Read-layer field.** Add `creditNoteRefundable: string | null` to the invoice view for a locked
  `CREDIT_NOTE` with `creditOrigin ∈ {REVERSAL, REMOVAL}`, equal to the same capped value
  (formatted money). Null for all other invoices.
- **UI trigger.** On the invoice detail page, render the refund form for a refundable CN (gate via a
  `shouldShowRefundForm(creditNoteRefundable)`-style check), wired to the existing
  `issueRefundAction` with the CN's id. Reuse `RefundInvoiceForm`; label it as a credit-note refund
  and show the refundable balance. Respect the existing `REFUND_ISSUE` permission.
- **Tests** (below).

### Out of Scope

- Auto-refunding anything (the model is staff-initiated; carry remains the default).
- Changing the carry/settle/emission model (R2/R3/R4 done) or the genuine-overpayment computation.
- Receipt/register presentation changes.
- Any new schema/migration (cap is derived from existing data).

## Implementation Direction

1. Add `caseNetCashOverpayment(financialCaseId, client)` = `max(Σ IN allocations − Σ OUT allocations
   − Σ open FINAL/ADJ remaining, 0)`, using payment allocations (cash), not effective-paid.
2. In the refund service CN branch, cap at `min(computeCreditNoteAvailable(CN), caseNetCashOverpayment)`
   under the existing `FOR UPDATE` lock; reuse the over-cap error path with a clear message.
3. Add `creditNoteRefundable` to the invoice-view builder for eligible CNs (same capped value).
4. Render the refund form on the CN invoice page gated on `creditNoteRefundable > 0`; wire to
   `issueRefundAction`.
5. Tests + (optional) a reconciliation guard that case OUT refunds never exceed case cash overpayment.

## Observability Checklist

### Rollback Plan
- Code-only (no schema). Revert = remove the UI trigger, the read field, and the eligibility cap;
  the R3 CN refund branch returns to dormant. No data migration.

### Customer-Visible Surface
- Staff gain a "refund from credit note" action on eligible reversal/removal credit notes, showing
  the refundable balance. No customer-facing receipt change.

## Acceptance Criteria

- **Worked case 4 (paid, fully reversed, nothing owed):** the CN shows a refundable balance equal to
  its drawable, staff issue the refund, REFUND parents to the CN, `refundOfPaymentId = null`, and the
  case nets to zero — no manufactured overpayment.
- **Unpaid-origin reversal:** `creditNoteRefundable = 0` even though the CN has drawable balance
  (cash overpayment is 0) — the credit can still settle future receivables but cannot be cashed out.
- **Partial:** a paid reversal whose credit partly settled an open receivable exposes only the
  post-sweep remainder as refundable, capped further by case cash overpayment.
- **Cross-channel:** issuing a genuine-overpayment refund and a CN refund in the same case cannot
  collectively exceed the case cash overpayment (each recomputes the ceiling under lock; total OUT ≤
  cash in − owed).
- **Over-cap rejected:** a direct refund above `creditNoteRefundable` throws.
- **Eligibility uses cash, not effective-paid:** a test where a CN has settled an ADJ (inflating
  effective-paid) proves the cap does NOT treat that settlement as cash.
- Genuine cash-overpayment refunds via FINAL/ADJ unchanged; R1 credit invariants, refund invariants,
  and the full financial + OrderCommit + reconciliation suite green.
- `npm run build` and `npm run lint` pass.
