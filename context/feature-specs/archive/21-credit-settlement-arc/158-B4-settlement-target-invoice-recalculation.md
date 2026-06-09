# 158 · B4 — Settlement Target-Invoice Recalculation (cache sync)

> Plan label **B4** (settlement arc correction); repo number **158** is provisional.
> Depends on **153 · F1**, **154 · B1**, **155 · B2**, **157 · B2C**, **156 · B3** (all
> merged). Correctness follow-up: the customer receipt is right, but stored charge-invoice
> balances are stale after a settlement.
> See `context/reviews/credit-settlement-application-plan.md` — §2 ("every document is
> individually correct"), decisions #10/#11.

## Goal

Settlement applications (`SETTLEMENT`, and by extension `CAUSE_REVERSAL`) currently insert
a `DocumentApplication` row **without recalculating the target invoice**. The canonical
balance math (`computeEffectivePaidFromAllocations`) folds applications in, so the
customer-facing receipt (B3) is correct — but the **stored** `ADJUSTMENT.remainingAmount` /
`paidAmount` / `status` never update, so the `/invoices` register and invoice-detail pages
(which read the stored fields) show the pre-settlement balance.

**Verified:** original-bug scenario emits `FINAL 160/160`, `ADJUSTMENT total 100`,
`CREDIT_NOTE 10`, and a `SETTLEMENT` of 10 (CN→ADJ). Receipt shows remaining **90**; stored
`ADJUSTMENT.remainingAmount` stays **100**. The same gap appears wherever an adjustment is
settled by credit without a subsequent payment.

This is the **same shape as deposits**: `applyDepositToFinalIfPresent` also only inserts a
`DEPOSIT` application; the FINAL becomes correct only because a later **payment** triggers
`recalculateInvoiceStatus`, which derives effective-paid from payments **+ all applications**
and persists `remainingAmount`/`status`. Settlement has no such trigger. B4 makes settlement
call that **same canonical helper** so the cache is always fresh.

## Read First

- `src/modules/invoices/invoice.service.ts` — `appendCreditApplication`
  (`appendCreditApplicationWithClient`, inserts the row, no recalc);
  `recalculateInvoiceStatus(id, client)` (derives via `computeEffectivePaidFromAllocations`,
  persists `paidAmount`/`remainingAmount`/`status`); `applyDepositToFinalIfPresent`
  (application-only precedent).
- `src/modules/payments/payment.service.ts` — `recalculateInvoiceStatus` call site (l.366)
  followed by `closeInvoiceIfSettled` (the close/lock-at-zero behavior to reuse).
- `src/modules/invoices/invoice.calculation.ts` — `computeEffectivePaidFromAllocations`
  (the truth; **do not change**).
- `src/modules/financial/invariants.ts` — add the reconciliation invariant.
- `src/modules/invoices/invoice.service.ts` — `computeCreditNoteAvailable` (source credit
  note availability stays derived).

## Rules

- **Reuse the canonical recalc; do not hand-roll.** After writing a `DocumentApplication`,
  call `recalculateInvoiceStatus(targetInvoiceId, client)`. No bespoke
  paid/remaining/status arithmetic anywhere in the settlement path.
- **Do not change `computeEffectivePaidFromAllocations`.** The derived truth is already
  correct; B4 only syncs the stored cache to it.
- **Close/lock on full settlement.** If recalc drives the target to `remaining 0`, follow
  the **existing** close/lock behavior used for fully-settled invoices (`closeInvoiceIfSettled`
  or an extracted shared helper) — unless there is a clear reason not to. Partial settlement
  (`remaining > 0`) stays `PARTIAL`/open.
- **Source credit note stays source-derived.** A credit note's available balance is
  `total − Σ applications where it is the *source*` (`computeCreditNoteAvailable`).
  `recalculateInvoiceStatus` is **target-based** and must **not** be used on the credit note.
  If a stored CN `remainingAmount`/`status` cache exists, update it through a **dedicated
  source-credit helper**, not target recalc.
- **No surface repoint.** Do **not** change the register/invoice-detail read paths; once the
  stored cache is correct they render correctly as-is. (Itemizing the settlement in the
  invoice-detail "Financial Breakdown" — analogous to the FINAL's "Deposit credited" line —
  is the separate document/register plan, out of scope.)
- **No financial math / order / emission / sweep ordering change.** B4 adds a write-back, not
  new money movement.

## Scope

### In Scope

- **`appendCreditApplication` recalculates the target.** After `documentApplication.create`,
  call `recalculateInvoiceStatus(targetInvoiceId, client)` so the target invoice's stored
  `paidAmount`/`remainingAmount`/`status` reflect the application. Covers `SETTLEMENT` and
  `CAUSE_REVERSAL` (and any future kind) uniformly.
- **Close/lock at zero.** When recalc yields `remaining 0`, apply the existing close/lock
  path. Extract a shared helper if `closeInvoiceIfSettled` cannot be reused cross-module
  without duplication.
- **Source credit-note cache** (if any stored field exists) updated via a dedicated
  source-derived helper; otherwise confirm CN availability is read derived everywhere and
  leave the CN row write-once.
- **Reconciliation invariant** `charge-invoice-remaining-matches-derived`: for `FINAL` and
  `ADJUSTMENT`, stored `remainingAmount == max(total − computeEffectivePaidFromAllocations, 0)`
  and `status` consistent with effective-paid. Would have caught this; keeps it from
  recurring.

### Out of Scope

- Repointing register/invoice-detail to derived balances (not needed once the cache is fixed).
- Itemizing settlement/credit applications in invoice-detail breakdowns (document/register
  plan).
- Any change to `computeEffectivePaidFromAllocations`, emission, the sweep, or the receipt
  (B3) projection.
- Backfilling already-stranded stored balances from prior dev data (forward-only; dev data
  is disposable — a reset regenerates correctly).

## Implementation Direction

1. In `appendCreditApplicationWithClient`, after the `documentApplication.create`, call
   `recalculateInvoiceStatus(input.targetInvoiceId, client)`.
2. Add the close/lock-at-zero step for the target (reuse `closeInvoiceIfSettled`; extract to a
   shared module if needed to avoid duplicating the lock-snapshot/audit logic).
3. Verify/handle the source credit note's stored cache via a source-derived helper (not target
   recalc). Keep `computeCreditNoteAvailable` as the truth.
4. Add the `charge-invoice-remaining-matches-derived` invariant.

## Test Plan

- **Original scenario end-to-end:** FINAL 160 paid, upgrade +100 / remove −10 committed ⇒
  receipt remaining **90** AND stored `ADJUSTMENT.remainingAmount 90`, `status PARTIAL`,
  register/detail showing `Settled 10 / Remaining 90`. (Today: stored stays 100.)
- **Full credit settlement:** an adjustment fully settled by credit ⇒ `remaining 0`, status
  `PAID`→closed/locked, consistent with a cash-settled invoice.
- **Partial then paid:** adjustment with 10 settlement + later 90 payment ⇒ `Settled 100 /
  Remaining 0 / Closed` (matches the observed payment-triggered-recalc behavior, now also
  correct pre-payment).
- **CAUSE_REVERSAL** path: target line-targeted reversal also recalculates the target
  adjustment correctly.
- **Source CN unaffected:** credit-note available balance still derived correctly
  (`computeCreditNoteAvailable`); no over/under-draw.
- **Invariant:** `charge-invoice-remaining-matches-derived` passes across fixtures and fails
  on a deliberately stale row.
- **Receipt unchanged:** B3 customer summary still 250/160/90 (derived path untouched).
- Run: OrderCommit + invoices + financial-case-summary suites, `npm run
  test:financial-invariants`, `npm run test:centralization`, `npm run build`, `npm run lint`.

## Acceptance Criteria

- After a `SETTLEMENT`/`CAUSE_REVERSAL` application, the target invoice's stored
  `paidAmount`/`remainingAmount`/`status` match the derived effective-paid; the original
  scenario shows `ADJUSTMENT remaining 90` in the register and detail, matching the receipt.
- Full credit settlement closes/locks the target via the existing path; partial stays open.
- `recalculateInvoiceStatus` is the only balance writer used; no hand-rolled math; the source
  credit note stays source-derived.
- The new reconciliation invariant guards stored-vs-derived for charge invoices.
- No change to `computeEffectivePaidFromAllocations`, emission, sweep, or the B3 receipt.
- Full financial + OrderCommit regression suite, `npm run build`, `npm run lint` pass.

## Post-Implementation

- Update `context/progress-tracker.md` (Now / Key State + Feature History): settlement
  applications now recalculate the target invoice; stored balances reconcile with derived;
  reconciliation invariant added.
- Update `context/reviews/credit-settlement-application-plan.md` §5.1: note B4 implemented
  (settlement target recalculation / cache sync).
