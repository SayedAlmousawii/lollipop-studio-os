## Goal

The order header (the chrome at the top of the order detail page that shows totals) still composes its own "paid / remaining" display by summing payment rows directly, which after a refund or credit-note produces the "Paid 255 of 230" shape Phase E reproduced. Replace that bespoke summary with a single canonical settlement summary fed by `Invoice.remainingAmount` and the now-correct per-invoice POS summaries from 79b. One component, one source of truth.

Closes roadmap item **O2**.

---

## Read First

- `context/reviews/77-post-verification-hardening-roadmap.md` — §8 O2, §11 O2
- `context/feature-specs/79b-delete-legacy-deposit-deduction-formulas.md` — established the canonical balance pattern
- The order detail page header component — search `app/orders/[orderId]` for the "Paid X of Y" copy
- `src/modules/orders/order.service.ts:481` — `aggregateOutstanding` calculation (already correct post-79b; the consumer is what needs fixing)

---

## Rules

- All "paid" and "remaining" displays in the order header read from `Invoice.remainingAmount` and the existing `aggregateOutstanding` total. No new payment-row summation in the header.
- The display invariant: `paidDisplayed = totalOrderValue − aggregateOutstanding`. Both sides come from canonical sources. If they disagree, the bug is upstream (invariant violation) and the header should not paper over it.
- Negative remaining is not a valid display state. If `aggregateOutstanding` is somehow negative, surface as `0` and log an error (the invariant runner is the actual detector).
- The header component is a thin renderer. It accepts pre-computed totals from the order-service layer; it does not fetch invoices, payments, or applications itself.

---

## Scope

### In Scope

**Canonical settlement-summary service helper**

In `order.service.ts` (or `invoice.calculation.ts` if that's where 79b consolidated), add:

```ts
export type OrderSettlementSummary = {
  totalOrderValue: number;        // sum of invoice.totalAmount across all non-refund invoices
  paidAmount: number;             // totalOrderValue - aggregateOutstanding (clamped at 0)
  outstandingAmount: number;      // aggregateOutstanding
  refundedAmount: number;         // sum of REFUND invoice totals
  hasOverpayment: boolean;
};

export function computeOrderSettlementSummary(input: {
  invoices: Array<{ invoiceType: InvoiceType; totalAmount: Decimal; remainingAmount: Decimal }>;
}): OrderSettlementSummary;
```

This is pure (no DB access) — the caller already has the invoice rows.

**Header component refactor**

Replace the existing bespoke summary in the order header with a `<OrderSettlementSummary>` (or whatever the existing component naming convention is) that takes `OrderSettlementSummary` as its prop. Remove any payment-row math inside the component.

**Server-side serialization**

The route/server action that hydrates the order detail page emits `OrderSettlementSummary` as part of the order payload. No new round trips.

**Regression tests**

`tests/orders/settlement-summary.test.ts`:

- Test A: order with FINAL 230, paid 100 → `paidAmount = 100`, `outstandingAmount = 130`, `refundedAmount = 0`.
- Test B: same order, then refund 50 (REFUND invoice, outbound payment) → `paidAmount = 100`, `outstandingAmount = 130`, `refundedAmount = 50`. (Refunds do not double-count in the paid bucket; they show in their own bucket.)
- Test C: order with FINAL 230, CREDIT_NOTE 50 (applied to FINAL via DocumentApplication), paid 180 → `paidAmount = 180`, `outstandingAmount = 0`, `refundedAmount = 0`.
- Test D: the Phase E repro shape (paid 255 vs total 230 — the legacy bug) → must NOT be reachable through `computeOrderSettlementSummary`. If the upstream invariants are violated and totals are inconsistent, the function clamps and a log warning fires.
- Snapshot/component test on `<OrderSettlementSummary>` confirming labels and number formatting.

### Out of Scope

- Backend reconciliation of historical orders with inconsistent totals — F6 (this sprint) and the nightly reconciliation runner handle that.
- Changes to invoice-level math — covered by 79b.
- Refund presentation in the activity feed — separate UI, no overlap.
- Per-invoice summaries inside the order detail body — already canonical post-79b.

---

## Implementation Direction

**Risk:** Low-medium. Mostly mechanical. The risk is missing a sub-component inside the header that does its own payment math — grep aggressively.

**Order of work:**

1. Add `computeOrderSettlementSummary` and Tests A–D.
2. Update the order-detail route to serialize the summary.
3. Refactor the header component. Grep for any other payment-summation logic in the order detail tree; eliminate.
4. Visual check on dev across the Phase E shape: order with FINAL + REFUND + CREDIT_NOTE.

**Rollback:** revert the PR. Header reverts to bespoke math; "Paid 255 of 230" can resurface.

---

## Verification

- All four regression tests + snapshot test pass.
- All existing tests pass.
- `npm run build` passes.
- `npm run lint` passes.
- Manual: open the Phase E shape on dev (or construct it). Confirm header shows correct paid/outstanding/refunded buckets; no "Paid 255 of 230".
- Grep audit: no remaining direct `payment.amount.plus` summation in the order-detail UI tree.

---

## Post-Implementation

- Update `context/reviews/77-post-verification-hardening-roadmap.md`: mark O2 as completed.
- Update `progress-tracker.md`.
