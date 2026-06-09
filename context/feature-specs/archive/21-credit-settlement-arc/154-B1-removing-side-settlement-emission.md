# 154 · B1 — Removing-Side Settlement Emission

> Plan label **B1** (settlement arc); repo number **154** is provisional — renumber if a
> different spec ships first. Depends on **153 · F1** (`DocumentApplication.kind`,
> drawable credit-note lifecycle, `appendCreditApplication`, reworked invariants).
> Incorporates the former "F2" settlement-application semantics now that the `kind`
> discriminator exists.
> See `context/reviews/credit-settlement-application-plan.md` (decisions #1, #5, #6, #9).

## Goal

Make a commit's removal-credit settle the customer's *open receivables* instead of
stranding on the FINAL invoice. After the existing same-cause reversal step, residual
credit is applied to other open receivable invoices in the same case — including the
adjustment invoice created in this very commit — as invoice-targeted `SETTLEMENT`
applications, oldest-first. Whatever credit still has nowhere to land **stays unapplied
on the credit note** as available credit (the drawable pool from F1), and is **no longer
applied to FINAL**. This is the fix for the original bug: in the upgrade-plus-remove
scenario the documents now reconcile to **90 outstanding**, not 100, with every cent on
an explicit, audit-visible application row.

## Read First

- `context/reviews/credit-settlement-application-plan.md` — §2.4–§2.5 (why credit
  stranded), §4 (settlement vs. cause-reversal), decisions #6/#9.
- `context/feature-specs/F1-credit-note-drawable-pool-foundation.md` — the foundation
  this builds on; `appendCreditApplication`, `kind`, reworked invariants.
- `src/modules/order-commits/order-commit-financial-emission.service.ts` —
  `mapOrderCommitDiffToFinancialLines`, `routeCreditNoteCandidate`,
  `adjustmentReversals`, `creditNoteFinalLines`, `OrderCommitFinancialEmission`.
- `src/modules/order-commits/order-commit-execution.service.ts` — the three emission
  blocks (~l.938–1004): adjustment invoice, grouped reversal credit notes, residual
  credit note; `assertFinalCreditCapacity`; `groupAdjustmentReversals`.
- `src/modules/invoices/invoice.service.ts` — `buildOpenAdjustmentLineMap` (cause-keyed,
  ADJUSTMENT-only), `createCreditNoteWithClient`, `computeCreditNoteCapacityForFinal`.
- `src/modules/invoices/invoice.calculation.ts` — `computeEffectivePaidFromAllocations`
  (SETTLEMENT rows already flow into target effective-paid; no math change needed).
- `src/modules/financial/invariants.ts` — `adjustment-has-no-document-application`,
  `credit-note-targets-final`, `credit-note-has-document-application` (all already
  F1-reworked to permit settlement; B1 must keep passing them).

## Rules

- **Depends on F1.** Do not start until `kind` + `appendCreditApplication` + the reworked
  invariants exist. B1 emits the first production `SETTLEMENT` rows.
- **No financial *math* change.** `computeEffectivePaidFromAllocations` and totals stay
  identical; the preview `netDelta`/amount-due is already correct and must not move.
- **Settlement is invoice-targeted, append-only, immutable.** Each settlement is a new
  `DocumentApplication` (`kind = SETTLEMENT`, `source = CREDIT_NOTE`, `target =`
  open ADJUSTMENT **invoice**, `targetInvoiceLineId = NULL`) written via
  `appendCreditApplication`. Never edit/delete; never mutate an invoice's frozen fields.
- **Residual credit no longer lands on FINAL.** Leftover after settlement stays
  *unapplied* on the credit note (drawable pool). Drop the `CREDIT_TO_FINAL` residual
  emission for new commits.
- **Origin preserved.** The residual credit note's `parentInvoiceId` stays the FINAL
  invoice (audit origin), satisfying `credit-note-targets-final`.
- **Deterministic ordering.** Settlement consumes open receivables by ascending
  `invoiceSeq` (reuse the chronological order already used by
  `buildOpenAdjustmentLineMap`).
- **Read live remaining.** Settlement runs *after* the same-cause reversal block, and
  must read each receivable's current remaining (post-reversal) so it never double-counts
  a balance a reversal already reduced.
- **Same case/order only.** Settlement targets open ADJUSTMENT invoices in the same
  `financialCaseId`/`orderId`. No cross-order/customer-wide credit (decision #4).
- Keep the cause-reversal path (line-targeted `CAUSE_REVERSAL`) exactly as is.

## Scope

### In Scope

- A settlement step in the emission/execution pipeline that, **after** the adjustment
  invoice and same-cause reversal credit notes are created, applies residual removal
  credit to open receivable invoices (incl. the just-created adjustment) as `SETTLEMENT`
  applications, oldest-first, capped at each invoice's live remaining and the residual.
- Residual credit note creation that documents the removal with `parentInvoiceId = FINAL`
  but is **not** applied to FINAL; its applications are the `SETTLEMENT` rows, with any
  remainder left unapplied (`remainingAmount > 0`, drawable pool).
- An open-receivable source for settlement (e.g. extend `buildOpenAdjustmentLineMap` or
  add `buildOpenReceivableInvoices({ financialCaseId, orderId })`) returning open
  ADJUSTMENT invoices with live remaining, ordered by `invoiceSeq`. Must reflect rows
  created earlier in the same transaction (the new adjustment invoice).
- Adjust the FINAL credit-capacity precheck (`assertFinalCreditCapacity` /
  `computeCreditNoteCapacityForFinal` usage): residual credit notes no longer consume
  FINAL credit capacity, so the precheck must not block them on that basis. (This is the
  F1 carry-forward.)
- Tests proving the original scenario reconciles to 90, multi-receivable greedy
  settlement, leftover-stays-unapplied, and invariant compliance.

### Out of Scope

- **Adding-side** consumption of pre-existing available credit before amount due (B2).
- **Canonical settlement projection** / Sales read layer (B3). B1 fixes the *documents*;
  the Sales sidebar reconciling to 90 follows from the corrected document balances, but
  the canonical projection refactor is B3.
- Offsetting/undo for a later commit that cancels a settled receivable (later spec) —
  B1 only writes forward settlements; the immutable+offsetting rule (#8) governs undo
  later.
- `computeCreditNoteCapacityForFinal` *removal* — only its application to residual credit
  notes changes; the FINAL over-credit guard for genuine FINAL-targeted credit notes
  stays.
- No UI/copy, payment, or refund-flow change.
- No progress-tracker update during this docs-only drafting.

## Implementation Direction

Three tasks.

### Task 1 — Open-receivable source

Add a helper returning open ADJUSTMENT invoices for a case/order with live remaining
(`totalAmount − effective-paid`, where effective-paid already nets payments and
applications via `computeEffectivePaidFromAllocations`), ordered by `invoiceSeq`. It must
see invoices created earlier in the same transaction. Keep `buildOpenAdjustmentLineMap`
(cause-keyed, line-level) for the unchanged reversal path; settlement works at the
*invoice* level, so a separate, invoice-level reader is cleanest.

### Task 2 — Settlement emission at execution time

Settlement is decided at **execution** time, not in the pure mapper, because it must
target invoices that only exist after this commit's adjustment is created (and read their
live remaining). Concretely, after the existing reversal block and replacing the
`creditNoteFinalLines → target FINAL` block:

1. Compute residual removal credit per the mapper as today (the amount currently routed
   to `creditNoteFinalLines`).
2. Create the residual credit note documenting the removal, `parentInvoiceId = FINAL`,
   with **no** FINAL application.
3. Load open receivable invoices (Task 1), oldest-first. For each, while residual remains,
   `appendCreditApplication({ creditNoteId, targetInvoiceId, amount: min(residual,
   invoiceRemaining), kind: SETTLEMENT })`.
4. Leave any remaining residual unapplied on the credit note (drawable pool;
   `remainingAmount > 0`, status open).

The pure mapper may keep emitting `creditNoteFinalLines` as the residual descriptor;
execution reinterprets it as "residual to settle then leave unapplied." Renaming for
clarity is allowed if behavior-identical.

### Task 3 — Capacity precheck + tests

Update `assertFinalCreditCapacity` so residual credit notes (now FINAL-parented but
FINAL-unapplied) are not rejected on FINAL credit capacity. Preserve the over-credit
guard for credit notes that genuinely apply to a FINAL.

Tests (match existing OrderCommit emission/execution test layout):
- **Original scenario:** FINAL 160 paid; commit upgrades +100 and removes photos −10.
  After commit: ADJ remaining **90** (10 settled via `SETTLEMENT`), FINAL untouched at
  160/160, credit note `remaining 0`, case outstanding **90**.
- **Multi-receivable:** two open adjustments; residual settles oldest-first, partial on
  the second; correct remainders.
- **Leftover:** residual exceeds open receivables; the excess stays unapplied on the
  credit note (`remaining > 0`, status open); nothing lands on FINAL; case shows that
  available credit (outstanding unaffected).
- **No open receivable:** residual fully unapplied (pure available credit).
- **Reversal coexistence:** same-cause reversal still line-targets its adjustment; only
  cross-cause residual uses `SETTLEMENT`; no double-application of a reversed balance.
- **Invariants:** `adjustment-has-no-document-application` passes for the new
  invoice-targeted `SETTLEMENT`; `credit-note-targets-final`,
  `credit-note-has-document-application`, `credit-note-pool-not-over-applied`,
  `credit-note-remaining-matches-applications` all pass.
- **Math guard:** preview `netDelta`/amount-due unchanged; `computeEffectivePaidFrom-
  Allocations` arithmetic unchanged.

## Observability Checklist

### Dashboards / Metrics

- No production dashboard required.
- On settlement, the nightly reconciliation must still pass; if residual exceeds all open
  receivables, that is expected (available credit), not a violation.

### Rollback Plan

- Revert the execution settlement block to the prior `creditNoteFinalLines → FINAL`
  residual emission; restore the original `assertFinalCreditCapacity` behavior; drop the
  open-receivable helper.
- Because B1 only adds forward `SETTLEMENT` rows, rollback affects new commits only;
  existing data is untouched. (Pre-B1 stranded credits remain as historical
  `CREDIT_TO_FINAL`; forward-only per decision — no migration.)

### Customer-Visible Surface

- Indirect only: after a remove-plus-add commit, the order's outstanding reconciles
  correctly (e.g. 90, not 100) because the documents now net properly. No new UI; the
  canonical projection polish is B3.

## Post-Implementation

- Update `context/progress-tracker.md` Key State (Financial architecture) + Feature
  History: removing-side settlement emission; residual no longer lands on FINAL.
- Update `context/target-data-model.md` if the open-receivable read contract or residual
  credit-note semantics need documenting.
- Update `context/reviews/credit-settlement-application-plan.md`: mark B1 implemented;
  note B2 (adding-side) and B3 (projection) remain.

## Acceptance Criteria

- After a removal commit, residual credit is applied to open receivable invoices (incl.
  the same-commit adjustment) as `SETTLEMENT` applications, oldest-first; leftover stays
  unapplied on the credit note; **nothing new lands on FINAL**.
- The original upgrade-plus-remove scenario reconciles to **90 outstanding** with the 10
  on an explicit `SETTLEMENT` row against the adjustment.
- Residual credit notes keep `parentInvoiceId = FINAL` (origin) and pass all F1-reworked
  credit-note invariants; the FINAL credit-capacity precheck no longer blocks them.
- Same-cause reversal behavior is unchanged; no balance is double-applied.
- No financial math, preview amount-due, payment, refund, or UI behavior changes.
- The full financial invariant + OrderCommit regression suite passes.
- If this spec adds or changes a financial / composition / workflow / status display
  surface: it consumes the canonical read model + a projector instead of re-deriving in
  pages or components; money read from raw projector fields, formatted via
  `src/lib/formatting/money.ts`; no `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
