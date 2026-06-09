# 155 · B2 — Adding-Side Available-Credit Consumption

> Plan label **B2** (settlement arc); repo number **155** is provisional — renumber if a
> different spec ships first. Depends on **153 · F1** (drawable credit-note pools,
> `appendCreditApplication`) and **154 · B1** (settlement sweep, `SETTLEMENT` emission).
> See `context/reviews/credit-settlement-application-plan.md` (decisions #5, #6, §2.6).

## Goal

Make a commit that *adds* cost consume the customer's pre-existing **available credit**
before asking for cash, so they pay only the difference. Today a positive-delta commit
computes `amountDue = netDelta` and **ignores** any credit the customer already holds —
forcing the refund-then-repay dance described in plan §2.6. B2 (a) introduces a canonical
**available-credit** figure (sum of unapplied credit-note pool balances in the case),
(b) generalizes B1's settlement step into a single end-of-commit **sweep** that applies
available credit to open receivables on *every* commit — including pure-add commits where
no new credit is created — and (c) subtracts consumed credit from the preview's amount
due so staff see the correct number before committing. This closes the across-commit case
with the same mechanism as B1.

## Read First

- `context/reviews/credit-settlement-application-plan.md` — §2.6 (across-commit gap),
  decisions #5 (both directions), #6 (leftover sits available).
- `context/feature-specs/154-B1-removing-side-settlement-emission.md` — the settlement
  sweep this generalizes; `SETTLEMENT` semantics.
- `context/feature-specs/153-F1-credit-note-drawable-pool-foundation.md` — drawable pools;
  `appendCreditApplication`; credit-note `remainingAmount` = unapplied credit.
- `src/modules/order-commits/order-commit-approval-document-preview.service.ts` —
  `positiveDeltaPreview` (computes `amountDue = netDelta`, ignores credit),
  `OrderCommitPreviewPaymentState` schema (`overpaymentCapacity`, `creditNoteCapacity`).
- `src/modules/order-commits/order-commit-execution.service.ts` —
  `paymentStateFromFinancialCaseSummary` (maps summary → payment state), the emission
  blocks where the B1 sweep runs.
- `src/modules/financial-cases/financial-case-summary.service.ts` —
  `computeOverpaymentCapacity` (cash overpay on FINAL) and
  `computeCreditNoteCapacityForFinal` (headroom to issue more credit). **Neither is
  available credit** — B2 adds a new figure.
- `src/modules/invoices/invoice.service.ts` — credit-note rows; where to sum unapplied
  `remainingAmount`.

## Rules

- **Depends on F1 + B1.** Reuse `appendCreditApplication` and the B1 settlement sweep;
  do not invent a parallel application path.
- **No financial *math* change.** Order value, `netDelta`, and
  `computeEffectivePaidFromAllocations` are unchanged. B2 changes *what is collected in
  cash* (some becomes credit-settled), not what is owed.
- **Available credit is derived, document-backed.** `availableCaseCredit =
  Σ computeCreditNoteAvailable(cn)` over the case's credit notes
  (`total − Σ applications` each, per F1). Never a stored balance (the optional
  `remainingAmount` cache may back it for read speed, but the derived value is the truth).
- **Preview must equal execution.** The amount-due shown in `positiveDeltaPreview` must
  match what the post-commit sweep actually leaves open. One source of truth.
- **Same case/order only** (decision #4). No cross-order/customer-wide credit.
- **Deterministic, oldest-first**, mirroring B1; immutable + append-only (decision #8).
- **Leftover still sits** (decision #6): credit beyond the new receivable stays unapplied
  (available), not refunded.

## Scope

### In Scope

- **`computeAvailableCaseCredit({ financialCaseId })`** = sum of `computeCreditNoteAvailable`
  (F1's derived `total − Σ applications`) over the case's `CREDIT_NOTE` invoices. Add it to
  `FinancialCaseSummary` as `availableCaseCredit`.
- **Generalize B1's settlement step into a shared end-of-commit sweep**
  (`settleAvailableCreditAgainstOpenReceivables({ financialCaseId, orderId, client })`):
  apply all unapplied credit-note pools to all open receivable invoices in the case,
  oldest-`invoiceSeq`-first, via `appendCreditApplication(kind: SETTLEMENT)`, capped at
  each side. Run it at the end of **every** commit's emission — so it covers
  credit-created-this-commit (B1) *and* pre-existing leftover credit meeting a new
  receivable (B2) uniformly. B1's residual-credit path now feeds the same sweep.
- **Adding-side preview:** add `availableCaseCredit` to `OrderCommitPreviewPaymentState`
  (schema + `paymentStateFromFinancialCaseSummary` mapping); in `positiveDeltaPreview`
  set `amountDue = max(netDelta − availableCaseCredit, 0)`, surface the consumed-credit
  amount (e.g. `creditAmount`) and the remaining-after-commit, leaving `netDelta`/order
  value untouched.
- Tests: across-commit consumption, full vs. partial coverage, multi-pool ordering,
  preview-equals-execution, leftover stays available.

### Out of Scope

- **Canonical settlement projection / Sales read layer** (B3) — B2 fixes the commit math
  and documents; the polished customer-facing summary is B3.
- Removing-side emission (B1, done) — B2 only generalizes its sweep.
- Refund behavior — leftover credit is *not* auto-refunded (decision #6/#7); manual
  refund is unchanged.
- Reduction-preview path — unchanged; B2 is the positive-delta path.
- `overpaymentCapacity` / cash-overpayment handling — untouched; B2's available credit is
  the credit-note-pool figure, a separate concept.
- No UI/copy change beyond the corrected preview numbers; no progress-tracker update
  during this docs-only drafting.

## Implementation Direction

Three tasks.

### Task 1 — Available-credit figure

Add `computeAvailableCaseCredit` summing `remainingAmount` over `CREDIT_NOTE` invoices in
the case, and surface it on `FinancialCaseSummary` as `availableCaseCredit`. Keep it
distinct from `overpaymentCapacity` and `creditNoteCapacity`; do not overload them.

### Task 2 — Shared end-of-commit settlement sweep

Lift B1's settlement logic into `settleAvailableCreditAgainstOpenReceivables`. It loads
unapplied credit-note pools (`remainingAmount > 0`) and open receivable invoices
(ADJUSTMENT with live remaining, incl. any created earlier in this transaction), then
applies oldest-first via `appendCreditApplication(SETTLEMENT)` until one side exhausts.
Call it once at the end of emission for every commit kind that emits documents, after the
adjustment/reversal/residual blocks. Confirm B1's scenario still reconciles to 90 through
the shared path (no behavior regression).

### Task 3 — Adding-side preview + tests

Extend `OrderCommitPreviewPaymentState` with `availableCaseCredit`; map it in
`paymentStateFromFinancialCaseSummary`. In `positiveDeltaPreview`:
- `consumedCredit = min(netDelta, availableCaseCredit)`
- `amountDue = round(netDelta − consumedCredit)`
- surface `creditAmount = consumedCredit` and `remainingAfterCommit` consistently with
  the existing payment-impact shape; do not alter `netDelta` or order value.

Tests (match OrderCommit preview/execution layout):
- **Across-commit:** customer holds 50 available credit; commit adds +50 ⇒ preview
  `amountDue 0`; post-commit the new adjustment is fully `SETTLEMENT`-settled, credit pool
  drawn to 0, nothing collected in cash.
- **Partial credit:** 30 available, +50 added ⇒ `amountDue 20`; adjustment remaining 20.
- **Excess credit (leftover sits):** 80 available, +50 added ⇒ `amountDue 0`; 30 credit
  remains unapplied/available (decision #6); not refunded.
- **Multi-pool:** two credit notes; consumed oldest-first; correct remainders.
- **Preview == execution:** the preview `amountDue` equals the post-sweep open balance for
  each case.
- **No available credit:** `amountDue = netDelta` exactly as today (no regression).
- **Math guard:** `netDelta`, order value, and `computeEffectivePaidFromAllocations`
  unchanged.

## Observability Checklist

### Dashboards / Metrics

- No production dashboard required.
- Nightly reconciliation must pass; credit consumed by a new receivable is expected, not a
  violation; leftover available credit is a legitimate open credit-note balance.

### Rollback Plan

- Revert `positiveDeltaPreview` to `amountDue = netDelta`; remove `availableCaseCredit`
  from the payment state + summary; stop calling the sweep on pure-positive commits
  (restore B1-only behavior). The shared sweep helper can remain (B1 uses it) or be
  inlined back into B1 on full revert.
- Forward-only; no data migration. Existing applications untouched.

### Customer-Visible Surface

- Staff see the corrected **amount due** on an adding commit when the customer already has
  credit (e.g. `0` instead of full price), plus a consumed-credit line. No new screens;
  the full summary polish is B3.

## Post-Implementation

- Update `context/progress-tracker.md` Key State (Financial architecture) + Feature
  History: adding-side available-credit consumption; shared end-of-commit settlement
  sweep; `availableCaseCredit` on `FinancialCaseSummary`.
- Update `context/target-data-model.md` if the available-credit contract needs
  documenting.
- Update `context/reviews/credit-settlement-application-plan.md`: mark B2 implemented;
  note B3 (canonical projection) remains.

## Acceptance Criteria

- `availableCaseCredit` (sum of unapplied credit-note `remainingAmount`) is computed and
  exposed on `FinancialCaseSummary`, distinct from `overpaymentCapacity`/
  `creditNoteCapacity`.
- A positive-delta commit consumes available credit before cash: preview `amountDue =
  max(netDelta − availableCaseCredit, 0)`, and the post-commit sweep leaves exactly that
  open via `SETTLEMENT` applications.
- The settlement sweep is a single shared routine run at the end of every document-emitting
  commit; B1's removing-side scenario still reconciles to 90 through it.
- Leftover credit beyond the new receivable stays unapplied/available (not refunded);
  multi-pool consumption is oldest-first and deterministic.
- Preview equals execution for all tested cases; with no available credit, `amountDue`
  equals `netDelta` exactly as before.
- No financial math, order-value, payment-record, refund, or unrelated UI behavior change.
- The full financial invariant + OrderCommit regression suite passes.
- If this spec adds or changes a financial / composition / workflow / status display
  surface: it consumes the canonical read model + a projector instead of re-deriving in
  pages or components; money read from raw projector fields, formatted via
  `src/lib/formatting/money.ts`; no `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
