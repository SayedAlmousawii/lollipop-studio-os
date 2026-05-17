# 84b — Locked Sales Page Financial Sidebar Cleanup

## Goal

Replace the post-lock half of the sales page so the operator sees an effective-state operational workspace, not a raw accounting document. The left column becomes the shared `CurrentCompositionCard` from 84a (locked mode) — single source of truth for "what the customer is getting + pricing." The right column becomes a new `FinancialSidebarLocked` orchestrator with three sections: Payment Summary, Total Source breakdown, Linked Financial Documents. The "Open Adjustment Workspace" action moves to the right sidebar with helper text. The pre-lock sales page (`FinancialSidebar` draft path) is left alone — it is split off as `FinancialSidebarDraft` with no behavioral change.

## Read First

- `context/feature-specs/84a-post-lock-composition-view.md` — provides `CurrentCompositionCard` + `buildCompositionView`.
- `context/reviews/ui-ux-cleanup-post-financialhardening/Layout-redesign.md` — design intent.
- `app/orders/[orderId]/sales/page.tsx:242-333` — `LockedInvoiceAdjustmentGate`, rewired here.
- `app/orders/[orderId]/sales/page.tsx:335-532` — current `FinancialSidebar`, split here.
- `app/orders/[orderId]/sales/page.tsx:534-578` — `AdjustmentInvoiceBlock`, becomes a chip in the new linked-docs section.
- `app/orders/[orderId]/sales/page.tsx:597-638` — shared primitives (`MoneyRow`, `InvoiceLineRow`, `formatKD`), stay shared.
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts:265-313` — `getEffectiveCompositionForInvoice`, the data source for the locked composition.
- `src/components/orders/order-settlement-summary.tsx` — existing settlement primitive; reuse internals where useful.

## Rules

- Pre-lock sales page must be **visually and behaviorally identical** before/after this phase. Diff that surface to zero.
- Post-lock right column must not duplicate the merged pricing breakdown. The left column owns pricing.
- The post-lock right column must not show raw `SNAPSHOT LINE ITEMS` rows or raw negative adjustment deltas.
- `Open Adjustment Workspace` form action and its take-over/resume affordances remain functional — they only move from the composition card to the financial sidebar.
- All payment posting paths (deposit + final + ADJ payment dialogs) keep working exactly as today.
- **Payment Summary must source from the existing settlement / payment-allocation source of truth — not recomputed from display rows or from 84a's `CompositionView`.** Identify the existing canonical helper for `paidAmount` per invoice/ADJ and aggregate via that helper. Never sum payments by parsing UI strings or normalized rows. If the canonical helper does not already exist as a single function, extract one in this phase before building the UI; do not inline ad-hoc arithmetic in components.
- **84a's `CompositionView` is display-only.** It must not be passed into any totals/paid/balance derivation in this phase. Financial math derives from raw invoice/ADJ records.

## Scope

### In Scope

- **Component split** in `app/orders/[orderId]/sales/page.tsx` (or extract to `src/components/orders/`):
  - `FinancialSidebarDraft` — the pre-lock branch of today's `FinancialSidebar` (the computed-composition path). Behavior preserved.
  - `FinancialSidebarLocked` — new component for the post-lock state, structured per below.
  - The page selects between them based on `invoice?.isLocked`.
- **`LockedInvoiceAdjustmentGate` rewire** ([sales/page.tsx:242](app/orders/[orderId]/sales/page.tsx#L242)):
  - Remove the inline composition rows (`effectiveComposition.lines.map(...)`).
  - Render `<CurrentCompositionCard view={buildCompositionView({ ...effectiveComposition, mode: "locked" })} />` instead.
  - Remove the `Open Adjustment Workspace` form and the "Workspace open by …" gate from this card.
  - Rename the wrapping component to `LockedCompositionView` (it no longer "gates" the adjustment action).
- **`FinancialSidebarLocked` structure** (top to bottom):
  1. **Payment Summary** block — large, visually prominent. UI labels are intentionally customer-facing; the internal variable names are noted alongside for clarity:
     - **`Customer Total`** — UI label. Internal: `effectiveTotal = invoice.invoiceTotal + Σ(finalized ADJ net amounts)` (see Implementation Direction §3). This is what the customer owes for the whole sale after adjustments.
     - **`Paid`** — sum of payments across linked docs, sourced from the canonical settlement/payment-allocation helper (see Rules above).
     - **`Remaining`** — `Customer Total − Paid`.
     - Uses `MoneyRow`. Status pill: `Fully Paid` / `Outstanding` mirroring today's footer logic.
     - **Naming rationale:** "Effective Total" reads as an accounting term and is confusing when the final invoice already nets the deposit. "Customer Total" is the staff-facing label; "Total After Adjustments" is acceptable as an alternative if visually clearer. Pick one and stay consistent across the page. `effectiveTotal` may remain as the internal variable name.
  2. **Total Source** breakdown — compact accounting trail, secondary visual weight. Labels below are the displayed strings:
     - `Deposit Applied` (if any).
     - `Final Invoice Total`.
     - `Total Adjustments` (single signed line; if there are zero finalized ADJs, hide the row).
  3. **Linked Financial Documents** — compact chips/rows:
     - One row per document of types `DEPOSIT`, `FINAL`, `ADJUSTMENT`, `REFUND`, `CREDIT_NOTE` (per `InvoiceType` enum in `prisma/schema.prisma:92-99`).
     - Each row shows: invoice number · type badge · status badge · signed amount. Clickable → invoice detail page.
     - Sorted chronologically (`issuedAt` / `createdAt`).
     - Refund/credit rows render generically if present in data; no new flows.
  4. **Adjustment Workspace action** — bottom of the sidebar:
     - If no open workspace: `Open Adjustment Workspace` submit button + helper text "This sale is finalized. New changes will be staged as adjustments."
     - If open workspace owned by current user: `Resume Workspace` link.
     - If open workspace owned by another user and current user is manager: `Take Over` form.
     - Otherwise: read-only "Workspace open by {name} since {time}" indicator.
- Page wiring: `app/orders/[orderId]/sales/page.tsx` picks `FinancialSidebarLocked` vs `FinancialSidebarDraft` by `workspace.invoice?.isLocked`.
- Tests:
  - Render test: locked sales page no longer contains the strings "SNAPSHOT LINE ITEMS", "Album 30×30 to Album 30×30", or any standalone raw negative `KD` swap row.
  - Render test: pre-lock sales page DOM diff is empty vs. baseline.
  - Functional test: `Open Adjustment Workspace`, `Resume Workspace`, `Take Over` paths all reachable from the new sidebar location.
  - Numbers test: a fixture with deposit + final + one finalized ADJ + one paid ADJ payment produces correct `Effective Total / Paid / Remaining` and no double-counted deposit.

### Out of Scope

- Pre-lock sales page UI changes. Pre-lock POS is untouched.
- Adjustment workspace page (covered by 84c).
- Deliverables section (deferred to a follow-up spec).
- New refund/credit creation flows. Refund/credit documents are only displayed in the chips list if they already exist in data.
- Changes to payment dialogs themselves; only their entry points may move.
- Changes to invoice/ADJ data shape, server actions, or the `getEffectiveCompositionForInvoice` derivation.

## Implementation Direction

### 1. Component extraction

Extract `FinancialSidebarDraft` and `FinancialSidebarLocked` to `src/components/orders/financial-sidebar-draft.tsx` and `src/components/orders/financial-sidebar-locked.tsx`. Move shared primitives (`MoneyRow`, `InvoiceLineRow`, `formatKD`, `AdjustmentInvoiceBlock`) to `src/components/orders/financial-sidebar-primitives.tsx` so both orchestrators (and 84c's `FinancialSidebarAdjustment`) can import them. The sales page imports the right orchestrator and the primitives stay co-located.

`FinancialSidebarDraft` is **a lift-and-shift** of today's computed-composition branch — same JSX, same data inputs, same totals math. Diff it visually against `main` before merging.

### 2. `FinancialSidebarLocked` data inputs

The component needs:
- `invoice` (locked final invoice) — already on `POSWorkspace`.
- `effectiveComposition` — already passed to `LockedInvoiceAdjustmentGate`; thread it to the sidebar too, or compute totals from the same source server-side and pass `paymentSummary` as a derived prop.
- A list of all linked financial documents for the order — query for invoices where `orderId === workspace.orderId`, filter by `InvoiceType ∈ {DEPOSIT, FINAL, ADJUSTMENT, REFUND, CREDIT_NOTE}`, project to `{ id, invoiceNumber, type, status, totalAmount, paidAmount, issuedAt }`.
- An open-workspace handle (`getOpenWorkspaceForInvoice` result) for the adjustment action block.

Where the query lives: add a thin helper `getLinkedFinancialDocumentsForOrder(orderId)` near the existing order queries. Keep it server-side; the page is RSC.

### 3. Payment Summary math

Define a single helper `derivePaymentSummary(invoice, finalizedAdjustments)` returning `{ effectiveTotal, paid, remaining }`. **All inputs come from the canonical settlement source of truth — never from display rows or `CompositionView`.**

Implementation notes:

- `effectiveTotal = invoice.invoiceTotal + Σ(adj.adjustmentNetAmount)` over finalized adjustments. Use the existing ADJ net amount field on the persisted ADJ record; do not re-derive from line items, and do not re-derive from the normalized view.
- `paid` — locate the existing canonical settlement/payment-allocation helper (start from `src/components/orders/order-settlement-summary.tsx` and follow its data source upstream; also check service-layer modules used by `POSRecordPaymentDialog`). Aggregate via that helper, summing across the final invoice and each finalized ADJ. **Do not** reimplement payment summation inline; if the canonical helper isn't reusable as-is, extract it before building the UI. Deposit is **not** added as a separate payment if `invoice.invoiceTotal` already nets it out — mirror the existing model exactly; do not invent new math.
- `remaining = max(0, effectiveTotal − paid)`.

The helper is the only place this math lives. The component imports it; the page imports it for the test fixtures. Adding a second arithmetic path elsewhere is a review-blocker.

Unit-test this helper directly with at least four fixtures: (a) deposit + final only, fully paid; (b) deposit + final + finalized ADJ unpaid; (c) deposit + final + finalized ADJ fully paid; (d) deposit + final + multiple finalized ADJs, partial payments across them. Acceptance numbers go in the spec checklist below.

### 4. Linked Documents chip rendering

Reuse `AdjustmentInvoiceBlock` styling as the visual baseline but generalize: a tight horizontal row with `[number] [type pill] [status pill] [amount]`. Click target is the existing invoice detail page route. Order rows chronologically. For payment-incomplete documents, expose the existing payment dialog entry point (currently inside `AdjustmentInvoiceBlock`) — don't lose that capability.

### 5. Implementation order

1. Extract shared primitives + lift-and-shift `FinancialSidebarDraft`. Verify zero pre-lock diff.
2. Add `getLinkedFinancialDocumentsForOrder` + `derivePaymentSummary` with unit tests.
3. Build `FinancialSidebarLocked` against the helpers.
4. Rewire `LockedInvoiceAdjustmentGate` → `LockedCompositionView` using `CurrentCompositionCard`.
5. Move the adjustment-workspace action block from the composition card to the sidebar.
6. Page wiring: pick orchestrator by `isLocked`.
7. Tests + visual QA.

## Observability Checklist

### Dashboards / Metrics

- Counter: `sales_page.locked.rendered` — increments on each post-lock render. Sanity gauge.
- Counter: `sales_page.locked.adjustment_action.opened` — increments when `Open Adjustment Workspace` is submitted from the new sidebar location. Compare against pre-change baseline to confirm discoverability did not regress.
- Discrepancy log: if `derivePaymentSummary.remaining < 0` for any render, log with `orderId` + inputs. Indicates double-counting bug.

### Rollback Plan

- Code-only change. Revert this phase's commits to restore the old single `FinancialSidebar` and inline `LockedInvoiceAdjustmentGate` rows.
- No schema changes. No flag.

### Customer-Visible Surface

- Staff (post-lock orders only): redesigned right sidebar; cleaner composition list on the left; adjustment workspace button moves to right side with helper text. Pre-lock sales workflow is unchanged.
- Customers: no direct change.

## Post-Implementation

- Update `context/ui-context-summary.md` to describe the split sidebar orchestrators and the locked sales layout.
- Update `context/progress-tracker.md`.

## Acceptance Criteria

- Post-lock sales page DOM contains no occurrence of `"SNAPSHOT LINE ITEMS"`, no row with label `"Album 30×30 to Album 30×30"`, and no standalone row with a raw negative `KD` swap (e.g. `"Album 30×30 to Album 20×20"` → must be merged into a single human-readable change line via 84a).
- Pre-lock sales page renders identically before vs. after this phase (visual diff zero, DOM diff zero on the fixture suite).
- `FinancialSidebarLocked` renders, in order: Payment Summary → Total Source → Linked Financial Documents → Adjustment Workspace action.
- Payment Summary uses customer-facing labels (`Customer Total` / `Paid` / `Remaining`); "Effective Total" does not appear in UI copy.
- `Open Adjustment Workspace`, `Resume Workspace`, and `Take Over` are all reachable from the new sidebar location and pass their existing tests.
- `derivePaymentSummary` is correct on the four test fixtures (deposit-only fully paid; deposit+ADJ unpaid; deposit+ADJ fully paid; deposit + multiple ADJs partially paid). No deposit double-count.
- `Paid` comes from the canonical settlement/payment-allocation helper, not from display-row arithmetic or `CompositionView`. A grep for ad-hoc payment summation in `FinancialSidebarLocked` returns zero hits.
- Refund and credit-note documents, when present, render as chips in the linked-docs section without errors. No new creation flows.
- `npm run build` passes.
- `npm run lint` passes.
