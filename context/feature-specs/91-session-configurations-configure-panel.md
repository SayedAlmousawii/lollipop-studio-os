# 91 — Session Configurations: Employee Configure Session Panel

## Goal

Wire the studio's POS sales page so employees can actually create, edit, and clear session-configuration selections on each `OrderPackage` while an order is still in draft. This is the first spec that **writes** to `order_package_session_configuration_selections`.

Surfaces shipped:
- A **Configure Session** button on each POS package card, opening a modal/sheet.
- A **dynamic panel** inside that modal that renders one row per active configuration for the package's session type, using the shared input renderer from spec 89.
- A **summary chip** on the package card showing current selections + their fee contribution.
- A **missing-required badge** on the package card when any active+required config has no selection.
- A user-facing **error path** when invoice lock is blocked by `SessionConfigurationRequiredSelectionMissingError` (the structured error spec 90 throws — spec 91 makes it actionable).

The selection-writing service introduced here becomes the sole writer of `OrderPackageSessionConfigurationSelection`. Spec 92 (post-lock routing) will call into the same service through a different gate.

## Read First

- `context/feature-specs/88-session-configurations-data-model.md` — snapshot contract this spec must honor on every write.
- `context/feature-specs/89-session-configurations-admin-crud.md` — centralization gates; the shared input renderer.
- `context/feature-specs/90-session-configurations-pricing-engine.md` — resolver + pricing module; this spec consumes both as-is.
- [src/modules/orders/order.types.ts:288-313](src/modules/orders/order.types.ts#L288-L313) — `POSWorkspace` shape; the panel reads from this.
- [src/modules/orders/order.service.ts:309](src/modules/orders/order.service.ts#L309) — `getPOSWorkspace`; needs a small extension to surface resolver state per package.
- [src/modules/session-configurations/session-configuration-resolver.ts](src/modules/session-configurations/session-configuration-resolver.ts) — `resolveOrderSessionConfigurations`; the panel loads from here.
- [src/modules/session-configurations/session-configuration-pricing.ts](src/modules/session-configurations/session-configuration-pricing.ts) — `priceSelections` / `priceSingleSelection`; the chip and panel both call these.
- [src/components/session-configurations/session-configuration-input-renderer.tsx](src/components/session-configurations/session-configuration-input-renderer.tsx) — shared renderer; extend its `mode` to include `"edit"`.
- [src/components/orders/pos-package-composition.tsx:804-860](src/components/orders/pos-package-composition.tsx#L804-L860) — `PackageUpgradeDialog`; the Configure Session button mirrors this affordance and dialog pattern.
- [app/orders/[orderId]/actions.ts](app/orders/[orderId]/actions.ts) — existing pattern for POS server actions and the spec-90 error-throw point that this spec turns into a user-facing message.

## Rules

- **One writer.** All writes to `OrderPackageSessionConfigurationSelection` (insert, update, delete) live in a single new service file `src/modules/session-configurations/session-configuration-selection.service.ts`. Any other code path mutating these rows is a review-blocker. Spec 92's post-lock flow will call this service too — write its API with that future caller in mind.
- **Snapshot on every write.** Every insert and every update fills `snapshotConfigurationCode`, `snapshotLabel`, `snapshotPriceDelta`, `snapshotFinancialBehavior`, `snapshotInputType`, `snapshotPricingMode`, `snapshotLinkedProductId?`, `snapshotLinkProductDisplay?` from the **live** `SessionConfiguration` and (when applicable) `SessionConfigurationOption` rows fetched inside the same transaction. Reading any of these from prior selection rows on update is forbidden — a name change in admin must propagate to the next save.
- **Pre-lock only.** The service throws `SessionConfigurationSelectionLockedError` if the order's primary final invoice has `isLocked = true`. Post-lock editing is spec 92's responsibility. Detection: query the order's final invoice (`InvoiceType.FINAL`) via the existing helper used by the POS sales actions; do not invent a new path.
- **Toggle semantics.** A `TOGGLE` selection is "on" iff a row exists. Removing the toggle deletes the row. Re-toggling on creates a fresh row with current snapshot data. No `isOn` column.
- **Empty inputs = absent selection.** If the panel submits a NUMBER/TEXT/COUNTER row with no value (and the config is not required), the service deletes any existing selection row for that config. This is the natural way to "clear" a non-toggle input.
- **Atomic per-package writes.** The service receives the **full intended selection set** for one `OrderPackage` and performs a transactional diff: insert new, update existing, delete removed. Partial submissions (only the changed rows) are rejected — the panel always sends the whole intended state. This keeps the service simple and the diff verifiable.
- **No price math in the service.** Snapshotting copies `priceDelta` from live definitions/options. Producing line items from snapshots is the pricing module's job (already shipped). Asserting price totals here is a review-blocker.
- **Use the shared renderer.** The Configure Session panel renders each row through `<SessionConfigurationInputRenderer mode="edit" ... />`. No bespoke per-input UI lives in the panel file. Spec 89 already placed this component in the shared folder; spec 91 extends it.
- **Permissions:** reuse `PERMISSIONS.ORDER_SALES_EDIT` (or whichever permission already gates the POS sales actions — verify via the existing change-package-tier action). Do not introduce a new permission.
- **The resolver and pricing modules are unchanged.** Spec 91 consumes both. If a behavior gap surfaces, fix it in the right module — do not duplicate logic in components.

## Scope

### In Scope

#### Module: `src/modules/session-configurations/session-configuration-selection.service.ts`

- Public surface:
  ```ts
  type SelectionInput =
    | { configurationId: string; kind: "toggle" }
    | { configurationId: string; kind: "select"; optionId: string }
    | { configurationId: string; kind: "number"; numericValue: number }
    | { configurationId: string; kind: "text"; textValue: string }
    | { configurationId: string; kind: "counter"; numericValue: number; optionId?: string };

  writeOrderPackageSelections(
    orderPackageId: string,
    desiredSelections: SelectionInput[],
    actor: SessionConfigurationActor,
    options?: { allowPostLock?: false } // default false; spec 92 sets true with audit context
  ): Promise<{ orderPackageId: string; writtenSelectionIds: string[] }>;

  class SessionConfigurationSelectionLockedError extends Error;
  class SessionConfigurationSelectionConfigurationNotFoundError extends Error;
  class SessionConfigurationSelectionOptionMismatchError extends Error;
  class SessionConfigurationSelectionInputMismatchError extends Error;
  ```
- Behavior:
  1. Open a `Serializable` transaction.
  2. Load the `OrderPackage` + its order + the final invoice's `isLocked` flag. If locked and `options.allowPostLock !== true`, throw `SessionConfigurationSelectionLockedError`.
  3. Load all active `SessionConfiguration` rows for `orderPackage.sessionTypeId` with their active options. Index by id.
  4. Validate each `SelectionInput`:
     - Config must exist and be active. Otherwise: `SessionConfigurationSelectionConfigurationNotFoundError`.
     - `kind` must match the config's live `inputType`. Otherwise: `SessionConfigurationSelectionInputMismatchError`.
     - For `select` and tiered-counter: `optionId` must exist on this configuration and be `isActive`. Otherwise: `SessionConfigurationSelectionOptionMismatchError`.
     - For `number`/`counter`: numericValue must be a finite non-negative number; reject otherwise.
     - For `text`: trimmed length 1–500. Empty → caller should have omitted it (this is asserted; the panel filters empties before submitting).
  5. Compute the snapshot fields per row from the live config (and chosen option):
     - `snapshotPriceDelta` derivation:
       - `pricingMode = NONE` → `0`.
       - `pricingMode = FIXED` → `config.fixedPriceDelta`.
       - `pricingMode = TIERED` + `inputType = SELECT` → `option.priceDelta`.
       - `pricingMode = TIERED` + `inputType = COUNTER` → `option.priceDelta` (admin builds counter tier breakpoints as options; option choice indicates tier).
       - `pricingMode = LINKED_PRODUCT` → `product.canonicalPrice` (fetched live; snapshot freezes the customer-facing amount). Display mode + linked product id also snapshotted.
       - `pricingMode = FIXED` + `inputType = COUNTER` is allowed and uses `config.fixedPriceDelta` (multiplier mode is `PER_UNIT` and the snapshot stores the per-row total `unitPrice × numericValue`). Snapshot the **product** of unit price and quantity here so the pricing module's downstream description format (`label (×N)`) and total math stay aligned.
     - All other snapshot columns copied from live config / chosen option.
  6. Load existing selections for the order package.
  7. Compute the diff: insert new (configurationId not in existing), update existing (configurationId in both), delete removed (configurationId in existing but not in desired).
  8. Apply the diff inside the same transaction. Updates overwrite **all** snapshot columns from the freshly-read live data (never copy from the old selection row).
  9. Return `{ orderPackageId, writtenSelectionIds }`.

#### Module updates

- `src/modules/orders/order.service.ts`:
  - Extend `getPOSWorkspace` to call `resolveOrderSessionConfigurations(client, order.id)` once per workspace load and surface, per package line:
    - `sessionConfigurationSummary`: an array of `{ configurationId, code, label, priceDelta, financialBehavior, inputType }` derived from current selections (snapshot fields). Used by the summary chip.
    - `sessionConfigurationSubtotal`: `number` — sum from `priceSelections(selectionsForThisPackage).totalDelta`. The existing `sessionConfigurationTotal` on the workspace stays as the order-wide sum.
    - `missingRequiredConfigurationCodes`: `string[]` from the resolver. Used by the missing-required badge.
    - `availableConfigurations`: the resolver's `activeConfigurations` for this session type plus, for each, a small payload of available active options (id, label, priceDelta) and the configuration's input/pricing/financial modes. This is what the panel renders.
    - `currentSelections`: per-package selection rows in the resolved shape (already produced by the resolver).
  - Add corresponding fields to the `POSPackageLine` type in `src/modules/orders/order.types.ts`.
  - Do not split into a second loader call; one resolver call per workspace is enough.

#### Schema: `src/modules/session-configurations/session-configuration-selection.schema.ts`

- Zod schemas for the panel form payload:
  - `selectionInputSchema` — discriminated union on `kind`.
  - `writeSelectionsPayloadSchema` — `{ orderPackageId: string, selections: selectionInputSchema[] }`.
- Used by the server action only; the service accepts already-parsed input.

#### Server actions: `app/orders/[orderId]/actions.ts`

- New action `configureSessionAction(orderId, prev, formData)`:
  - Permission gate matches the other POS edit actions.
  - Parses the JSON-encoded payload `selections` from FormData (same pattern admin form uses for option arrays — spec 89).
  - Calls `writeOrderPackageSelections(orderPackageId, selections, actor)`.
  - On success: `revalidatePath` the sales page route.
  - On `SessionConfigurationSelectionLockedError`: return a `{ errors: { _global: ["Order is locked. Edit configurations through the Adjustment Workspace."] } }` state (spec 92 routes this path properly).
  - On the typed input/option-mismatch errors: route to `errors._global` with a user-friendly message.
- Update existing `createOrderInvoiceAction`:
  - The spec-90 catch already logs the structured error and re-throws. **Convert the throw to a returned action-state error** keyed to the affected configuration codes. The sales page surfaces this in the existing error region. Make the message specific: list the missing configuration codes (resolved to names) per package, e.g. `"Configure the missing session settings before generating the invoice: Twins, Age Range (Newborn Package)."`
  - To map codes → names, read once from the live `SessionConfiguration` table inside the action using `db.sessionConfiguration.findMany({ where: { code: { in: codes } } })`. Acceptable read outside the module for a UI-formatting use case; the central rule is "no mutations or pricing math outside the module," not "no reads."

#### Components: `src/components/session-configurations/`

- `configure-session-panel.tsx`:
  - Client component. Props: `{ orderPackageId, packageName, sessionTypeName, availableConfigurations, currentSelections, missingRequiredConfigurationCodes }`.
  - Renders one row per `availableConfigurations` entry, sorted by the resolver's order. Each row shows:
    - The config name + required asterisk.
    - The shared `<SessionConfigurationInputRenderer mode="edit" value={...} onChange={...} options={...} />`.
    - A live "+X KD" hint computed via `priceSingleSelection` from a freshly-built `PricedSelection` (uses live snapshots from the available config; for the *preview* this read of the live value is correct — actual snapshotting happens server-side at write).
    - Missing-required indication if applicable.
  - Submit serializes the full selection state as JSON to the server action.
  - Saves over the whole-package set atomically (matches the service contract).
  - On returned action errors, surfaces them inline.
- Extend `session-configuration-input-renderer.tsx`:
  - Props change to a discriminated `mode`:
    ```ts
    type Props =
      | { mode: "preview"; inputType: ...; options?: ... }
      | {
          mode: "edit";
          inputType: ...;
          options?: ...;
          value: SelectionInput | null;
          onChange: (next: SelectionInput | null) => void;
          configurationId: string;
        };
    ```
  - Edit-mode renders the controlled toggle/select/number/text/counter input; null value means "no selection." Setting back to null is the "clear" action (delete on save).
- `configuration-summary-chip.tsx`:
  - Server component. Props: `{ summary: SessionConfigurationSummaryEntry[], subtotal: number }`.
  - Stacked layout per the plan: line 1 = "Config: " + comma-joined labels (or "No configurations" muted); line 2 = "Added Fees: " + formatted KD subtotal (omitted when subtotal is 0). Matches the source-doc's example.
  - Empty state: render nothing if `summary.length === 0` and `missingRequiredConfigurationCodes` is empty. If there are missing-required configs, render only the missing-required badge.
- `configuration-missing-required-badge.tsx`:
  - Renders a small badge `Required configuration missing: Twins, Age Range` keyed off `missingRequiredConfigurationCodes`. Resolves codes → names from the `availableConfigurations` array passed in (no extra fetch).
- Hook up these three into the existing POS package card. The Configure Session button mirrors the Upgrade Package button's placement and styling. The summary chip and missing-required badge live below the existing package info.

#### Tests

- Selection service (with a real DB fixture):
  - Writing a `TOGGLE` selection inserts a row with `snapshotConfigurationCode`, `snapshotLabel`, `snapshotPriceDelta` populated from the live config.
  - Writing the same selection again on an existing row is a no-op for `id` but a refresh of snapshot columns (verify by changing the config name in admin between writes — the second write picks up the new label).
  - Removing a previously-selected config from the desired set deletes its row.
  - Writing a `SELECT` selection with an `optionId` that doesn't belong to the config → throws `SessionConfigurationSelectionOptionMismatchError`; nothing persisted.
  - Writing with mismatched `kind` vs the live `inputType` → `SessionConfigurationSelectionInputMismatchError`.
  - Locked order → `SessionConfigurationSelectionLockedError`; nothing persisted.
  - Tiered-counter selection: option `priceDelta` is snapshotted onto `snapshotPriceDelta`.
  - Linked-product selection: `linkedProductId`, `linkProductDisplay`, and `snapshotPriceDelta` (from product's canonical price) all snapshotted.
- Resolver/pricing wiring on the workspace:
  - `getPOSWorkspace` returns the new per-package fields with the correct values on a fixture with mixed selections.
- Server action:
  - `configureSessionAction` with valid input writes selections and revalidates.
  - Locked order returns the locked error message.
- Invoice action surfacing:
  - `createOrderInvoiceAction` with missing required configs returns the user-facing message listing the configuration names; no invoice row created.
- Renderer:
  - The shared renderer in `mode = edit` invokes `onChange` correctly for each input type (component test).

### Out of Scope

- Post-lock edit routing (operational direct-edit + audit log; financial → Adjustment Workspace). **Spec 92.**
- Invoice / receipt presentation of session-configuration lines beyond what spec 90 already produces. **Spec 93.**
- Audit-log writes for selection mutations. There is no audit requirement pre-lock per the plan; spec 92 adds audit for post-lock direct edits.
- Reordering of configurations on the panel beyond what `sortOrder` already provides.
- Bulk apply across multiple packages.
- Mobile-specific layout of the panel beyond what the dialog primitive already supports.
- Adding a separate permission for configure-session — reuses the existing POS-edit permission.

## Implementation Direction

### 1. Service first

Land `session-configuration-selection.service.ts` and its tests before any UI work. The contract is independent of the panel.

### 2. Workspace extension

Extend `getPOSWorkspace` and `POSPackageLine` to carry resolver+selection data. The resolver is already called once via `resolveOrderSessionConfigurations`; reuse that call. Compute per-package summaries from `priceSelections` to avoid double-walking the selections.

### 3. Renderer extension

Update `SessionConfigurationInputRenderer` to a discriminated `mode`. Keep the preview branch (used by the admin form) untouched; the new `"edit"` branch is purely additive. The admin form continues to render `mode="preview"`.

### 4. Panel + chip + badge

Build the three components against the workspace shape. The panel's submit handler shapes its state into `SelectionInput[]` and calls the server action. The chip and badge are server-rendered from workspace fields, so the package card needs no client logic for them.

### 5. Action and error surfacing

`configureSessionAction` is the second writer entry-point (after spec 92's post-lock flow, which routes through the same service). Keep its error mapping table small and explicit.

Update `createOrderInvoiceAction` to catch the spec-90 `SessionConfigurationRequiredSelectionMissingError` and **return** an action state instead of bubbling. This is the user-visible payoff of spec 90's typed-error work.

### 6. Decimal handling

Numeric values from FormData are strings. The schema coerces to `number`, and the service uses `new Prisma.Decimal(value)` before writing. Mirror the admin form's money handling (spec 89).

## Observability Checklist

### Dashboards / Metrics

- Counter: `pos.session_configuration_selections.written` per `writeOrderPackageSelections` invocation.
- Counter: `pos.session_configuration_selections.locked_block` per `SessionConfigurationSelectionLockedError`.
- Counter: `pos.create_invoice.missing_required_block` (already emitted in spec 90; verify it still fires and is now correlated with a returned action-state error rather than a thrown exception).

### Rollback Plan

- Code-only change. Reverting this spec's commits removes the panel, chip, badge, and writer service. Any selection rows created via the panel before rollback remain in the database and continue to be honored by spec-90 pricing/invoice code paths. To purge: hard-delete rows for orders with `isLocked = false` invoices; locked-invoice orders should be left alone (their lines were snapshotted at lock time).
- No schema changes.
- No flag.

### Customer-Visible Surface

- Staff (POS sales page): each package card now has a Configure Session button, a summary chip, and a missing-required badge (when applicable). Trying to generate an invoice with missing-required configs shows an inline error naming the missing settings.
- Customers: no direct change yet — invoice-line behavior was already established in spec 90; locked invoices keep showing session-config lines.

## Post-Implementation

- Update `context/architecture-summary.md` with one line noting that `session-configuration-selection.service.ts` is the sole writer of `OrderPackageSessionConfigurationSelection`.
- Update `context/progress-tracker.md`.

## Acceptance Criteria

- `src/modules/session-configurations/session-configuration-selection.service.ts` exists and is the **only** module under `app/` or `src/` that calls `db.orderPackageSessionConfigurationSelection.create`, `.update`, `.delete`, `.deleteMany`, `.updateMany`, or `.createMany`. Asserted by grep.
- `SessionConfigurationInputRenderer` supports both `mode="preview"` and `mode="edit"` from a single file in `src/components/session-configurations/`. The admin form continues to render `mode="preview"` and the panel renders `mode="edit"`.
- Writing a selection set with a renamed configuration (admin renamed since the prior write) results in the new row reflecting the new name in `snapshotLabel`. Asserted by test.
- A locked order rejects writes with `SessionConfigurationSelectionLockedError`. The POS action surfaces this as a user-friendly error.
- `getPOSWorkspace` returns, per package: `sessionConfigurationSummary`, `sessionConfigurationSubtotal`, `missingRequiredConfigurationCodes`, `availableConfigurations`, and `currentSelections`. The order-wide `sessionConfigurationTotal` from spec 90 is unchanged and equals the sum of per-package subtotals.
- The POS sales page renders a Configure Session button on every package card; opening the panel and saving a complete selection set updates the database, the summary chip, and the missing-required badge on the next render.
- `createOrderInvoiceAction` returns a user-friendly action-state error listing the missing configuration **names** (not codes) when invoice creation is blocked. The blocked invoice creates no rows.
- A grep for `priceDelta` in `src/components/session-configurations/configure-session-panel.tsx` returns matches only inside `priceSingleSelection` invocations or display strings — the panel does not re-derive deltas inline.
- `npm run build` passes.
- `npm run lint` passes.
