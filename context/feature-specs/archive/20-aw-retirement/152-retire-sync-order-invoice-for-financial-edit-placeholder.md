## Goal (Placeholder — do not implement yet)

Retire the legacy direct-edit financial emission engine `syncOrderInvoiceForFinancialEdit` (`src/modules/invoices/invoice.service.ts:361`) so that `commitOrderChanges` is the **single** path that emits ADJUSTMENT / CREDIT_NOTE / refund-needed documents. This is the cleanup that finishes what [Spec 151](151-migrate-financial-test-scaffolding-off-direct-mutators.md) starts.

**Status: placeholder.** Draft the full spec only after Spec 151 has landed and the OrderCommit path has been trusted in practice. This file exists so the follow-up is not lost; it is intentionally light on prescription because the exact surface depends on what Spec 151 actually leaves behind.

## Why it's deferred

After Spec 151 deletes the five direct mutators, `syncOrderInvoiceForFinancialEdit` still has **direct (non-mutator) callers** — at minimum:

- `tests/financial-phase-c/edge-cases.ts`
- `tests/financial-phase-d/regression.ts`
- `tests/financial/adjustment-reversal.test.ts` (if any direct calls remain post-151)
- `tests/backend-invariants/invoice-math.invariant.ts`
- `tests/fixtures/financial.ts`
- `tests/session-configurations/session-configuration-pricing-integration.test.ts`

These call the legacy engine directly to set up or assert financial state. Retiring the engine means migrating each onto `commitOrderChanges` (or a shared helper) and proving equivalence — a second, separable financial-test blast radius. Splitting it from Spec 151 keeps each PR's risk bounded.

## Likely scope (to be confirmed when drafted)

- Re-inventory all callers of `syncOrderInvoiceForFinancialEdit` after Spec 151 (the set above is pre-151; confirm it).
- Decide per caller: migrate to the OrderCommit path (preferred) or to a shared financial-setup helper that itself uses `commitOrderChanges`.
- Prove committed-outcome equivalence for any scenario the direct callers assert that Spec 151's parity harness did not already cover.
- Delete `syncOrderInvoiceForFinancialEdit` and any now-orphaned helpers in `invoice.service.ts` reachable only through it (carry over the "orphan candidates" note Spec 151 leaves behind).
- Confirm no production caller exists (there should be none after Spec 150 + Spec 151) before deletion.
- Update `context/progress-tracker.md`: `commitOrderChanges` is the sole financial-emission engine; the legacy direct-edit sync path is retired.

## Out of scope

- Any financial-behavior change. This is engine consolidation, not a behavior change.
- Schema changes.
- Re-introducing any direct-mutator path.

## Open Questions (resolve at drafting time)

- Does any direct caller rely on behavior `commitOrderChanges` does not reproduce (e.g. emission without a staged draft, or a setup shortcut)? If so, that gap must be closed first or the caller redesigned.
- Should the shared financial-setup helper from Spec 151 be extended to cover these direct callers, or do they need bespoke migration?
