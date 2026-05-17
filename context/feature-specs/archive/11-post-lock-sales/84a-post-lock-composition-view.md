# 84a — Shared Post-Lock Composition View

## Goal

Introduce a single normalized composition view — model + presentational card — used by the locked sales page (84b) and the adjustment workspace (84c). The card hides raw accounting mechanics (zero-delta self-swap rows, "Album 30×30 to Album 30×30" no-ops) and renders obvious swaps as human-readable business events ("Album Change: 30×30 → 20×20 (-40 KD)"). This phase ships **only** the view-model normalization layer and the card component in two modes — `locked` and `adjustment`. The pre-lock POS keeps its current composition UI unchanged; a `draft` mode is reserved for a future migration.

**PR ordering — read before implementing.** 84a, 84b, and 84c are intended to land as three sequential PRs in that order. **This phase (84a) is a standalone PR that only creates the model and the card.** It does not modify the locked sales page or the adjustment workspace. 84b and 84c are the consumer wiring phases and will be opened as separate PRs after 84a merges. Do not bundle.

**Financial-trust invariant — display-only normalization.** The view model is presentational. It must never feed financial calculations. Totals, paid amounts, balances, ADJ emission, and settlement math are owned by existing service modules and must continue to derive from raw composition lines / invoice rows — never from `CompositionView` rows. 84b and 84c will reinforce this; 84a must not give consumers any reason to break it.

## Read First

- `context/reviews/ui-ux-cleanup-post-financialhardening/Layout-redesign.md` — design intent.
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts:265-313` — `getEffectiveCompositionForInvoice`, source for `AdjustmentBaseSnapshot.lines`.
- `app/orders/[orderId]/sales/page.tsx:242-333` — current `LockedInvoiceAdjustmentGate`, the consumer to be rewired in 84b.
- `app/orders/[orderId]/adjustment-workspace/page.tsx:120-137` — current `CompositionPanel` + POS modules, the consumers to be rewired in 84c.

## Rules

- The view model is **read-only and deterministic**. Same input → same output. No I/O, no side effects.
- Normalization happens in a single pure module. Components do not branch on raw shapes.
- The card never mutates composition; mutation flows through existing POS handlers (84c wires those in adjustment mode).
- Pre-lock POS is **not migrated** in this phase. Do not import the new card from the unlocked sales page.
- Raw `AdjustmentCompositionLine` shape from `adjustment-workspace.service` is the upstream input. Do not change that shape here.
- **Never drop a non-zero row.** Only zero-value self-swap no-ops (line total === 0 AND label encodes "X to X") may be dropped. Every non-zero amount must remain visible, even if relabeled or grouped. Financial trust depends on this — a row representing money must always appear on screen somewhere.
- Normalization is **display-only**. The view model must not be passed to any totals/paid/balance/ADJ-emission code path. Totals shown on the card come from `totals.netPayable` (computed upstream), never from summing emitted rows when that would diverge from the upstream total.

## Scope

### In Scope

- New module `src/modules/composition-view/composition-view.model.ts` exporting:
  - `type CompositionViewMode = "locked" | "adjustment"` (with `"draft"` reserved as a `// future` union arm, unused).
  - `type CompositionViewRow` — normalized row: `{ id, kind: "package" | "addOn" | "extraPhotos" | "swap" | "upgrade" | "line"; label; sublabel?; quantity?; unitPrice?; lineTotal; delta?: { from: string; to: string; amount: number } }`.
  - `type CompositionView` — `{ mode, rows: CompositionViewRow[], total: number }`.
  - `buildCompositionView(input: { lines: AdjustmentCompositionLine[]; totals: AdjustmentCompositionTotals; mode: CompositionViewMode }): CompositionView`.
- Normalization rules in `buildCompositionView` — applied in order, with the invariant that **no non-zero amount may disappear**:
  1. **Drop zero-delta self-swap no-ops only** — drop a line **only if** `lineTotalNet === 0` AND the label encodes a same-from-to swap (regex/heuristic: `/^(.+?)\s+to\s+\1\b/i`). Any other zero-valued row is passed through.
  2. **Group same-category swap pairs** — when two lines (adjacent, or paired via shared `refId` / matching category) describe a removal of category X and an addition of category X, emit one `swap` row with `delta = { from, to, amount: removal + addition }`. The grouped row's `lineTotal` equals the sum of the two source line totals; no money is lost.
  3. **Relabel — never hide — non-zero "X to Y" rows that cannot be grouped** — a row with non-zero `lineTotalNet` whose label encodes "X to Y" must be emitted as an `upgrade` row with `delta = { from, to, amount: lineTotalNet }` so the operator sees a clean human-readable representation. **Do not drop it.**
  4. **Pass-through** for plain rows (package, extra photos, add-ons) — keep label, quantity, unit price, line total.
  5. **Total** — always use `totals.netPayable` from upstream. Do not recompute from emitted rows. The card's displayed total must equal the upstream total exactly; if it doesn't, that's a bug in normalization (grouping lost money), not a reason to "correct" the total.
- New presentational component `src/components/orders/current-composition-card.tsx` exporting `<CurrentCompositionCard view={CompositionView} className?: string>`:
  - Renders rows uniformly. Swap/upgrade rows render as "Album Change: 30×30 → 20×20 (-40 KD)" — single line, no inner two-row breakdown.
  - Renders the composition total at the bottom.
  - Mode affects header copy only: `locked` → "Current Composition" with a small `Read only` badge; `adjustment` → "Preview Composition" with a small `Preview` badge. No other behavioral fork.
- Unit tests for `buildCompositionView` covering each normalization rule, plus a regression case using the exact data shape seen in the screenshot (`Album 30×30 to Album 20×20 — 2 × -20.000 KD` paired with the addition; standalone `Album 30×30 to Album 30×30 — 0.000 KD`).
- Component snapshot/DOM test for `<CurrentCompositionCard>` in both modes.

### Out of Scope

- Pre-lock POS migration to the new card. Pre-lock composition UI is untouched. (Future: `draft` mode flesh-out is a follow-up spec.)
- Deliverables section (own follow-up spec).
- Any change to `AdjustmentCompositionLine` / `AdjustmentBaseSnapshot` shape or to `getEffectiveCompositionForInvoice`.
- Mutation handlers, payment posting, finalize/cancel actions — those are 84b/84c concerns.
- Refund/credit-specific row rendering — handled when those documents become operational.

## Implementation Direction

### 1. The normalization module

`src/modules/composition-view/composition-view.model.ts` is a pure TS module. It owns the rules; consumers pass raw lines and get back rows ready to render. Keep the swap-grouping heuristic conservative — if grouping is ambiguous, fall back to a single relabeled `upgrade` row rather than silently dropping data. When in doubt, **emit a clean line; never emit a raw "-20.000 KD" row standalone**.

Pseudocode shape:

```ts
export function buildCompositionView(input): CompositionView {
  const rows: CompositionViewRow[] = [];
  const lines = [...input.lines];
  // Pass 1: drop zero-delta self-swaps.
  // Pass 2: pair adjacent same-category swap lines → swap row.
  // Pass 3: collapse remaining "X to Y" labeled lines (with non-zero delta) → upgrade row.
  // Pass 4: emit remaining as plain rows.
  return { mode: input.mode, rows, total: input.totals.netPayable };
}
```

### 2. The card component

`src/components/orders/current-composition-card.tsx` is a presentational `Card`/`CardHeader`/`CardContent` block matching the existing visual language in `app/orders/[orderId]/sales/page.tsx`. It accepts a built `CompositionView` — it does **not** call `buildCompositionView` itself. Consumers (84b, 84c) build the view server-side and pass it in.

### 3. Consumers (preview only — actual wiring lands in 84b/84c)

- 84b will call `buildCompositionView({ lines: effectiveComposition.lines, totals: effectiveComposition.totals, mode: "locked" })` and render `<CurrentCompositionCard />` in place of the inline rows currently in `LockedInvoiceAdjustmentGate`.
- 84c will call `buildCompositionView({ lines: proposed.lines, totals: proposed.totals, mode: "adjustment" })` for the Preview Composition panel.

### 4. Implementation order

1. Define types and `buildCompositionView` with unit tests for each rule (TDD-friendly).
2. Build `<CurrentCompositionCard>` against the model with a small Storybook-style page or test harness if needed.
3. Add the regression fixture from the screenshot data.
4. Land. Do **not** wire consumers in this phase — that's 84b/84c.

## Observability Checklist

### Dashboards / Metrics

- Counter: `composition_view.rule.<rule_name>.applied` — increment when a normalization rule fires (zero-delta drop, swap group, upgrade fallback). Helps confirm in production that the heuristics match real data.
- Counter: `composition_view.fallback.unrecognized` — increment when a line cannot be classified and is emitted as a plain `line` despite a negative or zero amount. Investigate spikes.

### Rollback Plan

- Pure code module + new component, no schema change. Revert this phase's commits.
- 84b / 84c will not have shipped yet — no consumer rollback needed.

### Customer-Visible Surface

- Staff: nothing yet. Surface ships when 84b/84c consume the card.
- Customers: no change.

## Post-Implementation

- Update `context/ui-context-summary.md` with a short note that post-lock composition is rendered via a shared normalized view.
- Update `context/progress-tracker.md`.

## Acceptance Criteria

- `buildCompositionView` exists, is pure, and is unit-tested for: zero-delta self-swap drop, swap grouping (money preserved), upgrade relabel fallback (non-zero rows never dropped), plain pass-through, and upstream-total preservation.
- The screenshot regression fixture (`Album 30×30 to Album 20×20 — 2 × -20.000 KD` + paired addition; standalone `Album 30×30 to Album 30×30 — 0.000 KD`) reduces to a single human-readable swap row plus the non-swap lines — no zero-delta self-swap row, no raw negative row, **and the sum of emitted row totals equals the upstream `totals.netPayable`**.
- Invariant test: for every fixture, `Σ(emittedRow.lineTotal) === upstream.totals.netPayable`. Any divergence is a test failure.
- `<CurrentCompositionCard>` renders both modes with the documented header copy and uniform row layout.
- No consumer migration in this phase; pre-lock sales page diff is zero.
- `npm run build` passes.
- `npm run lint` passes.
