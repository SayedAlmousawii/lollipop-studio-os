# 153 · F1 — Credit-Note Drawable-Pool Foundation

> Plan label **F1** (settlement arc); repo number **153** is provisional — renumber if a
> different spec ships first. Part of the credit settlement-application arc; see
> `context/reviews/credit-settlement-application-plan.md` (esp. §7.1).

## Goal

Lay the credit-application foundation for the settlement arc **without changing any
financial behavior or emission**. This unit adds an explicit `kind` discriminator to
`DocumentApplication`, converts credit notes from "fully applied + closed at birth" into
**drawable pools** whose unused balance is **derived** from their applications
(`available = totalAmount − Σ applications`, mirroring how invoices already derive
effective-paid) rather than stored and mutated — so a credit-note row stays **write-once**
after issuance. It also reworks the financial invariants so partial application and a
future invoice-targeted `SETTLEMENT` application are permitted. No production code emits
settlement applications or partial credit notes yet (that is B1); F1 only makes the data
model, derivation, and invariants able to represent them, proven by tests with synthetic
fixtures.

## Read First

- `context/reviews/credit-settlement-application-plan.md` — locked decisions (esp. #8
  immutable+offsetting, #9 drawable pool) and §7.1 verified F1 findings.
- `prisma/schema.prisma` — `DocumentApplication`, `Invoice`, `PaymentAllocation`.
- `prisma/migrations/20260516020000_invoice_lock_snapshot_and_immutability/migration.sql`
  — `reject_frozen_field_mutation_on_locked_invoice`; confirms `remainingAmount`/`status`
  are **not** frozen on locked invoices (drawable pool is DB-safe).
- `src/modules/invoices/invoice.service.ts` — `createCreditNoteWithClient` (lifecycle +
  immediate full-amount applications), `computeCreditNoteCapacityForFinal`,
  `credit-note-is-locked-on-issuance` issuance path.
- `src/modules/invoices/invoice.calculation.ts` — `computeEffectivePaidFromAllocations`
  (sums `documentApplications` into target effective-paid; kind-agnostic, must stay so).
- `src/modules/financial/invariants.ts` — the named invariants this unit edits/adds.
- `src/modules/financial/reconciliation-invariants.ts` — `DocumentApplication` FK
  existence checks (unaffected, but confirm).
- `src/modules/financial/invariant-catalog.ts` + `npm run docs:generate` — owner-facing
  index; regenerate after invariant changes.
- `tests/backend-invariants/run.ts` and the financial invariant test patterns — where
  invariant regression is wired.

## Rules

- **Foundation only. Zero behavior change.** Do not modify OrderCommit emission
  (`order-commit-financial-emission.service.ts`, `routeCreditNoteCandidate`), preview
  (`order-commit-approval-document-preview.service.ts`), payment/refund flows, the Sales
  read layer, or any UI/copy.
- **No financial *math* change.** `computeEffectivePaidFromAllocations` and all balance
  arithmetic stay byte-for-byte. Adding `kind` must not alter any summed amount.
- **Additive + reversible.** New column/enum, lifecycle refinement, invariant rework,
  one new append helper. No destructive schema changes.
- **Credit-note rows are write-once after issuance** — created with `isLocked: true`
  (amount frozen) and not mutated again. Available credit and open/closed state are
  **derived** from the application rows, not stored mutations (decision #9 guardrail: lock
  the *amount*; the application set grows append-only). An optional cached
  `remainingAmount` is allowed *only* as a read-perf cache that must equal the derived
  value (see Scope).
- **Append-only.** Applications are never edited or deleted; a credit note's pool is
  drawn down by *appending* applications. Undo is a future offsetting append (decision
  #8), out of scope here.
- **No production path may emit a `SETTLEMENT` application or a partially-applied credit
  note in this unit.** The enum value and invariant allowances are forward-enabling only;
  exercise them with test fixtures.
- Existing current data must pass every reworked invariant unchanged (fully-applied
  credit notes: `Σ applications == total`, derived available `== 0`).

## Scope

### In Scope

- **`DocumentApplication.kind` discriminator** (Prisma enum or string+Zod constant,
  consistent across code/tests). Values cover today's shapes plus the forward one:
  - `DEPOSIT` — deposit → final.
  - `CAUSE_REVERSAL` — credit note → ADJUSTMENT **line** (receivable amended).
  - `CREDIT_TO_FINAL` — credit note → its parent FINAL (today's residual path).
  - `SETTLEMENT` — credit note → an open receivable **invoice** (new; **unused by
    production code in F1**).
- **Idempotent backfill** classifying existing `DocumentApplication` rows by current
  shape: line-targeted CN→ADJUSTMENT ⇒ `CAUSE_REVERSAL`; DEPOSIT source ⇒ `DEPOSIT`;
  CN→parent-FINAL ⇒ `CREDIT_TO_FINAL`. Fail loudly on any row that matches none.
- **Derived available-credit** — `computeCreditNoteAvailable(creditNoteId) =
  totalAmount − Σ(amountApplied)`, a read helper modeled on
  `computeEffectivePaidFromAllocations`. This is the **source of truth** for a credit
  note's unused balance and open/closed state; nothing is recomputed-and-stored on the
  row. (Today applications always equal the total ⇒ derived available `== 0` ⇒ **no
  observable change**.)
- **Credit-note row stays write-once** in `createCreditNoteWithClient`: keep
  `isLocked: true`, `paidAmount: 0`, and the existing `status`/`remainingAmount` values
  (`CLOSED / 0` while fully applied). Do **not** introduce post-issuance mutation of the
  row as a *truth* mechanism.
- **Optional `remainingAmount` cache** — if the register read path needs it, keep
  `remainingAmount` as a synchronized cache (pattern: `Order.selectedPhotoCount`) equal to
  the derived value, refreshed when an application is appended, and guarded by an
  invariant. If reads can derive on demand, skip the cache. **The derived value is the
  truth either way.**
- **Append helper** `appendCreditApplication({ creditNoteId, target..., amount, kind })`
  that validates the pool is not over-drawn (`Σ existing + amount ≤ totalAmount`, under a
  credit-note row lock) and writes the application with `kind`. It mutates **no** credit-
  note truth; it only refreshes the optional cache if one is kept. Sanctioned draw-down
  path for B1; F1 ships it with direct-fixture tests only.
- **Invariant rework** (see Implementation Direction for exact predicates):
  - Widen `adjustment-has-no-document-application` to allow `SETTLEMENT` (invoice-targeted
    CN→ADJUSTMENT) alongside the existing line-targeted `CAUSE_REVERSAL`.
  - Generalize `credit-note-has-document-application` to allow partial application and
    invoice-targeted settlement.
  - Generalize `classifier-reductions-have-matching-credit-note` from "has FINAL
    application" to "has ≥1 valid application (FINAL or settlement) + source activity".
  - Add `credit-note-pool-not-over-applied`: `Σ(applications from CN) ≤ CN.totalAmount`
    (the primary pool-integrity guard, since available is derived).
  - Add `credit-note-cache-matches-derived` **only if the `remainingAmount` cache is
    kept**: `CN.remainingAmount == totalAmount − Σ(applications)`. With no cache this is
    unnecessary (the derived value is true by construction).
- Regenerate `context/reviews/invariant-catalog.md` via `npm run docs:generate`.
- Focused tests under `tests/` for schema/backfill, lifecycle, append helper, and every
  changed/added invariant, including synthetic partial + settlement fixtures.

### Out of Scope

- No change to `routeCreditNoteCandidate` / OrderCommit financial emission (B1).
- No removing-side or adding-side settlement emission; no production `SETTLEMENT` rows.
- No `positiveDeltaPreview` / available-credit consumption (B2).
- No canonical settlement projection or Sales read-layer change (B3).
- No `computeCreditNoteCapacityForFinal` semantic change (flagged for B1; leave as-is).
- No offsetting/undo mechanics for the cancel-the-receivable case (later spec).
- No financial-documents register presentation changes (separate plan).
- No UI, copy, payment, or refund behavior change.
- No progress-tracker update during this docs-only drafting; implementation updates it
  after code lands.

## Implementation Direction

Implement as four small, independently reviewable tasks.

### Task 1 — `kind` discriminator + backfill

Add `kind` to `DocumentApplication` (default for safe creation, but every production
write must set it explicitly). Prefer a Prisma enum
(`DEPOSIT | CAUSE_REVERSAL | CREDIT_TO_FINAL | SETTLEMENT`); if enum rollback is awkward
in PostgreSQL, use a string column + Zod constant and document the choice. Index if a
query path needs it (none required in F1).

Backfill existing rows by shape, idempotently and transactionally:
- `targetInvoiceLineId` set + source `CREDIT_NOTE` + target `ADJUSTMENT` → `CAUSE_REVERSAL`.
- source `DEPOSIT` → `DEPOSIT`.
- source `CREDIT_NOTE` + target == its `parentInvoiceId` (FINAL) → `CREDIT_TO_FINAL`.
- Any unclassifiable row: **fail loudly** with the application id; do not guess.

Point every production write of `DocumentApplication` (deposit application,
`createCreditNoteWithClient`) at the correct `kind`.

### Task 2 — Derived available-credit + append helper

Add `computeCreditNoteAvailable(creditNoteId, client) = totalAmount − Σ(amountApplied)`,
modeled on `computeEffectivePaidFromAllocations`. This is the truth for a credit note's
unused balance and open/closed state. Keep `createCreditNoteWithClient` writing the row
**once** (`isLocked: true`, `paidAmount: 0`, existing `status`/`remainingAmount`); add no
post-issuance truth mutation. Because current emission always fully applies, derived
available is `0` for existing paths — a behavior no-op; assert it in tests.

Add `appendCreditApplication(...)`: reject if `Σ(existing) + amount > totalAmount` (under
a credit-note row lock consistent with nearby settlement code) and write the application
with `kind`. If the optional `remainingAmount` cache is kept, refresh it here; otherwise
write nothing on the credit note. Sanctioned draw-down path for B1; F1 ships it with
direct-fixture tests only.

### Task 3 — Invariant rework

Edit `src/modules/financial/invariants.ts`:

- **`adjustment-has-no-document-application`**: keep the existing line-targeted
  `CAUSE_REVERSAL` exception; **add** an exception for `kind === SETTLEMENT` with
  `source = CREDIT_NOTE`, `target = ADJUSTMENT`, `targetInvoiceLineId = NULL`.
- **`credit-note-has-document-application`**: replace the "exactly 1 to parent OR all
  line-targeted" rule with: every source application targets a valid invoice/line in the
  same case, **and** `sum(amountApplied) ≤ totalAmount` (an unapplied remainder is
  legal). A credit note with zero applications is still a violation.
- **`classifier-reductions-have-matching-credit-note`**: replace `hasFinalApplication`
  with `has ≥1 source application whose target is the parent FINAL **or** an ADJUSTMENT
  via `SETTLEMENT`/`CAUSE_REVERSAL``, retaining the source-activity requirement.
- **Add `credit-note-pool-not-over-applied`** (global): for each `CREDIT_NOTE`,
  `sum(applications) ≤ totalAmount`.
- **Add `credit-note-cache-matches-derived`** (global, **only if a `remainingAmount`
  cache is kept**): `remainingAmount == totalAmount − Σ(applications)`. Omit if reads
  derive on demand.

Register the new invariant(s) in the catalog; run `npm run docs:generate`.

### Task 4 — Tests + regression guards

Under `tests/` (match the existing financial-invariant layout):
- Schema/backfill: `kind` present; backfill assigns correct kinds; second run is a no-op;
  an unclassifiable synthetic row fails loudly.
- Lifecycle no-op: a normally-emitted (fully applied) credit note derives available `0`,
  row unchanged after issuance (`isLocked true`).
- Drawable: a synthetic credit note with applications summing `< total` derives available
  `> 0`; `appendCreditApplication` reduces derived available and reaches `0` when fully
  drawn; over-draw is rejected by both the helper and `credit-note-pool-not-over-applied`.
  If the cache is kept, `credit-note-cache-matches-derived` holds after each append.
- Invariants: an invoice-targeted `SETTLEMENT` CN→ADJUSTMENT **passes**
  `adjustment-has-no-document-application`; a non-settlement/non-reversal CN→ADJUSTMENT
  still **fails**. A partially-applied credit note passes
  `credit-note-has-document-application`. `credit-note-pool-not-over-applied` catches
  over-draw (and `credit-note-cache-matches-derived` catches cache drift if a cache exists).
- Math guard: `computeEffectivePaidFromAllocations` results are unchanged across the
  migration for representative cases.
- Static/source guards: no `SETTLEMENT` row is created by `src/modules/**` production
  code in F1; no change under `order-commits/**` emission, preview, or projection; no
  `app/**` or `src/components/**` DB imports added.

## Observability Checklist

### Dashboards / Metrics

- No production dashboard required.
- Backfill prints structured counts (scanned, classified per kind, failed) and fails the
  run on any unclassifiable row rather than committing a partial backfill.

### Rollback Plan

- Schema rollback drops `DocumentApplication.kind` (and the enum if used; if enum
  rollback is awkward, document and prefer string+constant).
- Remove `computeCreditNoteAvailable`, `appendCreditApplication`, and the optional cache;
  revert the invariant edits/additions; regenerate the catalog. `createCreditNoteWithClient`
  is essentially unchanged (it already writes the row once).
- No production data depends on partial pools or `SETTLEMENT` rows yet, so rollback is
  clean: backfilled `kind` values are derivable again from shape.

### Customer-Visible Surface

- None. No staff- or customer-facing change.

## Post-Implementation

- Update `context/progress-tracker.md` Key State (Financial architecture) and Feature
  History after code lands: `DocumentApplication.kind`, derived drawable credit-note
  model, the new pool-integrity invariant.
- Update `context/target-data-model.md` to document the `kind` discriminator and the
  drawable credit-note model (row write-once; available balance derived from applications;
  optional synchronized `remainingAmount` cache).
- Regenerate `context/reviews/invariant-catalog.md`.
- Update `context/reviews/credit-settlement-application-plan.md` to mark F1 implemented
  and note B1 may now emit `SETTLEMENT` via `appendCreditApplication`.

## Acceptance Criteria

- `DocumentApplication.kind` exists with the four values; every production write sets it
  explicitly; existing rows are backfilled idempotently and a second run creates no
  changes.
- Credit-note rows are write-once after issuance; a credit note's unused balance and
  open/closed state are **derived** (`totalAmount − Σ applications`) via
  `computeCreditNoteAvailable`, not stored truth. Fully-applied credit notes derive
  available `0` (no observable change). Any `remainingAmount` use is an optional
  synchronized cache equal to the derived value.
- `appendCreditApplication` appends a draw-down (append-only), rejects over-draw, and
  mutates no credit-note truth (refreshes the optional cache only).
- `adjustment-has-no-document-application` permits invoice-targeted `SETTLEMENT`
  CN→ADJUSTMENT and still rejects other ADJUSTMENT-touching applications.
- `credit-note-has-document-application` permits partial application + settlement;
  `classifier-reductions-have-matching-credit-note` accepts settlement-targeted classifier
  credits; `credit-note-pool-not-over-applied` and
  `credit-note-remaining-matches-applications` are registered and catch drift.
- `computeEffectivePaidFromAllocations` and all financial math are unchanged.
- No OrderCommit emission, preview, projection, payment, refund, or UI behavior changes;
  no production `SETTLEMENT` row or partial credit note is created in this unit.
- The full financial invariant + regression suite passes; `invariant-catalog.md` is
  regenerated.
- If this spec adds or changes a financial / composition / workflow / status display
  surface: it consumes the canonical read model + a projector instead of re-deriving in
  pages or components; money read from raw projector fields, formatted via
  `src/lib/formatting/money.ts`; no `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
