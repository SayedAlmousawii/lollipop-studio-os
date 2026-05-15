## Goal

Replace `computeRefundableAmountForInvoice` with `computeOverpaymentCapacity` — a capacity calculation that bounds refunds by *actual* overpayment (paid in excess of the net amount owed) rather than by total inbound payment. Today's function returns `inboundPayments − priorRefunds`, which treats any allocated payment as refundable; managers can refund 210 KD on a 230 KD invoice that was only 210-paid (true overpayment = 0). Phase E reproduced this with a 210 vs 45 KD default. The invoice-detail UI must default to and cap input by the new capacity.

Closes roadmap items **F2** and **O1**.

---

## Read First

- `context/reviews/77-post-verification-hardening-roadmap.md` — §2 F2, §8 O1
- `src/modules/invoices/invoice.service.ts:1454` — current `computeRefundableAmountForInvoice` (to be deleted)
- `src/modules/invoices/invoice.service.ts:1482` — `computeCreditNoteCapacityForFinal` (the shape-template for the new function)
- `src/modules/invoices/invoice.service.ts:638` — list-row consumer
- `src/modules/invoices/invoice.service.ts:1778` — refund-creation consumer (server-side cap)
- `app/invoices/[id]/page.tsx` — refund UI (default value, max input)
- `src/modules/invoices/invoice.types.ts:45` — `refundableAmount` field on the API shape

---

## Rules

- True overpayment capacity for an invoice is:

  ```
  capacity =
    sum(inbound PaymentAllocations targeting this invoice)
    − ( invoice.totalAmount − sum(CREDIT_NOTE DocumentApplications targeting this invoice) )
    − sum(prior REFUND invoice totals parented to this invoice)
  ```

  Clamped at zero.

  Reading: "money received against this invoice, minus what is actually owed after credit notes, minus what has already been refunded." Anything above zero is true overpayment and is the only money eligible for refund.

- The current function name `computeRefundableAmountForInvoice` is removed entirely — no compatibility shim. The API field renames from `refundableAmount` to `overpaymentCapacity` so consumers cannot silently keep reading the old loose value.
- The refund UI defaults the amount input to `overpaymentCapacity` and refuses values above it (both client-side validation and server-side enforcement in the refund-creation path).
- Server-side enforcement is the source of truth. UI cap is convenience only — the refund-creation service rejects any request exceeding `computeOverpaymentCapacity(sourceInvoiceId)`.
- Capacity is computed against the canonical sources (`PaymentAllocation`, `Invoice.totalAmount`, `DocumentApplication`, `Invoice` REFUND chains). It does not read `Invoice.paidAmount` or `Invoice.remainingAmount` — those are derived fields and could lag.

---

## Scope

### In Scope

**New service function**

In `src/modules/invoices/invoice.service.ts`, replace `computeRefundableAmountForInvoice` with:

```ts
export async function computeOverpaymentCapacity(
  sourceInvoiceId: string,
  client: DbClient = db
): Promise<Prisma.Decimal> {
  const [inboundAllocations, source, creditNoteApplications, priorRefunds] = await Promise.all([
    client.paymentAllocation.aggregate({
      _sum: { amount: true },
      where: { invoiceId: sourceInvoiceId, payment: { direction: PaymentDirection.IN } },
    }),
    client.invoice.findUnique({
      where: { id: sourceInvoiceId },
      select: { id: true, totalAmount: true },
    }),
    client.documentApplication.aggregate({
      _sum: { amountApplied: true },
      where: {
        targetInvoiceId: sourceInvoiceId,
        sourceInvoice: { invoiceType: InvoiceType.CREDIT_NOTE },
      },
    }),
    client.invoice.aggregate({
      _sum: { totalAmount: true },
      where: { parentInvoiceId: sourceInvoiceId, invoiceType: InvoiceType.REFUND },
    }),
  ]);

  if (!source) throw new Error("Invoice not found");

  const inbound = inboundAllocations._sum.amount ?? new Prisma.Decimal(0);
  const credited = creditNoteApplications._sum.amountApplied ?? new Prisma.Decimal(0);
  const refunded = priorRefunds._sum.totalAmount ?? new Prisma.Decimal(0);

  const netOwed = source.totalAmount.minus(credited);
  return Prisma.Decimal.max(inbound.minus(netOwed).minus(refunded), 0);
}
```

Delete `computeRefundableAmountForInvoice`. Update its two call sites (`:638`, `:1778`) to call `computeOverpaymentCapacity` instead.

**API field rename**

In `src/modules/invoices/invoice.types.ts:45`, rename `refundableAmount: string | null` → `overpaymentCapacity: string | null`. Update the serialization site (around `invoice.service.ts:638`) to emit the new field name. Update the invoice-detail page consumer to read the new field. No compatibility shim.

**Server-side refund cap**

In the refund-creation path (`invoice.service.ts:1778` context — `createRefundInvoice` or whatever wraps the outbound payment):

```ts
const capacity = await computeOverpaymentCapacity(source.id, client);
if (requestedAmount.greaterThan(capacity)) {
  throw new Error(
    `Refund amount ${requestedAmount.toFixed(3)} KD exceeds overpayment capacity ${capacity.toFixed(3)} KD`
  );
}
```

This is in addition to any existing validation. Placed inside the same transaction as the refund creation, after acquiring a row-level lock on the source invoice (following 78a's pattern).

**UI default and cap**

In `app/invoices/[id]/page.tsx`:

- The refund-amount input defaults to `overpaymentCapacity` (or empty if capacity is zero — in which case the entire refund action is hidden, not just disabled).
- `max` attribute on the input is `overpaymentCapacity`.
- Client-side validation rejects values exceeding capacity with the message `Cannot refund more than {capacity} KD (overpayment capacity).`
- If capacity is zero, the refund button is hidden entirely — no "0 KD refund" UX path.

**Regression tests**

`tests/invoices/overpayment-capacity.test.ts`:

- Test A (the Phase E repro): FINAL = 230, paid 210, zero credit notes → capacity = 0. (Legacy function would return 210.)
- Test B: FINAL = 230, paid 250 → capacity = 20.
- Test C: FINAL = 230, paid 210, 50 KD CREDIT_NOTE applied → net owed = 180; capacity = 30. (Legacy function would return 210.)
- Test D: FINAL = 230, paid 250, prior 15 KD REFUND issued → capacity = 5.
- Test E: refund-creation service rejects a 50 KD request when capacity is 20.
- Test F: capacity = 0 → invoice-detail API emits `overpaymentCapacity: "0.000"`; UI hides the refund button (assert via component test or snapshot).
- Test G: concurrent race guard. Create an invoice with `overpaymentCapacity = 20`, then fire two truly concurrent refund-creation requests for 15 KD each using the same service/endpoint path as the rest of the suite. Assert exactly one request succeeds, the other is rejected, and the final refund records/capacity prove the row lock and transaction isolation prevented both from succeeding.

### Out of Scope

- ADJUSTMENT/CREDIT_NOTE flow logic — unchanged. CREDIT_NOTE creation is governed by `computeCreditNoteCapacityForFinal` (separate function, separate semantics).
- F4 adjustment-cause reversal — **79a**.
- F5/D1-D3 legacy formula deletion — **79b**.
- W2/O4 manager prompt — **79d**.
- Bulk refunds across multiple invoices — not in the current product surface.
- Refund authorization role/permission — already gated by the locked-edit / manager permission set; this spec does not change permissions.
- DB-level overpayment CHECK constraint — **C2** is Sprint 3 territory. This spec is service+UI level.

---

## Implementation Direction

**Risk:** Medium. The semantic change is real: managers who relied on refunding "everything received" will see a smaller default. The smaller default is the *correct* default — but expect at least one user-facing question along the lines of "why can't I refund the full 210?" Document the formula in the error message so the answer is on-screen.

**Order of work:**

1. Add `computeOverpaymentCapacity`. Keep `computeRefundableAmountForInvoice` alongside it temporarily. Add Tests A–D.
2. Switch the two service-side call sites to the new function. Run existing tests — expect refund-creation tests with overly-loose fixtures to fail; update them with correct expectations.
3. Add the server-side cap in refund creation. Add Test E.
4. Rename the API field. Update the invoice-detail UI to consume the new field. Add Test F.
5. Delete `computeRefundableAmountForInvoice`. Final `npm run build`.

**Why no compatibility shim:** the rename forces every consumer to acknowledge the semantic change. A silent shim from `refundableAmount` to `overpaymentCapacity` would let stale UI components default to the new (smaller) value without testing — which would still be correct, but the rename catches anyone using the field name expecting the old loose value.

**Rollback:** revert the PR. Refund cap reverts to the loose check. No data corruption — refunds issued under the new code are still mathematically valid; they were just stricter than necessary.

---

## Verification

- All seven regression tests pass.
- All existing tests pass (after fixture updates for the semantic change).
- `npm run build` passes.
- `npm run lint` passes.
- Grep audit: `grep -rn "computeRefundableAmountForInvoice\|refundableAmount" src` returns zero matches.
- Manual: on dev, find or create the Phase E scenario (FINAL 230, paid 210). Confirm the invoice-detail UI shows refund capacity = 0 and the refund button is hidden.
- Manual: create an overpayment (FINAL 100, paid 150). Confirm the UI defaults the refund input to 50, refuses 60, accepts 50.

---

## Post-Implementation

- Update `context/reviews/77-post-verification-hardening-roadmap.md`: mark F2 and O1 as completed.
- Update `progress-tracker.md`.
