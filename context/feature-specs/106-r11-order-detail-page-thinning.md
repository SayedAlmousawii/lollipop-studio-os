# Feature 106 - R11: Order Detail Page Thinning

## Goal

Move the last page-local domain helpers and DTO-shape fallbacks out of `app/orders/[orderId]/page.tsx` onto the existing composition projectors and workflow DTOs, fix the stale "Base payment" selection copy, and prove the removed page-local helpers do not return — without introducing a `getOrderDetailsView(orderId)` orchestrator and without collapsing the existing `Promise.all` loader.

## Read First

- `AGENTS.md` — narrow context rule, docs-only progress behavior, service-only DB access.
- `context/reviews/centralization-roadmap.md` — Spec R11/R12 sequencing and §6.4 reassessment note ("R11 may collapse into a janitorial commit").
- `context/reviews/r11-architecture-assessment.md` — post-R10 reassessment: B (page-thinning) chosen over A (orchestrator), four concrete cleanup targets and what must not be centralized.
- `context/feature-specs/103-r8-composition-consumer-swaps.md` and `context/feature-specs/105-r10-workflow-policy-builders.md` — current projector/policy patterns this spec must follow without redesigning.
- `app/orders/[orderId]/page.tsx` — current loader, projector calls, `deriveOperationalPackageLines` / `valueDisplayForOperationalSelection`, `emptyOverviewComposition` / `emptyProductionDeliverables`, production tab photo counts, selection tab branch and "Base payment" copy.
- `src/modules/orders/composition/` — `OrderCompositionViewModel`, existing projector outputs (`toOverviewTab`, `toProductionDeliverables`, `toPOSCompositionProjection`), and the `sessionConfigurationSummary` / `financialBehavior` data already available to projectors.
- `src/modules/orders/composition/projections/to-production-deliverables.ts` and `to-overview-tab.ts` — current DTO shapes that will be extended.
- `src/modules/orders/order.service.ts` and `src/modules/orders/order.types.ts` — `OrderSelectionWorkflow` shape, selection workflow loader, and current `orderStatus` label mapping.
- `src/components/orders/operational-configurations-block.tsx` — current consumer of `OperationalConfigurationsPackageLine[]` (must continue to render unchanged).

## Rules

- **One narrow PR. No orchestrator.** Do not introduce `getOrderDetailsView(orderId)`. Do not move the page's top-level `Promise.all` loader into a service. Do not collapse the order-details page into a single read aggregate.
- **No R12 work.** Do not remove `summarizeInvoices()`, `getOrderSettlementInvoices()` fallbacks, or any other compatibility path. Do not delete `OrderDetail.includedPhotoCount` / `OrderDetail.extraPhotoCount` from the order DTO; only stop reading them from the production tab.
- **Composition projectors stay pure.** New projector outputs derive only from `OrderCompositionViewModel` (and, where natural, the same `POSWorkspace` input the existing operational-selection display already used). No new DB reads. No new financial math.
- **Composition module owns its DTO shapes.** Empty/fallback DTOs that match projector output must be exported from `src/modules/orders/composition/`, not constructed in pages.
- **No workflow redesign.** Selection, production, overview, and financial tab behavior must look identical to staff. The only visible copy change is the "Base payment" → "deposit" correction.
- **No new DB imports in `app/**` or `src/components/**`.** Existing service-only DB boundary remains.
- **No schema, enum, migration, seed, or write-service behavior change.**
- **Preserve current parallelism.** The `Promise.all` block stays. Any new projector helper called from the page must be synchronous (pure DTO mapping); async loaders are not added.

## Scope

### In Scope

- A new composition projector (e.g. `toOperationalConfigurationsDisplay`) that produces the `OperationalConfigurationsPackageLine[]` shape currently rendered by `OperationalConfigurationsBlock`. The projector encapsulates the `financialBehavior === "OPERATIONAL"` filter and the per-input-type value-display mapping. Input source may be the existing composition view model, the existing `POSWorkspace`, or a small typed adapter — whichever is the natural fit without introducing new loads.
- Removal of `deriveOperationalPackageLines` and `valueDisplayForOperationalSelection` from `app/orders/[orderId]/page.tsx`. The page consumes the new projector output directly.
- Stable empty DTOs exported from the composition module covering `OverviewCompositionProjection` and `ProductionDeliverablesProjection`. Either:
  - the projectors accept `OrderCompositionViewModel | null` and return a stable empty DTO, or
  - the module exports named empty-constructor helpers the page calls.
  Either shape is acceptable; choose one and use it consistently.
- Removal of `emptyOverviewComposition` and `emptyProductionDeliverables` from `app/orders/[orderId]/page.tsx`.
- Extension of `ProductionDeliverablesProjection` to include `includedPhotoCount: number` and `extraPhotoCount: number` derived from the existing composition view model summary fields. The production tab reads both from `deliverables` instead of from `OrderDetail`.
- Audit of `ProductionDeliverablesProjection` consumers and update of any other readers (tests, render call sites) for the new fields.
- Correction of the stale "Base payment not yet recorded. Use 'Record Base Payment' on the booking to unlock selection." copy at the selection tab to the current "deposit" terminology aligned with R10a/R10b/R10d. A direct copy correction is acceptable; a `selectionBlockedMessage: string | null` field on `OrderSelectionWorkflow` is also acceptable if the service mapper can populate it cleanly without expanding scope.
- Page-thinning source test asserting `app/orders/[orderId]/page.tsx` does not export or reintroduce `deriveOperationalPackageLines`, `valueDisplayForOperationalSelection`, `emptyOverviewComposition`, or `emptyProductionDeliverables` symbols.
- Projector unit tests covering: operational configuration filtering by `financialBehavior`, value display per input type (`TOGGLE`, `SELECT`, `NUMBER`/`COUNTER`, `TEXT`), empty composition fallback, and production deliverables photo-count fields.

### Out of Scope

- `getOrderDetailsView(orderId)` orchestrator service.
- Collapsing or restructuring the page-level `Promise.all` loader.
- Moving `getOrderHubById`, `getPOSWorkspace`, `getOrderSelectionWorkflowById`, `getOrderEditingWorkflowById`, `getOrderProductionWorkflowById`, `getOrderDeliveryWorkflowById`, `getLinkedFinancialDocumentsForOrder`, `getFinancialCaseSummary`, `getOrderActivityTimeline`, or `getOrderCompositionViewModel` behind a single facade.
- Moving the `FINANCIAL_CASE_PAYMENT_STATUS_LABELS[...]` lookup out of the header. It is a single module-owned constant lookup, not page-local derivation.
- Restructuring the `selection.orderStatus === "Active"` branch in the selection tab. It compares against the typed `OrderStatusLabel` union and matches the service's own check at `order.service.ts` `deriveNextAction(...)`.
- R12 compatibility removals: `summarizeInvoices()`, `getOrderSettlementInvoices()`, `mapBookingDetail()` dedup, `OrderDetail.includedPhotoCount`/`extraPhotoCount` deletion, or any other legacy field removal.
- Tab UI redesigns, new tabs, or changes to existing tab rendering structure beyond the four cleanup targets above.
- Workflow action, status, label, or payload changes.
- Prisma schema, migration, seed, or enum changes.
- Invoice/payment/refund/adjustment/credit-note/composition write behavior.

## Implementation Direction

Treat this as the janitorial closer to R8/R9/R10. The shape is: a small projector addition, a DTO field extension, an empty-DTO contract, and a one-string copy fix.

### 1. Operational configurations display projector

The composition view model already has access to per-package `sessionConfigurationSummary` rows with `financialBehavior` and `inputType` metadata (used by `toOverviewTab` and the POS workspace shape). Add a new projector — for example `toOperationalConfigurationsDisplay(viewModel)` — that returns the existing `OperationalConfigurationsPackageLine[]` shape expected by `OperationalConfigurationsBlock`. The projector:

- iterates package lines from the canonical model,
- filters `sessionConfigurationSummary` to `financialBehavior === "OPERATIONAL"`,
- maps each remaining selection to `{ configName, valueDisplay }` using the same per-input-type rules currently in `valueDisplayForOperationalSelection`,
- drops entries with an empty `valueDisplay`.

If `OrderCompositionViewModel` does not currently carry every input-type field needed (e.g. `optionLabel`, `numericValue`, `textValue`), prefer extending the view model's existing session-configuration line shape before adding a second source. Do not pull from `POSWorkspace` if the composition model already has the same data. Keep the consumer (`OperationalConfigurationsBlock`) and its prop type unchanged.

The page replaces `deriveOperationalPackageLines(workspace)` with the new projector call against `compositionModel` (or its empty equivalent).

### 2. Empty projection DTOs

Pick one of:

- **(a)** Make `toOverviewTab` and `toProductionDeliverables` accept `OrderCompositionViewModel | null` and return a stable empty DTO when null. The page then calls them unconditionally. This is the lower-surface change.
- **(b)** Export `emptyOverviewCompositionProjection(order)` and `emptyProductionDeliverablesProjection(order)` from `src/modules/orders/composition/`. The page calls one or the other based on `compositionModel`.

Either is acceptable. Pick the one that matches the existing projector signatures with the least churn and apply it consistently. Delete the page-local `emptyOverviewComposition` and `emptyProductionDeliverables` functions.

The empty DTO must carry the same `orderId` and `jobNumber` the projectors today take from the composition model — derive them from the `OrderDetail` already loaded in the page when (b) is used, or accept them as parameters when (a) is used.

### 3. Production photo counts in projection

Extend `ProductionDeliverablesProjection` to include `includedPhotoCount: number` and `extraPhotoCount: number`. Populate them from the same `OrderCompositionViewModel` summary fields the overview projector already reads. Update the production tab's `InfoGrid` to read `deliverables.includedPhotoCount` and `deliverables.extraPhotoCount` instead of `order.includedPhotoCount` and `order.extraPhotoCount`.

Audit all `ProductionDeliverablesProjection` consumers (production tab, any tests, any fixtures) and update the projector tests/snapshots to cover the new fields. Do not remove `OrderDetail.includedPhotoCount` / `OrderDetail.extraPhotoCount` — R12 owns broader compat cleanup.

### 4. Stale "Base payment" copy

The selection tab's locked-state message at `app/orders/[orderId]/page.tsx` (`SelectionTab`, `orderStatus === "Active"` branch) currently reads:

> "Base payment not yet recorded. Use 'Record Base Payment' on the booking to unlock selection."

After R10, the canonical term is "deposit." Update to:

> "Deposit not yet recorded. Record the deposit on the booking to unlock selection."

Direct in-page string correction is acceptable. If `OrderSelectionWorkflow` already carries a similar message field, route through it; otherwise do not add one in this spec.

Leave the `selection.orderStatus === "Active"` predicate as-is — it is a typed-label comparison, not a parsing path.

### 5. Page-thinning source test

Add one source-level test (matching the style used by R8/R9/R10 source tests) that reads `app/orders/[orderId]/page.tsx` and asserts the following identifiers no longer appear as declared functions:

- `deriveOperationalPackageLines`
- `valueDisplayForOperationalSelection`
- `emptyOverviewComposition`
- `emptyProductionDeliverables`

The intent is to prevent silent reintroduction during future page edits.

## What R11 Must Not Centralize

- The `Promise.all` order-details loader.
- The `FINANCIAL_CASE_PAYMENT_STATUS_LABELS[headerFinancial.paymentStatusEnum]` header lookup.
- The typed `selection.orderStatus === "Active"` selection-tab predicate.
- A full `getOrderDetailsView(orderId)` orchestrator.
- Any R12 fallback or compatibility cleanup (`summarizeInvoices()`, `getOrderSettlementInvoices()`, `OrderDetail` photo-count compat fields, `mapBookingDetail()` dedup, etc.).

## Observability Checklist

### Dashboards / Metrics

- No new production metric. The existing `order_details.financials_tab.rendered` log line stays.
- Regression coverage only: projector unit tests for the new operational-configurations display, production deliverables photo-count fields, empty composition fallback contract, and the page-thinning source test.

### Rollback Plan

- No schema changes. No down-migration needed.
- If any single sub-change regresses, roll back that change only. Restoring `deriveOperationalPackageLines` in the page, restoring `emptyOverviewComposition`/`emptyProductionDeliverables`, restoring `order.includedPhotoCount`/`order.extraPhotoCount` reads in the production tab, or reverting the copy fix are all independently revertable.
- If the projector signature change (option (a) above) causes consumer churn, switch to option (b) (named empty-DTO constructors) instead of holding the spec.

### Customer-Visible Surface

- The only visible change is the selection tab's locked-state copy ("Base payment" → "deposit"), aligning with the R10 deposit terminology.
- Operational configurations, overview composition, production deliverables, photo counts, financial readouts, workflow forms, and tab structure render identically.

## Post-Implementation

- After this PR, update `context/progress-tracker.md` Now to say R11 order-detail page thinning is complete and R12 cleanup is next.
- Do not update `context/architecture-context.md` or `context/code-standards.md` unless implementation discovers a documented rule conflict.
- Do not refresh `context/reviews/invariant-catalog.md`; R11 does not change financial invariants.

## Acceptance Criteria

- No `getOrderDetailsView(orderId)` service is introduced.
- The `Promise.all` loader at the top of `app/orders/[orderId]/page.tsx` is not moved into a service.
- `app/orders/[orderId]/page.tsx` no longer defines `deriveOperationalPackageLines` or `valueDisplayForOperationalSelection`. Operational session-configuration display comes from a composition module projector.
- `app/orders/[orderId]/page.tsx` no longer defines `emptyOverviewComposition` or `emptyProductionDeliverables`. Stable empty projection DTOs come from the composition module (via null-tolerant projectors or named empty-DTO helpers).
- The production tab reads `includedPhotoCount` and `extraPhotoCount` from `ProductionDeliverablesProjection`, not from `OrderDetail`.
- The selection tab's locked-state copy no longer reads "Base payment"; it uses the current "deposit" terminology.
- `OperationalConfigurationsBlock` and its consumer prop shape are unchanged; the new projector returns the same `OperationalConfigurationsPackageLine[]` it expects today.
- A page-thinning source test asserts `deriveOperationalPackageLines`, `valueDisplayForOperationalSelection`, `emptyOverviewComposition`, and `emptyProductionDeliverables` are not declared in `app/orders/[orderId]/page.tsx`.
- New projector unit tests cover operational-configuration filtering by `financialBehavior`, value-display mapping per `inputType`, empty composition fallback, and the new production deliverables photo-count fields.
- Existing R8 composition-consumer tests and R10 workflow-policy tests remain green.
- No `@/lib/db` import is added to `app/**` or `src/components/**`.
- No Prisma schema, migration, enum, seed, invoice/payment/refund/adjustment, composition write, or workflow transaction behavior change.
- `OrderDetail.includedPhotoCount` and `OrderDetail.extraPhotoCount` are not removed (R12 owns broader compat removal).
- `summarizeInvoices()`, `getOrderSettlementInvoices()`, and other compatibility fallbacks are not removed in this spec.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
