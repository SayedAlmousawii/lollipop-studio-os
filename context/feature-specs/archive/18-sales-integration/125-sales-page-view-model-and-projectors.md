## Goal

Establish the canonical DTO foundation for the unified Sales page over OrderCommit. This spec adds a single composed view-model — `SalesPageView` — and three display-only projectors that map canonical sources (`Order*` composition, `OrderCommitDraft.pendingSnapshotJson`, `OrderCommitPreview`, `FinancialCaseSummary`) into shapes the existing Sales-page components can consume in later specs. No actions are rewired, no UI is changed, no domain logic is moved. The projectors exist but are unused until Specs 126–130.

Spec 125 is the foundation for Phase 5. Its job is to prove the canonical-source / projector boundary holds — so Specs 126 (staging actions + legacy direct-mutator guard), 127 (commit action + dialog), 128 (compose into the page), 129 (co-editor concurrency), and 130 (locked-invoice unification + parity) can wire onto a stable DTO without creating a new source of truth.

## Read First

- `context/reviews/unified-order-commit-live-pos-roadmap.md` — Phase 5 scope, canonical sources, projector rule.
- `context/feature-specs/120-order-commit-snapshot-foundation.md` — `OrderCommitSnapshotV1` shape.
- `context/feature-specs/121-order-commit-draft-foundation.md` — `OrderCommitDraft` shape, ownership, version semantics.
- `context/feature-specs/123-order-commit-preview-diff-engine.md` — `OrderCommitPreview` DTO (`lineDiffs`, `totals`, `requiresApproval`, `approvalReasons`, `documentPlan`).
- `context/feature-specs/124-order-commit-execution.md` — what a commit produces (links back to the preview shape).
- `src/modules/order-commits/` — existing services, snapshot types, preview types.
- `src/modules/orders/composition/order-composition.service.ts` — `getDraftOrderCompositionViewModel`, `getLockedOrderCompositionViewModel`, `buildCompositionSnapshotFromPOSWorkspace`, `DraftPOSCompositionProjection`.
- `src/modules/financial-cases/projections/` — existing projector style (`to-draft-sidebar-financial`, `to-sales-sidebar-locked`, `to-order-header-financial`) as the shape to follow.
- `app/orders/[orderId]/sales/page.tsx` and `app/orders/[orderId]/sales/actions.ts` — for reference only; not modified in this spec.

## Rules

- This spec is foundation only. It must not change page behavior, server actions, financial logic, draft creation rules, or UI.
- All four canonical sources retain their existing meaning:
  - current ownership → `Order*` composition projection
  - pending ownership → `OrderCommitDraft.pendingSnapshotJson`
  - commit consequences → `OrderCommitPreview`
  - financial state → `FinancialCaseSummary`
- Projectors are display-only. They must not:
  - recompute financial deltas, totals, or balances
  - decide approval requirement
  - decide refund-needed state
  - decide document plan or invoice / credit-note routing
  - reconstruct ownership truth
  - decide workflow state (locked vs unlocked branching belongs to the loader, not the projector)
  - call services, query the database, or read from `InvoiceLineItem`
- Projectors must be pure functions over their typed inputs. No `async`. No `prisma` import. No `fetch`.
- `SalesPageView` must not introduce new business semantics. It is a stable shape that *binds* canonical fields together for UI consumption.
- `SalesPageView` must always populate `composition` from exactly one canonical source per request: `pendingSnapshotJson` when an `OrderCommitDraft` exists, otherwise the current `Order*` composition projection.
- Loader must not create an `OrderCommitDraft`. Lazy creation belongs to staging actions in Spec 126.
- No public surface in this spec exposes Adjustment Workspace naming.
- No `@/lib/db` imports in `app/**` or `src/components/**`. Projectors live under `src/modules/order-commits/projections/`.
- Money values in projector output stay as raw projector fields. Formatting happens in components via `src/lib/formatting/money.ts` in later specs.

## Scope

### In Scope

- New types and projectors under `src/modules/order-commits/projections/`:
  - `sales-page-view.types.ts` — `SalesPageView`, `SalesPageCompositionSource`, `SalesPageDraftState`, `SalesPagePreviewState`, `SalesPageStagedChangesRow`, `SalesPageFinancialPreview`.
  - `to-sales-page-composition.ts` — `toSalesPageComposition({ draftSnapshot, currentComposition })` → composition shape compatible with existing `POSPackageComposition` / `POSAddOnMarketplace` props.
  - `to-sales-page-staged-changes.ts` — `toSalesPageStagedChanges({ preview })` → ordered labeled rows for the staged-changes panel.
  - `to-sales-page-financial-preview.ts` — `toSalesPageFinancialPreview({ preview, financialCase })` → fields for the unified financial sidebar.
  - `index.ts` — re-exports.
- New loader `getSalesPageView({ orderId, actorContext })` under `src/modules/order-commits/projections/sales-page-view.loader.ts`:
  - Reads order header.
  - Reads current composition via existing `getDraftOrderCompositionViewModel` / `getLockedOrderCompositionViewModel` (selection happens here, never in components).
  - Reads `OrderCommitDraft` via existing `getOrderCommitDraft` (does not create).
  - If draft exists, calls existing `getOrderCommitPreview({ orderId })`.
  - Reads `FinancialCaseSummary` via existing helper.
  - Reads actor permission flags via existing permission helpers.
  - Composes the `SalesPageView` and returns it.
- Tests under `tests/order-commits/sales-page-view/`:
  - Projector purity tests.
  - Loader composition tests (with and without draft).
  - Canonical-source binding tests (each field traces to exactly one canonical source).
  - Guard test: projector files do not import `prisma`, do not import services, contain no `async` exports.
- Wire new tests into `scripts/run-centralization-tests.ts`.
- Update `context/progress-tracker.md` per AGENTS.md.

### Out of Scope

- No new server actions. `stageSalesChangeAction`, `commitSalesChangesAction`, `discardSalesDraftAction` arrive in Specs 126 and 127.
- No legacy direct-mutator guard. That ships in Spec 126 as the safety rail before any UI wiring.
- No page-level rewiring. `app/orders/[orderId]/sales/page.tsx` is not modified by this spec.
- No component changes. `POSPackageComposition`, `POSAddOnMarketplace`, `FinancialSidebar*` are not modified.
- No co-editor banner. That ships in Spec 129.
- No commit-confirmation dialog. That ships in Spec 127.
- No locked-invoice branch unification. That ships in Spec 130.
- No AW changes. AW remains frozen legacy through Phase 5.
- No new business logic in `src/modules/order-commits/`. Existing services are consumed only.
- No new database tables, columns, indexes, or migrations.
- No financial logic. No approval logic. No refund logic. No document-plan logic.

## Implementation Direction

### Task 1 — `SalesPageView` type contract

Define types in `src/modules/order-commits/projections/sales-page-view.types.ts`. The shape binds canonical fields without renaming them:

- `order`: existing order header type (name, reference, session date, photographer, customer phone). Sourced from existing order header reader.
- `composition`: shape compatible with `DraftPOSCompositionProjection`. Contains a discriminator `source: "current" | "projected"` so components can render an adjustment-mode visual cue in Spec 128 without inferring state.
- `draft`: `SalesPageDraftState | null` — `{ id, version, ownerUserId, openedByUserId, lastTouchedByUserId, updatedAt, baseCommitId }`. Mirrors `OrderCommitDraft` fields exactly. No derived fields.
- `preview`: `SalesPagePreviewState | null` — passthrough of `OrderCommitPreview` (do not re-shape its internals here). Present iff `draft` is present.
- `stagedChanges`: `SalesPageStagedChangesRow[]` — output of `toSalesPageStagedChanges`. Empty array iff `preview` is null.
- `financialPreview`: `SalesPageFinancialPreview` — output of `toSalesPageFinancialPreview`. Always present (uses `FinancialCaseSummary` baseline; `preview` overlay fields are nullable when no draft).
- `financialCase`: `FinancialCaseSummary` — passthrough. Components in Spec 128 may read either this directly or via `financialPreview`.
- `permissions`: existing `ActorPermissionFlags` shape (no new flags).
- `isLocked`: `boolean` — derived from `financialCase` for guard logic only. Components must not branch on this for composition source; the loader has already chosen the source.

`SalesPageView` is a value type — no methods, no getters. Components destructure it.

### Task 2 — `toSalesPageComposition` projector

Pure function `toSalesPageComposition({ draftSnapshot, currentComposition })`:

- Inputs: `draftSnapshot: OrderCommitSnapshotV1 | null`, `currentComposition: DraftPOSCompositionProjection`.
- If `draftSnapshot` is null → return `{ ...currentComposition, source: "current" }`.
- If `draftSnapshot` is present → map `draftSnapshot.lines[]` into the `DraftPOSCompositionProjection` shape, returning `{ ..., source: "projected" }`.

Mapping rules for projected source:

- `lineKind === "package"` → package entry with `quantity`, `label`, `unitPrice`, `lineTotal` from snapshot; nested item upgrades, photo extras, and session configuration entries grouped by `parentOrderPackageId`.
- `lineKind === "add_on"` → add-on entry.
- `lineKind === "package_item_upgrade"` → nested under its parent package.
- `lineKind === "selected_photo_extra"` → nested under its parent package.
- `lineKind === "session_configuration"` and linked-product variant → nested under parent package per Spec 122 grouping rules.
- IDs prefixed `draft:` in the snapshot remain `draft:`-prefixed in the projection. Components treat them as opaque identifiers.

The projector must not compute totals. Totals come from `preview.totals` (via `toSalesPageFinancialPreview`) or `currentComposition` (existing field), never from re-summing the projected lines.

### Task 3 — `toSalesPageStagedChanges` projector

Pure function `toSalesPageStagedChanges({ preview })`:

- Input: `preview: OrderCommitPreview | null`.
- Output: `SalesPageStagedChangesRow[]`.
- If `preview` is null → return `[]`.
- Otherwise, map each entry of `preview.lineDiffs` whose `changeKind !== "unchanged"` into a row:
  - `id` — stable from the diff entry.
  - `changeKind` — passthrough from the diff.
  - `label` — human-readable label sourced from the diff entry's `label` / `previousLabel` (e.g. `"Album cover → Atelier leather"` for `metadata_changed`/`package_changed`). The projector does string composition only — no business interpretation of the change.
  - `netDelta` — passthrough from the diff entry. The projector does not compute it.
  - `parentLabel` — optional, for grouping by package in the right rail ("across 2 packages" subtitle).

Ordering: by `changeKind` category (additions → modifications → removals), then by parent label, then by stable id. Ordering is presentational only.

The projector must not compute `netDelta`, must not sum across rows, and must not decide whether a row is "significant".

### Task 4 — `toSalesPageFinancialPreview` projector

Pure function `toSalesPageFinancialPreview({ preview, financialCase })`:

- Input: `preview: OrderCommitPreview | null`, `financialCase: FinancialCaseSummary`.
- Output: `SalesPageFinancialPreview` with two halves:
  - **Baseline** — fields from `financialCase` (subtotal, package discount, loyalty credit, deposit, mid-payment, remaining, Collect-button state). Passthrough.
  - **Overlay** — `previousTotal`, `pendingDelta`, `pendingTotal`, `requiresApproval`, `approvalReasons`, `documentPlan`. Passthrough from `preview.totals` / `preview.requiresApproval` / etc. when `preview` is non-null; otherwise null.

The projector must not:

- sum line deltas to compute `pendingDelta` — it reads `preview.totals.pendingDelta`.
- decide `requiresApproval` — it reads `preview.requiresApproval`.
- decide `documentPlan` — it reads `preview.documentPlan`.
- recompute `remaining` after commit — that is a post-commit reality, not a preview.

### Task 5 — `getSalesPageView` loader

`src/modules/order-commits/projections/sales-page-view.loader.ts`:

```ts
export async function getSalesPageView({ orderId, actorContext }): Promise<SalesPageView>
```

Behavior:

1. Resolve order header + `isLocked` flag from existing readers.
2. Resolve `financialCase: FinancialCaseSummary` from existing helper.
3. Resolve `currentComposition` by calling the existing composition helper for the order's lock state (`getDraftOrderCompositionViewModel` or `getLockedOrderCompositionViewModel`). This is the only place the page chooses between current-source helpers.
4. Resolve `draft = await getOrderCommitDraft({ orderId })`. **Does not create.**
5. If `draft` is non-null → `preview = await getOrderCommitPreview({ orderId })`.
6. Compose: `composition = toSalesPageComposition({ draftSnapshot: draft?.pendingSnapshotJson ?? null, currentComposition })`.
7. Compose: `stagedChanges = toSalesPageStagedChanges({ preview })`.
8. Compose: `financialPreview = toSalesPageFinancialPreview({ preview, financialCase })`.
9. Resolve `permissions` from existing actor-permission helper.
10. Return the assembled `SalesPageView`.

The loader is an RSC-safe `async` function. It is the only `async` surface in this spec. It contains no business logic — only orchestration of canonical reads and projector calls.

### Task 6 — Tests and guards

Under `tests/order-commits/sales-page-view/`:

- **Projector purity** — each projector file imports nothing from `@/lib/db`, no services, no `async` exports. Static source guard (regex over file contents) plus AST check if available.
- **Composition source selection** — `toSalesPageComposition` returns `source: "current"` iff `draftSnapshot` is null; otherwise `source: "projected"` and the mapped lines match the snapshot lines.
- **Staged-changes mapping** — given a synthetic `OrderCommitPreview`, projector output preserves `netDelta` values exactly (no arithmetic, no rounding).
- **Financial-preview passthrough** — fields trace 1:1 to `preview.totals` and `financialCase`. Mutation of unrelated `preview` fields does not change unrelated `financialPreview` output.
- **Loader: no draft branch** — loader does not call `getOrderCommitPreview` when `draft` is null.
- **Loader: with-draft branch** — loader does call `getOrderCommitPreview` exactly once; `composition.source === "projected"`.
- **Loader: does not create a draft** — call `getSalesPageView` on an order with no draft; assert no `OrderCommitDraft` row was written.
- **Canonical-source contract** — for each `SalesPageView` field, a test asserts which canonical source it originates from. Catches future regressions where a projector quietly recomputes.
- **No AW naming** — static guard: new files contain no `AdjustmentWorkspace` identifier.
- Wire suite into `scripts/run-centralization-tests.ts`.

### Task 7 — Module exports

- Export `getSalesPageView`, `SalesPageView`, and the three projectors from `src/modules/order-commits/projections/index.ts`.
- No top-level `src/modules/order-commits/index.ts` change unless required to surface the projections namespace.
- Do not export internal projector helpers used by `toSalesPageComposition` for line grouping — keep them file-local.

## Observability Checklist

### Dashboards / Metrics

- None new. Spec 125 introduces no runtime behavior change visible to users; existing OrderCommit metrics still cover the underlying services.

### Rollback Plan

- Schema: no changes.
- Code rollback: deleting the new projector and loader files is sufficient. No call sites exist in `app/` or `src/components/` until Spec 128.
- Non-recoverable data: none.

### Customer-Visible Surface

- None. Staff and customers see no change. The Sales page continues to render via its current loaders and actions.

## Post-Implementation

- Update `context/progress-tracker.md` to mark Spec 125 complete and Phase 5 in progress.
- No changes required in `context/architecture-context.md` for this spec; canonical sources and projector rules already live in the roadmap.

## Acceptance Criteria

- `SalesPageView`, `getSalesPageView`, `toSalesPageComposition`, `toSalesPageStagedChanges`, `toSalesPageFinancialPreview` exist under `src/modules/order-commits/projections/`.
- Each projector is a pure synchronous function with no `prisma`, no service imports, and no `async` exports.
- `getSalesPageView` does not create an `OrderCommitDraft` and does not call `getOrderCommitPreview` when no draft exists.
- Every field on `SalesPageView` traces to exactly one canonical source (`Order*` composition projection, `OrderCommitDraft.pendingSnapshotJson`, `OrderCommitPreview`, or `FinancialCaseSummary`).
- No projector recomputes financial deltas, totals, approval requirement, refund-needed state, document plan, invoice routing, ownership truth, or workflow state.
- `app/orders/[orderId]/sales/page.tsx` and `app/orders/[orderId]/sales/actions.ts` are unchanged by this spec.
- No employee-facing component or page is modified.
- No `AdjustmentWorkspace` identifier appears in new files.
- This spec adds projector surfaces; they consume the canonical read model directly and do not re-derive in pages or components. Money is read from raw projector fields and formatting is deferred to components via `src/lib/formatting/money.ts` in Spec 128. No `@/lib/db` imports in `app/**` or `src/components/**`.
- New tests under `tests/order-commits/sales-page-view/` are wired into `scripts/run-centralization-tests.ts` and pass.
- `npm run test:centralization` passes.
- `npm run test:backend-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.
