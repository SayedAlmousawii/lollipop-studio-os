## Goal

Make workspace finalize materialize add-on edits (`add_line`, `remove_line`, `modify_quantity` where `kind === "addon"`) back into `OrderAddOn` operational rows. After this spec, post-lock add-on changes appear as real rows in `OrderAddOn` rather than as composition deltas replayed from the adjustment invoice. The adjustment invoice continues to capture the financial delta and is no longer a composition source for materialized workspaces. A user-facing `ADD_ON_CHANGED` activity is emitted per edit.

## Read First

- Previous specs `112-ops1-...`, `113-ops2-...`, `114-ops3-...`
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts` — `finalizeWorkspace`, `computeWorkspaceProposal` (for `add_line` / `remove_line` / `modify_quantity` shape), the swap-materialization helper landed in `114-ops3`
- `src/modules/orders/order.service.ts` — direct add-on edit handlers, `recordOrderActivity` calls with `ADD_ON_CHANGED`
- `prisma/schema.prisma` — `OrderAddOn`

## Rules

- Materialization runs in step 4 of the canonical finalize sequence defined in spec 114, after `materializeSwapPackageEdits` and before adjustment invoice creation. Invoice line items continue to derive from the finalized proposal delta, never from re-reading the just-mutated `OrderAddOn` rows.
- For `add_line` (addon): create one `OrderAddOn` row. Use the workspace edit's product ref and quantity. `orderPackageId` is set if the edit scoped the add-on to a specific package line; otherwise null. `nameSnapshot` and `priceSnapshot` come from the catalog product resolved at finalize time, matching what the proposal used.
- For `remove_line` (addon): delete the targeted `OrderAddOn` row by id. The proposal's `targetLineId` already encodes the order add-on id (lines in the captured snapshot use `addon:<id>`).
- For `modify_quantity` (addon): update `OrderAddOn.quantity` on the targeted row. Quantity ≤ 0 must be treated as a remove (matches proposal semantics).
- Edits that target add-ons created by a session configuration selection are still handled by `finalizeSessionConfigurationSelectionEdits`; do not double-process them here. Filter them out by checking whether the targeted `OrderAddOn` is linked via `OrderPackageSessionConfigurationSelection.orderAddOnId`.
- Set `operationalStateAppliedAt` on finalize whenever any materializable edit (swap, addon, or any future op) runs.
- Emit `ADD_ON_CHANGED` per edit with metadata mirroring direct POS add-on edits.

## Scope

### In Scope

- New helper `materializeAddOnEdits` colocated with `materializeSwapPackageEdits` from spec 114.
- Insert `materializeAddOnEdits` into step 4 of spec 114's canonical finalize sequence: session-config → swap → **add-on** → (future) item upgrade → photo counts → invoice (step 5) → activities/audit (step 6) → mark finalized (step 7).
- `ADD_ON_CHANGED` order activity emission per edit. Metadata fields: `orderAddOnId`, `productId`, `productName`, `previousQuantity`, `nextQuantity`, `unitPrice`.
- Skip logic for session-configuration-linked add-on rows so they aren't double-handled.
- Regression test: an order with a finalized add-on-only workspace returns identical snapshots from `getEffectiveCompositionForInvoice` and `captureCurrentOrderComposition`.
- Regression test: a mixed workspace (swap + add-on) materializes both and emits two activities (`ORDER_PACKAGE_LINE_CHANGED` and `ADD_ON_CHANGED`) plus `INVOICE_ADJUSTED`.

### Out of Scope

- Package item upgrade materialization (spec 116).
- Photo count materialization (spec 117).
- Collapsing the projection (spec 118).
- Any change to `computeWorkspaceProposal`.

## Implementation Direction

The proposal `add_line` edit for `kind === "addon"` resolves to a catalog product. At materialization time, re-resolve that product to get `name` and `price` (the proposal already validated availability — failures here would mean a catalog change mid-transaction, which is an error). Create the `OrderAddOn` with `nameSnapshot = product.name` and `priceSnapshot = product.price`, matching how pre-lock direct add-on adds snapshot pricing.

For `remove_line`, parse the `targetLineId` shaped `addon:<orderAddOnId>` and delete. If the line id does not match the addon pattern, the edit is not an add-on edit and is skipped by this helper.

For `modify_quantity`, the same `targetLineId` resolution applies. A `newQuantity <= 0` deletes the row; otherwise update `quantity`.

The session-config linkage check: query `OrderPackageSessionConfigurationSelection` for any row with `orderAddOnId` equal to the target. If found, that add-on is owned by the session-config materializer — skip in this helper. The session-config path already mutates the underlying `OrderAddOn` when needed.

`ADD_ON_CHANGED` activity metadata should match what direct add-on edits produce so timeline rendering doesn't branch by source. Look up the existing metadata shape on the direct POS path and mirror it here.

The workspace-level replay skip from spec 113 (already wired by spec 114's finalize path) means the adjustment invoice lines this workspace produces are not replayed. The `OrderAddOn` row is now the truth for that add-on.

## Post-Implementation

- Update `context/progress-tracker.md` Now / Key State.

## Acceptance Criteria

- After finalize of a workspace containing an add-on `add_line` edit, a new `OrderAddOn` row exists with the expected `productId`, `quantity`, `nameSnapshot`, `priceSnapshot`, and `orderPackageId` (or null).
- After finalize of a workspace containing an add-on `remove_line` edit, the targeted `OrderAddOn` row is gone.
- After finalize of a workspace containing an add-on `modify_quantity` edit, the targeted `OrderAddOn.quantity` reflects the new quantity; quantity ≤ 0 deletes the row.
- Each materialized add-on edit emits one `ADD_ON_CHANGED` order activity with metadata matching the direct-edit shape.
- Session-configuration-linked add-on rows are not double-processed: the workspace still finalizes correctly when a session-config edit and a regular add-on edit coexist.
- `getEffectiveCompositionForInvoice` matches `captureCurrentOrderComposition` for the parent invoice's order.
- The finalized adjustment invoice line items remain unchanged in shape.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
