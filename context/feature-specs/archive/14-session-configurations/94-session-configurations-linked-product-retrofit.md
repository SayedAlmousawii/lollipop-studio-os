# 94 — Session Configurations: LINKED_PRODUCT → Real OrderAddOn Retrofit

## Goal

Make `LINKED_PRODUCT` session configurations materialize as real `OrderAddOn` rows so that cakes, t-shirts, and other product-backed session options participate in:

- Product sales reporting
- Inventory / production flows
- Add-on analytics
- Deliverable tracking

Today (post-spec-93) a `LINKED_PRODUCT` selection writes only a `OrderPackageSessionConfigurationSelection` row carrying a `snapshotPriceDelta` and produces a `SESSION_CONFIGURATION` `InvoiceLineItem` — a pseudo-product line that does not appear in any product-side surface.

After this spec:

- Toggling a `LINKED_PRODUCT` config **on** creates a real `OrderAddOn` row scoped to the package, alongside the selection row that records the config-to-add-on link via `selection.orderAddOnId`.
- Toggling **off** deletes both atomically.
- Selection rows for `LINKED_PRODUCT` carry `snapshotPriceDelta = 0` (price lives on the `OrderAddOn`).
- The pricing module **skips** `LINKED_PRODUCT` selections entirely; their financial contribution flows through the existing `ADD_ON` line path.
- Adjustment workspace edits on `LINKED_PRODUCT` configs produce `ADD_ON`-shaped adjustment-invoice lines (with the spec-93 verb prefixes), not `SESSION_CONFIGURATION` lines.
- The `SessionConfigurationLinkProductDisplay` enum and `linkProductDisplay` columns are dropped along with the spec-93 `nonLineDelta` plumbing in the pricing module.

The Configure Session UI is unchanged from the user's perspective — they still toggle "Cake" in the panel. The retrofit is entirely beneath that surface.

## Read First

- `context/feature-specs/93-session-configurations-invoice-display.md` — set the stage by retiring `MODIFIER_ONLY` behaviorally; this spec retires it structurally.
- `context/feature-specs/92-session-configurations-post-lock-routing.md` — post-lock financial routing flows through the workspace; this spec changes the *shape* of what the workspace emits for `LINKED_PRODUCT` edits.
- [src/modules/session-configurations/session-configuration-selection.service.ts](src/modules/session-configurations/session-configuration-selection.service.ts) — sole writer of selection rows. Gains add-on materialization in the same transaction.
- [src/modules/session-configurations/session-configuration-pricing.ts](src/modules/session-configurations/session-configuration-pricing.ts) — pricing module; gains a `LINKED_PRODUCT` skip and loses the `nonLineDelta` return field.
- [src/modules/session-configurations/session-configuration-resolver.ts](src/modules/session-configurations/session-configuration-resolver.ts) — `pricedSessionConfigurationSelectionSelect`; loses `snapshotLinkProductDisplay`, gains `orderAddOnId`.
- [src/modules/adjustment-workspace/adjustment-workspace.service.ts:1425-1454](src/modules/adjustment-workspace/adjustment-workspace.service.ts#L1425-L1454) — `finalizeSessionConfigurationSelectionEdits`; branches per-edit on `LINKED_PRODUCT`.
- [src/modules/adjustment-workspace/pending-changes-view.ts](src/modules/adjustment-workspace/pending-changes-view.ts) — proposal delta-line builder; emits `ADD_ON` lines for linked-product session-config edits.
- [src/modules/orders/order.service.ts:307+](src/modules/orders/order.service.ts#L307) — `getPOSWorkspace`; per-package summary excludes linked-product price contributions (they flow through `addOnTotal`).
- [src/modules/invoices/invoice.service.ts](src/modules/invoices/invoice.service.ts) — invoice line builder; no change required because the add-on path already produces `ADD_ON` lines.
- Existing add-on service — needs a new guard refusing manual deletion of an add-on whose row is owned by a session-config selection.
- [prisma/schema.prisma:679+](prisma/schema.prisma#L679) — `OrderPackageSessionConfigurationSelection` model; gains `orderAddOnId`, loses `snapshotLinkProductDisplay`.

## Rules

- **Single writer expands to two tables, not two services.** `session-configuration-selection.service.ts` remains the sole module that mutates `OrderPackageSessionConfigurationSelection`. For `LINKED_PRODUCT` selections, it additionally creates/deletes the linked `OrderAddOn` row inside the same transaction. The existing add-on service does **not** write selection-owned add-ons.
- **Selection-owned add-ons are write-protected from outside the selection service.** The add-on service refuses to delete an `OrderAddOn` whose `id` is referenced by any `OrderPackageSessionConfigurationSelection.orderAddOnId`. Staff must remove the configuration via Configure Session, which deletes both rows atomically. This preserves the invariant "selection exists ⇒ corresponding add-on exists" for `LINKED_PRODUCT` selections.
- **`LINKED_PRODUCT` selections always have `snapshotPriceDelta = 0` post-retrofit.** Price lives on the `OrderAddOn` (`priceSnapshot`). Any code reading `snapshotPriceDelta` from a `LINKED_PRODUCT` selection for pricing math is a bug.
- **Pricing module skips `LINKED_PRODUCT`.** It returns no line item and zero delta for these selections. Callers (invoice line builder, POS workspace) require no special handling — they pick up the price through the existing add-on path.
- **Migration is pre-lock only.** Only orders whose primary final invoice is **not locked** (or has no final invoice yet) get migrated. Locked orders keep their existing `SESSION_CONFIGURATION` `InvoiceLineItem` rows and their pre-spec-94 selection shape (`snapshotPriceDelta != 0`, `orderAddOnId = null`). Reason: locked invoice line items are immutable snapshots; creating a new `OrderAddOn` for a locked order would either double-count (if the existing line stays) or require rewriting the locked invoice (which the architecture forbids).
- **Drop the `MODIFIER_ONLY` enum value, the `linkProductDisplay` column, and the `snapshotLinkProductDisplay` column.** Spec 93 set this up; spec 94 finishes it. Migration is straightforward because spec 93 already flipped any `MODIFIER_ONLY` rows to `LINE_ITEM` — the column is now a single-valued no-op everywhere.
- **Drop `nonLineDelta` from the pricing module's return shape.** It has been zero since spec 93 collapsed the `MODIFIER_ONLY` branch. Callers that reference it must drop the reference.
- **Adjustment-workspace finalize for `LINKED_PRODUCT` produces `ADD_ON` lines, not `SESSION_CONFIGURATION` lines.** The verb prefix from spec 93 (`Added: Cake`, `Removed: Cake`, `Changed: X → Y`) is applied to the `ADD_ON` line's description.
- **Single-writer grep stays clean.** No new direct Prisma writes to `OrderPackageSessionConfigurationSelection` from outside the service. New direct writes to `OrderAddOn` from the selection service are inside the same module and acceptable; the existing add-on service continues to own non-config add-on writes.
- **Migration naming:** `20260518050000_linked_product_addon_retrofit` (next slot after spec-93's `20260518040000_*`).

## Scope

### In Scope

#### Schema migration

- Add `OrderPackageSessionConfigurationSelection.orderAddOnId: String?` with FK to `OrderAddOn(id)`, `onDelete: Restrict` (the selection service does the orderly tear-down; cascading would race with the service's own delete order).
- Add index `@@index([orderAddOnId])` on the selection table.
- Drop `OrderPackageSessionConfigurationSelection.snapshotLinkProductDisplay` column.
- Drop `SessionConfiguration.linkProductDisplay` column.
- Drop `SessionConfigurationLinkProductDisplay` enum.
- Drop the index `@@index([snapshotLinkedProductId])` on the selection table only if it's now unused (audit; otherwise leave it for reporting).
- **Data migration** (run inside the same migration SQL, executed transactionally):
  1. For each pre-lock order (`Order` whose `Invoice` of type `FINAL` either does not exist or has `isLocked = false`):
     - For each `OrderPackageSessionConfigurationSelection` belonging to it with `snapshotPricingMode = 'LINKED_PRODUCT'` and `snapshotLinkedProductId IS NOT NULL`:
       - Insert an `OrderAddOn` with `orderId` (the order), `orderPackageId` (the selection's package), `productId = snapshotLinkedProductId`, `nameSnapshot = (live product.name OR fallback to "Session product")`, `priceSnapshot = selection.snapshotPriceDelta`, `quantity = 1`.
       - Update the selection: `orderAddOnId = <new add-on id>`, `snapshotPriceDelta = 0`.
  2. Locked orders are not touched. Their selections retain `snapshotPriceDelta != 0` and `orderAddOnId = null`. Their existing `SESSION_CONFIGURATION` `InvoiceLineItem` rows remain unchanged.
- Document in the migration SQL comments which subset was migrated (pre-lock only).

#### Selection service ([session-configuration-selection.service.ts](src/modules/session-configurations/session-configuration-selection.service.ts))

- `buildSelectionSnapshot`:
  - For `pricingMode = LINKED_PRODUCT`, set `snapshotPriceDelta = 0`. The live `product.canonicalPrice` is the source of truth at materialization time; subsequent updates do not refresh the add-on's price.
  - `snapshotLinkProductDisplay` is gone (column dropped); remove from the snapshot type.
  - Keep `snapshotLinkedProductId` populated (still useful for reporting / debugging / attribution beyond the live FK).
- Add-on materialization inside the existing `writeOrderPackageSelections` transaction:
  - **Insert path** (new `LINKED_PRODUCT` selection): create an `OrderAddOn` first, then create the selection row with `orderAddOnId = newAddOn.id`. `OrderAddOn` fields:
    - `orderId`, `orderPackageId`: from the order package.
    - `productId`: live config's `linkedProductId`.
    - `nameSnapshot`: live product's `name`.
    - `priceSnapshot`: live product's `canonicalPrice`.
    - `quantity`: 1 (toggle-only in MVP; see Out of Scope).
  - **Update path** (existing `LINKED_PRODUCT` selection, no value change): no-op on the add-on; selection snapshot columns refresh as usual.
  - **Delete path** (`LINKED_PRODUCT` selection removed from desired set): delete the selection first, then delete the linked `OrderAddOn` by id. Order matters: deleting the add-on first would trip the `Restrict` FK.
- Post-lock direct-edit path (`allowPostLock = true`):
  - `LINKED_PRODUCT` configs are `FINANCIAL` by invariant, so they never reach this branch. The existing `SessionConfigurationSelectionFinancialNotAllowedError` continues to reject them. No new behavior required.
- Finalize-from-workspace helper (`applySessionConfigurationEditFromWorkspace`):
  - For `LINKED_PRODUCT` edits, perform the same add-on materialization/deletion as the pre-lock path. The helper already runs inside the workspace finalize transaction.
  - Return the materialized `orderAddOnId` (in addition to `selectionId`) so the proposal-to-line remap in finalize can attach `causeOrderEntityId` to the right entity if needed.

#### Add-on service (existing, location TBD by implementer)

- Add a guard on the add-on delete path: if the target `OrderAddOn.id` is referenced by any `OrderPackageSessionConfigurationSelection.orderAddOnId`, throw `OrderAddOnOwnedBySessionConfigurationError` with a message directing the user to remove the configuration via Configure Session.
- The error class is exported so the add-on-deletion UI surfaces it as a user-friendly action-state error.
- No change to the manual-add path; manual add-ons are not owned by selections and have no FK pointing at them.

#### Pricing module ([session-configuration-pricing.ts](src/modules/session-configurations/session-configuration-pricing.ts))

- `priceSingleSelection`:
  - Add a top-level branch: `if (selection.snapshotPricingMode === "LINKED_PRODUCT") return { lineDelta: zero, nonLineDelta: null, lineItem: null }`. (After cleanup the return type also loses `nonLineDelta`; see next bullet.) Conceptually: linked-product selections contribute nothing because their price already lives on an add-on.
  - Remove the `LINKED_PRODUCT` + `LINE_ITEM` branch and the residual `MODIFIER_ONLY` defensive branch entirely.
- `priceSelections` return shape: drop `nonLineDelta`. The return type becomes `{ totalDelta: Decimal; lineItems: SnapshotInvoiceLineItemDraft[] }`. `totalDelta` equals `sum(lineItems.lineTotal)`.
- `PricedSelection` type: drop `snapshotLinkProductDisplay`. Keep `snapshotLinkedProductId` (still loadable from the selection row).
- Callers updated:
  - [invoice.service.ts](src/modules/invoices/invoice.service.ts): drop the `nonLineDelta` accumulation; `totalAmount` computation simplifies.
  - [order.service.ts](src/modules/orders/order.service.ts) (`getPOSWorkspace`): same.
  - Discrepancy log in `buildInvoiceLineItems` that compared `lineTotal + nonLineDelta` to `totalDelta` becomes a trivial `lineTotal == totalDelta` check (or remove entirely).

#### Adjustment workspace ([adjustment-workspace.service.ts](src/modules/adjustment-workspace/adjustment-workspace.service.ts), [pending-changes-view.ts](src/modules/adjustment-workspace/pending-changes-view.ts))

- Proposal builder for `change_session_configuration_selection` pending edits:
  - For `FINANCIAL + (FIXED | TIERED)` edits: continue emitting `SESSION_CONFIGURATION` delta lines as today (with spec-93 verb prefixes).
  - For `FINANCIAL + LINKED_PRODUCT` edits: emit `ADD_ON` delta lines instead. Description: same verb prefix + `formatSelectionDescription(...)` output. Price: live product price for adds, snapshotted product price for removes (looked up via the base composition).
  - For `OPERATIONAL` edits: continue emitting zero-contribution per spec 92a.
- Finalize:
  - `finalizeSessionConfigurationSelectionEdits` (existing helper) iterates the pending edits and calls `applySessionConfigurationEditFromWorkspace`. For `LINKED_PRODUCT` edits, the helper materializes the add-on (insert) or deletes both (remove). The placeholder-to-real-id remap routes `causeOrderEntityId` to either the selection id (for FIXED/TIERED) or the add-on id (for LINKED_PRODUCT).
  - Chosen implementation: adjustment invoices are created from the proposal's delta lines, not by recomputing from `OrderAddOn` rows at invoice-write time. For `LINKED_PRODUCT` session-config edits, the proposal emits an `ADD_ON` delta whose `description` / `label` already includes the spec-93 verb prefix, and finalize remaps the placeholder add-on id to the real `OrderAddOn.id` for `causeOrderEntityId`. This preserves the verb-prefixed description regardless of whether the add-on was just materialized or existed in the base composition.

#### POS workspace ([order.service.ts:getPOSWorkspace](src/modules/orders/order.service.ts#L307))

- Per-package `sessionConfigurationSummary` continues to list all selections (including `LINKED_PRODUCT`) so the chip can show "Config: Cake, 30–45 Days".
- Per-package `sessionConfigurationSubtotal` excludes `LINKED_PRODUCT` selections (they contribute zero via the pricing module now). The fee line on the summary chip reads only fixed/tiered fees. Linked products show in the existing add-ons section of the package card.
- Order-wide `sessionConfigurationTotal` correspondingly excludes linked-product. `addOnTotal` correspondingly includes the materialized linked add-ons.
- No data-shape changes to the workspace return type; only the totals' composition shifts.

#### Schema: drop `linkProductDisplay` and the enum

- Migration `DROP COLUMN "linkProductDisplay" FROM "session_configurations"`.
- Migration `DROP COLUMN "snapshotLinkProductDisplay" FROM "order_package_session_configuration_selections"`.
- Migration `DROP TYPE "SessionConfigurationLinkProductDisplay"`.
- Prisma schema: remove the enum, remove the two columns, remove the back-references.
- Admin form / schema: remove the now-orphan zod refinement on `linkProductDisplay`. The field disappears entirely. If the admin form rendered any UI for it (after spec 93 reduced it to a single-value field with an inline note), remove that JSX too.

#### Tests

- Migration:
  - Fixture: a pre-lock order with one `LINKED_PRODUCT` selection at `snapshotPriceDelta = 5.000`, no `orderAddOnId`. Run migration. Assert: selection now has `orderAddOnId` set, `snapshotPriceDelta = 0`; new `OrderAddOn` exists with `priceSnapshot = 5.000`, `quantity = 1`, correct `productId` and `orderPackageId`.
  - Fixture: a locked order with one `LINKED_PRODUCT` selection. Run migration. Assert: selection unchanged (`orderAddOnId IS NULL`, `snapshotPriceDelta = 5.000`); no new `OrderAddOn` created.
  - Drop-column assertion: schema introspection confirms `linkProductDisplay` and `snapshotLinkProductDisplay` columns are gone.
- Selection service:
  - Inserting a new `LINKED_PRODUCT` selection creates both the selection and a matching `OrderAddOn` in one transaction. Both rows reference each other correctly.
  - Removing a `LINKED_PRODUCT` selection deletes both rows.
  - Manual deletion of a selection-owned `OrderAddOn` via the add-on service throws `OrderAddOnOwnedBySessionConfigurationError`. The selection and the add-on both remain.
- Pricing module:
  - `priceSingleSelection` for `LINKED_PRODUCT` returns zero delta and no line item.
  - `priceSelections` return shape no longer has `nonLineDelta`. Callers (invoice service, POS workspace) compile and pass tests.
- Invoice generation:
  - Pre-lock order with one `LINKED_PRODUCT` selection generates a locked invoice containing **no `SESSION_CONFIGURATION` line** and one `ADD_ON` line for the linked product. Invoice total matches the OrderAddOn's price contribution.
  - Order with one `FIXED` selection and one `LINKED_PRODUCT` selection generates one `SESSION_CONFIGURATION` line (FIXED) and one `ADD_ON` line (LINKED_PRODUCT). Both totals correct.
- POS workspace:
  - `sessionConfigurationTotal` excludes the linked-product price contribution.
  - `addOnTotal` includes the materialized add-on.
  - Order grand total equals the sum from both. No double counting.
- Adjustment workspace:
  - Pending `change_session_configuration_selection` for a `LINKED_PRODUCT` config: proposal emits an `ADD_ON` delta line with the spec-93 verb prefix (e.g. `"Added: Cake"`).
  - Finalize with one `LINKED_PRODUCT` add edit: adjustment invoice contains one `ADD_ON` line with the verb-prefixed description. A new `OrderAddOn` exists; the selection row exists with `orderAddOnId` set.
  - Finalize with one `LINKED_PRODUCT` remove edit: adjustment invoice contains a negative-priced `ADD_ON` line. Both the selection row and the `OrderAddOn` row are deleted.
- Reporting attribution (smoke test):
  - With a config-driven cake add-on and a manually-added cake add-on on the same order, a query `OrderAddOn LEFT JOIN OrderPackageSessionConfigurationSelection ON selection.orderAddOnId = addOn.id` distinguishes the two.

### Out of Scope

- Quantity / counter linked-product selections. Toggle-only MVP. Future work will let a `COUNTER` config + `LINKED_PRODUCT` pricing produce a `quantity > 1` add-on.
- Retroactive migration of locked orders. They keep their pre-spec-94 shape forever.
- Customer-portal / customer-facing UI changes beyond what naturally follows from invoice rendering (linked-product configs now show under "Add-Ons" instead of "Session Configuration" on customer invoices — this is the desired effect).
- Re-architecting the add-on service.
- Permission changes.
- Inventory deduction logic. Once add-ons exist, the existing inventory layer (if any) picks them up — out of scope to extend it here.

## Implementation Direction

### 1. Migration order matters

The migration must run inside a single Prisma migration SQL file:

1. `ALTER TABLE` to add the `orderAddOnId` column on selections (nullable).
2. Data migration: for each qualifying selection, insert the `OrderAddOn`, then update the selection. Use a CTE or a `DO` block; run as a single transaction. Roll back on any error.
3. `ALTER TABLE` to drop the `linkProductDisplay` columns on both tables.
4. `DROP TYPE` the enum.
5. Add the new FK constraint and index.

Verify the data step completes successfully on a copy of production data before merging.

### 2. Selection service: order of operations

Insert path (new `LINKED_PRODUCT`):
1. Inside the transaction, create the `OrderAddOn`.
2. Build the selection snapshot (with `orderAddOnId = newAddOn.id`, `snapshotPriceDelta = 0`).
3. Insert the selection row.

Delete path (removed `LINKED_PRODUCT`):
1. Read the existing selection row to capture `orderAddOnId`.
2. Delete the selection row.
3. Delete the `OrderAddOn` by id (now safe: the FK constraint is satisfied because the selection no longer references it).

Update path (existing `LINKED_PRODUCT`, no value change):
1. Refresh the selection snapshot fields except `orderAddOnId` and `snapshotPriceDelta`.
2. No add-on mutation.

### 3. Add-on service guard

A small, targeted change. The add-on service's delete function reads the selection table to see if the target add-on is owned:

```text
const owner = await tx.orderPackageSessionConfigurationSelection.findFirst({
  where: { orderAddOnId: addOnId },
  select: { id: true, snapshotLabel: true }
});
if (owner) throw new OrderAddOnOwnedBySessionConfigurationError(owner.snapshotLabel);
```

This read is cheap (indexed by the new `@@index([orderAddOnId])`). The error message references the config name so staff know which Configure Session row to clear.

### 4. POS workspace summary shift

`sessionConfigurationSubtotal` will drop by the cumulative linked-product price for any order that has linked-product selections. `addOnTotal` will rise by the same amount. Order grand totals do not change. Customers' invoice totals do not change.

If any UI text reads "Session configurations: +X KD" prominently, verify it doesn't surprise staff who were used to seeing the linked-product contribution there. Recommend a one-line release note for the studio team.

### 5. Adjustment-invoice line type for `LINKED_PRODUCT` workspace edits

The proposal builder must look up the live `Product.canonicalPrice` (for adds) or the existing `OrderAddOn.priceSnapshot` (for removes) — not the `SessionConfiguration.fixedPriceDelta`, which is irrelevant for `LINKED_PRODUCT`. The lookup is the same that the existing `add_line` workspace edit performs; reuse that helper.

### 6. Wiring assertions (per the review-flow feedback memory)

After this spec:
- `OrderAddOn` creation/deletion via the selection service is exercised by `writeOrderPackageSelections` (selection-driven path) and by `applySessionConfigurationEditFromWorkspace` (workspace finalize path).
- `OrderAddOnOwnedBySessionConfigurationError` is thrown from the add-on service and surfaced in at least one UI action's error state (whatever existing UI deletes add-ons).
- `priceSelections` callers no longer reference `nonLineDelta`. Grep returns zero references in production code.
- `linkProductDisplay` / `snapshotLinkProductDisplay` / `SessionConfigurationLinkProductDisplay` references → zero in production code, only allowed in the migration SQL.

## Observability Checklist

### Dashboards / Metrics

- Counter: `session_configuration.linked_product.materialized` per OrderAddOn creation from the selection service. Increments on toggle-on.
- Counter: `session_configuration.linked_product.demolished` per OrderAddOn deletion from the selection service. Increments on toggle-off.
- Counter: `add_on.delete_blocked_by_session_configuration` per refused manual deletion. Spikes here suggest UX confusion — staff trying to remove via the add-on UI instead of Configure Session.
- Migration log: row count of selections migrated (pre-lock) vs. skipped (locked). Useful for the post-deploy audit.

### Rollback Plan

- Schema: down-migration restores the dropped columns and enum, drops the `orderAddOnId` column. Cannot reconstruct the pre-migration `snapshotPriceDelta` values that were zeroed out — the data migration is not idempotent on rollback. If you must roll back, restore from backup. Document this.
- Code: reverting commits restores the pre-spec-94 behavior. Newly created `OrderAddOn` rows from the spec-94 window stay in the database; without spec-94 code they become orphaned but harmless (they continue to appear in the add-ons section). The selection rows that reference them will fail to render their `orderAddOnId` FK if Prisma client is regenerated against the old schema — practical effect: a rollback would require a follow-up cleanup pass deleting selection-owned add-ons and restoring `snapshotPriceDelta` from the locked invoice line item (or from backup).
- Recommendation: ship spec 94 only with a backup snapshot taken at deploy time. Treat it as a one-way migration.

### Customer-Visible Surface

- Customers (new invoices post-deploy): linked-product session configurations now appear in the customer invoice's Add-Ons section as normal product lines, not under "Session Configuration." Customer total unchanged; only the line's grouping label moves.
- Customers (locked invoices pre-deploy): no change. Their `SESSION_CONFIGURATION` lines remain as historical records.
- Staff (POS): linked products on the package card render in the existing add-on display instead of the session-config summary chip. The Configure Session toggle still produces them.
- Staff (admin): the linked-product display-mode field is gone from the configuration form (it had one valid value post-spec-93; now it has zero).
- Staff (add-ons UI): refused deletion of a config-owned add-on shows an inline error with the originating configuration's name.

## Post-Implementation

- Update `context/architecture-summary.md` to describe the new `OrderAddOn` ↔ `OrderPackageSessionConfigurationSelection.orderAddOnId` link and the "selection service is the only writer of selection-owned add-ons" invariant.
- Update `context/progress-tracker.md`.
- Reproduce a fresh end-to-end flow on a pre-lock and post-lock order with linked-product configs and confirm the new add-on path produces correct invoices, correct adjustment invoices, and correct reporting joins.
- Take a database backup before deploying — the data migration is one-way (see Rollback).

## Acceptance Criteria

- `OrderPackageSessionConfigurationSelection.orderAddOnId` exists with FK to `OrderAddOn(id)` and an index. The schema introspection confirms.
- `SessionConfiguration.linkProductDisplay`, `OrderPackageSessionConfigurationSelection.snapshotLinkProductDisplay`, and the `SessionConfigurationLinkProductDisplay` enum are removed from the Prisma schema. Grep returns zero references in `src/` and `app/` (allowed only in the migration SQL).
- Migration runs cleanly on a fresh database and on a snapshot containing pre-lock and locked orders with `LINKED_PRODUCT` selections. Asserted by:
  - Pre-lock selections have `orderAddOnId IS NOT NULL` and `snapshotPriceDelta = 0`. Matching `OrderAddOn` rows exist with `priceSnapshot` equal to the pre-migration `snapshotPriceDelta`.
  - Locked-order selections are untouched (`orderAddOnId IS NULL`, `snapshotPriceDelta` unchanged).
- Inserting a new `LINKED_PRODUCT` selection via `writeOrderPackageSelections` creates both the selection and an `OrderAddOn` in one transaction. Removing the selection deletes both rows.
- Attempting to delete a selection-owned `OrderAddOn` via the add-on service throws `OrderAddOnOwnedBySessionConfigurationError`. The selection and add-on both remain.
- `priceSelections` no longer returns `nonLineDelta`. Grep for `nonLineDelta` in production code returns zero hits.
- Invoice generation on a pre-lock order with one `LINKED_PRODUCT` selection produces no `SESSION_CONFIGURATION` `InvoiceLineItem` for that selection and exactly one `ADD_ON` line for the materialized product. Invoice total matches.
- `getPOSWorkspace` order-wide totals match the sum of per-package totals; `sessionConfigurationTotal` no longer includes linked-product contributions; `addOnTotal` does.
- Workspace finalize on a `change_session_configuration_selection` edit for a `LINKED_PRODUCT` config produces an `ADD_ON` `InvoiceLineItem` (not `SESSION_CONFIGURATION`) with the spec-93 verb prefix in its description. The selection and the `OrderAddOn` are both written/deleted in the same finalize transaction.
- A locked-invoice render against a pre-spec-94 locked order still shows the `SESSION_CONFIGURATION` line item — assertion that historical data is preserved.
- A grep for `db.orderPackageSessionConfigurationSelection.(create|update|delete*)` outside `src/modules/session-configurations/session-configuration-selection.service.ts` returns zero hits; reset handlers, including the session-configuration reset service, must delegate selection-row cleanup to `session-configuration-selection.service.ts`.
- `npm run build` passes.
- `npm run lint` passes.
