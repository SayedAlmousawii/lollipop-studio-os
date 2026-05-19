# Feature 103 - R8: Swap Composition Consumers To Projectors

## Goal

Move the current composition display consumers onto the R7 `OrderCompositionViewModel` projectors so POS, adjustment preview, order overview, and production deliverable readouts stop deriving package, add-on, extra-photo, session-configuration, and deliverable display truth from `POSWorkspace`, `OrderDetail.packageLines`, or legacy composition label parsing. This is one shared R8 feature spec because the roadmap item is operationally split, but it must be implemented as three independently mergeable PRs: R8a for draft sidebar/POS package and photo composition plus current-composition card swaps, R8b for add-on marketplace state, and R8c for order overview plus production deliverables.

## Read First

- `AGENTS.md` - repository rules, especially service-only DB access, small scope, and docs-only progress behavior.
- `context/ui-context.md` - UI tokens and page/component patterns for the touched order surfaces.
- `context/reviews/centralization-roadmap.md` - Spec R8, risk controls, R8 test row, do-not-touch boundaries, and R8/R9/R10 sequencing.
- `context/feature-specs/102-r7-order-composition-view-model-projectors.md` - R7 model/projector contracts, current drift, and the R8 handoff.
- `context/feature-specs/99-r4-money-formatting-centralization.md` - money formatting ownership for component-rendered raw amounts.
- `src/modules/orders/composition/order-composition.types.ts` - canonical model, snapshots, totals, and metadata fields.
- `src/modules/orders/composition/order-composition.service.ts` - current model entry points and R7 snapshot builders.
- `src/modules/orders/composition/projections/` - current R7 projectors: draft POS composition, locked POS composition, current composition card, overview tab, and production deliverables.
- `src/modules/orders/order.types.ts` - existing `POSWorkspace`, `POSPackageLine`, `POSAddOn`, `OrderDetail.packageLines`, and workflow DTO shapes that R8 consumers currently receive.
- `src/components/orders/financial-sidebar-draft.tsx` - current draft sidebar local total derivation from `POSWorkspace`.
- `src/components/orders/pos-package-composition.tsx` - current package total rendering and local photo draft/preview helpers.
- `src/components/orders/pos-add-on-marketplace.tsx` - current add-on count and category filtering from `workspace.addOns` / `workspace.productOptions`.
- `src/components/orders/current-composition-card.tsx` and `src/modules/composition-view/composition-view.model.ts` - card rendering shape and legacy label-parsing builder that live pages still call.
- `app/orders/[orderId]/sales/page.tsx` and `app/orders/[orderId]/adjustment-workspace/page.tsx` - live POS, locked sales, and adjustment preview composition wiring.
- `app/orders/[orderId]/page.tsx` - overview and production tabs currently reading `OrderDetail.packageLines`, `paidAddOns`, and local deliverable summary helpers.
- `src/modules/orders/order.service.ts` - current `getPOSWorkspace(...)`, `getOrderHubById(...)`, `getOrderSelectionWorkflowById(...)`, and `getOrderProductionWorkflowById(...)` source shapes.
- `tests/orders/order-composition-view-model.test.ts`, `tests/orders/pos-handler-components.test.tsx`, `tests/composition-view/`, and existing order detail render tests - current projector, component, and composition-card test patterns.

## Rules

- **Three PRs, one spec.** Implement R8a, R8b, and R8c separately. Each PR must be independently reviewable, testable, mergeable, and behavior-preserving.
- **Consumer swaps only.** R8 wires existing surfaces to R7 model/projector outputs. It must not change package, add-on, photo, session-configuration, invoice, payment, adjustment finalization, or POS mutation behavior.
- **No schema or migration change.** If a component needs a field the R7 projection does not expose, extend the read model/projector shape from existing data. Do not persist new metadata.
- **Composition truth comes from projectors.** Components may keep local UI state for editing forms, but saved composition values, totals, current add-on counts, current package/deliverable rows, photo pricing inputs, overview rows, and production deliverable rows must come from `OrderCompositionViewModel` projectors instead of component/page recomputation.
- **Keep write adapters separate.** Direct sales handlers and adjustment-workspace staged handlers stay as they are. R8 may pass extra read-only projection props to shared POS components, but it must not merge handler contracts or persistence paths.
- **Catalog/action metadata is not composition truth.** `POSWorkspace` may continue to provide product catalogs, package options, available session configurations, current selections needed by `ConfigureSessionPanel`, invoice/payment controls, and handler context. Do not use `POSWorkspace` package/add-on/photo/session totals as the display source once the corresponding R8 section is swapped.
- **Client components must not import DB-backed services.** If a client component needs projection types or pure helpers, import only pure projector/type modules or receive a server-built DTO prop. Do not import the `src/modules/orders/composition` barrel into client components if doing so pulls in service loaders or `@/lib/db`.
- **No UI redesign.** Preserve existing visual hierarchy, copy, actions, and empty states except for unavoidable wording needed to reflect projector-shaped data.
- **Current implementation drift to account for.** R7 projectors exist, but live consumers still use `POSWorkspace`, `OrderDetail.packageLines`, and direct `buildCompositionView(...)`. `FinancialSidebarDraft` still sums package/add-on/session totals locally. `POSPackageComposition` still owns photo preview/payload helpers. `POSAddOnMarketplace` still computes current add-on counts in the component. Order overview and production still read legacy `OrderDetail` composition fields. These are the R8-only drifts to fix.
- **Do not broaden into policies or orchestration.** Do not build `OrderEditModePolicy`, workflow policy builders, or `getOrderDetailsView(orderId)`. R9, R10, and R11 own those.

## Scope

### In Scope

#### PR R8a - Draft Sidebar, POS Package/Photo Composition, Current Composition Cards

- `app/orders/[orderId]/sales/page.tsx`
  - Load the appropriate `OrderCompositionViewModel` for unlocked draft POS and locked sales view.
  - Build `toDraftPOSComposition(...)` for unlocked sales surfaces.
  - Build `toCurrentCompositionCard(...)` for locked sales current composition instead of calling `buildCompositionView(...)`.
  - Preserve existing `getPOSWorkspace(...)` usage for invoice/payment controls, package options, available configurations, row actions, product/catalog metadata, and server-action handler context.
- `app/orders/[orderId]/adjustment-workspace/page.tsx`
  - Build the adjustment preview card from `toCurrentCompositionCard(...)` using the pending adjustment model/projection instead of calling `buildCompositionView(...)`.
  - Continue using `derivePOSWorkspaceFromAdjustmentWorkspace(...)` and existing handler adapters for staged edit controls unless a narrow projection prop is needed for read-only display.
- `src/components/orders/financial-sidebar-draft.tsx`
  - Accept a draft composition projection prop.
  - Render package, extra-photo, add-on, session-configuration, and preview total rows from projector output.
  - Keep invoice snapshot/payment controls from `POSWorkspace.invoice`; do not alter payment dialog or invoice creation behavior.
- `src/components/orders/pos-package-composition.tsx`
  - Accept a POS composition projection prop for package line display, package price total, deliverable rows, selected-photo saved values, extra-photo pricing inputs, and session-configuration financial rows.
  - Remove local package total derivation from `workspace.packageLines`.
  - Move the photo saved-state helpers currently named `buildPhotoLineDraft`, `resolveBillingMode`, `getPhotoLinePreview`, and `resolvePhotoPayload` out of the component into the service-layer projection path or a pure projector helper owned by `src/modules/orders/composition/projections/`.
  - Moving photo helper logic out of the component must preserve hidden form payload shape, submit behavior, and handler contracts exactly. Do not change sales or adjustment handler payload semantics during R8a.
  - Keep transient form state, blur/submit behavior, hidden fields, manager-approval modal integration, and handler calls in the client component.
  - Continue reading `availableConfigurations`, `currentSelections`, `packageOptions`, and `productOptions` from `POSWorkspace` until R9/R11 provide a broader page DTO.
- Tests
  - Component render tests proving draft sidebar and POS package/photo composition render the same staff-facing labels and amounts from projection fixtures.
  - Regression tests proving the removed photo helper names no longer exist in `pos-package-composition.tsx`.
  - Source test proving live sales and adjustment pages do not import or call `buildCompositionView(...)`.

#### PR R8b - Add-On Marketplace Projection Swap

- `src/components/orders/pos-add-on-marketplace.tsx`
  - Accept an add-on composition projection, or a marketplace-specific pure projection DTO built from `toDraftPOSComposition(...)` plus catalog inputs.
  - Derive current add-on rows, current product counts, and "already added" state from projection output, not from `workspace.addOns`.
  - Keep product option/catalog availability from `POSWorkspace.productOptions` and `POSWorkspace.addOnCatalog` unless a pure projector adapter is introduced to combine those catalog lists with the composition projection.
  - Preserve `QuickAddDialog`, `CatalogCard`, `CurrentAddOns`, add/remove handler behavior, and inline reductive approval behavior.
- `app/orders/[orderId]/sales/page.tsx` and `app/orders/[orderId]/adjustment-workspace/page.tsx`
  - Pass the same R8a composition projection, or a narrow add-on marketplace DTO, into `POSAddOnMarketplace`.
- Tests
  - Render tests for current add-ons, catalog cards, "Added xN" badges, empty states, and current-row removal using projection fixtures.
  - Regression test proving `pos-add-on-marketplace.tsx` no longer computes current add-on counts directly from `workspace.addOns`.

#### PR R8c - Order Overview + Production Deliverables

- `app/orders/[orderId]/page.tsx`
  - Load the order composition model for the order detail page.
  - Build `toOverviewTab(...)` for overview composition sections.
  - Build `toProductionDeliverables(...)` for production deliverable summaries.
  - Replace overview package/add-on/session-configuration display reads from `OrderDetail.packageLines`, `OrderDetail.packageItems`, and `OrderDetail.paidAddOns` with projector output where the projection owns the display truth.
  - Replace the production deliverables summary currently built from `formatDeliverablesSummary(order.packageItems, order.paidAddOns)` with production deliverable projection data.
  - Keep workflow status fields, financial header/financial tab projectors, activity, related records, and action forms unchanged.
- `src/modules/orders/composition/projections/`
  - Extend `toOverviewTab(...)` only as needed to cover existing overview UI rows without moving business logic into the page.
  - Extend `toProductionDeliverables(...)` only as needed to represent production-relevant deliverables and quantities. It must not introduce financial derivation.
- `src/modules/orders/order.service.ts`
  - Do not remove `OrderDetail.packageLines` or selection workflow package lines yet. R11/R12 own broader DTO cleanup. R8c only stops the order detail overview/production surfaces from depending on them.
- Tests
  - Order detail render tests proving overview package/deliverable/add-on rows and production deliverable summaries come from projector fixtures.
  - Source tests proving `OverviewTab` and `ProductionTab` no longer read `OrderDetail.packageLines`, `OrderDetail.packageItems`, or `OrderDetail.paidAddOns` for composition display.
  - Projector tests for multi-package, package-item upgrade, add-on, extra-photo, session-configuration, and pending-adjustment/effective states relevant to overview and production.

### Out of Scope

- Any Prisma schema, migration, seed data, or persisted JSON shape change.
- Any invoice, payment, refund, credit-note, adjustment-workspace finalization, booking, POS mutation, or session-configuration write change.
- Changing `POSCompositionHandlers`, `POSAddOnHandlers`, sales server actions, adjustment workspace staged actions, or approval semantics except for type-only read prop additions.
- Replacing `getPOSWorkspace(...)` as the source for catalogs, package options, available configurations, current selections, invoice controls, or handler context.
- Removing `OrderDetail.packageLines`, `OrderDetail.packageItems`, `OrderDetail.paidAddOns`, selection workflow package lines, or legacy order service mapping helpers globally.
- Removing `src/modules/composition-view/composition-view.model.ts` or its tests while any non-R8 live or test-only caller still needs it. R8 should remove production page calls to it, but full deletion is not required.
- Centralizing locked notices, blocked reasons, route targets, or manager-approval messaging. R9 owns `OrderEditModePolicy`.
- Building workflow policy builders for booking/editing/production/delivery. R10 owns those.
- Introducing `getOrderDetailsView(orderId)` or collapsing page loader stitching. R11 owns that if still needed.
- Cleaning compatibility/fallback paths such as `getOrderSettlementInvoices()` or legacy order service composition fields. R12 owns cleanup.

## Implementation Direction

Treat R8 as a consumer migration, not a new read-model design. R7 already created the canonical composition model and projectors; R8 should make live surfaces consume them and extend only the narrow projector fields required by those surfaces.

For R8a, start at the sales and adjustment pages. Build the composition model on the server next to the existing `getPOSWorkspace(...)` load, then pass a projector DTO into `FinancialSidebarDraft`, `POSPackageComposition`, `POSPhotoCountCard`, and `CurrentCompositionCard`. The existing `POSWorkspace` prop may remain while these components still need invoice state, package options, product options, available configurations, current selections, and action context. The important boundary is that component-rendered composition rows and totals come from the projector prop.

For photo controls, keep the client interaction model intact. The component can still own transient input state and submit hidden fields through the existing handler props, but the saved baseline, billing mode defaults, per-media unit prices, current extra counts, and preview labels should be supplied by a pure composition projection/helper. That prevents the component from re-deriving extra-photo pricing from `POSPackageLine`.

For current composition cards, replace production page calls to `buildCompositionView(...)` with `toCurrentCompositionCard(...)`. The card component can keep rendering the existing `CompositionView` shape; the page should simply receive that shape from the R7 projector. Preserve row actions such as `ConfigureSessionPanel` by keying them against the projected package row/source IDs rather than the legacy adjustment line parser.

For R8b, keep marketplace commands exactly as they are. The add-on projection should answer "what add-ons are currently part of the composition and how many of each product are present." Catalog availability and quick-action category lists can remain catalog data from `POSWorkspace`, or they can be combined with the projected current add-ons in a pure adapter. The component should not build count maps from `workspace.addOns` after this PR.

For R8c, load one order composition model in the order detail page and pass projected overview/production DTOs to the relevant tab renderers. Do not chase all existing order-service DTO fields. The target is only the order detail overview and production deliverable display, not selection workflow internals or the future R11 page orchestrator.

If a projector needs additional fields, add them close to the existing projection that owns that surface. Keep projector outputs raw enough for components to format with `src/lib/formatting/money.ts`, and avoid formatted-string parsing. Projectors remain pure and should not import `@/lib/db`, React components, pages, server actions, or write services.

## Observability Checklist

### Dashboards / Metrics

- No new production dashboard metric is required.
- Keep existing sales, POS adjustment, and configure-session render metrics unchanged unless a field rename is mechanically required by the swap.
- R8's durable signal is regression coverage: component render parity, no legacy page `buildCompositionView(...)` calls, removed local photo helper names, no component-side add-on count derivation, and no order detail overview/production dependence on legacy composition fields.
- R8a also requires manual smoke testing for draft POS package changes, selected-photo count edits, extra photo pricing, session configuration display, locked current composition card, adjustment workspace staged preview, package item upgrades, and add-on add/remove flows.

### Rollback Plan

- No schema changes. No down-migration needed.
- R8a rollback: restore the affected sales/adjustment page wiring and draft/POS package component props to `POSWorkspace`-only rendering. The R7 projectors can remain unused.
- R8b rollback: restore marketplace count/current-row rendering from `workspace.addOns` while leaving R8a projection props in place.
- R8c rollback: restore order overview and production tabs to `OrderDetail` composition fields while leaving R8a/R8b POS swaps intact.
- If a projector extension is wrong, prefer fixing or reverting the projector extension rather than adding compensating math back into a component.

### Customer-Visible Surface

- Staff should see no intentional workflow or visual redesign.
- Draft POS financial summary, package composition, selected-photo controls, add-on marketplace, locked current composition, adjustment preview composition, overview deliverables, and production deliverable summary should render equivalent values to the pre-R8 surfaces.
- Any visible difference must be a correction from legacy drift and documented in the PR notes.

## Post-Implementation

- After R8a: update `context/progress-tracker.md` Now to say R8a is complete, draft sidebar/POS package-photo composition/current composition cards consume R7 projectors, and R8b add-on marketplace is next.
- After R8b: update `context/progress-tracker.md` Now to say R8b is complete and R8c overview/production deliverables are next.
- After R8c: update `context/progress-tracker.md` Now to say R8 is complete and R9 `OrderEditModePolicy` is next.
- Do not update architecture-context or code-standards unless implementation discovers a documented rule conflict.

## Acceptance Criteria

### PR R8a - Draft Sidebar, POS Package/Photo Composition, Current Composition Cards

- Unlocked sales page builds a draft composition projector DTO and passes it to `FinancialSidebarDraft`, `POSPackageComposition`, and `POSPhotoCountCard`.
- Locked sales current composition card uses `toCurrentCompositionCard(...)`, not `buildCompositionView(...)`.
- Adjustment workspace preview composition card uses `toCurrentCompositionCard(...)`, not `buildCompositionView(...)`.
- `FinancialSidebarDraft` renders package, extra-photo, add-on, session-configuration, and preview total rows from projector output, while preserving invoice snapshot/payment behavior from `POSWorkspace.invoice`.
- `POSPackageComposition` and `POSPhotoCountCard` render package rows, deliverables, selected-photo saved values, extra-photo unit prices/totals, and package price totals from projection data.
- The local helper names `buildPhotoLineDraft`, `resolveBillingMode`, `getPhotoLinePreview`, and `resolvePhotoPayload` no longer exist in `src/components/orders/pos-package-composition.tsx`; equivalent behavior lives in the pure projection path or a pure composition helper owned by `src/modules/orders/composition/projections/`.
- Existing sales and adjustment POS handler behavior, hidden form payloads, inline approval modals, and configure-session panels remain behaviorally equivalent.
- The R8-swapped sales, adjustment-preview, overview, and production composition surfaces no longer import or call `buildCompositionView(...)`.
- Component and projector tests cover draft order, locked order, and pending-adjustment order cases for package lines, package-item upgrades, extra photos, session configurations, and totals.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.

### PR R8b - Add-On Marketplace Projection Swap

- `POSAddOnMarketplace` receives projected current add-on state and no longer derives current add-on product counts or "added" state from `workspace.addOns`.
- Current add-on rows, add-on counts, "Added xN" badges, and current-row removal targets are rendered from projection data.
- Product catalogs and quick-action category availability remain behaviorally equivalent.
- Add/remove actions, approval prompts, empty states, and current add-on row rendering remain behaviorally equivalent for unlocked sales and adjustment workspace contexts.
- Tests cover duplicate add-ons for the same product, null-product legacy/manual add-on rows, empty marketplace, and removal of one projected current add-on.
- A regression test fails if `src/components/orders/pos-add-on-marketplace.tsx` reintroduces direct count-map construction from `workspace.addOns`.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.

### PR R8c - Order Overview + Production Deliverables

- Order detail page builds overview and production deliverable projection DTOs from `OrderCompositionViewModel`.
- Overview tab package, deliverable, add-on, extra-photo, and session-configuration composition readouts consume `toOverviewTab(...)` output instead of `OrderDetail.packageLines`, `OrderDetail.packageItems`, or `OrderDetail.paidAddOns`.
- Production tab deliverable summary consumes `toProductionDeliverables(...)` output instead of `formatDeliverablesSummary(order.packageItems, order.paidAddOns)`.
- `formatDeliverablesSummary(...)` is removed from `app/orders/[orderId]/page.tsx` if no longer used there.
- `OrderDetail.packageLines`, `OrderDetail.packageItems`, and `OrderDetail.paidAddOns` may remain in service DTOs for untouched surfaces, but order detail overview/production composition rendering no longer depends on them.
- Workflow status fields, financial tab/header projectors, order settlement summary, activity tab, related records, and action forms are unchanged.
- Tests cover overview and production projections for multi-package orders, package-item upgrades, standalone add-ons, extra photos, and no-structured-deliverable fallback.
- A source or render regression test fails if `OverviewTab` or `ProductionTab` reintroduces composition display reads from `OrderDetail.packageLines`, `OrderDetail.packageItems`, or `OrderDetail.paidAddOns`.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.

### Overall R8

- R8 changes only read/display wiring for composition consumers.
- No schema, persisted data, invoice/payment math, POS write behavior, adjustment finalization behavior, or handler contract semantics change.
- `OrderCompositionViewModel` projectors are the source for the swapped composition surfaces.
- `POSWorkspace` remains allowed only for catalogs, available configuration controls, invoice/payment controls, handler context, and other non-composition-truth data until R11/R12 cleanup.
