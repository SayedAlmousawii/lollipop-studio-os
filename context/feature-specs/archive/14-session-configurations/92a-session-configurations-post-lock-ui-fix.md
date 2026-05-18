# 92a — Session Configurations: Post-Lock UI Wiring Fix

## Goal

Close two UI gaps left by spec 92 that make post-lock session-configuration editing unusable, and broaden the Adjustment Workspace's editor to cover both operational and financial configurations through a single staged-edits surface — placed where the user expects it: **on each package card**, since selections are per-`OrderPackage`.

1. **Locked POS sales page has no path to edit operational configurations.** The locked composition view does not render any configure-session affordance, so operational selections become invisible and uneditable once the invoice locks.

2. **Adjustment Workspace exposes the wrong half of session configurations and stages nothing.** The workspace page reuses `POSPackageComposition` which embeds `ConfigureSessionPanel` in `mode="locked"`. Inside the workspace this surfaces financial as read-only (CTA loops back to the same page) and operational as editable — but submits through `configureSessionAction` → post-lock direct-edit → bypasses the workspace pending-edits pipeline. Result: nothing accumulates, finalize is a no-op, workspace cannot be closed.

   Meanwhile `applySessionConfigurationWorkspaceEditAction` exists at [app/orders/[orderId]/actions.ts:192](app/orders/[orderId]/actions.ts#L192) but **is never called by any component** — grep returns zero UI call sites.

This spec wires both surfaces correctly by:

- **Extending the existing `ConfigureSessionPanel`** with a third `mode` — `"adjustment"` — that lists both operational and financial configs (each labelled) and stages every change as a pending workspace edit. Same component, same package-card placement, mode-based dispatch.
- **Generalizing the workspace edit op** to accept both operational and financial configs. The proposal builder skips invoice-line emission for operational edits; finalize routes per edit (operational → direct row + audit log; financial → row + adjustment-invoice line).
- **Bringing the Configure Session button back to each package card** on the locked POS and the workspace pages, so multi-package orders show one button per package — same UX as pre-lock.

The locked POS path keeps its operational direct-edit fast lane (no workspace open/close needed for a simple cake-theme typo). The workspace is the heavier path that batches and produces a proper adjustment invoice.

## Read First

- `context/feature-specs/92-session-configurations-post-lock-routing.md` — routing contract; service layer is mostly preserved with one generalization (workspace edit op accepts operational configs too).
- [app/orders/[orderId]/sales/page.tsx:47-95](app/orders/[orderId]/sales/page.tsx#L47-L95) — locked branch rendering `LockedCompositionView` without any configure-session surface.
- [app/orders/[orderId]/adjustment-workspace/page.tsx:131-156](app/orders/[orderId]/adjustment-workspace/page.tsx#L131-L156) — embeds `POSPackageComposition` inside the workspace.
- [src/components/orders/pos-package-composition.tsx:62-110](src/components/orders/pos-package-composition.tsx#L62-L110) — where `ConfigureSessionPanel` is mounted per package card.
- [src/components/session-configurations/configure-session-panel.tsx](src/components/session-configurations/configure-session-panel.tsx) — the panel to extend. Today: `mode: "draft" | "locked"`. After this spec: `mode: "draft" | "locked" | "adjustment"`.
- [app/orders/[orderId]/actions.ts:192](app/orders/[orderId]/actions.ts#L192) — `applySessionConfigurationWorkspaceEditAction`, the existing-but-unused staging action.
- [src/modules/adjustment-workspace/adjustment-workspace.service.ts:447-512](src/modules/adjustment-workspace/adjustment-workspace.service.ts#L447-L512) — `applyEdit`; remove the operational-config rejection.
- [src/modules/adjustment-workspace/adjustment-workspace.service.ts:1425-1454](src/modules/adjustment-workspace/adjustment-workspace.service.ts#L1425-L1454) — `finalizeSessionConfigurationSelectionEdits`; generalize routing per edit.
- [src/modules/adjustment-workspace/pending-changes-view.ts](src/modules/adjustment-workspace/pending-changes-view.ts) — proposal diff; branch invoice-line emission on `financialBehavior`.
- [src/modules/session-configurations/session-configuration-selection.service.ts](src/modules/session-configurations/session-configuration-selection.service.ts) — `applyFinancialSelectionEditFromWorkspace` (rename + generalize).

## Rules

- **One panel component, three modes.** `ConfigureSessionPanel` is the single home for all configure-session UI. The mode prop determines:
  - **`"draft"`** (pre-lock): both kinds editable, submits to `configureSessionAction`.
  - **`"locked"`** (locked POS): operational editable, financial read-only with a workspace CTA, submits to `configureSessionAction` (which routes to the post-lock operational direct-edit path).
  - **`"adjustment"`** (inside Adjustment Workspace): both kinds editable with a financial-behavior pill per row, submits to `applySessionConfigurationWorkspaceEditAction` sequentially with the workspace version.
  The dispatch lives in `mode`; the import lives in the parent page. There is no route detection inside the panel.
- **One button per package card, always.** The Configure Session button is mounted by `POSPackageComposition` per package line in all three states (draft / locked / adjustment). Multi-package orders show one button per package. No separate "Session Settings" section below; no sidecars.
- **Workspace UI stages, never writes directly.** Any session-configuration change initiated from `/orders/[orderId]/adjustment-workspace` goes through `applySessionConfigurationWorkspaceEditAction` → `applyEdit` → workspace pending-edits pipeline. Calls to `configureSessionAction` from the workspace page are forbidden. Asserted by grep on the panel's import set when `mode === "adjustment"`.
- **Locked POS direct-edits operational only.** Financial edits never go through `configureSessionAction` post-lock — the service still throws `SessionConfigurationSelectionFinancialNotAllowedError` for that path. The locked panel pre-filters financial rows out of the submission so the error is never reached from the UI.
- **Operational edits never produce invoice lines** regardless of which surface initiates them. The proposal builder skips emitting `SESSION_CONFIGURATION` delta lines for operational configs even if a future operational config carries a non-zero `priceDelta`. Operational and financial are categorically different at the invoice surface.
- **Finalize-time audit for workspace operational edits.** When finalize applies an operational session-configuration edit, it writes one `AuditLog` row with the same payload shape as the locked-POS direct path, but `context.source = "post_lock_workspace"`.
- **Single-writer module preserved.** All inserts/updates/deletes on `OrderPackageSessionConfigurationSelection` stay inside `session-configuration-selection.service.ts`. Grep-asserted.
- **Additive service changes only.** Don't rewrite spec-92 service internals; broaden the workspace edit op + finalize helper, branch the proposal builder. Leave unrelated workspace logic alone.

## Scope

### In Scope

#### Service layer (additive generalizations)

- **`applyEdit`** ([adjustment-workspace.service.ts:447-512](src/modules/adjustment-workspace/adjustment-workspace.service.ts#L447-L512)):
  - Remove the rejection of `change_session_configuration_selection` ops whose target config is `OPERATIONAL`. The op now accepts any active session configuration for the order package's session type.
  - Return the post-apply workspace version so callers can chain successive applies.
- **Pending-changes proposal** ([pending-changes-view.ts](src/modules/adjustment-workspace/pending-changes-view.ts)):
  - Branch on the target config's live `financialBehavior` when translating the pending edit into proposal deltas:
    - `FINANCIAL` → existing behavior (`SESSION_CONFIGURATION` delta line with `priceSelections`-derived totals).
    - `OPERATIONAL` → no delta line; zero contribution to `netPayableDelta`, `grossDelta`, `discountDelta`.
- **Finalize helper** ([session-configuration-selection.service.ts](src/modules/session-configurations/session-configuration-selection.service.ts)):
  - Rename `applyFinancialSelectionEditFromWorkspace` → `applySessionConfigurationEditFromWorkspace`.
  - Drop the assertion that the target config is `FINANCIAL`. Accept any active session configuration.
  - Accept an `audit: { actorUserId: string }` parameter (required, not optional — finalize always has actor context).
  - After applying the row mutation:
    - If live config `financialBehavior === OPERATIONAL`: write one `AuditLog` row (`entityType = ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION`, `action = ORDER_LOCKED_FIELD_MUTATED`, `context.source = "post_lock_workspace"`, `before`/`after` payloads in the existing shape).
    - If `FINANCIAL`: no audit row (workspace events trail is the source of truth).
- **Finalize step** ([adjustment-workspace.service.ts:1425-1454](src/modules/adjustment-workspace/adjustment-workspace.service.ts#L1425-L1454)):
  - Renamed accordingly, passes the workspace actor context to each `applySessionConfigurationEditFromWorkspace` call.
  - The placeholder→real-id remap only operates on financial edits (operational edits emit no invoice line and need no placeholder).

#### Panel: extend `ConfigureSessionPanel`

- **Breaking API change to `ConfigureSessionPanel`:** today `mode` is `"draft" | "locked"` (a bare string); after this spec it is a discriminated union. Every caller of `ConfigureSessionPanel` (today: `POSPackageComposition` only) must be updated. List the call sites in the PR description so reviewers can verify the migration is complete.
- Add `"adjustment"` to the `mode` discriminator:
  ```ts
  mode:
    | { kind: "draft" }
    | { kind: "locked"; workspaceIsOpen: boolean }
    | { kind: "adjustment"; workspaceId: string; workspaceVersion: number; pendingOverlay: PendingOverlay }
  ```
  - `workspaceIsOpen` (in locked mode) drives the "An Adjustment Workspace is open — edit configurations there." hint and disables the save button. See the locked-POS mutual-exclusion rule.
  - `pendingOverlay` is a map `configurationId → SelectionInput | null` representing pending workspace edits already staged for this package. Merges over the baseline at init so the user sees their in-progress state.
- Rendering by mode:
  - `"draft"`: unchanged.
  - `"locked"`: unchanged. Filters to operational, submits to `configureSessionAction`. Footer link to workspace if any financial configs exist.
  - `"adjustment"`: shows **both** operational and financial configs. Each row carries a small visual pill:
    - **"Operational — no invoice change"** (subdued color).
    - **"Financial — adjustment invoice"** (accent color).
  - All rows editable through the shared `<SessionConfigurationInputRenderer mode="edit" ... />`.
- Submit handling in `"adjustment"` mode:
  - For each row whose desired state differs from baseline + pending-overlay, call `applySessionConfigurationWorkspaceEditAction(workspaceId, currentVersion, { op: "change_session_configuration_selection", orderPackageId, configurationId, desired })`.
  - Calls are sequential to respect optimistic-concurrency. The action returns the new version; thread it into the next call.
  - On a version-mismatch error, abort the remaining calls and surface "Workspace was updated — refresh and try again."
- No conditional rendering on parent route. The parent passes the mode explicitly.

#### POSPackageComposition: thread the configure-panel mode

- Add a prop `configurePanelMode?: "auto" | "adjustment"` (default `"auto"`).
- When `"auto"`: derive mode from `workspace.invoice?.isLocked` as today (`locked` if locked, `draft` if not).
- When `"adjustment"`: pass `{ kind: "adjustment", workspaceId, workspaceVersion, pendingOverlay }` to each per-package `ConfigureSessionPanel`. The composition takes `workspaceId`, `workspaceVersion`, and a per-`orderPackageId` `pendingOverlay` map as additional props in this mode.
- The button stays on the package card in all modes.

#### Pre-lock sales page

- No changes. `POSPackageComposition` defaults to `"auto"` → `"draft"` mode on each package card.

#### Locked POS sales page

- Edit [app/orders/[orderId]/sales/page.tsx](app/orders/[orderId]/sales/page.tsx) so the locked branch still renders the per-package configure surface.
- **Do NOT mount full `POSPackageComposition` on the locked sales page.** Verification of the current code shows `POSPackageComposition` only renders an informational banner when `locked` is true — its underlying edit affordances (Upgrade Package, photo count, etc.) do not self-disable in a way that would be safe on a locked-invoice page. `LockedCompositionView` is deliberately the surface here because it renders the **effective post-adjustment composition** (different data shape than `workspace.packageLines`).
- Approach: keep `LockedCompositionView` as the read-only composition surface. Embed a per-package `ConfigureSessionPanel` button **inside each package line that `LockedCompositionView` renders**. The button reads its `availableConfigurations`, `currentSelections`, and missing-required state from `workspace.packageLines[i]` (already on the page via `getPOSWorkspace`); thread these into `LockedCompositionView` as additional per-line props so the lookup is by `orderPackageId`.
- The button uses `mode = { kind: "locked" }`. Operational rows editable; financial rows read-only with a per-card workspace CTA if applicable.
- **Workspace-open mutual exclusion (safety):** the locked sales page already loads `openWorkspace` via `getOpenWorkspaceForInvoice`. When an open workspace exists for this invoice, **disable** the locked POS `ConfigureSessionPanel` buttons and replace them with a hint: "An Adjustment Workspace is open — edit configurations there." This prevents a silent overwrite where one staff member direct-edits an operational config while another stages the same edit in the workspace (workspace finalize would overwrite the direct edit with stale `before` state). The button re-enables once the workspace is finalized or cancelled.

#### Adjustment Workspace page

- Edit [app/orders/[orderId]/adjustment-workspace/page.tsx](app/orders/[orderId]/adjustment-workspace/page.tsx):
  - Continue rendering `POSPackageComposition` as today.
  - Pass `configurePanelMode="adjustment"` along with `workspaceId={workspace.id}`, `workspaceVersion={workspace.version}`, and a `pendingOverlay` map per `orderPackageId`.
- Remove any code path that produced the dead-end "Edit in Adjustment Workspace" CTA from inside the workspace (the panel's `"adjustment"` mode never renders that CTA).

#### Workspace data: pending-edit overlay

- Extend the workspace view loader feeding `adjustment-workspace/page.tsx` to compute, per `OrderPackage`, a `pendingOverlay` map: each pending `change_session_configuration_selection` edit's `desired` payload keyed by `configurationId`.
- Pending edits already live in `pendingChangesJson` on the workspace row. Project them into the per-package map at view-build time and add the map to the page's data shape.

#### Action layer

- `applySessionConfigurationWorkspaceEditAction`:
  - Return `{ errors?, version?: number }` (was void/minimal). Pull the post-apply version from `applyEdit`'s return value.
  - Derive a fresh `edit.id` server-side (cuid). Do not trust client-provided ids.
- `configureSessionAction`:
  - Behavior unchanged. The locked panel pre-filters to operational, so its existing financial-rejection branch should never be reached from the new UI.

#### Tests

- **Spec-92 tests that must flip** (not just "new tests added"):
  - The existing test asserting `applyEdit` rejects `change_session_configuration_selection` for an operational config must be **flipped** to assert acceptance. The behavior changes by design.
  - The existing test for `applyFinancialSelectionEditFromWorkspace` throwing on an operational config must be **flipped** under the renamed helper `applySessionConfigurationEditFromWorkspace` to assert it accepts operational and writes the row + audit log.
  - Tests asserting `SessionConfigurationSelectionFinancialNotAllowedError` for workspace-finalize paths must be removed; the same error is **retained for the locked-POS direct path only** and its dedicated test stays.
- Service: workspace edit op accepts both operational and financial; existing financial test stays green; new operational-accept test added.
- Service: proposal produces zero deltas for an operational pending edit; produces the expected `SESSION_CONFIGURATION` delta line for a financial pending edit.
- Service: finalize with one operational + one financial pending edit produces an adjustment invoice with exactly one `SESSION_CONFIGURATION` line (financial), writes both selection rows with current snapshots, writes exactly one `AuditLog` row (`context.source = "post_lock_workspace"`) for the operational, and moves the workspace to `FINALIZED`. This is the regression test for the user's "can't finalize" report.
- Service: locked-POS direct path unchanged — `writeOrderPackageSelections({ allowPostLock: true })` still rejects financial configs.
- Panel: `mode = "adjustment"` lists both operational and financial rows with the financial-behavior pill; saving creates exactly one pending edit in `pendingChangesJson` per modified row; no `OrderPackageSessionConfigurationSelection` mutation.
- Panel: `mode = "adjustment"` initial state reflects the pending overlay (modify a row, reopen the panel, see the modified state, not the baseline).
- Locked POS: package card renders `ConfigureSessionPanel` button per package; saving an operational edit writes the row + audit log (`source: "post_lock_direct"`).
- Pre-lock POS regression: package card renders `ConfigureSessionPanel` in `"draft"` mode with both kinds editable, behavior unchanged.

### Out of Scope

- Customer-facing invoice/receipt presentation. Spec 93.
- Reorganizing the workspace UI beyond what falls out of passing `configurePanelMode="adjustment"`.
- Backfill or migration.
- Permission changes.
- A unified single-mode panel that auto-detects context — explicit mode prop only.

## Implementation Direction

### 1. One panel, three modes — the import is the dispatch

`ConfigureSessionPanel`'s parent passes `mode` explicitly. There is no introspection of `useRouter()`, `usePathname()`, or any other route signal inside the panel. The same component is imported by all three pages; each page chooses which mode to pass. The wiring grep below ensures dispatch happens at the import site:

- `configureSessionAction` is reachable only when `mode.kind` is `"draft"` or `"locked"`.
- `applySessionConfigurationWorkspaceEditAction` is reachable only when `mode.kind` is `"adjustment"`.

A static review of the panel's source confirms both dispatchers are present but called only in their respective mode branches.

### 2. Why on the package card

Selections are per-`OrderPackage`. A multi-package order has independent config sets per package. Placing the button on each card preserves the natural mapping: the user reads "Newborn — 30 days" on the card header, then clicks "Configure Session" on that card to edit it. A separate "Session Settings" section forces the user to re-establish the package context for each entry.

### 3. Threading `configurePanelMode` through `POSPackageComposition`

`POSPackageComposition` already iterates package lines and renders a `ConfigureSessionPanel` per line. Adding a `configurePanelMode` prop that selects the mode per render is mechanical:

```text
const panelMode =
  configurePanelMode === "adjustment"
    ? { kind: "adjustment", workspaceId, workspaceVersion, pendingOverlay: overlays[line.id] ?? {} }
    : locked
      ? { kind: "locked" }
      : { kind: "draft" };
```

Default `"auto"` preserves all existing call sites unchanged.

### 4. Threading the workspace version

`AdjustmentWorkspace.version` provides optimistic concurrency. `applyEdit` increments it. `applySessionConfigurationWorkspaceEditAction` returns the new version. The panel applies edits sequentially, threading the latest version forward through the loop. Expected edits per save is small.

### 5. Pending overlay merging

The panel initializes its draft state in this order, per row:
1. Baseline: live selection row's snapshot (committed pre-lock state).
2. Pending overlay: any `change_session_configuration_selection` pending edit for this configuration overrides the baseline.

Without the overlay, the panel always shows the committed baseline; the user wouldn't see their own staged work.

### 6. Audit routing recap

| Surface | Selection-row write | Audit row | Invoice line |
|---|---|---|---|
| Pre-lock POS | Yes (direct) | No | No (selection is the source; later finalized) |
| Locked POS, operational | Yes (direct via `allowPostLock`) | Yes, `source = "post_lock_direct"` | No |
| Workspace, operational | Yes (at finalize) | Yes, `source = "post_lock_workspace"` | No |
| Workspace, financial | Yes (at finalize) | No (workspace events trail covers it) | Yes (`SESSION_CONFIGURATION`) |

### 7. Grep proofs (single-writer + wiring invariants)

Preserved from spec 92:
- `db/tx.orderPackageSessionConfigurationSelection.(create|update|delete*)` outside `src/modules/session-configurations/session-configuration-selection.service.ts` and `src/modules/development/dev-reset.service.ts` → zero hits.

New for 92a (wiring assertions, per `feedback_review_user_flows.md`):
- `applySessionConfigurationWorkspaceEditAction` is imported by `ConfigureSessionPanel` (was imported by zero components before this spec).
- `app/orders/[orderId]/adjustment-workspace/page.tsx` passes `configurePanelMode="adjustment"` to `POSPackageComposition`.
- The locked branch of `app/orders/[orderId]/sales/page.tsx` renders at least one `ConfigureSessionPanel` (embedded in `LockedCompositionView`). Zero `ConfigureSessionPanel` instances on a locked sales page is a regression.
- `POSPackageComposition` is NOT rendered by the locked branch of `app/orders/[orderId]/sales/page.tsx` — its edit affordances do not self-disable on lock and mounting it would re-introduce them.

## Observability Checklist

### Dashboards / Metrics

- Counter: `pos.locked.configure_session_panel_rendered` — locked sales page renders the panel.
- Counter: `adjustment_workspace.configure_session_panel_rendered` — workspace page renders the panel.
- Counter: `adjustment_workspace.session_configuration_edit_staged_from_ui` — successful `applySessionConfigurationWorkspaceEditAction` UI call. Distinct from spec-92's existing service-level counter.
- Counter: `adjustment_workspace.session_configuration_edit_operational_finalized` / `..._financial_finalized` — per-kind at finalize. Distinguishes the two routes.

### Rollback Plan

- Code-only change. Reverting restores spec-92 state. No flag, no schema changes, no non-recoverable data.

### Customer-Visible Surface

- Staff (pre-lock POS): unchanged.
- Staff (locked POS): Configure Session button appears on each package line in the locked composition view. Operational configs editable inline; financial configs read-only with a small workspace CTA per card if applicable. When an Adjustment Workspace is open on the order, the button is disabled with an explanatory hint, forcing edits through the workspace to prevent silent overwrites.
- Staff (Adjustment Workspace): Configure Session button on each package card. Both operational and financial editable, each row labelled. Saving stages pending edits; finalize applies everything and closes the workspace.
- Customers: no direct change.

## Post-Implementation

- Update `context/architecture-summary.md`'s session-configuration paragraph to describe the three-mode `ConfigureSessionPanel`, the per-package-card placement, and the finalize-time per-edit routing.
- Update `context/progress-tracker.md`.
- Reproduce the user's original scenario:
  - Locked order with one operational + one financial config.
  - Locked POS page: edit the operational from the package card → row + audit log written; no adjustment invoice.
  - Workspace page: edit both from the package card → both stage as pending; finalize → adjustment invoice with one `SESSION_CONFIGURATION` line + audit log for the operational + workspace closes.

## Acceptance Criteria

- Pre-lock POS sales page renders `ConfigureSessionPanel` on each package card in `mode.kind = "draft"`. Behavior identical to pre-spec.
- Locked POS sales page renders `ConfigureSessionPanel` on each package line in `mode.kind = "locked"`, embedded inside `LockedCompositionView`. `POSPackageComposition` is NOT mounted on the locked branch. Operational rows editable; financial rows read-only with a workspace CTA per card when applicable. Saving an operational edit writes the row + one `AuditLog` row (`context.source = "post_lock_direct"`) and does not create any `AdjustmentWorkspace` row.
- When an open `AdjustmentWorkspace` exists for the order, the locked POS Configure Session save button is disabled and shows the workspace-open hint. Asserted by render test against a fixture with an open workspace.
- Adjustment Workspace page renders `ConfigureSessionPanel` on each package card in `mode.kind = "adjustment"`. Both operational and financial rows editable with a visible pill distinguishing them. Saving any edit creates exactly one pending edit in `AdjustmentWorkspace.pendingChangesJson` per modified row and does not create, update, or delete any `OrderPackageSessionConfigurationSelection` row. Asserted by direct DB query.
- The Adjustment Workspace page does not render a dead-end "Edit in Adjustment Workspace" CTA.
- An operational `change_session_configuration_selection` pending edit contributes zero to the proposal's `netPayableDelta`, `grossDelta`, and `discountDelta`.
- Finalizing a workspace with one operational + one financial pending edit produces an adjustment invoice with exactly one `SESSION_CONFIGURATION` `InvoiceLineItem` (financial), writes both selection rows with up-to-date snapshots, writes exactly one `AuditLog` row (`context.source = "post_lock_workspace"`) for the operational mutation, and moves the workspace to `FINALIZED`.
- `writeOrderPackageSelections({ allowPostLock: true })` still throws `SessionConfigurationSelectionFinancialNotAllowedError` when the desired set contains any financial config.
- Multi-package order: the workspace page shows one `ConfigureSessionPanel` button per package card. Editing configs on package A does not affect package B's pending edits or baselines.
- Grep: `applySessionConfigurationWorkspaceEditAction` is imported by `ConfigureSessionPanel` (was imported by zero components before this spec).
- Grep: `app/orders/[orderId]/adjustment-workspace/page.tsx` passes `configurePanelMode="adjustment"` to `POSPackageComposition`.
- Grep: `db/tx.orderPackageSessionConfigurationSelection.(create|update|delete*)` outside the selection service module and the dev-reset module → zero hits.
- `npm run build` passes.
- `npm run lint` passes.
