## Goal

Restyle the Sales left panel into the **collapsible-row composition** from the claude-design handoff — Phase 7 / POS Sales redesign Piece 3, build-order item **B2**. Today the left panel is one flat "Package Composition" card wrapping every package line, plus stacked "Selected Photos" / add-on / commit cards. B2 turns the **packages into individual collapsible cards** (the handoff `.pkg` accordion: tier thumbnail + title + meta + base price + chevron header; expanded body holds the existing controls), restyles the **order-level add-ons into collapsible rows**, and adds the **dashed "+ add another…" CTA** at the bottom. This spec is **presentation-only and functionally unchanged**: every existing handler, dialog, edit policy, staging call, and projector stays wired exactly as today — only the container chrome, header layout, and row styling change.

## Read First

- `context/reviews/pos-sales-redesign-planning.md` — Piece 3 → "Left panel — editable composition (single view)" (collapsible rows; package cards first-open-by-default; included deliverables as content tiles; add-on rows incl. standalone albums; dashed "+ add another package / add-on / product" CTA) and the build-order note (**B2 — Composition rows restyle: left panel = collapsible package + add-on rows + dashed CTA. Functionally unchanged.**).
- `context/pos-redesign-handoff/project/hifi/workspace.jsx` — the authoritative card structure: `PackageCard` (`.pkg` → `.pkg-head` [thumb + `.tier-label`, `.title-block` h2 + meta, `.price` v/"BASE", chevron] → `.pkg-body` [divider, `.tiles` content tiles, `.note-row`, `.pkg-actions`]) and `CompositionMain` (maps packages, first `defaultOpen`, then the `.add-row` dashed CTA). Reproduce the **layout/visual pattern**; ignore its mock data/financial model.
- `context/pos-redesign-handoff/project/hifi/styles.css` lines ~454–578 — exact card styling (`.pkg` radius 14 / surface / border; `.pkg-head` 76px thumb + 18px h2 + 22px base price; `.tiles` 2-col grid; `.tile` icon + name + count + optional progress bar; `.note-row`; `.pkg-actions` wrap; `.add-row` 1.5px dashed, accent on hover). Map every value to our tokens — no raw hex.
- `src/components/orders/pos-package-composition.tsx` — the component to restyle. It is `"use client"`, ~1012 lines, and already owns the staging/dialog/policy logic. Current render: **one** `<Card id="package-composition">` whose `CardContent` maps `composition.packageLines` into flat sub-sections (each: `PackageUpgradeDialog` for Upgrade/Swap, `ConfigureSessionPanel`, and a `packageItems.map` with `ItemUpgradeDialog`). B2 changes **only** how this is presented — wrap each `packageLines` entry in its own collapsible `.pkg`-style card; do not alter the dialogs, forms, `handlers`, `editPolicies`, `expectedVersion`, or staging calls.
- `src/components/orders/pos-add-on-marketplace.tsx` — the order-level add-on surface; B2 restyles its **already-added** add-ons into collapsible rows and routes the "add" affordance through the new dashed CTA. Same handlers/policies.
- `context/ui-context.md` — spacing/surface tokens (`bg-surface`, `bg-surface-soft`, `border-border`, `text-text-primary`, `text-text-secondary`, `text-text-muted`, `text-accent`, `accent-soft`). Reuse; add no raw colors.

## Rules

- **Presentation-only. Functionally unchanged.** B2 restyles containers, headers, and rows. It does **not** change `getSalesPageView`, the composition projector, any staging/commit action, edit policies, `ItemUpgradeDialog`, `PackageUpgradeDialog`, `ConfigureSessionPanel`, photo billing, or any component's data props. Every action that works today (upgrade tier, swap package, configure session, per-item upgrade, add/remove add-on, stage/commit) works identically after B2 — same dialogs, same results.
- **Collapse is local UI state.** Each package card tracks its own open/closed state (`useState`), **first package open by default** (handoff `defaultOpen={i===0}`). No persistence required (no cookie/localStorage); render is hydration-safe (no reading storage during render). Collapsing a card never changes draft/staged state.
- **Stay inside the B-series lane — do not pull in later specs.** B2 does **not**: move photos into a per-package modal (that is **B4** — leave the existing photo surface working as-is for now), add a "Configure album" action or standalone-album rows (**B5**), add an "Add note" action or notes section (**B6**), or relocate the commit controls / build the right column (**B3** — `SalesStagedCommitControls` and the financial sidebar stay exactly where B1 left them). Only render package-card actions whose backing already exists today (Upgrade tier / Swap via `PackageUpgradeDialog`, Configure session via `ConfigureSessionPanel`, per-item upgrade via `ItemUpgradeDialog`). Do **not** add not-yet-built action buttons.
- **Confined scope.** Changes live in the Sales composition/add-on components (`src/components/orders/pos-package-composition.tsx`, `src/components/orders/pos-add-on-marketplace.tsx`) and, if needed, a small presentational sub-component or CSS module colocated with them or in the Sales route folder. Do not touch `AppShell`, `(app)/layout.tsx`, the Sales `layout.tsx`/`page.tsx` shell from B1 (beyond passing existing props), `PageContainer`, projectors, or any module/service.
- Reuse shared tokens/primitives; no inline raw hex, no Sales-only design system (planning style strategy #5). A colocated CSS module mirroring the handoff classes is fine, as long as values resolve to tokens.

## Scope

### In Scope

1. **Package cards → collapsible accordion** (`pos-package-composition.tsx`):
   - Replace the single flat `<Card id="package-composition">` wrapper with **one collapsible card per `composition.packageLines` entry**, styled like the handoff `.pkg`.
   - **Header (`.pkg-head`, click toggles open):** a tier-derived **thumbnail placeholder** (gradient/initials/tier label — no image uploads, per planning), the **package name** (h2), a **meta line** (session label · N included items · session date — from existing workspace/line data), the **base price** (value + "BASE" eyebrow), and a **chevron** that reflects open/closed.
   - **Body (`.pkg-body`, shown when open):** the **existing** per-package controls, unchanged in behavior — included deliverables rendered as **content tiles** (`.tiles` 2-col grid; each tile = existing `packageItems` entry with its name/qty and the existing per-item `ItemUpgradeDialog`), the `ConfigureSessionPanel`, and the `PackageUpgradeDialog` (Upgrade tier / Swap package). Keep the same forms, `handlers`, `editPolicies`, and `expectedVersion` wiring.
   - First package open by default; others collapsed. Empty state (no package lines) keeps the existing copy, restyled to fit.

2. **Order-level add-ons → collapsible rows** (`pos-add-on-marketplace.tsx`):
   - Restyle **already-added** order-level add-ons as collapsible rows consistent with the package cards (some expand to a short summary, some are static) — same add/remove handlers and policies as today. Standalone-album add-on configuration stays out (B5); render albums as ordinary add-on rows for now.

3. **Dashed "+ add another…" CTA** (`.add-row`):
   - A dashed full-width CTA at the bottom of the left stack — "Add another package, add-on, or product" — that routes to the **existing** add affordance (the add-on marketplace's add flow). No new add capability; it surfaces what already exists in the handoff's visual language.

4. **Token-driven styling** matching the handoff card metrics (radius, thumb size, tile grid, dashed border, accent hover) via shared tokens / a colocated CSS module.

### Out of Scope

- **B3** — right column (receipt + simplified financial + commit area) and any relocation of `SalesStagedCommitControls`/financial sidebar. They stay as B1 left them.
- **B4** — moving the photo summary into a per-package modal. The existing photo surface (`POSPhotoCountCard` / "Selected Photos") stays functionally and structurally as today; B2 may only adjust its outer spacing to sit cleanly in the stack, not move it into the card modal.
- **B5** — "Configure album" action, album modals, standalone-album row config. **B6** — "Add note" action, notes section, per-package customer-note rows. **B7** — final token reconciliation.
- No change to `getSalesPageView`, projectors, staging/commit/discard actions, edit policies, dialogs' logic, or any data prop. No new read or workspace field.

## Implementation Direction

The whole change is **chrome around existing controls**. In `pos-package-composition.tsx`, lift the per-`packageLines` render block out of the single outer card and give each line its own collapsible card component (a small colocated presentational `PackageCompositionCard`, or an inline collapsible wrapper) holding `open` state with `useState(i === 0)`. The header reads fields already available on the package line / `workspace` (name, base price, session label, included-item count, session date); the body renders the **same** `ConfigureSessionPanel`, `PackageUpgradeDialog`, and `packageItems.map(... ItemUpgradeDialog ...)` JSX that exists today — moved, not rewritten. Do not thread any new data through; the projector output is unchanged.

For the thumbnail, derive a placeholder from the package tier/name (gradient + short tier label), matching `.pkg-head .thumb` — no uploads, no new fields. For content tiles, reuse the existing included-item data; the handoff's used/total progress bar is a **photo-summary** concept (B4) — do **not** add progress bars here; tiles show the included deliverables as they exist today.

For the actions row (`.pkg-actions`), render only the actions already wired (Upgrade tier / Swap → `PackageUpgradeDialog`; Configure session → `ConfigureSessionPanel`; per-item upgrade stays on each tile). Leave space conceptually for B5 (Configure album) / B6 (Add note) but **do not** add those buttons now.

For add-ons, apply the same collapsible-row treatment in `pos-add-on-marketplace.tsx` to already-added items; keep the marketplace's add/remove handlers intact and let the new dashed CTA invoke the existing add flow (e.g. open/scroll-to the marketplace, or trigger its existing add entry point) rather than introducing a new path.

Styling: add a colocated CSS module (or Tailwind utilities) mapping the handoff `.pkg` / `.tile` / `.add-row` metrics to our tokens (`bg-surface`, `bg-surface-soft`, `border-border`, `text-*`, `accent`, `accent-soft`). Keep collapse animation minimal (height/opacity or none) — visual polish without behavior change. Minor label/placement choices are allowed UI assumptions — state them in the PR.

The success bar for B2: the left panel reads as a stack of **collapsible package cards** (first open) with tier thumbnails, base prices, and content tiles, followed by **add-on rows** and a **dashed "+ add another…" CTA** — while every existing action (upgrade, swap, configure session, item upgrade, add/remove add-on, stage, commit) behaves exactly as before.

## Post-Implementation

- Update `context/progress-tracker.md`: add a Feature History entry for Spec 174 (Sales composition rows restyle — collapsible package cards + add-on rows + dashed CTA; presentation-only).
- In `context/reviews/pos-sales-redesign-planning.md`, mark **B2 shipped** (composition rows) and leave B3–B7 as follow-ons.

## Acceptance Criteria

- The Sales left panel renders each package as its own **collapsible card** in the handoff `.pkg` style: tier thumbnail placeholder, package name, meta line (session · items · date), base price + "BASE" eyebrow, and a chevron; the **first package is open by default**, others collapsed; toggling is local UI state and never alters draft/staged state.
- Each open card's body shows the **existing** controls — included deliverables as content tiles (with the existing per-item upgrade), Configure session, and Upgrade tier / Swap package — wired to the same handlers, policies, dialogs, and `expectedVersion` as before, with identical behavior and results.
- Order-level add-ons render as **collapsible rows** consistent with the cards; add/remove behaves exactly as today. A **dashed "+ add another…" CTA** sits at the bottom and routes to the existing add flow (no new add capability).
- **No functional change:** `getSalesPageView`, the composition projector, all staging/commit/discard actions, edit policies, `ItemUpgradeDialog`, `PackageUpgradeDialog`, `ConfigureSessionPanel`, and photo billing are unchanged; no data prop or workspace field changes.
- **No scope bleed:** no photo-into-card modal (B4), no Configure-album/standalone-album config (B5), no Add-note/notes section (B6), no right-column/commit relocation (B3). The photo surface and `SalesStagedCommitControls`/financial sidebar remain as B1 left them.
- Styling is token-driven — no inline raw hex, no `@/lib/db` import under `app/**` or `src/components/**`; shared primitives/tokens reused.
- Layout still collapses cleanly at the B1 narrow breakpoint.
- `npm run build` passes. `npm run lint` passes.
