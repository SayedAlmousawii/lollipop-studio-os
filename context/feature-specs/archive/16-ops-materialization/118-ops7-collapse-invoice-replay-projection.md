## Goal

Retire the invoice-line replay path. Every materializable workspace edit is now written back into operational rows by specs 114–117, so `getEffectiveCompositionForInvoice` reduces to `captureCurrentOrderComposition`. Delete `applySignedInvoiceLines`, `kindFromInvoiceLine`, and the per-cause `SESSION_CONFIGURATION_SELECTION` skip — none of them are needed once invoice lines are exclusively financial documents. Lock in the invariant with a regression test so no future change reintroduces composition-from-invoices.

## Read First

- Previous specs `112-ops1-...` through `117-ops6-...`
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts` — `getEffectiveCompositionForInvoice`, `applySignedInvoiceLines`, `kindFromInvoiceLine`, `captureCurrentOrderComposition`
- `src/modules/orders/composition/order-composition.service.ts` — `getLockedOrderCompositionViewModel`

## Rules

- After this spec, no code reads `InvoiceLineItem` for composition purposes. Invoice line items are financial-document state only.
- `getEffectiveCompositionForInvoice` must produce the same result as `captureCurrentOrderComposition(orderId)`, plus the same totals computation. Workspaces are no longer iterated.
- The `operationalStateAppliedAt` flag introduced in spec 113 stops being load-bearing for composition (every finalized workspace either is materialized or, if pre-this-spec workspaces exist in dev, must be re-finalized or reset before this spec lands). Confirm by inspection of dev/seed state.
- Delete dead helpers in the same change. No deprecation period — no production data depends on them.

## Scope

### In Scope

- Reduce `getEffectiveCompositionForInvoice` to: validate the invoice is a final order invoice, then return `captureCurrentOrderComposition(invoice.orderId)`. No workspace iteration. No invoice line application.
- Delete `applySignedInvoiceLines`, `kindFromInvoiceLine`, and any helpers used only by them.
- Invariant test: for an order with any number of finalized workspaces of any edit shape, `getLockedOrderCompositionViewModel` returns the same snapshot lines and totals as `captureCurrentOrderComposition` for that order.
- Sanity test: financial invoice records (FINAL, ADJUSTMENT) remain unchanged in their `lineItems` shape — adjustment invoice creation is unaffected.
- Remove the now-dead workspace `operationalStateAppliedAt` read in the composition path. The column stays on the schema as a useful idempotency / debugging marker but no longer gates replay (because there is no replay).

### Out of Scope

- Removing the `operationalStateAppliedAt` column itself.
- Any change to adjustment invoice creation or financial reporting.
- Any new operational columns or `OrderPackageChange` ledger work.

## Implementation Direction

The body of `getEffectiveCompositionForInvoice` becomes a thin guard: confirm invoice exists, type is FINAL, and has an `orderId`, then delegate to `captureCurrentOrderComposition`. Drop the `finalizedWorkspaceInvoices` query entirely.

`applySignedInvoiceLines` and `kindFromInvoiceLine` lose all callers and can be deleted. Check for any test imports and remove them too.

The invariant test is the load-bearing artifact of this spec. Construct an order with: at least one finalized workspace containing a `swap_package`, at least one with add-on changes, at least one with item upgrades, and at least one with photo-count changes. Assert that `getLockedOrderCompositionViewModel(invoice).effectiveComposition` deep-equals `buildCompositionSnapshotFromAdjustmentSnapshot(await captureCurrentOrderComposition(orderId))` line-for-line and total-for-total.

`getDraftOrderCompositionViewModel` and `getPendingAdjustmentOrderCompositionViewModel` are unaffected — they don't go through the replay path. Verify by reading those functions in `order-composition.service.ts`.

## Post-Implementation

- Update `context/architecture-context.md` to state that adjustment invoices are financial documents only and operational state lives on `Order*` rows.
- Update `context/target-data-model.md` to reflect the finalized adjustment-workspace contract.
- Update `context/progress-tracker.md` Now / Key State and mark this initiative complete.
- Archive `context/reviews/adjustment_workspace_operational_state_architecture_plan.md` and `context/reviews/orders-package-source-of-truth-review.md` into a new `context/reviews/archive/<NN>-adjustment-workspace-materialization/` folder.

## Acceptance Criteria

- `getEffectiveCompositionForInvoice` body contains no reference to `InvoiceLineItem`, `applySignedInvoiceLines`, or finalized workspaces.
- `applySignedInvoiceLines` and `kindFromInvoiceLine` are deleted; no symbol in `src/` imports them.
- Invariant test passes: locked composition equals current composition for orders with mixed finalized workspaces.
- Adjustment invoice line item shape and content are unchanged versus spec 117.
- All earlier specs' regression tests continue to pass with the simplified projection.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
