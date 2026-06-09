# 157 · B2C — Overpayment-Backed Available Credit (B2 correction)

> Plan label **B2C** (settlement arc correction); repo number **157** is provisional.
> **Implementation order: this spec ships BEFORE 156 · B3**, despite the higher number —
> B3's draft `amountDueAfterCommit` consumes the corrected preview produced here.
> Depends on **153 · F1**, **154 · B1**, **155 · B2** (all merged).
> See `context/reviews/credit-settlement-application-plan.md` — locked decisions **#10**
> (overpayment-backed spendable credit) and **#11** (financial-owned customer summary).

## Goal

Correct the adding-side credit basis shipped in Spec 155 B2. B2 consumes the **raw
unapplied credit-note pool** (`availableCaseCredit = Σ total − Σ applications`) as spendable
credit in `positiveDeltaPreview`. Per locked decision #10 that is wrong: the unapplied pool
is the *document representation* of reductions, not spendable money. A removal on an
**unpaid** order should reduce the bill, not mint phantom credit that zero-outs a later
addition — doing so **double-counts the same reduction and under-collects**.

This spec repoints the adding-side preview onto **overpayment-backed** available credit
(`max(cashPaid − netCustomerTotal, 0)`) and onto a **net (model-A) remaining**, both sourced
from a new **financial-owned customer-settlement core** in `src/modules/financial-cases/`.
That core is the single source of truth that Spec 156 B3 will also render. No change to
emission, the settlement sweep, document balances, or financial math.

## The bug, concretely

FINAL 250, **paid 0**. Commit 1 removes 50 → credit note 50, unapplied (no open ADJUSTMENT
to settle against; the sweep never touches FINAL). `availableCaseCredit = 50`.
Commit 2 adds +30:

- **B2 today:** `amountDue = max(netDelta − availableCaseCredit, 0) = max(30 − 50, 0) = 0`
  → staff are told to collect nothing; the +30 walks out uncovered.
- **Correct:** before the add the customer owes 200 (net 200, paid 0); after it they owe
  **230**. The increment is +30, so `amountDue = 30`. The removal's 50 already did its job
  (250 → 200); it must not also pay for the add.

The customer is **not** overpaid (`cashPaid 0 < netCustomerTotal 200`), so there is **no
spendable credit**. `overpaymentBackedCredit = max(0 − 200, 0) = 0` ⇒ `amountDue = 30`. ✓

## Read First

- `context/reviews/credit-settlement-application-plan.md` — decisions #10, #11; §6.1.
- `src/modules/order-commits/order-commit-approval-document-preview.service.ts` —
  `positiveDeltaPreview` (consumes `paymentState.availableCaseCredit` and
  `currentRemainingAmount`); `OrderCommitPreviewPaymentState`.
- `src/modules/order-commits/order-commit-preview.service.ts` +
  `order-commit-execution.service.ts` — `paymentStateFromFinancialCaseSummary` /
  `loadOrderCommitPreviewFinancialState` (map summary → payment state).
- `src/modules/financial-cases/financial-case-summary.service.ts` — `customerTotal`
  (gross), `effectivePaid` (cash + applied credit), `remaining` (document open balances),
  `availableCaseCredit` (raw pool, B2).
- `src/modules/financial-cases/projections/to-orders-table-row.ts` /
  `to-order-header-financial.ts` — the **already-duplicated** `getNetCustomerTotal`
  (`customerTotal − Σ creditNote.total`); consolidate into the new core.

## Rules

- **Decision #10 is the law.** Spendable/available credit = `max(cashPaid − netCustomerTotal,
  0)`. Never the raw unapplied pool.
- **Financial module owns the meaning (decision #11).** The net figures are computed in
  `src/modules/financial-cases/`, not in the OrderCommit/Sales projector. The preview
  *consumes* them.
- **B1 unchanged.** Removing-side settlement and the shared end-of-commit sweep
  (`settleAvailableCreditAgainstOpenReceivables`) are **not** touched. Document-level
  netting of additions against removals stays correct. This spec changes only what the
  **adding-side preview** treats as spendable.
- **No financial math / no document change.** `netDelta`, order value, emission,
  applications, `computeEffectivePaidFromAllocations` all unchanged. This corrects a
  *preview interpretation*, not money movement.
- **Net (model-A) figures for the preview baseline.** The preview's "remaining" baseline
  must be `remainingDue = max(netCustomerTotal − cashPaid, 0)`, not `summary.remaining`
  (which overstates by any unapplied credit that can't land on FINAL).

## Scope

### In Scope

- **Financial-owned customer-settlement core** in `src/modules/financial-cases/` (e.g.
  `computeCustomerSettlement({ financialCaseId }) → { netCustomerTotal, cashPaid,
  remainingDue, availableCredit }`), derived from existing `FinancialCaseSummary` values:
  - `netCustomerTotal = max(customerTotal − Σ creditNote.total, 0)` (consolidates the two
    duplicated `getNetCustomerTotal` helpers — have them call this).
  - `cashPaid = net cash received` (payments − refunds; i.e. `effectivePaid − creditsApplied`,
    where `creditsApplied = Σ creditNote.total − availableCaseCredit`). Pick the cleanest
    derivation; the definition is "cash actually received, excluding applied credit".
  - `remainingDue = max(netCustomerTotal − cashPaid, 0)`.
  - `availableCredit = max(cashPaid − netCustomerTotal, 0)` (overpayment-backed; decision #10).
- **Repoint the adding-side preview.** Replace `OrderCommitPreviewPaymentState`'s
  `availableCaseCredit` (raw pool) usage in `positiveDeltaPreview` with the overpayment-backed
  `availableCredit`, and use `remainingDue` (net) as `currentRemainingAmount`:
  - `consumedCredit = min(netDelta, availableCredit)`
  - `amountDue = netDelta − consumedCredit`
  - `remainingAfterCommit = remainingDue + netDelta − consumedCredit`
  - keep `documentPlan.amount = netDelta`; `requiresPaymentCollection = amountDue > 0`;
    `NONE` impact kind when `amountDue = 0`.
  - Gating to `EMIT_ADJUSTMENT` (from the B2 fix) stays.
- **Payment-state plumbing.** Map the new fields through
  `loadOrderCommitPreviewFinancialState` (preview) and `paymentStateFromFinancialCaseSummary`
  (execution); booking-stage → `0`.
- Update the B2 preview/guard tests to the corrected basis (see Test Plan).

### Out of Scope

- The receipt-style **customer-settlement summary contract** and the Sales repoint — that is
  **156 · B3**, built on this core.
- The shared settlement **sweep** and any document-level behavior (B1). Untouched.
- The **document-overhang** when unapplied credit can't land on FINAL (document open-balance
  > model-A remaining): a known accounting-detail limitation surfaced in the register plan,
  not here. The receipt is correct via model-A regardless.
- Removing-side / reduction preview path. Unchanged.
- Customer-wide credit (decision #4). Refund flow. UI/copy.

## Implementation Direction

1. **Add the financial-owned core** `computeCustomerSettlement` in `financial-cases`
   returning the four model-A figures above. Consolidate the duplicated `getNetCustomerTotal`
   onto it. (Leave `FinancialCaseSummary` shape otherwise as-is — this is a derived view,
   decision #11.)
2. **Surface its fields on the preview payment state** (`availableCredit`, `remainingDue`)
   and stop feeding `positiveDeltaPreview` the raw `availableCaseCredit` / `summary.remaining`
   for credit/baseline purposes. (`availableCaseCredit` may remain on the summary for the
   sweep / other readers; it is simply no longer the preview's spendable basis.)
3. **Rewrite `positiveDeltaPreview`'s credit math** per the formulas above.
4. Confirm B1 headline + sweep behavior is byte-unchanged (it does not read these fields).

## Test Plan

- **Phantom-credit (the bug):** unpaid order, prior unapplied removal-credit, positive add ⇒
  `availableCredit 0`, `amountDue = netDelta` (e.g. remove 50 then add 30 ⇒ `amountDue 30`,
  not 0).
- **Genuine overpayment:** customer paid more than net (e.g. paid 250, order downgraded to
  200, add 30) ⇒ `availableCredit 50`, `amountDue = max(30 − 50, 0) = 0`.
- **Partial overpayment:** `availableCredit 20`, add 30 ⇒ `amountDue 10`.
- **No credit, no overpayment:** `amountDue = netDelta` (regression).
- **`computeCustomerSettlement` reconciles:** `netCustomerTotal − cashPaid = remainingDue −
  availableCredit`; headline (FINAL 160 paid, +100/−10) ⇒ `netCustomerTotal 250`,
  `cashPaid 160`, `remainingDue 90`, `availableCredit 0` — run against a **real** B1 fixture,
  not a hand-built summary.
- **Preview == execution (corrected basis):** the guard test reconciles preview
  `remainingAfterCommit` against the **model-A** case remaining (`netCustomerTotal − cashPaid`),
  not the raw document open-balance.
- **B1 regression:** removing-side scenario still reconciles to 90 through the unchanged sweep.
- **Math guard:** `netDelta`, order value, `computeEffectivePaidFromAllocations` unchanged.
- Run: the four `tests/order-commits/*` suites, `tests/financial/financial-case-summary/*`,
  `npm run test:financial-invariants`, `npm run test:centralization`, `npm run build`,
  `npm run lint`.

## Acceptance Criteria

- Spendable available credit consumed by `positiveDeltaPreview` is `max(cashPaid −
  netCustomerTotal, 0)`; the raw unapplied pool is no longer treated as spendable.
- The phantom-credit scenario (unpaid removal then add) prompts the full addition as due.
- The financial-owned `computeCustomerSettlement` exposes `netCustomerTotal`, `cashPaid`,
  `remainingDue`, `availableCredit`, reconciling per the identity, with the duplicated
  `getNetCustomerTotal` consolidated onto it.
- B1 removing-side settlement, the shared sweep, documents, and financial math are unchanged.
- Preview equals execution under the model-A basis; full financial + OrderCommit regression
  suite passes; `npm run build` and `npm run lint` pass.

## Post-Implementation

- Update `context/progress-tracker.md` (Now / Key State + Feature History): adding-side
  credit basis corrected to overpayment-backed; financial-owned customer-settlement core added.
- Update `context/reviews/credit-settlement-application-plan.md` §5.1: mark B2C implemented;
  note B3 next.
