## Goal

Route session-configuration selections through the `OrderCommitDraft` → preview → commit pipeline on the unified Sales surface, replacing the legacy live write (`writeOrderPackageSelections`) and the per-edit Adjustment Workspace deep-link. This unifies three workflows the investigation classifies as one domain that shares a single UI surface and cannot be split: **operational selections (C)**, **financial-behavior selections (E)**, and **linked-product selections (D)**.

Two approved decisions drive this spec:

- **Financial session-configuration selections stage into the draft** (not deep-link to AW from the Sales surface). On commit, the engine emits the correct financial document by FINAL-invoice lock state (REBUILD_UNLOCKED on an unlocked FINAL, EMIT_ADJUSTMENT on a locked FINAL) exactly as it already does for package/photo changes.
- **Linked-product session configurations must continue to work correctly** — newly staged linked products use a service-assigned `draftOrderAddOnId`; already-materialized linked products use `orderAddOnId`. This discipline already exists in the `SESSION_CONFIGURATION` reducer/staging service and must be preserved end-to-end.

The full backend is already built: the `SESSION_CONFIGURATION` staging schema, `reduceOrderCommitDraftSessionConfiguration`, `resolveStagedSessionConfiguration`, and the materializer (selection writes + `createLinkedAddOn`). The gap is purely UI routing: `ConfigureSessionPanel` still calls `configureSessionAction` (live) or `applySessionConfigurationWorkspaceEditAction` (AW). This spec adds a Sales-surface routing path that stages each changed selection into the draft. It supersedes the Spec 135 hotfix refusal for the Sales surface (the hotfix remains the safety rail for any non-Sales legacy caller until Phase 6).

## Read First

- `/tmp/pos-domain-blocked-workflows-investigation.md` — §1 (#5/#6/#7), §2 (Categories C/D/E), §3 (linked products are the one legitimate package-scoped `OrderAddOn` use), §4 (C/E/D share one UI surface and are atomic), §5 (Spec 137). Source of truth.
- `context/reviews/unified-order-commit-live-pos-roadmap.md` — Phase 4 "Financial emission lifecycle" (REBUILD_UNLOCKED vs EMIT_ADJUSTMENT); Phase 5 canonical-source / projector rules; Spec 131 locked/unlocked unification.
- `context/feature-specs/122-order-commit-draft-staging-reducers.md` — `SESSION_CONFIGURATION` reducer: UPSERT / REMOVE; `parentPackageTarget`; `configurationId`; option/numeric/text value; `draftSelectionId`; `linkedProduct { productId, orderAddOnId | draftOrderAddOnId }`; draft-vs-materialized identity rules.
- `context/feature-specs/135-session-configuration-draft-bypass-hotfix.md` — the refusal this spec supersedes on the Sales surface.
- `src/components/session-configurations/configure-session-panel.tsx` — current panel; `ConfigureSessionPanelMode` (`draft | locked | adjustment`) at `:47`; `submitAdjustmentEdits` per-change loop at `:155` (the version-threading pattern to mirror); `toWorkspaceDesired` at `:381`; financial badge at `:258`; locked AW deep-link at `:304-317`.
- `src/components/orders/pos-package-composition.tsx:149` — where `ConfigureSessionPanel` is mounted and the mode is chosen (`configurePanelMode`, `editPolicies.sessionConfigurationFinancialEdit.shouldOpenAdjustmentWorkspace`).
- `app/orders/[orderId]/sales/page.tsx` — Sales surface; passes `compositionHandlers` and `expectedVersion = salesPageView.draft?.version ?? 0`.
- `app/orders/[orderId]/sales/actions.ts` — `stageSalesChangeAction(orderId, expectedVersion, change)`; the action to forward `SESSION_CONFIGURATION` changes through.
- `src/modules/order-commits/order-commit.service.ts:1225` — `SESSION_CONFIGURATION` staging-service case; `:1561` `resolveStagedSessionConfiguration` (resolves pricing + linked product, assigns draft ids).
- `src/modules/order-commits/order-commit-draft.schema.ts:111` — `orderCommitDraftSessionConfigurationStagingChangeSchema` and its `superRefine` linked-product rules.
- `src/modules/session-configurations/session-configuration-selection.service.ts:251` — legacy `writeOrderPackageSelections`, no longer called from the Sales surface after this spec.

## Rules

- Implementation-only after approval. No schema, no new domain logic. The `SESSION_CONFIGURATION` reducer, staging-service resolver, materializer, and linked-product discipline are reused unchanged.
- On the Sales surface, **every** session-configuration change — operational, financial, and linked-product — stages into the `OrderCommitDraft`. None of them call `writeOrderPackageSelections` or `applySessionConfigurationWorkspaceEditAction`.
- The panel must stage **per changed configuration**, diffing desired vs baseline and emitting one `SESSION_CONFIGURATION` UPSERT (value set) or REMOVE (value cleared) per change, threading the draft `version` across the loop exactly as `submitAdjustmentEdits` threads the workspace version today.
- The UI passes only identity + the selected value (`configurationId`, `orderPackageId` → `parentPackageTarget`, and the option/numeric/text value). The staging service owns pricing resolution, linked-product detection, and `draftOrderAddOnId` / `draftSelectionId` assignment. The UI must **not** construct linked-product ids or compute fees for staging.
- Financial-behavior selections are **not** deep-linked to AW from the Sales surface. The AW deep-link path stays only for the frozen AW route (`configurePanelMode === "adjustment"`), which Phase 6 deletes.
- Locked-FINAL orders use the same staging path (post-Spec-131 the Sales surface is unified). The commit engine decides REBUILD_UNLOCKED vs EMIT_ADJUSTMENT from FINAL lock state; the UI never decides emission mode (projector rule).
- Financial impact of staged session-configuration changes is shown only through the canonical staged-changes rail and `OrderCommitPreview` financial preview. In Sales `commit-staging` mode, financial-behavior selections stage only the selected value; the panel must not compute or display financial impact.
- No `@/lib/db` imports in `app/**` or `src/components/**`. No Adjustment Workspace naming on the Sales surface.

## Scope

### In Scope

- A new Sales-surface routing path for session-configuration staging:
  - Add a `ConfigureSessionPanelMode` variant for OrderCommit staging, e.g. `{ kind: "commit-staging"; orderPackageId; expectedVersion }`, carrying the current draft version.
  - In that mode, the panel diffs desired vs baseline selections and, for each changed configuration, stages a `SESSION_CONFIGURATION` change through a new (or reused) Sales action, threading the returned draft version across the loop (mirror `submitAdjustmentEdits`).
- A Sales action to stage session-configuration changes:
  - Either a thin `stageSessionConfigurationSelectionAction(orderId, expectedVersion, { orderPackageId, configurationId, desired })` that builds the `SESSION_CONFIGURATION` change and forwards through `stageSalesChangeAction`, **or** direct construction of the `SESSION_CONFIGURATION` change in the panel forwarded via `stageSalesChangeAction`. Prefer the dedicated action for testability and to keep change-construction out of the component.
  - The action maps the panel's `SelectionInput` (`toggle | select | number | text | counter`) to the staging change's `optionId` / `numericValue` / `textValue`, and maps "value cleared" to action `REMOVE` with the existing selection's `target`.
- Mount wiring: on the Sales page, `POSPackageComposition` passes the new `commit-staging` mode (with `salesPageView.draft?.version ?? 0`) instead of the auto draft/locked branch. The `auto`/`locked`/`adjustment` modes remain for non-Sales mounts (AW route) until Phase 6.
- Preserve linked-product behavior:
  - Newly staged linked-product selections get a service-assigned `draftOrderAddOnId`; the panel passes no add-on id.
  - Editing/removing an already-materialized linked-product selection forwards its `orderAddOnId` (sourced from the current selection's snapshot), never a `draft:` id (the schema `superRefine` rejects a `draft:` `orderAddOnId`).
- Supersede the hotfix on the Sales surface: confirm the Sales path no longer calls `writeOrderPackageSelections`, so the Spec 135 refusal is never reached from the Sales surface. The hotfix guard stays in place for other callers.
- Tests under `tests/order-commits/sales-page-surface/` and/or `tests/session-configurations/`:
  - Operational selection (C) stages a `SESSION_CONFIGURATION` UPSERT with exact `expectedVersion`; does not call `writeOrderPackageSelections`.
  - Financial selection (E) stages into the draft (not AW); commit on an unlocked FINAL rebuilds in place, commit on a locked FINAL emits ADJUSTMENT (assert at the staging/preview boundary; reuse existing emission tests for the commit half).
  - Linked-product selection (D): new selection stages with a `draftOrderAddOnId`; materialized selection edit/removal forwards `orderAddOnId`; a `draft:` `orderAddOnId` is rejected.
  - Multi-config save threads the draft version across changes and surfaces a stale-version error cleanly (mirror the adjustment-mode error copy).
  - Clearing a selection stages a REMOVE with the correct target.
- Wire new tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md`.

### Out of Scope

- No change to the `SESSION_CONFIGURATION` reducer, staging-service resolver, materializer, pricing engine, or selection schema.
- No change to add-on (Spec 138) or package-item upgrade (Spec 136) staging.
- No removal of `writeOrderPackageSelections`, `configureSessionAction`, or `applySessionConfigurationWorkspaceEditAction` — those remain for the AW route and locked-operational legacy path until Phase 6. (The Sales surface simply stops calling them.)
- No change to the AW adjustment-mode panel behavior (`configurePanelMode === "adjustment"`).
- No new financial behavior. Emission routing is the engine's existing lock-state logic.
- No new schema, table, column, or migration.
- No visual redesign of the panel beyond the mode wiring (Phase 7 owns redesign).

## Implementation Direction

### Task 1 — Sales session-configuration staging action

Add `stageSessionConfigurationSelectionAction(orderId, expectedVersion, input)` in `app/orders/[orderId]/sales/actions.ts` (or extend the staging action surface). It:

- Builds a `SESSION_CONFIGURATION` change: `domain`, `action` (`UPSERT` when a value is present, `REMOVE` when cleared), `parentPackageTarget = packageTarget(orderPackageId)`, `configurationId`, the mapped value field(s), and — for REMOVE/edit of an existing selection — the selection `target`. For materialized linked products, include `linkedProduct.orderAddOnId` from the current selection snapshot; for new ones, omit add-on ids and let the resolver assign `draftOrderAddOnId`.
- Forwards through `stageSalesChangeAction(orderId, expectedVersion, change)`.
- Returns the action state (including the new draft version) so the panel can thread it.

Keep this action a thin orchestrator; the staging service resolves pricing and linked-product identity.

### Task 2 — `commit-staging` panel mode

Add the mode and a `submitCommitStagingEdits` handler mirroring `submitAdjustmentEdits`:

- Iterate `sortedConfigurations`; for each where `selectionKey(desired) !== selectionKey(baseline)`, call the new action with the current `version`, update `version` from the result, and stop on error with the existing stale/permission copy.
- After the loop, revalidate / reload as the adjustment path does.
- Render financial-behavior configs normally (no AW deep-link, no "Edit in Adjustment Workspace" button on this mode). The financial-vs-operational badge may remain as informational context; it must not gate routing.

### Task 3 — Mount wiring on the Sales page

In `POSPackageComposition`, when mounted on the Sales surface, pass `mode = { kind: "commit-staging", workspaceVersion → draft version }` for `ConfigureSessionPanel`, sourcing the version from `salesPageView.draft?.version ?? 0`. Preserve the existing `auto`/`adjustment` mode selection for non-Sales mounts. Ensure the panel key (`configureSessionPanelKey`) incorporates the draft version so it re-renders after each stage.

### Task 4 — Linked-product correctness pass

Trace a new linked-product selection and a materialized one end-to-end:

- New: panel passes value only → resolver assigns `draftSelectionId` + `draftOrderAddOnId` → reducer creates the coupled `LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON` line → materializer `createLinkedAddOn` writes the row and wires `selection.orderAddOnId`.
- Materialized: panel passes `orderAddOnId` from the current snapshot → resolver/reducer update or remove the existing coupled add-on. Assert a `draft:` `orderAddOnId` is rejected by the schema `superRefine`.

### Task 5 — Tests + tracker

Add the focused tests in Scope, wire into the centralization runner, and update the tracker.

## Observability Checklist

### Dashboards / Metrics

- Replace the AW-specific UI metric `adjustment_workspace.session_configuration_edit_staged_from_ui` with a Sales-surface equivalent (e.g. `order_commit.session_configuration_edit_staged_from_sales`) emitted from the new flow. Keep it a structured `console.info` consistent with existing metrics.

### Rollback Plan

- No schema. Rollback = revert the panel mode + action wiring; the legacy `configureSessionAction` path still exists, so reverting restores prior Sales behavior. No data migration. Note: drafts created during the window remain valid OrderCommit drafts.

### Customer-Visible Surface

- On the Sales surface, "Configure Session" edits (including financial ones) now appear in the staged-changes rail and commit with the rest of the order, instead of writing live or bouncing the user to the Adjustment Workspace. Linked-product fees behave identically post-commit.

## Post-Implementation

- `context/progress-tracker.md` — "Now" line: session-configuration staging (operational, financial, linked-product) now routes through OrderCommit on the Sales surface; the legacy live write and AW deep-link are no longer used there.
- Roadmap Phase 5.5 block — mark `SESSION_CONFIGURATION` wired end-to-end; note the AW deep-link is now Sales-dead and is deletable in Phase 6.

## Acceptance Criteria

- All three session-configuration sub-workflows (operational, financial, linked-product) stage into the `OrderCommitDraft` on the Sales surface; none call `writeOrderPackageSelections` or `applySessionConfigurationWorkspaceEditAction`.
- Financial selections stage into the draft and commit via the engine's lock-state routing (REBUILD_UNLOCKED on unlocked FINAL, EMIT_ADJUSTMENT on locked FINAL).
- Linked-product selections work end-to-end: new ones via `draftOrderAddOnId`, materialized ones via `orderAddOnId`; `draft:` `orderAddOnId` is rejected.
- Multi-config save threads the draft version and reports stale-version cleanly.
- The Spec 135 refusal is never reached from the Sales surface; it remains enforced for other callers.
- No reducer, schema, materializer, pricing, or commit behavior changed; the UI computes no authoritative financial values.
- New tests wired into `test:centralization`.
- `npm run test:centralization` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Resolved Decisions

1. **Locked-operational selections:** Locked-order operational session-configuration edits stage into the draft on the unified Sales surface.
2. **Batch vs per-change failure semantics:** Partial-staging-on-error mirrors the existing Adjustment Workspace loop.
3. **Panel mode reuse:** The implementation uses a new explicit `commit-staging` mode so legacy `draft` / `locked` / `adjustment` behavior remains untouched.
