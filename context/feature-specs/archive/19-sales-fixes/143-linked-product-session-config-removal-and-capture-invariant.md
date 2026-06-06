## Goal

Make linked-product session configurations removable (and editable) on the Sales surface. Manual bug D1 throws `OrderCommit session configuration reducer failed: selection target matched multiple lines for orderEntityId` when removing a linked-product config. Root cause (confirmed from a production stack trace): a linked-product selection owns **two** snapshot lines that intentionally share `orderEntityId = selection.id` — the `SESSION_CONFIGURATION` line and its coupled `LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON` line. The Sales session-config staging target carries `{ stableKey, lineId, orderEntityId }`, and `resolveOrderCommitDraftTargetLine` validates **every** supplied identifier independently, treating any field that matches more than one line as fatal. `stableKey` and `lineId` each uniquely identify the selection line, but `orderEntityId` matches both lines, so resolution throws before the unique fields can disambiguate. The same ambiguous target breaks an UPSERT edit of an existing linked product, not just REMOVE.

This is a target-identity bug, not a capture orphan (the prior orphan hypothesis is disproven — the selection line provably exists, since it is one of the two `orderEntityId` matches). The fix removes the ambiguity so linked-product configs resolve, remove, and edit cleanly, without regressing the Spec 137 linked-product discipline.

## Read First

- Production stack trace (June 2026): `resolveSessionConfigurationLine` → `resolveOrderCommitDraftTargetLine` throws "matched multiple lines for orderEntityId" on REMOVE of a linked-product config (`configurationId` with `snapshotLinkedProductId: addon-canvas-40x60`).
- `src/modules/order-commits/order-commit-target-resolver.ts:19-61` — `resolveOrderCommitDraftTargetLine`: iterates `TARGET_FIELDS` (`stableKey`, `lineId`, `orderEntityId`, `draftEntityId`) and throws at :39 if **any single field** matches >1 line; the contradiction check at :54 never runs because the per-field throw fires first.
- `src/modules/order-commits/sales-session-configuration-staging.ts:73-98` — `findSalesSessionConfigurationSnapshotTarget`: builds the target as `{ stableKey, lineId, orderEntityId }` (the `orderEntityId` is the ambiguous field).
- `src/modules/order-commits/order-commit.service.ts:2181-2269` — capture: `sessionConfigurationLines` sets the selection line `orderEntityId: selection.id`; `linkedSelectionAddOnLine` sets the linked add-on line `orderEntityId: selection.id` (the shared id by design).
- `src/modules/order-commits/order-commit-session-configuration-reducer.ts:150-181,448-468,599-610` — `removeSessionConfiguration`, `resolveSessionConfigurationLine`, and `isLinkedAddOnOwnedBySelection` (which keys the coupled add-on removal off the **resolved** line's `orderEntityId`, so it keeps working once resolution succeeds).
- `src/components/session-configurations/configure-session-panel.tsx:224-283` — `submitCommitStagingEdits`: stages REMOVE (value cleared) / UPSERT (value set) per changed config and passes `existingSelection`.
- `app/orders/[orderId]/sales/actions.ts:93-181` — `stageSessionConfigurationSelectionAction` and its error mapping (generic "Unable to save POS changes" = thrown non-Zod error).
- `context/feature-specs/137-sales-session-configuration-staging-unification.md` — the linked-product staging discipline to preserve.

## Rules

- Begin with a **failing repro** that reproduces the exact throw (REMOVE of a captured linked-product config), then add an UPSERT-edit repro for the same selection. Keep both as regression guards.
- Resolve the ambiguity at its source: a Sales session-config staging target must identify the **selection** line unambiguously. Do not rely on `orderEntityId` for a linked-product selection, because it is shared with the coupled linked add-on line by design.
- Primary fix (smallest blast radius): `findSalesSessionConfigurationSnapshotTarget` emits only the unique identifiers (`stableKey`, and optionally `lineId`) and omits `orderEntityId`. The resolved selection line still carries `orderEntityId = selection.id`, so `isLinkedAddOnOwnedBySelection` continues to remove the coupled add-on.
- Optional robustness (only if also needed): harden `resolveOrderCommitDraftTargetLine` so a non-unique field (e.g. `orderEntityId` matching a selection line and its coupled linked add-on) is used as a **consistency check** against the line picked by the unique fields, rather than a fatal per-field uniqueness error. If taken, it must not weaken resolution for `ADD_ON`, `PACKAGE`, `PHOTO`, or `PACKAGE_ITEM_UPGRADE` targets, where `orderEntityId` is unique.
- Preserve Spec 137 discipline: new linked products use `draftOrderAddOnId`; materialized ones use `orderAddOnId`; the schema `superRefine` still rejects a `draft:` `orderAddOnId`; the linked fee is counted exactly once (on the linked add-on line, not the session-config line).
- No Prisma schema/migration. No financial-emission change beyond removing the (now-removed) linked add-on's fee through the existing engine. No AW path on the Sales surface.
- No `@/lib/db` imports in `app/**` or `src/components/**`.

## Scope

### In Scope

- **Repro:** failing tests that (1) stage a REMOVE of a captured linked-product session config and reproduce "matched multiple lines for orderEntityId", and (2) stage an UPSERT edit of the same captured linked-product selection and reproduce the same throw. Keep both as regression tests.
- **Primary fix:** change `findSalesSessionConfigurationSnapshotTarget` to emit a target that uniquely identifies the selection line (use `stableKey = session-configuration-selection:{id}`, optionally `lineId = session-config:{id}`) and omit the ambiguous `orderEntityId`. Verify both REMOVE and UPSERT-with-target paths resolve a single line.
- **Coupled-line removal:** confirm `removeSessionConfiguration` still drops both the selection line and its linked add-on line (the latter via `isLinkedAddOnOwnedBySelection` keyed off the resolved selection line's `orderEntityId`), and `assertLinkedProductOwnership` passes.
- **Optional resolver hardening:** if a non-Sales caller can also pass an ambiguous `orderEntityId` for a session-config selection, harden `resolveOrderCommitDraftTargetLine` to treat a non-unique field as a consistency check, with explicit tests proving `ADD_ON`/`PACKAGE`/`PHOTO`/`PACKAGE_ITEM_UPGRADE` resolution is unchanged. Otherwise omit and note why.
- **Commit correctness:** committing the removal deletes the `OrderAddOn`, nulls `selection.orderAddOnId`, and deletes the selection (reuse the existing materializer ordering).
- Tests (under `tests/order-commits/` and/or `tests/session-configurations/`):
  - REMOVE of a captured linked-product config resolves a single selection line, drops both coupled lines, passes ownership, and the preview reflects the removed fee.
  - UPSERT edit of a captured linked-product selection (e.g. change option/value) resolves a single line and updates the selection (and its linked add-on) without the multi-match throw.
  - Commit of the removal deletes the `OrderAddOn`, nulls the selection link, and deletes the selection.
  - A draft-only (uncommitted) linked product can be removed in the same draft.
  - Spec 137 discipline intact: new = `draftOrderAddOnId`, materialized = `orderAddOnId`, `draft:` `orderAddOnId` rejected; the linked fee is counted once.
  - (If resolver hardened) `ADD_ON`/`PACKAGE`/`PHOTO`/`PACKAGE_ITEM_UPGRADE` target resolution is unchanged.
- Wire new tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md`.

### Out of Scope

- D2 (coalescing the two staged rows — operational session-config line + linked fee — into one display row): a presentation/product decision, deferred to Phase 7. This spec keeps the two-line model; it only makes the pair resolve and mutate together.
- Composition rendering (Specs 139/141), re-upgrade (Spec 140), package metadata diff (Spec 142).
- Any change to operational (non-linked) session-config behavior beyond the shared target fix.
- Prisma schema / migration; new financial behavior.

## Implementation Direction

Reproduce both the REMOVE and UPSERT throws first. The defect is that the Sales session-config target includes `orderEntityId`, which is non-unique for a linked-product selection (shared with the coupled linked add-on line). Make `findSalesSessionConfigurationSnapshotTarget` emit only the selection line's unique identifiers (`stableKey`, optionally `lineId`); the resolver then matches exactly one line, and the existing `isLinkedAddOnOwnedBySelection` logic (keyed off the resolved line's `orderEntityId = selection.id`) still removes the coupled add-on. Only if a non-Sales caller can reach `resolveOrderCommitDraftTargetLine` with an ambiguous session-config `orderEntityId`, additionally harden the resolver to use a non-unique field as a consistency check against the line chosen by unique fields — guarded by tests that prove the other domains, where `orderEntityId` is unique, are unaffected. Confirm the linked fee remains counted once.

## Observability Checklist

### Dashboards / Metrics

- None added. Reuse the existing `order_commit.session_configuration_edit_staged_from_sales` metric.

### Rollback Plan

- No schema/migration. Rollback = revert the target-builder (and optional resolver) change. Drafts staged during the window remain valid; the change only affects how the selection line is addressed, not the stored snapshot shape.

### Customer-Visible Surface

- Staff can remove and edit a linked-product session configuration on the Sales surface; removal drops the configuration and its linked product fee, and commit applies it. Previously both failed with "Unable to save POS changes."

## Post-Implementation

- `context/progress-tracker.md` — "Now" line: linked-product session configs now resolve their staging target unambiguously and are removable/editable end-to-end on the Sales surface; the Spec 137 linked-product discipline is preserved.
- Roadmap Phase 5.5 — mark D1 resolved; note D2 (two-row display) deferred to Phase 7.

## Acceptance Criteria

- Staging a REMOVE of a captured linked-product session config resolves a single selection line (no "matched multiple lines for orderEntityId"), drops both coupled lines, passes `assertLinkedProductOwnership`, and the preview reflects the removed fee.
- Staging an UPSERT edit of a captured linked-product selection resolves a single line and updates the selection and its linked add-on without the multi-match throw.
- Commit of the removal deletes the `OrderAddOn`, nulls `selection.orderAddOnId`, and deletes the selection.
- A draft-only linked product can be removed in the same draft.
- Spec 137 discipline preserved: new uses `draftOrderAddOnId`, materialized uses `orderAddOnId`, `draft:` `orderAddOnId` rejected; linked fee counted once.
- If the resolver is hardened, `ADD_ON`/`PACKAGE`/`PHOTO`/`PACKAGE_ITEM_UPGRADE` target resolution is provably unchanged.
- No schema/migration; no new financial behavior; no AW path on the Sales surface.
- New tests wired into `test:centralization`.
- `npm run test:centralization` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Resolved Decisions

1. **Root cause is target ambiguity, not capture orphan.** A linked-product selection and its coupled linked add-on line share `orderEntityId = selection.id` by design; the Sales staging target must identify the selection line by its unique `stableKey`/`lineId` and not by the shared `orderEntityId`. (Confirmed from production stack trace, June 2026.)

## Open Questions

- Whether to also harden `resolveOrderCommitDraftTargetLine` (consistency-check semantics for non-unique fields) or fix only the Sales target builder. Decide by checking whether any non-Sales caller constructs a session-config target with `orderEntityId`; if none, the target-builder fix alone is sufficient and lower-risk.
