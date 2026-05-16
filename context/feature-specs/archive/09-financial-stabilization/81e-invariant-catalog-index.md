## Goal

Today's invariants are scattered across `tests/financial-phase-{c,d,f}/invariants.ts` and `src/modules/financial/invariants.ts`. Answering "what invariants do we have?" requires grepping multiple folders. Add a single owner-facing catalog that imports every invariant and exposes them as a unified registry — used by the nightly runner, by CLI commands, and by an auto-generated docs page.

Closes roadmap item **A3**.

---

## Read First

- `context/reviews/77-post-verification-hardening-roadmap.md` — §5 A3
- `src/modules/financial/invariants.ts` — runtime invariants (78a's `final-invoice-fully-paid-must-be-locked`, 79a's `paid-adjustment-line-removal-must-have-reversal`, 80b's `locked-invoice-frozen-fields-match-snapshot`)
- `tests/financial-phase-c/invariants.ts`, `tests/financial-phase-d/invariants.ts`, `tests/financial-phase-f/invariants.ts` — CI invariants (ALLOC-01, REG-LEGACY-01, INV-14, INV-18, etc.)
- The nightly reconciliation runner — current iteration over invariants

---

## Rules

- One catalog module: `src/modules/financial/invariant-catalog.ts`. It imports every registered invariant from its home folder and exports them as a flat readonly array.
- Each catalog entry includes: `id`, `name`, `phase` (introduced-in tag), `scope` (`'global' | 'order' | 'invoice'`), `description`, `run` function. The shape matches the registration shape used today.
- Existing registration locations remain — invariants are still defined in `src/modules/financial/invariants.ts` and the phase folders. The catalog just *imports* them. No relocation of invariant logic.
- The nightly reconciliation runner iterates the catalog. No more folder-by-folder invocation.
- Auto-generate `context/reviews/invariant-catalog.md` from the catalog as part of `npm run docs:generate` (or a similar new script). The doc lists every invariant with id, scope, phase, and description.

---

## Scope

### In Scope

**Catalog module**

```ts
// src/modules/financial/invariant-catalog.ts
import * as runtimeInvariants from './invariants';
import * as phaseCInvariants from '@/../tests/financial-phase-c/invariants';
import * as phaseDInvariants from '@/../tests/financial-phase-d/invariants';
import * as phaseFInvariants from '@/../tests/financial-phase-f/invariants';

export type CatalogedInvariant = {
  id: string;
  name: string;
  phase: string;
  scope: 'global' | 'order' | 'invoice';
  description: string;
  run: (...args: unknown[]) => Promise<InvariantResult>;
};

export const INVARIANT_CATALOG: readonly CatalogedInvariant[] = [
  // imported from the modules above, flattened
];
```

The exact import shape depends on how each existing module exports its invariants — adapt as needed. The contract: one array, every invariant present.

**Phase tag**

Each cataloged entry gets a `phase` tag: `Phase C`, `Phase D`, `Phase F`, `Sprint 1 (78a)`, `Sprint 2 (79a)`, `Sprint 3 (80b)`, etc. Source: where the invariant was added.

**Reconciliation runner update**

The runner replaces its current per-folder iteration with:

```ts
for (const invariant of INVARIANT_CATALOG) {
  const result = await invariant.run(/* … */);
  // existing reporting
}
```

**CLI commands** (optional convenience, not required for closure):

- `npm run invariants:list` — dumps the catalog as a table.
- `npm run invariants:run -- --id=INV-18` — runs a single invariant.

If implementing these adds non-trivial scope, skip and note as a follow-up.

**Generated docs**

Add a script (`scripts/generate-invariant-catalog-md.ts`) that reads `INVARIANT_CATALOG` and writes `context/reviews/invariant-catalog.md`. Run it in CI on PRs that touch invariant files (or as part of `npm run docs:generate`).

The doc format:

```md
# Invariant Catalog

| ID | Name | Phase | Scope | Description |
|----|------|-------|-------|-------------|
| INV-18 | order-composition-equals-revenue-documents | Phase F | global | … |
| INV-LOCK-SNAPSHOT | locked-invoice-frozen-fields-match-snapshot | Sprint 3 (80b) | global | … |
| … |
```

**Tests**

`tests/financial/invariant-catalog.test.ts`:

- Test A: every entry in `INVARIANT_CATALOG` has a unique `id`.
- Test B: every entry's `run` function is a callable function.
- Test C: the catalog is non-empty (sanity).
- Test D: running the catalog against a clean dev DB reports zero violations (excluding F6's known dev row, which is handled by 81f).

### Out of Scope

- Relocating invariant definitions out of their phase folders — those folders stay; the catalog imports from them.
- A web UI for the catalog — `context/reviews/invariant-catalog.md` is sufficient.
- New invariants — this spec is purely organizational.
- O6 first-class AuditLog UI — separate deferred view.

---

## Implementation Direction

**Risk:** Low. Mostly import wiring. The only real risk: if invariant modules currently *export* their invariants in inconsistent shapes (some as arrays, some as named exports, some via a `register` side-effect), the catalog needs an adapter pass. Read each module first and normalize.

**Order of work:**

1. Read every existing invariant-defining file. Map their export shapes.
2. Decide: either each module exports a uniform `INVARIANTS` array now (preferred — small refactor), or the catalog has per-module adapters.
3. Build `invariant-catalog.ts` and `INVARIANT_CATALOG`.
4. Rewire the reconciliation runner to iterate the catalog.
5. Add `generate-invariant-catalog-md.ts`. Generate the first version of `invariant-catalog.md`.
6. Add Tests A–D.
7. (Optional) CLI scripts.

**Rollback:** revert the PR. Catalog is gone, runner reverts to per-folder iteration. No data risk.

---

## Verification

- All four tests pass.
- All existing tests pass.
- `npm run build` passes.
- `npm run lint` passes.
- `context/reviews/invariant-catalog.md` exists and lists every invariant from every source folder.
- Nightly reconciliation run (dev) iterates the catalog and reports the same results as the pre-spec implementation (modulo F6's known divergence).

---

## Post-Implementation

- Update `context/reviews/77-post-verification-hardening-roadmap.md`: mark A3 as completed.
- Update `progress-tracker.md`.
