## Goal

Restore visibility of **included** package deliverables in the snapshot-derived Sales composition so they appear during an active draft and on locked FINAL orders. Today the snapshot projection (`toSalesPageComposition`) builds package `packageItems` only from `PACKAGE_ITEM_UPGRADE` lines, so included deliverables vanish whenever a draft is active (manual bug B1: swap Basic→Standard→Basic never restores the album until discard) and never render on locked FINAL (manual bug A6: the Upgrade/Replace cards have no deliverable to attach to). OrderCommit snapshots and locked-invoice snapshots do not carry included deliverables as lines — only paid upgrades — so the projection currently has nothing to show.

This spec implements **Option A** (user-approved): the projector re-derives included deliverables from the **package catalog** against the snapshot's current package id and overlays `PACKAGE_ITEM_UPGRADE` lines, mirroring the live-path overlay. It does **not** add deliverables to the snapshot schema. The known, accepted trade-off: deliverable display is **catalog-current, not commit-historical** (a later catalog edit changes how a past order's included deliverables render). Revisiting a commit-historical model (Option B: embed deliverables as snapshot lines) is deferred to Phase 7+ and only if commit-time deliverable fidelity becomes a hard requirement.

## Read First

- `/tmp/phase-5.5-bug-investigation.md` (or the in-chat write-up) — B1/A6 traces, the "deliverables aren't lines" invariant, and the Option A vs B comparison with the approved decision.
- `context/reviews/unified-order-commit-live-pos-roadmap.md` — Phase 5 projector rules.
- `src/modules/order-commits/projections/to-sales-page-composition.ts:24-148,162-163` — the snapshot projection; `packageItems` built only from `PACKAGE_ITEM_UPGRADE` lines, with the explicit "snapshots do not carry included deliverables" comment.
- `src/modules/orders/composition/projections/to-draft-pos-composition.ts:197-242` — `projectPackageItems`: the existing catalog-derived deliverables + upgrade overlay to mirror.
- `src/modules/orders/order.service.ts:3754` — `mapPOSPackageItems(currentPackage.items)`: how the live path reads catalog deliverables (the data source to reuse, keyed by current package id).
- `src/modules/order-commits/projections/sales-page-view.loader.ts:101-113,229-251` — `getSalesPageView` / `loadCurrentComposition`: how `currentComposition` (catalog deliverables) is already loaded, and the locked-FINAL branch (`getLockedOrderCompositionViewModel`).
- `src/modules/orders/composition/order-composition.service.ts:64-90,213-252` — locked composition model build; confirms the locked snapshot lacks `packageItem` deliverable lines.
- `src/components/orders/pos-package-composition.tsx:232-248` — `line.packageItems.map(...)` renders `DeliverableCard`; empty ⇒ no Upgrade/Replace buttons (A6).
- `src/modules/order-commits/projections/to-sales-page-composition.ts` input `ToSalesPageCompositionInput` — already receives `currentComposition` (carries catalog deliverables); the source this spec overlays onto the snapshot.

## Rules

- Read/projection layer only. No Prisma schema, snapshot capture, reducer, materializer, financial-emission, preview, or staging change.
- **Option A:** included deliverables are re-derived from the package catalog for the snapshot's current package id and overlaid with `PACKAGE_ITEM_UPGRADE` snapshot lines. Do **not** add deliverable lines to the snapshot, capture, or diff.
- **Financial parity:** included deliverables are non-priced display rows (their cost is inside the package base). Restoring them must not change any total, the diff, the staged-changes rail, or the financial preview. Net stays identical.
- Deliverable display follows the snapshot's **current** package id, so swap Basic→Standard→Basic shows Basic's catalog deliverables again without discarding the draft.
- Locked FINAL renders included deliverables (and therefore the Upgrade/Replace cards) using the same overlay sourced from the catalog id resolvable for the locked composition.
- Keep the catalog-current limitation explicit in code comments and the tracker; do not silently imply historical accuracy.
- No `@/lib/db` imports in `app/**` or `src/components/**`; the projector receives already-loaded inputs.

## Scope

### In Scope

- Extend `toSalesPageComposition` so each projected package line's `packageItems` is the catalog-derived included deliverable set for that line's current package id, with `PACKAGE_ITEM_UPGRADE` snapshot lines overlaid by `packageItemId` (mirror `projectPackageItems`). Source the catalog deliverables from the `currentComposition` input already passed in (or an added read dependency that returns catalog items by package id), not from a new DB call in the projector.
- Ensure the overlay is consistent with Spec 139's live-path overlay so draft and post-commit render identically (convergence).
- Locked FINAL: ensure the locked branch supplies the current package id and catalog deliverables so the same overlay runs and `DeliverableCard`s (with Upgrade/Replace) render. Reuse `loadCurrentComposition`'s locked path; do not introduce an AW path.
- Tests under `tests/order-commits/sales-page-surface/` and/or `tests/orders/composition/`:
  - With an active draft, included deliverables render on each package line (not only upgrades).
  - Swap Basic→Standard→Basic with photo count restored shows Basic's album again **without** discarding the draft, and produces no extra financial total/diff change.
  - Locked FINAL renders included deliverables and the Upgrade/Replace cards are present and interactive (policy already allows; this spec supplies the deliverable to attach to).
  - Restoring deliverables changes no total, no `lineDiff`, no staged-changes row, and no financial-preview figure (parity).
  - Draft and post-commit deliverable shapes match for an equivalent order (convergence with Spec 139).
- Wire new tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md`.

### Out of Scope

- Embedding deliverables as snapshot lines or metadata (Option B) — deferred to Phase 7+.
- Any capture, diff, materializer, schema, or financial change.
- Upgrade-as-add-on rendering and add-on quantity (Spec 139); re-upgrade semantics (Spec 140).
- B2 phantom metadata diff (Spec 142), D1/D2 linked products (Spec 143).
- The B3 modal-default reset (Phase 7).

## Implementation Direction

`toSalesPageComposition` already receives `currentComposition`, which carries catalog-derived deliverables per package. For each `PACKAGE` snapshot line, take the catalog deliverables for that line's current package id (matching `catalogEntityId`), then overlay the line's `PACKAGE_ITEM_UPGRADE` children by `packageItemId` exactly as `projectPackageItems` does — producing the same `packageItems` shape the component already consumes. Keep these rows non-priced so totals are untouched. For locked FINAL, verify `loadCurrentComposition`'s locked branch yields the package's current catalog id and deliverables; if it does not, thread the catalog lookup through the existing read dependencies rather than calling the DB from the projector. Add a code comment marking the catalog-current (non-historical) trade-off.

## Observability Checklist

### Dashboards / Metrics

- None added.

### Rollback Plan

- No schema/migration. Rollback = revert the projector change; deliverables disappear during drafts again but no data is affected.

### Customer-Visible Surface

- Staff see included package deliverables on the package line during a draft and on locked FINAL; package swaps show the new package's deliverables and swap-back restores the original without discarding; Upgrade/Replace is available on locked FINAL. No figures change.

## Post-Implementation

- `context/progress-tracker.md` — "Now" line: snapshot-derived composition now re-derives included deliverables from the catalog (Option A) and overlays upgrades, so deliverables show during drafts and on locked FINAL; financial totals unchanged. Key State note: deliverable display is catalog-current, not commit-historical (Option B deferred).
- Roadmap Phase 5.5 — mark A6 and B1 resolved.

## Acceptance Criteria

- Included deliverables render on each package line during an active draft and on locked FINAL.
- Swap Basic→Standard→Basic (state restored) shows the original deliverables again without discarding the draft.
- Upgrade/Replace cards render and are interactive on locked FINAL.
- Restoring deliverables changes no total, diff, staged-changes row, or financial-preview figure.
- Draft and post-commit deliverable shapes match (convergence with Spec 139).
- This spec changes a composition display surface: it consumes the canonical read model + projector, reads money from raw projector fields formatted via `src/lib/formatting/money.ts`, and adds no `@/lib/db` imports in `app/**` or `src/components/**`.
- New tests wired into `test:centralization`.
- `npm run test:centralization` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Resolved Decisions

1. **Option A over Option B:** re-derive included deliverables from the catalog at read time rather than embedding them in the snapshot. The Phase 5.5 bugs are rendering divergences, not truth divergences. (User-approved June 2026.)
2. **Accepted limitation:** deliverable display is catalog-current, not commit-historical. Revisit Option B only if commit-time deliverable fidelity becomes a hard requirement (Phase 7+).
