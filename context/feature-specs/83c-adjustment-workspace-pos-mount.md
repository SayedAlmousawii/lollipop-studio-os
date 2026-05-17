# 83c — Adjustment Workspace: Mount POS Modules

## Goal

Wire the Adjustment Workspace UI to the handler-agnostic POS modules from 83b, using the staged-edit ops from 83a. After this phase, post-lock staff editing has full operational parity with the unlocked sales page: same package composition module, same deliverable upgrade/replace, same selected-photo-count editing with extra-photo billing, same add-on marketplace — differing only in that mutations stage into `pending_changes_json` and consolidate into one ADJ at finalize. The generic `AddLineForm` / `SwapPackageForm` / per-row qty forms on the workspace page are removed.

## Read First

- `context/feature-specs/82-adjustment-workspace.md` — parent spec, especially §6 UI surfaces.
- `context/feature-specs/83a-adjustment-workspace-edit-dsl.md` — the edit DSL this phase emits into.
- `context/feature-specs/83b-pos-components-handler-agnostic.md` — the components this phase mounts.
- `app/orders/[orderId]/adjustment-workspace/page.tsx` — workspace page to rewire.
- `app/orders/[orderId]/adjustment-workspace/actions.ts` — workspace server actions to extend.
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts` — `applyEdit`, snapshot capture; this phase adds the `derivePOSWorkspaceFromAdjustmentWorkspace` helper.

## Rules

- The hybrid-orchestrator decision from Feature 82 stands. The workspace page remains a distinct surface with its own state container; it just mounts the POS modules.
- The diff panel, advisory chip, finalize, cancel, take-over controls remain workspace-specific and are **not** replaced.
- Approval is consolidated at finalize. Workspace handlers pass `shouldPromptInlineApproval: false`. The `ReductiveEditApprovalModal` must not fire on staged edits.
- Payment posting is **not** added to the workspace surface.
- Every mutation in the workspace UI corresponds to exactly one staged edit appended to `pending_changes_json`.

## Scope

### In Scope

- New server actions in `app/orders/[orderId]/adjustment-workspace/actions.ts`:
  - `stagePackageTierChangeAction`
  - `stagePackageItemUpgradeAction`
  - `stageSelectedPhotoCountChangeAction`
  - Marketplace stage actions wrapping the existing `addWorkspaceLineAction` / `removeWorkspaceEditAction` / `modifyWorkspaceLineQuantityAction` to match the `POSAddOnHandlers` shape.
- New service helper: `derivePOSWorkspaceFromAdjustmentWorkspace(workspaceId)` returning a `POSWorkspace`-shaped view assembled from the workspace's `baseSnapshot` plus the proposed composition after staged edits. Tested in isolation.
- Workspace page rewire (`app/orders/[orderId]/adjustment-workspace/page.tsx`):
  - Replace the generic `AddLineForm`, `SwapPackageForm`, and per-row qty/remove controls with mounts of `POSPackageComposition`, `POSPhotoCountCard`, `POSAddOnMarketplace`.
  - Build the workspace's `POSCompositionHandlers` and `POSAddOnHandlers` adapters that invoke the new stage actions.
  - Keep the original-vs-working composition diff, pending edits list, live net delta, and finalize/cancel/take-over controls.
- Observability: per-op staged-edit counters (`adjustment_workspace.edit.<op>.staged`).
- End-to-end tests: stage each new op via the UI flow → finalize → assert ADJ shape.
- Docs: update `context/ui-context-summary.md`, `context/architecture-summary.md`, `context/progress-tracker.md`.

### Out of Scope

- Any change to 83a's service compute or ADJ emission. If the UI surfaces a case 83a didn't handle, file a follow-up — don't expand 83a's service code from this phase.
- Refactoring POS components further (that's 83b territory; if a defect surfaces in the refactored components, fix in 83b's surface area).
- New workspace orchestrator state machines. The page remains server-rendered with form actions and revalidation, matching the existing workspace surface style.
- Payment posting; discount or tax edits; pre-lock POS changes.

## Implementation Direction

### 1. `derivePOSWorkspaceFromAdjustmentWorkspace`

New helper on `adjustment-workspace.service.ts`. Inputs: workspace ID. Output: a `POSWorkspace` shape ready to feed the POS components.

Approach:
- Load the workspace + its base snapshot + pending changes.
- Run `computeWorkspaceProposal` to get `proposed.lines`.
- Load the parent order's `POSWorkspace` (via `getPOSWorkspace`) for metadata not in the snapshot — `productOptions`, session type, included photo counts, package metadata, etc.
- Merge: replace the order's package lines, photo counts, add-ons with the workspace-proposed equivalents. Mark `invoice.isLocked = true` so the components render their locked affordances.

Keep it pure-ish — the helper is read-only and the merge is data-only. The POS components remain unaware they're being driven by a workspace.

### 2. Workspace handler adapters

In the workspace page (or a co-located adapter module), construct:

```ts
const compositionHandlers: POSCompositionHandlers = {
  changePackageTier: (input) =>
    callStageAction(stagePackageTierChangeAction, orderId, workspaceId, version, input),
  upgradePackageItem: (input) =>
    callStageAction(stagePackageItemUpgradeAction, orderId, workspaceId, version, input),
  changeSelectedPhotoCount: (input) =>
    callStageAction(stageSelectedPhotoCountChangeAction, orderId, workspaceId, version, input),
  shouldPromptInlineApproval: false,
};

const addOnHandlers: POSAddOnHandlers = {
  addAddOn: (input) => callStageAction(addWorkspaceLineAction, /* … */),
  removeAddOn: (input) => callStageAction(removeWorkspaceLineAction, /* … */),
  changeAddOnQuantity: (input) => callStageAction(modifyWorkspaceLineQuantityAction, /* … */),
};
```

Each stage action constructs an `AdjustmentWorkspaceEdit` from the typed payload and calls `applyEdit`. The optimistic-lock `version` flows through. On success, the page revalidates and re-renders with the new derived `POSWorkspace`.

### 3. Page rewire

Replace the right column of [adjustment-workspace/page.tsx](app/orders/[orderId]/adjustment-workspace/page.tsx) — currently `CompositionRows` + `AddLineForm` + `SwapPackageForm` — with:

```tsx
<POSPackageComposition workspace={derivedPOSWorkspace} handlers={compositionHandlers} />
<POSPhotoCountCard      workspace={derivedPOSWorkspace} handlers={compositionHandlers} />
<POSAddOnMarketplace    workspace={derivedPOSWorkspace} handlers={addOnHandlers} />
```

The left column (frozen base composition), the pending edits list, the live net delta, and the finalize controls all stay. The `Original Composition` panel continues to render `workspace.baseSnapshot.lines` directly — no POS module needed there.

### 4. Tests

- Integration: stage a package tier change via the UI flow → assert `pending_changes_json` contains a `change_package_tier` edit and proposed composition reflects it.
- Integration: stage a deliverable upgrade → finalize → assert ADJ contains `PACKAGE_UPGRADE` lines with the correct signs.
- Integration: stage a selected-photo-count increase, then decrease back to baseline → finalize is a true no-op (regression for the normalization fix shipping ahead of 83).
- Integration: stage a marketplace add-on add, then remove the same add-on → no ADJ on finalize.
- Integration: a reductive staged edit does **not** open `ReductiveEditApprovalModal` — approval is consolidated at finalize.
- Snapshot/render: `derivePOSWorkspaceFromAdjustmentWorkspace` produces a `POSWorkspace` whose rendered DOM in `POSPackageComposition` matches the sales page's DOM for an equivalent unlocked order, except for the `Locked` affordances.

### 5. Implementation order

1. `derivePOSWorkspaceFromAdjustmentWorkspace` helper + unit tests.
2. New stage actions wired to `applyEdit`.
3. Workspace handler adapters + page rewire — one POS module at a time:
   - `POSAddOnMarketplace` first (lowest risk, ops already exist).
   - `POSPhotoCountCard` next.
   - `POSPackageComposition` last (largest surface).
4. End-to-end test pass.
5. Observability counters + docs updates.
6. Remove the now-unused `AddLineForm`, `SwapPackageForm`, generic per-row qty/remove forms from the workspace page.

## Observability Checklist

### Dashboards / Metrics

- Counter: `adjustment_workspace.edit.<op>.staged` for each op type (existing + new).
- Counter: workspace finalizes broken down by which op types were involved.
- Audit log: each new op appears in `AdjustmentWorkspaceEvent.payload_json.edit.op` and is queryable.

### Rollback Plan

- Code: revert this phase's commits. The workspace page returns to the generic forms; 83a (DSL) and 83b (component refactor) remain harmlessly in place. Open workspaces with new-op edits staged before rollback would be unreachable via the reverted UI but parseable; they can be cancelled.
- Data: no schema change. ADJs emitted before rollback remain valid.

### Customer-Visible Surface

- Staff: post-lock editing regains full parity with the unlocked POS page. Training note: workflow inside the workspace is identical to POS; the difference is the explicit Finalize step that bundles changes into one ADJ.
- Customers: no direct change.

## Post-Implementation

- Update `context/ui-context-summary.md` to note that the adjustment workspace mounts the same POS modules.
- Update `context/architecture-summary.md` to describe `derivePOSWorkspaceFromAdjustmentWorkspace` and the staged-vs-commit-through distinction enforced by handler adapters.
- Update `context/progress-tracker.md`.

## Acceptance Criteria

- The workspace page mounts `POSPackageComposition`, `POSPhotoCountCard`, and `POSAddOnMarketplace` directly — no duplicated UI.
- Staff can stage from the workspace: package tier change, deliverable upgrade/replace, selected photo count change, and marketplace add/remove/qty.
- The unlocked sales page is visually and behaviorally unchanged.
- The `ReductiveEditApprovalModal` does not fire on staged reductive edits inside the workspace.
- Finalizing a workspace with N mixed staged edits produces **exactly one** ADJ document.
- Staging then reverting any op before finalize is a true no-op.
- The generic `AddLineForm`, `SwapPackageForm`, and per-row qty/remove forms are removed from the workspace page.
- `npm run build` passes.
- `npm run lint` passes.
