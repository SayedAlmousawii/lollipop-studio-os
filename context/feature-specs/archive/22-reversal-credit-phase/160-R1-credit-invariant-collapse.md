# 160 · R1 — Credit Invariant Collapse (taxonomy → origin + conservation)

> Plan label **R1** (reversal-credit model phase); repo number **160** is provisional.
> Second spec of the phase in
> `context/reviews/reversal-credit-and-refund-model-decision.md` (model **C′ + Option 1**, §4).
> **Behavior no-op** — replaces the four application-shape invariants with origin + conservation
> checks that pass on **both** today's emission (`CAUSE_REVERSAL` / `CREDIT_TO_FINAL`) and the
> future collapsed emission (`SETTLEMENT`). This is the forward-enabling rework that must land
> **before R2** changes emission. Mirrors **153 · F1** (invariant rework ahead of new emission).
> Depends on **159 · R0** (origin fields populated at issuance).

## Goal

Stop policing *how* a credit note is applied (per-kind target/line rules) and start policing
*what it is* (a valid origin) and *that it conserves* (applications never exceed its total).
This removes the structural taxonomy that forces immediate `CAUSE_REVERSAL` consumption, so R2
can route reversal value through the ordinary sweep without tripping invariants — while today's
unchanged emission still passes.

## Read First

- `context/reviews/reversal-credit-and-refund-model-decision.md` — §4 (before→after invariant
  table), §3 (origin fields), §7 (phase plan; R1-before-R2 ordering).
- `src/modules/financial/invariants.ts` — the four invariants being replaced:
  - `credit-note-targets-final` (l.829)
  - `credit-note-has-document-application` / `isValidCreditNoteApplication` (l.867, 908)
  - `adjustment-has-no-document-application` / `isAllowedAdjustmentDocumentApplication` (l.584, 617)
  - `classifier-reductions-have-matching-credit-note` (l.1194)
  - **Keep** `document-application-not-over-source` (conservation) and
    `charge-invoice-remaining-matches-derived` (B4) — these are the backstops.
- `src/modules/financial/invariant-catalog.ts` + `context/reviews/invariant-catalog.md` — the
  catalog to regenerate (remove retired entries, add the new ones).
- `src/modules/invoices/invoice.service.ts` — `computeCreditNoteAvailable` (drawable = total −
  Σ source applications; the conservation truth the new invariant mirrors).

## Rules

- **Behavior no-op.** No emission, sweep, refund, application-kind, or money-math change. R1 only
  swaps which invariants run. Emission still creates `CAUSE_REVERSAL` / `CREDIT_TO_FINAL` exactly
  as in R0.
- **Kind-agnostic.** The new invariants must **not** assert anything about
  `DocumentApplicationKind` or `targetInvoiceLineId` shape, so they pass whether the value was
  applied as `CAUSE_REVERSAL`, `CREDIT_TO_FINAL`, or (post-R2) `SETTLEMENT`. This is the whole
  point of landing R1 before R2.
- **Strict on origin + conservation.** A credit note must have a valid `creditOrigin`; a
  `REVERSAL` must point at a real line in the same case; applications must sum to ≤ the note's
  total. Same/strictly-stronger conservation guarantees than today — the loosening is **only** on
  the structural per-kind taxonomy, with `document-application-not-over-source` +
  `charge-invoice-remaining-matches-derived` as the conservation backstop.
- **Assumes R0-regenerated data** (locked decision #1, reset & regenerate). The new invariants
  require non-null `creditOrigin` on every `CREDIT_NOTE`; after a reset, R0's issuance path
  populates it. No legacy-null tolerance branch — dev data is disposable.

## Scope

### In Scope

- **Remove** the four invariants listed above and their helpers
  (`isValidCreditNoteApplication`, `isAllowedAdjustmentDocumentApplication`).
- **Add `valid-credit-origin`:** for every `CREDIT_NOTE`, `creditOrigin` is non-null and one of
  the enum values; if `creditOrigin = REVERSAL`, `reversesInvoiceLineId` is set and references an
  `InvoiceLineItem` whose invoice is in the same financial case. (Replaces `credit-note-targets-final`.)
- **Add `credit-applications-conserve`:** for every `CREDIT_NOTE`, the sum of its source
  `DocumentApplication.amountApplied` is ≤ `totalAmount` (drawable remainder ≥ 0), and each
  target invoice is in the same financial case. **No kind/line assertions.** (Replaces
  `isValidCreditNoteApplication` + folds in `adjustment-has-no-document-application`.)
- **Rename `classifier-reductions-have-matching-credit-note` → `classifier-reductions-have-origin`:**
  an auto-reduction credit note carries `creditOrigin ∈ {REVERSAL, REMOVAL}` and its matching
  classifier activity, regardless of application kind. (Drops the line-targeted/settlement shape
  check.)
- **Regenerate the catalog** (`invariant-catalog.ts` + `invariant-catalog.md`): remove retired
  ids, add `runtime-valid-credit-origin`, `runtime-credit-applications-conserve`, and the renamed
  classifier id; keep phases/scopes consistent with surrounding entries.

### Out of Scope

- Any emission/sweep/refund change (**R2/R3**).
- Retiring the `CAUSE_REVERSAL` / `CREDIT_TO_FINAL` **enum** values (**R4**) — they are still
  emitted, the invariants simply no longer special-case them.
- Touching `document-application-not-over-source`, `charge-invoice-remaining-matches-derived`,
  `computeEffectivePaidFromAllocations`, or `computeCreditNoteAvailable`.
- Any read-layer / receipt / register change.

## Implementation Direction

1. Delete the four invariants + their two helper predicates from `invariants.ts`.
2. Register `valid-credit-origin` (scope `global` or `financial-case`, matching the retired
   `credit-note-targets-final`) — query `CREDIT_NOTE` invoices, assert non-null `creditOrigin`
   and, for `REVERSAL`, a resolvable same-case `reversesInvoiceLineId`.
3. Register `credit-applications-conserve` — for each `CREDIT_NOTE`, aggregate source
   `amountApplied`, assert ≤ `totalAmount` and each target shares the case. Mirror the math of
   `computeCreditNoteAvailable` (do not import behavior; assert the property).
4. Replace the classifier invariant body with the origin-based check, keeping the
   order-activity correlation it already does.
5. Regenerate the catalog files; ensure `npm run test:centralization` (catalog ↔ registry sync)
   passes.

## Observability Checklist

### Dashboards / Metrics
- None new. The replaced invariants run in the same `test:financial-invariants` /
  `assertFinancialCaseInvariants` paths.

### Rollback Plan
- Revert = restore the four invariants + helpers and the catalog entries. No schema or data
  change in R1, so rollback is code-only.
- Non-recoverable data: none.

### Customer-Visible Surface
- None.

## Post-Implementation
- Update `context/reviews/reversal-credit-and-refund-model-decision.md` §4/§7: mark R1 done; the
  invariant set is now origin + conservation; ready for R2 emission change.
- Update `context/progress-tracker.md` Key State + Feature History: credit invariants collapsed
  to origin + conservation; behavior unchanged; R2 (emission) unblocked.

## Acceptance Criteria

- The four taxonomy invariants (+ their helpers) are removed; `valid-credit-origin`,
  `credit-applications-conserve`, and `classifier-reductions-have-origin` are registered and in
  the regenerated catalog; `test:centralization` passes.
- On R0-regenerated data, the new invariants **pass** with today's unchanged emission
  (`CAUSE_REVERSAL` line-targeted, `CREDIT_TO_FINAL`, `SETTLEMENT`), proving kind-agnosticism.
- A deliberately broken fixture fails each new invariant (null origin; REVERSAL without a valid
  line; applications exceeding total) — the conservation/origin guarantees are real.
- No money-math, emission, read-layer, or `computeEffectivePaidFromAllocations` /
  `computeCreditNoteAvailable` change; full financial + OrderCommit regression suite green.
- `npm run build` and `npm run lint` pass.
