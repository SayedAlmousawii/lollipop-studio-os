# Feature 101 - R6: Remove Financial Discrepancy Loggers + Lock The FinancialCase Read Layer

## Goal

Complete the R1-R5 financial readout swap by removing the temporary FinancialCase projector parity/discrepancy infrastructure, deleting any remaining swap-era shims, and adding regression coverage that keeps FinancialCase projectors pure and prevents reintroduction of page/component financial derivation.

## Read First

- `context/reviews/centralization-roadmap.md` - Spec R6, risk controls, R6 test row, and cleanup boundaries before composition work starts.
- `context/feature-specs/95-r1a-financial-case-summary-core.md` - original discrepancy logger and parity checker intent.
- `context/feature-specs/96-r1b-financial-case-projectors-remaining.md` - parity checker extension and projector purity rules.
- `context/feature-specs/97-r2-swap-financials-tab-sales-locked-sidebar.md` - first consumer-swap observability expectations.
- `context/feature-specs/98-r3-financial-readouts-header-table-booking.md` - R3a/R3b consumer swaps and the documented `summarizeInvoices` drift for non-R3 paths.
- `context/feature-specs/99-r4-money-formatting-centralization.md` - formatter/parser ownership after financial readout swaps.
- `context/feature-specs/100-r5-service-only-db-access.md` - app/component DB-boundary cleanup and regression test pattern.
- `src/modules/financial-cases/financial-case-summary.service.ts` - current `getFinancialCaseSummary`, `checkFinancialCaseSummaryProjectorParity`, and legacy comparison helpers.
- `src/modules/financial-cases/discrepancy-logger.ts` - temporary logger to remove.
- `src/modules/financial-cases/orders-table-projections.service.ts` - current batch table helper; at drafting time it still reconstructs summary-like values with legacy order settlement helpers.
- `src/modules/financial-cases/projections/` - projector files whose function signatures should remain pure.
- `src/modules/financial/reconciliation-invariants.ts`, `src/modules/financial/invariant-catalog.ts`, and `context/reviews/invariant-catalog.md` - current `CENT-FCS-01` registration and generated catalog entry.
- `tests/financial/financial-case-summary/`, `tests/architecture/service-only-db-access.test.ts`, and `tests/financial/invariant-catalog.test.ts` - existing parity, boundary, and catalog test patterns.

## Rules

- **Cleanup only.** This unit removes temporary financial parity infrastructure and tightens tests. It must not change invoice, payment, refund, credit-note, adjustment, booking, POS, session-configuration, or order workflow write behavior.
- **No schema or migration change.** Do not touch Prisma schema, migrations, generated client state, or persisted data shape.
- **No consumer redesign.** Do not implement composition centralization, edit-mode policy, workflow policy builders, order-details orchestrator, invoice-list swap, or R12 fallback removal.
- **Keep canonical read ownership.** Projectors remain pure functions over `FinancialCaseSummary`. Pages/components remain render-only and must not reintroduce settlement helpers, invoice filtering, formatted-money parsing, or DB reads.
- **Remove temporary observability.** `centralization.financial_case_summary.discrepancy`, `centralization.financial_case_summary.projector_parity`, `checkFinancialCaseSummaryProjectorParity`, and `CENT-FCS-01` were rollout scaffolding. Once R6 lands, these names should not remain in production code or generated invariant docs.
- **Preserve active production invariants.** Removing `CENT-FCS-01` must not disturb unrelated reconciliation invariants, `INVARIANT_CATALOG` shape, nightly reconciliation execution, or existing invariant tests.
- **Current drift to account for.** `orders-table-projections.service.ts` currently avoids an N+1 query by rebuilding an active `FinancialCaseSummary`-like object itself and importing legacy settlement helpers. R6 may clean this up only if it can be done narrowly without changing behavior or compromising fixed-query batching.
- **Defer risky batch cleanup.** If removing legacy settlement imports from `orders-table-projections.service.ts` requires broad refactoring of batch summary construction or risks reintroducing N+1, defer that cleanup to R12/performance cleanup and keep R6 focused on parity/discrepancy removal plus regression tests.
- **Do not over-clean future workflow paths.** `summarizeInvoices()` / `mapPaymentStatus()` still support non-R1-R5 paths such as customer history and delivery workflow. Remove them only if they are truly unused after this unit. R10/R12 own broader workflow/fallback cleanup.

## Scope

### In Scope

- `src/modules/financial-cases/financial-case-summary.service.ts`
  - Remove `checkFinancialCaseSummaryProjectorParity`.
  - Remove imports and helper functions used only for legacy comparison, including `compareSummaryWithLegacy`, `toFinancialTabBlock`, `toSalesSidebarLocked`, `toOrderHeaderFinancial`, `toOrdersTableRow`, `deriveLegacyLockedSummary`, and `deriveLegacySettlementSummary` if they are no longer needed by summary construction.
  - Keep `getFinancialCaseSummary` as the canonical single-record read path.
  - Add a narrow batch summary helper only if needed to let `orders-table-projections.service.ts` stop rebuilding summary-like data independently without creating table N+1 behavior.
- `src/modules/financial-cases/discrepancy-logger.ts`
  - Delete this file once no production import remains.
- `src/modules/financial-cases/index.ts`
  - Stop exporting `checkFinancialCaseSummaryProjectorParity`.
  - Keep `getFinancialCaseSummary`, projector exports, constants, types, and `getOrdersTableFinancialProjections`.
- `src/modules/financial-cases/orders-table-projections.service.ts`
  - Keep the public `getOrdersTableFinancialProjections(...)` contract.
  - Prefer removing direct legacy settlement imports and independent construction of `FinancialCaseActiveSummary` only if the change is narrow, behavior-preserving, and keeps fixed-query batching intact.
  - If that cleanup requires broad batch-summary refactoring or risks an N+1 read path, leave the existing batched implementation in place and document the deferral to R12/performance cleanup.
- `src/modules/financial/reconciliation-invariants.ts` and `src/modules/financial/invariant-catalog.ts`
  - Remove the `CENT-FCS-01` reconciliation invariant entry and any dynamic import of the removed checker.
  - Preserve all non-centralization financial invariants unchanged.
- `context/reviews/invariant-catalog.md`
  - Refresh generated docs so `CENT-FCS-01` no longer appears.
- Tests
  - Remove or rewrite parity-checker tests that exist only to exercise `checkFinancialCaseSummaryProjectorParity` or discrepancy logging.
  - Keep value-level projector tests that verify current projector outputs for representative summaries.
  - Add a grep-style regression test that fails if temporary discrepancy/parity symbols return in production code or generated invariant docs.
  - Add a projector purity test that asserts projector files import no DB client, service loader, order settlement helper, reconciliation module, or discrepancy logger.
  - If the orders-table batch cleanup is performed in R6, add a financial-cases boundary test that asserts `orders-table-projections.service.ts` does not import `@/modules/orders/order-settlement` and does not construct `FinancialCaseActiveSummary` directly. If the cleanup is deferred, do not add that assertion yet; instead document the deferral target.

### Out of Scope

- Any schema, migration, seed, trigger, invoice, payment, allocation, refund, credit-note, adjustment-workspace, booking, POS, or session-configuration write change.
- Changing the public DTO shapes of existing FinancialCase projectors unless a type-only cleanup is required after removing parity scaffolding.
- Changing visible order header, orders table, booking page, Financials tab, locked Sales sidebar, payment dialog, or invoice-list behavior.
- Full removal of `summarizeInvoices()`, `mapPaymentStatus()`, or `computeOrderSettlementSummary()` while they still serve customer-history, delivery-workflow, or future R10/R12 paths.
- Removing `getOrderSettlementInvoices()` fallback paths; R12 owns fallback removal after broader invariants prove safety.
- Implementing R7/R8 composition centralization, R9 edit-mode policy, R10 workflow policy builders, R11 order-details orchestrator, or R12 cleanup pass.

## Implementation Direction

Start by deleting the temporary runtime path rather than rewriting business logic. The centralization discrepancy logger was intentionally added to make R2-R5 safe during rollout. Now that the swapped surfaces consume `FinancialCaseSummary` projectors, remove the checker and its reconciliation registration instead of leaving a dormant second source of truth.

In `financial-case-summary.service.ts`, keep `getFinancialCaseSummary(...)` focused on canonical summary construction. Remove comparison-only imports and functions. The service may continue to reuse existing financial helpers for the one canonical summary calculation, but no projector should call those helpers directly and no page/component should see them.

For the orders table batch path, preserve the performance intent from R3a. Do not replace the batch helper with a naive per-row `getFinancialCaseSummary({ orderId })` loop if that creates avoidable N+1 reads. If the cleanup is clearly narrow, factor summary construction so the batch helper receives or builds real `FinancialCaseSummary` objects through the same canonical path used by `getFinancialCaseSummary`, then calls `toOrdersTableRow(summary)`. After such a narrow cleanup, `orders-table-projections.service.ts` should not import `deriveLockedFinancialSidebarSummary`, `computeOrderSettlementSummary`, `deriveFinancialCasePaymentStatus`, or `deriveSettlementPaidAmount`, and it should not assemble a `FinancialCaseActiveSummary` object by hand.

If removing legacy settlement imports from `orders-table-projections.service.ts` requires broad refactoring of batch summary construction or risks reintroducing N+1, defer that cleanup to R12/performance cleanup and keep R6 focused on parity/discrepancy removal plus regression tests. In the deferral path, keep the current public batch helper behavior unchanged and add only the tests that are still valid for R6's cleanup scope.

Remove `CENT-FCS-01` from reconciliation and regenerate the invariant catalog. The remaining catalog should still be unique, runnable, and clean on an empty isolated database. Do not rename or reorder unrelated invariants unless the generation command does so mechanically.

Update tests in two directions. First, delete parity-log tests whose only purpose is proving the temporary checker emits no discrepancies. Second, add durable architecture tests: production source should contain no `centralization.financial_case_summary.discrepancy`, no `centralization.financial_case_summary.projector_parity`, no `checkFinancialCaseSummaryProjectorParity`, and no import of `discrepancy-logger`. Scope the grep carefully so it does not fail on this feature spec file if the test scans `context/**`; production-code checks should scan `src/**`, `app/**`, and generated invariant docs where appropriate.

For projector purity, prefer a simple source scan over brittle AST machinery. Each `src/modules/financial-cases/projections/*.ts` file should be allowed to import local types, constants, and other projector files, but not `@/lib/db`, `financial-case-summary.service`, `orders-table-projections.service`, `@/modules/orders/order-settlement`, `@/modules/invoices/*`, `@/modules/financial/*`, or the discrepancy logger. This test protects the roadmap rule that projectors reshape canonical data but do not derive business truth.

Finally, verify there is no `getOrderFinancialSummary` shim by name. At drafting time `rg "getOrderFinancialSummary" src app tests` returns no implementation hit; R6 should keep it that way with a regression assertion or a documented grep in the PR notes.

## Observability Checklist

### Dashboards / Metrics

- Removed: `centralization.financial_case_summary.discrepancy`.
- Removed: `centralization.financial_case_summary.projector_parity` / `CENT-FCS-01`.
- No replacement runtime metric is required. R6 shifts this rollout guard from production discrepancy logging to static/regression tests because the R1-R5 financial swap is complete.
- Existing non-centralization financial reconciliation invariants remain registered and runnable.

### Rollback Plan

- No schema changes. No down-migration needed.
- Roll back by restoring `discrepancy-logger.ts`, `checkFinancialCaseSummaryProjectorParity`, the `CENT-FCS-01` reconciliation entry, the index export, and the parity tests.
- If the orders-table batch cleanup is attempted and causes trouble, revert that service to the previous batch implementation while keeping the checker removal only if tests still prove the swapped UI surfaces consume canonical projectors. It is acceptable for R6 to defer this cleanup entirely.

### Customer-Visible Surface

- No intentional staff-visible or customer-visible change.
- Order header totals, orders table totals/statuses, booking financial sections, Financials tab values, and locked Sales sidebar values should render exactly as before.

## Post-Implementation

- `context/progress-tracker.md` - update Now to say R6 is complete, temporary FinancialCase discrepancy/parity infrastructure is removed, and the financial readout swap is locked in. Next: R7 (OrderCompositionViewModel).
- `context/reviews/invariant-catalog.md` - refresh generated docs after removing `CENT-FCS-01`.
- Do not update architecture-context or code-standards unless implementation discovers a documented rule conflict.

## Acceptance Criteria

- `src/modules/financial-cases/discrepancy-logger.ts` is deleted.
- `checkFinancialCaseSummaryProjectorParity` is removed from `financial-case-summary.service.ts` and no longer exported from `src/modules/financial-cases/index.ts`.
- Production code contains no `centralization.financial_case_summary.discrepancy` string.
- Production code and generated invariant docs contain no `centralization.financial_case_summary.projector_parity` or `CENT-FCS-01`.
- `src/modules/financial/reconciliation-invariants.ts` no longer imports or dynamically imports FinancialCase projector parity code.
- All remaining reconciliation invariants keep their existing IDs, descriptions, expected conditions, and run behavior except for mechanical catalog regeneration.
- `getFinancialCaseSummary(...)` remains the canonical single-record financial read model entry point and keeps resolving by `financialCaseId`, `orderId`, and `bookingId`.
- `getOrdersTableFinancialProjections(...)` keeps its public contract and fixed-query batching behavior. If the orders-table cleanup is narrow, it no longer imports `@/modules/orders/order-settlement`, no longer calls legacy settlement/sidebar summary helpers, and no longer constructs `FinancialCaseActiveSummary` directly. If not narrow, the cleanup is explicitly deferred to R12/performance cleanup with R6 still passing parity/discrepancy removal and regression-test criteria.
- Every file in `src/modules/financial-cases/projections/` remains pure: no DB import, no service-loader import, no order-settlement import, no invoice/payment service import, no reconciliation import, and no discrepancy-logger import.
- Order details page, locked Sales page, orders table, and booking page continue consuming `FinancialCaseSummary` projectors for the R1-R5 financial readout surfaces and do not reintroduce page/component financial derivation.
- `rg "getOrderFinancialSummary" src app tests` returns no implementation hit.
- Existing value-level tests for `getFinancialCaseSummary` and all FinancialCase projectors still pass after parity-only tests are removed or rewritten.
- A regression test fails if the removed discrepancy/parity symbols or projector impurity patterns are reintroduced.
- The existing `tests/architecture/service-only-db-access.test.ts` remains green; no `@/lib/db` imports appear in `app/**` or `src/components/**`.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run test:backend-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.
