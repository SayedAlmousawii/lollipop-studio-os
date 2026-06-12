## Goal

Rebuild the Sales **right column** into the three-part glance + action stack from the claude-design handoff — Phase 7 / POS Sales redesign Piece 3, build-order item **B3**. Today the right column is the old `OrderCommitFinancialSidebar` (invoice list, "Create Invoice", financial-case id, document detail) that B1 simply re-homed; and the commit/discard controls (`SalesStagedCommitControls`) still sit in the **left** stack. B3 replaces all of that with:

1. **Order summary ("customer receipt")** — a read-only, itemized "what the customer is getting" card (top; its line list scrolls).
2. **Financial summary (simplified)** — paid / remaining / discounts / deposits / total, plus previous-vs-new + pending diff in draft state (pinned).
3. **Commit area (context-aware)** — Review & commit + Discard in draft state; "No changes to commit" + Record payment in clean state (pinned at the bottom).

This is a **read-layer / presentation reshape**: it consumes projector outputs that already exist on `salesPageView` and reuses the existing commit/discard/record-payment components. It does **not** reopen the OrderCommit financial engine, add financial computation, or add line kinds.

## Read First

- `context/reviews/pos-sales-redesign-planning.md`:
  - **"Right column — two glance cards (read-only)"** — receipt = live itemized readout (what the customer is getting); financial = simplified (paid · remaining · discounts · deposits · total; draft: previous vs new + pending diff). **Removed from the always-on card:** invoice list/breakdown, document plan, payment/refund impact, approval reasons, financial-case ids → those are commit-time concerns living in the Review & commit dialog / order-details.
  - **S-C (commit placement)** — commit home = **bottom of the right column**, a third element beneath receipt + financial. **No footer bar, no header CTA.** Context-aware: **draft** → Review & commit (`OrderCommitReviewDialog` → commit action) + Discard draft + a small "Draft" indicator; **clean/no-draft** → no commit/discard; quiet "No changes to commit" + **Record payment** (`POSRecordPaymentDialog`). Drop the separate "Clean" pill; no "Draft auto-saved" text.
  - **S-D (receipt contents)** — package-level + extras granularity; **grouped by package** (a package's add-ons/configs/photos/album nest under it; order-level add-ons form their own group); **per-line prices + a single subtotal/total**; discounts/deposits/paid/remaining stay on the financial card (no money-math duplication); **skip $0 operational configs**; customer-facing labels; **live draft preview in draft state, last-committed preview in no-draft state** (projector-only, no recomputation).
  - **S-F (scroll)** — right column stacks **receipt → financial → commit**; only the **receipt's line list scrolls internally**; **financial card + commit area stay pinned** at the bottom, always visible.
- `context/pos-redesign-handoff/project/hifi/workspace.jsx` — `OrderSummary` (subtotal / discounts / staged block / deposits / Remaining + Collect) and `StagedChanges` cards, and the bottom `ActionBar`. **Map only the visual language**; our money model and grouping follow S-C/S-D/S-F above, not the mock (e.g. our receipt shows *items* and a single subtotal; the discounts/deposits/remaining math is on the **financial** card, not the receipt — the mock blends them).
- `context/pos-redesign-handoff/project/hifi/styles.css` (~`.card`, `.page-rail`, `.staged-list`, `.summary-*`, `.collect-row`) — card chrome, the rail's "top card list scrolls, bottom card pinned" pattern (S-F), and the Collect/remaining row. Map to tokens; no raw hex.
- **Data sources (all already on `salesPageView` — no new computation):**
  - `salesPageView.financialPreview` (`SalesPageFinancialPreview`, `src/modules/order-commits/projections/sales-page-view.types.ts`): `.stage`, `.paymentStatusEnum`, `.collectPaymentTargetInvoiceId`, and **`.settlement`** (`CustomerSettlementSummaryProjection`) → `netCustomerTotal`, `cashPaid`, `remainingDue`, `availableCredit?`, and in draft `previousTotal` / `pendingDelta` / `afterCommitTotal` / `amountDueAfterCommit`. This is the **financial card's** source.
  - `salesPageView.composition` (`SalesPageComposition` = `DraftPOSCompositionProjection` + `source: "current" | "projected"`): per-package lines with prices, items, add-ons → the **receipt's** source. The `source` field is the S-D draft-vs-committed switch.
  - `salesPageView.draft` / `.ownership` / `.stagedChanges` / `.preview` → drive the **commit area's** context (draft vs clean, canDiscard).
- Existing components to **reuse** (do not rewrite their logic): `src/components/orders/sales-staged-commit-controls.tsx` (commit via `OrderCommitReviewDialog` + discard via `discardSalesDraftAction`), `src/components/orders/pos-record-payment-dialog.tsx` (record payment), `src/components/orders/current-composition-card.tsx` + `toCurrentCompositionCard` (receipt reuse candidate), `@/components/financial` (`MoneyRow`, `formatEnumLabel`), `@/lib/formatting/money`.
- `context/architecture-context.md` + `context/code-standards.md` — read-layer standards: **projectors never recompute financial/approval/refund state**; no `@/lib/db` in `app/**` or `src/components/**`. `context/ui-context.md` — tokens.

## Rules

- **Read-layer / presentation only. No financial-engine work.** B3 consumes existing projector outputs and reuses existing action components. It must **not**: reopen the OrderCommit engine (Specs 120–151), add or change financial computation, add line kinds, recompute totals/discounts/deposits/remaining, or alter `commitSalesChangesAction` / `discardSalesDraftAction` / record-payment logic. Every number rendered comes from `salesPageView.financialPreview.settlement` / `.composition` as-is.
- **Preserve all commit/discard/record-payment behavior** by **reusing** `SalesStagedCommitControls` (or its internals) and `POSRecordPaymentDialog`, wired to the same actions, `expectedVersion`, and ownership/policies as today. Same dialogs, same results — only their placement (now the right-column commit area) and surrounding chrome change.
- **Remove the commit controls from the left stack.** B3 relocates `SalesStagedCommitControls` out of the left composition panel (where B1 left it) into the right-column commit area. The left panel after B3 is composition-only (packages, add-ons, photos, CTA from B2).
- **Drop the deprecated financial surface.** The new financial card does **not** show: invoice list/line breakdown, "Create Invoice" form, document plan, payment/refund impact, approval reasons, or financial-case ids. Those remain available in the Review & commit dialog and order-details — do not duplicate them here. (Invoice creation is not a Sales-glance action.)
- **S-F scroll exactly:** within the right column, the **receipt card's line list** is the only internally-scrolling region; the **financial card and commit area are pinned** and always visible. Build on B1's right column (`overflow-y-auto`) by moving the scroll boundary **into the receipt card** so the money + action never scroll out of view.
- **S-D receipt fidelity:** itemized, grouped by package, per-line prices + single subtotal; **no** discounts/deposits/paid/remaining on the receipt (those live on the financial card); skip $0 operational configs; customer-facing labels; source switches with `composition.source`.
- **Confined scope.** Changes live in the Sales route folder (`app/(app)/orders/[orderId]/sales/` — `page.tsx`, CSS, new right-column component(s)) and, if a dedicated receipt projection is needed, a **read-layer projection** under `src/modules/order-commits/projections/` (or `src/modules/orders/composition/projections/`) that is **pure projection over existing snapshot/composition data** (prices already exist on lines; no financial recomputation). Do not touch the OrderCommit engine, financial-case services, edit policies' logic, `AppShell`, the `(app)` layout, global `Topbar`, or the left composition components.
- Token-driven; reuse shared primitives (`Card`, `Badge`, `Button`, `MoneyRow`); no inline raw hex.

## Scope

### In Scope

1. **Right-column container with S-F scroll** (new `sales-right-column.tsx` in the Sales route folder, or a small set of colocated components):
   - Stacks **Receipt → Financial → Commit area**.
   - Receipt card is `flex 1 1 auto` with its **line list** `overflow-y-auto` (the only scroller); financial card + commit area are `shrink-0`, pinned at the bottom and always visible (handoff `.page-rail` pattern).
   - Replaces `OrderCommitFinancialSidebar` as the right child in `page.tsx`. Keeps the B1 380px column width and the narrow-width single-column collapse.

2. **Order summary ("customer receipt") card** (read-only):
   - Itemized readout from `salesPageView.composition`: each **package** as a line (name + price), with its add-ons / extra photos / session-config fees / album nested under it; **order-level add-ons** as their own group; a **single subtotal/total** at the foot. Per-line prices only — **no** discount/deposit/paid/remaining math here.
   - Skip $0 operational configs (don't render free "Twins"/"Cake theme" rows). Customer-facing labels (no internal codes/ids).
   - **Source switch:** live draft preview when `composition.source === "projected"` (a draft exists), last-committed when `=== "current"`. A small "Preview" vs "Current" affordance is allowed (reuse `CurrentCompositionCard`'s mode/badge pattern if adopting it). Projector-only — no recomputation.
   - May reuse/adapt `CurrentCompositionCard` + `toCurrentCompositionCard`, or add a dedicated read-layer receipt projection over the existing composition — implementer's choice, but **pure projection**, grouped per S-D.

3. **Financial summary (simplified) card** (read-only, pinned):
   - Clean state: **total** (`netCustomerTotal`), **paid** (`cashPaid`), **remaining** (`remainingDue`), and discounts/deposits/available-credit where present (`availableCredit`) — from `financialPreview.settlement`.
   - Draft state: **previous total → new total + pending diff** (`previousTotal` / `afterCommitTotal` / `pendingDelta`) and `amountDueAfterCommit`, clearly labeled as "after commit."
   - A stage/payment chip from `financialPreview.stage` / `.paymentStatusEnum` is allowed. **No** invoice list, document plan, refund/approval detail, or financial-case id.
   - Use `MoneyRow` / `formatMoney` for consistency.

4. **Context-aware commit area** (pinned, bottom):
   - **Draft state** (`salesPageView.draft` present): **Review & commit** (reuse `SalesStagedCommitControls`' `OrderCommitReviewDialog` + commit path) + **Discard draft** (existing `discardSalesDraftAction`, gated by `ownership.canDiscard`) + a small **"Draft" / "N staged"** indicator. **Do NOT render the itemized staged-changes list (the old delta rail) in this area.** The locked decision (planning S-C + "delta rail retired", lines 44/230/233/279) is that the change detail is conveyed by the **receipt** (live preview line) and the **financial card** (pending diff); the always-on commit area shows only the badge + the two buttons. The full per-change list lives in the **Review & commit dialog**, not here. If reusing `SalesStagedCommitControls`, render it in a mode that hides the staged-changes list/description and keeps only the Draft badge + Discard + Review & commit.
   - **Clean / no-draft state**: **no** Review & commit / Discard; a quiet **"No changes to commit"** indicator + a **Record payment** button opening `POSRecordPaymentDialog` (targets from the existing `financialPreview.collectPaymentTargetInvoiceId` / workspace open charges, same as the current sidebar resolves them).
   - Reuse the existing components; do not reimplement commit, discard, or payment logic.

5. **`page.tsx` rewiring**: remove `SalesStagedCommitControls` from the left stack and `OrderCommitFinancialSidebar` from the right; render the new right-column stack with the same data (`composition`, `financialPreview`, `draft`, `preview`, `stagedChanges`, `ownership`, `financialCase`, financial policies, `workspace`). No change to data assembly above the JSX.

### Out of Scope

- No change to the OrderCommit engine, financial-case services/projectors' **computation**, `commitSalesChangesAction`, `discardSalesDraftAction`, record-payment action, edit-policy logic, or the staging reducers.
- No invoice creation, document/plan UI, refund/approval surfaces in the always-on cards (they stay in the commit dialog / order-details).
- **B4** (photos in-card modal), **B5** (album in-card), **B6** (notes UI), **B7** (token reconciliation). No left-panel changes beyond removing the relocated commit controls.
- No new financial field, no new line kind, no recomputation. No route change, no tabs, no footer bar.

## Implementation Direction

Build a `SalesRightColumn` (client where it must host the dialogs/payment, but pass projector data in as props from the server `page.tsx`) that lays out the three regions with the S-F scroll: a flex column where the receipt card takes the remaining height and scrolls its list internally, and the financial card + commit area are `shrink-0` and pinned. Move the right-column's scroll boundary off the B1 outer `overflow-y-auto` and into the receipt's list so money + action never scroll away.

For the **receipt**, prefer reusing `toCurrentCompositionCard` → `CompositionView` and `CurrentCompositionCard` if its rows already carry the per-line prices and grouping S-D wants; otherwise add a thin read-layer receipt projection over `salesPageView.composition` (the prices are already on the lines — this is presentation grouping, **not** financial math). Honor the `composition.source` switch for the draft-vs-committed label. Do not render $0 operational configs.

For the **financial card**, read straight from `financialPreview.settlement`: in `mode: "clean"` show total/paid/remaining (+ available credit/discounts where present); in `mode: "draft"` show previous → after-commit + pending delta and amount due after commit. This is the same data the current sidebar already had access to — just the simplified subset, with the invoice/document/case-id sections removed.

For the **commit area**, reuse `SalesStagedCommitControls` for the draft path (it already owns Review & commit + Discard + staged summary + ownership gating) and `POSRecordPaymentDialog` for the clean-state Record payment (resolve the target invoice the same way the current sidebar does). Switch between them on `salesPageView.draft` presence. Keep `expectedVersion` and ownership wiring intact.

In `page.tsx`, delete the `OrderCommitFinancialSidebar` usage and the left-stack `SalesStagedCommitControls`, and render `<SalesRightColumn …/>` as the right child with the existing props. Leave all data assembly untouched. Minor label/placement choices are allowed UI assumptions — state them in the PR.

The success bar for B3: the right column reads as **receipt (scrolling list) → simplified financial (pinned) → context-aware commit (pinned)**; in a draft you see previous→new totals + pending diff with Review & commit / Discard; with no draft you see a clean total/paid/remaining with Record payment; and committing, discarding, and recording a payment all behave exactly as before.

## Post-Implementation

- Update `context/progress-tracker.md`: Feature History entry for Spec 175 (Sales right column — receipt + simplified financial + context-aware commit; read-layer/presentation; commit relocated from left to right; S-F partial scroll).
- In `context/reviews/pos-sales-redesign-planning.md`, mark **B3 shipped** and leave B4–B7 as follow-ons; note the staged-changes delta rail is now retired in favor of the receipt + simplified financial.

## Acceptance Criteria

- The Sales right column renders **Order summary (receipt) → Financial summary → Commit area**, replacing `OrderCommitFinancialSidebar`; the commit/discard controls are **no longer in the left panel**.
- **S-F scroll:** only the receipt card's line list scrolls; the financial card and commit area stay pinned and visible at the bottom; the page itself still does not scroll.
- **Receipt (S-D):** itemized, grouped by package with order-level add-ons as their own group, per-line prices + a single subtotal, no discounts/deposits/paid/remaining, $0 operational configs skipped, customer-facing labels; shows the draft preview when a draft exists and the last-committed composition otherwise (`composition.source`).
- **Financial (simplified):** clean state shows total/paid/remaining (+ available credit/discounts where present); draft state shows previous → after-commit + pending delta and amount due after commit — all from `financialPreview.settlement`; **no** invoice list, document plan, refund/approval detail, or financial-case id.
- **Commit area (S-C):** draft state → Review & commit + Discard + a small "Draft / N staged" indicator **only** — the itemized staged-changes list (old delta rail) is **not** rendered here (change detail lives in the receipt + financial card + the Review & commit dialog); clean state → "No changes to commit" + Record payment; both reuse the existing dialogs/actions with identical behavior, `expectedVersion`, and ownership gating. No footer bar, no header CTA.
- **No engine/computation change:** no OrderCommit/financial-case computation, action, edit-policy, staging-reducer, or line-kind change; every number comes from existing projector output; no new financial field; no recomputation.
- Scope confined to `app/(app)/orders/[orderId]/sales/` plus, if needed, a pure read-layer receipt projection; no `@/lib/db` under `app/**` or `src/components/**`; tokens/primitives reused, no raw hex.
- Right column keeps the 380px width and collapses cleanly at the narrow breakpoint.
- `npm run build` passes. `npm run lint` passes. Existing Sales mount/source guard (`tests/order-commits/sales-page-surface/...`) stays green.
