## Goal

Land all additive schema for the financial rearchitecture without changing any service behavior. This is the foundation that every subsequent financial-rearch spec (74+) depends on. No new behavior is introduced — existing flows keep working unchanged after this spec ships.

---

## Read First

- `context/Financial reviews/financial-rearchitecture-master-plan.md` — the architectural rationale and the full phase plan
- `prisma/schema.prisma` — the current `Invoice`, `Payment`, `OrderAddOn`, `FinancialCase` models and their indexes
- `src/modules/invoices/invoice.service.ts` — uses of `financialCaseId`, `invoiceType`, and invoice numbering
- `src/modules/payments/payment.service.ts` — all Payment creation paths (every one needs `direction = IN` set)
- `src/modules/bookings/booking.service.ts:594-719` — deposit invoice creation; note that 20 KD is a floor, not a hardcoded constant

---

## Rules

- Schema and migration only — no service logic changes, no UI changes
- All changes must be additive at the data layer — existing queries continue to return the same results
- Every existing row must have a populated value for every field flipping to NOT NULL before the constraint flips
- `OrderAddOn` split is the only data migration step in this spec — write it idempotently with row-count assertions pre/post
- Display-layer invoice-number prefixing is OUT of scope here; this spec only adds the enum value and ensures the existing shared sequence keeps working

---

## Scope

### In Scope

**`Invoice.invoiceType` → NOT NULL**
Backfill any null `invoiceType` rows. Today the field is nullable; in practice all rows created since the lifecycle rewrite have it populated. Backfill heuristic: if `parentInvoiceId IS NULL` and the invoice is on a FinancialCase with a Final invoice, it is DEPOSIT; otherwise FINAL. Verify with a count query before flipping NOT NULL.

**`Invoice.financialCaseId` → NOT NULL**
Find every Invoice with `financialCaseId IS NULL`. For each: locate or create a FinancialCase using the invoice's `bookingId` (if present), else by walking `customer → bookings`. Populate the FK. Then flip the field to NOT NULL.

**`Payment.financialCaseId` → NOT NULL**
For every Payment with `financialCaseId IS NULL`, copy from `payment.invoice.financialCaseId` (which is guaranteed populated after the previous step). Flip to NOT NULL.

**New `PaymentDirection` enum**
```
enum PaymentDirection {
  IN
  OUT
}
```

**`Payment.direction PaymentDirection` field**
Add with `@default(IN)`. Backfill all existing rows to `IN` (already the default — no-op data step, but explicit for clarity). No flip to NOT NULL needed; the field is non-nullable from creation with a default.

**`InvoiceType.SALE` enum value**
Append `SALE` to the existing `InvoiceType` enum. No consumer in this spec — Phase 4 (voucher purchases) will use it.

**OrderAddOn split**

Rename `OrderAddOn` semantics to "true add-ons only" and extract upgrades into a new model.

New `OrderPackageItemUpgrade` model:
```
model OrderPackageItemUpgrade {
  id              String   @id @default(cuid())
  orderId         String
  orderPackageId  String
  packageItemId   String   // required, references the snapshotted package item being upgraded
  nameSnapshot    String
  priceSnapshot   Decimal  @db.Decimal(10, 3)
  quantity        Int      @default(1)
  notes           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  order        Order        @relation(...)
  orderPackage OrderPackage @relation(...)
  packageItem  PackageItem  @relation(...)

  @@unique([orderId, orderPackageId, packageItemId])
  @@index([orderId])
  @@index([orderPackageId])
  @@index([packageItemId])
  @@map("order_package_item_upgrades")
}
```

Updated `OrderAddOn` model:
- Make `productId` non-nullable (true add-ons always reference a product)
- Remove the `packageItemId` field entirely
- Remove the `packageItem` relation
- Update the unique constraint from `([orderId, orderPackageId, packageItemId])` to `([orderId, orderPackageId, productId])`

Data migration:
1. Insert into `order_package_item_upgrades` every row from `order_add_ons` where `packageItemId IS NOT NULL`. Mapping is 1:1.
2. Delete those rows from `order_add_ons`.
3. Assert: `count(order_add_ons WHERE packageItemId IS NOT NULL) = 0` before applying the schema change that drops the column.
4. Assert: `count(order_add_ons_pre) = count(order_add_ons_post) + count(order_package_item_upgrades_post)`.

### Out of Scope

- Any service logic change reading or writing `Payment.direction` (it remains `IN` everywhere for now)
- Any consumer of `InvoiceType.SALE`
- Display-layer invoice number prefix mapping (Phase 4 or a small follow-up display spec)
- DocumentApplication and PaymentAllocation tables (Phase 1, Spec 74)
- Any change to invoice locking, recalculation, or balance logic
- Any UI change

---

## Implementation Direction

**Order of operations within the migration:**
1. Add `PaymentDirection` enum.
2. Add `Payment.direction` with default `IN`.
3. Add `InvoiceType.SALE` enum value.
4. Add new `OrderPackageItemUpgrade` table (empty).
5. Data migration: split OrderAddOn rows into upgrades vs add-ons.
6. Drop `OrderAddOn.packageItemId` column + its relation + its index + update unique.
7. Make `OrderAddOn.productId` NOT NULL.
8. Backfill any orphan `Invoice.financialCaseId`, `Invoice.invoiceType`, `Payment.financialCaseId`.
9. Flip those three to NOT NULL.
10. Run a final assertion query: every Invoice has `financialCaseId` and `invoiceType`; every Payment has `financialCaseId` and `direction`.

**Composite constraint audit:**
The current OrderAddOn unique `(orderId, orderPackageId, packageItemId)` allows multiple rows where two of the three values are equal. The new constraints split this: OrderAddOn becomes `(orderId, orderPackageId, productId)`; OrderPackageItemUpgrade becomes `(orderId, orderPackageId, packageItemId)`. Verify no existing rows violate the new constraints before the split (an existing OrderAddOn with both `productId` and `packageItemId` populated is a data bug — should be impossible per current creation paths, but assert with a count query first).

**Service code touch list (read-only audit, no edits in this spec):**
Search every reference to `OrderAddOn` in `src/` and document which references need to split between add-ons and upgrades in the Phase 2 spec. Do not edit them here. Catalogue the references in a comment block at the top of the migration file so Phase 2 can implement the split.

**Migration file naming and safety:**
- One Prisma migration that includes all steps above
- Wrap data migration steps in a transaction
- After applying, run a smoke verification script (or DB query) that asserts the four "every X has Y" invariants listed above

---

## Verification

After running the migration on dev data:
- `SELECT COUNT(*) FROM invoices WHERE financial_case_id IS NULL` → 0
- `SELECT COUNT(*) FROM invoices WHERE invoice_type IS NULL` → 0
- `SELECT COUNT(*) FROM payments WHERE financial_case_id IS NULL` → 0
- `SELECT COUNT(*) FROM payments WHERE direction IS NULL` → 0
- `SELECT COUNT(*) FROM order_add_ons WHERE package_item_id IS NOT NULL` → column no longer exists (query errors)
- `SELECT COUNT(*) FROM order_package_item_upgrades` → matches the pre-migration count of `order_add_ons WHERE packageItemId IS NOT NULL`
- All existing financial flows (booking confirmation, deposit recording, POS settlement) work unchanged
