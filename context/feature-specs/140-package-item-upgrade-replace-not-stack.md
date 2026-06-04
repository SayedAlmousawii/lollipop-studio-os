## Goal

Make a package-item upgrade for an already-upgraded included item **replace** the existing upgrade instead of **stacking** its quantity. Today, re-upgrading the same `packageItemId` increments the staged upgrade line's quantity, so the order materializes a quantity-2 `OrderPackageItemUpgrade` and the invoice charges the upgrade delta twice (manual bug A3: "2x Album 20x20 → Album 30x30"). The upgrade domain models "this included item is replaced by that product" — a per-item set operation — not "buy N upgrades." This spec corrects the staging semantics so re-applying an upgrade to the same included item updates the single staged line (latest replacement product, delta, and label) and never multiplies the charge.

Spec 139 removes the visual trigger (the old deliverable no longer renders, so the user is less likely to re-upgrade), but the stacking is a real reducer/contract defect and must be fixed independently so the financial outcome is correct regardless of UI.

## Read First

- `/tmp/phase-5.5-bug-investigation.md` (or the in-chat write-up) — A3 trace and root-cause group G1.
- `context/feature-specs/136-sales-package-item-upgrade-staging.md` — the corrected `PACKAGE_ITEM_UPGRADE` staging contract this spec refines.
- `src/modules/order-commits/order-commit-package-item-upgrade-reducer.ts:60-150` — `addPackageItemUpgrade`: the ADD branch that currently **merges by `(parentOrderPackageId, catalogEntityId === packageItemId)` and increments quantity** (`existingIndex` path at :99-117).
- `src/modules/order-commits/order-commit.service.ts:1250-1272` — `PACKAGE_ITEM_UPGRADE` staging dispatch and `draftPackageItemUpgradeId` assignment.
- `src/modules/order-commits/order-commit.service.ts:1421-1505` — `resolveStagedPackageItemUpgrade`: resolves current item + replacement product + delta/label.
- `src/modules/order-commits/order-commit.service.ts:2116-2138` — `packageItemUpgradeLine` capture: sets `catalogEntityId = upgrade.packageItemId` (the merge key the baseline brings in).
- `src/modules/order-commits/order-commit-materialization.service.ts:768-792` — `updateItemUpgradeIfChanged`: writes the (currently stacked) quantity to the `OrderPackageItemUpgrade` row.
- `src/components/orders/pos-package-composition.tsx:935-1009` — `ItemUpgradeDialog`: sends `{ orderPackageId, packageItemId, toProductId, quantity: item.quantity }`.
- `tests/order-commits/order-commit-package-item-upgrade-reducer.test.ts` — existing reducer coverage to extend.

## Rules

- Reducer/staging-contract correction only. No Prisma schema, materializer structure, financial-emission, preview-classification, add-on, session-configuration, or AW change.
- An upgrade is identified by the included `packageItemId` within its parent package. Re-applying an upgrade for the same `packageItemId` is a **replace**, not an increment: the staged line keeps quantity equal to the included item's quantity and adopts the latest resolved replacement product, unit price (delta), label, and `catalogEntityId`.
- Changing the replacement product on a re-upgrade must update the staged delta/label to the new product; it must not add a second upgrade line and must not retain the prior product's delta.
- Removing/clearing an upgrade remains available via the existing `REMOVE` / `UPDATE_QUANTITY` → 0 path and must not be regressed.
- Keep pricing/catalog resolution in the staging service; the pure reducer still receives fully resolved replacement data.
- No `@/lib/db` imports in `app/**` or `src/components/**`.

## Scope

### In Scope

- Change `addPackageItemUpgrade` so that when a staged or baseline-captured `PACKAGE_ITEM_UPGRADE` line already exists for `(parentOrderPackageId, packageItemId)`, the ADD **replaces** that line's replacement product, unit price, label, `catalogEntityId`-derived metadata, and quantity (set to the requested item quantity) instead of summing quantity.
- Ensure the staging service still resolves the replacement product/delta for a re-upgrade so the replaced line carries correct values (`resolveStagedPackageItemUpgrade`).
- Preserve `draftPackageItemUpgradeId` identity for a line first staged in the current draft; for a baseline-captured upgrade being changed, keep its committed `orderEntityId` so the materializer updates the existing row rather than creating a duplicate.
- Tests:
  - Re-applying the same `packageItemId` upgrade in one draft yields one line at the included quantity (not 2×), with the latest delta/label.
  - Re-upgrading a **baseline-captured** committed upgrade updates the same `OrderPackageItemUpgrade` (same `orderEntityId`) and commits without doubling the invoice.
  - Re-upgrading to a **different** replacement product updates the delta/label to the new product, single line.
  - `REMOVE` and `UPDATE_QUANTITY → 0` still clear the upgrade.
  - A financial assertion: committing an upgrade, then re-upgrading and committing again, charges the upgrade delta once (no stack).
- Wire new tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md`.

### Out of Scope

- The composition rendering of upgrades (Spec 139) and included-deliverable restoration (Spec 141).
- Any change to how upgrades flow into financial totals beyond preventing the duplicate.
- New UI affordance; the `ItemUpgradeDialog` contract stays as-is.
- Prisma schema / migration.

## Implementation Direction

In `addPackageItemUpgrade`, keep the existing-line lookup by `(parentOrderPackageId, catalogEntityId === packageItemId)` but change the matched-line behavior from "quantity += requested" to "replace fields, quantity = requested item quantity." The resolved replacement (`resolveStagedPackageItemUpgrade`) already supplies the correct label/unit price/`packageItemId`; use it to overwrite the existing line. Confirm the baseline-captured line (`packageItemUpgradeLine`, `catalogEntityId = packageItemId`, real `orderEntityId`) is matched so the replace targets the committed row's identity, letting `updateItemUpgradeIfChanged` update in place. Add the financial round-trip test to lock the "charged once" invariant.

## Observability Checklist

### Dashboards / Metrics

- None added.

### Rollback Plan

- No schema/migration. Rollback = revert the reducer/staging change. Drafts staged during the window remain valid (replace is a stricter form of the prior upsert).

### Customer-Visible Surface

- Re-upgrading an already-upgraded item updates the upgrade rather than charging it again. No new controls.

## Post-Implementation

- `context/progress-tracker.md` — "Now" line: package-item upgrade re-application now replaces the existing upgrade instead of stacking quantity; the upgrade delta is charged once.
- Roadmap Phase 5.5 — mark A3 resolved.

## Acceptance Criteria

- Re-applying an upgrade to the same included `packageItemId` produces one staged line at the included quantity with the latest replacement delta/label; quantity does not increment.
- Re-upgrading a committed upgrade updates the same `OrderPackageItemUpgrade` row and does not duplicate the invoice charge.
- Re-upgrading to a different replacement product updates the delta/label to that product.
- `REMOVE` / `UPDATE_QUANTITY → 0` still clear the upgrade.
- No schema, materializer structure, financial-emission, preview, add-on, or session-configuration behavior changed.
- New tests wired into `test:centralization`.
- `npm run test:centralization` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Resolved Decisions

1. **Set vs add:** a package-item upgrade is a per-included-item set operation. Re-applying replaces; it never multiplies. (User-approved June 2026.)
