## Goal

Repair the `PACKAGE_ITEM_UPGRADE` staging contract so the unified Sales surface can stage the existing "Upgrade" / "Replace" UI intent truthfully. The current UI event sends `{ orderPackageId, packageItemId, toProductId, quantity }`, where `packageItemId` is the included package item being replaced and `toProductId` is the selected replacement product. The existing OrderCommit staging schema accepts only `packageItemId` and resolves that value as a `PackageItem` row, so an adapter-only implementation would either ignore the selected replacement product or pass an invalid identifier into the resolver.

This spec is therefore a small contract-correction prerequisite for the adapter wiring. After this spec, `PACKAGE_ITEM_UPGRADE` staging can resolve the current included package item plus the selected replacement product, lock the calculated upgrade delta into the pending snapshot, and preserve the existing reducer/materializer merge behavior. The Sales adapter wiring remains deferred until the corrected contract exists.

## Read First

- `/tmp/pos-domain-blocked-workflows-investigation.md` — §1 workflow #4 and §2 Category F for why package-item upgrade is the smallest remaining Sales domain.
- `context/reviews/unified-order-commit-live-pos-roadmap.md` — Phase 5.5 domain coverage and canonical source rules.
- `context/feature-specs/122-order-commit-draft-staging-reducers.md` — `PACKAGE_ITEM_UPGRADE` reducer contract and package-plus-item merge behavior.
- `src/modules/orders/pos-handlers.types.ts:29` — live UI handler input shape `{ orderPackageId, packageItemId, toProductId, quantity }`.
- `src/components/orders/pos-package-composition.tsx:915` — `ItemUpgradeDialog`; confirms `packageItemId` comes from the current included item and `newProductId` becomes `toProductId`.
- `src/modules/orders/order.service.ts:1338` — legacy direct `upgradeOrderPackageItem` behavior; source for current-item validation, replacement-product validation, category matching, and delta pricing.
- `src/modules/order-commits/order-commit-draft.schema.ts:88` — current `PACKAGE_ITEM_UPGRADE` staging schema to amend.
- `src/modules/order-commits/order-commit.service.ts:1250` and `:1421` — staging-service dispatch and `resolveStagedPackageItemUpgrade`.
- `src/modules/order-commits/order-commit-package-item-upgrade-reducer.ts` — pure reducer; ADD already merges by parent package plus package item.
- `tests/order-commits/order-commit-package-item-upgrade-reducer.test.ts` and `tests/order-commits/order-commit-staging-regression.test.ts` — existing reducer/upsert coverage to preserve.

## Rules

- Implement only the `PACKAGE_ITEM_UPGRADE` staging-contract correction and focused tests.
- Do not wire the Sales handler adapter in this spec; adapter wiring is the follow-up once the contract is corrected.
- Do not change the UI component contract. The existing UI input shape is the source this spec must support.
- Do not modify Prisma schema, materialization, commit execution, financial emission, preview classification, add-on staging, session-configuration staging, or Adjustment Workspace.
- Keep the adapter, pages, and components free of pricing math and database access.
- Keep pricing/catalog resolution in the staging service. The pure reducer still receives fully resolved package-item-upgrade data.
- Preserve existing reducer behavior: ADD is the stateless upsert action, repeated ADD for the same parent package plus current package item updates the existing staged line instead of duplicating it.
- No `@/lib/db` imports in app or component files. No public Adjustment Workspace naming.

## Scope

### In Scope

- Amend the `PACKAGE_ITEM_UPGRADE` staging change schema/type so ADD accepts the replacement product id from the UI event, using a field named `toProductId`.
- Keep `packageItemId` as the identity of the current included package item being replaced.
- Update `resolveStagedPackageItemUpgrade` so ADD loads:
  - the current `PackageItem` by `packageItemId`;
  - the replacement `Product` by `toProductId`.
- Validate the same business rules as the legacy direct POS mutator:
  - current package item exists and belongs to the targeted parent package's current package catalog;
  - replacement product exists, is active, and is a package deliverable;
  - replacement product category matches the current item category;
  - replacement product differs from the current item product.
- Resolve the staged line using the current item identity and the replacement-product delta:
  - reducer `packageItemId` / snapshot `catalogEntityId` remains the current included `PackageItem.id`;
  - label should describe the replacement, e.g. current product to replacement product;
  - unit price is `replacementProduct.canonicalPrice - currentPackageItem.priceSnapshot`;
  - quantity comes from the staging change.
- Preserve service-provided `draftPackageItemUpgradeId` generation for ADD.
- Add schema/service tests proving:
  - ADD with `toProductId` validates;
  - ADD without `toProductId` fails validation;
  - resolver locks the correct replacement delta and label into the pending snapshot;
  - invalid replacement category/product/current item cases fail before snapshot replacement;
  - repeated ADD for the same `packageItemId` still updates one staged line rather than creating duplicates.
- Keep or extend reducer boundary tests only as needed to prove existing upsert behavior remains unchanged.
- Wire new tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md` after implementation.

### Out of Scope

- No Sales adapter implementation in `sales-staging-handler-adapter.ts`.
- No change to `ItemUpgradeDialog`, `POSCompositionHandlers`, or any component.
- No change to the `PACKAGE_ITEM_UPGRADE` materializer. It already writes `OrderPackageItemUpgrade` rows keyed by `packageItemId`; this spec only ensures staged rows carry the correct replacement delta.
- No new remove/revert UI affordance.
- No new database table, column, index, or migration.
- No add-on, session-configuration, package-tier, photo, preview, commit, payment, invoice, refund, or financial-read-layer behavior change.

## Implementation Direction

### Task 1 — Correct the staging schema

Extend the `PACKAGE_ITEM_UPGRADE` ADD branch of `orderCommitDraftStagingChangeSchema` to require `toProductId` while preserving existing ADD requirements for `packageItemId` and `quantity`. `UPDATE_QUANTITY` and `REMOVE` continue to use `target` and do not require `toProductId`.

Do not rename `packageItemId`; in the corrected contract it means "the current included package item being upgraded/replaced."

### Task 2 — Resolve replacement-product pricing in the staging service

Update `resolveStagedPackageItemUpgrade` to resolve the parent package line first, then validate the requested current package item against that package line's `catalogEntityId`. Load the replacement product by `toProductId` and apply the same availability/category/same-product guards used by the legacy direct POS mutator.

Return `ResolvedOrderCommitDraftPackageItemUpgrade` using:

- `packageItemId`: current package item id.
- `packageId`: current package item package id.
- `label`: current product name to replacement product name.
- `unitPrice`: replacement canonical price minus current package item price snapshot.

Keep all math in the service resolver, not in the adapter or UI.

### Task 3 — Preserve reducer/upsert behavior

Do not change the reducer unless a type adjustment is required. Existing ADD behavior is the intended action mapping for the future adapter because it merges by parent package plus `packageItemId`. Re-applying the same UI intent should update the single staged line's quantity using the stored staged unit price instead of duplicating it.

### Task 4 — Tests and tracker

Add focused schema/service coverage for the corrected ADD payload and invalid replacement cases. Keep reducer/upsert regression coverage intact. Wire the new tests into `scripts/run-centralization-tests.ts`, run the required validation commands, and update `context/progress-tracker.md` to say Spec 136 corrected the package-item upgrade staging contract while Sales adapter wiring remains the next step.

## Observability Checklist

### Dashboards / Metrics

- None added. This is a contract and staging-service correction only.

### Rollback Plan

- No schema migration. Rollback is reverting the schema/type/service/test changes from this spec.

### Customer-Visible Surface

- No direct customer-visible or staff-visible change in this spec. The "Upgrade" / "Replace" controls remain blocked on the Sales OrderCommit adapter until the follow-up wiring spec lands.

## Post-Implementation

- `context/progress-tracker.md` — add a "Now" line that Spec 136 corrected the package-item upgrade staging contract for replacement-product resolution; adapter wiring remains the next package-item upgrade step.
- Do not mark `PACKAGE_ITEM_UPGRADE` as wired end-to-end in the roadmap until the follow-up adapter wiring has landed.

## Acceptance Criteria

- `PACKAGE_ITEM_UPGRADE` ADD staging payloads validate with `packageItemId`, `toProductId`, and `quantity`.
- `PACKAGE_ITEM_UPGRADE` ADD staging payloads fail validation without `toProductId`.
- The staging service resolves the current package item plus replacement product and locks the replacement delta into the pending snapshot.
- The resolver rejects unavailable replacement products, non-deliverable replacement products, category mismatches, same-product replacements, missing current package items, and current package items outside the targeted package.
- Re-applying the same `packageItemId` still updates one staged upgrade line rather than duplicating it.
- No Sales adapter, UI component, Prisma schema, materializer, preview, commit, financial emission, add-on, or session-configuration behavior changed.
- New tests are wired into `test:centralization`.
- `npm run test:centralization` passes.
- `npm run build` passes.
- `npm run lint` passes.

## Open Questions

None. The repo investigation resolved the prior ADD-vs-UPDATE question: ADD is the correct future adapter action because the reducer already upserts by parent package plus current package item. The blocker was the missing replacement-product field and resolver behavior, not action selection.
