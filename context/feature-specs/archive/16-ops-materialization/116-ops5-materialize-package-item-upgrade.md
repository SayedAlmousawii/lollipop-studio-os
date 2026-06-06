## Goal

Make workspace finalize materialize package-item upgrade edits back into `OrderPackageItemUpgrade` operational rows. After this spec, a post-lock deliverable upgrade (e.g., small album → premium album) appears as a real `OrderPackageItemUpgrade` row scoped to the affected `OrderPackage`, not as a replayed adjustment invoice line. A user-facing activity event is emitted per edit.

## Read First

- Previous specs `112-ops1-...` through `115-ops4-...`
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts` — `computeWorkspaceProposal` (proposal shape for item-kind edits), `packageItemUpgradeLineId`, the swap and add-on materialization helpers
- `src/modules/orders/order.service.ts` — direct item upgrade edit handlers and the activity shape they emit
- `prisma/schema.prisma` — `OrderPackageItemUpgrade`, including its `@@unique([orderId, orderPackageId, packageItemId])` constraint

## Rules

- Materialization runs in step 4 of the canonical finalize sequence defined in spec 114, after `materializeAddOnEdits` and before adjustment invoice creation. Invoice line items continue to derive from the finalized proposal delta, never from re-reading the just-mutated `OrderPackageItemUpgrade` rows. Updated sequence inside step 4: session-config → swap → add-on → **item upgrade**.
- Item upgrade edits are proposal lines with `kind === "item"` produced by `add_line` or `modify_quantity` ops, targeting a `packageItemId` scoped to an `orderPackageId`. The proposal's `lineId` follows the `packageItemUpgradeLineId(orderPackageId, packageItemId)` convention.
- For an upgrade add: upsert one `OrderPackageItemUpgrade` row keyed by `(orderId, orderPackageId, packageItemId)`, with `nameSnapshot`, `priceSnapshot`, `quantity` from the edit.
- For an upgrade remove (`remove_line` or `modify_quantity` to ≤ 0): delete the row.
- For an upgrade quantity change: update `quantity`.
- Spec 112's package-swap materialization already cascades-deletes `OrderPackageItemUpgrade` rows for the affected `orderPackageId`. Item-upgrade materialization in this spec must run *after* swap materialization so any same-workspace upgrade-after-swap edits are written against the post-swap line state. Verify proposal ordering preserves this; if not, sort edits explicitly before materializing.
- Decide the activity type in the spec PR: reuse `ORDER_PACKAGE_LINE_CHANGED` is wrong (that's tier change). If no item-upgrade type exists today, add a new `OrderActivityType.ORDER_PACKAGE_ITEM_UPGRADED` and emit it. If a closer existing type exists (e.g., the pre-lock direct edit path emits something specific), reuse that. The implementer chooses based on what direct edits currently emit — consistency with direct edits is the rule.

## Scope

### In Scope

- New helper `materializeItemUpgradeEdits` colocated with the swap and add-on helpers.
- Sequence wiring in `finalizeWorkspace`: item upgrade step runs after add-on step.
- Activity emission per edit, matching the direct-edit activity type (added if missing).
- Regression test: an order with a finalized item-upgrade-only workspace returns identical snapshots from `getEffectiveCompositionForInvoice` and `captureCurrentOrderComposition`.
- Regression test: workspace with `swap_package` + item upgrade on the same line writes the item upgrade *after* the swap-driven cascade delete, so the upgrade row survives finalize.

### Out of Scope

- Photo count materialization (next spec).
- Projection collapse (final spec).

## Implementation Direction

Iterate proposal edits filtered to those whose resolved proposal line has `kind === "item"`. For each, parse `orderPackageId` and `packageItemId` from the line id using the existing `packageItemUpgradeLineId` convention.

For adds: `tx.orderPackageItemUpgrade.upsert` keyed by the unique constraint. The `nameSnapshot` and `priceSnapshot` come from the resolved package item / product at finalize time (same resolution the proposal used). For removes: delete by the same key. For quantity changes: update.

Sequencing inside finalize is load-bearing here because spec 114's swap materialization deletes all `OrderPackageItemUpgrade` rows for the swapped `orderPackageId`. If a single workspace contains both a swap on package line L *and* a new item upgrade on L, the upgrade must be written after the swap-driven delete or it will be lost. The implementer should verify the natural proposal edit order matches this; if not, sort within `materializeItemUpgradeEdits` so its writes are last across the swap/upgrade pair.

For the activity: check `src/modules/orders/order-activity.types.ts` for an existing `ORDER_PACKAGE_ITEM_UPGRADED` (or similar) used by direct edits. If it exists, emit it with matching metadata. If not, add it as a new enum value and migration alongside this spec.

## Post-Implementation

- Update `context/progress-tracker.md` Now / Key State.

## Acceptance Criteria

- After finalize of a workspace containing an item upgrade add, an `OrderPackageItemUpgrade` row exists keyed on `(orderId, orderPackageId, packageItemId)` with correct `nameSnapshot`, `priceSnapshot`, `quantity`.
- Item upgrade removes and quantity changes are reflected in the row state.
- A workspace that contains a `swap_package` on line L and an item upgrade on L leaves the item upgrade row present after finalize (order-of-operations correctness).
- Per-edit activity is emitted with the same shape direct edits produce.
- `getEffectiveCompositionForInvoice` matches `captureCurrentOrderComposition` for the parent invoice's order.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
