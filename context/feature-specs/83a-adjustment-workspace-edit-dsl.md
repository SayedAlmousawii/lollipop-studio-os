# 83a — Adjustment Workspace: Edit DSL & Service Extension

## Goal

Extend the Adjustment Workspace backend with the staged-edit operations needed to reach POS parity: deliverable upgrade/replace, selected-photo-count change (with extra-photo billing implications), and a renamed/aligned package-tier change op. Backend only — no UI in this phase. Shippable in isolation: the workspace page will not yet expose the new ops; the only observable effect is that `applyEdit` accepts the new shapes and the service can compute proposals and emit ADJ line items for them.

## Read First

- `context/feature-specs/82-adjustment-workspace.md` — parent spec; especially §5 (net-delta algorithm) and §1 (data model).
- `src/modules/adjustment-workspace/adjustment-workspace.types.ts` — current `AdjustmentWorkspaceEdit` union.
- `src/modules/adjustment-workspace/adjustment-workspace.schema.ts` — Zod parser; must accept old shapes alongside new ones.
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts` — `computeWorkspaceProposal`, `createWorkspaceAdjustmentInvoice`, `captureCurrentOrderComposition`.
- `app/orders/[orderId]/sales/actions.ts` — `updateOrderPackageAction`, `updateOrderSelectedPhotoCountAction`, `upgradeOrderPackageItemAction` — the commit-through analogues whose semantics must be mirrored.

## Rules

- Existing edit shapes remain valid. Parser must accept both old and new payloads during and after rollout — rows already in `pending_changes_json` must not break.
- The diff-against-base normalization already shipped (signed deltas come from diffing `proposed.lines` against `base.lines`, not from edit-replay history) is preserved for every new op.
- Each new op must define: (a) its contribution to `proposed.lines`, (b) its contribution to signed deltas, (c) its mapping onto an existing `InvoiceLineType` in the emitted ADJ, (d) a corresponding `AdjustmentWorkspaceEventType` payload shape.
- Manager-approval evaluation continues to run only at finalize, on `netPayableDelta < 0`. New ops do not introduce inline approval gates.
- No changes to the `base_snapshot_json` shape. New ops must diff cleanly against the existing `AdjustmentCompositionLine[]`.

## Scope

### In Scope

- Three new ops on `AdjustmentWorkspaceEdit`:
  - `upgrade_package_item` — upgrade or replace a deliverable inside a package.
  - `change_selected_photo_count` — change `selectedPhotoCount` / `extraDigitalCount` / `extraPrintCount` for an order package, producing/replacing extra-photo billing lines in the proposed composition.
  - `change_package_tier` — promote/demote the package itself, keyed by `orderPackageId` (replaces the older `swap_package` for new code; old shape still parsed).
- Zod schema updates in `adjustment-workspace.schema.ts`.
- `applyEdit` acceptance of the new shapes (no UI surface change — call sites will arrive in 83c).
- `computeWorkspaceProposal` cases for each new op producing correct `proposed.lines`.
- Signed-delta emission for each new op, consistent with the existing diff-against-base normalization.
- `createWorkspaceAdjustmentInvoice` mapping for each op onto the appropriate `InvoiceLineType` (`PACKAGE_UPGRADE`, `BUNDLE_ADJUSTMENT`, `ADD_ON`, plus extra-photo billing where applicable).
- Event-type additions on `AdjustmentWorkspaceEventType` (or reuse of existing types if the payload distinguishes them — choose the lower-friction option).
- Tests: unit-level for parser, compute, and ADJ-line mapping; integration-level for stage-then-finalize emitting a correct ADJ for each new op individually.

### Out of Scope

- All UI changes — POS component refactor, workspace page rewire, new stage actions. Those are 83b / 83c.
- Schema changes to `adjustment_workspaces` or `adjustment_workspace_events` tables (op payloads are JSON; no column changes needed).
- Changes to `POSWorkspace` or order data model.
- Payment posting.

## Implementation Direction

### 1. Type extension

In `src/modules/adjustment-workspace/adjustment-workspace.types.ts`, extend the discriminated union:

```ts
type Edit =
  // existing
  | { id: string, op: 'add_line', kind: 'item' | 'addon', refId: string, quantity: number }
  | { id: string, op: 'remove_line', targetLineId: string }
  | { id: string, op: 'modify_quantity', targetLineId: string, newQuantity: number }
  | { id: string, op: 'swap_package', fromPackageRefId: string, toPackageRefId: string }
  | { id: string, op: 'swap_addon', targetLineId: string, toAddonRefId: string }
  // new
  | { id: string, op: 'upgrade_package_item', orderPackageId: string, packageItemId: string, toProductId: string, quantity: number }
  | { id: string, op: 'change_selected_photo_count', orderPackageId: string,
        selectedPhotoCount: number, extraDigitalCount: number, extraPrintCount: number }
  | { id: string, op: 'change_package_tier', orderPackageId: string, toPackageRefId: string }
```

Keep `swap_package` valid in the parser (rows may already be persisted). New code emits `change_package_tier`.

### 2. Schema parser

Extend `adjustmentPendingChangesSchema` in `adjustment-workspace.schema.ts` with the new op variants. Confirm via unit test that a payload mixing old + new shapes round-trips.

### 3. Service compute

In `computeWorkspaceProposal`:

- `upgrade_package_item`: locate the matching `item:` line in `proposed.lines` by `(orderPackageId, packageItemId)`. Replace its `refId`, `label`, `unitPrice` from the catalog, recompute totals. Quantity stays from the existing line unless explicitly provided.
- `change_selected_photo_count`: derive the extra-photo billing lines from `selectedPhotoCount` / `includedPhotoCount` / `extraDigitalCount` / `extraPrintCount`. Replace any existing extras line(s) for the target `orderPackageId`. The base snapshot at open-time already captured the baseline extras; the diff-against-base step then produces the correct signed delta automatically.
- `change_package_tier`: behaves identically to today's `swap_package` but keyed by `orderPackageId` so it composes with `upgrade_package_item` cleanly when both are staged.

The signed-deltas array continues to be computed by diffing `proposed.lines` against `base.lines` keyed by `(kind, refId)` per the recent normalization fix.

### 4. ADJ line mapping

In `createWorkspaceAdjustmentInvoice` and `invoiceLineTypeForKind` / `orderEntityKindForLine`:

- `upgrade_package_item` → `InvoiceLineType.PACKAGE_UPGRADE` with `OrderEntityKind.UPGRADE`. Negative leg references the original product; positive leg references the new product.
- `change_selected_photo_count` → `InvoiceLineType.BUNDLE_ADJUSTMENT` with extra-photo entity kind. Sign on the delta follows whether the count grew or shrank.
- `change_package_tier` → `InvoiceLineType.PACKAGE_UPGRADE` with `OrderEntityKind.PACKAGE_TIER_UPGRADE`, same as current `swap_package` mapping.

### 5. Events

Either:
- Reuse `EDIT_MODIFIED` / `EDIT_ADDED` with op type recorded in `payload_json.edit.op` (cheapest), or
- Add explicit `PACKAGE_ITEM_UPGRADED`, `PHOTO_COUNT_CHANGED`, `PACKAGE_TIER_CHANGED` event types.

Default to (a) unless event-stream consumers need to filter at the DB level.

### 6. Tests

- Unit: parser round-trips each new op shape; mixed old/new payload parses cleanly.
- Unit: `computeWorkspaceProposal` produces correct `proposed.lines` for each new op individually.
- Unit: `computeWorkspaceProposal` produces correct `proposed.lines` for combinations (tier change + item upgrade; tier change + photo count change).
- Unit: signed-delta emission is empty when an op's effect is reverted before finalize (regression for the normalization fix).
- Integration: stage one of each new op → finalize emits exactly one ADJ with correct line items, signs, and `OrderEntityKind`.
- Integration: stage upgrade + tier change + photo count change in one workspace → finalize emits exactly one ADJ.

## Observability Checklist

### Dashboards / Metrics

- No new counters in this phase; metrics for staged-edits land in 83c when the UI actually emits them.

### Rollback Plan

- Code: revert. No schema migration to roll back. Open workspaces with new-op edits persisted in `pending_changes_json` would become unparseable on rollback — drain or cancel them first.
- Data: ADJs emitted via the new ops are valid invoices and remain valid after rollback.

### Customer-Visible Surface

- None. Backend-only phase.

## Post-Implementation

- Update `context/architecture-summary.md` if the new ops change how readers should think about the workspace edit DSL.
- Update `context/progress-tracker.md`.

## Acceptance Criteria

- `AdjustmentWorkspaceEdit` accepts the three new op shapes and continues to accept all existing shapes.
- `applyEdit` persists each new op into `pending_changes_json` and appends an event.
- `computeWorkspaceProposal` produces a correct `proposed.lines` and signed deltas for each new op, individually and in combination.
- `finalizeWorkspace` emits a single ADJ with the correct `InvoiceLineType` and `OrderEntityKind` for each new op.
- Staging then reverting any new op before finalize produces a true no-op (zero ADJ).
- All existing workspace tests continue to pass.
- `npm run build` passes.
- `npm run lint` passes.
