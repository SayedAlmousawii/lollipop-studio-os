## Goal

Add an app-wide collapse/expand toggle to the main navigation sidebar — Phase 7 / POS Sales redesign build-order item **F3** (planning ref S-H2). The sidebar today (`src/components/layout/sidebar.tsx`) has no collapse affordance. Collapsing shrinks it to an icon-only rail; the state persists across navigations and reloads. This is a **standalone, frontend-only** spec — independent of the Album/Notes domains and of the Sales redesign itself; it can ship anytime.

## Read First

- `context/reviews/pos-sales-redesign-planning.md` — S-H2 (Sidebar collapse): "App-wide collapse/expand toggle on the main sidebar (net-new). Persist collapsed state (e.g. localStorage), collapsed rail shows icons only." Also the Mockup → adopt inventory "Shell" row (sidebar collapse toggle, deferred polish — this is that item, pulled forward as a standalone foundation).
- `src/components/layout/sidebar.tsx` — the current sidebar: a `"use client"` component owning its own width (`w-60`), with a logo header, `NAV_SECTIONS` nav, and a user block. It is the **only** component that needs to change.
- `src/components/layout/app-shell.tsx` — the shell that renders `<Sidebar>` as a `flex-shrink-0` child of a flex row. Because the sidebar owns its own width, collapsing changes only the sidebar's own root width; **AppShell does not need to change**.
- `src/components/ui/tooltip.tsx` and `src/components/ui/button.tsx` — existing shadcn primitives to reuse for the collapsed-item tooltips and the toggle control. Do not hand-roll new variants.
- `context/ui-context.md` — sidebar tokens (`bg-sidebar`, `sidebar-border`, `sidebar-foreground`, `sidebar-muted`, `sidebar-active-bg`) already used in the component; reuse them, add no raw colors.

## Rules

- **Frontend-only. No backend, no schema, no service, no DB, no permissions.** This spec touches `src/components/layout/sidebar.tsx` (and, only if a small extracted hook/helper is cleaner, a colocated file under `src/components/layout/`). Nothing else.
- **No hydration mismatch.** The sidebar is rendered inside a server component (`AppShell`) but is itself a client component. Initialize collapsed state to a **constant default (expanded)** so the server render and the first client render agree, then apply the persisted value in a post-mount `useEffect`. Never read `localStorage` during render/initialization — that desyncs SSR and triggers a React hydration warning. A one-frame expand→collapse transition after mount is acceptable; a hydration mismatch is not.
- **Persistence is local UI state, not app data.** Use `localStorage` (per S-H2). Guard all access with a `typeof window !== "undefined"` check and a try/catch (private-mode / disabled-storage safety). Do not introduce cookies, a context provider, or server state for this — it is per-browser UI preference.
- **Reuse existing tokens and primitives.** No new colors, no inline styles, no new dependencies. Icons stay the existing Lucide set already imported.
- **Accessibility is required, not optional.** The toggle is a real `<button>` with an `aria-label` and `aria-expanded` reflecting state. In the collapsed rail each nav item must remain operable and have an accessible name (the label is visually hidden but exposed via `aria-label`/`sr-only` text and surfaced on hover via Tooltip). Active-route highlighting must still work collapsed.

## Scope

### In Scope

1. **Collapsed rail state + toggle** in `sidebar.tsx`:
   - A boolean `collapsed` state, default `false` (expanded), persisted to `localStorage` under a stable key (e.g. `studio-os.sidebar-collapsed`). Read once in a post-mount `useEffect` and write on every toggle.
   - A toggle control (a `Button`/icon-button using the existing primitive) placed in the sidebar — e.g. in the logo header row or pinned at the bottom above the user block. Use a chevron icon (`ChevronLeft` / `ChevronRight` from Lucide, or `PanelLeftClose` / `PanelLeftOpen`) reflecting direction. `aria-label` = "Collapse sidebar" / "Expand sidebar"; `aria-expanded` set accordingly.

2. **Collapsed visual treatment:**
   - Root `<aside>` width switches from `w-60` to a narrow rail (e.g. `w-16`) when collapsed, with a `transition-[width]` for a smooth change. Keep `flex-shrink-0` so the main content reflows automatically (AppShell unchanged).
   - **Logo header:** show only the Aperture mark centered; hide the "Studio OS" wordmark when collapsed.
   - **Nav items:** show only the icon, centered; hide the text label. Preserve active/hover styling and the section dividers. Wrap each collapsed item in a `Tooltip` whose content is the item label (so hovering an icon reveals its name); ensure the label text is also available to screen readers (`sr-only` span or `aria-label` on the `Link`).
   - **User block:** show only the avatar circle centered; hide the name/role text when collapsed.

3. **Expanded behavior is unchanged** — when not collapsed, the sidebar looks and behaves exactly as today (same `w-60`, labels, sections, user block). The only addition in the expanded state is the visible toggle control.

### Out of Scope

- No change to `AppShell`, `Topbar`, routing, or any page.
- No backend, schema, service, permission, or DB change.
- No mobile/responsive drawer behavior, no auto-collapse at breakpoints, no swipe gestures (S-H2 is a manual toggle only; responsive work is not in this spec).
- No keyboard-shortcut binding for the toggle (could be a later polish; not required here).
- No change to which nav items appear or the `showProductionLink` / `showProductsLink` logic.
- No broader token reconciliation (that is S-H / B7, deferred).

## Implementation Direction

Keep the change contained to `sidebar.tsx`. The component is already `"use client"`, so add `useState` for `collapsed` (default `false`) and a `useEffect` that, on mount, reads the persisted value from `localStorage` and sets state — this is the only place storage is read, which is what avoids the hydration mismatch (server and first client render both use the `false` default; the effect runs after hydration). The toggle handler flips state and writes the new value to `localStorage`, both behind a `typeof window` guard with try/catch.

Drive all the collapsed-vs-expanded differences off the single `collapsed` boolean using `cn(...)` conditionals on the existing elements: the root width (`w-60` vs `w-16`), the wordmark visibility, each nav item's label visibility and justification (icons stay, text hides and items center), and the user block's text visibility. The icons, hrefs, active-state logic (`isActive`), and section structure stay exactly as they are — you are conditionally hiding text and narrowing the rail, not restructuring the nav.

For the collapsed tooltips, wrap each nav `Link` in the existing `Tooltip` primitive with the label as content, shown on the right side; only needed (or only rendered) in the collapsed state. Make sure the accessible name survives: when the visible label is hidden, expose it via `aria-label` on the `Link` or an `sr-only` span so screen-reader and keyboard users are unaffected.

Add a smooth `transition-[width]` (or `transition-all` scoped to width/spacing) on the `<aside>` so the collapse/expand animates rather than snapping. Verify the main content area reflows correctly purely from the sidebar's width change (it will, because the sidebar is a `flex-shrink-0` sibling of the `flex-1` content column in AppShell).

## Post-Implementation

- Update `context/progress-tracker.md`: add a Feature History entry for Spec 171 (app-wide sidebar collapse with localStorage persistence and icon-only rail). No Key State entry needed — this is UI behavior derivable from the component.
- In `context/reviews/pos-sales-redesign-planning.md`, mark S-H2 as resolved/shipped by Spec 171 (and note the "Shell" adopt-inventory sidebar-collapse item is delivered).

## Acceptance Criteria

- The sidebar has a visible toggle that collapses it to an icon-only rail and expands it back; the toggle is a real `<button>` with a correct `aria-label` and `aria-expanded`.
- Collapsed state persists across client navigations and full reloads via `localStorage`; clearing storage or first visit defaults to expanded.
- No React hydration warning: collapsed state is initialized to the expanded default and only applied from storage in a post-mount effect; storage access is guarded (`typeof window`, try/catch).
- Collapsed rail shows only icons (logo mark, nav icons, avatar), hides all text labels/wordmark/user text, keeps active-route highlighting, and exposes each item's label via Tooltip on hover plus an accessible name for screen readers.
- Expanded state is visually and behaviorally identical to today aside from the added toggle control; the width change animates smoothly and the main content reflows with no AppShell change.
- Only `src/components/layout/sidebar.tsx` (plus, at most, a colocated helper/hook under `src/components/layout/`) is changed; no backend, schema, service, permission, routing, or other-component changes; no new dependencies, raw colors, or inline styles.
- `npm run build` passes.
- `npm run lint` passes.
