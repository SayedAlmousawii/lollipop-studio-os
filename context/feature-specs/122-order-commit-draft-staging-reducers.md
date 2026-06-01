## Goal

Add the `OrderCommitDraft` staging reducer layer for Unified Order Commit without changing POS routing, UI behavior, operational rows, or financial documents. This spec makes `pendingSnapshotJson` the durable draft truth, keeps `pendingOpsJson` audit/history/UX-only, and introduces small pure domain reducers that produce a new validated `OrderCommitSnapshotV1` from the current pending snapshot before persisting through `replaceOrderCommitDraftSnapshot(...)`.

## Read First

- `context/reviews/unified-order-commit-live-pos-roadmap.md` - cross-phase rules and the deferred Spec 122 reducer scope.
- `context/reviews/unified-order-commit-architecture-plan.md` - Unified Order Commit naming, POS-only target workflow, and snapshot boundary semantics.
- `context/feature-specs/120-order-commit-snapshot-foundation.md` - committed snapshot shape, ownership source rules, and invoice-line independence.
- `context/feature-specs/121-order-commit-draft-foundation.md` - current `OrderCommitDraft` lifecycle, pending snapshot replacement, and generic pending operation history.
- `context/target-data-model.md` - current `OrderCommit`, `OrderCommitDraft`, materialized `Order*`, and invoice-line ownership contracts.
- `src/modules/order-commits/` - current snapshot constants, V1 schemas/types, draft helpers, and `replaceOrderCommitDraftSnapshot(...)`.
- `src/modules/session-configurations/session-configuration-pricing.ts` and `src/modules/session-configurations/session-configuration-selection.service.ts` - existing selection pricing and linked-product ownership rules.
- `tests/order-commits/` - current order-commit contract, service, snapshot capture, and source-guard test patterns.
- `scripts/run-centralization-tests.ts` - current centralization test wiring.

## Rules

- This spec is docs-only until implementation is explicitly requested.
- `pendingSnapshotJson` remains the draft truth.
- `pendingOpsJson` remains audit/history/UX metadata only. Do not replay it as the business source, commit baseline, or diff source.
- Staging reducers consume the current parsed pending snapshot and return a new `OrderCommitSnapshotV1`. They do not mutate the input snapshot in place.
- Persist staged domain changes through `replaceOrderCommitDraftSnapshot(...)` with `expectedVersion`. Do not introduce a second write path for changing `pendingSnapshotJson`.
- Domain staging may store typed history in `pendingOpsJson`, but the typed history must describe the already-produced snapshot replacement. It must not be required to reconstruct the pending snapshot.
- Do not use `appendOrderCommitDraftOperation(...)` as the business staging path. It may remain for notes/history-only operations that intentionally leave `pendingSnapshotJson` unchanged.
- Draft staging must not read or reconstruct ownership from `InvoiceLineItem`.
- Draft staging must not mutate `Order`, `OrderPackage`, `OrderAddOn`, `OrderPackageItemUpgrade`, `OrderPackageSessionConfigurationSelection`, invoices, payments, payment allocations, document applications, credit notes, refunds, or Adjustment Workspace rows.
- Do not change `/orders/[orderId]/sales`, POS server actions, visible UI copy, employee-facing routes, or Adjustment Workspace finalization.
- Do not add commit preview, snapshot diff, financial document planning, commit execution, `OrderCommitDocument`, payment behavior, credit-note behavior, or refund behavior.
- Public names must use `OrderCommit` / `OrderCommitDraft`. Do not expose new public Adjustment Workspace terminology.
- Newly staged catalog lines lock current catalog/pricing values into the pending snapshot at staging time. Existing committed or already-staged lines keep their snapshot unit prices unless the reducer explicitly replaces that line.
- Keep reducers small and domain-focused: package, add-on, package item upgrade, selected/extra photos, and session configuration.
- If a reducer needs catalog data, the service layer resolves that data before calling the pure reducer. Reducers must not import Prisma or load database rows.

## Scope

### In Scope

- Add a service entry point such as `stageOrderCommitDraftChange({ orderId, change, expectedVersion, actorContext })` under `src/modules/order-commits/`.
- Add typed staging input contracts for domain changes. These contracts are service inputs, not the authoritative persisted business source.
- Add typed audit/history payloads for `pendingOpsJson`, stored as part of snapshot replacement, while preserving `pendingOpsJson` as audit/history/UX-only.
- Add pure reducer helpers for:
  - package changes.
  - add-on add/remove/quantity changes.
  - package item upgrade add/remove/quantity changes.
  - selected-photo and extra digital/print count changes.
  - session-configuration selection add/update/remove changes.
- Add shared snapshot normalization for reducer output:
  - deterministic line sorting.
  - metadata normalization.
  - totals recalculation.
  - identity validation for `orderId`, `financialCaseId`, schema version, and currency.
  - duplicate line/stable-key guards.
- Add staged-line identity conventions for lines that do not yet have materialized `Order*` row ids.
- Add catalog-price resolution and locking only for newly staged catalog-backed lines.
- Add tests for each reducer and for the staging service orchestration.
- Add static/source guards proving reducers and staging helpers do not read `InvoiceLineItem`, do not mutate operational/financial rows, and do not expose Adjustment Workspace naming.
- Wire new order-commit staging reducer tests into `test:centralization`.

### Out of Scope

- No Prisma schema changes. If implementation discovers a required schema change, stop and report it as follow-up architecture work.
- No `Order*` writes and no materialization of pending state.
- No invoice, payment, payment allocation, document application, credit-note, refund, or `OrderCommitDocument` writes.
- No commit preview, snapshot-to-snapshot diff engine, approval classification, document plan, payment impact, or refund impact.
- No POS routing/server-action rewiring and no UI changes.
- No direct component/page consumption of reducer output.
- No Adjustment Workspace row mutation, migration, finalization change, or forced conversion of open workspaces.
- No broad refactor of existing composition, invoice, payment, refund, or Adjustment Workspace services.
- No progress-tracker update during this docs-only spec-writing task; implementation should update it after code lands.

## Implementation Direction

Implement Spec 122 as small tasks. Each task should be independently reviewable and should stop after its acceptance checks pass.

### Task 1 - Staging Contracts And History Semantics

Define a typed `OrderCommitDraft` staging-change contract as the public service input for domain staging. This contract should be a discriminated union that covers the five reducer domains in this spec.

The staging-change contract is the command for a single stage request. It is not the persisted source of business truth after the request succeeds. The persisted source remains the replacement `pendingSnapshotJson`.

Represent pending operation history as a description of the snapshot replacement. The safest shape is to keep using a snapshot-replacement operation and store the typed staging-change summary in its payload. If implementation adds domain-specific pending operation types, tests must prove those operations are still audit/history-only and are never replayed to reconstruct `pendingSnapshotJson`.

History payloads should include enough information for staff-facing history and debugging, such as domain, target stable key or draft line id, catalog ids where applicable, quantity/count before and after, and actor/timestamp. They must not be used by commit preview or future commit execution as the authoritative composition source.

### Task 2 - Staging Service And Reducer Pipeline

Add one service-layer staging entry point that:

- validates actor context using the existing OrderCommitDraft owner/manager mutation rules.
- loads the existing draft by `orderId`.
- validates `expectedVersion`.
- parses the current `pendingSnapshotJson`.
- resolves only the catalog/pricing rows needed for the requested change.
- calls the relevant pure reducer or a deterministic reducer sequence for composite changes.
- normalizes and validates the returned `OrderCommitSnapshotV1`.
- persists the replacement through `replaceOrderCommitDraftSnapshot(...)`.
- writes one audit/history operation describing the staged change.

The service should not call `appendOrderCommitDraftOperation(...)` for domain staging because that helper intentionally leaves `pendingSnapshotJson` unchanged.

Composite staging requests must run reducers in this canonical order:

1. package
2. session configuration
3. package item upgrade
4. true add-on
5. photo

This order is part of the Spec 122 contract. Package changes run first because they can change package identity and included-photo context. Session-configuration changes run before true add-ons so selection-owned linked products stay coupled to their selections. Photo changes run last so selected/extra counts are validated against the final package included-photo context.

For newly staged lines that do not have materialized `Order*` row ids yet, use stable draft entity ids generated by the service and passed into reducers. Keep the convention explicit, such as a `draft:`-prefixed entity id plus metadata that identifies the draft line. Reducers and tests must ensure later code cannot accidentally treat draft ids as database row ids before commit execution exists.

Draft line merge behavior must be deterministic:

- package item upgrades merge by package plus package item.
- session configurations upsert by package plus configuration.
- true add-ons merge by package scope plus product unless a future spec explicitly allows duplicate add-on lines.

The reducer pipeline should preserve `orderId`, `financialCaseId`, schema version, and currency. It may refresh `capturedAt` through a shared, injectable clock value, but no business rule should depend on `capturedAt`; `OrderCommitDraft.version` remains the concurrency boundary.

### Task 3 - Shared Snapshot Normalization

Add a shared normalizer for pending snapshot reducer output. It should use the same discipline as the committed snapshot capture path:

- final-sort lines deterministically.
- normalize metadata object key order.
- recalculate `totals.subtotal` and `totals.netTotal` from line totals.
- keep `discountTotal` at the current V1 value unless a future spec introduces discounts.
- reject duplicate `lineId` values.
- reject duplicate `stableKey` values unless the implementation has an explicit documented exception.
- reject negative quantities, non-finite money values, unsupported currencies, or unknown line kinds.
- validate the final shape with `orderCommitSnapshotV1Schema`.

This normalizer is the last step before `replaceOrderCommitDraftSnapshot(...)`.

### Task 4 - Package Reducer

Add a pure package reducer that updates an existing package line in the pending snapshot.

The package reducer should:

- target one package line by its `OrderPackage` stable key or draft line id.
- preserve immutable original package metadata.
- update current package catalog id, label, current package price, line total, and included-photo metadata from resolved package data.
- lock the staged package price into the pending snapshot at staging time.
- reject cross-session package changes unless a future audited repricing spec explicitly allows them.
- avoid silently changing selected-photo, extra digital, or extra print counts. If a package change needs photo-count consequences, the staging service must compose the package reducer with the photo reducer using an explicit intended photo outcome.
- preserve true add-on lines scoped to the package unless the change explicitly removes the package line in a future spec.
- remove package-item upgrade lines scoped to the package by default when the target package identity changes, because package item upgrades are package-catalog-specific.
- preserve session-configuration selection lines scoped to the package when the stored session type remains valid. If the package change would make scoped session selections invalid, reject the stage request or require explicit session-configuration reducer changes in the same request; do not silently drop them.

Tests must cover package changes with existing package-item upgrades, true add-ons, session-configuration selections, linked-product add-ons, and selected/extra photo lines.

### Task 5 - Add-On Reducer

Add a pure add-on reducer for true catalog add-ons represented by `ADD_ON` lines.

The add-on reducer should:

- add a new catalog add-on line using resolved product/catalog data and a service-generated draft line id.
- lock the product label, unit price, quantity, parent package scope, and line total into the pending snapshot.
- merge true add-ons by package scope plus product; do not create duplicate true add-on lines for the same scoped product unless a future spec explicitly allows duplicates.
- update quantity for an existing add-on line while preserving its stored unit price.
- remove an add-on line by stable key or draft line id.
- keep quantity as a nonnegative integer and remove the line when the intended quantity is zero.
- distinguish true add-ons from linked-product session configuration add-ons.
- refuse to remove or mutate a linked-product add-on line owned by a session-configuration selection; those changes belong to the session-configuration reducer.

Tests must prove that linked-product add-on ownership cannot be broken through the add-on reducer.

### Task 6 - Package Item Upgrade Reducer

Add a pure package item upgrade reducer for `PACKAGE_ITEM_UPGRADE` lines.

The package item upgrade reducer should:

- scope every item upgrade to exactly one package line.
- add a new upgrade line using resolved package item/catalog data and a service-generated draft line id.
- merge package item upgrades by package plus package item.
- lock the package item label and unit price into the pending snapshot at staging time.
- update quantity for an existing upgrade line while preserving its stored unit price.
- remove the line when the intended quantity is zero.
- reject upgrades whose package item does not belong to the targeted package context.
- cooperate with the package reducer by allowing package changes to remove scoped item upgrades intentionally.

Tests must cover add, update quantity, remove, package-scope mismatch rejection, and package-change cleanup behavior.

### Task 7 - Selected And Extra Photo Reducer

Add a pure photo reducer that owns selected-photo and extra digital/print counts per package line.

The photo reducer should:

- target exactly one package line.
- read and write photo counts only on the package line metadata and selected-photo extra lines in the pending snapshot.
- never use `Order.selectedPhotoCount` as a draft source. That field is a synchronized cache after materialization, not a reducer input.
- keep `selectedPhotoCount`, `extraDigitalCount`, and `extraPrintCount` nonnegative integers.
- require `selectedPhotoCount >= includedPhotoCount`.
- require `extraDigitalCount + extraPrintCount === selectedPhotoCount - includedPhotoCount`.
- maintain digital and print extra-photo lines separately.
- update existing extra-photo line quantities while preserving stored unit prices.
- resolve and lock current extra-photo pricing only when a media-specific extra-photo line is newly created.
- remove media-specific extra-photo lines when the intended extra count is zero.
- avoid hidden recalculation during package changes. If package included-photo count changes and extra counts need to change, that must be an explicit staged photo outcome.

Tests must cover per-package isolation, digital/print independence, creating a new extra-photo line with locked pricing, preserving existing extra-photo unit prices, removing extra-photo lines at zero quantity, and avoiding order-level selected-photo cache usage.

### Task 8 - Session Configuration Reducer

Add a pure session-configuration reducer for `SESSION_CONFIGURATION` lines and linked-product session configuration add-on lines.

The session-configuration reducer should:

- add or update a selection line using resolved session-configuration snapshot data.
- upsert session configurations by package plus configuration.
- preserve zero-value operational selections as explicit `SESSION_CONFIGURATION` lines with quantity `1`, unit price `0`, and line total `0`.
- use existing session-configuration pricing helpers for financial selections so pricing semantics stay centralized.
- lock snapshot labels, selected option labels, numeric/text values, price deltas, financial behavior, input type, pricing mode, linked product ids, and linked add-on references into line metadata.
- when a selection owns a linked product, maintain both the zero/financial selection line and the linked-product add-on line as a coupled pair.
- for newly staged linked products, store the draft linked-product add-on reference as `draftOrderAddOnId`.
- use `orderAddOnId` only for linked products that already point at a materialized `OrderAddOn` row.
- remove both the selection line and its linked-product add-on line when the selection is explicitly removed.
- refuse to let add-on reducers delete selection-owned linked-product add-on lines.
- preserve operational-only selections even when they do not affect money.

Tests must cover financial selections, zero-value operational selections, linked-product add-on creation/update/removal, and protection against orphaned linked-product add-on ownership.

### Task 9 - Tests And Regression Guards

Add focused reducer tests under `tests/order-commits/` and wire them into `scripts/run-centralization-tests.ts`.

Required reducer tests:

- each reducer returns a new snapshot object and does not mutate the input snapshot.
- each reducer output parses as `OrderCommitSnapshotV1`.
- composite reducer requests apply reducers in the canonical package, session-configuration, package-item-upgrade, true-add-on, photo order.
- totals are recalculated from line totals after every staged change.
- existing line prices remain unchanged when quantities/counts change.
- newly staged catalog lines lock prices from the resolved catalog/pricing input.
- package item upgrades merge by package plus package item.
- session configurations upsert by package plus configuration.
- true add-ons merge by package scope plus product.
- package changes intentionally remove scoped package item upgrades and intentionally preserve or reject scoped session configurations.
- package changes do not silently mutate selected/extra photo counts.
- add-on reducer cannot mutate linked-product session configuration add-on lines.
- photo reducer enforces selected-photo and digital/print extra-photo parity invariants.
- photo reducer is per-package and never reads order-level selected-photo cache.
- session reducer preserves zero-value operational selection lines.
- linked-product session configuration add-on ownership remains paired with its selection.
- newly staged linked products use `draftOrderAddOnId`, while `orderAddOnId` remains reserved for materialized `OrderAddOn` rows.

Required service tests:

- `stageOrderCommitDraftChange` rejects stale `expectedVersion`.
- non-owner staff cannot stage changes; manager/admin can stage changes.
- staging persists through `replaceOrderCommitDraftSnapshot(...)` and increments the draft version.
- staging writes a history operation but the resulting pending snapshot can be read without replaying that operation.
- `appendOrderCommitDraftOperation(...)` still changes only `pendingOpsJson` and is not a domain staging path.
- staged draft changes do not mutate `Order*`, invoices, payments, allocations, document applications, credit notes, refunds, or Adjustment Workspace rows.

Required static/source guards:

- no `src/modules/order-commits/**` reducer or staging helper reads from `invoiceLineItem`.
- no reducer imports `@/lib/db`.
- no app/component imports of `@/lib/db` are introduced.
- no public `src/modules/order-commits/**` export exposes new Adjustment Workspace naming.
- no draft staging helper imports invoice, payment, refund, or Adjustment Workspace mutation services.

## Observability Checklist

### Dashboards / Metrics

- No production dashboard is required.
- Optional structured logs may use only `order_commit_draft.*` names.
- Conflict and validation errors should include `orderId`, draft id when available, expected version, current version when known, and domain change type. Do not expose raw Prisma errors to users.

### Rollback Plan

- No schema rollback is expected because this spec should not change Prisma schema.
- Code rollback removes the new staging service, reducer helpers, contracts, and tests.
- Any `OrderCommitDraft` rows created during local testing can be discarded through the existing draft discard helper. No operational or financial repair should be required because reducers do not mutate operational or financial tables.

### Customer-Visible Surface

- None. Staff should see no route, copy, payment, invoice, POS control, or Adjustment Workspace behavior change after Spec 122 implementation.

## Post-Implementation

- Update `context/progress-tracker.md` Now / Key State and Feature History after code lands.
- Update `context/target-data-model.md` with the Spec 122 staging reducer contract, including `pendingSnapshotJson` as draft truth and `pendingOpsJson` as audit/history/UX-only.
- Leave `context/reviews/unified-order-commit-live-pos-roadmap.md` unchanged unless implementation discovers approved-roadmap drift.
- Do not update architecture or standards docs unless implementation uncovers a real conflict with the canonical rules.

## Acceptance Criteria

- A service-layer staging entry point exists under `src/modules/order-commits/` and stages domain changes by producing a replacement `OrderCommitSnapshotV1`.
- `pendingSnapshotJson` remains the only persisted draft business truth.
- `pendingOpsJson` remains audit/history/UX-only and is not replayed to compute the pending snapshot, commit preview, or future commit execution.
- Domain staging persists through `replaceOrderCommitDraftSnapshot(...)` with `expectedVersion`.
- Reducers are pure, small, domain-scoped, and do not mutate input snapshots.
- Reducer output is normalized, totalled, and validated as `OrderCommitSnapshotV1`.
- Package, add-on, package item upgrade, selected/extra photo, and session-configuration reducers exist and are covered by focused tests.
- Composite staging applies reducers in the canonical package, session-configuration, package-item-upgrade, true-add-on, photo order.
- Package item upgrades merge by package plus package item.
- Session configurations upsert by package plus configuration.
- True add-ons merge by package scope plus product unless a future spec explicitly allows duplicates.
- Package changes preserve/remove scoped upgrades and session configurations only through explicit, tested behavior.
- Photo reducer behavior is per-package and does not use order-level selected-photo cache as draft truth.
- Photo reducer enforces `selectedPhotoCount >= includedPhotoCount`.
- Photo reducer enforces `extraDigitalCount + extraPrintCount === selectedPhotoCount - includedPhotoCount`.
- Zero-value operational session selections remain represented in pending snapshots.
- Linked-product add-on ownership remains paired with its owning session-configuration selection.
- Newly staged linked products use `draftOrderAddOnId`, and `orderAddOnId` is used only for materialized `OrderAddOn` rows.
- Existing committed or already-staged line prices are preserved during quantity/count changes.
- Newly staged catalog-backed lines lock current resolved catalog/pricing values into the pending snapshot.
- Draft staging does not read `InvoiceLineItem` or infer ownership from invoices.
- Draft staging does not mutate `Order*`, invoices, payments, allocations, document applications, credit notes, refunds, or Adjustment Workspace rows.
- Existing POS and Adjustment Workspace behavior is unchanged.
- No commit preview/diff engine or financial document planning is introduced.
- No UI, route, copy, or POS server-action rewiring is introduced.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- New tests are wired into `test:centralization`.
- `npm run build` passes.
- `npm run lint` passes.
