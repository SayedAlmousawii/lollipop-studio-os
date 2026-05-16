# Financial System Architecture Review — May 2026

Status: Descriptive review of the **current code** (no proposals).
Scope: Deposits, invoices, payments, financial-case linkage, line-item composition, status transitions, calculations, identifiers, and audit trail.
Sources: `prisma/schema.prisma`, `src/modules/invoices/*`, `src/modules/payments/*`, `src/modules/orders/order.service.ts`, `src/modules/bookings/*`.

This document is a fresh review built by reading current code; it does **not** replace [invoice-flow.md](invoice-flow.md) or [invoice-flow-current-software-comparison.md](invoice-flow-current-software-comparison.md).

---

## 1. Top-level model

The financial domain is anchored on a single aggregate per booking: the **`FinancialCase`**.

```
Booking ──1:1──> FinancialCase ──1:M──> Invoice ──1:M──> Payment
                       │
                       └── (later) ──> Job (set at check-in)
```

[schema.prisma:199-216](../../prisma/schema.prisma#L199-L216) — `FinancialCase { id, bookingId UNIQUE, customerId, jobId? }`.

- A FinancialCase is created the moment a deposit is recorded against a booking.
- At check-in, the case is back-linked to the newly created Job, and every Invoice/Payment inside the case has its `jobId`/`jobNumber` populated in the same transaction ([booking.service.ts:761-774](../../src/modules/bookings/booking.service.ts#L761-L774)).
- All money ever paid for one booking belongs to exactly one FinancialCase. Cross-case netting is not supported.

### Why this matters
A booking can legitimately exist with payments before any Job/Order exists. The `FinancialCase` is the bridge so deposits aren't orphaned during the booking→job transition.

---

## 2. Schema overview

### Financial enums
[schema.prisma:92-130](../../prisma/schema.prisma#L92-L130)

| Enum | Values |
|---|---|
| `InvoiceStatus` | `DRAFT`, `ISSUED`, `PARTIAL`, `PAID`, `CLOSED` |
| `InvoiceType` | `DEPOSIT`, `FINAL`, `ADJUSTMENT`, `REFUND`, `CREDIT_NOTE` |
| `InvoiceLineType` | `PACKAGE_BASE`, `BUNDLE_ADJUSTMENT`, `PACKAGE_UPGRADE`, `ADD_ON`, `EXTRA_PHOTOS`, `MANUAL_DISCOUNT`, `MANUAL_SURCHARGE` |
| `PaymentMethod` | `CASH`, `KNET`, `LINK` |
| `PaymentType` | `DEPOSIT`, `FINAL`, `UPGRADE`, `ADDON`, `OTHER` |

> Note: `REFUND` and `CREDIT_NOTE` exist on `InvoiceType` but no code path actually constructs them today. `MANUAL_DISCOUNT` / `MANUAL_SURCHARGE` line types are likewise reserved but unused.

### Invoice
[schema.prisma:552-589](../../prisma/schema.prisma#L552-L589)

Key fields:
- Identity: `id`, `publicId`, `invoiceSeq` (unique sequence), `invoiceNumber` (e.g. `INV-00001`).
- Context: `financialCaseId?`, `jobId?`, `orderId?`, `bookingId?`, `customerId`, `jobNumber?` (denormalized).
- Type: `invoiceType?` (`DEPOSIT` / `FINAL` / `ADJUSTMENT` / …).
- Money: `totalAmount`, `paidAmount` (default 0), `remainingAmount` (default 0) — all `Decimal(10,3)` (KD with fils precision).
- State: `status` (default `DRAFT`), `isLocked` (default false), `issuedAt`, `closedAt`.
- Adjustment chain: `parentInvoiceId?` self-reference.

### InvoiceLineItem
[schema.prisma:592-608](../../prisma/schema.prisma#L592-L608)

- `invoiceId`, `lineType`, `description`, `quantity`, `unitPrice`, `lineTotal`, `sortOrder`.
- Unique on `[invoiceId, sortOrder]`.
- **Line items are written only on snapshot (close)** — see §6.

### Payment
[schema.prisma:610-633](../../prisma/schema.prisma#L610-L633)

- `id`, `publicId`.
- Linkage: `financialCaseId?`, `jobId?`, `jobNumber?`, `invoiceId` (required).
- Money: `amount` (Decimal, validated positive at app layer — [payment.schema.ts:4-14](../../src/modules/payments/payment.schema.ts)).
- Classification: `method` (CASH/KNET/LINK), `paymentType`, `paidAt`, `reference?`, `notes?`.

> No negative payment support — there is **no refund/reversal type and no second payment row to offset a prior one**.

### Supporting models
- **`Order`** [schema.prisma:411-456](../../prisma/schema.prisma#L411-L456): `originalPackageId?`, `finalPackageId?`, `originalPackagePriceSnapshot?`, `finalPackagePriceSnapshot?`, `selectedPhotoCount?`. These snapshots are the baselines for adjustment math.
- **`OrderAddOn`** [schema.prisma:529-550](../../prisma/schema.prisma#L529-L550): unique on `[orderId, packageItemId]`. Used for both true add-ons (productId) and **package-item upgrades** (packageItemId). Carries `nameSnapshot`, `priceSnapshot`, `quantity`.
- **`IdentifierSequence`** [schema.prisma:635-646](../../prisma/schema.prisma#L635-L646): backs invoice numbers, job numbers, booking refs.

---

## 3. Deposit flow

[booking.service.ts:549-673](../../src/modules/bookings/booking.service.ts#L549-L673), constant at [booking.service.ts:158](../../src/modules/bookings/booking.service.ts#L158)

Hard rule: the deposit is **exactly 20 KD** (`BOOKING_DEPOSIT_AMOUNT = Prisma.Decimal(20)`). Any other amount is rejected ([booking.service.ts:554-556](../../src/modules/bookings/booking.service.ts#L554-L556)).

The whole deposit transaction happens in one Prisma transaction:

1. Validate booking is `PENDING` with no prior deposit.
2. Create the `FinancialCase` (`bookingId`, `customerId`, `jobId=null`).
3. Create a `DEPOSIT` invoice (`totalAmount=20`, `status=DRAFT`).
4. Issue it (`status=ISSUED`).
5. Record a `DEPOSIT` payment of 20 KD against it.
6. Recalculate status → `PAID`.
7. **Immediately close + lock** the deposit invoice: `status=CLOSED`, `isLocked=true`, `closedAt=now()`.
8. Transition booking → `CONFIRMED`.

**Implication**: a deposit invoice is never touched again. There is no flow to refund, void, transfer, or partially apply it. It is a sealed receipt for "20 KD on this booking."

### Carrying the deposit into a job
At check-in ([booking.service.ts:675-786](../../src/modules/bookings/booking.service.ts#L675-L786)):
- A `Job` and an `Order` are created.
- The FinancialCase is updated with the new `jobId`.
- All invoices + payments in the case are stamped with `jobId` and `jobNumber` so downstream job-scoped queries find them without re-joining.

### How the deposit is "applied" to the final invoice
There is **no transfer of money**. Instead, when the final invoice's status is recalculated, the deposit's paid amount is **credited virtually** via [`getDepositCreditAmountForFinancialCase`](../../src/modules/invoices/invoice.service.ts) at [invoice.service.ts:1180-1197](../../src/modules/invoices/invoice.service.ts#L1180-L1197):

```
effectivePaidAmount = directPayments(finalInvoice) + depositPaidAmount(case)
```

The deposit invoice and the final invoice remain independent rows; the final invoice's `paidAmount` field stores **only direct payments**, but its `status` and `remainingAmount` are computed against `effectivePaidAmount`. See §6 for the consequences.

---

## 4. Final invoice lifecycle

### Creation
[invoice.service.ts:108-193 `createInvoiceForOrderWithClient`](../../src/modules/invoices/invoice.service.ts#L108-L193)

Triggered when POS / selection workflow needs an invoice for an order:

1. Load order with packages, add-ons, `selectedPhotoCount`.
2. Require a `FinancialCase` exists.
3. Look up an existing primary `FINAL` invoice in the case (`parentInvoiceId=null, invoiceType=FINAL`) via [`findPrimaryWorkflowInvoiceForOrder`](../../src/modules/invoices/invoice.service.ts#L756-L778) — race-safe.
4. If none: compute total = `packagePrice + addOnSum + extraPhotoCharge`, create invoice (`status=DRAFT`, `invoiceType=FINAL`, fully linked to order/job/booking/customer/case).
5. Record an `INVOICE_ADJUSTED` OrderActivity.

### Recalculation (unlocked only)
[invoice.service.ts:195-319 `syncOrderInvoiceForFinancialEdit`](../../src/modules/invoices/invoice.service.ts#L195-L319)

Called on every financial-effecting order edit (package change, package-item upgrade, add-on add/remove, selected-photo-count change).

- Hard gate: throws if `isLocked || status === CLOSED` ([invoice.service.ts:259-260](../../src/modules/invoices/invoice.service.ts#L259-L260)).
- Recomputes total from scratch, deletes any existing line items (they only exist post-snapshot anyway), updates `totalAmount` and runs the status recalc.

### Closing & snapshotting
[invoice.service.ts:525-556 `snapshotInvoiceLineItemsWithClient`](../../src/modules/invoices/invoice.service.ts#L525-L556) + [`buildInvoiceLineItems`](../../src/modules/invoices/invoice.service.ts#L805-L903)

On close, line items are computed and persisted, the invoice is marked `CLOSED + isLocked + closedAt`. From this point forward:
- No recalculation.
- No edits.
- Further financial deltas must use the **adjustment invoice** path (§5).

### Adjustment invoices
[invoice.service.ts:1003-1074 `createAdjustmentInvoice`](../../src/modules/invoices/invoice.service.ts#L1003-L1074)

- Requires parent invoice to be `isLocked=true` and `invoiceType=FINAL`.
- Creates a new invoice with `invoiceType=ADJUSTMENT`, `parentInvoiceId=parent`, inheriting the parent's job/order/booking/customer/case context.
- **Positive amounts only** ([invoice.schema.ts:4-6](../../src/modules/invoices/invoice.schema.ts)) — credits/refunds cannot be expressed in this flow today.

### Status machine

```
DRAFT ──issue──> ISSUED ──payment──> PARTIAL ──payment──> PAID
                       │                                    │
                       └────── close + lock ────────────> CLOSED  (irreversible)
```

Deposit invoices skip directly from DRAFT through ISSUED → PAID → CLOSED inside the deposit transaction.
Booking transitions to `NO_SHOW` force-close all unlocked invoices in the case ([booking.service.ts:526-540](../../src/modules/bookings/booking.service.ts#L526-L540)).

---

## 5. Payments

### Recording
[payment.service.ts:15-92 `recordPayment` / `recordPaymentWithClient`](../../src/modules/payments/payment.service.ts#L15-L92)

1. Load invoice + existing payments.
2. Compute `remaining = invoice.totalAmount − sum(existingPayments.amount)`.
3. Reject if `remaining ≤ 0` or if the new payment exceeds `remaining`.
4. Insert `Payment` (financialCaseId/jobId/jobNumber pulled from the invoice if not supplied).
5. Recalculate invoice status.
6. Emit a `PAYMENT_RECEIVED` OrderActivity with full metadata (method, type, reference, amount, paidAt).

### POS payment path
[order.service.ts:449-545 `recordPOSPaymentForOrder`](../../src/modules/orders/order.service.ts#L449-L545)

Wraps `recordPaymentWithClient` with:
- Actor + `PAYMENT_CREATE` permission check.
- Invoice-belongs-to-order guard.
- Optional **selection status advancement**: when called with a `selectionStatus` argument and the order is currently `WAITING_SELECTION` with the payment completing the balance, it auto-advances to `SELECTION_COMPLETED` and emits the corresponding activity.

### Important limits
- Single Payment row per transaction; no parent/child for reversals.
- No support for over-payment (validation rejects amount > remaining).
- No tip, fee, or fee-on-method modelling.

---

## 6. Calculations

### Line-item composition
[`buildInvoiceLineItems`](../../src/modules/invoices/invoice.service.ts#L805-L903)

Computed (in this order) from order + package state:

| sortOrder | Line | Formula |
|---|---|---|
| 0 | `PACKAGE_BASE` | `basePackage.price − basePackage.bundleAdjustment` |
| 1 | `BUNDLE_ADJUSTMENT` | `+basePackage.bundleAdjustment` (only if non-zero) |
| 2 | `PACKAGE_UPGRADE` | `finalPackage.price − originalPackage.price` (only if upgrade) |
| 3+ | `ADD_ON` | per `OrderAddOn`: `quantity × priceSnapshot` |
| last | `EXTRA_PHOTOS` | `(selectedPhotoCount − includedPhotoCount) × extraPhotoUnitPrice` |

`extraPhotoUnitPrice` is looked up from a hardcoded product id `"addon-extra-photo"` ([invoice.service.ts:941-946](../../src/modules/invoices/invoice.service.ts#L941-L946)).

### No taxes, no discounts
- Currency is hardcoded to KD. No tax line type. No multi-currency.
- `MANUAL_DISCOUNT` / `MANUAL_SURCHARGE` line types exist but **no code path creates them**. There is no UI or service to apply a manual discount today.

### Invoice status recalculation
[`recalculateInvoiceStatus`](../../src/modules/invoices/invoice.service.ts#L614-L655)

```
directPaidAmount  = Σ payments.amount
depositCredit     = (type=FINAL && financialCaseId) ? case.depositPaidAmount : 0
effectivePaid     = directPaidAmount + depositCredit
remainingAmount   = max(totalAmount − effectivePaid, 0)

status:
  DRAFT or CLOSED → unchanged
  effectivePaid ≥ total  → PAID
  effectivePaid > 0      → PARTIAL
  else                    → ISSUED

Invoice.paidAmount is stored as directPaidAmount only (NOT effective).
```

### Order-level balance
[`calculateFinalBalanceDue`](../../src/modules/orders/order.service.ts#L3281-L3294)

```
rawRemaining     = Σ invoices.remainingAmount
finalBalanceDue  = max(rawRemaining − case.depositPaidAmount, 0)
```

This is the number gating editing-workflow start.

### Payment status label
[order.service.ts:2984-3000 `mapPaymentStatus`](../../src/modules/orders/order.service.ts#L2984-L3000)

| Label | Condition |
|---|---|
| Overridden | invoice `CLOSED` but `remainingAmount > 0` |
| Pending | no invoices, or `paidAmount ≤ 0` |
| Paid | `totalAmount > 0` and `remainingAmount ≤ 0` |
| Partially paid | otherwise |

### Subtle: `Invoice.paidAmount` semantics
`Invoice.paidAmount` stores **direct payments only**. The deposit credit is invisible at the field level but visible in `status` and `remainingAmount`. Any display logic that sums `paidAmount` across invoices to show "total paid for this job" will under-report by the deposit. The POS reading path compensates by joining the deposit explicitly ([order.service.ts:3714-3718](../../src/modules/orders/order.service.ts#L3714-L3718)).

---

## 7. Status gates tied to payment

### Booking
[booking.service.ts:512-519](../../src/modules/bookings/booking.service.ts#L512-L519)
- `PENDING → CONFIRMED` requires a `DEPOSIT`-type payment to exist on the case.

[booking.service.ts:526-540](../../src/modules/bookings/booking.service.ts#L526-L540)
- `→ NO_SHOW` force-closes all unlocked invoices in the case.

### Order
[order.service.ts:4813-4833 `assertEditingReadyToStart`](../../src/modules/orders/order.service.ts#L4813-L4833)

Editing workflow `markStarted` requires:
- `selectionStatus = COMPLETED`
- "base payment verified" = deposit ≥ 20 KD **or** the final invoice has at least one payment ([order.service.ts:4808](../../src/modules/orders/order.service.ts#L4808))
- `outstandingBalance = 0` (full payment gate)
- assigned editor

### Delivered orders
[order.service.ts:1118-1119, 1298-1299, 1412-1413, 1538-1539](../../src/modules/orders/order.service.ts#L1118)
- All financial-edit entry points hard-reject if `status = DELIVERED`. Note however that the **invoice itself is not automatically locked on delivery** — the invoice can remain `PAID` (not `CLOSED`) indefinitely after delivery (see §10).

### POS selection follow-up
[order.service.ts:480-538](../../src/modules/orders/order.service.ts#L480-L538)
- A completing payment recorded via POS while in `WAITING_SELECTION` auto-advances the order to `SELECTION_COMPLETED` and logs the activity.

---

## 8. Identifiers

[invoice.service.ts:1121-1134 `generateInvoiceNumber`](../../src/modules/invoices/invoice.service.ts#L1121-L1134)
- Global PostgreSQL sequence `invoice_number_seq` → `INV-00001`, `INV-00002`, …
- Stored on both `invoiceSeq` (raw int, unique) and `invoiceNumber` (formatted string, unique).
- Not scoped per year/department/customer.

Public IDs:
- `Booking.publicId` via `generateBookingReference` (booking.service.ts:597-600).
- `Order.publicId`, `Invoice.publicId`, `Payment.publicId` via `generatePublicId(..., PUBLIC_ID_KIND.*)`.

Job numbers and booking references are managed via the central `IdentifierSequence` table.

`Payment.reference` is a freeform user-provided field (≤120 chars) — receipt/transfer number, no validation.

---

## 9. Multi-package state (current code)

The current schema and code are **single-package-per-order**:

- `Order.originalPackageId` / `Order.finalPackageId` — exactly one of each, both nullable but typically set at order creation.
- Package change is modelled as `originalPackage → finalPackage` with the delta surfacing as a single `PACKAGE_UPGRADE` line.
- Package-**item** upgrades use `OrderAddOn` rows tagged with `packageItemId` (unique on `[orderId, packageItemId]`), conceptually overlapping the "add-on" type.
- One invoice per order; no per-package invoice splitting; no bundle pricing.
- Booking ↔ Order ↔ Job is structurally 1:1:1.

Specs 70a/b/c (multi-package) are **not yet reflected in code**.

---

## 10. Audit & activity

[schema.prisma:511-527](../../prisma/schema.prisma#L511-L527) — `OrderActivity { orderId, userId?, type, title, description, metadata JSON, createdAt }`

Financial events recorded:

| Event | Type | Source |
|---|---|---|
| Payment recorded | `PAYMENT_RECEIVED` | [payment.service.ts:73-90](../../src/modules/payments/payment.service.ts#L73-L90) |
| Invoice created | `INVOICE_ADJUSTED` | [invoice.service.ts:179-190](../../src/modules/invoices/invoice.service.ts#L179-L190) |
| Invoice recalculated | `INVOICE_ADJUSTED` | inside `syncOrderInvoiceForFinancialEdit` |
| Adjustment invoice created | `INVOICE_ADJUSTED` | [invoice.service.ts:1054-1067](../../src/modules/invoices/invoice.service.ts#L1054-L1067) |
| Package change | `PACKAGE_CHANGED` | order.service.ts |
| Add-on / package-item / extra photos | `ADD_ON_CHANGED` / `SELECTION_UPDATED` | order.service.ts |

Metadata is rich (amounts, deltas, ids, refs) but stored as JSON — not query-typed. No double-entry ledger; no immutable signature; entries can be deleted by anyone with raw DB access.

---

## 11. Gaps & observations grounded in current code

These are descriptive — flagged for awareness, not as prescriptions.

1. **No refund path.** `Payment.amount` is positive-only; `PaymentType` has no `REFUND`; adjustment invoices reject negative amounts. Refunding a customer cannot currently be modelled.
2. **No credit note / negative adjustment.** Enum values exist (`CREDIT_NOTE`, `MANUAL_DISCOUNT`) but no code constructs them. A locked-invoice price reduction has no expression.
3. **Locked-invoice financial edit = error.** `syncOrderInvoiceForFinancialEdit` throws on locked invoices. The "should auto-create adjustment" branch is not implemented — callers must orchestrate it themselves.
4. **Delivery does not lock the invoice.** Only NO_SHOW transitions auto-close unlocked invoices. A delivered order keeps a (still mutable, unless someone closed it) `PAID` final invoice.
5. **`Invoice.paidAmount` excludes deposit credit.** Display consumers must either join the deposit explicitly or use `remainingAmount`/`status`, both of which include the credit.
6. **Deposit is all-or-nothing.** No partial deposit credit, no carryover, no transfer between bookings.
7. **Hardcoded constants.**
   - Deposit amount = 20 KD ([booking.service.ts:158](../../src/modules/bookings/booking.service.ts#L158)).
   - Extra-photo product id = `"addon-extra-photo"` ([invoice.service.ts:941](../../src/modules/invoices/invoice.service.ts#L941)).
   - Currency = KD; `Decimal(10,3)` everywhere.
8. **No discount/surcharge code path.** Line types exist; no service, schema, or UI to apply.
9. **No optimistic locking on Invoice.** `isLocked` prevents recalc but no row version exists; concurrent `syncOrderInvoiceForFinancialEdit` calls rely on transaction ordering.
10. **`OrderAddOn` overloads two concepts.** True add-on (productId set) vs. package-item upgrade (packageItemId set) live in the same table, differentiated by which FK is non-null.
11. **Invoice number sequence is global.** No yearly/departmental scoping; restarts and year-prefix changes would require a sequence migration.
12. **No tax model at all.** Acceptable for current KD-only single-jurisdiction operation; would need new line type + rates table to extend.

---

## 12. Reference map (file → role)

| File | Role |
|---|---|
| [prisma/schema.prisma](../../prisma/schema.prisma) | All financial models, enums, indexes |
| [src/modules/invoices/invoice.service.ts](../../src/modules/invoices/invoice.service.ts) | Invoice create / recalc / close / adjustment / snapshot / line-item build / deposit-credit lookup / number gen |
| [src/modules/invoices/invoice.schema.ts](../../src/modules/invoices/invoice.schema.ts) | Adjustment-invoice input validation |
| [src/modules/invoices/invoice.types.ts](../../src/modules/invoices/invoice.types.ts) | Shared invoice DTO types |
| [src/modules/payments/payment.service.ts](../../src/modules/payments/payment.service.ts) | `recordPayment[WithClient]`, activity logging, balance checks |
| [src/modules/payments/payment.schema.ts](../../src/modules/payments/payment.schema.ts) | Payment input validation (positive, method/type enums) |
| [src/modules/bookings/booking.service.ts](../../src/modules/bookings/booking.service.ts) | `recordBookingDeposit`, status gates, check-in financial-case linking, NO_SHOW auto-close |
| [src/modules/orders/order.service.ts](../../src/modules/orders/order.service.ts) | POS payment, financial-effecting order edits, balance/status display, editing-workflow payment gate |

---

*End of review. For the existing flow documentation and the comparison against the "intended" spec, see [invoice-flow.md](invoice-flow.md) and [invoice-flow-current-software-comparison.md](invoice-flow-current-software-comparison.md). For planned changes, see [lifecycle-review.md](lifecycle-review.md) and the `project_lifecycle_architecture` memory entry.*
