## Goal

Land the truly additive schema groundwork for the financial rearchitecture without changing any service behavior. Every subsequent financial-rearch spec (73b, 74+) depends on this landing first. No existing flows break.

**OrderAddOn split is NOT in this spec.** It requires paired service migrations and lives in Spec 73c. See that spec before writing any Phase 2 adjustment work.

---

## Read First

- `context/Financial reviews/financial-rearchitecture-master-plan.md` — the architectural rationale and the full phase plan
- `prisma/schema.prisma` — the current `Invoice`, `Payment`, `FinancialCase` models and their indexes
- `src/modules/invoices/invoice.service.ts` — uses of `financialCaseId`, `invoiceType`
- `src/modules/payments/payment.service.ts` — all Payment creation paths (every one needs `direction = IN` set after this spec)
- `src/modules/bookings/booking.service.ts:594-719` — deposit invoice creation; note 20 KD is a floor, not a hardcoded constant

---

## Rules

- Schema and migration only — no service logic changes, no UI changes
- All changes must be additive at the data layer — existing queries return the same results
- Every existing row must have a populated value for every field flipping to NOT NULL before the constraint flips
- Display-layer invoice-number prefixing is OUT of scope here; this spec only adds the enum value and ensures the existing shared sequence keeps working

---

## Scope

### In Scope

**`Invoice.invoiceType` → NOT NULL**
Backfill any null `invoiceType` rows. Today the field is nullable; in practice all rows created since the lifecycle rewrite have it populated. Backfill heuristic: if `parentInvoiceId IS NULL` and the invoice is on a FinancialCase with a FINAL invoice sibling, it is DEPOSIT; otherwise FINAL. Verify with a count query before flipping NOT NULL.

**`Invoice.financialCaseId` → NOT NULL**
Find every Invoice with `financialCaseId IS NULL`. For each: locate or create a FinancialCase using the invoice's `bookingId` (if present), else by walking `customer → bookings`. Populate the FK. Then flip the field to NOT NULL.

**`Payment.financialCaseId` → NOT NULL**
For every Payment with `financialCaseId IS NULL`, copy from `payment.invoice.financialCaseId` (guaranteed populated after the previous step). Flip to NOT NULL.

**New `PaymentDirection` enum**
```
enum PaymentDirection {
  IN
  OUT
}
```

**`Payment.direction PaymentDirection` field**
Add with `@default(IN)`. Backfill all existing rows to `IN` (the default — no-op data step but explicit for clarity). Non-nullable from creation; no separate flip needed.

**`InvoiceType.SALE` enum value**
Append `SALE` to the existing `InvoiceType` enum. No consumer in this spec — Phase 4 (voucher purchases) will use it.

### Out of Scope

- OrderAddOn split → **Spec 73c**
- Any service logic change reading or writing `Payment.direction` (remains `IN` everywhere for now)
- Any consumer of `InvoiceType.SALE`
- Display-layer invoice number prefix mapping
- DocumentApplication and PaymentAllocation tables (Phase 1, Spec 74a)
- Any change to invoice locking, recalculation, or balance logic
- Any UI change

---

## Implementation Direction

**Order of operations within the migration:**
1. Add `PaymentDirection` enum.
2. Add `Payment.direction` with default `IN`.
3. Add `InvoiceType.SALE` enum value.
4. Backfill any orphan `Invoice.financialCaseId`, `Invoice.invoiceType`, `Payment.financialCaseId`.
5. Flip those three to NOT NULL.
6. Run final assertion queries.

**Migration file naming and safety:**
- One Prisma migration covering all steps above
- Wrap backfill steps in a transaction
- After applying, run assertion queries to confirm the NOT NULL flips landed clean

---

## Verification

After running the migration on dev data:
- `SELECT COUNT(*) FROM invoices WHERE financial_case_id IS NULL` → 0
- `SELECT COUNT(*) FROM invoices WHERE invoice_type IS NULL` → 0
- `SELECT COUNT(*) FROM payments WHERE financial_case_id IS NULL` → 0
- `SELECT COUNT(*) FROM payments WHERE direction IS NULL` → 0
- All existing financial flows (booking confirmation, deposit recording, POS settlement, upgrade flows) work unchanged
- `order_add_ons` table is untouched — `packageItemId` column still present, all rows intact
