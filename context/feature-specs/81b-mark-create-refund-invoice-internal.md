## Goal

Restrict `createRefundInvoice` to internal use. It is a primitive that issues a REFUND invoice row but does *not* create the paired outbound payment; the only correct public entry point is `issueRefundWithPayment` (refund.service.ts:29), which composes both inside one transaction. Today some paths call `createRefundInvoice` directly and rely on the caller to also create the payment — a footgun. INT-12 (Phase B) flagged this; A5 makes it unreachable as a public symbol.

Closes roadmap item **A5**.

---

## Read First

- `context/reviews/77-post-verification-hardening-roadmap.md` — §5 A5
- `src/modules/invoices/invoice.service.ts:2546` — `createRefundInvoice` (currently exported)
- `src/modules/invoices/invoice.service.ts:2564` — `createRefundInvoiceWithClient` (the inner body)
- `src/modules/refunds/refund.service.ts:20` — `issueRefundWithPayment`'s import of `createRefundInvoice`
- `src/modules/invoices/invoice.service.ts:2503` — lazy import of `issueRefundWithPayment`

---

## Rules

- `createRefundInvoice` and `createRefundInvoiceWithClient` are not exported from `invoice.service.ts`. They become module-private.
- `issueRefundWithPayment` remains the single public refund entry point.
- The lazy import inside `invoice.service.ts:2503` (where `invoice.service` imports `issueRefundWithPayment` to break a circular dependency) stays — but the call surface it exposes is unchanged.
- Any other caller of `createRefundInvoice` outside of `refund.service.ts` is rewired to call `issueRefundWithPayment` instead. If a caller legitimately needs only the invoice (no payment), the right move is to add a new explicit entry point with a clear name, not to keep `createRefundInvoice` public — but no such caller is expected.

---

## Scope

### In Scope

- Remove `export` from `createRefundInvoice` and `createRefundInvoiceWithClient` in `invoice.service.ts`.
- Move them inside `refund.service.ts` if the only legitimate caller is there. Or keep them in `invoice.service.ts` as private and let `refund.service.ts` access them via a more restrictive surface (e.g., an `internal` namespace export).
- Identify any other callers via grep. For each: rewire to `issueRefundWithPayment` with the correct input shape; if any caller cannot be rewired, surface it for owner decision rather than improvising.
- Grep audit: `grep -rn "createRefundInvoice" src` returns matches only inside the refund-service / invoice-service implementation, not in feature code, routes, or server actions.

### Out of Scope

- The refund logic itself — unchanged.
- 79c's overpayment capacity guard — unchanged.
- 76a's REFUND-invoice schema — unchanged.

---

## Implementation Direction

**Risk:** Low. The function still exists; only its visibility narrows. If a caller is missed, TypeScript flags it as a compile error.

**Order of work:**

1. Grep every caller of `createRefundInvoice` and `createRefundInvoiceWithClient`.
2. Decide: relocate to `refund.service.ts` or keep in `invoice.service.ts` as non-exported. Pick whichever produces fewer cross-module references.
3. For each external caller: rewire to `issueRefundWithPayment`. Verify input shape matches.
4. Drop the `export` keyword. Run `npm run build`. Fix any compile errors by rewiring.
5. Grep audit.

**Rollback:** revert the PR. Symbol re-exports; visibility returns.

---

## Verification

- All existing tests pass.
- `npm run build` passes.
- `npm run lint` passes.
- Grep audit: zero matches for `createRefundInvoice` outside of `refund.service.ts` and `invoice.service.ts`.

---

## Post-Implementation

- Update `context/reviews/77-post-verification-hardening-roadmap.md`: mark A5 as completed.
- Update `progress-tracker.md`.
