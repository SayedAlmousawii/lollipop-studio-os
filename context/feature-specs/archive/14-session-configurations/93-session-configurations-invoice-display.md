# 93 — Session Configurations: Invoice & Receipt Display

## Goal

Polish how session-configuration selections present on customer-facing invoices and the staff-facing order detail page, and clean up one design defect from spec 90 (the `MODIFIER_ONLY` linked-product mode produced totals that didn't reconcile from visible lines).

Concretely:

1. **Customer invoice/receipt:** session-configuration line items grouped under a "Session Configuration" subheading; line descriptions formatted as `"Config name — Option label"` for tiered/select selections; counter selections keep their `(×N)` suffix.
2. **Adjustment invoices** (produced by Adjustment Workspace finalize per spec 92): line descriptions carry a verb prefix — `"Added: …"`, `"Removed: …"`, or `"Changed: X → Y"` — so the customer can read what changed at a glance.
3. **Operational selections** (cake theme, baby name, etc.) get a staff-only display block on the order detail page; they never appear on customer-facing documents.
4. **`MODIFIER_ONLY` is retired in behavior** here. All `LINKED_PRODUCT` selections render as visible line items going forward. The column and enum value stay in the schema for now — they're fully removed in spec 94 as part of the linked-product → real `OrderAddOn` retrofit.

## Forward note on spec 94

Spec 94 will retrofit `LINKED_PRODUCT` selections to materialize as real `OrderAddOn` rows (so cakes/t-shirts participate in product sales reporting, inventory, deliverable tracking). After spec 94 lands:
- `SESSION_CONFIGURATION` invoice lines come only from `FIXED` and `TIERED` pricing modes; linked-product selections produce normal `ADD_ON` lines via the existing add-on path.
- `SessionConfigurationLinkProductDisplay` (the enum) and `SessionConfiguration.linkProductDisplay` (the column) get dropped along with the spec-90 `nonLineDelta` plumbing in the pricing module.

Spec 93 leaves all that scaffolding in place but stops *using* the `MODIFIER_ONLY` branch — it migrates existing rows to `LINE_ITEM` and prevents new `MODIFIER_ONLY` rows from being created. Spec 94 removes the dead code.

## Read First

- `context/feature-specs/90-session-configurations-pricing-engine.md` — invoice line emission rules; this spec changes line *description* formatting but not the line *count* or *total* math.
- `context/feature-specs/92-session-configurations-post-lock-routing.md` and `92a-…` — adjustment-invoice line generation; verb prefixes plug in at the proposal-builder level.
- [src/modules/session-configurations/session-configuration-pricing.ts](src/modules/session-configurations/session-configuration-pricing.ts) — `formatSelectionDescription`; the format change lives here.
- [src/modules/session-configurations/session-configuration-selection.service.ts](src/modules/session-configurations/session-configuration-selection.service.ts) — selection-row writer; gets one new snapshot column (`snapshotOptionLabel`).
- [src/modules/session-configurations/session-configuration-resolver.ts](src/modules/session-configurations/session-configuration-resolver.ts) — `pricedSessionConfigurationSelectionSelect`; widen to include the new column.
- [src/modules/adjustment-workspace/pending-changes-view.ts](src/modules/adjustment-workspace/pending-changes-view.ts) — `SESSION_CONFIGURATION` delta-line builder; verb prefixes computed here.
- [src/modules/adjustment-workspace/adjustment-workspace.service.ts:1425-1454](src/modules/adjustment-workspace/adjustment-workspace.service.ts#L1425-L1454) — finalize step where prefixes land on `InvoiceLineItem` descriptions.
- [app/invoices/[id]/page.tsx:151-172](app/invoices/[id]/page.tsx#L151-L172) — current Invoice Composition card; the subheading grouping lands in this render path.
- [app/orders/[orderId]/page.tsx](app/orders/[orderId]/page.tsx) — order detail page where the staff-only operational-config block mounts.
- [src/components/financial/](src/components/financial/) — shared read-only financial UI surface created in spec 87; the new grouped-lines renderer lives here (alongside `FinancialLinkedDocuments` et al.).

## Rules

- **No price math changes.** Invoice totals, delta math, and pricing-module return shapes are unchanged. Spec 93 only touches descriptions, grouping, and a single new snapshot column. A change to any total or to `priceSelections`'s return shape is a review-blocker (defer to spec 94).
- **Customer-facing surfaces never expose operational selections.** They live only on the order detail page (staff). The shared invoice renderer must not switch on a `staff?` flag — keep the surface customer-clean by construction.
- **All snapshotting at write time.** The new `snapshotOptionLabel` column is populated by the selection service when an option is chosen (`SELECT` and `TIERED-COUNTER`). It is never re-derived from live option rows at read time. Same snapshot-or-die rule as the rest of the system.
- **Adjustment verb prefixes are descriptive, not parseable.** They appear at the start of the `InvoiceLineItem.description` string for `SESSION_CONFIGURATION` lines produced by workspace finalize. No new column. Reports that want to distinguish add/remove/change use the existing `lineTotal` sign + the `causeOrderEntityId` join.
- **Operational selection display is read-only.** The order detail page's new block lists current operational selections; it does not provide edit affordances. Editing lives on the configure-session panel (spec 91/92a).
- **MODIFIER_ONLY: no new writes, migrate existing.** As of this spec:
  - The admin schema (`createSessionConfigurationSchema` / `updateSessionConfigurationSchema`) rejects `linkProductDisplay = MODIFIER_ONLY`. Admins can only choose `LINE_ITEM`. The dropdown in the admin form drops the option entirely; the field reads-only as "Line item" for LINKED_PRODUCT configs.
  - Migration flips every existing `SessionConfiguration.linkProductDisplay = MODIFIER_ONLY` to `LINE_ITEM`. Same flip on `OrderPackageSessionConfigurationSelection.snapshotLinkProductDisplay`.
  - The pricing module's `MODIFIER_ONLY` branch becomes unreachable in practice. Leave the code path in place (it's a defensive default) but remove its `nonLineDelta` accumulation effect by treating any post-migration `MODIFIER_ONLY` value (none should exist) the same as `LINE_ITEM`. Spec 94 deletes the branch.
- **Locked invoices' `InvoiceLineItem` rows are immutable.** This spec does **not** rewrite their `description` columns. Existing locked invoices keep the old format ("Age Range" rather than "Age Range — 30–45 Days"); only invoices generated after this spec ships use the new format. The customer-side render *does not* reformat retrospectively. Stated explicitly so the implementer doesn't try to back-fill `InvoiceLineItem.description`.
- **Migration naming:** `20260518040000_session_configuration_option_label_snapshot` (next slot after spec-90's `20260518030000_*`).

## Scope

### In Scope

#### Schema

- New column `OrderPackageSessionConfigurationSelection.snapshotOptionLabel: String?` (nullable; null for non-`SELECT`, non-tiered-`COUNTER` selections).
- Migration `20260518040000_session_configuration_option_label_snapshot/migration.sql`:
  - `ALTER TABLE` to add the column.
  - Backfill: for each existing selection row with a non-null `optionId`, populate `snapshotOptionLabel` from the live `SessionConfigurationOption.label`. Best-effort: if the option has since been renamed, the captured label reflects current admin state. Acceptable because new invoices going forward use the column directly; existing locked invoices already have descriptions baked into their line items.
  - Flip `SessionConfiguration.linkProductDisplay = MODIFIER_ONLY` to `LINE_ITEM` (count expected to be 0 or low in practice — the design defect that drove this retrofit means it should not be in active use; still run the statement defensively).
  - Same flip on `OrderPackageSessionConfigurationSelection.snapshotLinkProductDisplay = MODIFIER_ONLY` → `LINE_ITEM`.
  - The migration does **not** drop the enum value or column (spec 94's job).

#### Selection service ([session-configuration-selection.service.ts](src/modules/session-configurations/session-configuration-selection.service.ts))

- `buildSelectionSnapshot` populates `snapshotOptionLabel`:
  - `SELECT` selection → `option.label`.
  - `TIERED` + `COUNTER` selection with a chosen option → `option.label`.
  - Everything else → `null`.
- `snapshotData(...)` includes the new column.
- `auditPayloadFromExistingSelection` / `auditPayloadFromSelectionSnapshot` include `snapshotOptionLabel` in their payloads.

#### Resolver / pricing module shared select

- [session-configuration-resolver.ts](src/modules/session-configurations/session-configuration-resolver.ts): widen `pricedSessionConfigurationSelectionSelect` to include `snapshotOptionLabel`.
- [session-configuration-pricing.ts](src/modules/session-configurations/session-configuration-pricing.ts):
  - Widen the `PricedSelection` type to include `snapshotOptionLabel: string | null`.
  - Rewrite `formatSelectionDescription` to:
    - `SELECT` or tiered-`COUNTER` with `snapshotOptionLabel`: `"${snapshotLabel} — ${snapshotOptionLabel}"`.
    - `COUNTER` (non-tiered): `"${snapshotLabel} (×${numericValue})"` (unchanged).
    - All other (TOGGLE / NUMBER / TEXT / non-tiered): `snapshotLabel` (unchanged).
  - The function is the single source of line description text; both pre-lock workspace render and invoice line generation flow through it.

#### Admin form ([session-configuration-form.tsx](src/components/session-configurations/session-configuration-form.tsx) + [session-configuration.schema.ts](src/modules/session-configurations/session-configuration.schema.ts))

- Remove `MODIFIER_ONLY` from the `linkProductDisplay` field's selectable options.
- Update the zod refinement: if `pricingMode = LINKED_PRODUCT`, require `linkProductDisplay = LINE_ITEM` (effectively pin the value). For existing configs being edited, if the persisted value was `MODIFIER_ONLY` (shouldn't be after migration, but defensively), coerce the form's initial value to `LINE_ITEM` and display the field as read-only.
- Optionally hide the field entirely if it has only one valid value — UX choice; recommend hiding to reduce noise, render an inline note "Linked products are added to the invoice as line items."

#### Customer invoice renderer ([app/invoices/[id]/page.tsx](app/invoices/[id]/page.tsx))

- Replace the current flat `invoice.lineItems.map(...)` body of the Invoice Composition card with a grouped render:
  1. First, render non-`SESSION_CONFIGURATION` lines in their existing order.
  2. If any `SESSION_CONFIGURATION` lines exist, render a visual subheading "Session Configuration" followed by those lines, also preserving their internal `sortOrder`.
- Extract the grouped-render logic into a new shared component **`src/components/financial/invoice-line-items.tsx`** so the same grouping is reused by:
  - The customer invoice detail page ([app/invoices/[id]/page.tsx](app/invoices/[id]/page.tsx))
  - The Order Details Financials tab's Price Breakdown card (spec 87 territory — verify whether its line-items render is the same component or a parallel render path; if parallel, route both through the new shared component).
- The component takes `lineItems: InvoiceLineItem[]` and renders the grouped form. No new data fetching.

#### Adjustment invoice prefixes ([pending-changes-view.ts](src/modules/adjustment-workspace/pending-changes-view.ts))

- In the `change_session_configuration_selection` translation:
  - Compute the edit kind from `baseSelectionExists × desiredExists`:
    - `!base && desired` → **Added**: description = `"Added: ${formatSelectionDescription(desiredSnapshot)}"`.
    - `base && !desired` → **Removed**: description = `"Removed: ${formatSelectionDescription(baseSnapshot)}"`.
    - `base && desired && (different)` → **Changed**: description = `"Changed: ${formatSelectionDescription(baseSnapshot)} → ${formatSelectionDescription(desiredSnapshot)}"`.
    - `base && desired && (same)` → no-op, skip emitting a delta line.
  - The `desiredSnapshot` is constructed in-memory from the live config + chosen option (same shape the selection service produces) so `formatSelectionDescription` can be called on it without DB hits beyond what the proposal builder already does.
- The verb prefix lives only in the `description` string. The `causeOrderEntityKind` / `causeOrderEntityId` / `lineType` / sign-of-`lineTotal` semantics are unchanged.

#### Operational config display on order detail page

- New component **`src/components/orders/operational-configurations-block.tsx`**: takes `packageLines: { packageName, sessionTypeName, operationalSelections: { configName, valueDisplay }[] }[]` and renders a card per package showing operational selections in plain text. Hidden if no package has any operational selection.
- `valueDisplay` derivation per input type:
  - `TOGGLE` → "Enabled" (presence of row is enough).
  - `SELECT` → `snapshotOptionLabel`.
  - `NUMBER` / `COUNTER` → `numericValue.toString()`.
  - `TEXT` → `textValue`.
- Mount the block inside [app/orders/[orderId]/page.tsx](app/orders/[orderId]/page.tsx), under whichever existing section makes sense for staff context (likely under the customer / package overview; if a Selection tab exists for staff config, prefer there). The page's existing loader already has `getPOSWorkspace`; project the operational selections from `workspace.packageLines[i].sessionConfigurationSummary` (already filtered to selection rows) by filtering on `financialBehavior === "OPERATIONAL"`.
- No customer-facing surface. Asserted by absence in [app/invoices/[id]/page.tsx](app/invoices/[id]/page.tsx).

#### Tests

- Selection service:
  - Writing a `SELECT` selection populates `snapshotOptionLabel = option.label`.
  - Writing a `TOGGLE` / `NUMBER` / `TEXT` / non-tiered-`COUNTER` selection leaves `snapshotOptionLabel = null`.
  - Updating a selection re-snapshots the option label from live data (covers the renamed-option case).
- Pricing module:
  - `formatSelectionDescription` for `SELECT` + populated option label → `"Age Range — 30–45 Days"`.
  - For `TIERED` + `COUNTER` with chosen option → `"Sibling count — Tier 3+"` (or similar).
  - For `COUNTER` without option → `"Sibling count (×3)"`.
  - For `TOGGLE` → `"Twins"`.
- Invoice line generation (regression):
  - Newly generated locked invoice's `SESSION_CONFIGURATION` line for a `SELECT` selection contains the new combined description format.
  - Existing pre-spec-93 `InvoiceLineItem` rows are untouched (assert by re-reading the same row before and after the migration).
- Adjustment-invoice prefixes:
  - Workspace finalize where one financial config is added → adjustment invoice line description starts with `"Added: "`.
  - Removed → `"Removed: "`.
  - Changed → `"Changed: X → Y"` containing both pre- and post-edit snapshots.
- MODIFIER_ONLY retirement:
  - Migration backfill: a fixture row with `linkProductDisplay = MODIFIER_ONLY` becomes `LINE_ITEM` post-migration; corresponding selection rows updated.
  - Admin form rejects `MODIFIER_ONLY` on create / update — zod schema test.
- Invoice render:
  - Component test for the new grouped `InvoiceLineItems` component: with a mix of `PACKAGE_BASE`, `ADD_ON`, `SESSION_CONFIGURATION`, and `EXTRA_PHOTOS` lines, the rendered DOM has the `SESSION_CONFIGURATION` subheading appearing once, with the matching lines below it; other lines appear above without subheading.
  - With no `SESSION_CONFIGURATION` lines, no subheading is rendered.
- Order detail operational block:
  - Renders the operational selections grouped by package.
  - Customer invoice page DOM contains zero references to operational selection text (assert by searching for fixture-chosen operational text values in the rendered page).

### Out of Scope

- Retroactive rewrite of `InvoiceLineItem.description` on existing locked invoices. Snapshots are immutable; new format applies only going forward.
- `LINKED_PRODUCT` materializing as `OrderAddOn` rows. Spec 94.
- Dropping the `MODIFIER_ONLY` enum value or `linkProductDisplay` column from the schema. Spec 94.
- Receipt-specific rendering changes — if the codebase has a separate receipt PDF surface, audit it but only mirror the invoice grouping. If receipts and invoices share a renderer, this spec covers both.
- Multi-language / translation work on the new strings.
- Reporting / dashboard surfaces that would consume the `SESSION_CONFIGURATION` line type. Future work.
- Customer-portal / customer-facing emails. This spec touches studio-rendered surfaces only.

## Implementation Direction

### 1. Snapshot the option label, then the rest is free

`snapshotOptionLabel` is the single data dependency the new description format needs. Everything else (pricing module, invoice line generation, workspace proposal builder) is already routed through `formatSelectionDescription`. Add the column, populate it in `buildSelectionSnapshot`, widen the resolver's select shape, update `formatSelectionDescription` — at that point all three render paths (POS draft sidebar, invoice generation, adjustment-invoice proposal) emit the new format.

### 2. The `MODIFIER_ONLY` retirement is two-step on purpose

Spec 93: block new `MODIFIER_ONLY` writes + migrate existing data + make the dead branch unreachable in practice. Schema stays intact.

Spec 94: delete the enum value, drop the column, remove `nonLineDelta` from the pricing module signature, simplify call sites.

This two-step lets you ship the user-visible fix (no more unreconcilable totals) immediately without coupling it to the bigger linked-product → `OrderAddOn` retrofit. If spec 94 slips, spec 93 still ships clean.

### 3. Adjustment prefixes use the existing snapshot pipeline

The proposal builder already constructs in-memory snapshot shapes for the desired post-edit state in order to call `priceSelections`. Reuse those shapes for `formatSelectionDescription`. The `before` shape comes from the existing baseline selection in the workspace's base composition. No new lookups.

### 4. Shared `InvoiceLineItems` component

The grouping logic is small. Putting it in `src/components/financial/` reuses the spec-87 pattern of "shared read-only financial primitives." Verify whether the Order Details Financials tab's Price Breakdown card already uses the same primitive — if so, the change is one place; if not, route both through the new component.

### 5. Operational block placement

The order detail page is the existing staff surface for an order. Add the block under the existing package/composition section. Style: small card per package with a heading "Operational configurations" and a list of `{configName}: {value}` rows. Empty state: hide entirely.

## Observability Checklist

### Dashboards / Metrics

- Counter: `invoice.session_configuration_lines_grouped_render` — increments per render of the grouped invoice composition card. Cheap signal that the new component is taking effect.
- Counter: `adjustment_invoice.session_configuration_prefix_emitted` — bucketed by `"added" | "removed" | "changed"` so you can see the distribution of workspace edit kinds in production.
- No new discrepancy logs needed; pricing math is unchanged.

### Rollback Plan

- Schema: down-migration drops the `snapshotOptionLabel` column. `MODIFIER_ONLY` flips made by the migration cannot be reversed automatically (the original distinction is lost); rollback leaves them as `LINE_ITEM`, which is the post-spec-93 intent regardless. No data loss; behavior reverts to pre-spec rendering.
- Code: reverting the spec-93 commits restores the flat line list and the old description format. Existing locked invoices were not rewritten, so their rendering is unaffected by the rollback.
- No flag.
- Non-recoverable: the original `MODIFIER_ONLY` markings on configs and selections. Recommend documenting the affected rows during the migration step for audit.

### Customer-Visible Surface

- Customers (invoice / receipt): session-configuration lines now appear under a labelled subheading; tiered selections show the config name *and* the chosen option (e.g. "Age Range — 30–45 Days") instead of just the option label. Adjustment invoices read more clearly ("Added: Twins" vs. an unprefixed "Twins" with a positive number).
- Staff (order detail page): a new compact block lists operational selections per package, for context. No edit controls there.
- Staff (admin session-configurations page): `MODIFIER_ONLY` no longer selectable.

## Post-Implementation

- Update `context/architecture-summary.md` to mention `src/components/financial/invoice-line-items.tsx` as the canonical grouped-line renderer, and the operational-configurations block on the order detail page.
- Update `context/progress-tracker.md`.
- Note spec 94 carries the linked-product retrofit; until it lands, `LINKED_PRODUCT` selections still produce `SESSION_CONFIGURATION` invoice lines (not `ADD_ON` lines). Document this transitional state in the architecture summary so reviewers don't think it's a bug.

## Acceptance Criteria

- New column `snapshotOptionLabel` exists on `OrderPackageSessionConfigurationSelection`. Existing selections with `optionId != null` have it backfilled.
- A new `SELECT` or tiered-`COUNTER` selection writes the column from the live option label.
- `formatSelectionDescription` emits the new combined format for `SELECT` selections with a populated `snapshotOptionLabel`. Counter and toggle formats unchanged.
- Newly generated `SESSION_CONFIGURATION` invoice line items use the new description format; existing locked invoice line items are unchanged. Asserted by reading the same `InvoiceLineItem.id` row before and after migration.
- Customer invoice composition card groups `SESSION_CONFIGURATION` lines under a "Session Configuration" subheading. Other line types remain in their existing order without a subheading.
- The grouped renderer lives in `src/components/financial/invoice-line-items.tsx` and is the only component rendering invoice line lists across `app/invoices/[id]/page.tsx` and the Order Details Financials tab.
- Adjustment-invoice `SESSION_CONFIGURATION` lines produced by workspace finalize carry the `"Added: " | "Removed: " | "Changed: X → Y"` prefix. Asserted by per-prefix test.
- Admin form rejects `linkProductDisplay = MODIFIER_ONLY` on create/update. The form's UI no longer exposes the option.
- Migration backfills `MODIFIER_ONLY` → `LINE_ITEM` on both `SessionConfiguration.linkProductDisplay` and `OrderPackageSessionConfigurationSelection.snapshotLinkProductDisplay`.
- The order detail page renders a per-package operational-configurations block listing current operational selections. Empty packages hide the block.
- Customer-facing invoice/receipt DOM contains zero references to operational selection text values (text-search assertion in a render test against a fixture whose operational `textValue` is a distinct sentinel string).
- A grep for `linkProductDisplay\s*===\s*"MODIFIER_ONLY"` in production code (excluding tests and the migration) returns zero hits OR returns only the defensive "treat as LINE_ITEM" branch in the pricing module. Spec 94 removes that branch.
- `npm run build` passes.
- `npm run lint` passes.
