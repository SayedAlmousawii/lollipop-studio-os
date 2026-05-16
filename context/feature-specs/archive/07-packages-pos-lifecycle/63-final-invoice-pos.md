## Goal

Rewire the POS invoice flow to create a typed Final Invoice linked to FinancialCase. The employee-facing POS workflow (package selection, upgrades, add-ons, extra photos, payment recording) stays functionally identical. What changes is the underlying invoice creation, grouping, and deposit deduction display. Requires Specs 59–61 to be complete.

---

## Read First

- `src/modules/invoices/invoice.service.ts` — `createInvoiceForOrderWithClient`, `syncOrderInvoiceForFinancialEdit`, `findPrimaryWorkflowInvoiceForOrder`, `normalizePrimaryWorkflowInvoice`, `snapshotInvoiceLineItemsWithClient`, `createAdjustmentInvoice`
- `src/modules/orders/order.service.ts` — `createOrderFromBookingWithClient` and the broader order detail read model
- `src/modules/payments/payment.service.ts` — `recordPaymentWithClient`
- `app/orders/[orderId]/sales/` — POS route, actions, and components
- `prisma/schema.prisma` — FinancialCase, Invoice, Payment, Order models post Spec 59

---

## Rules

- The POS employee workflow must remain functionally unchanged — package selection, upgrades, add-ons, extra photos, and payment recording all work the same way from the employee's perspective
- `syncOrderInvoiceForFinancialEdit` logic is preserved — only its invoice lookup and creation calls are rewired to use `financialCaseId` and `invoiceType = FINAL`
- `normalizePrimaryWorkflowInvoice` is removed entirely — the "promote booking invoice to order invoice" pattern no longer exists
- The Final Invoice is a fresh record, never evolved from the Deposit Invoice
- The deposit deduction line on the Final Invoice display must reference the Deposit Invoice number directly (e.g. `Deposit (INV-00001): -20.000 KD`)
- `originalPackagePriceSnapshot` must be set on the Order at check-in time (go back to `createOrderFromBookingWithClient` and set it from `booking.package.price` when the Order is created)
- `finalPackagePriceSnapshot` must be set when the final package is selected in POS
- Multi-package scenario is deferred — implement for single-package (one Order per Booking) only

---

## Scope

### In Scope

**Remove `normalizePrimaryWorkflowInvoice`**
This function and all call sites are removed. The booking invoice and order invoice are now separate records. No promotion or orderId-stamping occurs.

**Rewire `findPrimaryWorkflowInvoiceForOrder`**
The new lookup: find an invoice with `financialCaseId = order.financialCase.id` and `invoiceType = FINAL` and `parentInvoiceId = null`. Replace the old `jobId`-scoped lookup with this pattern.

**Rewire `createInvoiceForOrderWithClient`**
The new Final Invoice is created with: `invoiceType = FINAL`, `financialCaseId` from the order's FinancialCase (load via `order.bookingId → financialCase`), `orderId`, `bookingId`, `jobId`, `jobNumber`. `totalAmount` calculation is unchanged — package price + add-ons + extra photos.

**Rewire `syncOrderInvoiceForFinancialEdit`**
Replace the invoice lookup from `findPrimaryWorkflowInvoiceForOrder` (old) to the new FinancialCase + type-scoped version. Everything else in the sync logic (delta calculations, total updates, race condition protection) stays the same.

**`originalPackagePriceSnapshot`**
This was set at Order creation time in Spec 61. Verify it is populated before using it in commission-related logic — if it is null, something went wrong in the check-in flow, not here.

**`finalPackagePriceSnapshot`**
When the final package is set or changed in POS (the service function that handles package upgrades in `order.service.ts`), update `Order.finalPackagePriceSnapshot` to the new final package's price. This snapshot is the source of truth for future commission calculations.

**Deposit deduction on Final Invoice display**
On the POS financial summary and Final Invoice display, add a deposit deduction line below the package total:
- Find the Deposit Invoice for this order's FinancialCase: query by `financialCaseId` and `invoiceType = DEPOSIT`
- Read the total paid amount from that invoice (always 20 KD)
- Display as: `Deposit (INV-XXXXX): -20.000 KD` where INV-XXXXX is the deposit invoice's `invoiceNumber`
- Remaining balance = Final Invoice total - 20 KD deposit
- Do not subtract the deposit from `Invoice.totalAmount` itself — it is display-only logic

**Payment type on Final Invoice**
The remaining balance payment recorded against the Final Invoice uses `paymentType = FINAL`. Update the payment recording in the POS payment action to pass `PaymentType.FINAL`. Remove any remaining references to `PaymentType.BASE` (which was removed in Spec 59).

**Adjustment invoices**
`createAdjustmentInvoice` creates child invoices against locked parent invoices. The parent is now always a `FINAL` type invoice (not a mixed booking/order invoice). The function logic is unchanged; just confirm it still works with the new invoice structure — no rewrite needed, only a verify.

### Out of Scope

- Multi-package scenario (deferred)
- Refund and credit note invoice creation
- Commission calculation
- Any booking detail page changes (handled in Spec 62)

---

## Implementation Direction

**FinancialCase access from Order**
The Order does not have a direct `financialCaseId` field. To find the FinancialCase for an order, look it up via `financialCase.bookingId = order.bookingId`. This join appears in several places — consider adding a helper or reading it in the same query when loading order data for POS functions.

**Deposit deduction lookup**
When rendering the Final Invoice display, query for the Deposit Invoice in the same read model query that fetches the Final Invoice: `where: { financialCaseId: ..., invoiceType: 'DEPOSIT' }`. Include `invoiceNumber` and `paidAmount`. This is a read-only lookup — never modify the Deposit Invoice from the POS layer.

**Preserving sync logic integrity**
`syncOrderInvoiceForFinancialEdit` has race condition protection (try/catch on unique constraint violations with recovery). When rewiring the invoice lookup, preserve this protection — the recovery path must also use the new FinancialCase + type lookup.

**`normalizePrimaryWorkflowInvoice` removal**
Before deleting, trace all call sites. It is called from both `findPrimaryWorkflowInvoiceForBooking` and `findPrimaryWorkflowInvoiceForOrder`. After removal, `findPrimaryWorkflowInvoiceForBooking` is no longer needed either (there is no booking-level invoice lookup in the order flow anymore). Remove both if they have no remaining callers.

**Package price snapshot timing**
`originalPackagePriceSnapshot` is set once at order creation and never updated. `finalPackagePriceSnapshot` is updated every time the final package changes in POS (upgrade or selection). When setting `finalPackagePriceSnapshot`, use the package's `price` field at the time of selection — not a derived or computed value.

---

## Post-Implementation

- Update `context/progress-tracker.md`

---

## Acceptance Criteria

1. POS package selection, upgrades, add-ons, extra photos, and payment recording all work as before from the employee's perspective
2. The Final Invoice has `invoiceType = FINAL`, `financialCaseId` set, and is a fresh record independent of the Deposit Invoice
3. `normalizePrimaryWorkflowInvoice` and `findPrimaryWorkflowInvoiceForBooking` are fully removed with no remaining call sites
4. The POS financial summary shows: package total, deposit deduction with Deposit Invoice number reference, and remaining balance
5. `Order.originalPackagePriceSnapshot` is set at order creation (check-in) and equals the booked package price
6. `Order.finalPackagePriceSnapshot` is updated when the final package is selected or changed in POS
7. The remaining balance payment against the Final Invoice uses `paymentType = FINAL`
8. No remaining references to `PaymentType.BASE` exist anywhere in the codebase
9. Adjustment invoices still work correctly against locked Final Invoices
10. TypeScript passes
11. `npm run build` passes
12. `npm run lint` passes
13. Update `context/progress-tracker.md`
