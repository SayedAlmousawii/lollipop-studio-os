## Goal

Backfill `DocumentApplication` and `PaymentAllocation` rows for all existing financial data. After this spec, every existing Payment has one PaymentAllocation, and every closed FinancialCase with both DEPOSIT and FINAL invoices has one DocumentApplication. No service behavior changes — the rows are populated but no read path consumes them yet.

Depends on 74a.

---

## Read First

- `context/Financial reviews/financial-rearchitecture-master-plan.md` — "Phase 1" outline
- `src/modules/invoices/invoice.service.ts:1179-1196` — current `getDepositCreditAmountForFinancialCase` (the virtual logic being replaced; backfill must match its semantics exactly)
- `prisma/schema.prisma` — `Invoice`, `Payment`, plus new `DocumentApplication`, `PaymentAllocation` from 74a

---

## Rules

- Data migration only — no service or schema changes
- Backfill runs in a single transaction with pre/post assertions
- Every existing Payment must end this spec with exactly one PaymentAllocation row
- Every FinancialCase with both DEPOSIT (`paidAmount > 0`) and FINAL must end this spec with exactly one DocumentApplication row
- A FinancialCase with a DEPOSIT but no FINAL gets no DocumentApplication — the row will be created at FINAL-invoice-creation time after 74c ships
- DEPOSIT invoices with `paidAmount = 0` are skipped (CHECK constraint forbids zero-amount applications)

---

## Scope

### In Scope

**DocumentApplication backfill**

```sql
INSERT INTO document_applications (id, source_invoice_id, target_invoice_id, amount_applied, applied_at, notes, created_at)
SELECT
  gen_random_uuid()::text,            -- or use a cuid-equivalent; align with Prisma's id strategy
  deposit.id,
  final.id,
  deposit.paid_amount,
  COALESCE(deposit.closed_at, deposit.updated_at),
  'Phase 1 backfill: virtual deposit credit',
  NOW()
FROM invoices deposit
JOIN invoices final
  ON final.financial_case_id = deposit.financial_case_id
  AND final.invoice_type = 'FINAL'
WHERE deposit.invoice_type = 'DEPOSIT'
  AND deposit.paid_amount > 0;
```

**PaymentAllocation backfill**

```sql
INSERT INTO payment_allocations (id, payment_id, invoice_id, amount, created_at)
SELECT
  gen_random_uuid()::text,
  p.id,
  p.invoice_id,
  p.amount,
  p.paid_at
FROM payments p;
```

**Pre-backfill assertions**

Run as part of the migration; abort migration on failure:
- Every FinancialCase has at most one DEPOSIT invoice (`SELECT financial_case_id FROM invoices WHERE invoice_type = 'DEPOSIT' GROUP BY financial_case_id HAVING COUNT(*) > 1` returns no rows)
- Every FinancialCase has at most one FINAL invoice (same check with FINAL)
- No FinancialCase has FINAL without DEPOSIT (`SELECT financial_case_id FROM invoices WHERE invoice_type = 'FINAL' AND financial_case_id NOT IN (SELECT financial_case_id FROM invoices WHERE invoice_type = 'DEPOSIT')` returns no rows)

If any assertion fails, the data is in an unexpected shape — investigate before proceeding.

**Post-backfill assertions**

- `SELECT COUNT(*) FROM payment_allocations` equals `SELECT COUNT(*) FROM payments`
- `SELECT COUNT(*) FROM payments p LEFT JOIN payment_allocations pa ON pa.payment_id = p.id WHERE pa.id IS NULL` returns 0
- For every FinancialCase that has both a paid DEPOSIT and a FINAL: exactly one DocumentApplication row exists with source=DEPOSIT and target=FINAL
- For every PaymentAllocation: `pa.amount = payment.amount` (single-allocation invariant verified)

### Out of Scope

- Service code reading the new tables (74c, 74d)
- Removal of virtual deposit credit logic (74e)

---

## Implementation Direction

Single Prisma migration (data-only). Wrap in a transaction. Use Prisma's raw SQL escape for the INSERT and assertion queries.

ID generation: Prisma cuid generation is not available in raw SQL. Either (a) load existing rows in app code and create via Prisma client in a one-off script, or (b) use a SQL-side UUID generation that's compatible with the cuid String column type. Pick whichever matches the project's existing migration pattern (check `prisma/migrations/` for prior backfills).

Rollback: `DELETE FROM document_applications` + `DELETE FROM payment_allocations`. Safe because no service reads these yet.

---

## Verification

Run on dev data after migration:
- All post-backfill assertions above pass
- No new behavior is visible to users (no service reads these rows yet)
- Existing flows (booking confirmation, deposit recording, POS settlement) work unchanged
