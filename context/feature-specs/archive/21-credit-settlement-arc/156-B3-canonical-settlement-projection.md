# 156 · B3 — Customer Settlement Summary (receipt-style Sales card)

> Plan label **B3** (settlement arc); repo number **156** is provisional.
> **Implementation order: ships AFTER 157 · B2C** — B3's draft `amountDueAfterCommit`
> consumes B2C's corrected adding-side preview, and B3 reuses B2C's financial-owned
> customer-settlement core.
> Depends on **153 · F1**, **154 · B1**, **155 · B2**, **157 · B2C**. Final spec of the
> settlement arc; the **hard prerequisite for Phase 7's financial summary**.
> See `context/reviews/credit-settlement-application-plan.md` — §6.1 and locked decisions
> **#10** (overpayment-backed credit), **#11** (financial-owned customer summary;
> Sales renders, never assembles), **A** (split positive lines).

## Goal

Give the Sales surface **one financial-owned, single-meaning, receipt-style set of
settlement numbers** to render, replacing the overloaded `customerTotal` / `effectivePaid` /
`paidSoFar` / `remaining` it reads today. The financial module owns the meaning (decision
#11); Sales **renders it verbatim** and performs no arithmetic. This is a **read-layer**
unit on top of B2C's customer-settlement core — no financial math, no document changes,
**no visual redesign** (Phase 7 restyles on top).

The numbers are **net (model A, decision #10/#11):** a credit note from a removal reduces
the order's net value; the customer does not hold the gross amount plus a separate credit.
Available credit is **overpayment-backed** and shown only when the customer is actually owed
money (decision A).

## Read First

- `context/reviews/credit-settlement-application-plan.md` — §6.1 (the field set + identity),
  decisions #10, #11, A.
- `context/feature-specs/157-B2C-overpayment-backed-available-credit.md` — the financial-owned
  `computeCustomerSettlement` core (`netCustomerTotal`, `cashPaid`, `remainingDue`,
  `availableCredit`) this renders.
- `src/modules/financial-cases/projections/` — the **existing** financial-owned projector
  family (`to-orders-table-row`, `to-order-header-financial`, `to-sales-sidebar-locked`,
  `to-financial-tab-block`, …). The customer-settlement summary is a new member here, same
  pattern: `FinancialCaseSummary → projection → UI`.
- `src/modules/order-commits/projections/to-sales-page-financial-preview.ts` +
  `sales-page-view.types.ts` — current `{ baseline, overlay }` Sales preview; provides the
  **draft overlay** (`preview.totals`, `paymentImpact`). It must **render**, not derive.
- `src/components/orders/order-commit-financial-sidebar.tsx` — the consumer to repoint.
- `src/lib/formatting/money.ts` — money formatting (raw fields only).

## Rules

- **Financial module owns the meaning; Sales renders (decision #11).** Define the
  customer-settlement summary as a **financial-owned** contract in
  `src/modules/financial-cases/` (projection over B2C's core + the draft overlay). Neither
  the Sales nor the OrderCommit projector may compute net/cash/credit meaning from raw
  fields.
- **Read-layer only.** No change to invoices, applications, payments, refunds, emission,
  sweep, or any money arithmetic. B3 re-presents; it does not recompute financial state.
- **Net presentation (model A).** `netCustomerTotal = grossCharges − creditsIssued`;
  `remainingDue = max(netCustomerTotal − cashPaid, 0)`, floored at 0 — never negative.
- **Overpayment-backed credit (decision #10).** `availableCredit`/`refundable =
  max(cashPaid − netCustomerTotal, 0)`; one figure, two affordances; **shown only when > 0**
  (decision A split line).
- **Receipt card excludes accounting mechanics.** The contract does **not** expose FINAL /
  ADJUSTMENT / CREDIT_NOTE rows, `DocumentApplication`s, `effectivePaid` / `paidSoFar`,
  per-invoice open balances, gross `customerTotal`, or raw pool/capacity figures. Those
  belong to the separate document/accounting detail (register plan).
- **Two display modes (decision S-D).** Live draft overlay while a draft exists; committed
  clean state otherwise.
- **Do not rewrite unrelated read models.** Orders table, booking, order header, financial
  tab auto-benefit from B1/B2/B2C document correctness — leave them (beyond consolidating the
  shared `getNetCustomerTotal`, done in B2C). Scope is the Sales receipt surface.
- No `@/lib/db` in `app/**` or `src/components/**`; the component does no money arithmetic.

## Scope

### In Scope

- **A financial-owned `CustomerSettlementSummary`** (receipt-style) in
  `src/modules/financial-cases/` — a projection over B2C's `computeCustomerSettlement` plus
  the draft overlay, exposing exactly:

  **Clean (committed) state:**
  - `netCustomerTotal` — order total (net)
  - `cashPaid`
  - `remainingDue`
  - `availableCredit` / `refundable` — present only when `> 0` (overpayment, decision A)

  **Draft (pending) state:**
  - `previousTotal`
  - `pendingDelta`
  - `afterCommitTotal`
  - `amountDueAfterCommit` — the B2C-corrected `max(pendingDelta − availableCredit, 0)`,
    sourced from the corrected preview's `paymentImpact.amountDue`

  Plus a `mode: "clean" | "draft"` discriminator (`"draft"` when a preview/draft exists).
  Every field is a passthrough/rename of a value the financial module already computes —
  the **summary computes; the Sales projector and component render**.

- **Repoint the Sales financial sidebar** (`order-commit-financial-sidebar.tsx`, and any
  draft variant) onto the `CustomerSettlementSummary`, formatting via `money.ts`. Drop the
  ad-hoc `customerTotal` / `paidSoFar` / `effectivePaid` / `outstandingAmount` reads and the
  signed `remainingAfterCommit` display. **No visual redesign** — same layout, canonical
  data; Phase 7 restyles.

- Tests for clean/draft modes, the in-credit split (decision A), the headline scenario, and
  the no-arithmetic / no-`@/lib/db` guard.

### Out of Scope

- **Phase 7 visual redesign** of the sidebar / right column — B3 makes the data canonical
  and receipt-shaped; styling, card layout, single-view are Phase 7.
- The **accounting / document detail** view (FINAL/ADJUSTMENT/CREDIT_NOTE/application rows,
  effective-paid, per-invoice balances) — the financial-documents **register** plan.
- Any change to emission, the sweep, B2C's credit basis, or document/math behavior.
- Rewriting orders-table / booking / order-header / financial-tab read models.
- No progress-tracker update during docs-only drafting.

## Implementation Direction

Two tasks.

### Task 1 — Financial-owned `CustomerSettlementSummary`

Add a projection in `src/modules/financial-cases/` (e.g.
`projections/to-customer-settlement-summary.ts`, exported via the projections index) that
takes `FinancialCaseSummary` (+ the draft overlay for draft mode) and returns the receipt
contract above by rendering B2C's `computeCustomerSettlement` figures. Compute nothing new
beyond shaping clean-vs-draft; `remainingDue` floored at 0; `availableCredit` omitted/zero
unless overpaid. Active-stage only (booking stage → a minimal/empty receipt or `null`,
matching the existing projector convention).

Draft vs. clean (decision S-D): when a draft/preview exists, populate the draft fields from
the corrected preview overlay (`previousTotal ← totals.baselineTotal`,
`pendingDelta ← totals.netDelta`, `afterCommitTotal ← totals.pendingTotal`,
`amountDueAfterCommit ← paymentImpact.amountDue`) and set `mode: "draft"`; otherwise the
clean committed figures with `mode: "clean"`.

### Task 2 — Repoint the Sales receipt card + tests

Update `order-commit-financial-sidebar.tsx` to consume `CustomerSettlementSummary` and
format via `money.ts`. Keep the current visual structure — data repoint, not redesign.
Remove now-dead ad-hoc reads. The component must contain **no money arithmetic**.

Tests:
- **Headline (clean):** FINAL 160 paid, then upgrade +100 / remove −10 committed ⇒
  `netCustomerTotal 250`, `cashPaid 160`, `remainingDue 90`, `availableCredit` absent/0 —
  asserted against a **real B1/B2C fixture**, not a hand-built summary.
- **In-credit (decision A):** paid 250, order downgraded to 150 ⇒ `remainingDue 0`,
  `availableCredit/refundable 50`; **no negative remaining** anywhere.
- **Not-overpaid + unapplied credit:** removal on an unpaid order ⇒ `remainingDue` reflects
  the net (lower) total, `availableCredit` **absent** (it is not spendable; decision #10).
- **Draft mode:** with a pending add + overpayment credit ⇒ `amountDueAfterCommit =
  max(pendingDelta − availableCredit, 0)` matches the corrected preview; clean mode shows
  committed figures.
- **No-assembly guard:** the component does no arithmetic; values are raw contract fields;
  no `@/lib/db` import in components; the contract exposes no accounting-mechanic fields.

## Acceptance Criteria

- A **financial-owned** `CustomerSettlementSummary` exists under
  `src/modules/financial-cases/`, exposing the receipt fields (`netCustomerTotal`,
  `cashPaid`, `remainingDue`, `availableCredit`/`refundable`, + draft `previousTotal`,
  `pendingDelta`, `afterCommitTotal`, `amountDueAfterCommit`, `mode`) and **no** accounting
  mechanics. Neither Sales nor OrderCommit projectors derive financial meaning.
- The Sales receipt card renders these and performs no arithmetic; the headline shows
  `netCustomerTotal 250 / cashPaid 160 / remainingDue 90`, asserted on a real fixture.
- Customer-in-credit shows `remainingDue 0` + a distinct overpayment-backed
  `availableCredit`/refundable line; no surface renders a negative remaining (decision A).
- Draft mode shows the B2C-correct `amountDueAfterCommit`; clean mode shows committed
  figures (decision S-D).
- No financial math, document, emission, sweep, payment, or refund behavior changes;
  unrelated read models untouched.
- Consumes the canonical read model + a projector under `modules/financial-cases/`; money
  formatted via `src/lib/formatting/money.ts`; no `@/lib/db` in `app/**` or
  `src/components/**`. The full financial + projection regression suite, `npm run build`,
  and `npm run lint` pass.

## Post-Implementation

- Update `context/progress-tracker.md` Key State + Feature History: financial-owned
  customer-settlement summary; Sales receipt card repointed; settlement arc complete.
- Update `context/reviews/credit-settlement-application-plan.md`: mark B3 implemented and the
  settlement arc complete; Phase 7's financial summary may now build on the customer
  settlement summary.
- Note in `context/reviews/pos-sales-redesign-planning.md` that the right-column receipt card
  now has its canonical, financial-owned data source.
