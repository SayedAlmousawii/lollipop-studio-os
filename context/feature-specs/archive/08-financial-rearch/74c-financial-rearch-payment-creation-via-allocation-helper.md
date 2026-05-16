## Goal

Introduce `createPaymentWithAllocation` as the single sanctioned path for creating Payments, and migrate every existing Payment creation call site to use it. New Payments going forward always create a paired PaymentAllocation in the same transaction. Behavior visible to users is unchanged.

Depends on 73b (discipline infra), 74a (tables exist), 74b (backfill complete).

---

## Read First

- `context/Financial reviews/financial-rearchitecture-master-plan.md` — "Service-layer choke points" section
- `src/modules/payments/payment.service.ts` — every existing Payment creation path
- `src/modules/bookings/booking.service.ts:594-719` — deposit recording flow that creates a Payment
- Any test file that creates Payments directly via `prisma.payment.create`

---

## Rules

- `createPaymentWithAllocation` is the ONLY path that creates Payment rows after this spec ships
- Direct `prisma.payment.create` calls in `src/` are replaced or removed
- The helper enforces the single-allocation invariant: if more than one allocation is supplied (anticipating Phase 5), throw `Error('Multi-allocation payments not supported until Phase 5')`
- The helper runs Payment + PaymentAllocation creation in a single transaction
- The helper sets `Payment.direction` from the input (defaults to `IN` for backwards compatibility)
- No change to `recalculateInvoiceStatus` yet — that's 74d
- No change to UI

---

## Scope

### In Scope

**New helper `createPaymentWithAllocation`**

Lives in `src/modules/payments/payment.service.ts` (or a new `payment.creation.ts` if the service file is large — match existing module structure).

Signature (TypeScript shape):
```ts
type CreatePaymentInput = {
  invoiceId: string;
  amount: Decimal;
  method: PaymentMethod;
  paymentType: PaymentType;
  direction?: PaymentDirection; // defaults to IN
  paidAt?: Date;
  reference?: string;
  notes?: string;
  financialCaseId: string;
  // Phase 5 will accept an allocations array; v1 derives single allocation from invoiceId + amount
};

async function createPaymentWithAllocation(
  input: CreatePaymentInput,
  tx: PrismaClient | TransactionClient,
): Promise<Payment>;
```

Behavior:
1. Validate `amount > 0`
2. Validate `invoiceId` exists and belongs to `financialCaseId`
3. Create `Payment` row with given direction (default `IN`)
4. Create exactly one `PaymentAllocation` row with `paymentId = payment.id`, `invoiceId = input.invoiceId`, `amount = input.amount`
5. Return the created Payment

All within the supplied transaction.

**Call site migration**

Audit `src/` for every reference that creates a Payment row. Replace each with `createPaymentWithAllocation`. Key call sites known to exist:
- `payment.service.ts` — the main `recordPayment` path
- `booking.service.ts:594-719` — deposit payment recording
- Any test factory or seed script

For tests: introduce a `tests/fixtures/financial.ts` helper that uses `createPaymentWithAllocation` under the hood. (This is the shared financial fixtures module referenced in the master plan — establish it here.)

**Choke-point pattern registration**

The `scripts/check-financial-choke-points.sh` framework was established in 73b with an empty pattern list. Append the following patterns to its forbidden-list:
- `prisma.payment.create`
- `prisma.payment.createMany`

Allowlist `src/modules/payments/payment.service.ts` (the file containing `createPaymentWithAllocation`). CI runs the script as a pre-merge check — already wired by 73b.

**Invariant registrations**

Register two invariants into the registry created in 73b (`src/modules/financial/invariants.ts`):

```ts
registerInvariant({
  name: 'payment-has-exactly-one-allocation',
  scope: 'financial-case',
  run: async ({ tx }, { financialCaseId }) => { /* ... */ },
});

registerInvariant({
  name: 'allocation-sum-equals-payment-amount',
  scope: 'financial-case',
  run: async ({ tx }, { financialCaseId }) => { /* ... */ },
});
```

These appear in `runAllInvariants` (CI) and `assertFinancialCaseInvariants` (runtime, called inside `createPaymentWithAllocation`) automatically.

**Use of shared fixtures module**

Tests created in this spec consume `makeCashDepositBookingFixture` from `tests/fixtures/financial.ts` (established in 73b). Do not create new fixture factories in this spec — the existing one already covers Payment + PaymentAllocation creation. Phase 2+ specs will add new factories.

**Type-level guarantees**

The `CreatePaymentInput` signature uses `Money` and `PaymentDirection` from `src/modules/financial/types.ts` (established in 73b).

### Out of Scope

- `recalculateInvoiceStatus` refactor (74d)
- Removal of virtual deposit credit (74e)
- DocumentApplication creation hook at FINAL-invoice-creation time (74d — bundled with the read-path change since they're tightly coupled)
- The full invariant test suite for CI (added incrementally; 74d wires the cross-table invariants)

---

## Implementation Direction

**Audit step (do first):**
Run `grep -rn 'prisma.payment.create\b\|prisma.payment.createMany\b' src/` and produce the full call site list. Each one is a separate edit point in this spec.

**Risk:** If a code path creates a Payment without going through `createPaymentWithAllocation`, the single-allocation invariant breaks silently. The `assertFinancialCaseInvariants` call at the end of `createPaymentWithAllocation` is the safety net for the *sanctioned* path; the lint/CI rule catches *unsanctioned* paths. Both matter.

**Transaction semantics:** Callers may supply their own transaction (when Payment creation is part of a larger flow like deposit recording). The helper accepts an optional `tx` parameter; if not supplied, it opens its own.

**Rollback:** Revert the call site changes. The helper itself is additive; leaving it in place after revert is fine. The PaymentAllocation rows created by the helper are valid even if the read path doesn't use them yet.

---

## Verification

After this spec ships:
- `grep -rn 'prisma.payment.create\b' src/` returns only matches inside `payment.service.ts` (specifically inside `createPaymentWithAllocation`)
- Every newly-created Payment has exactly one PaymentAllocation row (verify via `tests/financial-invariants.test.ts` after running a fixture seed)
- `assertFinancialCaseInvariants` passes for every FinancialCase
- All existing user-facing flows work unchanged
