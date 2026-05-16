## Goal

Add the `DocumentApplication` and `PaymentAllocation` tables — schema only, no behavior change. This is the first of five Phase 1 sub-specs (74a–e) that together replace the virtual deposit-credit logic with explicit application + allocation rows. Each sub-spec is independently revertable.

Depends on Spec 73 (Phase 0) and 73b (financial discipline infrastructure).

---

## Read First

- `context/Financial reviews/financial-rearchitecture-master-plan.md` — "Phase 1" outline and "Risk management and invariant discipline" sections
- `prisma/schema.prisma` — current `Invoice`, `Payment` models (post Spec 73)

---

## Rules

- Schema and migration only — no service or UI changes
- New tables are empty after this spec; rows are inserted in 74b
- `PaymentAllocation` MUST NOT have a `UNIQUE (paymentId)` constraint — the single-allocation invariant is app-layer in Phase 1 so Phase 5 can lift it without a schema change
- The CHECK-constraint pattern established in 73b applies — add `CHECK (amount_applied > 0)` on `DocumentApplication` and `CHECK (amount > 0)` on `PaymentAllocation` in the same migration as the table creates

---

## Scope

### In Scope

**New `DocumentApplication` model**
```
model DocumentApplication {
  id               String   @id @default(cuid())
  sourceInvoiceId  String
  targetInvoiceId  String
  amountApplied    Decimal  @db.Decimal(10, 3)
  appliedAt        DateTime @default(now())
  appliedByUserId  String?
  notes            String?
  createdAt        DateTime @default(now())

  sourceInvoice Invoice @relation("DocumentApplicationSource", fields: [sourceInvoiceId], references: [id])
  targetInvoice Invoice @relation("DocumentApplicationTarget", fields: [targetInvoiceId], references: [id])
  appliedBy     User?   @relation(fields: [appliedByUserId], references: [id], onDelete: SetNull)

  @@unique([sourceInvoiceId, targetInvoiceId])
  @@index([sourceInvoiceId])
  @@index([targetInvoiceId])
  @@map("document_applications")
}
```

Add CHECK constraint via raw SQL in the migration: `CHECK (amount_applied > 0)`.

Add inverse relations on `Invoice`:
```
documentApplicationsAsSource DocumentApplication[] @relation("DocumentApplicationSource")
documentApplicationsAsTarget DocumentApplication[] @relation("DocumentApplicationTarget")
```

**New `PaymentAllocation` model**
```
model PaymentAllocation {
  id        String   @id @default(cuid())
  paymentId String
  invoiceId String
  amount    Decimal  @db.Decimal(10, 3)
  createdAt DateTime @default(now())

  payment Payment @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  invoice Invoice @relation(fields: [invoiceId], references: [id])

  @@index([paymentId])
  @@index([invoiceId])
  @@map("payment_allocations")
}
```

Add CHECK constraint via raw SQL: `CHECK (amount > 0)`.

Add inverse relations:
- `Payment.allocations PaymentAllocation[]`
- `Invoice.paymentAllocations PaymentAllocation[]`

### Out of Scope

- Any data backfill (74b)
- Any service-layer code (74c, 74d)
- Removal of `getDepositCreditAmountForFinancialCase` (74e)

---

## Implementation Direction

Single Prisma migration. Order within the migration:
1. Create `document_applications` table with unique + indexes
2. Add CHECK constraint on `amount_applied > 0`
3. Create `payment_allocations` table with indexes (no unique on payment_id)
4. Add CHECK constraint on `amount > 0`

Rollback: drop both tables. Safe because no data exists yet and no service reads them.

---

## Verification

- `\d document_applications` shows the unique on `(source_invoice_id, target_invoice_id)` and the CHECK
- `\d payment_allocations` shows the CHECK and the absence of any unique on `payment_id`
- Prisma client regenerates without error
- All existing financial flows continue to work unchanged (no service touches the new tables yet)
