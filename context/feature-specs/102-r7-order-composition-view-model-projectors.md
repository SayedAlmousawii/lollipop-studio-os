# Feature 102 - R7: OrderCompositionViewModel + Composition Projectors

## Goal

Create the canonical `OrderCompositionViewModel` read layer and the pure surface projectors that will let R8 swap POS, current-composition, overview, and production composition consumers without recomputing package, add-on, extra-photo, session-configuration, or adjustment composition state in pages/components. This is one shared R7 feature spec because the roadmap item is operationally split, but it must be implemented as two independently mergeable PRs: R7a for the core model and structured metadata, then R7b for projectors plus the adjustment-workspace POS adapter.

## Read First

- `context/reviews/centralization-roadmap.md` - Spec R7, risk controls, R7 test row, section 5 do-not-touch boundaries, and section 8.5 composition metadata decision.
- `context/feature-specs/101-r6-financial-swap-cleanup.md` - confirms the financial readout swap is locked before composition centralization starts.
- `context/feature-specs/99-r4-money-formatting-centralization.md` - formatter ownership and explicit deferral of composition label parsing to R7.
- `src/modules/orders/order.types.ts` - current `POSWorkspace`, `POSPackageLine`, `POSAddOn`, `POSInvoiceSummary`, and `OrderDetail.packageLines` shapes.
- `src/modules/orders/order.service.ts` - current `getPOSWorkspace(...)`, `mapPOSPackageLines(...)`, `mapPOSAddOns(...)`, `getOrderHubById(...)`, and order detail package/add-on mapping.
- `src/modules/adjustment-workspace/adjustment-workspace.types.ts` - current `AdjustmentBaseSnapshot`, `AdjustmentCompositionLine`, `AdjustmentWorkspaceProposal`, and pending edit shapes.
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts` - current `getEffectiveCompositionForInvoice(...)`, `derivePOSWorkspaceFromAdjustmentWorkspace(...)`, `computeWorkspaceProposal(...)`, `captureCurrentOrderComposition(...)`, and composition delta helpers.
- `src/modules/composition-view/composition-view.model.ts` - current card view builder and the label-parsing drift R7 must replace for the new canonical path.
- `src/modules/adjustment-workspace/pending-changes-view.ts` - current pending-change display helper; read only to avoid accidentally coupling R7 to a broader pending-change rewrite.
- `src/components/orders/current-composition-card.tsx`, `src/components/orders/pos-package-composition.tsx`, `src/components/orders/pos-add-on-marketplace.tsx`, `src/components/orders/financial-sidebar-draft.tsx`, `app/orders/[orderId]/page.tsx`, `app/orders/[orderId]/sales/page.tsx`, and `app/orders/[orderId]/adjustment-workspace/page.tsx` - consumer shapes to project for, without swapping them in R7.
- `tests/composition-view/`, `tests/adjustment-workspace/finalize-integration.test.ts`, and existing `tests/orders/` render tests - current test patterns for composition card and adjustment POS projection parity.

## Rules

- **Two PRs, one spec.** Implement R7a and R7b separately. R7a must be mergeable without the R7b projectors. R7b must build on R7a without revisiting R7a behavior.
- **Read-only composition layer.** Do not change package, add-on, selected-photo, session-configuration, invoice, credit-note, payment, adjustment finalization, or POS mutation behavior.
- **No schema or migration change.** Structured display metadata is computed at read time from existing records, edit operations, line IDs, and catalog context. Do not persist new metadata fields in Prisma.
- **No consumer swap.** R7 adds canonical read models, projectors, adapters, and tests. R8 owns switching `financial-sidebar-draft.tsx`, `pos-package-composition.tsx`, `pos-add-on-marketplace.tsx`, order overview, and production deliverables to consume those projectors.
- **Write paths remain split.** Direct POS mutations and adjustment-workspace staged edits stay separate. The new model unifies read shape only.
- **No UI redesign.** Components should not change visible behavior in R7 except where tests instantiate new projector fixtures. Staff-visible composition rendering changes belong to R8.
- **Use existing helpers before inventing math.** Reuse `getPOSWorkspace(...)`, `getEffectiveCompositionForInvoice(...)`, `getAdjustmentWorkspaceView(...)`, `computeWorkspaceProposal(...)`, `priceSelections(...)`, existing extra-photo pricing resolution, and existing package/add-on mapping rules where practical.
- **New canonical path avoids label parsing.** The new `OrderCompositionViewModel` and R7 projectors must classify swaps/upgrades from structured metadata, edit operations, line IDs, entity refs, and catalog lookups, not by parsing display labels like `"Album 30x30 to Album 20x20"`.
- **Compatibility with current live callers.** At drafting time, `app/orders/[orderId]/sales/page.tsx` and `app/orders/[orderId]/adjustment-workspace/page.tsx` call `buildCompositionView(...)` directly with `AdjustmentCompositionLine[]`. R7 may leave that legacy call path in place until R8, but the newly added model/projector path must be metadata-driven and covered by tests. Do not break existing live callers in the name of cleanup.
- **Current implementation drift to account for.** `src/modules/composition-view/composition-view.model.ts` currently groups swaps and upgrades by parsing labels. `derivePOSWorkspaceFromAdjustmentWorkspace(...)` currently reconstructs a `POSWorkspace` by hand from proposed adjustment lines. These are the only R7-relevant drifts to fix or isolate.
- **Do not broaden into R8/R9/R10.** Do not move photo draft helpers out of `pos-package-composition.tsx`, change add-on marketplace filtering, centralize locked notices, build `OrderEditModePolicy`, or introduce workflow policy builders in R7.

## Scope

### In Scope

#### PR R7a - Core Model + Structured Composition Metadata

- New module folder `src/modules/orders/composition/` with:
  - `order-composition.types.ts` - canonical model and line metadata types.
  - `order-composition.service.ts` - service entry points for composing draft, locked/effective, and pending-adjustment composition state.
  - `index.ts` - exports for the model service/types only.
- `OrderCompositionViewModel` shape covering:
  - `orderId`, `jobNumber`, and source state (`draft`, `locked`, `adjustment` or similarly explicit discriminator).
  - `baseComposition` for locked/adjustment states.
  - `effectiveComposition` for current operational composition after finalized adjustments.
  - `pendingAdjustmentComposition` for an open workspace proposal when requested.
  - `packageLines`, `packageItems`/deliverables, `addOns`, `extraPhotos`, `sessionConfigurations`, and `totals`.
  - raw numeric totals for package base, package upgrade delta, deliverables, add-ons, extra photos, session configurations, and net composition total.
  - structured per-line metadata such as `displayKind`, `sourceKind`, `fromLabel`, `toLabel`, `categoryLabel`, `orderPackageId`, `productId`, `packageId`, `configurationId`, and stable row IDs as applicable.
- Metadata derivation from existing sources:
  - draft composition from `getPOSWorkspace(...)`/current order rows.
  - locked/effective composition from `getEffectiveCompositionForInvoice(...)` plus existing finalized adjustment folding.
  - pending proposal composition from `getAdjustmentWorkspaceView(...)` / `computeWorkspaceProposal(...)`.
  - edit-derived labels from `AdjustmentWorkspaceEdit` and catalog lookups rather than parsing line labels.
- Tests for core model scenarios:
  - draft order with package lines, package items, selected-photo counts, add-ons, and session-configuration financial selections.
  - locked order with finalized positive and negative adjustments.
  - open adjustment workspace with package tier change, package item upgrade, selected-photo change, add-on add/remove/swap, and financial session-configuration selection change.
  - metadata coverage for every `AdjustmentWorkspaceEdit["op"]` that can affect composition display.
- A regression test that fails if the new `src/modules/orders/composition/` files parse display labels with `" to "` matching, `parseChangeLabel`, or equivalent label-derived swap logic.

#### PR R7b - Projectors + Adjustment POS Adapter

- New folder `src/modules/orders/composition/projections/` with pure projectors:
  - `to-draft-pos-composition.ts`
  - `to-locked-pos-composition.ts`
  - `to-current-composition-card.ts`
  - `to-overview-tab.ts`
  - `to-production-deliverables.ts`
  - `index.ts`
- Projector outputs are surface-specific DTOs:
  - Draft POS composition DTO for the future R8a draft sidebar and POS package composition swap.
  - Locked POS composition DTO for locked/read-only sales state.
  - Current composition card DTO compatible with `CurrentCompositionCard` without label parsing.
  - Overview tab DTO replacing future reads from `OrderDetail.packageLines`.
  - Production deliverables DTO focused on deliverable rows and production-relevant quantities.
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts`
  - Rewrite `derivePOSWorkspaceFromAdjustmentWorkspace(workspaceId)` as a thin adapter over the R7 model/projectors while preserving its public `Promise<POSWorkspace | null>` contract.
  - Keep adjustment write functions, finalization, edit application, and guards unchanged.
- Tests:
  - projector unit/snapshot tests for representative model fixtures.
  - POS workspace byte-equivalence tests comparing legacy derived `POSWorkspace` output to the new adapter output for the existing fixture matrix.
  - current-composition-card projector tests proving swap/upgrade rows are driven by metadata (`fromLabel`/`toLabel`) and no label parser path is used.
  - purity tests asserting projector files import no DB client, no page/component modules, and no adjustment write functions.

### Out of Scope

- Any Prisma schema, migration, seed data, or persisted JSON shape change.
- Any invoice, payment, refund, credit-note, booking, POS mutation, adjustment-workspace finalization, or session-configuration write behavior change.
- Swapping live consumers to the new projectors. R8a/R8b/R8c own consumer migration.
- Moving `buildPhotoLineDraft`, `resolveBillingMode`, `getPhotoLinePreview`, or `resolvePhotoPayload` out of `pos-package-composition.tsx`; R8a owns the POS photo helper move.
- Changing `POSAddOnMarketplace` counts/category filtering; R8b owns that swap.
- Changing order overview or production tab rendering; R8c owns those swaps.
- Centralizing edit-mode notices, blocked reasons, route targets, or manager-approval messaging; R9 owns `OrderEditModePolicy`.
- Rewriting `buildPendingChangesView(...)` except for type-only alignment needed to compile against shared metadata types. Pending-change display policy is not R7's target.
- Introducing `getOrderDetailsView(orderId)` or page-level orchestration cleanup; R11 owns that.
- Removing legacy composition helpers that are still used by live R8 consumers.

## Implementation Direction

### Shared Direction

Treat R7 like the composition equivalent of R1: add canonical infrastructure first, then project it for future consumers, without swapping UI yet. The model owns composition truth. Projectors reshape that truth. Pages and components remain untouched until R8.

The canonical model should expose raw numbers and stable structured metadata. Display strings such as `priceLabel` may still exist on compatibility DTOs like `POSWorkspace`, but the canonical model/projectors should preserve raw amounts and let components format with `src/lib/formatting/money.ts` when R8 swaps them.

Do not persist metadata on `AdjustmentCompositionLine` rows or workspace snapshots. Compute it in the R7 read service by combining the existing snapshot/proposal lines with available structural context: edit operations, line ID conventions, `kind`, `refId`, order package IDs, package item IDs, session-configuration selection IDs, and catalog rows. If an edge case cannot be classified without parsing the label, surface an explicit `displayKind: "line"` / unclassified metadata state and cover it in tests rather than reintroducing a text parser.

### PR R7a - Core Model + Structured Metadata

Start with `src/modules/orders/composition/order-composition.types.ts`. Keep the types smaller than `POSWorkspace`; do not copy every action/catalog field just because POS currently carries it. The model should answer "what is the customer buying or changing?" not "which button can mutate it?"

Recommended high-level shape:

```ts
export type OrderCompositionViewModel = {
  orderId: string;
  jobNumber: string;
  state: "draft" | "locked" | "adjustment";
  baseComposition: CompositionSnapshot | null;
  effectiveComposition: CompositionSnapshot;
  pendingAdjustmentComposition: CompositionSnapshot | null;
  totals: CompositionTotals;
};
```

Each `CompositionSnapshot` should group `packageLines`, `addOns`, `extraPhotos`, `sessionConfigurations`, and `deliverables`, while each displayable line carries metadata similar to:

```ts
type CompositionDisplayMetadata = {
  displayKind: "package" | "addOn" | "extraPhotos" | "sessionConfiguration" | "swap" | "upgrade" | "line";
  sourceKind: "orderPackage" | "packageItem" | "orderAddOn" | "extraPhoto" | "sessionConfiguration" | "adjustmentDelta";
  fromLabel?: string;
  toLabel?: string;
  categoryLabel?: string;
};
```

These exact names may change if implementation discovers a better local fit, but the metadata must be structured enough for `toCurrentCompositionCard(...)` to render swap/upgrade rows without parsing `label`.

Build the draft model from the same source data as `getPOSWorkspace(...)`. Prefer extracting narrowly reusable mapping helpers from `order.service.ts` only if doing so avoids duplication without destabilizing that service. Do not move unrelated order loader logic.

Build locked/effective model state from `getEffectiveCompositionForInvoice(...)`. Existing finalized adjustment folding remains authoritative. The R7 model wraps and annotates the result; it does not alter how effective composition is calculated.

Build pending-adjustment state from the open workspace proposal. The strongest metadata source is the edit list itself. For example, `upgrade_package_item` already has `packageItemId` and `toProductId`; `change_package_tier` already has `orderPackageId` and `toPackageRefId`; session-configuration edits already have `configurationId` and desired value. Use those structured values plus catalog rows to produce `fromLabel`/`toLabel`.

If R7a needs to keep the existing `buildCompositionView(...)` label parser alive for live pages, leave it in place and mark it as legacy in code comments only if a comment is genuinely useful. The R7a regression should target the new module, not fail because old live callers still exist before R8.

### PR R7b - Projectors + Adapter

Projectors belong under `src/modules/orders/composition/projections/` and should be pure functions over `OrderCompositionViewModel`. They should not import `@/lib/db`, `order.service.ts`, `adjustment-workspace.service.ts`, React components, or server actions.

`toCurrentCompositionCard(model, options?)` should produce the existing `CompositionView` shape or a narrow structurally compatible card DTO. It must classify rows from metadata:

- `displayKind: "swap"` renders a single delta row with `fromLabel`, `toLabel`, and signed amount.
- `displayKind: "upgrade"` renders a change row with `fromLabel`, `toLabel`, and amount.
- package, add-on, extra-photo, and session-configuration rows pass through with raw quantities and amounts.
- unclassified rows render as plain lines and must not be dropped.

`toDraftPOSComposition(...)` and `toLockedPOSComposition(...)` should be shaped for the future R8 swaps, not for every possible order action. If the easiest safe compatibility path is to project to a `POSWorkspace`-compatible subset, keep the boundary explicit with named DTO types rather than making `OrderCompositionViewModel` itself look like `POSWorkspace`.

For `derivePOSWorkspaceFromAdjustmentWorkspace(...)`, keep the public function name and return type so existing adjustment workspace pages continue to work. Internally, it should load the R7 pending-adjustment model and call a projector/adapter that returns the same `POSWorkspace` shape as today. The adapter may preserve POS catalog/action fields from the existing `getPOSWorkspace(...)` loader if those fields are not composition truth. The important cleanup is that proposed package lines, add-ons, selected-photo counts, item upgrades, and composition totals come from the R7 model/projector instead of being independently reconstructed in `adjustment-workspace.service.ts`.

Byte-equivalence is the R7b safety gate. Use existing integration fixture coverage from `tests/adjustment-workspace/finalize-integration.test.ts` and add a focused helper or snapshot test that compares old-vs-new adapter output for representative workspaces. If implementation cannot keep both old and new adapter code in the same commit for comparison without awkward duplication, capture the legacy output fixtures first, then assert the new adapter against those fixtures.

## Observability Checklist

### Dashboards / Metrics

- No new production metric is required for R7a.
- R7b may add a temporary test-only parity helper for old-vs-new `derivePOSWorkspaceFromAdjustmentWorkspace(...)` output, but it should not emit a production discrepancy metric unless implementation discovers real runtime ambiguity.
- Existing `pos.adjustment.viewed` and adjustment-workspace metrics remain unchanged.
- The durable signal for R7 is test coverage: metadata coverage, projector purity, and POS adapter byte-equivalence.

### Rollback Plan

- No schema changes. No down-migration needed.
- R7a rollback: remove `src/modules/orders/composition/` and its tests. Existing live composition pages should still use the pre-R7 paths.
- R7b rollback: restore the previous body of `derivePOSWorkspaceFromAdjustmentWorkspace(...)` and remove the new projector folder/tests. Leave R7a in place if it is already merged and unused by live consumers.
- If a projector shape proves wrong for R8, add a new projector or revise the R7b projector before consumer swap. Do not make R8 compensate by adding page/component derivation.

### Customer-Visible Surface

- No intentional staff-visible or customer-visible change in R7.
- POS sales, adjustment workspace, current composition card, order overview, and production tabs should render exactly as before because live consumers are not swapped.
- Adjustment workspace POS modules should behave the same after the R7b adapter rewrite, verified by existing interaction/integration tests.

## Post-Implementation

- After R7a: update `context/progress-tracker.md` Now to say R7a is complete, the core `OrderCompositionViewModel` and structured metadata exist, and R7b projectors/POS adapter are next.
- After R7b: update `context/progress-tracker.md` Now to say R7 is complete and R8 composition consumer swaps are next.
- Do not update architecture-context or code-standards unless implementation discovers a documented rule conflict.
- Do not refresh `context/reviews/invariant-catalog.md`; R7 should not change financial reconciliation invariant metadata.

## Acceptance Criteria

### PR R7a - Core Model + Structured Composition Metadata

- `src/modules/orders/composition/` exists with typed exports for `OrderCompositionViewModel`, composition snapshots, totals, display metadata, and the core read service.
- The core service can build draft, locked/effective, and pending-adjustment composition state without changing existing write behavior.
- The model exposes package lines, deliverables/package items, add-ons, extra photos, session-configuration financial selections, and raw totals needed by R8 consumers.
- Every displayable model line has a stable ID, raw amount fields, and structured metadata including `displayKind` and enough source IDs/labels to render without parsing user-facing labels.
- Metadata coverage tests include package tier change, package item upgrade, selected-photo change, add-on add/remove/swap, session-configuration financial selection change, finalized positive adjustment, finalized negative adjustment, and plain/unclassified line fallback.
- New model code does not parse display labels to detect swaps/upgrades. A regression test fails on `parseChangeLabel`, regexes matching `" to "`, or equivalent label-derived swap logic under `src/modules/orders/composition/`.
- Existing `buildCompositionView(...)` may remain for live pre-R8 callers, but no newly added R7 model API depends on its label parser.
- No page/component starts importing the new composition service in R7a.
- No `@/lib/db` import is added to `app/**` or `src/components/**`.
- Existing composition-view and adjustment-workspace tests still pass.
- `npm run build` passes.
- `npm run lint` passes.

### PR R7b - Projectors + Adjustment POS Adapter

- `src/modules/orders/composition/projections/` exists and exports `toDraftPOSComposition`, `toLockedPOSComposition`, `toCurrentCompositionCard`, `toOverviewTab`, and `toProductionDeliverables` or equivalently named projector functions.
- Each projector is a pure function over `OrderCompositionViewModel`; projector files import no DB client, no page/component modules, no server actions, and no adjustment write-service functions.
- `toCurrentCompositionCard(...)` produces swap/upgrade/plain rows from structured metadata, not from parsing labels.
- `toDraftPOSComposition(...)` and `toLockedPOSComposition(...)` expose the package, item, add-on, extra-photo, session-configuration, and total fields R8a will need, with raw numeric values preserved.
- `toOverviewTab(...)` exposes the fields needed to stop future overview rendering from depending on `OrderDetail.packageLines`.
- `toProductionDeliverables(...)` exposes production-relevant deliverable rows and quantities without financial derivation.
- `derivePOSWorkspaceFromAdjustmentWorkspace(workspaceId)` keeps its public `Promise<POSWorkspace | null>` contract and becomes a thin adapter over the R7 model/projector path.
- The R7b adapter output is byte-equivalent or value-equivalent on all public `POSWorkspace` fields currently used by adjustment workspace POS modules for representative staged edits.
- Existing tests that exercise `derivePOSWorkspaceFromAdjustmentWorkspace(...)` still pass, including package tier changes, package item upgrades, selected-photo edits, add-on edits, and revert/no-op scenarios.
- No live POS, overview, production, or current-composition consumer is swapped to the new projectors in R7b.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.

### Overall R7

- R7 ships read-layer infrastructure only. It does not change schema, persisted data, write behavior, or visible composition UI.
- `OrderCompositionViewModel` is the canonical composition read model for future R8/R11 work.
- R7 projectors reshape the model for specific surfaces and do not own composition math.
- The documented roadmap drift is addressed: the new canonical path does not rely on composition label parsing, and `derivePOSWorkspaceFromAdjustmentWorkspace(...)` no longer independently reconstructs proposed POS composition once R7b lands.
