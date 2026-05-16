## Goal

Add two database-level guardrails the service layer already enforces, so a future bug, migration, or direct DB write cannot violate either: (1) total `PaymentAllocation.amount` against an invoice cannot exceed `Invoice.totalAmount` (over-collection), and (2) an `Invoice` of type `ADJUSTMENT` cannot have a `parentInvoiceId` pointing at another `ADJUSTMENT` (chaining). Both are caught at the service layer today; both have been escape-vector candidates per Phase F review. With 80b's lock trigger establishing the pattern, this spec adds two more belt-and-suspenders checks on the same theme.

Closes roadmap items **C2** and **C3**.

---

## Read First

- `context/reviews/77-post-verification-hardening-roadmap.md` — §4 C2, §4 C3, §11
- `prisma/schema.prisma:654` — `Invoice`
- `prisma/schema.prisma:774` — `PaymentAllocation`
- `src/modules/payments/payment.service.ts` — service-level over-collection check (line ~233 currently)
- `src/modules/invoices/invoice.service.ts` — service-level ADJUSTMENT-parent check (`createAdjustmentInvoice`)
- `context/feature-specs/80b-invoice-lock-snapshot-and-db-immutability.md` — the trigger pattern this spec mirrors

---

## Rules

- C2 is enforced via a `BEFORE INSERT OR UPDATE` trigger on `PaymentAllocation`: the trigger sums all allocations against the target invoice (including `NEW`) and raises if the total exceeds `Invoice.totalAmount`. Both directions are checked (IN and OUT) — though OUT allocations don't logically over-collect, the trigger is symmetric to keep the predicate simple.
- C3 is enforced via a `BEFORE INSERT OR UPDATE` trigger on `Invoice`: if `NEW.invoiceType = 'ADJUSTMENT'` and `NEW.parentInvoiceId IS NOT NULL`, look up the parent's type and raise if it equals `'ADJUSTMENT'`. This blocks chaining at the level the service-layer check already enforces.
- Both triggers fire in **all environments** including local dev. There is no GUC bypass. (Same rationale as 80b.)
- Both triggers raise PostgreSQL `check_violation` exceptions so Prisma surfaces them consistently with 80b's pattern.
- Existing service-level checks remain — the DB triggers are defense-in-depth, not replacement. A failing service-level check produces a cleaner error message; the trigger is the safety net.

---

## Scope

### In Scope

**C2 — over-collection trigger**

```sql
CREATE OR REPLACE FUNCTION reject_payment_allocation_overcollection()
RETURNS TRIGGER AS $$
DECLARE
  invoice_total NUMERIC(10, 3);
  current_total NUMERIC(10, 3);
BEGIN
  SELECT "totalAmount" INTO invoice_total
    FROM "Invoice" WHERE id = NEW."invoiceId"
    FOR UPDATE;

  IF invoice_total IS NULL THEN
    RAISE EXCEPTION 'PaymentAllocation references non-existent invoice %', NEW."invoiceId"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO current_total
    FROM "PaymentAllocation"
    WHERE "invoiceId" = NEW."invoiceId"
      AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF (current_total + NEW.amount) > invoice_total THEN
    RAISE EXCEPTION
      'PaymentAllocation over-collection: invoice % total %, would become %',
      NEW."invoiceId", invoice_total, current_total + NEW.amount
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reject_payment_allocation_overcollection
BEFORE INSERT OR UPDATE ON "PaymentAllocation"
FOR EACH ROW
EXECUTE FUNCTION reject_payment_allocation_overcollection();
```

The `TG_OP = 'INSERT' OR id <> NEW.id` clause excludes the row being updated from the sum so updates don't double-count.

**C3 — ADJUSTMENT chain trigger**

```sql
CREATE OR REPLACE FUNCTION reject_adjustment_invoice_chaining()
RETURNS TRIGGER AS $$
DECLARE
  parent_type "InvoiceType";
BEGIN
  IF NEW."invoiceType" = 'ADJUSTMENT' AND NEW."parentInvoiceId" IS NOT NULL THEN
    SELECT "invoiceType" INTO parent_type
      FROM "Invoice" WHERE id = NEW."parentInvoiceId";

    IF parent_type = 'ADJUSTMENT' THEN
      RAISE EXCEPTION
        'ADJUSTMENT invoice cannot reference another ADJUSTMENT as parent (% → %)',
        NEW.id, NEW."parentInvoiceId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reject_adjustment_invoice_chaining
BEFORE INSERT OR UPDATE ON "Invoice"
FOR EACH ROW
EXECUTE FUNCTION reject_adjustment_invoice_chaining();
```

The C3 trigger ships in its own raw-SQL migration. Its rollback drops only `trg_reject_adjustment_invoice_chaining` and `reject_adjustment_invoice_chaining()`.

The C2 trigger ships in a second raw-SQL migration. Its rollback drops only `trg_reject_payment_allocation_overcollection` and `reject_payment_allocation_overcollection()`.

**Regression tests**

`tests/financial/db-constraints.test.ts`:

- Test A (C2): create invoice `totalAmount = 100`, allocate two payments of 60 each → second allocation throws `check_violation`. Sum stays at 60.
- Test B (C2): allocate 100, then attempt to UPDATE that allocation to 101 → throws.
- Test C (C2): update an allocation downward (100 → 80) → succeeds.
- Test D (C3): create FINAL invoice, attempt to create ADJUSTMENT with `parentInvoiceId = FINAL.id` → succeeds.
- Test E (C3): create FINAL, ADJUSTMENT-1 (parent = FINAL), then attempt ADJUSTMENT-2 with `parentInvoiceId = ADJUSTMENT-1.id` → throws.
- Test F (C3): attempt to UPDATE an existing FINAL's parent to another ADJUSTMENT → succeeds (only ADJUSTMENT-type rows are checked); but attempt to UPDATE an ADJUSTMENT's parent to another ADJUSTMENT → throws.
- Test G: confirm existing service-level error messages still surface for the happy-path cases (i.e., the service catches first; the trigger is the safety net).

### Out of Scope

- 80a's `AuditLog` and 80b's `InvoiceLockSnapshot` — already shipped by the time this spec runs.
- Refactoring the service-level checks. They remain in place for clean error UX.
- Invariant catalog registration — neither C2 nor C3 needs a nightly invariant because the trigger blocks the violation at write time; reconciliation cannot find a violation that the DB rejected.
- Removing existing reconciliation coverage — Phase G may still seed impossible/tampered states with an explicit trigger bypass to verify detectors such as `INV-08`.
- Hardening other relational integrity rules (FK cascade semantics, etc.) — out of scope; existing FK declarations are sufficient.

---

## Implementation Direction

**Risk:** Low-medium. Triggers are surgical and well-precedented after 80b. The risk is performance — the C2 trigger locks the invoice row, then does a `SUM` aggregate on every allocation write. For our volume this is negligible; for hot-path concern, the `PaymentAllocation.invoiceId` index already exists.

**Order of work:**

1. C3 first (simpler, no aggregate). One migration, run Tests D–F.
2. C2 second. One migration, run Tests A–C.
3. Run the full suite, particularly the payment + invoice integration tests. Any test that constructs degenerate states deliberately (mocked over-collection for assertion purposes) will need updating — those tests should construct the *attempt* and assert the throw, not the post-state.

**Why two triggers, not one migration:** they touch different tables and different concerns. Keeping them separate makes reverts targeted (revert C2 if it surfaces a perf issue; keep C3).

**Rollback:** revert the affected migration. Rolling back C2 drops only the PaymentAllocation over-collection trigger/function; rolling back C3 drops only the ADJUSTMENT-chain trigger/function. Service-level checks remain — system continues to function, just without that DB defense.

---

## Verification

- All seven regression tests pass.
- All existing tests pass.
- `npm run build` passes.
- `npm run lint` passes.
- Manual: from `psql`, attempt to `INSERT INTO "PaymentAllocation" (...) VALUES (...)` for an invoice already at full allocation → fails with `check_violation`.
- Manual: from `psql`, attempt to `INSERT INTO "Invoice" (...) VALUES (..., 'ADJUSTMENT', '<adjustment-id>')` → fails.
- Performance smoke: record 100 sequential payments on a single invoice via `recordPayment` → no noticeable latency regression vs. pre-trigger baseline.

---

## Post-Implementation

- Update `context/reviews/77-post-verification-hardening-roadmap.md`: mark C2 and C3 as completed.
- Update `progress-tracker.md`.
- **Sprint 3 complete after 80c merges.** Per §11, the must-fix list is now fully closed except for items deferred into Sprint 4. Re-run the full invariant + reconciliation suite before opening Phase 4 (vouchers).
