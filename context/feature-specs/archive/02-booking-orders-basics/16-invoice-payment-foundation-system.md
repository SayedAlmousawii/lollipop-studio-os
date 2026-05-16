## Goal
Create the foundation for how Studio OS handles invoices, payments, locked records, and later financial adjustments.
This feature should support the rule:
Booking = appointment  
Order = customer job / deliverables  
Invoice = billing document  
Payment = actual money received  
Adjustment = change after invoice is locked or finalized  
---
## Read First
- Read `agents.md`
- Read `context/project-overview.md`
- Read `context/architecture-context.md`
- Read `context/progress-tracker.md`
- Use existing architecture and module structure
- Do not modify shadcn/ui generated files
---
## Core Rules
1. Revenue reports must be based on payments, not invoice totals.
2. A paid invoice is not automatically closed.
3. A closed/locked invoice cannot be edited directly.
4. If a customer adds something after invoice is locked, create an adjustment invoice.
5. Payments are append-only. Do not overwrite old payment records.
6. Every financial change should be traceable.
---
## Suggested Invoice Status Flow
```text
DRAFT → ISSUED → PARTIAL → PAID → CLOSED

Meaning:

* DRAFT: editable, not counted as real issued invoice
* ISSUED: sent/active, no payment yet
* PARTIAL: some payment recorded
* PAID: invoice total fully paid
* CLOSED: locked financial record

⸻

Prisma Schema Updates

Update invoice/payment structure if needed.

Invoice

Add or confirm fields:

model Invoice {
  id              String        @id @default(cuid())
  orderId         String
  order           Order         @relation(fields: [orderId], references: [id])
  invoiceNumber   String        @unique
  totalAmount     Decimal
  paidAmount      Decimal       @default(0)
  remainingAmount Decimal       @default(0)
  status          InvoiceStatus @default(DRAFT)
  isLocked        Boolean       @default(false)
  parentInvoiceId String?
  parentInvoice   Invoice?      @relation("InvoiceAdjustments", fields: [parentInvoiceId], references: [id])
  adjustments     Invoice[]     @relation("InvoiceAdjustments")
  notes           String?
  issuedAt        DateTime?
  closedAt        DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  payments        Payment[]
}

Payment

Payments should be separate records:

model Payment {
  id            String        @id @default(cuid())
  invoiceId     String
  invoice       Invoice       @relation(fields: [invoiceId], references: [id])
  amount        Decimal
  method        PaymentMethod
  paymentType   PaymentType
  paidAt        DateTime      @default(now())
  reference     String?
  notes         String?
  createdAt     DateTime      @default(now())
}

⸻

Services to Create / Update

Create or update:

src/modules/invoices/invoice.service.ts
src/modules/payments/payment.service.ts

Invoice Service Functions

Implement:

createInvoiceForOrder(orderId)
getInvoices()
getInvoiceById(id)
issueInvoice(id)
closeInvoice(id)
recalculateInvoiceStatus(id)
createAdjustmentInvoice(parentInvoiceId, adjustmentData)

Rules:

* closeInvoice() sets:
    * status = CLOSED
    * isLocked = true
    * closedAt = now
* If isLocked === true, do not allow total edits.
* Adjustment invoices must:
    * link to parentInvoiceId
    * have their own invoice number
    * have their own payments
    * not modify the locked parent invoice

⸻

Payment Service Functions

Implement:

recordPayment(invoiceId, data)
getPaymentsByInvoice(invoiceId)
getRevenueByDateRange(startDate, endDate)

Rules:

* recordPayment() creates a new payment row.
* After payment is created, recalculate:
    * invoice paidAmount
    * invoice remainingAmount
    * invoice status

Status logic:

paidAmount = 0 → ISSUED
paidAmount > 0 and paidAmount < totalAmount → PARTIAL
paidAmount >= totalAmount → PAID

Do not automatically close invoice when paid.

⸻

UI Scope

Create basic pages/components only if needed.

Recommended minimal UI:

/invoices

Show table columns:

* Invoice Number
* Customer
* Order
* Total
* Paid
* Remaining
* Status
* Locked
* Created Date
* Actions

Actions:

* View
* Record Payment
* Close Invoice
* Create Adjustment

Use existing table, badge, button, dialog, input, select components.

⸻

Important UX Rules

* Show clear badge for CLOSED invoices.
* Disable editing actions when invoice is locked.
* Show “Create Adjustment” instead of edit for locked invoices.
* Show payment history inside invoice detail view.
* Show parent invoice link if invoice is an adjustment.

⸻

Reporting Rule

Create helper/service logic for revenue:

Revenue = sum(Payment.amount) where paidAt is inside date range

Do not calculate revenue from invoice totals.

⸻

Validation

Use Zod schemas for:

recordPaymentSchema
createAdjustmentInvoiceSchema

Validation rules:

* payment amount must be greater than 0
* adjustment total must be greater than 0
* payment method required
* locked invoice cannot be edited directly

⸻

Out of Scope

Do not build full accounting reports yet.
Do not build PDF invoice generation yet.
Do not build payment gateway integration.
Do not build tax logic.
Do not build refund logic unless already present.
Do not add advanced audit logs unless architecture already has it.

⸻

Acceptance Criteria

* Invoices can be listed.
* Payments can be recorded as separate rows.
* Invoice paid/remaining/status updates after payment.
* PAID invoice remains editable unless manually closed.
* CLOSED invoice becomes locked.
* Locked invoice cannot be directly edited.
* Adjustment invoice can be created for locked invoice.
* Revenue helper calculates from payments by date range.
* TypeScript passes.
* npm run build passes.
* Update context/progress-tracker.md after completion.
