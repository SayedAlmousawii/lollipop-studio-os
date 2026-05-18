# 92 — Session Configurations: Post-Lock Edit Routing

## Goal

Make session-configuration selections editable after the order's final invoice locks, while preserving financial integrity. Routing splits per-configuration on the live `financialBehavior` field:

- **`OPERATIONAL` configurations** (cake theme, shirt size, notes) — edit directly on the locked order, no adjustment invoice. Each mutation writes an audit-log row.
- **`FINANCIAL` configurations** (twins fee, age tier, paid cake, paid t-shirt, surcharges) — must route through the existing **Adjustment Workspace** flow. Finalizing the workspace produces an adjustment invoice (or credit note) whose lines reflect the configuration delta, exactly like other workspace edit ops.

Spec 91 already prepared the selection service to accept `allowPostLock`; spec 92 implements both halves of what that flag must do and turns the Configure Session panel into a dual-mode surface (editable operational rows + read-only financial rows with an "Open Adjustment Workspace" CTA) when the invoice is locked.

## Read First

- `context/feature-specs/88-session-configurations-data-model.md` — snapshot contract; `AuditEntityType.ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION` was added here exactly for this spec.
- `context/feature-specs/91-session-configurations-configure-panel.md` — selection service contract, `allowPostLock` placeholder, panel layout.
- `context/reviews/session-config-plan.md` — owner-stated routing rule:
  > operational-only edits: direct + audit log + no adjustment invoice; financial edits: must go through Adjustment Workspace.
- [src/modules/adjustment-workspace/adjustment-workspace.types.ts:37-75](src/modules/adjustment-workspace/adjustment-workspace.types.ts#L37-L75) — `AdjustmentWorkspaceEdit` discriminated union; spec 92 adds one variant.
- [src/modules/adjustment-workspace/adjustment-workspace.service.ts:381-445](src/modules/adjustment-workspace/adjustment-workspace.service.ts#L381-L445) — `openWorkspace`; reuse as-is.
- [src/modules/adjustment-workspace/adjustment-workspace.service.ts:447-512](src/modules/adjustment-workspace/adjustment-workspace.service.ts#L447-L512) — `applyEdit`; new edit op flows through this.
- [src/modules/adjustment-workspace/adjustment-workspace.service.ts:651-759](src/modules/adjustment-workspace/adjustment-workspace.service.ts#L651-L759) — `finalizeWorkspace`; the adjustment invoice is created here using the proposal returned by `computeWorkspaceProposal`.
- [src/modules/adjustment-workspace/adjustment-workspace.service.ts:761](src/modules/adjustment-workspace/adjustment-workspace.service.ts#L761) — `computeWorkspaceProposal`; needs the new edit op handled.
- [src/modules/session-configurations/session-configuration-selection.service.ts](src/modules/session-configurations/session-configuration-selection.service.ts) — `writeOrderPackageSelections` with the `allowPostLock` flag scaffolded in spec 91.
- [src/modules/session-configurations/session-configuration-pricing.ts](src/modules/session-configurations/session-configuration-pricing.ts) — used by both finalize paths to derive line items for adjustment invoices.
- [prisma/schema.prisma:217-228](prisma/schema.prisma#L217-L228) — `AuditAction` enum; we reuse `ORDER_LOCKED_FIELD_MUTATED` for post-lock operational selection edits.
- [prisma/schema.prisma](prisma/schema.prisma) — `AuditLog` shape (entityType, entityId, action, before, after, context).
- [app/orders/[orderId]/actions.ts](app/orders/[orderId]/actions.ts) — `configureSessionAction`; gains a locked-order branch.

## Rules

- **Single writer module remains.** All inserts/updates/deletes on `OrderPackageSessionConfigurationSelection` stay inside `session-configuration-selection.service.ts`. `writeOrderPackageSelections` remains the public direct-edit entry point, and `applyFinancialSelectionEditFromWorkspace` delegates to the same service-local selection-row mutation helpers for workspace finalization. Nothing outside this service writes the table. Asserted by grep.
- **Operational vs financial split is enforced server-side by `snapshotFinancialBehavior` for existing rows and live `financialBehavior` for newly-added rows.** The decision uses the *live* config for new selections (consistent with the "currently financial" semantics required-gate already uses) and the *snapshot* for edits/deletes of existing rows (consistent with "the row was financial when it landed on the invoice"). If both views disagree for the same configuration in a single submission (e.g. admin flipped operational → financial after the selection was first written), treat it as **financial** for routing — the conservative choice.
- **Post-lock operational direct edits write audit-log rows.** One `AuditLog` row per insert/update/delete, with:
  - `entityType: ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION`
  - `entityId: selection.id`
  - `action: ORDER_LOCKED_FIELD_MUTATED`
  - `before` / `after`: structured payloads with all snapshot columns and the input value (numericValue/textValue/optionId).
  - `context`: `{ orderId, orderPackageId, actorUserId, source: "post_lock_direct" }`.
- **Post-lock financial edits never write `OrderPackageSessionConfigurationSelection` from the direct configure path.** They land as edit ops inside an `AdjustmentWorkspace`. The selection table is touched *only* when the workspace is finalized through the selection service helper, which creates, updates, or deletes the real selection row before adjustment invoice lines are emitted. The adjustment invoice carries `InvoiceLineItem` rows with the post-edit snapshot values and `causeOrderEntityId` linked to that real selection row.
- **No retroactive financial mutation of locked invoices.** Spec 92 never updates `Invoice.totalAmount`, never edits existing `InvoiceLineItem` rows. Adjustment invoices are the only mechanism for post-lock financial movement. This matches the spec-90 rule about no backfill.
- **Required-gate does not re-fire post-lock.** Once an invoice locks, missing required configurations are not blockers anymore — the gate is a precondition for locking, not an ongoing invariant. Removing a required selection post-lock (operational or financial) is allowed by the service; the panel hides "remove" affordances on required rows by convention but the server does not refuse it (avoids deadlocks if admin later flips `required=true`).
- **Permissions:**
  - Operational direct-edit: reuse `PERMISSIONS.ORDER_FINANCIAL_UPDATE` (already used by `writeOrderPackageSelections` and by the Adjustment Workspace). No new permission.
  - Financial path through workspace: reuses the workspace's existing permission gates.
- **No new AuditAction enum value.** `ORDER_LOCKED_FIELD_MUTATED` already exists for exactly this use case (post-lock direct mutations of structured order fields).

## Scope

### In Scope

#### Selection service: `src/modules/session-configurations/session-configuration-selection.service.ts`

- Extend `writeOrderPackageSelections`:
  - Existing `{ allowPostLock?: boolean }` option becomes:
    ```ts
    { allowPostLock?: boolean; postLockAudit?: { actorUserId: string } }
    ```
  - When `allowPostLock === true`:
    1. Verify the order's final invoice is locked. If not locked, this is a misuse — throw `SessionConfigurationSelectionPostLockMisuseError` (defense-in-depth; the action layer should not call with `allowPostLock` against pre-lock orders).
    2. Compute the desired snapshots as today.
    3. Compute the diff against existing rows.
    4. For each diff entry (insert / update / delete), assert `OPERATIONAL` financialBehavior:
       - **insert**: new row's `live config.financialBehavior` must be `OPERATIONAL`.
       - **update**: existing row's `snapshotFinancialBehavior` *and* new live `financialBehavior` must both be `OPERATIONAL` (conservative AND).
       - **delete**: existing row's `snapshotFinancialBehavior` must be `OPERATIONAL`.
       - Any entry violating these throws `SessionConfigurationSelectionFinancialNotAllowedError` with the offending configuration codes. **Nothing is persisted** (transaction rolls back).
    5. Apply the diff (insert/update/delete) exactly as today.
    6. For each applied diff entry, write an `AuditLog` row inside the same transaction using `postLockAudit.actorUserId`.
  - When `allowPostLock !== true` (pre-lock path), behavior is unchanged.
- New exported errors:
  - `SessionConfigurationSelectionPostLockMisuseError`.
  - `SessionConfigurationSelectionFinancialNotAllowedError` — carries `offendingConfigurationCodes: string[]`.

#### Adjustment Workspace: edit op + proposal handling

- `src/modules/adjustment-workspace/adjustment-workspace.types.ts`:
  - Add new variant to `AdjustmentWorkspaceEdit`:
    ```ts
    | {
        id: string;
        op: "change_session_configuration_selection";
        orderPackageId: string;
        configurationId: string;
        desired:
          | null  // remove the selection
          | { kind: "toggle" }
          | { kind: "select"; optionId: string }
          | { kind: "number"; numericValue: number }
          | { kind: "text"; textValue: string }
          | { kind: "counter"; numericValue: number; optionId?: string };
      }
    ```
  - The op is **only valid for configs with `FINANCIAL` behavior**. Operational-config edits should never land here — they go through the direct-edit path.
- `src/modules/adjustment-workspace/adjustment-workspace.schema.ts` — add the Zod variant.
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts`:
  - `applyEdit` accepts the new op via the existing pipeline. No changes inside `applyEdit` itself other than passing the edit through to the proposal builder.
  - `getEffectiveCompositionForInvoice` / base snapshot: extend the captured composition to include current session-configuration selections per order package (snapshot fields + configurationId). This is the "base" the workspace compares against when computing the proposal.
  - `computeWorkspaceProposal`:
    - Apply pending `change_session_configuration_selection` edits to the base's session-config view.
    - For each resulting *net* change (insert / update / delete) of a `FINANCIAL` selection, emit a `deltas` line entry using the same shape as other deltas, with:
      - `lineType: SESSION_CONFIGURATION`
      - `description`: same format as the spec-90 pricing module produces (uses `priceSelections`/`priceSingleSelection` against the post-edit snapshots).
      - `causeOrderEntityKind: SESSION_CONFIGURATION_SELECTION`, `causeOrderEntityId`: existing selection row id when updating/removing, or a synthesized id for inserts (use a stable derived id like `pending:${configurationId}` — the finalize step replaces it with the real selection id created at finalize time; see next bullet).
    - Reject the proposal with a typed error if any pending edit references an `OPERATIONAL` config or an inactive config / option — those must not land in workspace flow.
  - `finalizeWorkspace`:
    - Today this creates an adjustment invoice from the proposal. Extend it so that, for each `change_session_configuration_selection` edit:
      1. **Insert/update** the selection row in `OrderPackageSessionConfigurationSelection` through the selection service's canonical row-mutation helpers (via `writeOrderPackageSelections` with `{ allowPostLock: true, postLockAudit }`? — **no.** Workspace finalize is a privileged path; introduce a sibling service helper `applyFinancialSelectionEditFromWorkspace(tx, ...)` in the selection service module that delegates to the same controlled row writer **without** the operational-only assertion and **without** an audit row, because the workspace creates its own audit trail). The helper still snapshots from live configs/options at finalize time.
      2. The `InvoiceLineItem` rows on the new adjustment invoice carry `causeOrderEntityId = realSelection.id` (no `pending:` placeholders survive).
      3. If `desired === null`, delete the existing selection row. The adjustment invoice still gets a negative line covering the original snapshot delta.
    - The existing audit/event trail on the workspace (workspace events table) is unchanged; selection-row audit-log rows are *not* duplicated when changes come through the workspace.

#### Selection service: workspace helper

- Add `applyFinancialSelectionEditFromWorkspace(tx, { orderPackageId, configurationId, desired }): { selectionId | null }` — exported for the workspace finalize step only. Internally:
  - Loads the live config; throws if not `FINANCIAL` (defense-in-depth — proposal already enforces this).
  - For `desired !== null`: builds the snapshot, then upserts through the service-local selection-row mutation helper.
  - For `desired === null`: deletes through the same service-local row mutation helper if present, no-op otherwise.
  - Does not write `AuditLog` rows (workspace audit is the source of truth here).

#### Server action: `app/orders/[orderId]/actions.ts`

- Extend `configureSessionAction`:
  - Load the order's final invoice lock state and the live financial-behavior of each desired config (one query).
  - If the order is **not locked**: pre-lock path (unchanged).
  - If the order **is locked**:
    - Split the desired set into operational vs financial.
    - If financial set is non-empty, return an action-state error directing the user to the Adjustment Workspace and listing the affected configuration names. The error must include a deep link target (the existing workspace route under `/orders/[orderId]/adjustment-workspace`). The panel uses this to render its CTA.
    - For the operational subset: call `writeOrderPackageSelections(orderPackageId, operationalSelections, actor, { allowPostLock: true, postLockAudit: { actorUserId: actor.id } })`. The diff is computed by the service against existing operational selections only — financial existing selections are untouched.
- Add new dedicated action `applySessionConfigurationWorkspaceEditAction(workspaceId, prev, formData)` that wraps `applyEdit` for the new edit op. The panel's "Open in Adjustment Workspace" CTA opens the workspace page; from within the workspace the user makes the edits (the workspace UI itself is not redesigned in this spec — the new edit op flows through the existing pending-edits pipeline).

#### Adjustment Workspace UI: minimal exposure

- The existing workspace page already renders pending edits. Add the new op's rendering: a row like `Session Configuration: <name> → <new label or "Removed">` with the computed price delta. Place this alongside other edit rows.
- Provide a small **"Add Session Configuration Change"** affordance inside the workspace that opens a sub-panel reusing the shared `SessionConfigurationInputRenderer` for the financial configurations on each order package. (Operational configs are not listed here.)
- Style and placement: match existing workspace edit affordances. No redesign.

#### Panel UI: dual-mode

- `src/components/session-configurations/configure-session-panel.tsx`:
  - Accept a new prop `mode: "draft" | "locked"` derived from the workspace's lock state.
  - In `"locked"` mode:
    - Operational rows: editable as today.
    - Financial rows: read-only display of the current snapshot. Below each financial row (or once at the bottom if any financial rows exist), render an "Edit in Adjustment Workspace" link to `/orders/[orderId]/adjustment-workspace` (open or auto-create on click — the workspace `openWorkspace` is idempotent).
    - Save button only submits the operational diff; if there are no operational changes, disable the button.
  - In `"draft"` mode (current behavior): unchanged.
- `src/modules/orders/order.service.ts` — extend `getPOSWorkspace` per-package output (already extended in spec 91) with a `sessionConfigurationFinancialBehaviorByConfigurationId: Record<string, "OPERATIONAL" | "FINANCIAL">` so the panel can split rows without a second query. Single resolver call already returns the live configs — use them.

#### Tests

- Selection service:
  - Post-lock direct edit on an operational config → row mutated, audit row written with correct entityType/action/payloads. Pre-lock behavior unchanged for the same call without `allowPostLock`.
  - Post-lock direct edit attempting a financial config → `SessionConfigurationSelectionFinancialNotAllowedError`; nothing persisted; no audit row written.
  - Mixed batch (one operational + one financial) → rejected; nothing persisted (asserts atomicity).
  - Conservative-AND check: existing row's `snapshotFinancialBehavior = OPERATIONAL` but live config flipped to `FINANCIAL` → the diff entry treated as financial; rejected.
  - `allowPostLock: true` against a pre-lock order → `SessionConfigurationSelectionPostLockMisuseError`.
- Adjustment Workspace:
  - `applyEdit` accepting `change_session_configuration_selection` for a `FINANCIAL` config → pending edit stored.
  - `applyEdit` rejecting the same op for an `OPERATIONAL` config.
  - `computeWorkspaceProposal` produces a `SESSION_CONFIGURATION` delta line with correct price delta for an insert/update/delete.
  - `finalizeWorkspace` with one session-config edit → adjustment invoice has one `SESSION_CONFIGURATION` `InvoiceLineItem` with `causeOrderEntityId` pointing at the real selection row id; selection row exists in `OrderPackageSessionConfigurationSelection` with up-to-date snapshot.
  - `finalizeWorkspace` for a `desired = null` (removal) → existing selection row deleted; adjustment invoice carries a negative-delta `SESSION_CONFIGURATION` line.
- Action layer:
  - `configureSessionAction` against a locked order with only operational edits → direct path succeeds.
  - Same action against a locked order with a financial edit in the desired set → returns an action-state error pointing at the Adjustment Workspace with the affected config names.
- Panel:
  - `"locked"` mode renders financial rows as read-only and shows the CTA.

### Out of Scope

- Customer-facing invoice/receipt UI changes for session-config lines on adjustment invoices — spec 93 covers presentation.
- Reporting / commission integration.
- Bulk financial edits via the workspace beyond the single new edit op.
- A new "session configurations" tab inside the Adjustment Workspace UI. The new affordance is a small additive panel; reorganizing the workspace UI is out of scope.
- Re-opening a finalized workspace specifically to revisit a session-config edit — same lifecycle as existing edit ops.
- Backfilling audit rows for pre-spec-92 post-lock direct edits (there shouldn't be any; spec 91 prevented them via `SessionConfigurationSelectionLockedError`).

## Implementation Direction

### 1. Selection service post-lock branch

Land the service changes (post-lock OPERATIONAL-only assertion + audit-log write + `applyFinancialSelectionEditFromWorkspace` helper) with their tests before touching the workspace or action layer. Both downstream layers depend on this contract.

### 2. Adjustment Workspace edit op

Add the new variant to the type, schema, and proposal computation. `applyEdit` already routes by op kind via the discriminated union — extending it is mechanical. `computeWorkspaceProposal` is where the bulk of the logic lands: read the pending edits, apply them to a copy of the base composition's selection slice, run `priceSelections` against the post-edit set, diff against the base's session-config delta total, and emit per-edit delta entries.

### 3. Finalize integration

Inside `finalizeWorkspace`, **before** creating the adjustment invoice rows, apply all `change_session_configuration_selection` edits via `applyFinancialSelectionEditFromWorkspace`. The returned real selection ids are then used to fill `causeOrderEntityId` on the corresponding adjustment-invoice line items. This ordering matters: the line items must reference real selection row ids, not pending placeholders.

### 4. Action layer routing

`configureSessionAction` is the dispatch point. Make it explicit:

```text
if !locked:               write(...)
elif locked && all op:    write(..., { allowPostLock: true, postLockAudit })
elif locked && any fin:   return { errors: { _global: ["Edit X, Y in Adjustment Workspace..."] }, adjustmentWorkspaceHref }
```

Add `adjustmentWorkspaceHref` to the action's return state so the panel can render a clickable CTA without rebuilding the URL.

### 5. Audit-log payload shape

`before` / `after` carry:

```ts
{
  configurationId, snapshotConfigurationCode, snapshotLabel, snapshotPriceDelta,
  snapshotFinancialBehavior, snapshotInputType, snapshotPricingMode,
  snapshotLinkedProductId, snapshotLinkProductDisplay,
  optionId, numericValue, textValue
}
```

`before` is `null` for inserts; `after` is `null` for deletes. Use `Prisma.Decimal.toString()` for money fields so the JSON column doesn't lose precision.

### 6. Decimal handling

All arithmetic continues through `Prisma.Decimal`. The workspace proposal already uses `AdjustmentMoney` shapes — fit the session-config deltas into that representation, not into raw numbers.

## Observability Checklist

### Dashboards / Metrics

- Counter: `pos.session_configuration_selections.post_lock_direct_edit` per successful operational diff entry written through the post-lock path.
- Counter: `pos.session_configuration_selections.post_lock_financial_block` per `SessionConfigurationSelectionFinancialNotAllowedError` thrown.
- Counter: `adjustment_workspace.session_configuration_edit_applied` per `change_session_configuration_selection` applied via `applyEdit`.
- Counter: `adjustment_workspace.session_configuration_edit_finalized` per such edit landing in a finalized adjustment invoice.
- Discrepancy log: if a finalized workspace would have produced a `SESSION_CONFIGURATION` line whose `causeOrderEntityId` did not resolve to a real selection row, log workspace id + edit id. Catches future regressions in the placeholder-replacement ordering.

### Rollback Plan

- Code-only change. Revert the spec-92 commits to restore the pre-92 behavior:
  - Selection service: `allowPostLock` once again accepts no audit context and rejects any post-lock edit (existing behavior from spec 91).
  - Workspace: rejects the new edit op (it's gone from the union).
- Any adjustment invoices created during the spec-92 window remain valid — they are normal `InvoiceLineItem` rows that downstream code already knows how to display.
- Any audit-log rows written during the window remain in the database; they're harmless on rollback.
- Non-recoverable: post-lock direct edits to operational rows that happened during the window will not be replayable through the post-rollback service — they're already in the DB and rendered correctly, just can't be edited again without spec 92.

### Customer-Visible Surface

- Staff (POS, locked order): the Configure Session button stays visible. Inside, operational rows are editable; financial rows are read-only with a CTA to the Adjustment Workspace.
- Staff (Adjustment Workspace): a new edit row type appears for session-configuration changes; finalizing produces an adjustment invoice with `SESSION_CONFIGURATION` lines.
- Customers: post-lock financial changes surface on adjustment invoices as configuration-labeled lines, matching the spec-90 customer-facing presentation.

## Post-Implementation

- Update `context/architecture-summary.md` to note: post-lock operational edits flow through the selection service's `allowPostLock` path with audit logging; post-lock financial edits flow exclusively through the Adjustment Workspace's new edit op.
- Update `context/progress-tracker.md`.

## Acceptance Criteria

- `writeOrderPackageSelections` with `{ allowPostLock: true, postLockAudit }` writes the operational diff and one `AuditLog` row per mutation. Asserted by test counting `AuditLog` rows for the run.
- The same call with any financial entry in the diff throws `SessionConfigurationSelectionFinancialNotAllowedError` and persists nothing (asserted by row counts before/after).
- `AdjustmentWorkspaceEdit` includes `change_session_configuration_selection`; `applyEdit` accepts it only for `FINANCIAL` configs and rejects it for `OPERATIONAL` configs.
- `computeWorkspaceProposal` produces session-config delta entries whose total equals `priceSelections(postEdit) - priceSelections(base)` for the affected order package.
- `finalizeWorkspace` with one `change_session_configuration_selection` edit creates exactly one `SESSION_CONFIGURATION` `InvoiceLineItem` on the adjustment invoice, with `causeOrderEntityId` resolving to a real row in `OrderPackageSessionConfigurationSelection`. The selection row's snapshot matches the post-edit live values.
- A `desired = null` workspace edit removes the matching selection row and emits a negative `SESSION_CONFIGURATION` line on the adjustment invoice.
- `configureSessionAction` on a locked order with only operational edits succeeds via the direct path; with any financial edit it returns an action-state error containing the configuration names and an `adjustmentWorkspaceHref`.
- The Configure Session panel in `"locked"` mode renders financial rows as read-only with an "Edit in Adjustment Workspace" CTA. Operational rows remain editable.
- A grep for `db.orderPackageSessionConfigurationSelection.(create|update|delete*)` outside `src/modules/session-configurations/session-configuration-selection.service.ts` and `src/modules/development/dev-reset.service.ts` returns zero hits. The new workspace finalize path goes through the new service helper, not direct Prisma.
- `npm run build` passes.
- `npm run lint` passes.
