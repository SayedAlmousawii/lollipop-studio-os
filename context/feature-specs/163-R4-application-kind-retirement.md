# 163 · R4 — Application-Kind Retirement (`DocumentApplicationKind → { DEPOSIT, SETTLEMENT }`)

> Plan label **R4** (reversal-credit model phase); repo number **163** is provisional.
> Final spec of the phase in
> `context/reviews/reversal-credit-and-refund-model-decision.md` (model **C′ + Option 1**, §3).
> **Behavior-preserving** (money math unchanged). Depends on **R0–R3** merged.
> Closes the phase: the application no longer encodes *why* a credit exists — that lives on the
> credit note's `creditOrigin` (R0) — so the only remaining kinds are *where value went*.

## Goal

Collapse `DocumentApplicationKind` to **`{ DEPOSIT, SETTLEMENT }`** by retiring `CAUSE_REVERSAL`
and `CREDIT_TO_FINAL`. After R3, `CAUSE_REVERSAL` is no longer emitted (dead), and `CREDIT_TO_FINAL`
is only a *label* on the manual FINAL-credit application — the money math is identical whether that
row is `CREDIT_TO_FINAL` or `SETTLEMENT`, because `computeEffectivePaidFromAllocations` sums **all**
applications regardless of kind and the R1 runtime invariants are already kind-agnostic. So this is
a taxonomy cleanup, not a behavior change.

## Why this is behavior-preserving (verified)

- `computeEffectivePaidFromAllocations` (invoice.calculation.ts l.38–55) sums `amountApplied` for
  every `DocumentApplication` targeting an invoice — **no kind filter**. Relabeling
  `CREDIT_TO_FINAL → SETTLEMENT` leaves the target FINAL's effective-paid (and therefore its
  status/remaining and any overpayment) byte-identical.
- `computeCreditNoteAvailable` sums source applications regardless of kind — unchanged.
- R1's `valid-credit-origin` / `credit-applications-conserve` / `classifier-reductions-have-origin`
  assert origin + conservation, **not** kind — they already pass on `SETTLEMENT`.
- INV-09 (post-R2) already permits invoice-level `SETTLEMENT` onto FINAL.

## Read First

- `context/reviews/reversal-credit-and-refund-model-decision.md` §3 (taxonomy collapse), §7 (R4 row;
  locked decision #1: reset & regenerate — no historical row migration).
- `prisma/schema.prisma` — `enum DocumentApplicationKind { DEPOSIT, CAUSE_REVERSAL, CREDIT_TO_FINAL,
  SETTLEMENT }` (l.107).
- `src/modules/invoices/invoice.service.ts`:
  - `createCreditNoteWithClient` — the **dead** line-targeted `CAUSE_REVERSAL` `createMany`
    (l.3205–3217) and its guards (l.~2988–3047), plus the `AUTO_APPLY` `CREDIT_TO_FINAL` `create`
    (l.3218–3230) that R4 relabels to `SETTLEMENT`.
  - `appendCreditApplicationWithClient` — the kind validations (l.2755–2772): `CAUSE_REVERSAL` and
    `CREDIT_TO_FINAL` branches to delete; the `SETTLEMENT`-must-be-ADJUSTMENT branch (l.2761–2766)
    to **loosen** so `SETTLEMENT` onto a FINAL is valid.
- `src/modules/financial/invariants.ts` + `reconciliation-invariants.ts` + `invariant-catalog.ts` —
  any rule naming the retired kinds; INV-09's "line-targeted ADJUSTMENT" clause becomes dead.
- All `grep`-able references to `CAUSE_REVERSAL` / `CREDIT_TO_FINAL` (currently only
  invoice.service.ts l.2756/2768/3211/3223 in non-test code).

## Rules

- **Behavior-preserving.** No change to effective-paid, drawable, sweep, refund, or any derived
  status. The only on-the-wire change is the kind *label* on the manual FINAL-credit application
  (`CREDIT_TO_FINAL → SETTLEMENT`).
- **Verify before deleting.** Confirm no caller passes line-targeted credit applications post-R3
  (the three `createCreditNote` callers — manual UI, `applyAdjustmentReversalsWithClient`, OrderCommit
  reversal emission — all emit drawable/FINAL-credit, none line-targeted). Only then remove the
  `CAUSE_REVERSAL` machinery.
- **Reset & regenerate, not row migration** (locked decision #1). The enum is recreated; dev data
  regenerates with `SETTLEMENT`. No in-place rewrite of historical `CAUSE_REVERSAL`/`CREDIT_TO_FINAL`
  rows.

## Scope

### In Scope

- **Relabel the manual FINAL credit** in `createCreditNoteWithClient`: the `AUTO_APPLY` branch emits
  `kind: SETTLEMENT` (onto the FINAL) instead of `CREDIT_TO_FINAL`. Origin stays `GOODWILL`/`REMOVAL`
  per R0.
- **Loosen the `SETTLEMENT` validation** in `appendCreditApplicationWithClient` to allow a FINAL
  target (currently ADJUSTMENT-only). Delete the `CAUSE_REVERSAL` and `CREDIT_TO_FINAL` validation
  branches.
- **Remove the dead `CAUSE_REVERSAL` line-targeted machinery** in `createCreditNoteWithClient` (the
  `createMany` branch and the line-target validation guards), after confirming no caller exercises it.
- **Recreate the Prisma enum** as `DocumentApplicationKind { DEPOSIT, SETTLEMENT }`; additive-style
  migration that drops + recreates the enum (no row data depends on the retired values after reset).
- **Tidy invariants/catalog:** remove the now-dead "line-targeted ADJUSTMENT / `CAUSE_REVERSAL` /
  `CREDIT_TO_FINAL`" clauses from INV-09 and any runtime/reconciliation rule; regenerate the catalog.
- **Remove all remaining code references** to the two retired kinds.

### Out of Scope

- Any behavior/money-math change — strictly a no-op on derived financial truth.
- The staff refund **trigger** + paid-origin cash-eligibility cap (separate follow-up; no follow-up
  spec is required for R4).
- Read-layer / receipt / register changes.

## Implementation Direction

1. Relabel the `AUTO_APPLY` FINAL-credit emission to `SETTLEMENT`; loosen the `appendCreditApplication`
   `SETTLEMENT` validation to permit FINAL; delete the `CAUSE_REVERSAL`/`CREDIT_TO_FINAL` validation
   branches.
2. Preserve invoice-level-only application shape for the remaining `SETTLEMENT` kind: FINAL and
   ADJUSTMENT targets are allowed, `targetInvoiceLineId` must be null, and line-targeted
   applications remain rejected.
3. Confirm (grep + caller audit) the line-targeted path is dead, then delete the `CAUSE_REVERSAL`
   `createMany` branch and its guards.
4. Recreate the enum in `schema.prisma`; generate the migration; regenerate the Prisma client.
5. Remove dead clauses from INV-09 + any rule referencing the retired kinds; regenerate the catalog.
6. `grep` active runtime/source files and tests for `CAUSE_REVERSAL` / `CREDIT_TO_FINAL` → zero
   references remain, excluding historical migrations and documentation.

## Observability Checklist

### Rollback Plan
- Code-only + enum migration revert (restore the four-value enum, the `CREDIT_TO_FINAL` label, and
  the deleted branches). No row data depends on the change after reset.

### Customer-Visible Surface
- None.

## Post-Implementation
- Update the decision doc §7: **phase complete** — `DocumentApplicationKind = { DEPOSIT, SETTLEMENT }`;
  provenance lives on `creditOrigin`; reversal-stranding closed end-to-end.
- Update `context/progress-tracker.md`: taxonomy collapsed; R0–R4 done; only the refund-trigger
  follow-up remains for the phase's surrounding work if/when that capability is specified.

## Acceptance Criteria

- `DocumentApplicationKind` is `{ DEPOSIT, SETTLEMENT }`; migration applies (and reverses) cleanly on
  regenerated data.
- The manual FINAL credit emits a `SETTLEMENT` application; the target FINAL's effective-paid, status,
  remaining, and overpayment capacity are **identical** to pre-R4 (behavior-preservation test).
- No active runtime/source path or test emits or references `CAUSE_REVERSAL` or `CREDIT_TO_FINAL`;
  historical migrations and documentation may retain archived references.
- `appendCreditApplication` accepts `SETTLEMENT` onto FINAL or ADJUSTMENT (invoice-level) and rejects
  line-targeted settlements as before.
- R1 credit invariants, INV-09, and the full financial + OrderCommit + reconciliation suite are green;
  catalog regenerated and `test:centralization` passes.
- `npm run build` and `npm run lint` pass.
