## Goal

Refactor `recalculateInvoiceStatus` to compute `effectivePaid` from explicit `PaymentAllocation` + `DocumentApplication` rows instead of the virtual `getDepositCreditAmountForFinancialCase` lookup. Land the new calculation behind a dual-read feature flag — both paths execute, discrepancies log at WARN, the old path remains authoritative during the verification window. Also adds the DEPOSIT → FINAL DocumentApplication creation hook at FINAL invoice creation time.

Depends on 73b (discipline infra: dual-read helper, discrepancy logger), 74a, 74b, 74c.

The actual cutover (flag flip + removal of the old code) is 74e.

---

## Read First

- `context/Financial reviews/financial-rearchitecture-master-plan.md` — "Dual-read verification windows" and "Risk management" sections
- `src/modules/invoices/invoice.service.ts:630-634` — current `recalculateInvoiceStatus` implementation
- `src/modules/invoices/invoice.service.ts:1179-1196` — current `getDepositCreditAmountForFinancialCase` (stays untouched in this spec)
- The FINAL invoice creation paths in `invoice.service.ts` (every path that creates an invoice with `invoiceType = FINAL`)

---

## Rules

- The old `recalculateInvoiceStatus` calculation remains authoritative throughout this spec — the new path is shadow-computed only
- Discrepancies log at WARN with both values and the invoice id; they MUST NOT throw
- The feature flag `FINANCIAL_REARCH_PHASE_1_DUAL_READ` defaults ON (dual-read enabled, old path authoritative)
- DEPOSIT → FINAL `DocumentApplication` is created in the same transaction as FINAL invoice creation, only when the DEPOSIT has `paidAmount > 0`
- The DocumentApplication `(sourceInvoiceId, targetInvoiceId)` unique constraint from 74a is the safety net against double creation; rely on it explicitly
- No change to user-visible behavior — `Invoice.paidAmount`, `Invoice.remainingAmount`, `Invoice.status` continue to be driven by the old calculation

---

## Scope

### In Scope

**New calculator function**

In `src/modules/invoices/invoice.calculation.ts` (new file) or alongside existing invoice service:

```ts
async function computeEffectivePaidFromAllocations(
  invoiceId: string,
  tx: PrismaClient | TransactionClient,
): Promise<Decimal>;
```

Logic:
```
effectivePaid =
    SUM(PaymentAllocation.amount WHERE invoiceId = X AND payment.direction = 'IN')
  - SUM(PaymentAllocation.amount WHERE invoiceId = X AND payment.direction = 'OUT')
  + SUM(DocumentApplication.amountApplied WHERE targetInvoiceId = X)
```

**Declare the feature flag**

Add `FINANCIAL_REARCH_PHASE_1_DUAL_READ` to whatever flag system the project uses. Default ON (dual-read enabled, old path authoritative).

**Dual-read integration in `recalculateInvoiceStatus`**

Use the `dualRead` helper established in 73b (`src/modules/financial/dual-read.ts`). The helper handles flag check, both-path execution, discrepancy logging, and metric emission — this spec only supplies the two functions and the metadata:

```ts
const effectivePaid = await dualRead({
  phase: 'phase-1-recalculate',
  path: 'invoice.recalculateStatus',
  entityId: invoice.id,
  flagKey: 'FINANCIAL_REARCH_PHASE_1_DUAL_READ',
  oldFn: () => oldComputeEffectivePaid(invoice),
  newFn: () => computeEffectivePaidFromAllocations(invoice.id, tx),
  authoritative: 'old',
  compare: (a, b) => a.minus(b).abs().lte(new Decimal('0.001')),
});
```

The discrepancy logger and `financial.rearch.dual_read.discrepancy` metric are provided by 73b — they fire automatically when `compare` returns false. No new logging or metric code in this spec.

**DEPOSIT → FINAL DocumentApplication hook**

Identify every code path that creates a FINAL invoice. In each, after the FINAL is created and before the transaction commits:
1. Look up the FinancialCase's DEPOSIT invoice (`invoiceType = DEPOSIT` for the same `financialCaseId`)
2. If the DEPOSIT exists and `paidAmount > 0`: insert a `DocumentApplication` row with `sourceInvoiceId = deposit.id`, `targetInvoiceId = final.id`, `amountApplied = deposit.paidAmount`, `notes = 'Phase 1: deposit auto-application'`
3. If `(sourceInvoiceId, targetInvoiceId)` already exists (unique violation), swallow the error — the row was created by 74b backfill for in-flight orders

Extract this into a helper `applyDepositToFinalIfPresent(financialCaseId, finalInvoiceId, tx)` for reuse.

**Invariant registrations**

Register additional invariants into the 73b registry (74c already registered the payment-allocation invariants):

```ts
registerInvariant({
  name: 'financial-case-net-balance-non-negative',
  scope: 'financial-case',
  run: /* invariant 1 from master plan */,
});

registerInvariant({
  name: 'document-application-not-over-source',
  scope: 'global',
  run: /* invariant 8 from master plan: amountApplied <= source.paidAmount */,
});
```

These appear automatically in `tests/financial-invariants.test.ts` (the test runner iterates the registry — no test-file edits needed) and in `assertFinancialCaseInvariants` runtime calls.

**Observability**

The `financial.rearch.dual_read.discrepancy{phase, path}` metric is already emitted by the `dualRead` helper from 73b — no new metric code in this spec. Confirm the metric appears in observability tooling with `phase=phase-1-recalculate` and `path=invoice.recalculateStatus` labels.

### Out of Scope

- Flipping the feature flag (74e)
- Removing `getDepositCreditAmountForFinancialCase` (74e)
- Removing the dual-read code path (74e)

---

## Implementation Direction

**Verification window strategy:**
After this spec ships, monitor the `financial.rearch.dual_read.discrepancy` counter. Target: zero discrepancies across at least one full release cycle (e.g., one week of normal usage). Spec 74e is gated on this.

**Why DEPOSIT→FINAL hook lands here (not 74c):**
74c is about Payment creation. The DocumentApplication hook is about Invoice creation. They live in different services. Bundling the hook with the read-path change in 74d keeps `invoice.service.ts` changes in one spec.

**Decimal arithmetic:**
Use the project's Decimal library consistently (likely Prisma's Decimal or a wrapper). Tolerance for dual-read comparison is 0.001 KD to absorb rounding artifacts; anything larger is a real discrepancy.

**Risk:** A WARN log that's actually a real discrepancy looks identical to a rounding artifact. Tune tolerance carefully against early data; if discrepancies > 0 after the verification window, do not proceed to 74e until root-caused.

**Rollback:** Flip the feature flag OFF. Old path continues as authoritative; new path stops shadow-computing. DocumentApplication rows created by the FINAL hook remain in the DB but are unused — safe to leave.

---

## Verification

- `FINANCIAL_REARCH_PHASE_1_DUAL_READ` flag exists and defaults ON
- Creating a new FINAL invoice for a FinancialCase with a paid DEPOSIT produces exactly one new `DocumentApplication` row
- For existing FinancialCases that already have a DocumentApplication from 74b backfill, creating a (hypothetical) duplicate triggers the unique constraint catch — no row inserted, no error surfaced
- Running the invoice recalculation against fixture data emits no `financial.rearch.dual_read.discrepancy` WARN logs
- `tests/financial-invariants.test.ts` passes with all three invariants
- All existing user-facing flows work unchanged; `Invoice.paidAmount` continues to be set by the old calculation
