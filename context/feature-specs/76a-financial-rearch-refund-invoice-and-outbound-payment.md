## Goal

Introduce REFUND invoices and outbound Payments as first-class primitives. Lands `createRefundInvoice` as the sanctioned creation path, recognizes `Payment.direction = OUT`, and adds `Payment.refundOfPaymentId` for traceability. Refunds money out to the customer with full audit symmetry to inbound payment flow.

Depends on 73, 73b, 74a–e. Independent of Phase 2 (75a–c) and the rest of Phase 3 (76b, 76c) — can ship in parallel.

---

## Read First

- `context/Financial reviews/financial-rearchitecture-master-plan.md` — "Phase 3" outline + resolved Forks C, D, U
- `~/.claude/projects/-Users-bo3li-Desktop-lollipop-studio-os/memory/project_financial_review_2026_05.md` — Fork C (REFUND invoice + outbound Payment), Fork D (Payment.direction enum), Fork U (refundOfPaymentId)
- `src/modules/payments/payment.service.ts` — `createPaymentWithAllocation` (the choke point this spec extends to support `direction = OUT`)
- `src/modules/invoices/invoice.service.ts` — invoice creation paths (75a's `createAdjustmentInvoice` is the closest pattern to mirror)
- `src/modules/financial/invariants.ts` — invariant registry
- `prisma/schema.prisma` — `Payment`, `Invoice` models

---

## Rules

- A REFUND-type invoice has positive `totalAmount` — direction is encoded on the Payment, not on the invoice's amount.
- Every outbound Payment (`direction = OUT`) MUST target a REFUND-type invoice. Invariant enforces this.
- `Payment.refundOfPaymentId` is nullable. When set, it points to the originating inbound Payment. When null, the refund is unattributed (e.g., goodwill).
- `createRefundInvoice` is the ONLY sanctioned path for creating REFUND-type invoices.
- Refund amount is capped: the REFUND invoice's `totalAmount` MUST be `<=` the sum of inbound payments allocated to the originating FINAL/ADJUSTMENT minus any prior refunds against the same source. Enforced at service layer with clear error.
- Manager-level permission required to issue a refund. Reason is required.
- Refunds are issued against a specific source invoice (FINAL or ADJUSTMENT) — never against a DEPOSIT in this spec. Deposit refunds are deferred (operationally rare; deposits today are non-refundable per current policy).
- `createPaymentWithAllocation` is extended to accept `direction = OUT` with validation that the target invoice is REFUND-type.

---

## Scope

### In Scope

**`InvoiceType.REFUND` already exists** (from prior lifecycle work) — verify and use as-is.

**`PaymentType.REFUND` enum value**

Add `REFUND` to the existing `PaymentType` enum. Used on every outbound Payment.

**`Payment.refundOfPaymentId` field**

```prisma
model Payment {
  // ... existing fields
  refundOfPaymentId String?
  refundOfPayment   Payment?  @relation("RefundsOfPayment", fields: [refundOfPaymentId], references: [id], onDelete: SetNull)
  refunds           Payment[] @relation("RefundsOfPayment")

  @@index([refundOfPaymentId])
}
```

Nullable. Backfill: not applicable (no existing OUT payments).

**`createRefundInvoice` service helper**

Lives in `src/modules/invoices/invoice.service.ts` (or `invoice.refund.ts` if file structure warrants).

Signature:
```ts
type CreateRefundInvoiceInput = {
  sourceInvoiceId: string;       // the FINAL or ADJUSTMENT being refunded
  amount: Money;                 // total refund amount (positive)
  reason: string;                // required — operational/audit
  createdByUserId: string;       // required — must be a manager
  notes?: string;
};

async function createRefundInvoice(
  input: CreateRefundInvoiceInput,
  tx: PrismaClient | TransactionClient,
): Promise<Invoice>;
```

Behavior:
1. Load source invoice; assert `invoiceType IN ('FINAL', 'ADJUSTMENT')` and `isLocked = true` (only locked invoices have settled payments worth refunding)
2. Compute refundable cap: `SUM(inbound PaymentAllocations to source) - SUM(prior REFUND invoice totals against source)`. Reject if `input.amount > refundableCap`.
3. Verify caller is a manager (delegate to existing permission system)
4. Create REFUND invoice with:
   - `invoiceType = 'REFUND'`
   - `totalAmount = input.amount` (positive)
   - `parentInvoiceId = sourceInvoiceId` (audit pointer)
   - `financialCaseId`, `customerId`, `orderId`, `bookingId`, `jobId` inherited from source
   - `status = 'OPEN'` (or whatever the project's analogue is)
   - `isLocked = false`
   - `issuedAt = now()`
5. Create a single InvoiceLineItem describing the refund (e.g., `{ description: input.reason, quantity: 1, unitPrice: input.amount }`)
6. Run `assertFinancialCaseInvariants(financialCaseId, tx)`
7. Return the REFUND invoice

The outbound Payment is recorded in a separate call (`createPaymentWithAllocation` with `direction = OUT`) — staff records the actual cash/KNET/transfer movement after the REFUND invoice is issued. This mirrors how inbound flow works: invoice exists first, then payment closes it.

**`createPaymentWithAllocation` — extend for outbound**

Update the helper to accept `direction = OUT`:
- If `direction = OUT`: assert the target invoice is REFUND-type. Reject with clear error otherwise.
- If `direction = OUT` and `refundOfPaymentId` supplied: validate the referenced payment exists, is `direction = IN`, and was allocated to the source FINAL/ADJUSTMENT (i.e., the refund traces to a real inbound).
- Payment is created with the new direction; PaymentAllocation row is created normally (the invariant "every Payment has exactly one allocation" holds for OUT payments too in Phase 1's single-allocation regime).

**Invariant registrations**

Append to the 73b registry:

```ts
registerInvariant({
  name: 'out-payment-targets-refund-invoice',
  scope: 'global',
  run: /* every Payment with direction=OUT has invoice.invoiceType='REFUND' */,
});

registerInvariant({
  name: 'refund-amount-not-over-source',
  scope: 'global',
  run: /* for each REFUND invoice, totalAmount <= SUM(inbound payments to parent) - SUM(prior REFUND totals against same parent) */,
});

registerInvariant({
  name: 'refund-trace-points-to-inbound-payment',
  scope: 'global',
  run: /* every Payment.refundOfPaymentId, when set, references a Payment with direction=IN */,
});

registerInvariant({
  name: 'refund-source-is-final-or-adjustment',
  scope: 'global',
  run: /* every REFUND invoice has parentInvoiceId pointing to FINAL or ADJUSTMENT, never DEPOSIT or another REFUND */,
});
```

**Choke-point patterns**

Append to `scripts/check-financial-choke-points.sh`:
- Forbid `prisma.invoice.create` for `invoiceType='REFUND'` outside `createRefundInvoice`
- Forbid `prisma.payment.create` with `direction='OUT'` outside `createPaymentWithAllocation`

**Manager-action UI / API**

Add a "Refund this invoice" action on the POS / financial detail view for FINAL and ADJUSTMENT invoices. Manager-only. Dialog asks for:
- Refund amount (defaulted to remaining refundable cap; user can edit down)
- Reason (required text)
- Original payment reference (optional — populates `refundOfPaymentId`)
- Payment method for the outbound (cash, KNET reversal, bank transfer, etc.)

On submit:
1. Call `createRefundInvoice(...)` → returns the REFUND invoice
2. Call `createPaymentWithAllocation(...)` with `direction='OUT'`, `invoiceId=refund.id`, etc. → records the money-out

Both calls in one transaction.

**ADRs**

Add `src/modules/payments/decisions/002-direction-out-requires-refund-invoice.md`:
> Outbound Payments (direction=OUT) must target REFUND-type invoices. Money out without a REFUND invoice is forbidden. Reason: preserves "every money movement has an invoice" invariant.

Add `src/modules/payments/decisions/003-refund-traceability.md`:
> `Payment.refundOfPaymentId` is nullable to support goodwill refunds. When set, must reference an inbound payment allocated to the same FinancialCase.

**Activity log**

- "Refund invoice REF-YYYY-NNNNN issued: X KD for reason '{reason}'"
- "Refund payment recorded: X KD via {method} (REF-YYYY-NNNNN)"

**Shared fixture**

Append `makeRefundedBookingFixture` to `tests/fixtures/financial.ts`. Builds a cash-deposit booking, settles FINAL, then issues a partial REFUND. Used by Phase 3+ tests.

### Out of Scope

- Refunds of DEPOSIT invoices — operationally rare, current policy is non-refundable; revisit if business needs it
- Partial-refund splits across multiple PaymentMethods (e.g., partly cash, partly KNET) — requires multi-allocation Payment (Phase 5). v1 records one outbound Payment per REFUND invoice
- Refund of a REFUND (reversing a refund) — not in v1; if a refund needs reversal, staff issues an ADJUSTMENT-equivalent inbound flow with reason
- Credit notes (76b)
- Wiring 75b's `ReductionRequiresCreditNoteError` to anything (76c)
- UI polish beyond functional adequacy — POS UX team can iterate later

---

## Implementation Direction

**Risk:** Medium-high. Outbound payments mean real money leaves the business. The refund cap invariant is the primary safety net at the service layer; the CHECK + invariant pair is the secondary safety net at the DB layer.

**Rollback:** Schema rollback drops the `refundOfPaymentId` column. Service rollback removes `createRefundInvoice` and reverts `createPaymentWithAllocation` to reject `direction=OUT`. Any REFUND invoices already created stay in the DB and continue to be valid but cannot be issued anew until rolled forward.

**Why this spec doesn't need a dual-read window:** unlike Phase 1 (where we replaced a central calculation) or Phase 2 (where we replaced a hot-path throw), this is purely additive new behavior. There is no existing "old" refund path to dual-read against. Standard PR review + the invariant suite + integration tests with `makeRefundedBookingFixture` are sufficient.

---

## Verification

- `tests/financial-invariants.test.ts` passes with the four new invariants
- `makeRefundedBookingFixture` produces a working fixture with a partial REFUND issued and an outbound Payment recorded
- Manual test: issue a refund on a paid FINAL via the manager UI → REFUND invoice exists, outbound Payment exists with `direction=OUT` and `refundOfPaymentId` set to the original FINAL payment
- Manual test: attempt to refund more than the refundable cap → clear error, no records created
- Manual test: attempt to create an OUT Payment targeting a non-REFUND invoice → rejected
- Choke-point checker blocks unauthorized `prisma.invoice.create` for REFUND and `prisma.payment.create` for OUT
- Nightly reconciliation reports zero violations
