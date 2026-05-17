# 84c — Adjustment Workspace Layout Reorganization

## Goal

Reorganize the adjustment workspace from its current "Original Composition + Pending Diff + Live Net Delta + scattered POS modules" layout into a unified preview flow. The main area answers a single question: **"After these staged changes, what will the customer own and what will it cost?"** The right sidebar becomes a new `FinancialSidebarAdjustment` orchestrator that shows a pending financial preview — not finalized balance state. Finalize/Issue moves to the sidebar (financial commit action); Cancel/Discard moves to the Pending Adjustment Summary block (workspace-state action). The POS modules (`POSPackageComposition`, `POSPhotoCountCard`, `POSAddOnMarketplace`) remain the mutation surface — only their surrounding framing changes.

## Read First

- `context/feature-specs/84a-post-lock-composition-view.md` — provides `CurrentCompositionCard` in `adjustment` mode.
- `context/feature-specs/84b-locked-sales-financial-sidebar.md` — provides the extracted financial-sidebar primitives.
- `context/feature-specs/83c-adjustment-workspace-pos-mount.md` — the POS-mount baseline this phase builds on. Do not undo its work.
- `context/feature-specs/82-adjustment-workspace.md` — parent workspace spec.
- `app/orders/[orderId]/adjustment-workspace/page.tsx:62-202` — current layout to reorganize.
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts:185-263` — `derivePOSWorkspaceFromAdjustmentWorkspace`, the data source for the preview composition and the POS mounts.
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts:265-313` — `getEffectiveCompositionForInvoice`, the source for the locked base totals.

## Rules

- 83c's hybrid-orchestrator model stands. Mutations still flow through `applyEdit` via the workspace handler adapters. This phase does not change staged-edit semantics, approval consolidation, or finalize behavior.
- Pending Changes list and Live Net Delta concepts are **preserved** — they get a clearer home (the new Pending Changes + Pending Adjustment Summary blocks) and human-readable rendering, not deletion.
- The mutation surface is still `POSPackageComposition` + `POSPhotoCountCard` + `POSAddOnMarketplace`. They are not replaced; they are mounted inside the new layout.
- "Preview Composition" must use the shared `CurrentCompositionCard` from 84a in `adjustment` mode. No bespoke composition rendering on this page.
- The page must never present the adjustment workspace's financial preview as if it were a finalized balance. Copy and visual styling must make "pending" obvious.

## Scope

### In Scope

- **Page reorganization** in `app/orders/[orderId]/adjustment-workspace/page.tsx`:
  - Main area (vertical stack, top to bottom — user edits first, then sees the resulting preview, then the diff and summary):
    1. **Stage Edits (POS mount block)** — keep `POSPackageComposition`, `POSPhotoCountCard`, `POSAddOnMarketplace` mounts ([page.tsx:126-137](app/orders/[orderId]/adjustment-workspace/page.tsx#L126-L137)), framed under a "Stage Edits" header. This is the active surface the operator interacts with.
    2. **Preview Composition** — `<CurrentCompositionCard view={buildCompositionView({ ...proposedComposition, mode: "adjustment" })} />`. Replaces the existing `CompositionPanel` rendering at [page.tsx:120-124](app/orders/[orderId]/adjustment-workspace/page.tsx#L120-L124). Answers "after my edits, what will the customer own?"
    3. **Pending Changes** — replaces the existing "Pending Diff" card ([page.tsx:141-177](app/orders/[orderId]/adjustment-workspace/page.tsx#L141-L177)). Same data (`pending_changes_json` edits) but rendered human-readably: additions, removals, upgrades grouped where possible, using the same 84a-style language ("Album Change: 30×30 → 20×20").
    4. **Pending Adjustment Summary** — replaces the standalone "Live net delta" section ([page.tsx:179-193](app/orders/[orderId]/adjustment-workspace/page.tsx#L179-L193)). Shows: total additions, total reductions, **net adjustment**, approval-required flag, and a **Cancel / Discard staged changes** action.
  - **Ordering rationale.** Stage Edits comes first because the operator's primary task is to make changes; the preview/diff/summary read like a receipt of what they just did. If a future iteration introduces a sticky/compact preview header that stays visible while scrolling, the order may be reconsidered — but in a non-sticky vertical scroll layout, edits-first is more natural than preview-first.
  - Right sidebar:
    - New `FinancialSidebarAdjustment` orchestrator (see §1 below). It carries the financial preview, so the main column is free to lead with the active editing surface.
- **New component `FinancialSidebarAdjustment`** at `src/components/orders/financial-sidebar-adjustment.tsx`:
  1. `Base Locked Total` — the locked parent invoice's current `Customer Total` per 84b's `derivePaymentSummary` (parent invoice + already-finalized adjustments), **excluding any staged edits in this workspace**. Sourced live on render — not a snapshot from workspace-open time — so that a finalized adjustment or correction on the parent that lands while the workspace is open is reflected here.
  2. `Pending Additions` — sum of positive line deltas across staged edits.
  3. `Pending Reductions` — sum of negative line deltas (display as signed value).
  4. `Pending Net Adjustment` — additions + reductions. Reuses the existing live-net-delta computation. Prominent.
  5. `Approval Status` — required / not required, derived from the existing reductive-edit logic.
  6. `Parent / Final Invoice Reference` — chip linking to the parent final invoice (reuse the chip pattern from 84b's Linked Financial Documents).
  7. **Finalize / Issue Adjustment** primary action — the existing finalize form action, relocated here. Approval-required + zero-net guards stay.
  - **Financial math source-of-truth.** All amounts in this sidebar come from the canonical settlement helper (for `Base Locked Total`) and from `computeWorkspaceProposal` (for additions/reductions/net) — never from 84a's `CompositionView`. The view model is display-only.
  - Visual styling must signal "preview / not finalized" — outline or muted background, header copy "Pending Adjustment Preview".
  - Uses primitives extracted in 84b (`MoneyRow`, `formatKD`, document chip).
- **Pending Changes rendering helper** — new module `src/modules/adjustment-workspace/pending-changes-view.ts` exporting `buildPendingChangesView(edits: AdjustmentWorkspaceEdit[]): PendingChangeRow[]`. Mirrors the same grouping spirit as 84a's `buildCompositionView` but operates on staged edits, not composition lines. Pure, unit-tested.
- **Cancel / Discard action** — wires the existing cancel-workspace server action to a button in the Pending Adjustment Summary block. Confirms via the existing confirmation pattern.
- Tests:
  - Render: page renders the four-section main column in order plus the new sidebar.
  - Functional: stage an edit via POS → Pending Changes block reflects it human-readably; Preview Composition reflects it; sidebar's Pending Net Adjustment updates.
  - Functional: Finalize from the sidebar produces the same ADJ as before (regression against 83c fixtures).
  - Functional: Cancel/Discard from the summary block clears `pending_changes_json` and closes the workspace.
  - Render: a workspace with a same-category swap edit shows one human-readable row in Pending Changes (no raw negative line).

### Out of Scope

- Any change to `applyEdit`, the staged-edit DSL from 83a, or the POS handler adapters from 83c.
- Any change to ADJ document emission at finalize.
- Approval flow itself — reductive-edit approval modal and consolidation rules from 83c stand unchanged.
- Payment posting from inside the adjustment workspace — still not supported here.
- Pre-lock sales page and locked sales page surfaces (locked is 84b's territory).
- Deliverables section (deferred follow-up spec).
- New refund/credit flows.

## Implementation Direction

### 1. `FinancialSidebarAdjustment` data inputs

Inputs:
- Workspace (with `pending_changes_json`, `parentInvoiceId`).
- Parent locked invoice + its **currently-finalized** adjustments (for `Base Locked Total`) — read live at render time. Do not source from `workspace.baseSnapshot` for this number; the snapshot is for staged-edit derivation, not for the financial display baseline.
- Live computed proposal (`computeWorkspaceProposal` result) for additions/reductions/net.
- Approval flag from the existing reductive-edit detection.

Build a small server-side helper `derivePendingAdjustmentPreview(workspaceId)` that returns the fully-shaped sidebar view-model: `{ baseLockedTotal, pendingAdditions, pendingReductions, pendingNet, approvalRequired, parentInvoice: { id, number, status } }`. Keep computation in the service module next to `computeWorkspaceProposal`, not in the component. Internally, `baseLockedTotal` calls 84b's `derivePaymentSummary` against the parent invoice + its finalized adjustments (live) — it does not read a stale snapshot.

### 2. Pending Changes rendering

`buildPendingChangesView` turns the array of `AdjustmentWorkspaceEdit` ops into `PendingChangeRow[]` for display. Reuse the same conservative grouping spirit as 84a: pair a removal + addition of the same package item category into one "X Change: A → B" row, otherwise emit a clean additive or reductive row with explicit label. Never emit raw internal op names ("change_package_tier") in the rendered string — render the business-facing wording.

Unit-test against fixtures matching the ops introduced by 83c: package tier change, deliverable upgrade, selected-photo-count delta, marketplace add/remove/qty change.

### 3. Finalize / Cancel placement

- **Finalize** stays the existing server action; only its UI placement moves into `FinancialSidebarAdjustment`. Keep all current guards (approval required, net == 0 → disabled, etc.).
- **Cancel / Discard** is the existing cancel-workspace action moved to the Pending Adjustment Summary block. Add a confirmation step if not already present.

### 4. Implementation order

1. Add `buildPendingChangesView` + unit tests.
2. Add `derivePendingAdjustmentPreview` service helper + unit tests.
3. Build `FinancialSidebarAdjustment` component against the helper.
4. Reorganize the page: insert Preview Composition (using 84a card), keep POS mounts, replace Pending Diff with Pending Changes block, replace Live Net Delta with Pending Adjustment Summary block.
5. Move Finalize into the sidebar; move Cancel into the summary block.
6. Tests + regression run against 83c's finalize fixtures.

## Observability Checklist

### Dashboards / Metrics

- Counter: `adjustment_workspace.finalize.from_sidebar` — confirms the relocated finalize entry point is wired and used.
- Counter: `adjustment_workspace.cancel.from_summary` — confirms Cancel placement.
- Counter: `pending_changes_view.group.<grouped|fallback>` — gauges how often grouping succeeds vs. falls back to plain rows.
- Discrepancy log: if `pendingNet` displayed in the sidebar disagrees with the finalize-action's computed net at submit time, log with `workspaceId`. Indicates stale state.

### Rollback Plan

- Code-only change. Revert this phase's commits to restore the previous adjustment-workspace layout. 83c's POS mounts, staged-edit DSL, and ADJ emission remain unchanged regardless.
- No schema change. Existing open workspaces remain finalizable through the reverted UI.

### Customer-Visible Surface

- Staff: redesigned adjustment workspace — clearer preview-vs-pending separation, Finalize lives in the financial sidebar, Cancel lives in the summary block. Same mutation surface as 83c.
- Customers: no direct change.

## Post-Implementation

- Update `context/ui-context-summary.md` with the new adjustment-workspace layout and the three sidebar orchestrators (`Draft`, `Locked`, `Adjustment`).
- Update `context/architecture-summary.md` with `derivePendingAdjustmentPreview` and `buildPendingChangesView`.
- Update `context/progress-tracker.md`.

## Acceptance Criteria

- The adjustment-workspace main column renders, in order: Stage Edits (POS mount block) → Preview Composition (via 84a card) → Pending Changes → Pending Adjustment Summary.
- The right sidebar is `FinancialSidebarAdjustment` showing Base Locked Total, Pending Additions, Pending Reductions, Pending Net Adjustment, Approval Status, Parent Invoice chip, and the Finalize action.
- `Base Locked Total` is read live from the parent invoice + its finalized adjustments at render time — not from `workspace.baseSnapshot`. A test where a parent-side ADJ finalizes after workspace-open shows the updated `Base Locked Total` on the next render.
- No financial number in this sidebar is computed from 84a's `CompositionView`. Grep for `buildCompositionView`/`CompositionView` in `FinancialSidebarAdjustment` returns zero hits.
- "Preview" framing is visible: header copy "Pending Adjustment Preview" and visual styling distinguishes the sidebar from a finalized balance summary.
- Finalize is reachable only from the sidebar; clicking it produces the same ADJ as 83c's fixture suite (regression-clean).
- Cancel / Discard is reachable from the Pending Adjustment Summary block and successfully clears `pending_changes_json` + closes the workspace.
- Pending Changes rendering: a workspace whose staged edits include a same-category swap shows one human-readable "X Change: A → B (Δ KD)" row, not two raw rows.
- The POS mounts continue to operate as in 83c; staging an edit updates the Preview Composition and the sidebar's Pending Net Adjustment.
- `npm run build` passes.
- `npm run lint` passes.
