# Feature 77 — Financial Architecture Verification & Testing Master Plan

> **Classification:** Verification-only spec. No new features. No schema changes. No service rewrites.
> **Priority:** P0 — Must pass before any new financial feature (vouchers, multi-package expansion, reporting) is added.
> **Audience:** Implementation/testing agent executing this plan. Each section is actionable and self-contained.

---

## 1. Purpose & Scope

### 1.1 Why This Phase Exists

Features 59 through 76c represent the largest architectural revision in Studio OS history. Across ~18 features, the system migrated from:

- A single evolving invoice → **DEPOSIT + FINAL invoice split**
- Free-form payments → **PaymentAllocation-backed choke point**
- Implicit deposit credit → **DocumentApplication binding**
- One add-on table → **OrderAddOn + OrderPackageItemUpgrade split**
- Single package orders → **multi-package BookingPackage / OrderPackage**
- Flat payment model → **ADJUSTMENT + CREDIT_NOTE + REFUND invoice types**
- Ad-hoc locked-invoice mutations → **classifier-gated workflow with manager approval**

Each of these migrations introduced invariants. Several layered on top of each other under time pressure. The risk is not any single feature being wrong — it is **silent corruption accumulating at the seams between features**.

This spec exists to:

1. Prove every invariant holds on real, migrated dev data.
2. Establish a CI-blocking invariant suite that catches regressions.
3. Identify edge cases not yet covered by existing invariant checks.
4. Build a nightly reconciliation strategy for production.
5. Document the gap analysis report that the testing agent must produce on completion.

### 1.2 What This Plan Validates

| Phase Range | Feature Set |
|---|---|
| Schema foundation | Features 59, 73, 73b, 73c |
| FinancialCase + booking lifecycle | Features 59, 60, 61, 62, 63 |
| Payment allocation architecture | Features 74a, 74b, 74c, 74d, 74e |
| Adjustment invoice flows | Features 75a, 75b, 75c |
| Refund flows | Feature 76a |
| Credit note flows | Features 76b, 76c |
| Multi-package | Features 70a–70e |
| Add-on / upgrade separation | Feature 73c |
| Workflow guards | Features 52a–52f |
| POS canonicalization | Features 70e.2, 71, 72 |

### 1.3 Risks This Protects Against

- Payments recorded without a `PaymentAllocation` → invisible to invoice balance math.
- DEPOSIT invoices double-applied via `DocumentApplication` → Final Invoice showing lower than real balance.
- ADJUSTMENT invoices not linked to their parent FINAL → orphan receivables never settled.
- CREDIT_NOTE applied to wrong target → over-credits the customer.
- REFUND payment missing `direction=OUT` → reconciliation sum wrong.
- `OrderPackageItemUpgrade` lines appearing in `OrderAddOn` queries → double-counted invoice lines.
- Locked invoices mutated outside the choke point → silent data corruption.
- `FinancialCase` totals diverging from sum of `Invoice` records.
- Race conditions between concurrent payments and invoice recalculation → stale balances.

### 1.4 Why Financial Invariant Testing Is Critical

This is a real-money system. Staff trust the numbers on screen. Corruption in invoice balances, payment allocation, or credit note application produces:

- Customer undercharging or overcharging — a direct revenue loss.
- Staff confusion and manual reconciliation cost.
- Audit failure when management reviews reports.
- Future voucher/multi-package features building on corrupted foundations.

A single uncaught invariant violation in production is more damaging than delaying the next feature by one sprint.

---

## 2. Testing Architecture Overview

### 2.1 Testing Layers (Execution Order)

```
Layer 0: Schema Integrity          → DB constraints, enum coverage, nullable guards
Layer 1: Migration / Backfill      → Data shape post-migration verified by query
Layer 2: Financial Invariants      → Service-level math correctness (CI-blocking)
Layer 3: Workflow Integration      → Full lifecycle scenario matrix
Layer 4: Edge Case / Classifier    → E1–E12 + new cases discovered in this spec
Layer 5: Regression                → Features 59–76c behavioral snapshots
Layer 6: UI / POS Workflow         → Manual operational QA checklist
Layer 7: Concurrency / Race        → Concurrent payment + recalculation scenarios
Layer 8: Security / Permission     → Role enforcement, locked-invoice guards
Layer 9: Failure Recovery          → Transaction rollback, partial-write detection
Layer 10: Production Reconciliation → Nightly invariant runner design
```

### 2.2 Automated vs Manual Split

| Layer | Automated | Manual |
|---|---|---|
| 0 — Schema | Yes (Prisma migration check + DB query) | No |
| 1 — Migration | Yes (assertion queries) | No |
| 2 — Invariants | Yes (CI-blocking `npm run test:backend-invariants`) | No |
| 3 — Integration | Yes (fixture-driven service tests) | Smoke only |
| 4 — Edge Cases | Yes | Some (E10 concurrent) |
| 5 — Regression | Yes (snapshot tests) | No |
| 6 — UI/POS | No | Yes (operational QA checklist) |
| 7 — Concurrency | Partial (simulated) | Yes (double-click tests) |
| 8 — Security | Yes (permission test matrix) | No |
| 9 — Failure Recovery | Yes (rollback harness) | No |
| 10 — Reconciliation | Yes (nightly runner) | Monitoring |

### 2.3 Recommended Test File Structure

```
src/
└── __tests__/
    └── financial/
        ├── invariants/
        │   ├── payment-allocation.invariant.ts
        │   ├── document-application.invariant.ts
        │   ├── invoice-balance.invariant.ts
        │   ├── financial-case.invariant.ts
        │   ├── adjustment-invoice.invariant.ts
        │   ├── credit-note.invariant.ts
        │   ├── refund-payment.invariant.ts
        │   ├── locked-invoice.invariant.ts
        │   └── order-addon-split.invariant.ts
        ├── integration/
        │   ├── booking-confirmation.integration.ts
        │   ├── check-in-flow.integration.ts
        │   ├── deposit-invoice.integration.ts
        │   ├── final-invoice-pos.integration.ts
        │   ├── payment-flow.integration.ts
        │   ├── adjustment-flow.integration.ts
        │   ├── credit-note-flow.integration.ts
        │   ├── refund-flow.integration.ts
        │   └── multi-package-flow.integration.ts
        ├── edge-cases/
        │   ├── classifier-edge-cases.test.ts
        │   ├── overpayment-scenarios.test.ts
        │   ├── concurrent-payment.test.ts
        │   └── stale-state-scenarios.test.ts
        ├── regression/
        │   ├── feature-74-regression.test.ts
        │   ├── feature-75-regression.test.ts
        │   └── feature-76-regression.test.ts
        ├── fixtures/
        │   ├── confirmed-booking.fixture.ts
        │   ├── checked-in-order.fixture.ts
        │   ├── paid-final-invoice.fixture.ts
        │   ├── adjustment-booking.fixture.ts
        │   ├── refunded-booking.fixture.ts
        │   ├── credit-note-booking.fixture.ts
        │   └── mixed-edit-booking.fixture.ts
        └── reconciliation/
            ├── nightly-runner.ts
            ├── invariant-registry.ts
            └── violation-reporter.ts
```

### 2.4 Naming Conventions

- Invariant functions: `assertInvariant_<EntityType>_<Rule>` — e.g., `assertInvariant_Payment_SingleAllocation`
- Fixture builders: `build<Entity>Fixture` — e.g., `buildPaidFinalInvoiceFixture`
- Test groups: `describe('[INV-##] <Rule Name>', ...)` — e.g., `describe('[INV-01] Payment has exactly one PaymentAllocation', ...)`
- Edge case tests: `describe('[EC-##] <Scenario>', ...)` — e.g., `describe('[EC-E4] Mixed add + remove in one save', ...)`
- Integration tests: `describe('[INT-##] <Flow Name>', ...)` — e.g., `describe('[INT-03] Deposit invoice locked after confirmation', ...)`

---

## 3. Layer 0 — Schema Integrity Testing

### 3.1 Purpose

Verify that DB-level constraints (CHECK constraints, unique indexes, NOT NULL guards, FK integrity) are actually enforced and match spec intent. Schema bugs are the hardest to catch at runtime because they fail silently until an edge case triggers them.

### 3.2 Checklist

#### 3.2.1 Invoice Table

```sql
-- Verify: Invoice.totalAmount must be > 0
INSERT INTO invoices (total_amount, ...) VALUES (-1, ...); -- MUST FAIL

-- Verify: Invoice.financialCaseId is NOT NULL
INSERT INTO invoices (financial_case_id, ...) VALUES (NULL, ...); -- MUST FAIL

-- Verify: Invoice.invoiceType is present and constrained
SELECT DISTINCT invoice_type FROM invoices;
-- Expected: only {DEPOSIT, FINAL, ADJUSTMENT, REFUND, CREDIT_NOTE, SALE}

-- Verify: No invoice exists without a FinancialCase FK target
SELECT i.id FROM invoices i
LEFT JOIN financial_cases fc ON fc.id = i.financial_case_id
WHERE fc.id IS NULL; -- MUST return 0 rows

-- Verify ADJ prefix on ADJUSTMENT invoices
SELECT invoice_number FROM invoices WHERE invoice_type = 'ADJUSTMENT'
AND invoice_number NOT LIKE 'ADJ-%'; -- MUST return 0 rows
```

#### 3.2.2 Payment Table

```sql
-- Verify: Payment.amount must be > 0
INSERT INTO payments (amount, ...) VALUES (-1, ...); -- MUST FAIL

-- Verify: Payment.direction defaults to IN
SELECT direction FROM payments WHERE direction IS NULL; -- MUST return 0 rows

-- Verify: REFUND payments have direction=OUT
SELECT p.id FROM payments p
JOIN invoices i ON i.id = p.invoice_id
WHERE i.invoice_type = 'REFUND' AND p.direction != 'OUT'; -- MUST return 0 rows

-- Verify: Non-REFUND payments have direction=IN
SELECT p.id FROM payments p
JOIN invoices i ON i.id = p.invoice_id
WHERE i.invoice_type != 'REFUND' AND p.direction = 'OUT'; -- MUST return 0 rows

-- Verify: Payment.financialCaseId is NOT NULL
SELECT id FROM payments WHERE financial_case_id IS NULL; -- MUST return 0 rows

-- Verify: Payment FK matches Invoice's FinancialCase
SELECT p.id FROM payments p
JOIN invoices i ON i.id = p.invoice_id
WHERE p.financial_case_id != i.financial_case_id; -- MUST return 0 rows
```

#### 3.2.3 PaymentAllocation Table

```sql
-- Verify: PaymentAllocation.amount must be > 0
INSERT INTO payment_allocations (amount, ...) VALUES (-1, ...); -- MUST FAIL

-- Verify: PaymentAllocation uniqueness per paymentId
SELECT payment_id, COUNT(*) FROM payment_allocations
GROUP BY payment_id HAVING COUNT(*) > 1; -- MUST return 0 rows

-- Verify: Every payment has exactly one allocation
SELECT p.id FROM payments p
LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
WHERE pa.id IS NULL; -- MUST return 0 rows
```

#### 3.2.4 DocumentApplication Table

```sql
-- Verify: DocumentApplication.amount must be > 0
INSERT INTO document_applications (amount, ...) VALUES (-1, ...); -- MUST FAIL

-- Verify: Unique (sourceDocumentId, targetDocumentId)
SELECT source_document_id, target_document_id, COUNT(*)
FROM document_applications
GROUP BY source_document_id, target_document_id
HAVING COUNT(*) > 1; -- MUST return 0 rows

-- Verify: DEPOSIT→FINAL application exists for all confirmed+checked-in bookings with paid deposit
SELECT fc.id FROM financial_cases fc
JOIN invoices dep ON dep.financial_case_id = fc.id AND dep.invoice_type = 'DEPOSIT'
JOIN invoices fin ON fin.financial_case_id = fc.id AND fin.invoice_type = 'FINAL'
LEFT JOIN document_applications da
  ON da.source_document_id = dep.id AND da.target_document_id = fin.id
WHERE da.id IS NULL; -- Should return 0 after backfill
```

#### 3.2.5 OrderAddOn vs OrderPackageItemUpgrade Split

```sql
-- Verify: OrderAddOn.productId is NOT NULL (no true add-on without product)
SELECT id FROM order_add_ons WHERE product_id IS NULL; -- MUST return 0 rows

-- Verify: OrderPackageItemUpgrade.packageItemId is NOT NULL
SELECT id FROM order_package_item_upgrades WHERE package_item_id IS NULL; -- MUST return 0 rows

-- Verify: OrderAddOn has no packageItemId column (it was dropped)
SELECT column_name FROM information_schema.columns
WHERE table_name = 'order_add_ons' AND column_name = 'package_item_id'; -- MUST return 0 rows
```

#### 3.2.6 FinancialCase Integrity

```sql
-- Verify: FinancialCase.bookingId points to real booking
SELECT fc.id FROM financial_cases fc
LEFT JOIN bookings b ON b.id = fc.booking_id
WHERE b.id IS NULL; -- MUST return 0 rows

-- Verify: No confirmed booking without a FinancialCase
SELECT b.id FROM bookings b
LEFT JOIN financial_cases fc ON fc.booking_id = b.id
WHERE b.status NOT IN ('PENDING', 'CANCELLED') AND fc.id IS NULL; -- MUST return 0 rows

-- Verify: No PENDING booking has a FinancialCase
SELECT b.id FROM bookings b
JOIN financial_cases fc ON fc.booking_id = b.id
WHERE b.status = 'PENDING'; -- MUST return 0 rows
```

#### 3.2.7 BookingPackage / OrderPackage Split

```sql
-- Verify: Every confirmed booking has at least one BookingPackage line
SELECT b.id FROM bookings b
LEFT JOIN booking_packages bp ON bp.booking_id = b.id
WHERE b.status != 'PENDING' AND bp.id IS NULL; -- MUST return 0 rows

-- Verify: Every order has at least one OrderPackage line
SELECT o.id FROM orders o
LEFT JOIN order_packages op ON op.order_id = o.id
WHERE op.id IS NULL; -- MUST return 0 rows
```

### 3.3 Blocker Criteria

Any failing schema check above is a **CI blocker** and must be resolved before Layer 2 invariant testing runs.

---

## 4. Layer 1 — Migration & Backfill Verification

### 4.1 Purpose

Verify that all backfill migrations (74b, 73c, others) produced exactly the records they claimed, with correct amounts and relationships.

### 4.2 Feature 74b — PaymentAllocation Backfill

```sql
-- Every pre-74b payment must have exactly one PaymentAllocation
-- with amount = payment.amount and invoiceId = payment.invoiceId

SELECT
  p.id AS payment_id,
  p.amount AS payment_amount,
  pa.amount AS allocation_amount,
  pa.invoice_id AS alloc_invoice,
  p.invoice_id AS payment_invoice
FROM payments p
JOIN payment_allocations pa ON pa.payment_id = p.id
WHERE pa.amount != p.amount
   OR pa.invoice_id != p.invoice_id; -- MUST return 0 rows

-- Verify: no payment has multiple allocations (single-allocation invariant)
SELECT payment_id, COUNT(*) as cnt
FROM payment_allocations
GROUP BY payment_id HAVING cnt > 1; -- MUST return 0 rows
```

### 4.3 Feature 74b — DocumentApplication Backfill

```sql
-- Every DEPOSIT→FINAL pair should have a DocumentApplication
-- sourceDocumentId = DEPOSIT invoice id
-- targetDocumentId = FINAL invoice id
-- amount = deposit invoice paidAmount

SELECT
  dep.id AS deposit_id,
  fin.id AS final_id,
  da.amount AS app_amount,
  dep.paid_amount AS deposit_paid,
  da.id AS doc_app_id
FROM financial_cases fc
JOIN invoices dep ON dep.financial_case_id = fc.id AND dep.invoice_type = 'DEPOSIT'
JOIN invoices fin ON fin.financial_case_id = fc.id AND fin.invoice_type = 'FINAL'
LEFT JOIN document_applications da
  ON da.source_document_id = dep.id
  AND da.target_document_id = fin.id
WHERE da.id IS NULL
   OR da.amount != dep.paid_amount; -- MUST return 0 rows
```

### 4.4 Feature 73c — OrderAddOn / OrderPackageItemUpgrade Split

```sql
-- No OrderAddOn should reference a PackageItem (column dropped)
-- Verify OrderPackageItemUpgrade has all former upgrade rows

SELECT COUNT(*) FROM order_package_item_upgrades; -- Should match former upgrade add-on count

-- No upgrade-type record should remain in OrderAddOn
SELECT oa.id FROM order_add_ons oa
WHERE oa.product_id IS NULL; -- MUST return 0 rows after split
```

### 4.5 Feature 70a–70b — BookingPackage Backfill

```sql
-- Every booking that had a package should have exactly one BookingPackage row
-- Legacy bookings have singular packageId — verify it was migrated

SELECT b.id FROM bookings b
JOIN booking_packages bp ON bp.booking_id = b.id
GROUP BY b.id HAVING COUNT(*) > 1; -- Confirm: only multi-package bookings have > 1 row

-- Verify session type mapping was preserved
SELECT bp.id, bp.session_type_id FROM booking_packages bp
WHERE bp.session_type_id IS NULL; -- MUST return 0 rows (every line has a session type)
```

### 4.6 Migration Ordering Verification

Verify all migrations ran in the correct order by checking `_prisma_migrations`:

```sql
SELECT migration_name, applied_steps_count, finished_at
FROM _prisma_migrations
WHERE migration_name LIKE '%73%'
   OR migration_name LIKE '%74%'
   OR migration_name LIKE '%75%'
   OR migration_name LIKE '%76%'
ORDER BY finished_at;
-- All must have applied_steps_count > 0 and no rolled_back_at
```

---

## 5. Layer 2 — Financial Invariant Suite (CI-Blocking)

These invariants MUST pass on every CI run. They run via `npm run test:backend-invariants`. Any violation is a merge blocker.

### INV-01: Every Payment Has Exactly One PaymentAllocation

```
Rule: COUNT(PaymentAllocation WHERE paymentId = p.id) = 1 for all Payments p
Failure mode: Payment records monetary receipt but allocation is missing → invoice balance wrong
Corruption example: payment recorded via old path (pre-74c choke point bypass)
Expected failure behavior: invariant runner throws with payment ID + amount + invoice
```

**Validation logic:**
```typescript
async function assertInvariant_Payment_SingleAllocation(db: PrismaClient) {
  const violations = await db.$queryRaw<{id: string}[]>`
    SELECT p.id FROM payments p
    LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
    GROUP BY p.id
    HAVING COUNT(pa.id) != 1
  `;
  if (violations.length > 0) {
    throw new InvariantViolation('INV-01', violations.map(v => v.id));
  }
}
```

### INV-02: PaymentAllocation Amount Equals Payment Amount

```
Rule: PaymentAllocation.amount = Payment.amount for all records
Failure mode: partial allocation → invoice appears partly unpaid when fully paid
Corruption example: manual DB edit, or allocation created with wrong amount
```

### INV-03: PaymentAllocation Invoice Matches Payment Invoice

```
Rule: PaymentAllocation.invoiceId = Payment.invoiceId for all records
Failure mode: allocation references different invoice than the payment → double credit or orphan
Corruption example: backfill assigned wrong invoice FK
```

### INV-04: Every DocumentApplication Is Unique Per Source-Target Pair

```
Rule: (sourceDocumentId, targetDocumentId) is unique in document_applications
Failure mode: deposit applied twice to final invoice → customer appears to owe less
Corruption example: confirmation flow called twice without idempotency guard
```

### INV-05: DEPOSIT Invoice Has Exactly One DocumentApplication to FINAL

```
Rule: For every FinancialCase with both DEPOSIT and FINAL invoices,
      exactly one DocumentApplication with source=DEPOSIT.id, target=FINAL.id exists
Failure mode: missing → deposit not reflected in balance; duplicate → over-credit
```

### INV-06: DocumentApplication Amount Equals Deposit Paid Amount

```
Rule: DocumentApplication.amount = DepositInvoice.paidAmount for deposit→final applications
Failure mode: wrong amount → Final Invoice shows incorrect remaining balance
```

### INV-07: ADJUSTMENT Invoice Parent Is Always FINAL

```
Rule: For all ADJUSTMENT invoices,
      parentInvoiceId references an invoice where invoiceType = 'FINAL'
      AND that FINAL invoice belongs to the same FinancialCase
Failure mode: ADJUSTMENT chains ADJUSTMENT → corrupts settlement math (E8 violation)
Corruption example: edit classifier applied to already-adjusted order without tracing parent
```

### INV-08: No ADJUSTMENT→ADJUSTMENT Chaining

```
Rule: An ADJUSTMENT invoice's parentInvoiceId must never reference another ADJUSTMENT invoice
Failure mode: recursive adjustment → settlement becomes impossible to calculate
```

### INV-09: CREDIT_NOTE Target Is Always FINAL

```
Rule: DocumentApplication where sourceDocumentType='CREDIT_NOTE' must target a FINAL invoice
Failure mode: credit note reducing wrong invoice → financial case balance corrupt
```

### INV-10: CREDIT_NOTE Invoice Is Immediately Locked

```
Rule: All invoices with invoiceType='CREDIT_NOTE' must have status='CLOSED' and locked=true
Failure mode: open credit note → can be double-applied
```

### INV-11: REFUND Payment Has direction=OUT

```
Rule: All Payments on REFUND-type invoices must have direction='OUT'
Failure mode: IN direction on refund → reconciliation SUM double-counts money
```

### INV-12: Non-REFUND Payments Have direction=IN

```
Rule: All Payments on non-REFUND invoices must have direction='IN'
Failure mode: accidental OUT on DEPOSIT/FINAL → balance math broken
```

### INV-13: Invoice Effective Paid Amount Never Exceeds Total

```
Rule: effectivePaidAmount(invoice) <= invoice.totalAmount for all open invoices
Where effectivePaidAmount = SUM(PaymentAllocation.amount WHERE invoiceId=invoice.id)
                           + SUM(DocumentApplication.amount WHERE targetDocumentId=invoice.id)
Failure mode: overpayment accepted silently → balance goes negative, customer owed a refund
             that the system doesn't know about
```

### INV-14: Locked Invoice Content Is Immutable

```
Rule: For any invoice where locked=true,
      totalAmount, invoiceType, financialCaseId must not change after the lock timestamp
Failure mode: locked invoice mutated → audit trail destroyed
Verification: Compare current values against audit log snapshot at lock time
```

### INV-15: Deposit Invoice Is Always CLOSED and Locked

```
Rule: All invoices with invoiceType='DEPOSIT' must have status='CLOSED' and locked=true
Failure mode: open deposit → can accept more payments, corrupting deposit amount
```

### INV-16: No Orphan PaymentAllocation

```
Rule: Every PaymentAllocation.paymentId references an existing Payment
      Every PaymentAllocation.invoiceId references an existing Invoice
Failure mode: orphan allocation → phantom credit applied to invoice balance
```

### INV-17: No Orphan DocumentApplication

```
Rule: Every DocumentApplication.sourceDocumentId and targetDocumentId
      references an existing Invoice
Failure mode: phantom credit references a deleted or non-existent invoice
```

### INV-18: FinancialCase Total Reconciles to Invoice Sum

```
Rule: SUM(Invoice.totalAmount WHERE financialCaseId=fc.id AND invoiceType IN (FINAL, ADJUSTMENT))
      must match expected session total (package + add-ons + upgrades)
      within an acceptable variance (accounting for credit notes)
Failure mode: invoice lines don't add up to order total → revenue leak
Note: This requires joining order data and is checked in reconciliation runner, not CI
```

### INV-19: No FINAL Invoice Without an Order

```
Rule: Every FINAL invoice must have an orderId (or be joinable to an order via FinancialCase→Job)
Failure mode: orphan FINAL invoice → revenue exists but no operational record to assign it
```

### INV-20: ADJUSTMENT Invoice Amount Is Positive

```
Rule: All ADJUSTMENT invoices have totalAmount > 0
Failure mode: zero or negative adjustment → semantic error in classifier (use CREDIT_NOTE for negatives)
```

### INV-21: OrderAddOn Records Reference a Product

```
Rule: All OrderAddOn records have a non-null productId
Failure mode: phantom add-on with no product → invoice line generated for nothing
```

### INV-22: OrderPackageItemUpgrade Records Reference a PackageItem

```
Rule: All OrderPackageItemUpgrade records have non-null packageItemId
Failure mode: orphan upgrade → commission and invoice math fails
```

### INV-23: No Confirmed Booking Without a Deposit Invoice

```
Rule: Every booking with status CONFIRMED or CHECKED_IN
      must have exactly one DEPOSIT invoice in its FinancialCase
Failure mode: confirmed booking with no deposit → booking confirmation atomicity failed
```

### INV-24: Invoice Balance Never Negative

```
Rule: remainingBalance(invoice) = invoice.totalAmount - effectivePaidAmount(invoice) >= 0
      for all open (non-CLOSED) invoices
Failure mode: negative balance = uncounted overpayment → refund liability not tracked
```

### INV-25: refundOfPaymentId Points to direction=IN Payment

```
Rule: When Payment.refundOfPaymentId is set,
      the referenced Payment must have direction='IN'
Failure mode: refund tracing to another refund → circular reference in reporting queries
```

### INV-26: Payment FinancialCase Matches Invoice FinancialCase

```
Rule: Payment.financialCaseId = Payment.invoice.financialCaseId
Failure mode: cross-case payment → settlement credited to wrong booking's balance
```

### INV-27: No PENDING Booking Has Financial Records

```
Rule: No FinancialCase, Invoice, or Payment references a booking with status='PENDING'
Failure mode: premature financial record creation → lifecycle invariant broken
```

### INV-28: Editing Cannot Start on Unsettled Order

```
Rule: An order cannot have editingJob.status != null unless
      the FINAL invoice in its FinancialCase is CLOSED
Failure mode: editing started before payment → service access without revenue collection
```

### 5.1 CI Integration

```json
// package.json additions
{
  "scripts": {
    "test:backend-invariants": "tsx src/__tests__/financial/invariants/run-all.ts",
    "test:financial-integration": "tsx src/__tests__/financial/integration/run-all.ts",
    "test:financial-edge-cases": "tsx src/__tests__/financial/edge-cases/run-all.ts"
  }
}
```

Pre-merge requirement: `npm run test:backend-invariants` must exit 0.

---

## 6. Layer 3 — Full Workflow Integration Matrix

For each scenario below:
- **Setup** = fixture state required before the action
- **Action** = service call or user action being tested
- **Expected DB** = exact Prisma record assertions
- **Expected Invoice** = invoice type, status, amounts
- **Expected Workflow** = booking/order status
- **Expected Audit** = required AuditLog entries

### INT-01: Pending Booking Creation

| Field | Value |
|---|---|
| Setup | Active customer, active package, open calendar slot |
| Action | `createBooking(...)` |
| Expected DB | Booking created with status=PENDING; NO FinancialCase; NO Invoice; NO Payment |
| Expected Invoice | None |
| Expected Workflow | PENDING |
| Expected Audit | AuditLog entry for booking creation |

**Failure mode to test:** Confirm that `FinancialCase`, `Invoice`, `Payment` tables have 0 new rows.

### INT-02: Pending Booking Cancellation (Hard Delete)

| Field | Value |
|---|---|
| Setup | PENDING booking (INT-01 result) |
| Action | Cancel pending booking |
| Expected DB | Booking row hard-deleted; 0 remaining rows referencing the booking ID |
| Expected Invoice | None (never created) |
| Expected Workflow | No booking record remains |
| Expected Audit | No AuditLog (pending = no history) |

**Failure mode to test:** Confirm no `CANCELLED` record is left — hard deletion only.

### INT-03: Booking Confirmation (Atomic)

| Field | Value |
|---|---|
| Setup | PENDING booking |
| Action | `recordDepositAndConfirmBooking(bookingId, amount=20, method, actorUserId)` |
| Expected DB | Booking.status=CONFIRMED; Booking.publicId='BK-...' (non-null); FinancialCase created; DepositInvoice created; DepositPayment created; PaymentAllocation created |
| Expected Invoice | InvoiceType=DEPOSIT, status=CLOSED, locked=true, totalAmount=amount, paidAmount=amount |
| Expected Workflow | CONFIRMED |
| Expected Audit | AuditLog: payment_added, booking_confirmed |

**Atomicity test:** Simulate a failure mid-transaction (after BK reference, before Invoice) and verify all records rolled back.

### INT-04: Confirmed Booking Check-In (Atomic)

| Field | Value |
|---|---|
| Setup | CONFIRMED booking with FinancialCase + locked Deposit Invoice |
| Action | `checkInBooking(bookingId, photographerId, socialMediaConsent, actorUserId)` |
| Expected DB | Booking.status=CHECKED_IN; Job created with jobNumber='JOB-...'; Order created with status=WAITING_SELECTION; FinancialCase.jobId stamped; Job.photographerId set; Job.socialMediaConsent set |
| Expected Invoice | Deposit Invoice unchanged (still locked) |
| Expected Workflow | CHECKED_IN |
| Expected Audit | AuditLog: check_in, job_created |

**Atomicity test:** Fail after Job creation, before Order creation — verify rollback.

### INT-05: Final Invoice Creation at POS

| Field | Value |
|---|---|
| Setup | CHECKED_IN order, WAITING_SELECTION, packages selected, add-ons confirmed |
| Action | `createFinalInvoice(orderId, actorUserId)` |
| Expected DB | FINAL invoice created; DocumentApplication created (source=DEPOSIT.id, target=FINAL.id, amount=depositPaidAmount); FINAL invoice NOT yet locked |
| Expected Invoice | InvoiceType=FINAL, status=OPEN, totalAmount=packageTotal+addOns+extraPhotos, NOT locked |
| Expected Workflow | Order WAITING_SELECTION (unchanged until payment) |
| Expected Audit | AuditLog: final_invoice_created |

### INT-06: Partial Payment on Final Invoice

| Field | Value |
|---|---|
| Setup | FINAL invoice exists, totalAmount=500, depositApplied=20, remaining=480 |
| Action | `createPaymentWithAllocation(invoiceId, amount=200, method, actorUserId)` |
| Expected DB | Payment created (direction=IN, amount=200); PaymentAllocation created (amount=200, invoiceId=FINAL.id); FINAL invoice status=OPEN (not yet closed) |
| Expected Invoice | remainingBalance = 480 - 200 = 280 |
| Expected Workflow | Order WAITING_SELECTION (editing NOT unlocked) |
| Expected Audit | AuditLog: payment_added |

### INT-07: Full Payment on Final Invoice → Invoice Locks

| Field | Value |
|---|---|
| Setup | FINAL invoice, remaining balance = 100 (after partial payment) |
| Action | `createPaymentWithAllocation(invoiceId, amount=100, ...)` |
| Expected DB | Payment created; PaymentAllocation created; FINAL invoice: status=CLOSED, locked=true |
| Expected Invoice | totalAmount=paid, remainingBalance=0 |
| Expected Workflow | Order becomes eligible for editing start |
| Expected Audit | AuditLog: payment_added, invoice_closed |

### INT-08: Additive Order Edit → Auto-ADJUSTMENT Invoice

| Field | Value |
|---|---|
| Setup | Locked FINAL invoice; order with 1 package + 2 add-ons |
| Action | `addOrderAddOn(orderId, productId, quantity=1)` via POS edit |
| Expected DB | New OrderAddOn row; ADJUSTMENT invoice created (parentInvoiceId=FINAL.id, invoiceType=ADJUSTMENT, totalAmount=addOnPrice); No CREDIT_NOTE created |
| Expected Invoice | ADJUSTMENT invoice: status=OPEN, locked=false, totalAmount>0 |
| Expected Workflow | Order still accessible in POS; FINAL remains locked |
| Expected Audit | AuditLog: add_on_added, adjustment_invoice_created |

**Edge: Must not create ADJUSTMENT for zero-price add-ons (E1 analog)**

### INT-09: ADJUSTMENT Invoice Payment

| Field | Value |
|---|---|
| Setup | Open ADJUSTMENT invoice (INT-08 result), totalAmount=50 |
| Action | `createPaymentWithAllocation(adjustmentInvoiceId, amount=50, ...)` |
| Expected DB | Payment (direction=IN); PaymentAllocation; ADJUSTMENT invoice: status=CLOSED, locked=true |
| Expected Invoice | ADJUSTMENT paid and locked |
| Expected Workflow | No order status change |
| Expected Audit | AuditLog: payment_added, adjustment_invoice_closed |

### INT-10: Reductive Edit → CREDIT_NOTE Prompt (Manager Required)

| Field | Value |
|---|---|
| Setup | Locked FINAL invoice; order with add-on that customer wants to remove |
| Action | `removeOrderAddOn(orderId, addOnId)` via POS edit |
| Expected DB | Add-on removal deferred; system returns credit-note-required response; NO CREDIT_NOTE auto-created |
| Expected Invoice | FINAL invoice unchanged |
| Expected Workflow | POS shows manager approval prompt |
| Expected Audit | None until manager approves |

### INT-11: Credit Note Issuance (Manager)

| Field | Value |
|---|---|
| Setup | Manager approval granted; add-on value = 50 KD |
| Action | `createCreditNote(orderId, invoiceId, amount=50, reason, managerId)` |
| Expected DB | CREDIT_NOTE invoice created (invoiceType=CREDIT_NOTE, totalAmount=50, status=CLOSED, locked=true); DocumentApplication created (source=CREDIT_NOTE.id, target=FINAL.id, amount=50) |
| Expected Invoice | CREDIT_NOTE: locked immediately; FINAL: effectivePaidAmount increases by 50 |
| Expected Workflow | POS shows overpayment flag if FINAL was fully paid |
| Expected Audit | AuditLog: credit_note_issued, manager_action |

### INT-12: Refund Issuance (Manager)

| Field | Value |
|---|---|
| Setup | FINAL invoice CLOSED; credit note issued (INT-11); overpayment of 50 KD exists |
| Action | `createRefundInvoice(orderId, amount=50, refundOfPaymentId, managerId)` |
| Expected DB | REFUND invoice created (invoiceType=REFUND, totalAmount=50); Payment created (direction=OUT, amount=50, type=REFUND); PaymentAllocation created |
| Expected Invoice | REFUND invoice: status=CLOSED, locked=true |
| Expected Workflow | Overpayment flag removed from POS |
| Expected Audit | AuditLog: refund_issued, manager_action |

### INT-13: Package Upgrade (POS)

| Field | Value |
|---|---|
| Setup | Order with original package at 300 KD; final package selected at 400 KD |
| Action | `upgradeOrderPackage(orderPackageId, newPackageId, actorUserId)` |
| Expected DB | OrderPackage.finalPackageId updated; OrderPackage.finalPackagePriceSnapshot=400; ADJUSTMENT invoice created for delta (400-300=100) |
| Expected Invoice | ADJUSTMENT: totalAmount=100; FINAL: still locked at original amount |
| Expected Audit | AuditLog: package_upgraded, adjustment_invoice_created |

### INT-14: No-Show Handling

| Field | Value |
|---|---|
| Setup | CONFIRMED booking with locked Deposit Invoice |
| Action | `recordNoShow(bookingId, actorUserId)` |
| Expected DB | Booking.status=NO_SHOW; Deposit Invoice status remains CLOSED/locked; FinancialCase preserved |
| Expected Invoice | Deposit Invoice: unchanged (forfeit = leaving it closed) |
| Expected Workflow | NO_SHOW — no further workflow |
| Expected Audit | AuditLog: booking_no_show |

### INT-15: Order Delivery Completion Guards

| Field | Value |
|---|---|
| Setup | Order in READY_FOR_PICKUP; FINAL invoice CLOSED |
| Action | `completeDelivery(orderId, actorUserId)` |
| Expected DB | Order.status=DELIVERED; Order.deliveryCompletedById set; OrderActivity entry |
| Expected Invoice | FINAL: still CLOSED (delivery doesn't reopen it) |
| Expected Workflow | DELIVERED |
| Expected Audit | AuditLog: order_delivered |

**Blocker tests (must fail with guard error):**
- Attempt delivery when FINAL invoice is open (balance remaining)
- Attempt delivery when editing not approved
- Attempt delivery when production not READY

---

## 7. Layer 4 — Edge Case Expansion

### 7.1 Existing Classifier Cases (E1–E12)

All E1–E12 cases defined in `project_financial_review_2026_05.md` must have explicit test coverage. Summary with required assertions:

| Case | Scenario | Required Assertion |
|---|---|---|
| E1 | Equal-price upgrade replacement | 0 financial records created; 1 activity log entry |
| E2 | Non-equal-price upgrade replacement | ADJUSTMENT for added + CREDIT_NOTE for removed; never net-delta |
| E3 | Partial quantity reduction on add-on | CREDIT_NOTE for reduction value; OrderAddOn quantity reduced |
| E4 | Mixed additions + removals in one save | Exactly 1 ADJUSTMENT + 1 CREDIT_NOTE created atomically |
| E5 | Direct priceSnapshot edit on locked invoice line | Blocked; HTTP 422 or service error thrown |
| E6 | Manual discount on FINAL | CREDIT_NOTE only; no auto-ADJUSTMENT; manager required |
| E7 | Manual surcharge on FINAL | Explicit surcharge action; no auto-ADJUSTMENT |
| E8 | Adjustment of an adjustment | Blocked; parentInvoiceId must point to FINAL only |
| E9 | CREDIT_NOTE when reducing ADJUSTMENT-line item | CREDIT_NOTE targets FINAL, not the ADJUSTMENT |
| E10 | Concurrent edit + cancellation | Save fails with stale-state error; no partial write |
| E11 | Customer paid ADJUSTMENT, then removes cause | CREDIT_NOTE + REFUND invoice; ADJUSTMENT stays in history |
| E12 | Quantity increase on add-on | Auto-ADJUSTMENT for positive delta |

### 7.2 New Edge Cases (EC-13 to EC-42)

#### EC-13: Double Confirmation of a Booking

**Scenario:** Booking confirmation API called twice (double-click or network retry).
**Expected:** Second call idempotent OR throws `booking_already_confirmed` error. Must NOT create a second FinancialCase, Deposit Invoice, or BK reference.
**Test:** Call `recordDepositAndConfirmBooking` twice on the same pending booking. Assert exactly 1 FinancialCase, 1 Deposit Invoice, 1 Payment after both calls.

#### EC-14: Deposit Amount Below Minimum

**Scenario:** Staff attempts to record deposit of 15 KD (below 20 KD minimum).
**Expected:** Validation error thrown before any DB write. No FinancialCase created.
**Test:** Call with `amount=15`. Assert 0 new DB rows.

#### EC-15: FINAL Invoice Created Twice for Same Order

**Scenario:** POS `createFinalInvoice` called twice due to double-click or race.
**Expected:** Second call returns existing FINAL invoice (idempotent) OR throws `final_invoice_already_exists`. Must NOT create two FINAL invoices for the same FinancialCase.
**Test:** Assert MAX 1 FINAL invoice per FinancialCase at all times.

#### EC-16: Payment Exceeds Invoice Total

**Scenario:** Staff records payment of 600 KD on a 500 KD invoice.
**Expected:** Service throws overpayment guard error. No Payment created.
**Test:** `createPaymentWithAllocation(invoiceId, amount=invoiceTotal+1)` must throw.

#### EC-17: CREDIT_NOTE Amount Exceeds FINAL Invoice Total

**Scenario:** Manager issues credit note for more than the final invoice total.
**Expected:** Service throws cap enforcement error. No CREDIT_NOTE created.
**Test:** `createCreditNote(amount = finalInvoice.totalAmount + 1)` must throw.

#### EC-18: REFUND Amount Exceeds Overpayment

**Scenario:** Refund issued for more than the overpayment available.
**Expected:** Service throws cap enforcement error. No REFUND created.
**Test:** Overpayment = 50; attempt `createRefundInvoice(amount=51)`. Must throw.

#### EC-19: Refund After Adjustment (No Credit Note)

**Scenario:** Customer paid ADJUSTMENT invoice, then wants a refund, but no CREDIT_NOTE was issued.
**Expected:** System shows 0 refundable amount (no overpayment exists). Cannot issue refund.
**Test:** Build fixture with paid ADJUSTMENT, no CREDIT_NOTE. Assert `getRefundableAmount` = 0.

#### EC-20: Adjustment Invoice on Already-Adjusted Order

**Scenario:** Order has ADJUSTMENT-1 (paid), staff adds another add-on → ADJUSTMENT-2.
**Expected:** ADJUSTMENT-2 created as sibling of FINAL (parentInvoiceId=FINAL.id), not child of ADJUSTMENT-1.
**Test:** Build fixture with paid ADJUSTMENT, add another add-on. Assert ADJUSTMENT-2.parentInvoiceId = FINAL.id (INV-08).

#### EC-21: Credit Note After Multiple Adjustments

**Scenario:** Order has ADJUSTMENT-1 (paid) + ADJUSTMENT-2 (open). Staff issues CREDIT_NOTE for a line from ADJUSTMENT-1.
**Expected:** CREDIT_NOTE targets FINAL invoice. DocumentApplication source=CREDIT_NOTE, target=FINAL. ADJUSTMENT-2 remains unaffected.
**Test:** Verify CREDIT_NOTE.documentApplication.targetDocumentId = FINAL.id.

#### EC-22: Locked FINAL Invoice — Append-Only Payment Acceptance

**Scenario:** FINAL invoice is CLOSED/locked but has non-zero remaining balance (partial payment scenario).
**Expected:** Additional payment accepted (append-only); invoice recalculates paid/remaining; if now fully paid, stays CLOSED.
**Test:** Build fixture with partial payment + locked invoice. Record second payment. Assert invoice remains locked, status=CLOSED.

#### EC-23: Stale Browser Tab — Payment After Invoice Locks

**Scenario:** Tab A has POS open with invoice total=500. Tab B makes payment that closes invoice. Tab A submits payment.
**Expected:** Tab A's payment rejected with `invoice_already_closed` or overpayment guard.
**Test:** Simulate with two sequential service calls. Second call must fail.

#### EC-24: Package Downgrade Attempt (Blocked)

**Scenario:** Staff tries to select a cheaper package from POS after Final Invoice is locked.
**Expected:** Service returns CREDIT_NOTE_REQUIRED classifier response. Blocked without manager action.
**Test:** Attempt package change where newPackage.price < orderPackage.finalPackagePriceSnapshot. Must not auto-create ADJUSTMENT.

#### EC-25: Equal-Price Package Swap (Different Package)

**Scenario:** Package A (300 KD) swapped to Package B (300 KD) — same price, different contents.
**Expected:** OrderPackage updated; 0 financial records created (E1 analog for package-level). Activity log entry only.
**Test:** Assert 0 new ADJUSTMENT/CREDIT_NOTE. Assert 1 AuditLog entry.

#### EC-26: Delete Confirmed Booking Attempt

**Scenario:** Staff attempts to hard-delete a CONFIRMED booking.
**Expected:** Blocked. CONFIRMED bookings cannot be hard-deleted (only PENDING can).
**Test:** Assert deletion attempt throws and booking persists.

#### EC-27: Re-opening a Locked Invoice

**Scenario:** Staff or API attempts to set `locked=false` on a locked DEPOSIT invoice.
**Expected:** Service or DB constraint prevents the mutation. `locked` field is immutable once set.
**Test:** Direct Prisma update attempt on locked invoice. Must throw or no-op with error.

#### EC-28: Orphan ADJUSTMENT After Order Cancellation

**Scenario:** Order has open ADJUSTMENT invoice. Order is later cancelled (OrderStatus.CANCELLED with manager override).
**Expected:** ADJUSTMENT invoice must be explicitly handled — either voided or marked as uncollectable. Must not remain open as phantom receivable.
**Test:** Cancel order, assert no open ADJUSTMENT invoices remain without explicit disposition.

#### EC-29: Multi-Package Order — Invoice Lines Grouped Correctly

**Scenario:** Order with 2 OrderPackage lines (Package A + Package B).
**Expected:** Final Invoice has separate line-item groups per package. Invoice total = sum of both packages + extra photos + add-ons.
**Test:** Build multi-package fixture. Assert InvoiceLineItems grouped by orderPackageId. Assert no double-counting of shared add-ons.

#### EC-30: Multi-Package — Package-Scoped Add-On Deletion

**Scenario:** OrderAddOn scoped to OrderPackage-1 is deleted; OrderPackage-2 has separate unscoped add-on.
**Expected:** Only Package-1's scoped add-on is removed. Package-2's add-on and unscoped add-ons remain.
**Test:** Verify cascade scoping. Assert 0 orphan OrderAddOns after deletion.

#### EC-31: Photographer Assignment Change After Check-In

**Scenario:** Job has photographerId=A. Manager changes to photographerId=B after check-in.
**Expected:** Job.photographerId updated; AuditLog entry for photographer change; Order unaffected.
**Test:** Assert no financial records created on photographer change.

#### EC-32: Commission Calculation on Package Upgrade

**Scenario:** Original package = 300 KD; upgraded to 500 KD. Commission = upgrade delta.
**Expected:** Commission record created for 200 KD (500-300). Commission.photographerId matches Job.photographerId.
**Test:** Assert Commission.amount = finalPackagePriceSnapshot - originalPackagePriceSnapshot.

#### EC-33: Commission on No-Upgrade Booking

**Scenario:** Session booked with Package A (300 KD), customer uses same package at POS (no upgrade).
**Expected:** 0 Commission records created.
**Test:** Build fixture without upgrade. Assert 0 Commission rows for the FinancialCase.

#### EC-34: Session Type Mismatch on Package Change

**Scenario:** OrderPackage line has sessionTypeId=KIDS. Staff attempts to change to a FAMILY package.
**Expected:** Service blocks the change (cross-session override policy from Feature 70e.5c).
**Test:** Attempt package change where new package belongs to different session type. Must throw.

#### EC-35: Stale Invoice Recalculation After ADJUSTMENT Paid

**Scenario:** ADJUSTMENT invoice paid. Staff reopens POS tab (stale). POS recalculates FINAL invoice total.
**Expected:** Recalculation does NOT overwrite ADJUSTMENT payment records. FINAL invoice balance reflects DocumentApplication (deposit) only, not ADJUSTMENT payments.
**Test:** Trigger recalculation after ADJUSTMENT paid. Assert ADJUSTMENT payments unaffected.

#### EC-36: Nightly Reconciliation — Missing DocumentApplication

**Scenario:** Manual DB edit removed a DEPOSIT→FINAL DocumentApplication.
**Expected:** Nightly reconciliation detects the missing application. Logs CRITICAL alert. Does NOT auto-repair.
**Test:** Run reconciliation script against fixture with missing DocumentApplication. Assert violation logged.

#### EC-37: Concurrent Payment Submission (Race Condition)

**Scenario:** Two tabs submit payment for 100 KD each on an invoice with 100 KD remaining balance.
**Expected:** One payment succeeds; the second fails with overpayment guard.
**Test:** Use a Prisma transaction with a `SELECT ... FOR UPDATE` to hold the row during the first payment. Assert second payment rejected.

#### EC-38: REFUND Invoice Amount Integrity

**Scenario:** REFUND invoice created; payment direction=OUT; PaymentAllocation created.
**Expected:** PaymentAllocation.amount = Payment.amount = REFUND invoice.totalAmount. All match.
**Test:** Build refund fixture. Assert three-way amount equality.

#### EC-39: Voucher-Backed Booking (Future-Proofing Schema Test)

**Scenario:** No voucher code yet. Schema must support GiftCardRedemption without breaking current flows.
**Expected:** Deposit Invoice settlement path works with both Payment (current) and GiftCardRedemption (future schema). Current path unaffected.
**Test:** Verify no foreign key in Deposit Invoice that blocks null GiftCardRedemptionId.

#### EC-40: Adjustment on Multi-Package Order (Which Package's Line?)

**Scenario:** Order has Package A + Package B. Staff adds add-on scoped to Package A.
**Expected:** ADJUSTMENT invoice created. ADJUSTMENT.parentInvoiceId = FINAL.id. Add-on scoped to Package A via OrderAddOn.orderPackageId.
**Test:** Assert ADJUSTMENT sibling of FINAL (not Package A's invoice — there is no per-package invoice).

#### EC-41: Invoice Number Prefix Consistency

**Scenario:** DEPOSIT, FINAL, ADJUSTMENT, REFUND, CREDIT_NOTE invoices created.
**Expected:** Prefixes match Fork K spec: DEP-/INV-/ADJ-/REF-/CN-.
**Test:** Query each invoiceType, assert invoiceNumber starts with correct prefix.

#### EC-42: Identifier Sequence Self-Healing

**Scenario:** `identifier_sequences` row falls behind existing BK/JOB references (simulated by manual edit).
**Expected:** Next reference generation detects the gap and advances to MAX(existing)+1.
**Test:** Manually set sequence behind, trigger confirmation, assert no duplicate publicId generated.

---

## 8. Layer 5 — Regression Testing

### 8.1 Feature 74 Regression Suite

Verify the Phase 1 cutover (74e) did not break any pre-Phase-1 behavior:

- `getInvoiceById` returns correct `effectivePaidAmount` using allocation+application math (not virtual credit)
- Old deposit-payment bookings (pre-74b) have their backfilled PaymentAllocation + DocumentApplication
- Deposit deduction displays correctly on Final Invoice even after 74e removed virtual credit path
- No `financial.rearch.dual_read.discrepancy` warnings in logs against dev data

### 8.2 Feature 75 Regression Suite

- ADJUSTMENT invoice creation path still works after 76a/76b additions
- POS settlement panel shows both FINAL and ADJUSTMENT outstanding totals
- ADJUSTMENT payment uses allocation choke point (not direct Payment.create)
- Settled ADJUSTMENT invoice locks correctly

### 8.3 Feature 76 Regression Suite

- CREDIT_NOTE creation requires manager permission (role check)
- CREDIT_NOTE issuance from POS triggers overpayment flag
- REFUND invoice direction=OUT invariant holds
- Mixed ADJUSTMENT + CREDIT_NOTE edit (76c) creates exactly 1 of each in one transaction
- Mixed edit activity log has paired metadata entries

### 8.4 Multi-Package Regression (70a–70e)

- Final Invoice total = sum of all OrderPackage lines (not first line only)
- Extra-photo pricing uses SessionTypeExtraPhotoPricing (not addon-extra-photo product)
- Cross-session package change blocked at service layer
- OrderAddOn.orderPackageId cascade works correctly on package line deletion

---

## 9. Layer 6 — UI / POS Manual Operational QA

This section is a checklist for manual execution by a tester simulating real studio staff.

### 9.1 Reception Staff — Booking Workflow

```
[ ] Create a pending booking for existing customer → verify no BK reference shown
[ ] Create a pending booking for new customer (phone-first) → verify customer created
[ ] Cancel a pending booking → verify booking deleted from list, no traces in DB
[ ] Record deposit for pending booking → verify:
    - BK reference appears (BK-DEPT-YEAR-XXXXX format)
    - Deposit Invoice shown on booking detail (locked, 20 KD)
    - Booking status changes to CONFIRMED
    - Remaining balance shown alongside live package price
[ ] Attempt to record deposit below 20 KD → verify validation error shown
[ ] View confirmed booking → verify deposit invoice read-only, package info live
[ ] Cancel a confirmed booking → verify FinancialCase preserved, booking marked CANCELLED
[ ] Record no-show → verify Deposit Invoice stays closed, NO_SHOW status
```

### 9.2 Reception Staff — Check-In Workflow

```
[ ] Check in a CONFIRMED booking:
    - Dialog appears requiring photographer selection + consent toggle
    - Submit → JOB reference generated (JOB-DEPT-YEAR-XXXXX)
    - Order created (WAITING_SELECTION)
    - Booking detail shows both BK and JOB references
    - Order link appears on booking detail
[ ] Attempt check-in without selecting photographer → verify blocked
[ ] Attempt check-in without social media consent selection → verify blocked
[ ] Check in same booking twice → verify second attempt rejected
```

### 9.3 POS Workflow — Selection & Invoice

```
[ ] Open POS for checked-in order:
    - Package lines visible with correct session type
    - Selected photo count editable per package line
    - Digital / Print / Split allocation toggle works and autosaves
    - Extra photo pricing shows per session type
[ ] Add standalone add-on via marketplace → verify add-on appears, invoice recalculates
[ ] Remove add-on (on open invoice) → verify add-on removed, invoice recalculates
[ ] Create Final Invoice from POS:
    - Invoice shows package total + add-ons + extra photos
    - Deposit deduction shows (e.g., "Deposit Paid (DEP-2026-XXXXX): -20.000 KD")
    - Remaining balance correct
[ ] Record partial payment → verify invoice stays OPEN
[ ] Record full payment → verify invoice CLOSED, locked badge appears
[ ] Attempt further edit after invoice locks → verify ADJUSTMENT prompt appears (not silent edit)
```

### 9.4 POS Workflow — Adjustment & Upgrade

```
[ ] After FINAL invoice locked, add new add-on:
    - ADJUSTMENT invoice created automatically
    - ADJUSTMENT appears in POS settlement panel
    - ADJUSTMENT shows "Open" status with amount
[ ] Pay the ADJUSTMENT invoice:
    - ADJUSTMENT closes and locks
    - POS settlement panel shows ADJUSTMENT as paid
[ ] Upgrade package from POS:
    - ADJUSTMENT created for delta price
    - Original package price snapshot preserved
    - Commission record created for delta
[ ] Attempt downgrade from POS (lower price package):
    - Manager approval prompt appears
    - Without manager: no action taken
    - With manager approval: CREDIT_NOTE created
```

### 9.5 POS Workflow — Credit Notes & Refunds (Manager)

```
[ ] As Manager: issue credit note for 50 KD on paid FINAL invoice:
    - CREDIT_NOTE invoice appears in financial history
    - Overpayment indicator appears in POS
[ ] As Manager: issue refund from POS:
    - REFUND invoice created
    - Refund payment shows as OUT
    - Overpayment cleared
[ ] As non-manager: attempt to issue credit note → verify 403/permission error
[ ] As non-manager: attempt refund → verify 403/permission error
```

### 9.6 Editing Workflow

```
[ ] Attempt editing start when FINAL invoice open → verify blocked, balance shown
[ ] After full payment: assign editor → editing starts successfully
[ ] Editor submits revision → order status updates
[ ] Revision approved → production can start
[ ] Attempt production before editing approved → verify blocked
```

### 9.7 Production & Delivery Workflow

```
[ ] Mark production READY_FOR_PICKUP → editing must be approved
[ ] Notify customer → CUSTOMER_NOTIFIED status
[ ] Record pickup → DELIVERED; deliveryCompletedById set to current user
[ ] Attempt delivery with open FINAL invoice → verify blocked
[ ] Attempt delivery before production ready → verify blocked
```

### 9.8 Reports & Financial View (Accountant)

```
[ ] View booking financials tab:
    - Deposit Invoice listed (locked, amount, date)
    - FINAL Invoice listed (status, amount, remaining)
    - ADJUSTMENT invoices listed if any
    - CREDIT_NOTE and REFUND invoices listed if any
    - All payments chronologically listed with method
[ ] Verify invoice number prefixes match expected format
[ ] Verify AuditLog entries visible for financial actions
```

---

## 10. Layer 7 — Transaction & Concurrency Testing

### 10.1 Booking Confirmation Atomicity

**Test:** Inject a simulated failure after BK reference generation but before FinancialCase creation (using Prisma `$transaction` error injection). Verify:
- No partial BK reference persisted
- `identifier_sequences` counter not advanced (or self-heals on retry)
- Booking remains PENDING

**Test:** Run two concurrent confirmation calls on the same PENDING booking.
- One must succeed; one must fail with conflict error.
- Exactly one FinancialCase, one Deposit Invoice, one BK reference must exist.

### 10.2 Double-Click Payment Submission

**Test:** Simulate rapid double-click by calling `createPaymentWithAllocation` twice in near-simultaneous requests on the same invoice.
- Simulate with `Promise.all([pay(), pay()])` in test harness.
- Expected: one payment succeeds; second rejected by overpayment guard or optimistic lock.
- Assert: exactly 1 Payment record, 1 PaymentAllocation.

### 10.3 Concurrent POS Editing

**Test:** Two staff members editing the same order's POS simultaneously (different tabs):
- Both have POS open with stale invoice state.
- Staff A adds add-on → ADJUSTMENT created.
- Staff B adds different add-on → second ADJUSTMENT must be created atomically, not merged silently.
- Assert: both ADJUSTMENT invoices exist with correct parentInvoiceId=FINAL.id.

**Test:** Staff A removes add-on (triggers CREDIT_NOTE prompt). Staff B adds same add-on while Staff A is in approval flow.
- Expected: Staff A's credit note should re-validate the order state before committing.

### 10.4 Invoice Lock Timing Race

**Test:** Payment A is at 99% of invoice total. Payment B and Payment C both attempt the final 1%.
- One of B/C must succeed; the other must be rejected.
- Invoice must close exactly once.
- Assert: status=CLOSED after exactly 2 total payments (A + one of B/C).

**Implementation guidance:** The service must use a row-level lock (`SELECT ... FOR UPDATE`) on the invoice row during payment processing to prevent this race.

### 10.5 Stale Browser Tab — Invoice Already Closed

**Test:** Staff opens POS with FINAL invoice open (status=OPEN). Another session closes the invoice (full payment). Staff in stale tab attempts payment submission.
- Expected: Server-side validation detects `invoice.status = CLOSED`; rejects payment with `invoice_already_settled`.
- Assert: No double payment created.

### 10.6 Transaction Rollback Verification

**Test:** Mixed ADJUSTMENT + CREDIT_NOTE creation (Feature 76c path). Inject failure after ADJUSTMENT created but before CREDIT_NOTE created.
- Expected: Both records rolled back. No orphan ADJUSTMENT without matching CREDIT_NOTE.
- Assert: 0 new ADJUSTMENT or CREDIT_NOTE records after failed transaction.

### 10.7 Identifier Sequence Race

**Test:** Two bookings confirmed simultaneously.
- Expected: Both receive unique BK references (no collision).
- Assert: All BK references in DB are unique.
- Implementation: Sequence generation must use `SELECT ... FOR UPDATE` or DB sequence atomic increment.

---

## 11. Layer 8 — Security & Permission Testing

### 11.1 Permission Matrix — Financial Actions

| Action | Admin | Manager | Receptionist | Accountant | Editor | Photographer |
|---|---|---|---|---|---|---|
| Record deposit | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Create Final Invoice | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Record payment | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Issue credit note | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Issue refund | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Approve adjustment | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Override delivery | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| View invoices | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Edit package price | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Commission override | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |

### 11.2 Required Test Cases

```
[ ] Non-manager calls createCreditNote API → must return 403
[ ] Non-manager calls createRefundInvoice API → must return 403
[ ] Non-manager calls reopenInvoice (if such endpoint exists) → must return 403
[ ] Editor role calls any financial endpoint → must return 403
[ ] Photographer role calls any financial endpoint → must return 403
[ ] Receptionist attempts delivery override → must return 403
[ ] Unlinked Clerk user (no Prisma User record) accesses any API → must redirect to /unauthorized
[ ] Inactive user (User.active=false) accesses any API → must redirect to /unauthorized
```

### 11.3 Locked Invoice Edit Prevention

```
[ ] API call to update totalAmount on locked invoice → must throw or return 400
[ ] API call to update invoiceType on any invoice → must throw (immutable)
[ ] API call to remove locked=true on a locked invoice → must throw or be no-op with error
[ ] Direct Prisma update to locked invoice via service (if service skips guard) → must be caught by invariant checker on next run
```

### 11.4 Forbidden Workflow Transitions

```
[ ] PENDING booking → CHECKED_IN (skipping CONFIRMED) → must throw
[ ] CONFIRMED booking → DELIVERED (skipping CHECKED_IN + workflow) → must throw
[ ] WAITING_SELECTION → EDITING (without full payment) → must throw
[ ] EDITING → DELIVERED (without READY_FOR_PICKUP) → must throw
[ ] Editing workflow: COMPLETED → IN_REVISION (regression) → must throw
```

### 11.5 API Validation Bypass Attempts

```
[ ] Submit payment with negative amount via direct API call → Zod rejects before service
[ ] Submit credit note with targetInvoiceId = ADJUSTMENT (not FINAL) → service rejects
[ ] Submit refund with amount > overpayment via direct API → service cap enforcement rejects
[ ] Submit adjustment with parentInvoiceId = another ADJUSTMENT → service rejects (INV-07)
[ ] Create booking with no package lines → Zod rejects (min 1 package required)
```

---

## 12. Layer 9 — Failure Recovery Testing

### 12.1 Partial Write Detection

After each multi-step financial operation fails mid-way, run the full invariant suite and assert 0 violations. The operations to test:

1. Booking confirmation fails after BK generation → 0 FinancialCase, 0 Deposit Invoice
2. Check-in fails after Job creation → 0 Order, FinancialCase.jobId not stamped
3. Final Invoice creation fails after invoice row created → 0 DocumentApplication
4. Payment choke point fails after Payment created → 0 PaymentAllocation
5. ADJUSTMENT creation fails after CREDIT_NOTE created (76c mixed path) → both rolled back
6. Refund fails after REFUND invoice created → 0 REFUND payment

### 12.2 Schema Migration Rollback

Verify that a failed migration does not leave partial schema state:

```sql
-- Run after intentionally broken migration
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('document_applications', 'payment_allocations', 'order_package_item_upgrades');
-- Should be present (migration landed) or absent (fully rolled back) — never partial
```

### 12.3 Reconciliation Recovery

**Scenario:** Nightly reconciliation detects a violation. Staff must be alerted but system must remain operational. Test that:

- Violation log entry is created with full context
- Slack notification sent (or marked as non-fatal failure with retry log)
- System continues serving requests normally
- No auto-repair applied (repair is manual + audited)

---

## 13. Layer 10 — Production Reconciliation Architecture

### 13.1 Nightly Invariant Runner Design

**Location:** `src/__tests__/financial/reconciliation/nightly-runner.ts`

**Schedule:** Nightly at 02:00 studio local time (as configured in Feature 74e)

**Runtime:** Read-only connection; no writes; reports only

**Design:**

```typescript
interface InvariantViolation {
  invariantId: string;          // e.g., 'INV-01'
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  affectedEntityType: string;
  affectedEntityIds: string[];
  description: string;
  detectedAt: Date;
  queryContext: string;         // The SQL / Prisma query that caught it
}

interface ReconciliationReport {
  runAt: Date;
  invoicesChecked: number;
  paymentsChecked: number;
  allocationsChecked: number;
  applicationsChecked: number;
  violations: InvariantViolation[];
  durationMs: number;
}
```

**Invariants run nightly (beyond CI invariants):**

- INV-18: FinancialCase totals reconcile to order totals (cross-table join — expensive)
- INV-19: No FINAL invoice without an order
- Orphan detection: PaymentAllocations referencing non-existent payments (external DB consistency)
- DocumentApplication referential integrity (both FKs resolve)
- Invoice number prefix consistency across all types
- Revenue reconciliation: SUM(Payment.amount WHERE direction=IN) = expected daily revenue from completed orders

### 13.2 Violation Severity Levels

| Severity | Examples | Response |
|---|---|---|
| CRITICAL | Missing PaymentAllocation; orphan DocumentApplication; DEPOSIT invoice not locked; negative balance | Page on-call immediately; block new financial operations until resolved |
| HIGH | ADJUSTMENT chained to ADJUSTMENT; REFUND with direction=IN; CREDIT_NOTE targeting ADJUSTMENT | Alert Slack; investigate within 24h |
| MEDIUM | Missing audit log entry; commission mismatch; invoice prefix inconsistency | Log to Slack; investigate within 48h |
| LOW | Extra-photo pricing mismatch; stale package snapshot | Weekly digest; review in sprint planning |

### 13.3 Alerting Strategy

```typescript
async function runNightlyReconciliation() {
  const report = await executeAllInvariants(readOnlyDb);

  if (report.violations.length === 0) {
    await postSlack(`✅ Reconciliation passed — ${report.invoicesChecked} invoices, ${report.paymentsChecked} payments checked`);
    return;
  }

  const criticals = report.violations.filter(v => v.severity === 'CRITICAL');
  const highs = report.violations.filter(v => v.severity === 'HIGH');

  if (criticals.length > 0) {
    await postSlack(`🚨 CRITICAL reconciliation violations detected`, { channel: ALERT_CHANNEL });
    await postSlack(formatViolations(criticals));
  }

  if (highs.length > 0) {
    await postSlack(`⚠️ HIGH reconciliation violations detected`, { channel: ALERT_CHANNEL });
  }

  await writeViolationLog(report); // Always write to DB log table
}
```

### 13.4 Monitoring Requirements

```
Environment variables required:
  FINANCIAL_RECON_DATABASE_URL     — read-only replica URL
  FINANCIAL_RECON_SLACK_WEBHOOK    — Slack webhook for alerts
  FINANCIAL_RECON_SLACK_CHANNEL    — target channel (e.g., #studio-alerts)

Recommended monitoring additions:
  - reconciliation_runs table (runAt, violationCount, durationMs, status)
  - Dashboard widget: "Last reconciliation: X violations at [time]"
  - Alert if reconciliation runner itself fails to complete
```

### 13.5 Repair Tooling (Manual + Audited)

DO NOT auto-repair violations. All repairs must be:
1. Reviewed by Manager or Admin
2. Executed through a dedicated `/admin/reconciliation/repair` UI (future feature)
3. Each repair creates an AuditLog entry with: who, what was repaired, why, before/after values

For now: reconciliation reports violations only. Repair is manual SQL + migration, reviewed and documented.

---

## 14. Gap Analysis — Required Outputs at Completion

The testing/implementing agent MUST generate the following four reports after completing all testing layers.

### 14.1 Financial Risk Report

The agent must produce `context/reviews/77-financial-risk-report.md` containing:

**A. Potential Corruption Vectors**
- List all points in the codebase where a financial record can be created outside the choke point
- List all service functions that accept `db` client directly instead of through a transaction
- List any places where `invoice.totalAmount` is mutated post-creation

**B. Unresolved Architectural Weaknesses**
- Single-allocation invariant is enforced in the app layer only (not a DB unique) — timing window for race
- Locked invoice immutability is checked in service layer only — no DB trigger prevents raw writes
- `PaymentType.BASE` retirement — any code paths still referencing it?

**C. Dangerous Assumptions**
- List any financial calculation that reads `invoice.paidAmount` as a cached field vs computing from allocations
- Any place that reads `Order.selectedPhotoCount` instead of deriving from `OrderPackage` lines
- Any remaining references to the retired virtual deposit credit path

**D. Missing Safeguards**
- No DB-level trigger preventing locked invoice mutation
- No DB-level constraint preventing ADJUSTMENT chaining (relies on app-layer only)
- No row-level locking documented in invoice payment service

**E. Transactional Weaknesses**
- Multi-step operations not wrapped in explicit `$transaction`
- Any async operations (e.g., audit log writes) outside the transaction boundary

### 14.2 Testing Coverage Report

The agent must produce `context/reviews/77-testing-coverage-report.md` containing:

**A. Covered Workflows** (list each INT-xx scenario with pass/fail)

**B. Untested Workflows** (flag any scenario from the matrix not covered by tests)

**C. Skipped Scenarios** (explain why skipped and what the risk is)

**D. Confidence Levels**

| Area | Confidence | Notes |
|---|---|---|
| PaymentAllocation choke point | HIGH/MEDIUM/LOW | |
| DocumentApplication binding | | |
| Locked invoice immutability | | |
| Classifier routing | | |
| Multi-package invoice math | | |
| Concurrency safety | | |

**E. High-Risk Unverified Areas** (be specific — what could still go wrong that wasn't tested)

### 14.3 Architecture Gap Analysis

The agent must produce `context/reviews/77-architecture-gap-analysis.md` containing:

**A. Architecture Inconsistencies**
- Any place where two modules own the same data (e.g., both invoice service and payment service recalculate the same balance)
- Any duplicate financial formula implementations (violation of code standards rule)

**B. Overly Complex Flows**
- Flows that require more than 3 service calls to accomplish a single user action
- Areas where business logic has leaked into API handlers or components

**C. Maintainability Concerns**
- Files that are too large (>300 lines) and mix multiple concerns
- Invariant checks scattered across multiple files instead of centralized

**D. Cleanup Recommendations**
- Retired code paths that should be deleted (any remaining BASE payment type references)
- Fields that are documented as deprecated but still read (e.g., `Order.addOns` JSON)
- Legacy fallback paths that can now be removed

**E. Future Scalability Concerns**
- Single-allocation invariant will need to be loosened for multi-tranche payments (voucher phase)
- `identifier_sequences` approach will need partitioning strategy for high-volume
- Invoice number sequence is shared — prefix display only; ADJUST if audit requires type isolation

**F. Auditability Concerns**
- Are all financial actions creating AuditLog entries with full context?
- Is the `actorUserId` gap (Gap #8 from auth-review.md) still present on audit-critical services?
- Missing: who closed an invoice (the staff member who made the final payment) is not attributed separately from the payment actor

### 14.4 Operational Risk Analysis

The agent must produce `context/reviews/77-operational-risk-analysis.md` containing:

**A. Employee Misuse Risks**
- Can a receptionist void a deposit invoice? (Should be impossible — check service guards)
- Can a non-manager approve their own credit note? (Should require a different manager)
- Can a photographer view financial data through a URL they know? (Check permission middleware)

**B. UX Confusion Risks**
- Overpayment flag in POS — is it clear enough that money is owed back to customer?
- Mixed ADJUSTMENT + CREDIT_NOTE in one save — does POS communicate both to staff clearly?
- Locked invoice badge — does it clearly explain WHY it's locked and what to do?

**C. Workflow Bypass Risks**
- Can editing start without full payment via a direct API call bypassing the UI guard?
- Can delivery be marked complete without pickup recorded via direct API?
- Can a package upgrade bypass commission creation?

**D. Reconciliation Risks**
- If nightly reconciliation fails to run (ENV vars not set), does it fail silently or alert?
- What is the maximum data loss window if a corruption is introduced and not detected until the next reconciliation run?

**E. Production Failure Scenarios**
- What happens if the Slack webhook is down? (Reconciliation should non-fatally log and continue)
- What happens if the read-only replica is unreachable? (Reconciliation should skip, not auto-repair)
- What happens if identifier_sequences has a collision? (Does self-heal mechanism cover all cases?)

---

## 15. Implementation Order & Blockers

### 15.1 Recommended Execution Order

```
Phase A (Days 1-2): Layer 0 + Layer 1
  - Run schema integrity queries
  - Run migration verification queries
  - Fix any failing checks before proceeding
  BLOCKER: No Layer 2+ work until all Layer 0 and 1 checks pass

Phase B (Days 3-5): Layer 2 — Invariant Suite
  - Implement all INV-01 through INV-28
  - Wire into npm run test:backend-invariants
  - Run against dev database
  - Fix any violations found
  BLOCKER: No Layer 3+ work until full invariant suite passes

Phase C (Days 6-9): Layer 3 — Integration Matrix
  - Implement INT-01 through INT-15
  - Each scenario as a fixture + service test
  BLOCKER: No Layer 4+ work until all integration tests pass

Phase D (Days 10-12): Layer 4 — Edge Cases
  - Implement EC-13 through EC-42
  - Document any new invariants discovered

Phase E (Day 13): Layer 5 — Regression
  - Verify 74, 75, 76 regressions
  - Run full test suite

Phase F (Day 14): Layer 6 — Manual QA
  - Execute operational QA checklist against dev environment
  - Document any UI bugs found

Phase G (Days 15-16): Layers 7, 8, 9 — Concurrency, Security, Recovery
  - Concurrency tests
  - Permission matrix tests
  - Rollback tests

Phase H (Day 17): Layer 10 — Reconciliation
  - Verify nightly runner works
  - Test alert pathways

Phase I (Days 18-19): Gap Analysis Reports
  - Generate all four reports
  - Review findings with team
  DELIVERABLE: All four reports produced before any new feature work begins
```

### 15.2 Must-Pass Before Production Criteria

The following are **hard blockers for production deployment** of any new financial feature:

- [ ] All INV-01 through INV-28 pass on CI
- [ ] All INT-01 through INT-15 integration tests pass
- [ ] E1–E12 classifier tests pass
- [ ] Permission matrix tests pass (no unauthorized financial access)
- [ ] No orphan PaymentAllocation or DocumentApplication in dev DB
- [ ] Nightly reconciliation runner executes without errors
- [ ] Production reconciliation ENV vars configured and verified
- [ ] 77-financial-risk-report.md produced
- [ ] 77-testing-coverage-report.md produced with all HIGH-risk areas addressed
- [ ] 77-architecture-gap-analysis.md produced with actionable cleanup items prioritized

### 15.3 Nice-to-Have (Not Blockers)

- EC-37 concurrency test (requires transaction-level test harness setup)
- EC-39 voucher schema compatibility (no vouchers yet — future-proofing)
- Full Playwright / E2E coverage for POS workflow (manual QA sufficient for now)

---

## 16. Appendix — Reference Queries

### 16.1 Invoice Balance Correctness Check

```sql
-- For each FINAL invoice, compute expected remaining balance
-- and compare to stored paidAmount field
SELECT
  i.id,
  i.invoice_number,
  i.total_amount,
  i.paid_amount AS stored_paid_amount,
  COALESCE(alloc_sum.total, 0) + COALESCE(app_sum.total, 0) AS computed_paid_amount,
  i.total_amount - (COALESCE(alloc_sum.total, 0) + COALESCE(app_sum.total, 0)) AS computed_remaining
FROM invoices i
LEFT JOIN (
  SELECT invoice_id, SUM(amount) AS total
  FROM payment_allocations
  GROUP BY invoice_id
) alloc_sum ON alloc_sum.invoice_id = i.id
LEFT JOIN (
  SELECT target_document_id, SUM(amount) AS total
  FROM document_applications
  GROUP BY target_document_id
) app_sum ON app_sum.target_document_id = i.id
WHERE i.invoice_type = 'FINAL'
ORDER BY i.created_at DESC;
```

### 16.2 FinancialCase Health Summary

```sql
-- Full health view per FinancialCase
SELECT
  fc.id AS financial_case_id,
  b.public_id AS bk_reference,
  j.job_number AS job_reference,
  COUNT(DISTINCT i.id) FILTER (WHERE i.invoice_type = 'DEPOSIT') AS deposit_invoices,
  COUNT(DISTINCT i.id) FILTER (WHERE i.invoice_type = 'FINAL') AS final_invoices,
  COUNT(DISTINCT i.id) FILTER (WHERE i.invoice_type = 'ADJUSTMENT') AS adjustment_invoices,
  COUNT(DISTINCT i.id) FILTER (WHERE i.invoice_type = 'CREDIT_NOTE') AS credit_notes,
  COUNT(DISTINCT i.id) FILTER (WHERE i.invoice_type = 'REFUND') AS refunds,
  COUNT(DISTINCT p.id) FILTER (WHERE p.direction = 'IN') AS inbound_payments,
  COUNT(DISTINCT p.id) FILTER (WHERE p.direction = 'OUT') AS outbound_payments
FROM financial_cases fc
JOIN bookings b ON b.id = fc.booking_id
LEFT JOIN jobs j ON j.id = fc.job_id
LEFT JOIN invoices i ON i.financial_case_id = fc.id
LEFT JOIN payments p ON p.financial_case_id = fc.id
GROUP BY fc.id, b.public_id, j.job_number
ORDER BY fc.created_at DESC;
```

### 16.3 Orphan Detection Query

```sql
-- Detect all PaymentAllocations without a matching Payment
SELECT pa.id, pa.payment_id, pa.invoice_id, pa.amount
FROM payment_allocations pa
LEFT JOIN payments p ON p.id = pa.payment_id
WHERE p.id IS NULL;

-- Detect all DocumentApplications with broken source FK
SELECT da.id, da.source_document_id, da.target_document_id
FROM document_applications da
LEFT JOIN invoices src ON src.id = da.source_document_id
WHERE src.id IS NULL;

-- Detect all DocumentApplications with broken target FK
SELECT da.id, da.source_document_id, da.target_document_id
FROM document_applications da
LEFT JOIN invoices tgt ON tgt.id = da.target_document_id
WHERE tgt.id IS NULL;
```

---

*Generated: 2026-05-15 | Spec version: 1.0 | Status: Ready for testing agent execution*
*This spec is the authoritative testing mandate for all Studio OS financial architecture work through Feature 76c.*
