## Goal

Eliminate phantom "package metadata changed 0.000 KD" staged rows and net-zero commits produced when a package is swapped away and back to its original (manual bug B2). The package reducer's `CHANGE_PACKAGE` writes metadata keys the baseline snapshot capture never sets (`currentPackageId`, `currentPackageNameSnapshot`, `finalPackagePriceSnapshot`), so even after `catalogEntityId`, label, price, and photo counts are restored to the original package, the diff's full-metadata comparison flags a `METADATA_CHANGED` line with zero money delta. This surfaces a meaningless staged change and lets the user commit a no-op. This spec makes a restored-to-original package line classify as `UNCHANGED`.

## Read First

- `/tmp/phase-5.5-bug-investigation.md` (or the in-chat write-up) — B2 trace, root-cause group G2.
- `src/modules/order-commits/order-commit-package-reducer.ts:165-206` — `updatePackageLine`: injects `currentPackageId`, `currentPackageNameSnapshot`, `finalPackagePriceSnapshot` into `metadata` (the keys absent from baseline capture).
- `src/modules/order-commits/order-commit.service.ts:2059-2093` — `packageLine` baseline capture: the metadata keys actually present at capture (no `currentPackageId` / `currentPackageNameSnapshot` / `finalPackagePriceSnapshot`).
- `src/modules/order-commits/order-commit-preview-diff.service.ts:142-207` — `lineChangeKind` → `lineMetadataEquivalent` → `comparableLineMetadata`: compares the full `metadata` blob via `stableJson`, so reducer-only keys force `METADATA_CHANGED`.
- `src/modules/order-commits/projections/to-sales-page-staged-changes.ts:22-46` — where a non-`UNCHANGED` diff becomes a visible staged row.
- `tests/order-commits/order-commit-preview-diff*.test.ts` and `tests/order-commits/order-commit-package-reducer*.test.ts` — existing coverage to extend.

## Rules

- Diff/reducer correction only. No Prisma schema, capture-shape, materializer, financial-emission, or staging-flow change.
- A package line restored to its original catalog id, label, price, and photo counts must classify as `UNCHANGED` — no staged row, no contribution to the preview, no net-zero commit artifact.
- Genuine package changes (tier change, photo-count change, real metadata that affects materialization or financial truth) must still be detected exactly as today. Do not weaken detection of meaningful changes.
- Prefer the fix that makes baseline and pending metadata reconcile cleanly. Two acceptable shapes (implementer's choice, gated by tests):
  - **(a)** Stop the package reducer introducing baseline-absent keys — derive `currentPackageId`/`currentPackageNameSnapshot`/`finalPackagePriceSnapshot` from the canonical fields (`catalogEntityId`, `label`, `unitPrice`) at read time instead of duplicating them into `metadata`; **or**
  - **(b)** Make `comparableLineMetadata` compare a canonical, capture-aligned subset of package metadata so reducer-only mirror keys are excluded from equivalence.
- Keep capture as the source of truth for the baseline metadata shape; do not "fix" by making capture write the reducer's extra keys unless that is provably the cleaner reconciliation and is covered by tests.
- No `@/lib/db` imports in `app/**` or `src/components/**`.

## Scope

### In Scope

- Reconcile package-line metadata between baseline capture and the package reducer so a restore-to-original yields `UNCHANGED` (approach (a) or (b) above).
- If (b): define the canonical comparable package-metadata key set explicitly (the keys capture actually writes that matter to diffing — e.g. `originalPackageId`, photo-count fields, `sessionTypeId`/`sessionTypeName`, `sortOrder`) and exclude reducer-only mirror keys; ensure non-package line kinds are unaffected.
- Tests:
  - Basic→Standard→Basic with photo counts restored ⇒ the package line diff is `UNCHANGED`, no staged row, preview shows no change, and a commit is rejected/blocked as a true no-op (consistent with existing empty-diff handling).
  - A genuine tier change (Basic→Standard, not restored) still yields `PACKAGE_CHANGED` with the correct money delta and a staged row.
  - A photo-count-only change still yields the correct change kind and flags.
  - Non-package line kinds' diff classification is unchanged (regression guard on `comparableLineMetadata`).
- Wire new tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md`.

### Out of Scope

- Composition rendering (Specs 139/141), re-upgrade semantics (Spec 140), linked products (Spec 143).
- Any change to how genuine package changes are priced, materialized, or emitted.
- Snapshot schema / capture field additions (unless approach (a) removes a field from `metadata`, which is a reducer-output change, not a schema change).

## Implementation Direction

Diagnose against the two metadata shapes side by side: `packageLine` capture (`order-commit.service.ts`) vs `updatePackageLine` reducer output (`order-commit-package-reducer.ts`). The cleanest fix is usually (a) — the reducer already updates the canonical `catalogEntityId`, `label`, and `unitPrice`; the mirrored `currentPackageId`/`currentPackageNameSnapshot`/`finalPackagePriceSnapshot` metadata are redundant and the materializer reads canonical fields. If any downstream consumer truly needs those mirror keys, prefer (b): narrow `comparableLineMetadata` for `PACKAGE` lines to the capture-aligned subset. Lock the behavior with the restore-to-original `UNCHANGED` test plus the genuine-change regression tests so detection of real changes cannot silently weaken.

## Observability Checklist

### Dashboards / Metrics

- None added.

### Rollback Plan

- No schema/migration. Rollback = revert the reducer/diff change. Drafts staged during the window remain valid; the only behavioral difference is whether a restored-to-original package shows a phantom row.

### Customer-Visible Surface

- Swapping a package away and back to the original (with state restored) shows no staged change and cannot produce a net-zero commit. Genuine changes are unaffected.

## Post-Implementation

- `context/progress-tracker.md` — "Now" line: a package line restored to its original now classifies as `UNCHANGED`; reducer-only metadata no longer produces phantom net-zero staged rows.
- Roadmap Phase 5.5 — mark B2 resolved.

## Acceptance Criteria

- Basic→Standard→Basic (state restored) yields an `UNCHANGED` package diff, no staged row, no preview change, and a true no-op commit (no net-zero commit artifact).
- Genuine tier changes and photo-count changes are detected exactly as before, with correct deltas and flags.
- Non-package line diff classification is unchanged.
- No schema, capture-field, materializer, financial-emission, or staging-flow change.
- New tests wired into `test:centralization`.
- `npm run test:centralization` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Open Questions

- Approach (a) (reducer stops mirroring keys) vs (b) (diff compares a capture-aligned subset). Implementer chooses based on whether any consumer depends on the mirror keys; both are gated by the same acceptance tests.
