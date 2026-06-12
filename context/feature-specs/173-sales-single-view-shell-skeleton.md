## Goal

Build the **shell skeleton** for the single-view Sales redesign — Phase 7 / POS Sales redesign Piece 3, build-order item **B1**. Replace the current centered, page-scrolling Sales layout (`PageContainer` + header card + two-column grid) with a **fixed shell / partial-scroll** single view: a pinned header, a left composition panel that scrolls internally, and a right glance column — all inside the existing `(app)` protected shell, with no whole-page scroll. This spec is **structural only**: it re-homes the existing, working Sales content into the new shell regions and restyles the header. Row/card restyling (B2), the right-column receipt + financial + commit cards (B3), and in-card photos/album/notes (B4–B6) are separate later specs.

## Read First

- `context/reviews/pos-sales-redesign-planning.md` — Piece 3 → "Locked Decisions — shell & layout" (single view/no tabs, fixed shell/partial scroll, two-column layout left `1fr` + right ~380px, header decision #4, style strategy #5, drafts auto-persist #6) and S-F (right-column stacking: receipt scrolls, financial + commit pinned — refined in B3, not here). Note the planning doc's "Background (current reality)" references the **old** per-section `AppShell`/`<main>` mount; the shell has since moved (see next bullet) — ground against the real files below.
- `app/(app)/layout.tsx` — the **current** protected shell: a shared route-group layout that reads the sidebar cookie, wraps everything in `SidebarCollapseProvider`, and renders `AppShell`. All authenticated pages (including Sales) now live under `app/(app)/` and share this persisted layout.
- `src/components/layout/app-shell.tsx` — `AppShell` renders `<div class="flex h-screen overflow-hidden">` → sidebar + `<div class="flex flex-1 flex-col overflow-hidden">` → `<Topbar />` + `<main class="flex-1 overflow-y-auto">{children}</main>`. **`<main>` is the scroll parent.** The Sales view mounts inside `<main>` and must own its own internal scroll so `<main>` itself does not scroll (a `h-full` child with `overflow-hidden` fills `<main>` exactly and produces no page scroll). Do **not** change `AppShell` or `<main>`.
- `app/(app)/orders/[orderId]/sales/layout.tsx` — the current Sales layout: wraps children in `PageContainer` (centered `max-w-7xl px-6 py-6`, page-scroll) and renders the Back-to-Order button + a header card (`Sales Workspace` h1, customer name, Job/status badges, session date, phone). This is what B1 replaces. It already loads `getPOSWorkspace(orderId)` — the header data source. Keep using it; add no new read.
- `app/(app)/orders/[orderId]/sales/page.tsx` and `sales-page.module.css` — the current page: a CSS-grid two-column layout (`.salesGrid` = left `<main>` stack of `POSPackageComposition` / `POSPhotoCountCard` / `POSAddOnMarketplace` / `SalesStagedCommitControls`, right `OrderCommitFinancialSidebar` sticky). These components keep working unchanged in B1 — they are re-homed into the new shell regions, not rewritten.
- `src/components/layout/page-container.tsx` — what B1 bypasses for Sales (`mx-auto max-w-7xl px-6 py-6`). The fixed-shell Sales view does not use it.
- `context/ui-context.md` — spacing/surface tokens (`bg-surface`, `border-border`, `text-text-primary`, `text-text-secondary`, `text-accent`). Reuse; add no raw colors or Sales-only design system (planning style strategy #5).

## Rules

- **Structural / presentational only. No behavior, data, or financial change.** B1 changes layout containers and the header; it does **not** touch `getSalesPageView`, the projectors, the staging/commit actions, the OrderCommit engine, edit policies, or any component's props/logic. The exact same composition, photo, add-on, staged-commit, and financial-sidebar functionality renders after B1 as before — only its container/scroll structure and the header change.
- **Keep `development` shippable.** "Placeholder content" from the planning breakdown means *no new row/card restyle yet* — **not** an empty page. Re-home the existing working components into the new left/right regions so `/orders/[orderId]/sales` stays fully functional after B1. B2 restyles the left rows; B3 replaces the right column. Do not strip functionality between specs.
- **No tabs, no route change.** The view stays a single page at `app/(app)/orders/[orderId]/sales/`. No routed tab segments, no tab bar. (v2 relocation to `/sales/[orderId]` remains parked.)
- **Fixed shell, partial scroll, no whole-page scroll.** Header pinned; the **left composition panel** scrolls internally; the **right column** scrolls independently if tall. `<main>` (and thus the page) must not scroll. Achieve this with the Sales root filling `<main>` at `h-full` and `overflow-hidden`, delegating scroll to the inner regions. Remember the flexbox gotcha: a flex child that must scroll needs `min-h-0` (or `min-w-0`) or it will overflow its parent instead of scrolling.
- **Do not modify `AppShell`, `<main>`, the `(app)` layout, the global `Topbar`, or `PageContainer`.** All B1 changes live in the Sales route folder (`app/(app)/orders/[orderId]/sales/`).
- Reuse shared tokens/primitives; no inline styles, no raw hex (planning #5). The existing `sales-page.module.css` may be replaced/extended for the new grid + scroll regions, or swapped for Tailwind utility classes — implementer's choice, but keep it token-driven.

## Scope

### In Scope

1. **Fixed-shell root + scroll ownership** (Sales `layout.tsx`, or a small client/server wrapper it renders):
   - Replace the `PageContainer` wrapper with a root that fills `<main>`: `h-full flex flex-col overflow-hidden`. This makes the Sales view own its height and internal scroll so `<main>` does not scroll.
   - A **pinned header region** (`flex-shrink-0`) at the top (see #2).
   - Below the header, a **content row** (`flex-1 min-h-0 flex`) holding the two columns:
     - **Left composition panel** — `flex-1 min-w-0 min-h-0 overflow-y-auto` (the panel that scrolls).
     - **Right glance column** — fixed width ~`380px` (per locked decision; current code uses 320px — widen to ~380), `min-h-0 overflow-y-auto` (scrolls independently if tall). Internal pinning of receipt vs financial vs commit (S-F) is **B3's** job; B1 just establishes the scrollable right region.
   - Collapse to a single column on narrow widths (mirror the existing `@media (max-width: 767px)` behavior) so tablet width still works.

2. **Header restyle** (replaces the current header card; planning header decision #4):
   - Back-to-Order control kept (links to `/orders/[orderId]`), placed in the pinned header region.
   - `h1` = **customer phone** (per the locked decision; replaces "Sales Workspace").
   - Show **reference / order state / session date / photographer** when available (from `getPOSWorkspace`); omit gracefully when a field is absent. **Duration left blank**; **session-type badge omitted** (no clean order-level value for multi-package).
   - Pure restyle within Sales — do not push Sales-specific content into the global `Topbar`. "Topbar" in the planning note means the Sales view's own pinned header row, not the app-wide `Topbar`.

3. **Re-home existing content into the regions** (page.tsx):
   - **Left region:** the existing left stack as-is — `POSPackageComposition`, `POSPhotoCountCard`, `POSAddOnMarketplace`, `SalesStagedCommitControls`, plus the `SalesDraftOwnershipBanner`. Same props, same handlers, same policies. (B2 will restyle these into collapsible rows; B1 leaves them functionally and visually as today, just inside the scrollable left panel.)
   - **Right region:** the existing `OrderCommitFinancialSidebar` as-is. (B3 replaces this with the receipt + simplified-financial + context-aware commit cards; B1 just relocates it into the pinned-capable right column.)
   - All existing data assembly in `page.tsx` (`getSalesPageView`, policy builders, handler factories) stays byte-for-byte; only the returned JSX container structure changes.

### Out of Scope

- No collapsible-row restyle of the composition (B2), no receipt/financial/commit-area cards (B3), no photo/album/notes in-card modals (B4–B6), no token reconciliation (B7).
- No change to `getSalesPageView`, projectors, staging/commit/discard actions, edit policies, or any OrderCommit/financial logic.
- No change to `AppShell`, `<main>`, `(app)/layout.tsx`, global `Topbar`, `PageContainer`, the sidebar, or any non-Sales route.
- No new data read or workspace field; the header uses what `getPOSWorkspace` already returns.
- No routed tabs, no route relocation, no draft-auto-saved label (planning S-C dropped it).

## Implementation Direction

The whole change is containers + header. Start in the Sales `layout.tsx`: drop `PageContainer` and make the root a flex column that fills `<main>` (`h-full flex flex-col overflow-hidden`). Put the restyled header in a `flex-shrink-0` row, then a `flex-1 min-h-0` content area. Because `<main>` is `flex-1 overflow-y-auto` inside the `overflow-hidden` content column of `AppShell`, a `h-full` Sales root resolves to a definite height and, with `overflow-hidden`, prevents `<main>` from scrolling — the verified escape hatch. The two columns live either in the layout (with the left/right slotted) or, more simply, keep the layout owning the header + shell frame and let `page.tsx` render the two-column content area. Given the current split (layout = header/frame, page = columns), the cleanest move is: layout provides the fixed-shell frame + header + a `flex-1 min-h-0` slot for `children`; `page.tsx` renders the two-column row (left scroll panel + right column) inside that slot. Confirm the `min-h-0` chain from the scroll parent down to the scrolling panel so the left panel scrolls rather than pushing the page.

For the two columns, replace `.salesGrid`'s `grid` with a flex row (or keep a grid, but ensure both columns can own their own `overflow-y-auto` and the row is `min-h-0`). Left column = `flex-1 min-w-0 overflow-y-auto`; right column = `w-[380px] shrink-0 overflow-y-auto`. Keep the existing single-column collapse at `max-width: 767px`.

For the header, read the fields off the `workspace` already loaded in `layout.tsx` (`customerPhone`, `jobNumber`/reference, `orderStatus`, `sessionDate`, and whatever photographer field `getPOSWorkspace` exposes — check the workspace type and use it if present, otherwise omit). Keep the Back-to-Order `Link`. Use existing tokens and the `Badge`/`Button` primitives already imported. Minor label/placement choices are allowed UI assumptions — state them in the PR.

Re-home the existing components verbatim; do not alter their props, handlers, policies, or internal markup. The success bar for B1 is: the Sales page looks reorganized into a fixed shell with a pinned header and an internally-scrolling left panel, while every existing action (stage, configure, add-on, photo count, review & commit, discard) works exactly as before.

## Post-Implementation

- Update `context/progress-tracker.md`: add a Feature History entry for Spec 173 (Sales single-view shell skeleton — fixed shell/partial scroll, header restyle, regions re-homing existing content).
- In `context/reviews/pos-sales-redesign-planning.md`, note B1 shipped (shell skeleton) and that B2 (composition rows) / B3 (right column) build on it.

## Acceptance Criteria

- `/orders/[orderId]/sales` renders inside the `(app)` shell with **no whole-page scroll**: the header is pinned, the left composition panel scrolls internally, and the right column scrolls independently; `<main>` does not scroll.
- `PageContainer` is no longer used by the Sales route; the Sales root fills `<main>` (`h-full flex flex-col overflow-hidden`) and owns internal scroll.
- The header is restyled per the locked decision: Back-to-Order present, `h1` = customer phone, reference/state/session-date/photographer shown when available, no session-type badge, duration blank.
- The existing Sales functionality is intact and unchanged: package composition, photo count, add-on marketplace, draft ownership banner, staged commit/discard/review controls, and the financial sidebar all render and operate exactly as before, with no prop/logic/projector/action change.
- No change to `AppShell`, `<main>`, `(app)/layout.tsx`, global `Topbar`, `PageContainer`, the sidebar, `getSalesPageView`, projectors, edit policies, or any OrderCommit/financial code; all changes are confined to `app/(app)/orders/[orderId]/sales/`.
- Layout collapses to a single column at tablet/narrow widths without breaking scroll.
- No `@/lib/db` import added under `app/**`; no inline styles or raw hex; tokens/primitives reused.
- `npm run build` passes.
- `npm run lint` passes.
