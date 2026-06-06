## Goal

Amend `OrderCommitPreview` (shipped in Spec 123) to expose a canonical `totals` object — `{ baselineTotal, netDelta, pendingTotal }` — so the Sales-page financial preview can render the "Previous total / Pending delta / After commit" trio without any UI projector performing financial arithmetic. The totals are computed inside the OrderCommit preview layer where the canonical snapshots live; Sales-page projectors and components pass them through unchanged.

This spec is the prerequisite gate identified during Spec 125 review. It must land before Spec 129 (Sales-page composition surface wiring, formerly numbered 128) so that the unified financial sidebar can be wired to canonical values.

## Read First

- `context/feature-specs/120-order-commit-snapshot-foundation.md` — `OrderCommitSnapshotV1.totals.netTotal` is the source of canonical net totals.
- `context/feature-specs/123-order-commit-preview-diff-engine.md` — current `OrderCommitPreview` shape and baseline-resolution rules.
- `context/feature-specs/125-sales-page-view-model-and-projectors.md` — projector contract; documents the rule that projectors must not recompute financial deltas or totals.
- `context/reviews/unified-order-commit-live-pos-roadmap.md` — Phase 5 Design Notes, canonical-source rules.
- `src/modules/order-commits/order-commit-preview.schema.ts` — current strict schema for `orderCommitPreviewSchema`. Adding fields requires schema and inferred type updates.
- `src/modules/order-commits/order-commit-preview-baseline.service.ts` — `resolveOrderCommitPreviewBaseline` returns the resolved baseline snapshot.
- `src/modules/order-commits/order-commit-preview.service.ts` — `getOrderCommitPreview` orchestrator; the place to assemble totals.
- `src/modules/order-commits/order-commit-preview-classification.service.ts` — current `netDelta` source.
- Internal consumers of top-level `preview.netDelta` (back-compat surface): `order-commit-financial-emission.service.ts`, `order-commit-approval-document-preview.service.ts`, `order-commit-execution.service.ts`.

## Rules

- The amendment is additive. No existing field on `OrderCommitPreview` is removed or renamed by this spec.
- Top-level `OrderCommitPreview.netDelta` is **retained as a back-compat alias** equal to `totals.netDelta`. Internal callers (financial emission, classification, approval/document preview, execution) may continue to read it. Removal is out of scope.
- The new `totals` object is the **canonical source** for any UI or Sales-page projector that needs baseline / pending / delta money values. UI must read from `preview.totals`, not from `FinancialCaseSummary` or by arithmetic on `lineDiffs`.
- Totals are computed inside the OrderCommit preview/classification layer only. Sales-page projectors must pass them through unchanged.
- No UI changes, no Sales-page projector changes, no commit execution changes, no schema migration. This spec is preview-layer only.
- `totals.baselineTotal` is the net total of the resolved baseline snapshot, taken directly from `baselineSnapshot.totals.netTotal`. When baseline is `EMPTY` (first commit), `baselineTotal = 0`.
- `totals.pendingTotal` is the net total of the pending draft snapshot, taken directly from `pendingSnapshot.totals.netTotal`.
- `totals.netDelta` equals `pendingTotal − baselineTotal`. The schema must invariant-check that `totals.netDelta === totals.pendingTotal − totals.baselineTotal` and that `totals.netDelta === preview.netDelta` (back-compat alias parity).
- Currency: same `"KWD"` literal as the rest of the preview. No new currency handling.
- Money values use the same `rawMoneySchema` already in `order-commit-preview.schema.ts`. Rounding rules unchanged.
- Zero-net cases (`commitKind === AUDIT`, `netDelta === 0`) must still expose `baselineTotal` and `pendingTotal` correctly; the two are equal, `netDelta` is 0.
- No-op cases (no pending draft change, snapshots identical) follow the same rule.

## Scope

### In Scope

- Schema change in `src/modules/order-commits/order-commit-preview.schema.ts`:
  - Add `orderCommitPreviewTotalsSchema` with strict fields `{ baselineTotal: rawMoneySchema, netDelta: rawMoneySchema, pendingTotal: rawMoneySchema }`.
  - Add `totals: orderCommitPreviewTotalsSchema` to `orderCommitPreviewSchema`.
- Type export in `src/modules/order-commits/order-commit-preview.types.ts`:
  - `export type OrderCommitPreviewTotals = z.infer<typeof orderCommitPreviewTotalsSchema>`.
  - `OrderCommitPreview` (inferred) automatically gains the `totals` field.
- Preview assembly:
  - `getOrderCommitPreview` in `order-commit-preview.service.ts` resolves `baselineSnapshot` and `pendingSnapshot` (existing path) and assembles `totals` directly from `baselineSnapshot.totals.netTotal` and `pendingSnapshot.totals.netTotal`.
  - When `baselineSource === "EMPTY"`, `baselineTotal` is `0`.
  - `totals.netDelta = pendingTotal − baselineTotal`, then rounded with the same money-rounding helper used elsewhere in the preview pipeline.
  - Assert `totals.netDelta === preview.netDelta` before returning (defensive parity check; throws if violated).
- Internal consumers stay on top-level `preview.netDelta`. No required changes to:
  - `order-commit-financial-emission.service.ts`
  - `order-commit-approval-document-preview.service.ts`
  - `order-commit-execution.service.ts`
  - `order-commit-preview-classification.service.ts` (continues to produce its internal `netDelta`; the assembler reuses it for the parity check)
- Sales-page financial-preview projector update:
  - In `to-sales-page-financial-preview.ts`, set `overlay.previousTotal = preview?.totals.baselineTotal ?? null`, `overlay.pendingDelta = preview?.totals.netDelta ?? null`, `overlay.pendingTotal = preview?.totals.pendingTotal ?? null`.
  - Pass-through only. No arithmetic introduced in the projector.
- Test coverage:
  - Basic 100 → Premium 180 yields `totals: { baselineTotal: 100, netDelta: 80, pendingTotal: 180 }`.
  - First commit (`baselineSource: "EMPTY"`) yields `totals: { baselineTotal: 0, netDelta: pendingTotal, pendingTotal }`.
  - Zero-net swap yields `totals: { baselineTotal: N, netDelta: 0, pendingTotal: N }`; `commitKind` remains `AUDIT`.
  - No-op (snapshots identical, no diff lines) yields `totals` with equal baseline and pending and `netDelta: 0`.
  - Parity invariant: `preview.totals.netDelta === preview.netDelta` for every preview produced.
  - Reduction case: Premium 180 → Basic 100 yields `totals: { baselineTotal: 180, netDelta: -80, pendingTotal: 100 }`.
  - Sales projector pass-through test: given a `preview` with `totals: { baselineTotal: 100, netDelta: 80, pendingTotal: 180 }`, `toSalesPageFinancialPreview` returns `overlay.previousTotal === 100`, `overlay.pendingDelta === 80`, `overlay.pendingTotal === 180` with no rounding or arithmetic.
- Update existing preview tests that previously asserted only on top-level `netDelta` to also assert on `totals` where they validate full preview output. Do not delete top-level `netDelta` assertions.
- Wire new tests into `scripts/run-centralization-tests.ts` if a new file is added.
- Update `context/progress-tracker.md`.

### Out of Scope

- No UI component changes.
- No changes to `SalesPageView` type or loader (Spec 125). The financial-preview projector update is the only Sales-side touch; its output type already declares the fields.
- No commit execution changes.
- No financial document emission changes.
- No approval / refund / document plan logic changes.
- No removal of top-level `preview.netDelta`.
- No new schema field on `OrderCommitSnapshotV1`. `totals.netTotal` is already there.
- No new persistence. The preview is computed on demand; nothing is stored.
- No changes to internal consumers (`order-commit-financial-emission`, `order-commit-approval-document-preview`, `order-commit-execution`, classification).
- No migration. Strict-schema parsing tolerates the new field on freshly produced previews; nothing stale on disk references it.
- No locking, no concurrency change.

## Implementation Direction

### Task 1 — Schema and type

In `src/modules/order-commits/order-commit-preview.schema.ts`:

```ts
export const orderCommitPreviewTotalsSchema = z
  .object({
    baselineTotal: rawMoneySchema,
    netDelta: rawMoneySchema,
    pendingTotal: rawMoneySchema,
  })
  .strict();
```

Add `totals: orderCommitPreviewTotalsSchema` inside `orderCommitPreviewSchema` (after `netDelta`). Schema stays `.strict()`.

In `src/modules/order-commits/order-commit-preview.types.ts`, export:

```ts
export type OrderCommitPreviewTotals = z.infer<typeof orderCommitPreviewTotalsSchema>;
```

`OrderCommitPreview` inherits the new field via inference; no manual addition required.

### Task 2 — Preview assembly

In `getOrderCommitPreview` (`order-commit-preview.service.ts`):

1. After resolving `baselineSnapshot` and `pendingSnapshot` (existing logic), compute:
   - `baselineTotal = baselineSnapshot ? baselineSnapshot.totals.netTotal : 0`
   - `pendingTotal = pendingSnapshot.totals.netTotal`
   - `netDelta = roundMoney(pendingTotal - baselineTotal)` using the same `roundMoney` helper already in use for `classification.netDelta`.
2. Build `totals = { baselineTotal, netDelta, pendingTotal }`.
3. Defensive parity check: assert `totals.netDelta === classification.netDelta` (which is the value that becomes top-level `preview.netDelta`). Throw a descriptive error if they disagree — this catches future drift.
4. Return the preview with `totals` populated.

The `baselineSource === "EMPTY"` branch must produce `baselineTotal = 0` explicitly. Existing baseline resolution already returns a sentinel; reuse it without changing its shape.

### Task 3 — Sales-page financial-preview projector

In `src/modules/order-commits/projections/to-sales-page-financial-preview.ts`:

- Replace the three overlay fields:
  - `previousTotal: preview?.totals.baselineTotal ?? null`
  - `pendingDelta: preview?.totals.netDelta ?? null`
  - `pendingTotal: preview?.totals.pendingTotal ?? null`
- All other overlay fields unchanged.
- Baseline branch unchanged.
- Projector remains a pure synchronous function. No services imported. No arithmetic introduced. The `?? null` fallbacks are the only conditional logic.

### Task 4 — Tests

Add or extend tests under `tests/order-commits/order-commit-preview-totals/` (new directory) or co-locate alongside existing `tests/order-commits/order-commit-preview-classification.test.ts`:

- `preview-totals-basic-upgrade.test.ts` — Basic 100 → Premium 180: assert `totals === { baselineTotal: 100, netDelta: 80, pendingTotal: 180 }`.
- `preview-totals-first-commit.test.ts` — `baselineSource: "EMPTY"`: assert `baselineTotal === 0`, `netDelta === pendingTotal`.
- `preview-totals-zero-net-swap.test.ts` — Equal-priced swap: assert `baselineTotal === pendingTotal && netDelta === 0` and `commitKind === AUDIT`.
- `preview-totals-no-op.test.ts` — Snapshots identical: assert same shape.
- `preview-totals-reduction.test.ts` — Premium 180 → Basic 100: assert `netDelta === -80`.
- `preview-totals-parity.test.ts` — For each of the above, assert `preview.totals.netDelta === preview.netDelta`.

Extend Sales-page financial-preview projector tests in `tests/order-commits/sales-page-view/sales-page-view-projectors.test.ts`:

- Given a synthetic preview with known `totals`, assert all three overlay fields pass through unchanged.
- Confirm the projector remains pure (no new imports or arithmetic).

Wire any new test file into `scripts/run-centralization-tests.ts`.

### Task 5 — Sweep existing preview tests

Find existing tests that compare a full `OrderCommitPreview` object (e.g. snapshot tests, deep-equals). Update their expected shapes to include `totals`. Do not delete or weaken existing assertions; only add the new field. Approximate surface:

- `tests/order-commits/order-commit-preview-loader.test.ts`
- `tests/order-commits/order-commit-preview-contracts.test.ts`
- `tests/order-commits/order-commit-preview-diff.test.ts` if it asserts full preview output (verify — diff tests usually compare diff snapshots, not previews)

### Task 6 — Documentation

- Update `context/progress-tracker.md` to mark Spec 127 complete.
- No roadmap edit required. The Phase 5 Design Notes already enforce the canonical-source / projector rule; this spec is the operational fix for the gap.

## Observability Checklist

### Dashboards / Metrics

- None new. The amendment adds derived fields; no new error class or counter.
- The defensive parity assertion (`totals.netDelta === classification.netDelta`) is a developer guard, not a production metric. If it ever throws, it indicates a bug to investigate — not a recurring runtime condition.

### Rollback Plan

- Schema: no DB change. The `OrderCommitPreview` schema is in-memory only.
- Code rollback: reverting this spec removes the `totals` field. No persisted data references it. Sales-page projector reverts to its prior null-overlay state. UI (not yet wired in Spec 129) is unaffected.
- Non-recoverable data: none.

### Customer-Visible Surface

- None. Spec 127 lands before any UI consumes `preview.totals`. The amendment exists so Spec 129 (Sales-page composition wiring) can render the trio when it ships.

## Post-Implementation

- `context/progress-tracker.md` updated.
- Spec 129 (Sales-page composition wiring, formerly 128 in the original breakdown) can be drafted/implemented against the new `preview.totals` contract.

## Acceptance Criteria

- `OrderCommitPreview` exposes a `totals: { baselineTotal, netDelta, pendingTotal }` object computed in the OrderCommit preview layer.
- `totals.baselineTotal` equals `baselineSnapshot.totals.netTotal`, or `0` when `baselineSource === "EMPTY"`.
- `totals.pendingTotal` equals `pendingSnapshot.totals.netTotal`.
- `totals.netDelta` equals `pendingTotal − baselineTotal`, rounded with the existing money helper.
- `preview.totals.netDelta === preview.netDelta` for every preview produced (parity invariant enforced at assembly time).
- Top-level `preview.netDelta` is unchanged and continues to back-compat all existing internal consumers (financial emission, classification, approval/document preview, execution).
- Sales-page financial-preview projector reads `preview.totals.{baselineTotal, netDelta, pendingTotal}` and passes them through to `overlay.{previousTotal, pendingDelta, pendingTotal}` as null-coalesced values. The projector contains no arithmetic and imports no services.
- For a Basic-100 → Premium-180 staging case, the preview emits `totals: { baselineTotal: 100, netDelta: 80, pendingTotal: 180 }` and the Sales-page financial-preview projector emits `overlay.{previousTotal: 100, pendingDelta: 80, pendingTotal: 180}`.
- Zero-net swap emits `baselineTotal === pendingTotal && netDelta === 0`; `commitKind === AUDIT` is unchanged.
- No-op preview emits the same shape; no exception.
- Reduction case (Premium-180 → Basic-100) emits `netDelta === -80`.
- No UI component, page, or commit-execution path is modified.
- No new schema migration is introduced.
- This spec extends a canonical read model; Sales-page projectors and any UI must consume the new `preview.totals` fields directly. No projector or component is permitted to recompute the trio.
- New and updated tests pass via `npm run test:centralization` and existing preview tests pass via `npm run test:backend-invariants` and `npm run test:financial-invariants`.
- `npm run build` passes.
- `npm run lint` passes.
