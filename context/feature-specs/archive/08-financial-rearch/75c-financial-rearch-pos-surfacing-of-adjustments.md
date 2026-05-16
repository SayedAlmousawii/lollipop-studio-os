## Goal

Surface unpaid ADJUSTMENT invoices in the POS so staff can collect payment for them alongside (or after) the FINAL. Adjustments are sibling receivables on the same FinancialCase — POS shows them as line entries in the settlement view, accepts payment against each via `createPaymentWithAllocation`, and updates statuses accordingly.

Depends on 75a (createAdjustmentInvoice exists) and 75b (auto-ADJUSTMENTs are actually being created by the classifier).

---

## Read First

- `context/Financial reviews/financial-rearchitecture-master-plan.md` — Phase 2 outline, the "one Final per Order, line blocks grouped" principle (Fork H)
- `~/.claude/projects/-Users-bo3li-Desktop-lollipop-studio-os/memory/project_financial_review_2026_05.md` — Fork S (ADJUSTMENT is a sibling receivable)
- `src/modules/invoices/invoice.service.ts` — current invoice fetch paths for POS (the read path that produces the "outstanding to settle" view)
- `src/modules/payments/payment.service.ts` — `createPaymentWithAllocation` (74c) — the choke point for accepting payments
- POS-related modules — search for the POS final-invoice settlement view code:
  - `src/modules/pos/` if present
  - Otherwise the POS view code in `src/app/` or wherever Next.js routes for POS live
- Existing POS spec 63 (`63-final-invoice-pos.md`) — match the established visual + interaction patterns

---

## Rules

- ADJUSTMENT invoices are siblings of FINAL on the same FinancialCase. POS displays them as additional line entries in the settlement view, not as separate documents that staff must navigate to.
- Payment for an ADJUSTMENT uses `createPaymentWithAllocation` with `invoiceId = ADJUSTMENT.id`, `paymentType = OTHER` (or a new `ADJUSTMENT` PaymentType — see Implementation Direction below), `direction = IN`.
- Multiple unpaid ADJUSTMENTs on one FinancialCase are listed in creation order. Each can be paid independently.
- The FINAL invoice's "remaining balance" math is unchanged — ADJUSTMENTs are not credits against FINAL; they are separate receivables. POS displays the FinancialCase's aggregate outstanding amount as the sum across all open invoices.
- Settlement closure: an ADJUSTMENT closes/locks on its own payment, identical to how FINAL closes. The FinancialCase has no "fully settled" gate beyond every constituent invoice being closed.

---

## Scope

### In Scope

**`PaymentType.ADJUSTMENT` enum value**

Per Fork F's PaymentType list (`DEPOSIT`, `FINAL`, `UPGRADE`, `ADDON`, `OTHER`), add `ADJUSTMENT`. This is a minor schema migration. Backfill: not applicable — no existing rows have this type. Reporting and dashboards filtering by `paymentType` should pick this up automatically.

**POS settlement view — fetch path**

Update the POS data-fetching path that loads the FINAL for an Order to also load every ADJUSTMENT for the same FinancialCase. Example shape:

```ts
type POSettlementView = {
  finalInvoice: InvoiceView;
  adjustments: InvoiceView[];     // sorted by createdAt ASC
  aggregateOutstanding: Money;    // SUM(remainingAmount) across all open invoices on the FinancialCase
};
```

Where `InvoiceView` is the existing POS-facing invoice shape extended with `invoiceType`.

**POS settlement view — UI**

Display FINAL and ADJUSTMENTs in the same settlement panel:
- FINAL block: existing rendering (line items, deposit applied, total, paid, remaining)
- For each open ADJUSTMENT: a smaller block under FINAL showing:
  - Invoice number (e.g., `ADJ-2026-00042`)
  - Line items
  - Total
  - Paid / Remaining
  - "Record Payment" action button (or the equivalent existing pattern)
- Aggregate row at the bottom: "Outstanding total: X KD" summing across FINAL + all open ADJUSTMENTs

For closed ADJUSTMENTs (paid in full and locked): show under a collapsible "Paid adjustments (N)" section so the active settlement view stays focused on what's still due.

**POS — Record Payment action for an ADJUSTMENT**

The "Record Payment" dialog for an ADJUSTMENT is the same component used today for FINAL payments, parameterized by the invoice id. Plumb:
- `invoiceId` and `financialCaseId` (from the ADJUSTMENT being paid)
- `defaultPaymentType = ADJUSTMENT`
- Existing payment-method picker, amount validation (`<= remainingAmount`), and method-specific fields

On submit, calls `createPaymentWithAllocation` with:
```ts
{
  invoiceId: adjustment.id,
  financialCaseId: adjustment.financialCaseId,
  amount: input.amount,
  method: input.method,
  paymentType: 'ADJUSTMENT',
  direction: 'IN',
  paidAt: input.paidAt ?? new Date(),
  reference: input.reference,
}
```

When the ADJUSTMENT's `remainingAmount` reaches zero, the invoice closes and locks via the existing close-on-zero logic (same path FINAL uses). No special-case code.

**Activity log entries**

- "Payment recorded against ADJ-YYYY-NNNNN: X KD via {method}"
- "Adjustment ADJ-YYYY-NNNNN settled and closed"

Use the existing activity-log writers; no new event types needed.

**Edge cases**

- **No adjustments yet:** POS displays only the FINAL block — the adjustments section is hidden (not "0 items").
- **All adjustments closed:** the closed-adjustments collapsible shows; the active settlement is FINAL only.
- **ADJUSTMENT exists but is itself in DRAFT (hypothetical, shouldn't occur with auto-classifier):** treat as not-yet-issued; do not display. The classifier always issues immediately (75b creates them in OPEN state), so this is defensive only.

**Permission considerations**

Recording payment against an ADJUSTMENT uses the same permission gate as recording payment against a FINAL — no new permission. If the project has a `financial.record_payment` gate, ADJUSTMENT payments require the same role.

**Observability**

- Counter `pos.adjustment.payment.recorded{method}` — incremented on each successful ADJUSTMENT payment
- Counter `pos.adjustment.viewed` — incremented when the POS settlement view loads with at least one open ADJUSTMENT visible
- These flow into existing observability dashboards

### Out of Scope

- "Pay all outstanding at once" — single payment covering FINAL + ADJUSTMENT(s) in one transaction. Requires multi-allocation Payment, which is Phase 5. Staff records separate payments per invoice until then.
- Manual "issue surcharge" / "issue ADJUSTMENT" UI for staff to create an ADJUSTMENT independent of the classifier. If needed, lives in a follow-up spec; not required for Phase 2.
- CREDIT_NOTE display (Phase 3)
- REFUND display (Phase 3)
- Customer-facing invoice display changes (POS-internal only in this spec)

---

## Implementation Direction

**`PaymentType.ADJUSTMENT` migration**
- One small Prisma migration adding the enum value
- Match the established pattern from Spec 73 where `PaymentType` was last touched
- No data migration

**POS fetch path**
- Locate the existing FINAL fetch path used by the POS settlement view (one of `getFinalInvoiceForOrder`, `getOrderForPOS`, etc. — name varies)
- Extend the Prisma query to include `financialCase.invoices` filtered to `invoiceType = ADJUSTMENT`, sorted by `createdAt ASC`
- Compute `aggregateOutstanding` server-side

**POS UI**
- Reuse the existing FINAL render component for each ADJUSTMENT block — pass `variant='adjustment'` or similar to drive smaller styling
- Aggregate row at the bottom of the settlement panel
- Collapsible closed-adjustments section uses existing accordion patterns

**Risk:** Low. New code paths are read+UI extensions on existing infrastructure. The Payment creation path was already migrated to `createPaymentWithAllocation` in 74c — adding `paymentType='ADJUSTMENT'` is a one-line addition to the helper's allowed types.

**Rollback:** Revert the UI changes; ADJUSTMENT invoices continue to be created by 75b but won't be visible in POS. Staff would need to settle them via a future spec or manual DB action. (This is a soft rollback — not ideal, but the data integrity is preserved.)

---

## Verification

- `PaymentType.ADJUSTMENT` exists and is accepted by `createPaymentWithAllocation`
- POS settlement view loads for an Order with an unpaid ADJUSTMENT — both FINAL and ADJUSTMENT blocks render, aggregate outstanding sums correctly
- Recording payment against an ADJUSTMENT via POS produces a Payment row with `paymentType=ADJUSTMENT`, `direction=IN`, and one matching PaymentAllocation
- The ADJUSTMENT's `remainingAmount` decreases by the payment amount; on zero, the ADJUSTMENT closes and locks
- All `tests/financial-invariants.test.ts` pass
- Activity log shows the payment entries for the ADJUSTMENT
- Manual test: create an Order, lock the FINAL, add an upgrade via order edit (triggers 75b classifier → ADJUSTMENT), open POS, see the ADJUSTMENT, record payment, confirm closure
