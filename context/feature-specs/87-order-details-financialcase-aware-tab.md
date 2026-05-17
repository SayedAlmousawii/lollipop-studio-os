# 87 — Order Details Financials Tab: FinancialCase-Aware via Shared Read-Only Components

## Goal

Make the Order Details page's **Financials tab** read from the same canonical FinancialCase data the locked POS sidebar uses, so it shows the full ledger (final invoice + all adjustments + deposits + refunds + credit notes) with correct customer-total / paid / remaining math — not just the final-invoice slice it shows today.

Achieve this without duplicating or re-deriving financial math by **extracting shared read-only financial components** from `FinancialSidebarLocked` into a new `src/components/financial/` folder. Locked POS becomes a thin wrapper that composes the same shared parts plus its POS-only action affordances; the Order Details Financials tab composes the same shared parts plus a per-line-item Price Breakdown card.

POS (draft + locked) must be visually and behaviorally unchanged.

## Read First

- [src/components/orders/financial-sidebar-locked.tsx](src/components/orders/financial-sidebar-locked.tsx) — current locked POS sidebar; source of the sections being extracted.
- [src/components/orders/financial-sidebar-primitives.tsx](src/components/orders/financial-sidebar-primitives.tsx) — existing shared primitives (`MoneyRow`, `formatKD`).
- [src/modules/orders/order-settlement.ts#L98-L137](src/modules/orders/order-settlement.ts#L98-L137) — `deriveLockedFinancialSidebarSummary`; canonical settlement math, reused as-is.
- [src/modules/orders/order.service.ts#L310-L560](src/modules/orders/order.service.ts#L310-L560) — `getPOSWorkspace`.
- [src/modules/orders/order.service.ts#L562-L619](src/modules/orders/order.service.ts#L562-L619) — `getLinkedFinancialDocumentsForOrder`.
- [src/modules/orders/order.service.ts#L5013-L5152](src/modules/orders/order.service.ts#L5013-L5152) — `getOrderFinancialSummary` (the stale loader being retired from the Financials tab).
- [app/orders/[orderId]/page.tsx#L62-L80](app/orders/[orderId]/page.tsx#L62-L80) — order detail page loader wiring.
- [app/orders/[orderId]/page.tsx#L472-L605](app/orders/[orderId]/page.tsx#L472-L605) — current Financials tab JSX being replaced.
- [src/components/orders/order-settlement-summary.tsx](src/components/orders/order-settlement-summary.tsx) — the top header card; audit-only per scope.
- `context/feature-specs/84b-locked-sales-financial-sidebar.md` — prior phase that built the locked sidebar architecture this spec extends.

## Rules

- **Do not re-derive financial math.** Reuse `deriveLockedFinancialSidebarSummary` and `getLinkedFinancialDocumentsForOrder` as-is. Adding a second arithmetic path anywhere (component, page, helper) is a review-blocker.
- **POS is out of scope and must not regress.** Both `FinancialSidebarDraft` and `FinancialSidebarLocked` must render visually and behaviorally identically before vs. after this phase. Diff the POS sales page (pre-lock and post-lock) to zero.
- **Order Details Financials tab is strictly read-only.** No `Record Payment` button, no `Open Adjustment Workspace` action, no take-over. Linked-doc rows link to the invoice detail page; that's it.
- Shared components live in `src/components/financial/`. They render only — they accept already-derived data props, never load it themselves, never know which page is mounting them.
- The new tab must use the same `LinkedFinancialDocument` list and the same `LockedFinancialSidebarSummary` shape the locked POS sidebar consumes. Loader inputs are the same — only the surrounding chrome differs.
- The retired `getOrderFinancialSummary` loader: if no other caller remains after this phase, delete it. If callers remain, leave it but stop calling it from `app/orders/[orderId]/page.tsx`.
- The Price Breakdown card on the Financials tab continues to render line items from the **final invoice's locked snapshot** (same data source it uses today). It does not attempt to merge adjustment lines.

## Scope

### In Scope

- **Extract shared read-only components** to `src/components/financial/`:
  - `financial-payment-summary.tsx` → `<FinancialPaymentSummary summary={LockedFinancialSidebarSummary} />` — renders the Payment Summary section (Customer Total / Paid So Far / Includes Deposit / Remaining + status pill). Pure presentation.
  - `financial-total-source.tsx` → `<FinancialTotalSource summary={LockedFinancialSidebarSummary} />` — renders the Total Source section (Final Invoice Total / Total Adjustments / Final Total).
  - `financial-linked-documents.tsx` → `<FinancialLinkedDocuments documents={LinkedFinancialDocument[]} renderRowExtras?={(doc) => ReactNode} />` — renders the linked-docs list, sorted as the loader returns them. The optional `renderRowExtras` slot is how POS injects its `Record Payment` button without leaking POS concerns into the shared component. Order Details passes nothing.
  - `financial-format.ts` → move `formatSignedKD`, `formatEnumLabel`, `formatSignedDocumentAmount` here (currently file-local in `financial-sidebar-locked.tsx`). `MoneyRow` and `formatKD` stay in `financial-sidebar-primitives.tsx` and are re-exported from `src/components/financial/index.ts` for convenience.
- **Refactor `FinancialSidebarLocked`** to compose the three shared sections + its existing POS-only `AdjustmentWorkspaceAction`. The `Record Payment` button on outstanding linked-doc rows is wired via the new `renderRowExtras` prop, preserving today's behavior. No visual or behavioral change to the sidebar.
- **Refactor `FinancialSidebarDraft`** only insofar as the shared `MoneyRow` / `formatKD` re-exports are reused. No structural changes. Behavior preserved.
- **Rewrite the Order Details Financials tab** in [app/orders/[orderId]/page.tsx](app/orders/[orderId]/page.tsx):
  - Drop the `getOrderFinancialSummary` call from the page-level `Promise.all`.
  - Add `getPOSWorkspace(orderId)` and `getLinkedFinancialDocumentsForOrder(orderId)` to the page load, then derive the summary via `deriveLockedFinancialSidebarSummary(workspace, linkedDocuments)` (mirroring the locked POS call site exactly).
  - Replace the existing Financials `TabsContent` body with:
    1. `<FinancialPaymentSummary summary={...} />`
    2. `<FinancialTotalSource summary={...} />`
    3. `<FinancialLinkedDocuments documents={...} />` (no `renderRowExtras`)
    4. **Price Breakdown card** — keep as today, sourced from the final invoice's locked snapshot line items (use `workspace.invoice` to find the locked-snapshot line items already available; no new loader). Card title and layout preserved.
  - Remove the "Create Invoice" button branch — by the time an order reaches a state that warrants the Financials tab, the FinancialCase / final invoice already exists. If the FinancialCase loader returns no invoice (edge case, e.g. brand-new order), render an empty state: "No financial activity yet." No invoice-creation flow lives here.
- **Header card audit only** (no behavior change unless mismatch found):
  - Verify `OrderSettlementSummary` on the top of the page (the `195.000 KD outstanding / Paid / Total / Refunded` block) reads from the same FinancialCase-derived numbers as the new Financials tab.
  - If it does, leave it untouched.
  - If it reads from a different / older source, switch it to the canonical loader so the top card and the Financials tab can never disagree. No layout changes.
- Tests:
  - Render test: the Financials tab DOM contains rows for **every** linked financial document on a fixture order with `DEPOSIT + FINAL + 1 finalized ADJUSTMENT + 1 REFUND`.
  - Numbers test: on the same fixture, `Customer Total`, `Paid So Far`, and `Remaining` in the Financials tab equal the values produced by `deriveLockedFinancialSidebarSummary` directly (assert by calling the helper in the test and comparing to rendered text).
  - Read-only test: the Financials tab DOM contains no `Record Payment` button and no `Open Adjustment Workspace` form.
  - POS regression test: the locked POS sales page DOM diff vs `main` is empty on the existing fixture suite.
  - POS regression test: the pre-lock POS sales page DOM diff vs `main` is empty.
  - Audit test (if header card was switched): the top header `outstanding` value equals `summary.remaining` from `deriveLockedFinancialSidebarSummary` on the same fixture.

### Out of Scope

- POS sales page UI changes (draft or locked). Both surfaces must diff to zero.
- Adjustment workspace page.
- Any new invoice / refund / credit-note creation flows.
- Any change to `deriveLockedFinancialSidebarSummary`, `getLinkedFinancialDocumentsForOrder`, or `getPOSWorkspace` shape or behavior.
- Changes to the order page tabs other than `Financials`.
- Activity / Selection / Editing / Production / Delivery tabs.
- Mobile / responsive redesign of the Financials tab beyond what falls out of the shared components.

## Implementation Direction

### 1. Extraction order (safety first)

1. Create `src/components/financial/` and move helpers (`formatSignedKD`, `formatEnumLabel`, `formatSignedDocumentAmount`) to `financial-format.ts`.
2. Extract `<FinancialPaymentSummary>`, `<FinancialTotalSource>`, `<FinancialLinkedDocuments>` as **pure presentational** components — copy the JSX out of `financial-sidebar-locked.tsx` verbatim, parameterize on the data props named above.
3. Rewrite `FinancialSidebarLocked` to compose the three shared components. Wire the `Record Payment` button through `renderRowExtras` on `<FinancialLinkedDocuments>`. Diff the rendered POS locked sidebar against `main` — zero diff is the gate before proceeding.
4. Only after POS parity is confirmed: wire the Order Details Financials tab.

### 2. Order Details page wiring

In `app/orders/[orderId]/page.tsx`, replace the `getOrderFinancialSummary` call in the `Promise.all` with `getPOSWorkspace(orderId)` and `getLinkedFinancialDocumentsForOrder(orderId)`. Compute `const financialSummary = deriveLockedFinancialSidebarSummary(workspace, linkedDocuments)`. Pass these to the Financials tab body. No other tab depends on these loaders, so the page load stays a single `Promise.all`.

### 3. Price Breakdown card

Keep the existing Price Breakdown card visually identical. Its data source — the final invoice's line items — is already available on `workspace.invoice` (the locked snapshot). Read line items from there instead of from `getOrderFinancialSummary`. If the current card has any UI branch driven by the old `OrderFinancialSummary` shape (e.g. legacy fields), simplify to the snapshot-only path — that's the only data source going forward.

### 4. Empty / edge state

If `workspace.invoice` is null (no final invoice exists yet for this order), render a single empty-state card on the Financials tab: "No financial activity yet." No "Create Invoice" button here — invoice creation happens through POS.

### 5. Retiring `getOrderFinancialSummary`

After the page no longer calls it, grep for other callers. If zero remain, delete the function and its type. If any remain, leave the function alone and only remove the import / call from the order detail page. Do not refactor unrelated callers in this phase.

### 6. Header-card audit

Read `OrderSettlementSummary`'s data source up the call chain from [app/orders/[orderId]/page.tsx](app/orders/[orderId]/page.tsx) → `order.settlementSummary` field on `getOrderHubById`. Confirm `settlementSummary` is derived from the same payment-allocation / DocumentApplication source `deriveLockedFinancialSidebarSummary` uses. If yes, document it in the spec acceptance and move on. If no, route it through the canonical helper. Either way, no visible change unless the numbers were wrong.

## Observability Checklist

### Dashboards / Metrics

- Counter: `order_details.financials_tab.rendered` — increments on each Financials tab render. Sanity gauge.
- Discrepancy log: if the top header `outstanding` value and the Financials tab `Remaining` value disagree for the same `orderId` in a single render, log both with `orderId`. Indicates a loader divergence that this phase was supposed to eliminate.

### Rollback Plan

- Code-only change. Revert this phase's commits to restore the old `getOrderFinancialSummary`-driven Financials tab.
- No schema changes. No flag.

### Customer-Visible Surface

- Staff (Order Details Financials tab): now shows all linked financial documents (deposit, final, adjustments, refunds, credit notes) with correct totals/paid/remaining, matching the top header card and the locked POS sidebar. The "Invoice Summary" card with stale numbers is gone.
- POS (draft and locked): no change.
- Customers: no direct change.

## Post-Implementation

- Update `context/ui-context-summary.md` to describe `src/components/financial/` as the canonical read-only financial UI surface and the Order Details Financials tab's data source.
- Update `context/progress-tracker.md`.
- If `getOrderFinancialSummary` was deleted, note its removal in the post-implementation summary so reviewers know to look elsewhere if they were used to it.

## Acceptance Criteria

- The Order Details Financials tab renders, in order: Payment Summary → Total Source → Linked Financial Documents → Price Breakdown.
- On a fixture order with deposit + final + finalized adjustment + refund, every linked document appears in the Linked Financial Documents section of the Financials tab.
- `Customer Total`, `Paid So Far`, and `Remaining` in the Financials tab match the values returned by `deriveLockedFinancialSidebarSummary` for the same order (asserted by direct comparison in a test).
- The top header card's `outstanding` value and the Financials tab `Remaining` value match for the same fixture order.
- The Financials tab DOM contains no `Record Payment` button, no `Open Adjustment Workspace` form, and no `Take Over` form.
- The pre-lock POS sales page DOM diffs to zero vs. `main` on the existing fixture suite.
- The locked POS sales page DOM diffs to zero vs. `main` on the existing fixture suite (the `Record Payment` button still appears on outstanding linked-doc rows there).
- A grep for `getOrderFinancialSummary` in `app/orders/[orderId]/page.tsx` returns zero hits.
- A grep for ad-hoc payment / total summation in `src/components/financial/` returns zero hits — these components only render props.
- `npm run build` passes.
- `npm run lint` passes.
