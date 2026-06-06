## Goal

Converge the legacy live POS composition projection with the canonical OrderCommit snapshot projection so package-item upgrades render as **package deliverable upgrades** (never as add-ons) and add-ons render as a **single quantity-N line** (never exploded into per-unit rows). This is the highest-leverage fix in the Phase 5.5 follow-up set: it resolves manual bugs A1, A2, A4, A5, C2, and C3, which all stem from one divergence — the live/post-commit projection derives deliverables from the catalog, folds `OrderPackageItemUpgrade` rows into the add-on display channel, and explodes add-on quantity, while the draft snapshot projection does the architecturally-correct opposite.

This spec changes only the **read/projection layer**. It must keep every financial total byte-identical (the upgrade money stays counted exactly once in the net), make no schema, capture, reducer, materializer, or financial-emission change, and not reintroduce any AW path on the Sales surface.

## Read First

- `/tmp/phase-5.5-bug-investigation.md` (or the in-chat investigation write-up) — root-cause group G1 and the live-vs-snapshot projection divergence table.
- `context/reviews/unified-order-commit-live-pos-roadmap.md` — Phase 5 canonical-source / projector rules.
- `src/modules/orders/order.service.ts:3515` — `combineFinancialAddOnRows`: merges `packageItemUpgrades` into the add-on rows that feed both `addOnTotal` and the marketplace display (source of A4).
- `src/modules/orders/order.service.ts:3639` — `mapPOSAddOns`: explodes a quantity-N `OrderAddOn` into N single-unit entries sharing one `addOnRowId` (source of C2/C3).
- `src/modules/orders/order.service.ts:3754` — `buildPOSPackageLines` → `packageItems: mapPOSPackageItems(currentPackage.items)`: deliverables read from the catalog, `OrderPackageItemUpgrade` never applied (source of A1).
- `src/modules/orders/order.service.ts:577-661` — `getPOSWorkspace` assembly of `packageLines`, `addOns`, `addOnTotal`, and the totals consumed downstream.
- `src/modules/orders/composition/order-composition.service.ts:163-211` — `buildCompositionSnapshotFromPOSWorkspace`: where `addOns`, `deliverables`, and `totals.netCompositionTotal` are derived from the workspace.
- `src/modules/orders/composition/projections/to-draft-pos-composition.ts:197-268` — `projectPackageItems` (already overlays upgrade lines for the adjustment path) and `projectAddOn`.
- `src/modules/orders/composition/projections/to-pos-add-on-marketplace.ts:28-74` — `toPOSAddOnMarketplace` / `projectCurrentAddOnRows`: re-explodes by quantity; the marketplace "Current add-ons" surface (C2/C3).
- `src/modules/order-commits/projections/to-sales-page-composition.ts:92-125,165-177` — the canonical snapshot projection this spec converges toward (upgrades → `packageItems`; add-ons → single line).
- `src/modules/order-commits/sales-staging-handler-adapter.ts:117-141` — `removeAddOn` already decrements when `currentQuantity > 1`; this spec makes the projection feed it a correct `currentQuantity`.

## Rules

- Read/projection layer only. No change to Prisma schema, snapshot capture, any reducer, the materializer, financial emission, preview classification, or staging.
- **Financial parity is mandatory.** The order net total, `addOnTotal` contribution, invoice line behavior, and every figure in the financial sidebar/preview must be unchanged. The package-item upgrade money must remain counted exactly once in the net — moving it out of the *display* add-on list must not remove it from the *financial* total.
- Package-item upgrades must render as package deliverable upgrades on the package line, consistent with `to-sales-page-composition.ts`. They must not appear in any add-on list (`workspace.addOns`, `composition.addOns`, or the marketplace `currentAddOns`).
- Add-ons render as one line carrying the true quantity. "Remove One" decrements (`UPDATE_QUANTITY` to quantity − 1) and only deletes the `OrderAddOn` at quantity 1.
- Order-level marketplace add-ons stay order-level; linked-product (Category D) add-ons remain out of the marketplace and are untouched here.
- No `@/lib/db` imports added to `app/**` or `src/components/**`. No Adjustment Workspace naming on the Sales surface.

## Scope

### In Scope

- **Stop rendering upgrades as add-ons (live/post-commit path):**
  - Build the displayed add-on list (`workspace.addOns`) from `order.orderAddOns` only, excluding `packageItemUpgrades`.
  - Re-home the package-item-upgrade money into a deliverable/upgrade total channel on the owning package line (mirror `packageSubtotal`/`upgradeDelta` in the snapshot projection) so `netCompositionTotal` is unchanged. The financial `addOnTotal` consumed by invoice/financial code keeps the same numeric net (implementation may keep upgrades in a financial sub-total separate from the display list, as long as the net and all financial reads are identical).
- **Apply upgrades to deliverables (live/post-commit path):** overlay `OrderPackageItemUpgrade` rows onto the catalog-derived `packageItems` of their owning package, matched by `packageItemId`, so the deliverable shows the upgraded product and per-item delta — the same overlay `projectPackageItems` already performs for the adjustment path.
- **Stop exploding add-on quantity:** `mapPOSAddOns` and `projectCurrentAddOnRows` emit one row per `OrderAddOn` carrying the real quantity and a correct `currentQuantity`/`removalOrderAddOnQuantity`, so the marketplace decrement path works.
- Confirm the marketplace component (`pos-add-on-marketplace.tsx`) passes the true `currentQuantity` into `removeAddOn` (it already reads `addOn.currentQuantity`); adjust only the projection that feeds it.
- Tests under `tests/orders/composition/` and `tests/orders/`:
  - Post-commit composition shows the upgraded deliverable (upgraded product name + delta) on the package line and **no** upgrade entry in any add-on list.
  - `netCompositionTotal`, package subtotal, `addOnTotal` financial contribution, and financial-sidebar figures are identical before/after for an order with one upgrade (golden-number assertion).
  - A quantity-2 add-on renders as one row with `currentQuantity = 2`; "Remove One" stages `UPDATE_QUANTITY` to 1; a second "Remove One" stages `REMOVE`.
  - Live and snapshot projections produce the same deliverable/add-on shape for an equivalent order (convergence assertion).
- Wire new tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md`.

### Out of Scope

- Restoring **included** deliverables during a draft or on locked FINAL — that is Spec 141 (Option A). This spec only fixes the live/post-commit path's handling of upgrades and add-on quantity.
- Re-upgrade replace-vs-stack semantics — Spec 140.
- Any reducer, capture, materializer, schema, financial-emission, or preview change.
- Linked-product (Category D) add-ons and session configurations.
- Any marketplace/panel visual redesign (Phase 7).

## Implementation Direction

Treat `to-sales-page-composition.ts` as the canonical shape and bring the live path (`getPOSWorkspace` → `buildCompositionSnapshotFromPOSWorkspace` → `toDraftPOSComposition` → `toPOSAddOnMarketplace`) into agreement with it.

1. In `order.service.ts`, separate the **financial** combination of upgrades from the **display** add-on list. Keep `addOnTotal`'s net contribution, but compute `workspace.addOns` from real `OrderAddOn` rows only, and surface upgrade money on the owning package line (use the existing `upgradeDelta`/`packageSubtotal` mechanics as the model). Apply `OrderPackageItemUpgrade` to `packageItems` by `packageItemId` so the deliverable renders upgraded.
2. In `mapPOSAddOns`, return one entry per row with its quantity; in `to-pos-add-on-marketplace.ts`, stop multiplying rows by quantity and carry `currentQuantity`/removal quantity through.
3. Add a focused parity test that locks the order net and financial-sidebar figures so the re-homing of upgrade money cannot regress totals.

Keep all math in the read layer; introduce no DB access in components.

## Observability Checklist

### Dashboards / Metrics

- None added. Pure projection convergence.

### Rollback Plan

- No schema or migration. Rollback = revert the projection changes. No data state is touched; drafts and commits are unaffected.

### Customer-Visible Surface

- Staff see package-item upgrades on the package deliverable (e.g. "Album 20x20 → Album 30x30") instead of as an add-on row, both during a draft and after commit. Add-ons show one row with a quantity; "Remove One" decrements instead of clearing all units. No figures change.

## Post-Implementation

- `context/progress-tracker.md` — "Now" line: live/post-commit composition now renders package-item upgrades as deliverable upgrades and add-ons as single quantity-N lines, converging with the snapshot projection; financial totals unchanged.
- Roadmap Phase 5.5 — note A1/A2/A4/A5/C2/C3 resolved; A6/B1 remain for Spec 141, A3 for Spec 140.

## Acceptance Criteria

- Package-item upgrades render as deliverable upgrades on the owning package line and appear in no add-on list (workspace, composition, or marketplace), pre- and post-commit.
- Add-ons render as one row carrying true quantity; the marketplace decrement path stages `UPDATE_QUANTITY` to quantity − 1 above 1 and `REMOVE` at 1.
- Order net total, `addOnTotal` net contribution, invoice behavior, and all financial-sidebar/preview figures are unchanged (golden-number tests).
- The live and snapshot projections produce equivalent deliverable/add-on shapes.
- This spec adds/changes a composition display surface: it consumes the canonical read model + projector, reads money from raw projector fields formatted via `src/lib/formatting/money.ts`, and adds no `@/lib/db` imports in `app/**` or `src/components/**`.
- New tests wired into `test:centralization`.
- `npm run test:centralization` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Open Questions

- Whether to physically move upgrade money into a new total field on the package line or keep it numerically inside `addOnTotal` while excluding it from the display list. Implementer's choice, gated by the financial-parity tests; the only hard requirement is that the net is unchanged and upgrades never appear as add-on rows.
