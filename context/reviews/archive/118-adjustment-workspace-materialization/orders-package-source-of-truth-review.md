# Orders Package Source-of-Truth Review

Date: 2026-05-20  
Scope: Prisma schema, migrations, git history, Orders, Adjustment Workspace, composition projections, invoices, activity/audit, and commission hooks.  
Constraint: investigation/design review only; no code changes.

## Executive Summary

The package-upgrade bugs are not just UI bugs.

The current system has two different truths:

- Draft and pre-lock operational composition is persisted on `OrderPackage`, `OrderAddOn`, `OrderPackageItemUpgrade`, and session configuration selection rows.
- Post-lock finalized adjustment composition is not materialized back into those operational rows except for session configuration selection edits. It is reconstructed by taking the current order rows and applying finalized adjustment invoice line items as a projection.

That split explains the observed behavior:

- Pre-lock Basic -> Standard mutates `OrderPackage.packageId`, so the order no longer has the original package identity on the order package line. Only the original price snapshot remains.
- Post-lock package upgrades are visible in Overview -> Deliverables because that surface reads `OrderCompositionViewModel`, which applies finalized adjustment invoice lines.
- The order header/package card still reads `order.finalPackageName` from `getOrderHubById()`, which maps both original and final package names from the same current `OrderPackage.package` relation.
- Finalized Adjustment Workspace package changes emit financial activity (`INVOICE_ADJUSTED`) and workspace events, but not order timeline events that describe the package/add-on/deliverable operational change.

Recommendation:

- Immediate: fix the display/projection path and missing operational timeline events.
- Medium-term: persist operational current/final state per `OrderPackage` line while keeping invoices immutable snapshots. This is Option B below, ideally with a small operational change/audit record or enough structured `OrderActivity` metadata to support audit and commissions.
- Do not make invoice line items the long-term operational source of truth.

## 1. Current Schema Reality

### Booking Package Baseline

`BookingPackage` is the booking-time package line table:

- `bookingId`
- `packageId`
- `sessionTypeId`
- `quantity`
- `sortOrder`

It is unique by `[bookingId, packageId]`, not by line id carried into `OrderPackage`. There is no `bookingPackageId` on `OrderPackage`, so the booking baseline can be used as historical context but not as a stable per-order-package lineage key.

Relevant current schema: `prisma/schema.prisma` lines 533-552.

### Order

`Order` no longer has `originalPackageId`, `finalPackageId`, `originalPackagePriceSnapshot`, or `finalPackagePriceSnapshot`. It owns workflow state and relations:

- `selectedPhotoCount` as a synchronized cache.
- `addOns Json @default("[]")`, which still exists but is legacy/not the structured source.
- relations to `orderAddOns`, `packageItemUpgrades`, `packages`, `activities`, `adjustmentWorkspaces`, `invoices`.

Relevant current schema: `prisma/schema.prisma` lines 597-640.

### OrderPackage

`OrderPackage` is the current package-line structure:

- `packageId`: currently used as the package identity for the line.
- `sessionTypeId`: package line session-type scope.
- `originalPackagePriceSnapshot`: original/baseline package price.
- `finalPackagePriceSnapshot`: current/final package price snapshot.
- `selectedPhotoCount`
- `extraDigitalCount`
- `extraPrintCount`
- `sortOrder`

Critical gap: there is no `originalPackageId`, `currentPackageId`, `finalPackageId`, original package name snapshot, or booking package lineage reference on `OrderPackage`. The line has original price but only one package FK.

Relevant current schema: `prisma/schema.prisma` lines 642-667.

### OrderAddOn

`OrderAddOn` is the structured true add-on table:

- `orderId`
- optional `orderPackageId`
- `productId`
- `nameSnapshot`
- `priceSnapshot`
- `quantity`
- `notes`

It is also used by linked-product session configurations via `OrderPackageSessionConfigurationSelection.orderAddOnId`.

Relevant current schema: `prisma/schema.prisma` lines 791-812.

### OrderPackageItemUpgrade

Package deliverable upgrades are separated from add-ons:

- `orderId`
- `orderPackageId`
- `packageItemId`
- `nameSnapshot`
- `priceSnapshot`
- `quantity`
- `notes`

This tracks upgraded deliverables against the original `PackageItem`, but not package tier changes.

Relevant current schema: `prisma/schema.prisma` lines 814-835.

### Invoice and InvoiceLineItem

`Invoice` is the financial document:

- `invoiceType`: `DEPOSIT`, `FINAL`, `ADJUSTMENT`, `REFUND`, `CREDIT_NOTE`, `SALE`.
- `totalAmount`, `paidAmount`, `remainingAmount`, `status`, `isLocked`.
- `parentInvoiceId` links adjustments/credit notes/refunds to a parent.
- `lineItems` hold document composition snapshots.

`InvoiceLineItem` stores financial-document line snapshots:

- `lineType`: package base, package upgrade, add-on, extra photos, session configuration, etc.
- `description`, `quantity`, `unitPrice`, `lineTotal`.
- optional `causeOrderEntityKind` and `causeOrderEntityId`.

Important: invoice line items are persisted financial document state, not operational order state.

Relevant current schema: `prisma/schema.prisma` lines 837-881 and 951-970.

### AdjustmentWorkspace and Events

`AdjustmentWorkspace` stores:

- parent `invoiceId`
- `orderId`
- `status`
- ownership/version fields
- `baseSnapshotJson`
- `pendingChangesJson`
- optional `finalizedAdjustmentInvoiceId`

`AdjustmentWorkspaceEvent` stores workspace lifecycle/edit events:

- `eventType`
- `payloadJson`
- `actorUserId`

These rows are adjustment workflow state, not the final operational order state.

Relevant current schema: `prisma/schema.prisma` lines 884-928.

### OrderActivity and AuditLog

`OrderActivity` is the user-facing order timeline:

- `type`
- `title`
- `description`
- `metadata`

Current activity types include package/add-on related values:

- `PACKAGE_CHANGED`
- `ORDER_PACKAGE_ADDED`
- `ORDER_PACKAGE_LINE_CHANGED`
- `ORDER_PACKAGE_EXTRAS_CHANGED`
- `ADD_ON_CHANGED`
- `INVOICE_ADJUSTED`

`AuditLog` is structured audit:

- actor, entity, action, before/after, context.

Adjustment finalization writes `AuditLog` for the invoice and an `OrderActivity` of `INVOICE_ADJUSTED`, but not package/add-on operational `OrderActivity` entries for the edits inside the workspace.

Relevant current schema: `prisma/schema.prisma` lines 754-789.

### Current Field-to-Need Mapping

| Need | Current fields/tables | Assessment |
|---|---|---|
| Original package identity | `BookingPackage.packageId` weak baseline; `OrderActivity.metadata` sometimes; no stable `OrderPackage.originalPackageId` | Missing/fragile for order-level truth |
| Current/final package identity pre-lock | `OrderPackage.packageId` | Persisted operational state |
| Current/final package identity post-lock | finalized `AdjustmentWorkspace` + `ADJUSTMENT` invoice line items applied by composition projection | Computed projection, not materialized operational state |
| Original package price | `OrderPackage.originalPackagePriceSnapshot` | Persisted operational price snapshot |
| Current/final package price pre-lock | `OrderPackage.finalPackagePriceSnapshot` or current `Package.price` fallback | Persisted or catalog fallback |
| Current/final package price post-lock | adjustment invoice line deltas applied to snapshots | Persisted financial document state plus computed projection |
| Selected photo counts | `OrderPackage.selectedPhotoCount`, `extraDigitalCount`, `extraPrintCount`; `Order.selectedPhotoCount` cache | Persisted operational state pre-lock/direct writes; post-lock adjustment changes projected unless session config only |
| Add-ons | `OrderAddOn` | Persisted operational state for direct writes; post-lock workspace add/remove only projected unless materialized elsewhere |
| Upgraded deliverables | `OrderPackageItemUpgrade` for direct writes; adjustment deltas for workspace | Mixed persisted operational state and projection |
| Package item upgrades | `OrderPackageItemUpgrade` direct writes; `AdjustmentWorkspace.pendingChangesJson`/ADJ invoice line items post-lock | Mixed |

## 2. Historical Regression Check

### Explicit Order-level Package Fields Existed

The initial migration created:

- `orders.originalPackageId`
- `orders.finalPackageId`

with FKs to `packages`.

Evidence: `prisma/migrations/20260505000000_init/migration.sql` lines 97-103 and 169-173.

Feature 59 later added order-level price snapshots:

- `originalPackagePriceSnapshot`
- `finalPackagePriceSnapshot`

The migration search shows those fields in `20260512010000_lifecycle_schema_foundation`.

### Multi-package Migration Replaced Singular Order Fields

`20260513040000_multi_package_schema_foundation` introduced `booking_packages` and `order_packages`.

For `order_packages`, it created:

- one `packageId`
- `originalPackagePriceSnapshot`
- `finalPackagePriceSnapshot`
- selected and extra photo counts

The backfill copied `o.originalPackageId` into `order_packages.packageId`, and copied both price snapshots. It did not create separate original and final package identity columns on `order_packages`.

Evidence: `prisma/migrations/20260513040000_multi_package_schema_foundation/migration.sql` lines 15-29 and 111-149.

### Singular Fields Were Removed

`20260513120000_singular_package_field_retirement` dropped:

- `bookings.packageId`
- `bookings.sessionType`
- `orders.originalPackageId`
- `orders.finalPackageId`
- `orders.originalPackagePriceSnapshot`
- `orders.finalPackagePriceSnapshot`

Evidence: `prisma/migrations/20260513120000_singular_package_field_retirement/migration.sql` lines 1-13.

Git history confirms:

- `7b04905 feat: add multi-package schema foundation`
- `c9d509b feat: retire singular package fields for feature 70d`

The commit diff for `c9d509b` removes the `Order.originalPackage` and `Order.finalPackage` relations and the four singular order package fields.

### UpgradeRecord Was Only Documented

No migration or current Prisma model defines `UpgradeRecord`.

The superseded target data model documented:

- `Order.originalPackageId`
- `Order.finalPackageId`
- `UpgradeRecord` with `fromPackageId`, `toPackageId`, `previousPaidPackageAmount`, `upgradeCharge`, `changedByUserId`, and `reason`.

Evidence: `context/reviews/archive/architecture/target-data-model.md` lines 200-256.

The same document is explicitly superseded and says `UpgradeRecord` was deferred, so it should be treated as historical intent, not implementation direction.

## 3. Source-of-Truth Map

| UI/business need | Current source | Classification | Notes |
|---|---|---|---|
| Order header current package | `getOrderHubById()` -> `mapOrderRow()` -> `finalPackageName = formatOrderPackageNames(row.packages)` | Persisted operational state for direct/pre-lock only | It reads raw `OrderPackage.package`. It does not use effective post-lock composition. |
| Order header original package | Same as current package: `originalPackageName = formatOrderPackageNames(row.packages)` | UI-only derivation from current row | This is the direct cause of Basic -> Standard showing Original = Standard. |
| Order detail subtitle/package card | `order.finalPackageName` and `order.originalPackageName` | UI-only derivation | Page already loads `compositionModel`, but header still uses `order.*PackageName`. |
| Overview -> Deliverables | `getOrderCompositionViewModel({ orderId })` -> `toOverviewTab()` | Computed projection | For locked orders, this projection uses current order composition plus finalized adjustment invoice lines. |
| Production deliverables | `OrderCompositionViewModel.effectiveComposition` -> `toProductionDeliverables()` | Computed projection | Same effective source as Overview. |
| POS/sales package composition | `getPOSWorkspace()` from `OrderPackage`, `OrderAddOn`, `OrderPackageItemUpgrade`, session selections, extra-photo pricing | Persisted operational state plus live catalog/pricing fallback | Draft/current direct edit source. Locked sales current card can use composition projection. |
| Locked final invoice composition | `InvoiceLineItem` snapshots on locked `FINAL` invoice | Persisted financial document state | Immutable document content by service convention; DB trigger freezes invoice header fields, not line item rows. |
| Adjustment invoice composition | `ADJUSTMENT` `InvoiceLineItem` rows created from workspace deltas | Persisted financial document state | Adjustment invoices preserve financial deltas, not a normalized current package line. |
| Adjustment workspace pending composition | `AdjustmentWorkspace.baseSnapshotJson` + `pendingChangesJson` | Persisted staging state plus computed proposal | Good for staging/preview; not final operational state after finalization. |
| Effective post-lock composition | `getEffectiveCompositionForInvoice()` captures current order rows and applies finalized adjustment invoice lines | Computed projection | This is the current effective source for locked/adjusted display. |
| Reporting/order value | `FinancialCaseSummary`, `OrdersTableFinancialProjections`, invoices, payments, allocations, document applications | Persisted financial document state plus financial projection | Strong for money; weak for package mix reporting if package identity lives only in projections/descriptions. |
| Activity timeline package/add-on events | Direct POS edits write `ORDER_PACKAGE_LINE_CHANGED`, `ORDER_PACKAGE_EXTRAS_CHANGED`, `ADD_ON_CHANGED`; workspace finalization writes `INVOICE_ADJUSTED` and `AdjustmentWorkspaceEvent` | Mixed persisted activity/workspace event state | Missing user-facing package/add-on event on finalized workspace package edits. |
| Future commission basis | `syncUpgradeCommissionForOrder()` stub; package upgrade amount from invoice sync; no commission model | Not persisted | Current data is insufficient for robust future commission basis, especially post-lock adjustment upgrades. |

## 4. Gap Analysis

### Multi-package Orders

Multi-package is structurally supported by `BookingPackage` and `OrderPackage`. The gap is lineage:

- `OrderPackage` does not point to the source `BookingPackage`.
- `OrderPackage` has one package FK, so it cannot independently preserve original and current package identity.
- Matching order lines back to booking lines by `sortOrder`, `sessionTypeId`, or package name is possible only as a heuristic.

### Original vs Final/Current Package Tracking

The current order row can preserve original package price but not original package identity. Once `updateOrderPackage()` runs, it updates `OrderPackage.packageId` to the selected package and only preserves the price baseline.

Relevant service behavior: `src/modules/orders/order.service.ts` lines 1240-1247.

This is why `mapOrderRow()` cannot distinguish original from final: both names are mapped from `row.packages`.

Relevant mapping: `src/modules/orders/order.service.ts` lines 3047-3055.

### Post-lock Adjustment Upgrades

`finalizeWorkspace()` creates an adjustment invoice and marks the workspace finalized. It materializes session configuration edits, but package tier changes, package item upgrades, selected photo changes, and add-on changes are not written back to the operational order rows.

Relevant finalization flow: `src/modules/adjustment-workspace/adjustment-workspace.service.ts` lines 720-840.

Relevant invoice creation and activity: `src/modules/adjustment-workspace/adjustment-workspace.service.ts` lines 1696-1805.

The effective composition is then rebuilt by projection:

- capture current order rows,
- find finalized workspaces,
- apply finalized adjustment invoice line items.

Relevant projection flow: `src/modules/adjustment-workspace/adjustment-workspace.service.ts` lines 373-420.

This is useful display logic, but it is not a durable operational state table.

### Add-on and Deliverable Operational Ownership

Direct POS add-ons and package item upgrades are operational rows. Post-lock workspace add-ons/upgrades are financial deltas unless the edit is a session configuration selection that explicitly materializes.

This means there are two representations for "current add-ons/deliverables":

- direct operational rows,
- adjustment invoice deltas applied by projection.

That is fragile for database inspection, reporting, and future workflow logic.

### Package Upgrade Auditability

Direct package changes write `OrderActivityType.ORDER_PACKAGE_LINE_CHANGED` with structured metadata. Workspace package changes write:

- `AdjustmentWorkspaceEvent` entries for staging/finalization.
- `OrderActivityType.INVOICE_ADJUSTED` when the adjustment invoice is issued.

They do not write a package-specific `OrderActivity` after finalization. The user-facing order timeline therefore misses the package/add-on/deliverable operational story.

### Commission Calculation Later

Commission persistence is not implemented. The hook currently returns after checking positive upgrade amount and explicitly comments that persistence is future work.

The data gap is bigger than the stub:

- Pre-lock upgrade basis can be computed from `finalPackagePriceSnapshot - originalPackagePriceSnapshot`, but package identity is missing.
- Post-lock upgrade basis may exist only as an adjustment invoice line with generic cause ids and descriptions.
- There is no durable per-package-line upgrade record that says "line A moved from Basic to Standard at time T by user U, with commissionable delta X".

### Reporting Correctness

Financial reporting is stronger than package-mix reporting.

Money totals can be derived from invoices, adjustments, credit notes, refunds, allocations, and document applications. Package mix, original-vs-final mix, upgrade conversion, and commissionable upgrade reporting are fragile because post-lock composition is derived, and original package identity is absent from `OrderPackage`.

### Database Inspectability

A person inspecting the database cannot reliably answer:

- What was the original package for this order package line?
- What is the current package after finalized post-lock adjustments?
- Which package line did this adjustment package upgrade apply to?
- What current add-ons/deliverables does production own if they were added post-lock?
- Which upgrade delta is commissionable?

They must know application projection logic and replay invoice/workspace data.

## 5. Architecture Options

### Option A: Minimal UI/Projection Fix Only

Keep the schema as-is.

Implementation shape:

- Header/package card reads an effective composition/header projector instead of `order.finalPackageName`.
- Original package display uses the best available baseline, likely `BookingPackage` matched to order package lines by deterministic order/session type until schema is improved.
- Finalized workspace edits emit package/add-on/deliverable `OrderActivity` events in addition to `INVOICE_ADJUSTED`.

Pros:

- Fastest path to fix the visible bugs.
- No migration.
- Low immediate risk to locked invoice immutability.
- Aligns with current `OrderCompositionViewModel` direction.

Cons:

- Does not fix database inspectability.
- Original package identity remains heuristic after pre-lock mutations.
- Post-lock current state remains derived from financial adjustment documents.
- Future commissions still lack a durable basis.
- Reporting by original/current package remains fragile.

Migration/backfill:

- None.

Locked invoice immutability:

- Safe; invoices remain untouched.

UI simplicity:

- Improves consistency if all surfaces use one composition/header projector.
- Still requires careful projection code for original package fallback.

Commissions:

- Still blocked/fragile.

Reporting:

- Financial reports unchanged.
- Package reports remain projection-dependent.

Risk level:

- Low for immediate bugfix.
- High if treated as the final architecture.

### Option B: Persist Operational Current State on OrderPackage Lines

Keep invoices immutable snapshots, but make `OrderPackage` the operational state owner for each package line.

Implementation shape:

- Add durable original/current identity per line, for example:
  - `bookingPackageId` nullable FK for lineage where available.
  - `originalPackageId`.
  - `currentPackageId` or keep `packageId` as current and add `originalPackageId`.
  - original/current package name snapshots if package names are mutable or reporting needs historical labels.
  - original/current price snapshots with clear semantics.
- Finalized Adjustment Workspace changes materialize into operational rows:
  - package tier changes update current package/current price fields.
  - package item upgrades upsert `OrderPackageItemUpgrade`.
  - add-on adds/removes/upgrades upsert/delete/update `OrderAddOn`.
  - photo count changes update `OrderPackage.selectedPhotoCount`, `extraDigitalCount`, `extraPrintCount`.
  - session configuration finalization continues to use `OrderPackageSessionConfigurationSelection`.
- Adjustment invoices remain immutable financial deltas and keep their line item snapshots.
- `OrderActivity` records the operational package/add-on/deliverable changes.

Pros:

- Restores "database clearly holds operational state" for a specific order.
- Supports multi-package with line-specific original/current package.
- Makes header, cards, production, reporting, and commissions simpler.
- Keeps financial documents immutable and separate.
- Makes database inspection natural.

Cons:

- Requires schema migration and service changes.
- Backfill needs care because historical data may be ambiguous.
- Must define exactly when finalized adjustments materialize and what happens for cancelled/reversed adjustments.
- Risk of double-counting if projections continue to apply adjustment invoice lines after materialization without a cutover flag.

Migration/backfill:

- Add fields.
- Backfill `originalPackageId` from `BookingPackage` where line matching is unambiguous.
- For existing `OrderPackage.packageId`, treat it as current for unlocked/direct-edited orders.
- For locked orders with finalized workspaces, either:
  - conservative backfill current state from current rows only and mark `operationalStateBackfillConfidence = LOW`, or
  - replay finalized adjustment workspaces/invoices when line metadata is sufficient.
- Backfill original package name/price snapshots from `BookingPackage`/catalog and existing snapshots where possible.

Locked invoice immutability:

- Safe if operational rows change independently from `Invoice` and `InvoiceLineItem`.
- Historical invoice documents remain unchanged.

UI simplicity:

- High. Header and package cards can read operational state.
- Composition projectors become simpler because effective current state is already materialized.

Commissions:

- Strong. Commission basis can be computed from per-line original/current package snapshots and operational change events.

Reporting:

- Strong. Original/current package reporting no longer requires replaying financial documents.

Risk level:

- Medium to high for implementation, mainly because of migration/backfill and avoiding projection double-application.
- Best medium-term architecture fit.

### Option C: Add Explicit UpgradeRecord/Composition Change Ledger

Keep `OrderPackage` mostly as a baseline/current row and persist every composition mutation in an operational ledger.

Implementation shape:

- Add an operational ledger, for example `OrderCompositionChange` or focused records:
  - package tier change: from package, to package, line id, prices, actor, timestamp, source workspace/invoice.
  - add-on added/removed/quantity changed.
  - package item upgraded.
  - selected photo counts changed.
  - session configuration changed.
- Current state is derived from the ledger, not from invoice lines.
- Invoices remain immutable financial snapshots.

Pros:

- Excellent auditability.
- Natural commission basis if upgrade records are explicit.
- Can represent every change, including reversals and manager approvals.
- Avoids using financial invoices as operational history.

Cons:

- More complex read model.
- Current operational state is still derived unless paired with materialized current rows.
- Requires rigorous idempotency and replay semantics.
- More work than needed for the immediate bugs.

Migration/backfill:

- Add ledger tables.
- Backfill direct pre-lock changes only if activity/audit metadata is sufficient.
- Existing finalized workspace adjustments can potentially seed ledger entries from `pendingChangesJson` and finalized invoices.
- Ambiguous historical rows may need "imported/unknown" ledger events.

Locked invoice immutability:

- Safe.

UI simplicity:

- Medium to low unless a materialized current-state read model/table exists.

Commissions:

- Strong if ledger events include commissionable deltas.

Reporting:

- Strong for change/history reporting.
- Current package reporting requires ledger projection or materialization.

Risk level:

- High if introduced as the only operational state.
- Medium if added later as an audit/commission layer on top of Option B.

## 6. Recommendation

### Immediate Bugfix Path

Use Option A only as a short-term patch:

1. Add/use a composition header projector so the order header/package card reads the same effective package composition as Overview -> Deliverables.
2. Stop using `order.originalPackageName` from `mapOrderRow()` as authoritative original package display.
3. For immediate original package display, use `BookingPackage` baseline with clear line matching, while acknowledging this is a temporary fallback until `OrderPackage.originalPackageId` exists.
4. Emit package/add-on/deliverable `OrderActivity` records when Adjustment Workspace finalization includes:
   - `change_package_tier`
   - `upgrade_package_item`
   - add-on add/remove/quantity changes
   - selected photo changes
5. Keep `INVOICE_ADJUSTED` as the financial timeline event, but do not let it be the only event for operational composition changes.

### Medium-term Schema/Architecture Path

Implement Option B.

`OrderPackage` should be the operational current-state row for each package line, with explicit original and current/final identity. Finalized adjustments should materialize into operational order state in the same transaction that creates the adjustment invoice and marks the workspace finalized.

Recommended direction:

- Add `OrderPackage.originalPackageId`.
- Decide whether existing `OrderPackage.packageId` remains current package or is renamed/replaced by `currentPackageId`.
- Add `bookingPackageId` if lineage can be cleanly enforced for new orders.
- Add package name snapshots if package names are mutable or reporting needs stable historical labels.
- Make Adjustment Workspace finalization update operational rows after invoice creation, guarded by idempotency/version checks.
- Preserve adjustment invoices as immutable financial documents and audit evidence.
- Add tests proving composition projection does not double-apply finalized adjustments after materialization.

### What Should Not Be Done

- Do not rely on `InvoiceLineItem` or adjustment invoice descriptions as the only source of current operational package/add-on/deliverable truth.
- Do not reintroduce singular `Order.originalPackageId` / `Order.finalPackageId` as the main fix. That would break the multi-package model.
- Do not mutate locked final invoice line items to reflect post-lock changes.
- Do not keep header, Overview, POS, and production deliverables on separate derivation paths.
- Do not build future commission calculation on UI labels or invoice descriptions.

### What Should Be Deferred

- Full commission persistence can be deferred until the operational state model is fixed, but the schema should preserve enough package-change data to support it.
- A full event-sourced ledger can be deferred unless audit/reporting requirements demand replayable history. Option B can be designed so Option C can be added later.
- Perfect historical backfill for ambiguous old orders should be deferred or marked with confidence flags rather than guessed silently.

## 7. Test and Invariant Recommendations

### Immediate Regression Tests

1. Pre-lock package upgrade preserves original package display:
   - Start with Basic.
   - Upgrade line to Standard before invoice lock.
   - Header shows current/final Standard.
   - Header original shows Basic from a reliable baseline/projection.

2. Pre-lock package upgrade preserves original package price:
   - `OrderPackage.originalPackagePriceSnapshot` remains Basic price.
   - `OrderPackage.finalPackagePriceSnapshot` becomes Standard price.

3. Post-lock adjustment package upgrade updates all displays consistently:
   - Overview -> Deliverables shows upgraded/current package.
   - Header/package card shows same upgraded/current package.
   - Sales locked current composition shows same upgraded/current package.

4. Finalized adjustment emits both financial and operational timeline events:
   - `INVOICE_ADJUSTED` for the adjustment invoice.
   - `ORDER_PACKAGE_LINE_CHANGED` for package tier changes.
   - `ADD_ON_CHANGED` or a more specific package item event for deliverable/add-on changes.

5. Invoice snapshots remain immutable:
   - Locked final invoice line items do not change after finalized adjustment.
   - Adjustment invoice line items capture the delta.

### Medium-term Schema Invariants

1. Multi-package line identity:
   - Each `OrderPackage` line has stable original and current/final package identity.
   - Upgrading line A cannot alter line B.

2. Materialized adjustment state:
   - Finalizing `change_package_tier` updates the targeted `OrderPackage` current package fields.
   - Finalizing `upgrade_package_item` upserts the targeted `OrderPackageItemUpgrade`.
   - Finalizing add-on changes updates `OrderAddOn`.
   - Finalizing selected photo changes updates the targeted `OrderPackage` counts.

3. No double application:
   - After materialization, effective composition does not apply the same finalized adjustment invoice line twice.

4. Operational/financial separation:
   - Operational rows can change after lock.
   - Locked final invoice document rows do not change.
   - Adjustment/CREDIT_NOTE/REFUND documents capture financial deltas.

5. Commission basis:
   - A commissionable package upgrade amount can be computed from persisted operational data, not UI strings.
   - The computation is line-specific for multi-package orders.
   - Post-lock package upgrades have the same commission basis quality as pre-lock upgrades.

6. Reporting correctness:
   - Reports can group by original package and current/final package per package line.
   - Reports can distinguish package tier upgrade revenue from add-ons, extra photos, and package item upgrades.

## Bottom Line

The current design is halfway between persisted operational composition and financial-document replay. It works for some displays because projections are clever, but it does not meet the product expectation that a specific order's database rows clearly hold original package(s), current/final package(s), add-ons, deliverables, selected photo counts, and audit-ready package changes.

Use a projection fix now to repair the user-visible bugs, then move to line-level persisted operational current state. That preserves locked invoice immutability while giving Orders back enough operational truth for UI, reporting, audit, and future commissions.
