## Goal

Make workspace finalize materialize extra-photo and selected-photo-count edits back into `OrderPackage` fields. After this spec, post-lock extra digital/print photo changes and selected-photo-count changes appear on the operational row, not as adjustment-invoice-replay composition lines. The `Order.selectedPhotoCount` cache is kept in sync. A user-facing `ORDER_PACKAGE_EXTRAS_CHANGED` activity is emitted per affected package line.

## Read First

- Previous specs `112-ops1-...` through `116-ops5-...`
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts` — `captureCurrentOrderComposition` (how extra-photo lines are produced), proposal edit shapes for extra photo ops
- `src/modules/orders/order.service.ts` — `syncOrderSelectedPhotoCountFromPackageLines`, direct extra-photo edit handlers, `ORDER_PACKAGE_EXTRAS_CHANGED` activity shape
- `prisma/schema.prisma` — `OrderPackage.extraDigitalCount`, `extraPrintCount`, `selectedPhotoCount`; `Order.selectedPhotoCount`

## Rules

- Materialization runs in step 4 of the canonical finalize sequence defined in spec 114, after `materializeItemUpgradeEdits` and before adjustment invoice creation. Invoice line items continue to derive from the finalized proposal delta, never from re-reading the just-mutated `OrderPackage` photo-count fields. Step 4 sub-order is now: session-config → swap → add-on → item upgrade → **photo counts**.
- Photo edits in the proposal are extra-photo line additions / removals / quantity changes (identified by the `extraPhotoLineId(orderPackageId, mediaType)` convention used in `captureCurrentOrderComposition`) and selected-photo-count adjustments embedded in `swap_package` edits or surfaced as a dedicated edit op — verify which the workspace currently produces.
- For each affected `OrderPackage`: write `extraDigitalCount`, `extraPrintCount`, and `selectedPhotoCount` to the proposal's resolved values.
- Call `syncOrderSelectedPhotoCountFromPackageLines` once at the end so `Order.selectedPhotoCount` reflects the new totals.
- Emit one `ORDER_PACKAGE_EXTRAS_CHANGED` activity per affected `OrderPackage` (not per individual photo edit), with metadata matching direct extra-photo edits.
- Selected-photo-count changes that are *side effects* of a package swap (handled by spec 114) must not be re-applied here. This helper only handles edits not already covered by swap materialization.

## Scope

### In Scope

- New helper `materializePhotoCountEdits` colocated with the other materialization helpers.
- Sequence wiring in `finalizeWorkspace` for the photo-counts step.
- `Order.selectedPhotoCount` resync via the existing helper.
- `ORDER_PACKAGE_EXTRAS_CHANGED` activity emission per affected line.
- Regression test: a workspace containing only extra-photo and selected-count changes materializes correctly and produces no composition double-apply.
- Regression test: a swap + extra-photo workspace lands extras after the swap's photo-count side-effects are written, with no field clobbering.

### Out of Scope

- Projection collapse (final spec).
- Any new direct-edit path changes.

## Implementation Direction

Identify photo-related edits by inspecting proposal lines and the originating edits. Extra digital / print photos appear as lines with `kind === "item"` and a `lineId` shaped by `extraPhotoLineId`. Selected photo count adjustments either ride on a `swap_package` (spec 114 handles those) or are an explicit numeric edit op — confirm which in `computeWorkspaceProposal` before writing the helper.

For each affected `orderPackageId`, compute the desired final `extraDigitalCount` and `extraPrintCount` from the proposal's resolved state (the proposal's `proposed.lines` already contain the final quantities; sum by media type per line). Write all three fields in one `tx.orderPackage.update` per package line — this avoids partial-write activity noise.

Order of operations vs spec 114: package swap may have already adjusted `selectedPhotoCount` based on the new package's included photo count. Photo-count materialization must read the *post-swap* `OrderPackage.selectedPhotoCount` as its starting point and apply additional deltas on top, not overwrite the swap's choice. The simplest correct implementation: derive final counts from the proposal's proposed snapshot (which already reflects all edits including swap), and write that final value — last writer wins, with the writer being the proposal-truth.

Call `syncOrderSelectedPhotoCountFromPackageLines(tx, orderId)` once after all per-line writes. Emit `ORDER_PACKAGE_EXTRAS_CHANGED` per affected line with the same metadata shape direct edits produce.

## Post-Implementation

- Update `context/progress-tracker.md` Now / Key State.

## Acceptance Criteria

- After finalize of a workspace containing extra-photo or selected-count edits, the affected `OrderPackage` rows have `extraDigitalCount`, `extraPrintCount`, and `selectedPhotoCount` matching the proposal's proposed state.
- `Order.selectedPhotoCount` is resynced from package lines.
- One `ORDER_PACKAGE_EXTRAS_CHANGED` activity per affected `OrderPackage` is recorded with metadata matching direct edits.
- A mixed swap + photo-count workspace produces the proposal's intended final counts without one step clobbering the other.
- `getEffectiveCompositionForInvoice` matches `captureCurrentOrderComposition` for the parent invoice's order.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
