# 90 — Session Configurations: Pricing Engine & Order Integration

## Goal

Wire the selection-side data introduced in spec 88 into the order/invoice pricing pipeline so that:

- Running POS totals reflect session-configuration price deltas while an order is in draft.
- Invoice generation snapshots configuration-driven amounts as proper `InvoiceLineItem` rows.
- Invoice generation **refuses** to lock when any active **required** configuration on an order package has no selection.

No selection-writing UI yet (that ships in spec 91). This spec assumes selection rows can already exist in the database (test fixtures write them directly) and makes the rest of the pricing pipeline aware of them via two new shared modules:

- `session-configuration-pricing.ts` — pure function: selections → `{ totalDelta, invoiceLines[] }`. Single source of truth for "how do selections turn into money."
- `session-configuration-resolver.ts` — read function: `(orderPackageId | orderId)` → resolved view of active configs + current selections + missing-required list. Single source of truth for "what configs apply here and which are unsatisfied."

Both modules will be reused by the Configure Session panel (91), post-lock edit routing (92), and invoice display (93). Spec 90 is the first consumer.

## Read First

- `context/feature-specs/88-session-configurations-data-model.md` — schema and the snapshot contract (selection rows are self-describing once written).
- `context/feature-specs/89-session-configurations-admin-crud.md` — centralization pattern (`src/modules/session-configurations/` is the only DB-touching layer for this domain).
- [src/modules/invoices/invoice.service.ts:159-247](src/modules/invoices/invoice.service.ts#L159-L247) — `createInvoiceForOrderWithClient`; the lock/gate site.
- [src/modules/invoices/invoice.service.ts:905-936](src/modules/invoices/invoice.service.ts#L905-L936) — `snapshotInvoiceLineItemsWithClient` and the precondition that it only runs once.
- [src/modules/invoices/invoice.service.ts:1328-1415](src/modules/invoices/invoice.service.ts#L1328-L1415) — `buildInvoiceLineItems`; where new line types are emitted.
- [src/modules/orders/order.service.ts:307](src/modules/orders/order.service.ts#L307) — `getPOSWorkspace`; the draft-side workspace aggregator that needs the running total.
- [src/modules/orders/order.service.ts:927-947](src/modules/orders/order.service.ts#L927-L947) — example of how `selectionAddOnTotal` is built from `manualAddOnTotal + extraPhotoCharge` — session-config deltas join this family.
- [prisma/schema.prisma:101-109](prisma/schema.prisma#L101-L109) — `InvoiceLineType` enum; one new value gets added here.
- [src/modules/orders/order-settlement.ts](src/modules/orders/order-settlement.ts) — `deriveLockedFinancialSidebarSummary`; locked-side aggregator. Audit-only: it reads from invoice line items, so once spec 90 writes config lines there, the locked sidebar automatically reflects them with no code change here.

## Rules

- **Snapshot is the source of truth.** All pricing math in this spec reads `snapshotPriceDelta`, `snapshotPricingMode`, `snapshotInputType`, `snapshotLinkProductDisplay`, and `snapshotLinkedProductId` from `OrderPackageSessionConfigurationSelection` rows. Do **not** join back to `SessionConfiguration` or `SessionConfigurationOption` for any pricing decision. A code path that reads `option.priceDelta` (live) instead of `selection.snapshotPriceDelta` is a review-blocker. (Resolver is allowed to read live definitions — it's answering "what's available now," not "what was priced.")
- **One pricing path.** `session-configuration-pricing.ts` is the only place that turns selections into money. `buildInvoiceLineItems` calls it; `getPOSWorkspace` calls it. No other module recomputes a config delta. Duplication is a review-blocker.
- **No selection writes in this spec.** No new code path inserts into or updates `OrderPackageSessionConfigurationSelection`. Selection-writing lives in spec 91. Tests that need selection rows insert them via direct Prisma calls in fixtures, not via a service.
- **Required gate is hard.** If an order package has any active required configuration without a selection, `createInvoiceForOrderWithClient` throws `SessionConfigurationRequiredSelectionMissingError` with `{ orderPackageId, missingConfigurationCodes[] }` and creates nothing. A test must reproduce this; running it twice (after fixing) must succeed deterministically.
- **Required is checked against the *live* `SessionConfiguration` table.** It's the only "currently required" signal — historical selections don't carry a `wasRequired` flag, and adding one would let an admin retroactively lock pre-existing orders by toggling required. Specifically: a config is considered required for gating if `isActive=true AND required=true` at the moment of invoice generation.
- **Operational-only configs emit no invoice line.** `snapshotPricingMode = NONE` selections influence neither totals nor invoice rows. They are operational metadata only (consumed by future workflows, not this spec).
- **`LINKED_PRODUCT` selections branch on display mode:**
  - `LINE_ITEM` → emit an invoice line with the snapshot price delta (acts like an add-on for invoice presentation).
  - `MODIFIER_ONLY` → emit no invoice line; total contribution is still counted via the pricing module's `totalDelta` for POS sidebar parity, but the line list does not include it. **Decision point:** invoice generation must use `invoiceLines[]` for line snapshotting *and* must include `MODIFIER_ONLY` deltas in the invoice's `totalAmount` so the locked total matches what the POS sidebar showed pre-lock. The pricing module returns both `lineItems[]` and `nonLineDelta` for exactly this split.
- **No retroactive recompute on existing invoices.** This spec does not backfill `InvoiceLineItem` rows on already-locked invoices, and does not change `closeInvoice` behavior beyond what already routes through `buildInvoiceLineItems`. New invoices created after this spec ships pick up session-config lines naturally.
- **Migration naming:** `20260518030000_invoice_line_type_session_configuration` (next slot after spec 88's `20260518020000_*`).

## Scope

### In Scope

#### Schema migration

- Add enum value `SESSION_CONFIGURATION` to `InvoiceLineType` in [prisma/schema.prisma](prisma/schema.prisma) (single `ALTER TYPE` migration). Used for both fixed/tiered/counter deltas and for `LINKED_PRODUCT + LINE_ITEM` deltas. Reason: from a customer-facing invoice perspective, all are "session configuration charges" — distinguishing them by a sub-type adds noise without informing layout. Internal differentiation (which mode produced which line) is recoverable from the selection row via `causeOrderEntityKind` (see next bullet).
- Add enum value `SESSION_CONFIGURATION_SELECTION` to `OrderEntityKind` in [prisma/schema.prisma:111-115](prisma/schema.prisma#L111-L115). The `InvoiceLineItem.causeOrderEntityId` for a config-driven line points back to the originating selection row, enabling future drill-down without joining via brittle string keys.

#### Module: `src/modules/session-configurations/`

- `session-configuration-pricing.ts`:
  - Pure module — imports only types. No `db` import.
  - Input type:
    ```ts
    type PricedSelection = {
      id: string;                          // selection row id (used for causeOrderEntityId)
      snapshotConfigurationCode: string;
      snapshotLabel: string;
      snapshotPriceDelta: Prisma.Decimal;
      snapshotPricingMode: SessionConfigurationPricingMode;
      snapshotInputType: SessionConfigurationInputType;
      snapshotLinkProductDisplay: SessionConfigurationLinkProductDisplay | null;
      snapshotLinkedProductId: string | null;
      numericValue: Prisma.Decimal | null;  // for COUNTER selections
    };
    ```
  - Public functions:
    - `priceSelections(selections: PricedSelection[]): { totalDelta: Prisma.Decimal; lineItems: SnapshotInvoiceLineItemDraft[]; nonLineDelta: Prisma.Decimal }`.
    - `priceSingleSelection(selection: PricedSelection): { lineDelta: Prisma.Decimal | null; nonLineDelta: Prisma.Decimal | null; lineItem: SnapshotInvoiceLineItemDraft | null }` — exposed for the Configure Session panel (spec 91) to render per-row "+X KD" hints from the same math.
  - Behavior matrix:

    | snapshotPricingMode | snapshotInputType | Result |
    |---|---|---|
    | `NONE` | any | `lineDelta = 0`, `nonLineDelta = 0`, `lineItem = null` |
    | `FIXED` | any | `lineDelta = snapshotPriceDelta`, line emitted |
    | `TIERED` | `SELECT` or `COUNTER` | `lineDelta = snapshotPriceDelta`, line emitted |
    | `LINKED_PRODUCT` + display `LINE_ITEM` | any | `lineDelta = snapshotPriceDelta`, line emitted |
    | `LINKED_PRODUCT` + display `MODIFIER_ONLY` | any | `nonLineDelta = snapshotPriceDelta`, **no** line emitted |
    | `(other modes never appear post-spec-88-validation)` | — | thrown `SessionConfigurationPricingError` |
  - `SnapshotInvoiceLineItemDraft` matches the shape `buildInvoiceLineItems` already produces (`lineType`, `description`, `quantity = 1`, `unitPrice`, `lineTotal`, `sortOrder`, `causeOrderEntityKind`, `causeOrderEntityId`), but with `sortOrder` left as `null`/`undefined` — the caller assigns sort order in context.
  - Description format: `${snapshotLabel}` for non-`COUNTER`, `${snapshotLabel} (×${numericValue})` for `COUNTER`.
- `session-configuration-resolver.ts`:
  - Reads the database — lives in this module, not in `order.service.ts`.
  - `resolveOrderPackageSessionConfigurations(client: DbClient, orderPackageId: string): Promise<ResolvedOrderPackageConfigs>`.
  - Returns:
    ```ts
    type ResolvedOrderPackageConfigs = {
      orderPackageId: string;
      sessionTypeId: string;
      activeConfigurations: ResolvedConfigDefinition[]; // live, isActive=true, for this sessionTypeId
      selections: ResolvedSelection[];                  // existing selection rows for this orderPackage
      missingRequiredConfigurationCodes: string[];      // active+required configs with no selection
    };
    ```
  - `resolveOrderSessionConfigurations(client: DbClient, orderId: string): Promise<ResolvedOrderPackageConfigs[]>` — convenience wrapper for whole-order checks.
  - The resolver reads live `SessionConfiguration` rows because it answers "what is currently available / required." Pricing reads only snapshots from `selections`. These two functions are explicitly separate by responsibility.

#### Invoice service integration ([src/modules/invoices/invoice.service.ts](src/modules/invoices/invoice.service.ts))

- In `createInvoiceForOrderWithClient`, **after** the `existingInvoice` short-circuit and **before** computing `totalAmount`:
  1. Call `resolveOrderSessionConfigurations(client, order.id)`.
  2. If any returned package has a non-empty `missingRequiredConfigurationCodes`, throw `SessionConfigurationRequiredSelectionMissingError` with the aggregated list `{ orderPackageId, missingConfigurationCodes }[]`. The error must be a typed class exported from `src/modules/session-configurations/session-configuration-resolver.ts` so the action layer can route it to a user-facing message in spec 91/93.
  3. Collect all selections across all returned packages and call `priceSelections(...)`. Take `totalDelta = lineDelta total + nonLineDelta total` — this is what gets added to `totalAmount`.
- In `buildInvoiceLineItems`:
  1. After existing package-base / extras / add-ons loops, for each order package, call `priceSelections(selectionRowsForPackage)`.
  2. Append the returned `lineItems`, assigning the running `sortOrder++` per item. Each line carries `causeOrderEntityKind: SESSION_CONFIGURATION_SELECTION` and `causeOrderEntityId: selection.id`.
  3. `MODIFIER_ONLY` selections produce no line but the caller still added their delta into `totalAmount` (step above). The line/total consistency invariant holds because `priceSelections` returns both halves explicitly.
- Add a read of `OrderPackage.sessionConfigurationSelections` to the `client.order.findUnique` include in both functions so the data is in hand. Use a `select` projection that only pulls the snapshot columns the pricing module needs — keep the query lean.

#### POS workspace integration ([src/modules/orders/order.service.ts](src/modules/orders/order.service.ts))

- In `getPOSWorkspace` (and the corresponding selection-workspace aggregator that already builds the draft sidebar), include `sessionConfigurationSelections` on `order.packages` and add a `sessionConfigurationTotal` field to the returned shape derived via `priceSelections`. Surfacing into the actual sidebar UI (Total Source row, Payment Summary) is spec 91's job — but the **data must be present on the workspace** here so spec 91's UI is a pure render change. Add the field name to the existing workspace return type.
- No change to `deriveLockedFinancialSidebarSummary` — once spec 90 writes config lines into `InvoiceLineItem` at lock time, the locked sidebar inherits them through the existing total-source path.

#### Errors

- `src/modules/session-configurations/session-configuration-resolver.ts` exports:
  - `class SessionConfigurationRequiredSelectionMissingError extends Error` with `details: { orderPackageId: string; missingConfigurationCodes: string[] }[]`.
- `src/modules/session-configurations/session-configuration-pricing.ts` exports:
  - `class SessionConfigurationPricingError extends Error` for unreachable mode/input combinations (defense-in-depth; should never fire given spec 88 + 89 validation).

#### Tests

- Pricing module (pure, no DB):
  - `FIXED` → emits one line with `snapshotPriceDelta`, `nonLineDelta = 0`.
  - `TIERED` + `SELECT` → emits one line, label = snapshot label.
  - `TIERED` + `COUNTER` → emits one line, description appends `(×N)`.
  - `LINKED_PRODUCT` + `LINE_ITEM` → emits one line.
  - `LINKED_PRODUCT` + `MODIFIER_ONLY` → emits zero lines, `nonLineDelta = snapshotPriceDelta`.
  - `NONE` → emits zero lines, zero delta.
  - `totalDelta = sum(lineDeltas) + sum(nonLineDeltas)` for a mixed input set.
- Resolver:
  - On a fixture order package with two active configs (one required, one optional) and one selection (the optional), `missingRequiredConfigurationCodes` contains exactly the required-but-unselected code.
  - Marking the unsatisfied config `isActive=false` (admin "archives" it) makes the missing list empty on next call.
  - Marking the unsatisfied config `required=false` makes the missing list empty on next call.
- Invoice generation:
  - Order with one required+unselected config → `createInvoiceForOrder` throws `SessionConfigurationRequiredSelectionMissingError`; no invoice row created (assert by counting `Invoice` rows before/after).
  - Same order after the missing selection is inserted (test fixture writes directly) → invoice created successfully, `totalAmount` equals `packageTotal + addOnTotal + extraPhotoTotal + sessionConfigDeltaTotal`.
  - Locking the invoice (closeInvoice) snapshots `InvoiceLineItem` rows including one `SESSION_CONFIGURATION` line per non-`MODIFIER_ONLY` selection, each with `causeOrderEntityKind = SESSION_CONFIGURATION_SELECTION` and `causeOrderEntityId = selectionRow.id`.
  - `MODIFIER_ONLY` selection: no `InvoiceLineItem` row appears for it, but the invoice's `totalAmount` still includes its delta.
- POS workspace:
  - On the same fixture order pre-lock, `getPOSWorkspace(orderId).sessionConfigurationTotal` equals the `priceSelections(...).totalDelta` on the same selection set.
- Locked sidebar (regression):
  - After lock, `deriveLockedFinancialSidebarSummary` shows the correct `Customer Total` including the session-config lines — no code change to this helper required, just verify the existing path picks them up.

### Out of Scope

- Selection-writing service and the Configure Session panel — **spec 91**. After this spec ships, no production code path inserts into `OrderPackageSessionConfigurationSelection`; tests do it directly.
- Summary chip on the package card and the "Configure Session" button — **spec 91**.
- Post-lock edit routing (operational vs financial paths through Adjustment Workspace) — **spec 92**.
- Customer-facing invoice/receipt presentation tweaks beyond the new line type appearing in the existing layout — **spec 93**.
- Any change to `deriveLockedFinancialSidebarSummary`, `getLinkedFinancialDocumentsForOrder`, or settlement math. Spec 90's only locked-side touch is data — `InvoiceLineItem` rows — flowing through existing code paths.
- Backfilling existing locked invoices with config lines. Greenfield from this spec forward.
- Reporting / commission integration. Not in this feature's phase per `context/reviews/session-config-plan.md`.

## Implementation Direction

### 1. Build the pricing module first

`session-configuration-pricing.ts` has no dependencies and is fully unit-testable. Land it with its tests before touching the invoice service. This keeps the pricing contract reviewable in isolation.

### 2. Build the resolver next

`session-configuration-resolver.ts` queries Prisma but has no callers in production until the invoice service wires it up. Land it with resolver tests using fixture orders.

### 3. Wire required-gate before pricing wiring

In `createInvoiceForOrderWithClient`, gate first, then total. If the gate fails the function must return without side-effects — Prisma transactions roll back automatically, but the gate is cheap and should run before any writes anyway.

### 4. Wire `buildInvoiceLineItems`

Pull session-config selections into the `client.order.findUnique` include with a narrow snapshot-only `select`. Loop per order package, call `priceSelections`, append. Assign `sortOrder` from the running counter. Each emitted line carries `causeOrderEntityKind: SESSION_CONFIGURATION_SELECTION` and `causeOrderEntityId: selection.id`.

### 5. Wire `getPOSWorkspace`

Add `sessionConfigurationSelections` to its order include with the same narrow `select`. Compute `sessionConfigurationTotal = priceSelections(allSelections).totalDelta`. Add it to the workspace return type so spec 91 can render it. Do not change the sidebar UI in this spec.

### 6. Error routing

Catch `SessionConfigurationRequiredSelectionMissingError` at the API/action layer that today calls `createInvoiceForOrder` (POS finalize action). For this spec the minimum is: surface the error with its details payload to the caller — UI presentation can come in spec 91 alongside the panel. A bare console.error + bubble is acceptable here if no existing translation point exists.

### 7. Decimal rules

All math goes through `Prisma.Decimal` (mirroring `packageAmount`, `manualAddOnTotal`, etc.). No `Number(...)` coercion. The pricing module accepts and returns `Prisma.Decimal`.

## Observability Checklist

### Dashboards / Metrics

- Counter: `invoice.session_configuration_lines_emitted` — increments per session-config line written during `buildInvoiceLineItems`. Sanity gauge for spec-91 adoption.
- Counter: `invoice.session_configuration_required_block` — increments each time `SessionConfigurationRequiredSelectionMissingError` is thrown. Tracks how often the gate fires.
- Discrepancy log: if `priceSelections(...).totalDelta` and the sum of newly-emitted line items' `lineTotal` plus `nonLineDelta` disagree within one invoice generation, log invoice id + selection ids. Catches future regressions in the line-vs-non-line split.

### Rollback Plan

- Schema: down-migration removes the enum values added by `20260518030000_invoice_line_type_session_configuration`. Postgres cannot cleanly remove an enum value, so the rollback leaves the values present and unused; harmless if no rows ever carried them.
- Code: revert the spec-90 commits. Existing invoices that already snapshotted `SESSION_CONFIGURATION` lines remain in the database — they render fine even without the new code (they're plain `InvoiceLineItem` rows). The required-gate disappears, so an order with unsatisfied required configs can be invoiced again, which is the pre-spec-90 behavior anyway.
- Non-recoverable: any locked invoices created during the spec-90 window keep their session-config lines. That's correct — those are real charges.

### Customer-Visible Surface

- Staff (POS): order totals now include session-config deltas pre-lock if selections exist (spec 91 puts the UI in place to *create* selections; pre-91 the totals only move when a fixture or admin manually inserts rows).
- Staff: attempting to lock an invoice with unsatisfied required configs is blocked with a structured error.
- Customers: locked invoices now include line items labelled by the configuration's snapshot label.

## Post-Implementation

- Update `context/architecture-summary.md` to add a one-paragraph "Pricing Pipeline" note mentioning `session-configuration-pricing.ts` as the canonical selection→money path, called by both `buildInvoiceLineItems` and `getPOSWorkspace`.
- Update `context/progress-tracker.md`.
- Do **not** archive `context/reviews/session-config-plan.md`; specs 91–93 still reference it.

## Acceptance Criteria

- `prisma/migrations/20260518030000_invoice_line_type_session_configuration/migration.sql` adds `SESSION_CONFIGURATION` to `InvoiceLineType` and `SESSION_CONFIGURATION_SELECTION` to `OrderEntityKind`. Migration applies cleanly on a fresh database and on top of the spec-88 migration.
- `src/modules/session-configurations/session-configuration-pricing.ts` exists, is pure (does not import `@/lib/db`), and exports `priceSelections` and `priceSingleSelection`. A grep for `from "@/lib/db"` in this file returns zero hits.
- `src/modules/session-configurations/session-configuration-resolver.ts` exists and exports `resolveOrderPackageSessionConfigurations`, `resolveOrderSessionConfigurations`, and `SessionConfigurationRequiredSelectionMissingError`.
- Invoice creation throws `SessionConfigurationRequiredSelectionMissingError` when any active required config has no selection on any order package, and the `Invoice` table row count is unchanged. Asserted by test.
- After inserting the missing selection rows (test fixture), `createInvoiceForOrder` succeeds and the resulting invoice's `totalAmount` equals package + add-ons + extra photos + the sum returned by `priceSelections(...).totalDelta` on the same selection set.
- `closeInvoice` snapshots one `InvoiceLineItem` per non-`MODIFIER_ONLY` selection with `lineType = SESSION_CONFIGURATION`, `causeOrderEntityKind = SESSION_CONFIGURATION_SELECTION`, and `causeOrderEntityId` matching the selection row id.
- For an order whose only session-config selection is `LINKED_PRODUCT + MODIFIER_ONLY`, the invoice has zero `SESSION_CONFIGURATION` line items but `totalAmount` still reflects the delta. Asserted by test.
- `getPOSWorkspace(orderId).sessionConfigurationTotal` equals `priceSelections(allSelectionsOnOrder).totalDelta` for the same fixture order. Asserted by test.
- A grep for `selection.configuration.options` or `option.priceDelta` inside `buildInvoiceLineItems`, `getPOSWorkspace`, or the pricing module returns zero hits (proves pricing reads only snapshots).
- A grep for `db.orderPackageSessionConfigurationSelection.create` or `.update` or `.upsert` across `app/` and `src/` returns zero hits (selection writes remain out of scope until spec 91).
- The pricing module and the resolver are the only modules outside `src/modules/invoices/` and `src/modules/orders/` that touch session-configuration tables. A grep for `db.sessionConfiguration` outside `src/modules/session-configurations/` returns zero hits.
- `npm run build` passes.
- `npm run lint` passes.
