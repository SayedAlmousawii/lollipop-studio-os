## Goal

Lay the cross-cutting financial discipline framework that every subsequent phase (74a onward) consumes. This spec creates **empty registries and shells** — invariant test harness, runtime invariant function, shared fixtures module, choke-point CI rule, dual-read flag scaffolding, discrepancy logger, reconciliation job harness, ADR directories, type-level guarantees, and CHECK constraints on existing financial tables.

After this spec ships, every later financial spec **registers into** these structures rather than inventing new ones. The framework is built once; the registries grow with each phase.

This is a Phase 0 companion spec — it lands between 73 and 74a.

---

## Read First

- `context/Financial reviews/financial-rearchitecture-master-plan.md` — "Risk management and invariant discipline" section in full
- `prisma/schema.prisma` — `Invoice`, `Payment` (post Spec 73)
- Existing test infrastructure under `tests/` or wherever the project hosts tests (verify location before writing)
- Existing migration patterns under `prisma/migrations/` for raw-SQL CHECK examples

---

## Rules

- This spec creates **scaffolding, not behavior**. Every registry starts empty (except for the constraints that apply to already-existing tables).
- Every framework module exposes a registration API — new invariants, fixtures, forbidden patterns, ADRs are *added* by later specs, never by editing this spec's outputs.
- No financial flow changes behavior as a result of this spec.
- CHECK constraints on existing tables (`Invoice`, `Payment`) are the only schema migration here. They are non-negotiable: failing rows abort the migration so any pre-existing bad data is caught.

---

## Scope

### 1. CHECK constraints on existing financial tables

Schema migration adding raw-SQL CHECK constraints:

- `invoices`: `CHECK (paid_amount >= 0)`, `CHECK (total_amount >= 0)`, `CHECK (remaining_amount >= 0)`
- `payments`: `CHECK (amount > 0)` — direction encodes in/out, sign stays positive

If any existing row violates these, the migration aborts. Investigate before proceeding — those rows are data bugs.

(`DocumentApplication.amount_applied > 0` and `payment_allocations.amount > 0` CHECKs are added in 74a alongside the new tables; `gift_cards.current_balance >= 0` and `<= original_amount` land in 77a.)

### 2. Invariant registry and runtime helper

New module `src/modules/financial/invariants.ts`:

```ts
type InvariantContext = { tx: PrismaClient | TransactionClient };
type InvariantViolation = {
  invariant: string;
  entityType: string;
  entityId: string;
  expected: string;
  actual: string;
};
type InvariantCheck = {
  name: string;
  scope: 'financial-case' | 'global';
  run: (ctx: InvariantContext, scopeArgs?: { financialCaseId?: string }) => Promise<InvariantViolation[]>;
};

const invariantRegistry: InvariantCheck[] = [];

export function registerInvariant(check: InvariantCheck): void { /* push */ }
export async function assertFinancialCaseInvariants(financialCaseId: string, tx: TransactionClient): Promise<void>;
export async function runAllInvariants(tx: PrismaClient): Promise<InvariantViolation[]>;
```

`assertFinancialCaseInvariants` runs every registered check with `scope: 'financial-case'` filtered to the given FinancialCase and throws on violations. Used inside service helpers in the same transaction.

`runAllInvariants` runs every registered check globally and returns violations without throwing. Used by the CI test and the nightly reconciliation job.

The registry starts **empty**. Phase 1 specs (74c, 74d) register their invariants. Later phases append.

### 3. CI invariant test file

New file `tests/financial-invariants.test.ts`:

```ts
test('financial invariants all pass against seeded fixtures', async () => {
  await seedAllSharedFixtures(prisma);
  const violations = await runAllInvariants(prisma);
  expect(violations).toEqual([]);
});
```

That's the entire test runner. New invariants don't change this file — they register themselves and are picked up automatically.

### 4. Shared financial fixtures module

New module `tests/fixtures/financial.ts`:

```ts
export async function makeCashDepositBookingFixture(prisma: PrismaClient): Promise<BookingFixtureResult>;
// later phases append:
//   makeAdjustedBookingFixture     (Phase 2)
//   makeRefundedBookingFixture     (Phase 3)
//   makeVoucherBackedBookingFixture (Phase 4)
//   makeMultiPackageBookingFixture (future)

export async function seedAllSharedFixtures(prisma: PrismaClient): Promise<void>;
```

Initial implementation: only `makeCashDepositBookingFixture` (already buildable from current models). `seedAllSharedFixtures` invokes whatever factories exist. Phase 1 specs add nothing here (current model already covers their needs); Phase 2+ each append a new factory.

### 5. CI choke-point checker

New file `scripts/check-financial-choke-points.sh` (or equivalent in TS if preferred):

```bash
#!/usr/bin/env bash
# Forbidden patterns by spec. Each phase appends to this list.
patterns=(
  # 74c will add: "prisma.payment.create" / "prisma.payment.createMany"
  # 75a will add: "prisma.invoice.create" patterns for ADJUSTMENT type
  # 77a will add: "prisma.giftCard.create"
)
# Search src/ for patterns; allowlist sanctioned helpers.
```

Initial implementation: empty pattern list with comment markers showing where each phase appends. Wire into CI as a pre-merge check. Document in `CONTRIBUTING.md` or equivalent.

### 6. Dual-read flag + discrepancy logger infrastructure

New module `src/modules/financial/dual-read.ts`:

```ts
type DualReadResult<T> = { oldValue: T; newValue: T; matched: boolean };

export async function dualRead<T>(opts: {
  phase: string;          // e.g. "phase-1-recalculate"
  path: string;           // e.g. "invoice.recalculateStatus"
  entityId: string;
  flagKey: string;
  oldFn: () => Promise<T>;
  newFn: () => Promise<T>;
  compare?: (a: T, b: T) => boolean;
  authoritative?: 'old' | 'new'; // default 'old'
}): Promise<T>;
```

Behavior:
1. Always run `oldFn`
2. If the named feature flag is ON, also run `newFn`
3. If results differ (by `compare`, default deep-equal or Decimal-tolerance for numeric), emit a WARN log with structured fields and increment metric `financial.rearch.dual_read.discrepancy{phase, path}`
4. Return whichever the `authoritative` setting names

The `flagKey` is read from the existing project flag system (whatever it is). 74d's flag `FINANCIAL_REARCH_PHASE_1_DUAL_READ` doesn't exist yet — that flag is declared in 74d's spec. This module just consumes whatever the project's flag mechanism provides.

This is the only place dual-read logic lives. 74d, 75b, 77c, 77d all consume `dualRead(...)` directly.

### 7. Reconciliation job harness

New file `scripts/financial-reconciliation.ts`:

```ts
async function main() {
  const violations = await runAllInvariants(prisma);
  if (violations.length > 0) {
    await postToSlackIfConfigured(violations);
    console.error('Financial invariant violations:', violations);
    process.exit(1);
  }
  console.log('Financial invariants: OK');
}
```

74e schedules this nightly. This spec just ships the harness — the schedule entry lands when 74e merges.

Slack webhook config via env vars `FINANCIAL_RECON_SLACK_WEBHOOK` and `FINANCIAL_RECON_SLACK_CHANNEL`. Optional — if unset, console-only.

### 8. ADR directories and template

Create directories:
- `src/modules/invoices/decisions/`
- `src/modules/payments/decisions/`
- `src/modules/financial/decisions/`

Each gets a `README.md` explaining the ADR pattern (one decision per file, dated, with the rule + why + how-to-apply structure mirroring the memory format).

Seed ADRs (one per directory) capturing already-decided rules from the master plan:
- `src/modules/invoices/decisions/001-no-virtual-deposit-credit.md` — deposit credit is an explicit `DocumentApplication` row, never a runtime SUM
- `src/modules/payments/decisions/001-direction-not-sign.md` — `Payment.amount` is always positive; `Payment.direction` encodes in/out
- `src/modules/financial/decisions/001-document-application-scope.md` — `DocumentApplication` is for credit transfers between invoices only; ADJUSTMENT is settled by PaymentAllocation

Future phases add ADRs in the same format as new rules are established (e.g., 77a will add `src/modules/vouchers/decisions/001-single-redemption-mutable-balance.md`).

### 9. Type-level guarantees

New module `src/modules/financial/types.ts`:

- Discriminated union types for `InvoiceType` (DEPOSIT, FINAL, ADJUSTMENT, REFUND, CREDIT_NOTE, SALE) with per-variant required fields where applicable
- `PaymentDirection` as a string-literal union
- Money type alias enforcing `Decimal` everywhere (`type Money = Decimal`) — codify "no `number` for money math"

Use these types in new helpers (74c's `createPaymentWithAllocation` consumes `Money` and `PaymentDirection`). Existing service code continues to use Prisma's generated types — we don't refactor pre-existing code in this spec.

### 10. Per-phase observability checklist

Add a section template to `context/feature-specs/SPEC_TEMPLATE.md` (create if not present, otherwise document the requirement in `context/feature-specs/README.md` if one exists). The template enforces that every phase spec includes:

- **Dashboards / metrics** — what counters/gauges/timers this phase emits
- **Rollback plan** — schema down-migration + flag-flip-back behavior + non-recoverable data list
- **Customer-visible surface** — what staff / customers see change

This is documentation-only in this spec. It is enforced by review when later specs (75a onward) are written.

### Out of Scope

- Any new invariant content (each phase adds its own)
- Any new fixture content beyond `makeCashDepositBookingFixture` (each phase adds its own)
- The dual-read flag definition for Phase 1 — that's 74d's job
- Reconciliation job scheduling — that's 74e
- ESLint plugin (if the project doesn't already use one, the shell-script checker is sufficient)
- Refactoring existing service code to use the new types

---

## Implementation Direction

**Order within the spec:**
1. Schema migration: add CHECK constraints to `invoices` and `payments` (abort if rows violate)
2. Create `src/modules/financial/` directory with `invariants.ts`, `dual-read.ts`, `types.ts`, `decisions/`
3. Create `tests/financial-invariants.test.ts` and `tests/fixtures/financial.ts`
4. Create `scripts/check-financial-choke-points.sh` (or TS equivalent) and `scripts/financial-reconciliation.ts`
5. Create ADR directories under `src/modules/{invoices,payments}/decisions/` with READMEs + seed ADRs
6. Document per-phase observability checklist in spec template / README

**Risk:** The CHECK constraints on existing tables are the only behavioral risk. If any current row violates them, the migration aborts. That's the correct behavior — a violating row is a bug to be fixed before proceeding, not silently allowed.

**Rollback:** Drop the CHECK constraints; delete the new modules and scripts. No service depends on this infra at the moment it ships — every consumer is in 74a onward.

---

## Verification

- `\d invoices` and `\d payments` show the new CHECK constraints
- `runAllInvariants(prisma)` returns `[]` against current data (empty registry → no invariants → no violations — trivially passes)
- `tests/financial-invariants.test.ts` runs green
- `scripts/check-financial-choke-points.sh` runs without flagging anything (empty pattern list)
- `scripts/financial-reconciliation.ts` runs and reports "OK" (empty registry)
- The three seed ADR files exist with the documented decisions
- `src/modules/financial/types.ts` exports the type aliases and is importable
- All existing user-facing flows work unchanged
