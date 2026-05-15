## Goal

Delete the three legacy formulas that still recompute order balance and base-payment readiness from raw invoice totals + deposit subtraction, and route every caller through the canonical `Invoice.remainingAmount` produced by the PaymentAllocation/DocumentApplication architecture (Feature 74). The legacy formulas pre-date 74e and are now duplicate logic that can — and does — disagree with the canonical balance, producing the "Paid 255 of 230" display surfaced in Phase E and the "ready to edit while money still due" hazard surfaced in Phase D.

Closes roadmap items **F5**, **D1**, **D2**, **D3**, **A2**, **W3**.

---

## Read First

- `context/reviews/77-post-verification-hardening-roadmap.md` — §2 F5, §3 W3, §6 D1-D3, §5 A2
- `src/modules/orders/order.service.ts:126` — `REQUIRED_BASE_PAYMENT_AMOUNT`
- `src/modules/orders/order.service.ts:3237` — `calculateFinalBalanceDue`
- `src/modules/orders/order.service.ts:3554` — `mapPOSInvoiceSummary` (the `displayRemainingAmount` recomputation at line 3585)
- `src/modules/orders/order.service.ts:4671` — `hasBasePayment`
- Call sites: `order.service.ts:423`, `:471`, `:1786-1787`, `:3748-3749`
- `prisma/schema.prisma` — `Invoice.remainingAmount`, `DocumentApplication` (the canonical sources)
- Feature 74e — cutover spec that made `Invoice.remainingAmount` authoritative

---

## Rules

- After this spec, no code outside Prisma migrations may compute "balance due" or "remaining" from `totalAmount - depositPaid - paidAmount` or any equivalent formula. The only sources of truth are `Invoice.remainingAmount` (per-invoice) and `sum(Invoice.remainingAmount)` (per-order).
- The 20 KD `REQUIRED_BASE_PAYMENT_AMOUNT` threshold is removed. Base-payment readiness becomes a status check, not a magic-number check.
- `mapPOSInvoiceSummary` returns `invoice.remainingAmount` directly. The `paidAmount` and `depositPaidAmount` fields on the POS payload remain as informational display only — they no longer feed any remaining computation.
- Aggregating order-level outstanding balance: `sum(invoice.remainingAmount)` across all invoices in the order's financial case. No subtraction of deposit. Deposit settlement already flows through `DocumentApplication` and is already reflected in each downstream invoice's `remainingAmount`.
- All four deletions ship in one PR. They have no other callers — the grep audit in Verification proves it.

---

## Scope

### In Scope

**Replace `calculateFinalBalanceDue`**

Delete the function (order.service.ts:3237-3250). Replace both call sites with an inline sum:

```ts
const outstandingBalance = order.invoices.reduce(
  (sum, invoice) => sum.plus(invoice.remainingAmount),
  zeroMoney()
);
```

Call sites: `:1787` (editing-start gate) and `:3749` (editing readout). Both already receive the order with `invoices` selected; no query change required.

If the same sum appears in `invoice.calculation.ts`, route through that helper instead of duplicating — per A2's directive. Check during implementation; if not present, the inline `reduce` is acceptable (three lines, twice).

**Replace `mapPOSInvoiceSummary` remaining computation**

In `mapPOSInvoiceSummary` (order.service.ts:3554), delete the `displayRemainingAmount` recomputation at lines 3584-3588:

```ts
// DELETE:
const depositPaidAmount = input.depositInvoice?.paidAmount ?? zeroMoney();
const displayRemainingAmount = Prisma.Decimal.max(
  input.invoice.totalAmount.minus(depositPaidAmount).minus(input.paidAmount),
  0
);
```

The function returns `input.invoice.remainingAmount.toNumber()` directly for `remainingAmount`. The `depositPaidAmount` field on the returned `POSInvoiceSummary` continues to surface `input.depositInvoice?.paidAmount` for display; it is no longer used in any computation.

The `depositInvoice` input field can be narrowed — `paidAmount` is still needed for the informational display, so the field stays. Re-check whether any other consumer of the `paidAmount` argument is doing math on it; if not, the parameter remains as pure passthrough.

**Replace `hasBasePayment`**

Delete `hasBasePayment` (order.service.ts:4671-4679) and `REQUIRED_BASE_PAYMENT_AMOUNT` (:126).

Replacement: a `basePaymentSettled` predicate based on the canonical DEPOSIT invoice (or absence thereof):

```ts
function basePaymentSettled(order: {
  booking: { financialCase: { invoices: Array<{ invoiceType: InvoiceType; remainingAmount: Prisma.Decimal }> } | null };
}): boolean {
  const depositInvoice = order.booking.financialCase?.invoices.find(
    (invoice) => invoice.invoiceType === InvoiceType.DEPOSIT
  );
  if (!depositInvoice) {
    // No deposit invoice for this order — base-payment gate does not apply.
    return true;
  }
  return depositInvoice.remainingAmount.lessThanOrEqualTo(0);
}
```

Semantic change vs. legacy:
- **Before:** "any payment exists on any invoice, OR `depositPaidAmount >= 20`."
- **After:** "the order's DEPOSIT invoice (if present) is fully settled."

This is the W3 fix. Editing-start readiness will now correctly reject orders whose DEPOSIT remains partially paid — even if some other invoice happens to have a payment row.

The two call sites (`:1786`, `:3748`) update to:

```ts
const basePaymentVerified = basePaymentSettled(order);
```

The `depositPaidAmount` local variable at those sites is no longer required for the readiness check; remove it unless another nearby caller still needs it (the editing-readout site at :3748 may still display it — keep it there as a display value only).

**Aggregate outstanding (POS detail page)**

In the POS detail page assembly (around `order.service.ts:481`), the `aggregateOutstanding` calculation already sums `finalInvoice.remainingAmount + openAdjustmentInvoices.remainingAmount`. That logic is correct post-74e and stays. The only change here is that `finalInvoice.remainingAmount` now comes from `Invoice.remainingAmount` (via the updated `mapPOSInvoiceSummary`) rather than the deposit-subtraction recompute — so the field becomes correct without any structural change at this site.

**Regression tests**

`tests/orders/canonical-balance-display.test.ts`:

- Test A: order with FINAL = 230 KD, fully-paid DEPOSIT = 30 KD (allocated to FINAL via DocumentApplication), one direct payment on FINAL = 200 KD → POS summary shows `remainingAmount = 0`, NOT the legacy `230 - 30 - 200 = 0` coincidence (verify by also testing Test B).
- Test B: order with FINAL = 230 KD, fully-paid DEPOSIT = 30 KD (already allocated), direct payment on FINAL = 100 KD → canonical `remainingAmount = 100`. Legacy formula would produce `230 - 30 - 100 = 100` (same), but the test asserts that the value comes from `Invoice.remainingAmount` by mutating that column directly to 999 in setup and asserting the summary reflects 999 (proving the formula is no longer used).
- Test C (W3 regression): order with DEPOSIT = 30 KD, paid only 15 KD (remaining 15). `basePaymentSettled(order)` returns `false`. Editing-start gate rejects.
- Test D (W3 regression): order with no DEPOSIT invoice (deposit-not-required flow). `basePaymentSettled(order)` returns `true`.
- Test E (W3 regression): order with DEPOSIT = 30 KD, fully paid. `basePaymentSettled(order)` returns `true`.

**Grep audit** (also part of Verification):

```bash
grep -rn "calculateFinalBalanceDue\|REQUIRED_BASE_PAYMENT_AMOUNT\|hasBasePayment" src
# expected: zero matches
```

### Out of Scope

- **F4** Adjustment-cause ledger — **79a** (already shipped or in flight when this lands).
- **F2** Overpayment capacity guard — **79c**.
- **W2/O4** Manager prompt on reductive locked edits — **79d**.
- **O2** Canonical order-header settlement display — Sprint 4. This spec fixes the per-invoice and editing-readiness sites; the order-header chrome refactor is a separate consumer.
- **F7** Cached `paidAmount` field — kept (per §12). This spec does not touch `paidAmount`; it only stops *subtracting* it from a recomputed remaining.
- Any change to deposit-allocation logic, DocumentApplication writes, or invoice status transitions. The canonical sources are not modified — they are simply consumed.

---

## Implementation Direction

**Risk:** Medium. Pure deletion is mechanical, but the editing-readiness semantic shift (W3) is a real behavior change — orders previously gated open by "some other invoice has a payment" will now be gated closed until DEPOSIT settles. This is the intended fix; the regression tests prove it. Watch for fixture orders in existing tests that relied on the loose legacy check; expect a handful of test updates.

**Order of work:**

1. Replace `calculateFinalBalanceDue` first (smallest blast radius — just two callers). Run `npm run build`. Existing tests pass because the canonical balance equals the legacy balance for any order whose DEPOSIT has been fully allocated.
2. Replace `mapPOSInvoiceSummary` remaining computation. Run `npm run build`. POS detail snapshot tests may need updating if they hard-coded the legacy value for orders with partially-paid deposits.
3. Replace `hasBasePayment` with `basePaymentSettled`. Add Tests C, D, E. Fix any existing test fixtures that relied on the loose check.
4. Delete `REQUIRED_BASE_PAYMENT_AMOUNT`. Run grep audit.
5. Add Tests A, B for the POS summary.

**Why a status check, not an amount check, for base-payment readiness:** the 20 KD floor was a heuristic from before deposit invoices were modeled. Today every order that requires a deposit has a DEPOSIT invoice with its own `totalAmount` and `remainingAmount`. The correct gate is "is that invoice settled?" — same source of truth as everywhere else.

**Rollback:** Revert the PR. The deleted functions are pure (no migrations, no schema, no side effects), so revert is clean. Editing-readiness gate reverts to the loose legacy check; no data corruption either way.

---

## Verification

- Grep audit: `grep -rn "calculateFinalBalanceDue\|REQUIRED_BASE_PAYMENT_AMOUNT\|hasBasePayment" src` returns **zero** matches.
- Grep audit: `grep -rn "totalAmount.*minus.*depositPaidAmount\|totalAmount\.minus.*paidAmount" src` returns **zero** matches (or only matches inside `Invoice.remainingAmount`-computing code, which lives in the canonical writer path, not in display/gating code).
- All five regression tests pass.
- All existing tests pass (after expected fixture updates for the W3 semantic change).
- `npm run build` passes.
- `npm run lint` passes.
- Manual: in dev, find an order with a partially-paid DEPOSIT. Confirm the editing-start gate rejects with the appropriate error (W3 fix).
- Manual: open the POS detail page for an order with multiple settled and unsettled invoices. Confirm displayed remaining balances match `Invoice.remainingAmount` exactly (the "Paid 255 of 230" shape no longer reachable).

---

## Post-Implementation

- Update `context/reviews/77-post-verification-hardening-roadmap.md`: mark F5, D1, D2, D3, A2, W3 as completed.
- Update `progress-tracker.md`.
