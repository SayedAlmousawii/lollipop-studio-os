# 156 · B3 — Canonical Settlement Projection

> Plan label **B3** (settlement arc); repo number **156** is provisional — renumber if a
> different spec ships first. Depends on **153 · F1**, **154 · B1**, **155 · B2**.
> Final spec of the settlement arc and the **hard prerequisite for Phase 7's financial
> summary**. See `context/reviews/credit-settlement-application-plan.md` (§6.1, decisions
> #1 projector-rendered, A split-lines presentation).

## Goal

Give the Sales surface **one canonical, single-meaning set of settlement numbers** to
render, instead of the overloaded `customerTotal` / `effectivePaid` / `paidSoFar` /
`remaining` fields it consumes today. After B1/B2 the underlying *documents* reconcile
correctly (settlement applications make per-invoice balances sum to the true outstanding),
so this spec is a **read-layer** unit: define the canonical projection, map clean vs.
draft state, present customer-in-credit as split positive lines (decision A), and repoint
the Sales financial summary onto it — **without** any visual redesign (Phase 7 restyles
on top). No financial math, no document changes.

## Read First

- `context/reviews/credit-settlement-application-plan.md` — §6.1 (canonical projection
  field set), decision #1 (Sales renders, never assembles), decision A (split positive
  lines; credit owed to customer is its own line, never a negative remaining).
- `context/feature-specs/155-B2-adding-side-available-credit-consumption.md` —
  `availableCaseCredit` on `FinancialCaseSummary`.
- `src/modules/order-commits/projections/to-sales-page-financial-preview.ts` — current
  `{ baseline, overlay }` projection; the exact repoint target.
- `src/modules/order-commits/projections/sales-page-view.types.ts` —
  `SalesPageFinancialPreview` shape.
- `src/components/orders/order-commit-financial-sidebar.tsx` — current consumer
  (`baseline.customerTotal/paidSoFar/effectivePaid`, `finalInvoice.remaining`,
  `overlay` previous/pending). Minimal repoint here; no redesign.
- `src/modules/financial-cases/financial-case-summary.service.ts` — field meanings:
  `customerTotal` (owned), `effectivePaid` (cash+credit applied), `remaining` (open
  balances), `overpaymentCapacity` (cash overpaid), `availableCaseCredit` (unapplied
  credit pools).
- `src/lib/formatting/money.ts` — money formatting (raw projector fields only).

## Rules

- **Read-layer only.** No change to invoices, applications, payments, refunds, emission,
  or any money arithmetic. B3 renames/clarifies meaning and re-presents; it does not
  recompute financial state.
- **Single meaning per field.** Each canonical field has exactly one definition and they
  always reconcile (`remaining = open charge balances`, derived from documents).
- **Sales renders, never assembles** (decision #1). The component reads raw canonical
  fields and formats via `money.ts`. No arithmetic in pages/components.
- **Decision A presentation.** Money owed *to* the customer is its own labelled line
  (`availableCredit` / `refundable`); `remaining` is floored at 0 and never shown
  negative.
- **Two display modes** (decision S-D): live overlay (draft preview) while a draft exists;
  last-committed baseline when clean.
- **Do not rewrite unrelated read models.** Orders table, booking section, order header,
  and financial tab consume `remaining`/`customerTotal` and **auto-benefit** from B1/B2's
  document correctness — leave them unless a test shows a stale meaning. Scope is the
  Sales settlement surface.
- No `@/lib/db` imports in `app/**` or `src/components/**`.

## Scope

### In Scope

- A **canonical settlement projection** (extend `toSalesPageFinancialPreview` /
  `SalesPageFinancialPreview`, or add a dedicated projector consumed by it) exposing
  single-meaning fields:
  - **Clean (committed) state:** `orderTotal` (what the customer owns), `paid` (cash
    received), `availableCredit` (unapplied credit-note pools = `availableCaseCredit`),
    `remaining` (open charge balances, ≥ 0), `refundable` (cash overpaid =
    `overpaymentCapacity`), plus deposit/discount breakdown as already available.
  - **Draft state:** `previousTotal`, `newTotal`, `pendingDifference`, and
    `amountDueAfterCommit` (the B2-correct figure: `max(netDelta − availableCredit, 0)`),
    sourced from the existing preview overlay (`preview.totals`, `paymentImpact`).
- Map the canonical fields from existing `FinancialCaseSummary` values (no recompute):
  `orderTotal ← customerTotal`, `paid ← effectivePaid`, `remaining ← remaining`,
  `availableCredit ← availableCaseCredit`, `refundable ← overpaymentCapacity`.
- **Customer-in-credit handling (decision A):** when the customer is owed money, keep
  `remaining = 0` and surface it via `availableCredit`/`refundable` lines — never a
  negative remaining.
- **Repoint the Sales financial summary component** onto the canonical fields (drop the
  ad-hoc `customerTotal`/`paidSoFar`/`effectivePaid` reads). **No visual redesign** — same
  layout, canonical data; Phase 7 restyles later.
- Tests for the projection's clean/draft modes, the in-credit split, and the headline
  scenarios.

### Out of Scope

- **Phase 7 visual redesign** of the sidebar/right column — B3 only makes the data
  canonical; styling, single-view layout, and card structure are Phase 7 B-specs.
- Rewriting orders-table / booking / order-header / financial-tab read models (they
  auto-benefit from B1/B2; out of scope unless a stale-meaning test fails).
- Any change to emission, settlement sweep, available-credit computation (B1/B2), or
  document/math behavior.
- The financial-documents **register** presentation (separate plan).
- No progress-tracker update during this docs-only drafting.

## Implementation Direction

Two tasks.

### Task 1 — Canonical projection

Extend the Sales financial preview projection with the canonical, single-meaning fields
above, mapped straight from `FinancialCaseSummary` (including B2's `availableCaseCredit`)
and the preview overlay. Keep the existing `baseline`/`overlay` raw fields during
transition if other code still reads them, but add the canonical set as the sanctioned
surface. Compute nothing new — every field is a rename/passthrough of a value the summary
already provides. Floor `remaining` at 0 and expose `availableCredit`/`refundable`
separately for the in-credit case (decision A).

Draft vs. clean (decision S-D): when a draft/preview exists, the canonical draft fields
(`previousTotal`/`newTotal`/`pendingDifference`/`amountDueAfterCommit`) drive the display;
when clean, the committed fields do. Mirror how the editable POS surface already chooses
live-vs-committed.

### Task 2 — Repoint Sales summary + tests

Update `order-commit-financial-sidebar.tsx` (and any draft/preview variant) to read the
canonical fields and format via `money.ts`. Keep the current visual structure — this is a
data repoint, not a redesign. Remove now-dead ad-hoc field reads where safe.

Tests (match the projection-parity test layout):
- **Headline:** FINAL 160 paid, then upgrade +100 / remove −10 committed ⇒ canonical
  `orderTotal 250`, `paid 160`, `availableCredit 0`, `remaining 90`.
- **In-credit (decision A):** paid 250, order downgraded to 150 ⇒ `remaining 0`,
  `refundable 50` (or `availableCredit` per source), **no negative remaining** anywhere.
- **Leftover credit available:** unapplied credit pool present ⇒ `availableCredit` > 0,
  `remaining` reflects only open charges.
- **Draft mode:** with a pending add and existing credit ⇒ `amountDueAfterCommit =
  max(netDelta − availableCredit, 0)` matches B2; clean mode shows committed figures.
- **No-assembly guard:** the component performs no money arithmetic; values come from raw
  canonical fields; no `@/lib/db` import in components.
- **Reconciliation:** `remaining` equals the sum of open charge balances for each case
  (documents are the source of truth).

## Observability Checklist

### Dashboards / Metrics

- No production dashboard required.
- No new reconciliation invariant; B3 is presentational over the B1/B2-corrected
  documents.

### Rollback Plan

- Revert the component to the prior ad-hoc field reads and drop the canonical fields from
  the projection. Pure read-layer revert; no data implications.

### Customer-Visible Surface

- The Sales financial summary shows the corrected, single-meaning numbers (e.g.
  `remaining 90`, and a distinct `Available credit` / `Refundable` line when the customer
  is owed money) — same layout, correct values. The visual redesign is Phase 7.

## Post-Implementation

- Update `context/progress-tracker.md` Key State (Financial architecture / POS) + Feature
  History: canonical settlement projection; Sales summary repointed.
- Update `context/reviews/credit-settlement-application-plan.md`: mark B3 implemented and
  the settlement arc complete; note Phase 7's financial summary may now build on the
  canonical projection.
- Note in `context/reviews/pos-sales-redesign-planning.md` that the right-column financial
  summary now has its canonical data source (unblocks that Phase 7 piece).

## Acceptance Criteria

- A canonical, single-meaning settlement projection exists (`orderTotal`, `paid`,
  `availableCredit`, `remaining`, `refundable`, + draft `previousTotal`/`newTotal`/
  `pendingDifference`/`amountDueAfterCommit`), mapped from existing summary values with no
  new computation.
- The Sales financial summary renders these canonical fields and performs no arithmetic;
  the headline scenario shows `orderTotal 250 / paid 160 / availableCredit 0 / remaining
  90`.
- Customer-in-credit shows `remaining 0` plus a distinct `availableCredit`/`refundable`
  line; no surface renders a negative remaining (decision A).
- Draft mode shows the B2-correct `amountDueAfterCommit`; clean mode shows committed
  figures (decision S-D).
- No financial math, document, emission, payment, or refund behavior changes; unrelated
  read models are untouched and remain correct.
- The full financial + projection-parity regression suite passes.
- If this spec adds or changes a financial / composition / workflow / status display
  surface: it consumes the canonical read model + a projector
  (`modules/financial-cases/projections/`) instead of re-deriving in pages or components;
  money read from raw projector fields, formatted via `src/lib/formatting/money.ts`; no
  `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
