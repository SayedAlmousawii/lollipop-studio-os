# Invoice Flow vs Current Software Review

## Purpose

This review compares `context/reviews/invoice-flow.md` against the current Studio OS invoice, order, booking, and payment implementation.

## Summary

The current software is fairly close on the happy path. It already supports a rolling booking-to-order invoice, recalculates unlocked invoices, preserves payments, blocks direct edits to locked invoices, and supports positive adjustment invoices for locked parents.

The review document describes a more complete financial adjustment model than the current app has. The main missing areas are automatic locked-invoice adjustment handling, post-delivery invoice locking, refunds, customer credits, and negative credit-note adjustments.

## What Matches

- Rolling booking/order invoice exists.
  - Booking deposit/base payment creates or reuses a booking invoice.
  - Order creation attaches that same invoice to the order.
  - Relevant files:
    - `src/modules/bookings/booking.service.ts`
    - `src/modules/orders/order.service.ts`

- Unlocked order financial edits recalculate the same primary invoice.
  - Package, selected-photo, and add-on changes sync into the existing invoice total.
  - Paid, remaining, and invoice status are recomputed.
  - Relevant files:
    - `src/modules/orders/order.service.ts`
    - `src/modules/invoices/invoice.service.ts`

- Payments are preserved when totals change.
  - Payments are summed from existing payment records.
  - Payments are not deleted during recalculation.
  - Relevant file:
    - `src/modules/invoices/invoice.service.ts`

- Locked invoices block direct recalculation and new payments.
  - Financial order edits against locked invoices currently fail.
  - Payment recording against locked invoices currently fails.
  - Relevant files:
    - `src/modules/invoices/invoice.service.ts`
    - `src/modules/payments/payment.service.ts`

- Adjustment invoices exist.
  - Adjustment invoices can be created for locked parent invoices.
  - They inherit the parent invoice's job, order, booking, and customer context.
  - Relevant file:
    - `src/modules/invoices/invoice.service.ts`

- Invoice ownership integrity is already strong.
  - Invoices require `jobId` and `customerId`.
  - `bookingId` and `orderId` are optional contextual links.
  - Composite relations enforce consistency where present.
  - Relevant file:
    - `prisma/schema.prisma`

## Gaps

### 1. Locked invoice edits do not automatically create adjustment invoices

The review expects locked or closed invoice changes to create adjustment invoices. The current implementation throws an error when an order financial edit attempts to recalculate a locked invoice.

Current behavior:

```text
Order financial edit -> existing locked invoice found -> error
```

Expected review behavior:

```text
Order financial edit -> existing locked invoice found -> create adjustment invoice
```

## 2. Post-delivery adjustment flow is incomplete

Delivered orders cannot be edited, which protects the original order. However, order delivery does not automatically close or lock invoices.

The review expects delivery to close or lock order and invoice records, after which any customer-requested additions should create adjustment invoices only.

Current behavior:

```text
Complete delivery -> order marked delivered -> invoices are not automatically locked
```

Expected review behavior:

```text
Complete delivery -> order marked delivered -> invoice records locked/closed
```

## 3. Refunds are not modeled

The review says refunds must be recorded as refund transactions. The current schema has no refund payment type and payment amounts must be positive.

Current `PaymentType` values:

```text
DEPOSIT
BASE
UPGRADE
ADDON
OTHER
```

Missing:

```text
REFUND
```

or an equivalent explicit refund transaction model.

## 4. Store credit/customer credit balance is not modeled

The review allows credit/refund outcomes for negative adjustments. The current app has no customer credit balance or store-credit ledger.

This should be handled as a separate financial unit because it affects customer balances, invoice settlement, and future invoice application rules.

## 5. Negative adjustment / credit-note path is missing

Adjustment invoice creation currently requires a positive amount. That supports only the "customer owes more" path.

Missing review behavior:

```text
Locked invoice total needs to decrease -> create negative adjustment / credit note
```

Current behavior:

```text
Adjustment total must be greater than 0
```

## 6. Recalculation status differs slightly from the diagram

The review diagram says a recalculated invoice with paid amount `0` should become `ISSUED`.

Current logic preserves `DRAFT` if the invoice was already draft:

```text
DRAFT + paid 0 -> DRAFT
ISSUED + paid 0 -> ISSUED
```

This may be intentional because the invoice foundation spec says paid invoices remain editable until manually closed, and draft invoices can exist before issuance. It should be clarified before changing behavior.

## 7. No invoice line-item ledger

The current invoice model stores totals, not invoice lines. Structured order add-ons exist, and activity metadata records invoice changes, but invoices do not have detailed line items.

This means adjustment history is understandable but not fully ledger-like.

## Recommended Fixes

### 1. Add locked-invoice adjustment handling

Highest priority.

When `syncOrderInvoiceForFinancialEdit` detects an existing locked invoice, it should create a linked adjustment invoice instead of throwing.

Suggested behavior:

```text
if no invoice exists:
  create primary invoice

if primary invoice exists and is not locked:
  recalculate primary invoice

if primary invoice exists and is locked:
  calculate adjustment amount
  create adjustment invoice linked to primary invoice
  do not edit primary invoice
```

This keeps the current order-edit flow useful while preserving locked invoice immutability.

### 2. Decide and implement delivery-time invoice locking

If the review is the intended target, `completeOrder` should close or lock the relevant invoices when the order becomes delivered.

Suggested behavior:

```text
complete delivery
validate production complete
validate payment settled or override recorded
mark order delivered
lock/close primary invoice records
record activity
```

This should be transactional with delivery completion.

### 3. Add refund transaction support as a separate unit

Do not squeeze this into a small invoice adjustment patch.

Likely options:

- Add `REFUND` to `PaymentType` and allow signed payment/refund semantics.
- Or create a separate `Refund` model linked to invoice, payment, customer, and job.

The safer accounting direction is an explicit refund model or explicit transaction direction, instead of overloading positive payments.

### 4. Add credit-note / negative adjustment support

The current `createAdjustmentInvoiceSchema` should eventually allow credit adjustments, but only after the business rule is explicit.

Possible schema direction:

```text
AdjustmentInvoice:
  totalAmount
  adjustmentKind: CHARGE | CREDIT
```

or signed totals if the rest of the financial code is prepared for negative invoice amounts.

### 5. Add customer credit balance later

Store credit needs a ledger, not just a number on `Customer`.

Likely future model:

```text
CustomerCreditTransaction:
  customerId
  jobId?
  invoiceId?
  amount
  type: CREDIT_ISSUED | CREDIT_APPLIED | CREDIT_EXPIRED | CREDIT_ADJUSTED
  reason
  createdById
  createdAt
```

### 6. Clarify `DRAFT` recalculation behavior

Before changing invoice status recalculation, decide whether recalculated draft invoices should remain draft or become issued.

If the review document is authoritative, change:

```text
paid = 0 -> ISSUED
```

If the invoice foundation behavior is authoritative, keep the current draft-preserving logic.

## Suggested Implementation Order

1. Locked-invoice adjustment path for order financial edits.
2. Delivery-time invoice close/lock behavior.
3. Negative adjustment / credit-note support.
4. Refund transaction model.
5. Customer credit ledger.
6. Optional invoice line-item ledger.

## Bottom Line

The current app has the foundation and protects most core records, but it is more "manual positive adjustment invoice" than the full workflow described in `invoice-flow.md`.

The highest-value next fix is the locked-invoice branch: when financial order changes are requested and the invoice is locked, create a linked adjustment invoice transactionally instead of blocking the workflow.
