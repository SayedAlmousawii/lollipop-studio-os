## Goal

Make workspace finalize materialize `swap_package` edits back into `OrderPackage` operational rows. After this spec, a post-lock package swap updates `currentPackageId`, the current name snapshot, the final price snapshot, and the photo counts on the affected `OrderPackage`. The workspace marks itself materialized (`operationalStateAppliedAt`), so the composition replay path skips its adjustment invoice. A user-facing `ORDER_PACKAGE_LINE_CHANGED` activity is emitted alongside `INVOICE_ADJUSTED`. The adjustment invoice is still produced as the immutable financial delta — only its role as a composition source disappears for this workspace.

## Read First

- Previous specs `112-ops1-...` and `113-ops2-...`
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts` — `finalizeWorkspace`, `finalizeSessionConfigurationSelectionEdits`, `createWorkspaceAdjustmentInvoice`, `markWorkspaceFinalized`, `captureCurrentOrderComposition`
- `src/modules/orders/order.service.ts` — `updateOrderPackage` (mirror behavior, especially the `OrderPackageItemUpgrade` cleanup at the swap point)
- `src/modules/orders/order-activity.service.ts` — `ORDER_PACKAGE_LINE_CHANGED` shape

## Rules

- Materialization runs inside the existing finalize transaction. No second transaction, no post-commit hook.
- Materialization happens **before** adjustment invoice creation. The adjustment invoice's line items are generated from the proposal delta computed in step 2 of the canonical sequence — they are never derived by re-reading the now-mutated operational rows. This keeps the invoice authoritative on the financial side and the proposal the single source for both halves of the write.
- For each `swap_package` edit, identify the target `OrderPackage` by the same line resolution the proposal uses. Update `currentPackageId`, `currentPackageNameSnapshot`, `finalPackagePriceSnapshot`, and `selectedPhotoCount` using the same logic `updateOrderPackage` applies pre-lock for these fields. Do not touch `originalPackageId` or `originalPackageNameSnapshot`.
- Cascade `OrderPackageItemUpgrade` cleanup for that `orderPackageId` exactly as the pre-lock swap does. Item upgrades for a different package don't transfer.
- `markWorkspaceFinalized` sets `operationalStateAppliedAt = now()` only when at least one materializable edit was actually applied. A workspace with no materializable ops (e.g., session-config-only) leaves the flag null.
- Emit one `ORDER_PACKAGE_LINE_CHANGED` `OrderActivity` per swap, with the same metadata shape `updateOrderPackage` uses today.
- Idempotency: finalize must reject a workspace that already has `operationalStateAppliedAt != null`. This guard belongs in `finalizeWorkspace` alongside the existing status / version assertions.
- `applySignedInvoiceLines` does not need to learn about package-swap causes specifically; the workspace-level skip from spec 113 already handles it because finalize sets the flag.

## Scope

### In Scope

- New `materializeSwapPackageEdits` helper (colocated next to `finalizeSessionConfigurationSelectionEdits`) that mutates `OrderPackage` rows and cascades item-upgrade deletes per affected line. Runs **before** `createWorkspaceAdjustmentInvoice`.
- Re-sequence `finalizeWorkspace` so materialization runs after approval checks and before invoice creation; activities and audit are emitted after invoice creation; `markWorkspaceFinalized` is the last step. See Implementation Direction for the canonical order.
- Per-edit `OrderActivity` emission with `previousPackageId`, `previousPackageName`, `nextPackageId`, `nextPackageName`, and the package adjustment amount derived from proposal deltas.
- `markWorkspaceFinalized` invocation passes `operationalStateAppliedAt = new Date()` when at least one materializable edit was applied; otherwise `null`.
- Idempotency guard in `finalizeWorkspace` rejecting already-materialized workspaces.
- Regression test: an order with a finalized swap-only workspace returns identical snapshots from `getEffectiveCompositionForInvoice` and `captureCurrentOrderComposition`.
- Regression test: the finalized adjustment invoice's line items remain immutable and unchanged in shape — only their role as composition source is removed.

### Out of Scope

- Add-on materialization, item upgrade materialization, photo count materialization (later specs).
- Collapsing `getEffectiveCompositionForInvoice` to drop `applySignedInvoiceLines` entirely (final spec).
- Any change to the proposal computation in `computeWorkspaceProposal`.
- Refund / credit-note flows beyond what `finalizeWorkspace` already covers.

## Implementation Direction

The new helper `materializeSwapPackageEdits` takes the transaction client, the finalized proposal, and the order id. It iterates `proposal.edits` filtered to `op === "swap_package"`, resolves each to its target `OrderPackage` (the proposal already carries `fromPackageRefId`; resolve by `currentPackageId` match on that order), and applies the same field updates `updateOrderPackage` does for `finalPackagePriceSnapshot` and `selectedPhotoCount`. The current name snapshot is the new package's `name`. Then it deletes `OrderPackageItemUpgrade` rows scoped to that `orderPackageId`, matching pre-lock semantics.

The package adjustment amount used in the activity metadata is read from the proposal delta for that edit — not recomputed against post-mutation rows. Match whichever shape `updateOrderPackage` currently produces so downstream consumers are uniform.

**Canonical transaction order inside `finalizeWorkspace` (load-bearing for this and every later materialization spec):**

1. Load workspace and current order state. Assert OPEN, version match, owner/manager, and `operationalStateAppliedAt == null`.
2. Build the finalized proposal (`buildProposalForWorkspace`).
3. Run approval checks (manager-approved-reduction logic).
4. Materialize operational rows for this spec's supported ops:
   - `finalizeSessionConfigurationSelectionEdits` (existing).
   - `materializeSwapPackageEdits` (new in this spec).
   - Future specs (113–115) plug additional materializers here in order.
5. Create the adjustment financial document from the **finalized proposal delta** via `createWorkspaceAdjustmentInvoice`. Invoice lines must derive from `proposal.deltas`, never from re-reading operational rows that step 4 just mutated.
6. Emit activities and audit: per-op `OrderActivity` records (one `ORDER_PACKAGE_LINE_CHANGED` per swap in this spec) plus the pre-existing `INVOICE_ADJUSTED` activity and the `ADJUSTMENT_ISSUED` audit log already produced by `createWorkspaceAdjustmentInvoice`.
7. `markWorkspaceFinalized` with `operationalStateAppliedAt = new Date()` when at least one materializable edit ran in step 4; otherwise `null`.

Idempotency: step 1's `operationalStateAppliedAt == null` assertion is the guard. The existing version check covers most retry races; this is the belt-and-suspenders guard for any path that bypasses version.

The workspace-level replay skip from spec 113 means a swap-only finalized workspace contributes nothing to composition replay once the flag is set in step 7. The operational row is the truth. Verify this with a test that runs the full finalize, then asserts `getLockedOrderCompositionViewModel` matches `captureCurrentOrderComposition` line-for-line.

## Post-Implementation

- Update `context/progress-tracker.md` Now / Key State.

## Acceptance Criteria

- After finalize of a workspace containing a `swap_package` edit, the target `OrderPackage` row has `currentPackageId` and `currentPackageNameSnapshot` set to the new package, `finalPackagePriceSnapshot` updated, `selectedPhotoCount` reconciled, and `originalPackageId` unchanged.
- `OrderPackageItemUpgrade` rows for that `orderPackageId` are deleted as part of the swap.
- An `ORDER_PACKAGE_LINE_CHANGED` order activity is recorded with the same metadata shape pre-lock swaps emit. The pre-existing `INVOICE_ADJUSTED` activity is still recorded.
- The workspace row has `operationalStateAppliedAt != null` after finalize.
- `getEffectiveCompositionForInvoice` for the parent invoice returns the same snapshot as `captureCurrentOrderComposition` on that order (no double-apply).
- The finalized adjustment invoice remains immutable: line items unchanged in count, type, and amount versus prior behavior.
- A second finalize attempt on the same workspace is rejected by the idempotency guard.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
