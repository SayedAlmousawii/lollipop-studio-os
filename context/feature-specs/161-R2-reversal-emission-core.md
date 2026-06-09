# 161 · R2 — Reversal Emission Core (drawable credit + sweep, no manufactured overpayment)

> Plan label **R2** (reversal-credit model phase); repo number **161** is provisional.
> Third spec of the phase in
> `context/reviews/reversal-credit-and-refund-model-decision.md` (model **C′ + Option 1**).
> **This is the behavioral fix — the stranding bug dies here.** Not a no-op.
> Depends on **159 · R0** (origin fields) and **160 · R1** (kind-agnostic invariants) being merged.

## Goal

Stop reversal value from being immediately consumed as a line-targeted `CAUSE_REVERSAL`
application that **manufactures overpayment** on the already-paid adjustment invoice. Instead,
issue reversal value as **drawable settlement-capable credit** (origin `REVERSAL`, provenance on
the note from R0) and let the existing sweep
(`settleAvailableCreditAgainstOpenReceivables`) apply it to open receivables as `SETTLEMENT`.
Reversal value that is **not** immediately refunded must remain in the drawable pool, never as
invoice overpayment — so a downstream open `ADJ` gets settled instead of being stranded next to a
phantom "overpaid" balance.

## The bug, mechanically (verified in code)

1. A reversal issues a credit note whose lines are **line-targeted** at the paid `ADJ`. In
   `createCreditNoteWithClient` that produces `CAUSE_REVERSAL` `DocumentApplication` rows
   (invoice.service.ts ~l.3104).
2. `computeEffectivePaidFromAllocations` (invoice.calculation.ts l.38–55) sums **all**
   `DocumentApplication.amountApplied` targeting an invoice into its effective-paid. So the
   `CAUSE_REVERSAL` inflates the target `ADJ`'s effective-paid → `computeOverpaymentCapacity`
   (= `max(effectivePaid − total − refunded, 0)`) reports **manufactured overpayment**.
3. The `CAUSE_REVERSAL` also drains `computeCreditNoteAvailable` (= total − Σ source apps) to ~0,
   so when the sweep runs (OrderCommit emission l.1020) it finds nothing drawable and skips the
   note. The manufactured overpayment **cannot** settle other open receivables — the sweep only
   draws the drawable pool, never overpayment cash.
4. Net result (the screenshot): a paid `ADJ` shows phantom *overpaid N*, while a separate open
   `ADJ` stays open — value stranded.

## Read First

- `context/reviews/reversal-credit-and-refund-model-decision.md` — §3 (C′ model + origin fields),
  §7 (phase plan; locked decision #3: reversal first, FINAL credit later).
- `src/modules/invoices/invoice.service.ts`:
  - `createCreditNoteWithClient` (~l.2887) — the issuance path; `CAUSE_REVERSAL` createMany
    (~l.3104); the all-or-nothing line-targeting guards (~l.2988, l.3004) and the
    "adjustment credit notes require line-targeted applications" rule (~l.3004).
  - `applyAdjustmentReversalsWithClient` (~l.3257) — builds the reversal credit note from edit
    reversals; issues the immediate refund for `requiresRefund` lines (~l.3339).
  - `settleAvailableCreditAgainstOpenReceivablesWithClient` (~l.2606) — the sweep; draws
    `computeCreditNoteAvailable`, applies `SETTLEMENT` to ADJUSTMENT receivables.
  - `buildOpenReceivableInvoices` (~l.1908) — ADJUSTMENT-only open receivables.
- `src/modules/financial/edit-classifier.ts` l.293 — `requiresRefund = adjustmentLine.isPaid`.
- `src/modules/order-commits/order-commit-execution.service.ts` — reversal emission (~l.962),
  post-emission sweep (~l.1020).
- `src/modules/financial/reconciliation-invariants.ts` — **INV-09** `credit-note-application-target`
  (l.77) — currently permits only FINAL or **line-targeted** ADJUSTMENT; must be loosened.

## The R2 / R3 boundary (read carefully — this is the whole scoping decision)

`requiresRefund` for a reversed line is `adjustmentLine.isPaid` (edit-classifier l.293). The two
cases behave differently and split cleanly:

- **Unpaid line reversed (`requiresRefund = false`)** — today's `CAUSE_REVERSAL` manufactures
  overpayment with **no** offsetting refund → this is the value that **strands**. **R2 fixes this:**
  issue it as drawable `REVERSAL` credit and sweep it onto open receivables.
- **Paid line reversed (`requiresRefund = true`)** — today the `CAUSE_REVERSAL` (amount =
  reversal amount) manufactures overpayment that is **immediately and exactly** consumed by the
  refund (`amount: reversal.amount`, invoice.service l.3361). Net stranding = 0. This path is
  **not** broken, so **R2 leaves it on the existing `CAUSE_REVERSAL` + overpayment-refund
  mechanism unchanged.** Rechanneling that refund to draw from the credit-note balance is **R3**.

This boundary keeps the system green at the R2 merge: the bug path is fixed; the paid-refund path
keeps working until R3 rechannels it. (Considered and rejected: making *all* reversal value
drawable in R2 — that breaks the paid-reversal refund, which depends on the manufactured
overpayment being removed only once R3's credit-note-balance refund replaces it.)

## Rules

- **Reversal value is never manufactured as invoice overpayment unless it is the immediately
  refunded paid-line amount.** Unpaid-line reversal value goes to the drawable pool, full stop.
- **The sweep is the only thing that applies drawable reversal credit**, as `SETTLEMENT` onto open
  ADJUSTMENT receivables (existing behavior, now actually reachable because the credit is left
  drawable).
- **Sweep must run after reversal emission on *both* emission paths.** OrderCommit already sweeps
  (l.1020). The direct reductive-edit path (`syncOrderInvoiceForFinancialEdit` →
  `applyAdjustmentReversalsWithClient`) does **not** sweep today — R2 must add the same
  post-emission sweep there, or unpaid reversal value would sit drawable-but-unapplied.
- **Origin/provenance is unchanged from R0.** Drawable reversal notes carry `creditOrigin =
  REVERSAL` and `reversesInvoiceLineId`; they no longer also write a `CAUSE_REVERSAL` application.
- **`CREDIT_TO_FINAL` / FINAL removal credit is out of scope** (locked decision #3 — retired in R4).
  R2 touches only the reversal / `CAUSE_REVERSAL` path.

## Scope

### In Scope

- **Drawable reversal emission.** Partition the reversals handled by
  `applyAdjustmentReversalsWithClient` (and the OrderCommit reversal emission ~l.962) by
  `requiresRefund`:
  - `requiresRefund = false` → issue the reversal value as a **drawable** `REVERSAL` credit note
    (origin + `reversesInvoiceLineId` set; **no** `CAUSE_REVERSAL` application). It stays in the
    drawable pool for the sweep.
  - `requiresRefund = true` → unchanged: today's line-targeted `CAUSE_REVERSAL` note + immediate
    refund. (Deferred to R3.)
  - A mixed edit (some paid, some unpaid lines) emits the drawable group and the line-targeted
    group as separate credit notes rather than mixing application kinds within one note.
- **Relax `createCreditNoteWithClient` to accept a drawable ADJUSTMENT-parented reversal note** —
  i.e. an ADJUSTMENT-targeted credit note that is **not** line-targeted and is left unapplied
  (drawable), carrying `creditOrigin = REVERSAL`. The existing "adjustment credit notes require
  line-targeted applications" guard (~l.3004) and the UNAPPLIED-must-be-FINAL guard (~l.3050) must
  be loosened **only** for this drawable-REVERSAL case; every other emission shape stays as-is.
- **Sweep on the direct path.** Add the `settleAvailableCreditAgainstOpenReceivables` call after
  reversal emission in the direct reductive-edit flow (`syncOrderInvoiceForFinancialEdit`),
  matching the OrderCommit ordering (emit → sweep).
- **Loosen INV-09** (`credit-note-application-target`, reconciliation-invariants l.77) to permit
  invoice-level `SETTLEMENT` (null `targetInvoiceLineId`) onto **ADJUSTMENT and FINAL** invoices,
  aligning reconciliation with the kind-agnostic runtime invariants R1 already landed. Keep the
  existing FINAL and line-targeted-ADJUSTMENT allowances. (Today the sweep's invoice-level
  `SETTLEMENT` onto ADJUSTMENT is not sanctioned by INV-09 — R2 makes that path primary, so the
  reconciliation rule must catch up.)

### Out of Scope

- **The paid-reversal refund channel** — rechanneling the `requiresRefund` refund to draw from the
  credit-note balance, and dropping its `CAUSE_REVERSAL` overpayment manufacturing (**R3**).
- **`CREDIT_TO_FINAL` / FINAL removal credit** behavior (**R4**).
- **Retiring the `CAUSE_REVERSAL` / `CREDIT_TO_FINAL` enum kinds** (**R4**) — `CAUSE_REVERSAL` is
  still emitted by the paid-reversal path until R3, so the enum stays.
- Any read-layer / receipt / register change — the receipt (B3) and register already derive from
  applications and will reconcile once the sweep settles the open receivable.

## Implementation Direction

1. In `applyAdjustmentReversalsWithClient`, split `reversalInputs` by `requiresRefund`. Emit the
   unpaid group via `createCreditNote` as a drawable `REVERSAL` note (non-line-targeted,
   unapplied, `creditOrigin = REVERSAL`, `reversesInvoiceLineId` = first reversed line). Emit the
   paid group exactly as today (line-targeted `CAUSE_REVERSAL` + refund).
2. Relax the two `createCreditNoteWithClient` guards for the drawable-REVERSAL case only; keep all
   other shapes rejecting as before. Do not write a `CAUSE_REVERSAL` row for the drawable note.
3. Mirror the same split in the OrderCommit reversal emission (~l.962).
4. Add the post-emission sweep to `syncOrderInvoiceForFinancialEdit`.
5. Loosen INV-09's SQL predicate to allow `SETTLEMENT`-shaped invoice-level applications onto
   ADJUSTMENT/FINAL; regenerate any reconciliation catalog doc if one is generated.
6. Do **not** touch `computeCreditNoteAvailable`, `computeEffectivePaidFromAllocations`, the sweep
   body, or `computeOverpaymentCapacity` — R2 changes only *what gets emitted*, not how value is
   computed or swept.

## Observability Checklist

### Rollback Plan
- Revert = restore line-targeted `CAUSE_REVERSAL` emission for the unpaid group, remove the
  direct-path sweep call, and restore INV-09. No schema change in R2; rollback is code-only.
- Non-recoverable data: none (drawable notes regenerate on reset; locked decision #1).

### Customer-Visible Surface
- The phantom "overpaid" balance on a reversed-but-unpaid edit disappears; the downstream open
  `ADJ` settles to closed. This is the intended fix, not a regression.

## Post-Implementation
- Update `context/reviews/reversal-credit-and-refund-model-decision.md` §7: mark R2 done — reversal
  value now drawable + swept; manufactured overpayment removed for the non-refunded path; R3
  (paid-reversal refund channel) unblocked.
- Update `context/progress-tracker.md` Key State + Feature History: reversal stranding fixed for
  the unpaid path; paid-reversal refund still legacy pending R3.

## Acceptance Criteria

- **Regression (the bug):** an edit that reverses an **unpaid** adjustment line while a separate
  open ADJUSTMENT receivable exists results in the reversal value being applied as `SETTLEMENT` to
  the open receivable (closing it where it fully covers) — and produces **no** manufactured
  overpayment on the reversed invoice. The case net and per-document allocation both reconcile.
- **Paid path unchanged:** reversing a **paid** adjustment line still issues the immediate refund
  exactly as today; no behavior change for that path (R3 will rechannel it).
- **Mixed edit:** an edit with both paid and unpaid reversed lines emits a drawable `REVERSAL`
  note (swept) and a line-targeted `CAUSE_REVERSAL` note (refunded) without double-counting value.
- **Both emission paths sweep:** the fix holds whether the edit runs through OrderCommit or the
  direct reductive-edit flow.
- **Invariants:** R1 runtime invariants (`valid-credit-origin`, `credit-applications-conserve`,
  `classifier-reductions-have-origin`) and the loosened **INV-09** all pass on the new emission;
  full financial + OrderCommit + reconciliation suite green.
- `npm run build` and `npm run lint` pass.
