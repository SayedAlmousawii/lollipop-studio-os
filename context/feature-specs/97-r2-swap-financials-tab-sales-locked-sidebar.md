# Feature 97 — R2: Swap Financials Tab + Locked Sales Sidebar To FinancialCase Projectors

## Goal

Move the order details Financials tab and the locked Sales sidebar from local legacy financial derivation to the canonical `FinancialCaseSummary` projectors created in R1a/R1b. This is the first consumer swap in the centralization roadmap: it should change data ownership without changing visible financial values, write behavior, linked-document rendering, payment actions, or adjustment-workspace actions.

## Read First

- `context/reviews/centralization-roadmap.md` — Spec R2, §5 do-not-touch boundaries, and §8.5 spec drafting notes.
- `context/feature-specs/95-r1a-financial-case-summary-core.md` — R1a service/projector/discrepancy pattern.
- `context/feature-specs/96-r1b-financial-case-projectors-remaining.md` — post-R1 implementation decisions and parity checker extension.
- `src/modules/financial-cases/financial-case-summary.service.ts` — `getFinancialCaseSummary` and `checkFinancialCaseSummaryProjectorParity`.
- `src/modules/financial-cases/projections/to-financial-tab-block.ts` — Financials tab projection shape.
- `src/modules/financial-cases/projections/to-sales-sidebar-locked.ts` — locked Sales sidebar projection shape.
- `app/orders/[orderId]/page.tsx` — current `deriveOrderDetailsFinancialSummary` path and Financials tab wiring.
- `app/orders/[orderId]/sales/page.tsx` — current locked sidebar financial summary derivation.
- `src/components/financial/order-details-financials-tab.tsx` and `src/components/orders/financial-sidebar-locked.tsx` — rendering contracts that must remain display-only.
- `tests/financial/financial-case-summary/` and `tests/orders/order-details-financials-tab.test.tsx` — existing parity and render-test conventions.

## Rules

- **Consumer swap only.** This unit may change the two page loaders that feed the Financials tab and locked Sales sidebar, plus narrowly related component/test types if needed. It does not change projector behavior, financial math, invoice/payment writes, schema, formatting, orders table, booking page, or draft Sales sidebar.
- **Use canonical read flow.** Both swapped surfaces must derive financial summary data through `getFinancialCaseSummary({ orderId })` and the appropriate projector: `toFinancialTabBlock` for the order details Financials tab, `toSalesSidebarLocked` for the locked Sales sidebar.
- **No legacy financial recomputation in pages.** Remove `deriveOrderDetailsFinancialSummary` from `app/orders/[orderId]/page.tsx`. Remove locked-sidebar page-local adjustment filtering and `deriveLockedFinancialSidebarSummary` calls from `app/orders/[orderId]/sales/page.tsx`.
- **Keep non-financial surface data as-is.** `workspace` remains the source for line items, payment dialog invoice actions, locked/draft state, POS composition, and adjustment-workspace action context. `linkedDocuments` remains the document-list input until a later invoice-list swap spec changes it.
- **Preserve observability without page math.** The old page-level `order_details.financials_tab.header_discrepancy` check is local legacy derivation and should be removed from the swapped page path. The R1 reconciliation invariant `centralization.financial_case_summary.projector_parity` and `checkFinancialCaseSummaryProjectorParity` remain live through R6.
- **Handle null stages explicitly.** If `getFinancialCaseSummary` returns `null`, a booking-stage summary, or a projector returns `null`, keep the current empty Financials tab behavior and avoid rendering the locked sidebar summary for that path. Do not synthesize active-stage values.
- **Roadmap drift to account for.** R1 implementation already registered the parity checker in reconciliation, and `toSalesSidebarLocked` currently aliases `toFinancialTabBlock`. R2 should consume those established shapes rather than inventing wrapper DTOs. R1b’s `toDraftSidebarFinancial` naming drift is out of scope for R2.

## Scope

### In Scope

- `app/orders/[orderId]/page.tsx`
  - Import and call `getFinancialCaseSummary` and `toFinancialTabBlock`.
  - Remove the local `deriveOrderDetailsFinancialSummary` helper and its import dependency on `deriveLockedFinancialSidebarSummary`.
  - Pass the projected summary into `OrderDetailsFinancialsTab`.
  - Keep `getPOSWorkspace(orderId)` and `getLinkedFinancialDocumentsForOrder(orderId)` because the tab still renders line items and linked documents from those existing contracts.
- `app/orders/[orderId]/sales/page.tsx`
  - In the locked-invoice branch, derive `financialSummary` from `getFinancialCaseSummary({ orderId: workspace.orderId })` plus `toSalesSidebarLocked`.
  - Remove page-local finalized-adjustment filtering and `deriveLockedFinancialSidebarSummary` usage.
  - Keep `getLinkedFinancialDocumentsForOrder`, `getEffectiveCompositionForInvoice`, `getOpenWorkspaceForInvoice`, and `workspace` usage unchanged.
- Narrow type updates where necessary so shared financial components accept the projector output type without importing legacy settlement derivation types.
- Tests that prove the two swapped surfaces render the same values from projector-shaped data and that the FinancialCase projector parity checker remains clean.

### Out of Scope

- Any schema or migration change.
- Any invoice, payment, refund, credit-note, adjustment-workspace, booking, or POS write-service change.
- Changes to `getFinancialCaseSummary`, projector formulas, or the discrepancy logger beyond a narrowly necessary type export fix.
- Swapping order header cards, orders table rows, booking page financial readouts, invoice list rows, draft sidebar financials, or payment dialog context.
- Money formatter centralization (R4).
- Moving direct DB reads out of server actions/pages beyond the two local legacy financial derivations in this spec (R5).
- Removing the reconciliation parity checker or discrepancy logger (R6).
- `OrderCompositionViewModel`, composition projectors, edit-mode policy, workflow policies, or `getOrderDetailsView`.

## Implementation Direction

Start by preserving the rendering contracts. `OrderDetailsFinancialsTab` still needs `workspace`, `linkedDocuments`, and a summary object with `customerTotal`, `paidSoFar`, `includesDeposit`, `remaining`, `finalInvoiceTotal`, `totalAdjustments`, and `finalTotal`. `toFinancialTabBlock(summary)` already returns that shape for active summaries and `null` otherwise. The Financials tab should therefore load the FinancialCase summary once in the page, project it, and pass that result through the existing prop.

For the order details page, keep the existing parallel loader structure but add `getFinancialCaseSummary({ orderId })` to the read set. Remove `deriveOrderDetailsFinancialSummary` entirely, along with the local header discrepancy comparison that uses `order.settlementSummary`. Keep the lightweight `order_details.financials_tab.rendered` info log only if it can be emitted without reintroducing legacy math; include the `financialCaseId` from the active summary and the workspace invoice id when present.

For the locked Sales page, leave the locked/draft branch structure alone. In the locked branch, continue loading effective composition, open workspace, and linked documents. Add the FinancialCase summary read and project it with `toSalesSidebarLocked`. If the projector returns `null`, fail closed with an explicit non-success path rather than falling back to `deriveLockedFinancialSidebarSummary`; an active locked invoice without an active FinancialCase projection is a parity/invariant problem, not a cue to resurrect page math.

Update shared financial summary typing to point at the projector type rather than `ReturnType<typeof deriveLockedFinancialSidebarSummary>` if needed. The components should remain dumb renderers; they should not import `getFinancialCaseSummary`, inspect invoices, filter adjustment documents, or compute money. The page owns loading and projection; the components render the DTO they receive.

Do not delete `getLinkedFinancialDocumentsForOrder` usage from these pages in this spec. Linked documents are still passed directly to `FinancialLinkedDocuments`, and payment row actions in `FinancialSidebarLocked` still find payment invoice context from `workspace.invoice`, `workspace.adjustmentInvoices`, and `workspace.paidAdjustmentInvoices`.

The central parity checker already covers `toFinancialTabBlock` and `toSalesSidebarLocked` against the legacy locked derivation. Use that existing checker in tests rather than adding runtime legacy comparison to the swapped pages. If the checker fails after the page swap, fix the canonical summary/projector only if the issue is proven to be an R1 bug; otherwise stop and call out the roadmap drift.

## Observability Checklist

### Dashboards / Metrics

- `centralization.financial_case_summary.projector_parity` remains registered in reconciliation and continues to exercise `checkFinancialCaseSummaryProjectorParity`.
- `centralization.financial_case_summary.discrepancy` remains the discrepancy log emitted by the checker when projector output diverges from legacy values.
- `order_details.financials_tab.header_discrepancy` should no longer be emitted by `app/orders/[orderId]/page.tsx` after this swap because the page no longer owns header-vs-tab financial math.
- Existing `sales_page.locked.rendered` logging may stay, but it must not depend on legacy financial derivation.

### Rollback Plan

- No schema changes. No down-migration needed.
- Revert the two page-loader changes and any narrow summary type updates to return the surfaces to the previous legacy derivation path.
- The R1 `src/modules/financial-cases/` module, projectors, discrepancy logger, and reconciliation invariant remain in place after rollback because they are shared roadmap infrastructure and still unused by other swapped consumers.

### Customer-Visible Surface

- Staff should see the same Financial Summary, Total Source, Linked Financial Documents, Price Breakdown, Record Payment actions, and Adjustment Workspace actions as before.
- No intentional user-visible behavior change. The only intended operational change is removal of the old page-level discrepancy logging path in favor of the centralized R1 parity checker/invariant.

## Post-Implementation

- `context/progress-tracker.md` — update Now: "R2 complete: order details Financials tab and locked Sales sidebar consume `FinancialCaseSummary` projectors; page-local locked financial derivation removed. Next: R3a (order header + orders table)."
- No architecture-context or code-standards changes needed.
- Do not refresh `context/reviews/invariant-catalog.md` unless the reconciliation invariant metadata changes, which this spec should not require.

## Acceptance Criteria

- `app/orders/[orderId]/page.tsx` no longer defines `deriveOrderDetailsFinancialSummary` and no longer imports or calls `deriveLockedFinancialSidebarSummary`.
- The order details Financials tab receives summary data from `getFinancialCaseSummary({ orderId })` projected through `toFinancialTabBlock`.
- `app/orders/[orderId]/sales/page.tsx` no longer derives locked sidebar totals by filtering adjustment documents and calling `deriveLockedFinancialSidebarSummary`.
- The locked Sales sidebar receives summary data from `getFinancialCaseSummary({ orderId: workspace.orderId })` projected through `toSalesSidebarLocked`.
- Neither swapped page re-implements money totals, payment status, deposit inclusion, adjustment totals, or remaining balance.
- `OrderDetailsFinancialsTab`, `FinancialSidebarLocked`, `FinancialPaymentSummary`, and `FinancialTotalSource` remain display-only components and do not import the DB client, financial services, or settlement helpers.
- Existing linked-document rendering, price breakdown rendering, payment row actions, and adjustment-workspace actions remain intact.
- `order_details.financials_tab.header_discrepancy` is removed from the order details page path; `centralization.financial_case_summary.discrepancy` remains available through the R1 checker.
- Tests cover active locked, adjusted, credit-noted, refunded, and overpaid fixture scenarios through the existing FinancialCaseSummary parity suite or targeted additions.
- Render tests for `OrderDetailsFinancialsTab` and `FinancialSidebarLocked` pass with projector-shaped summary fixtures.
- `npm run test:backend-invariants` passes.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
