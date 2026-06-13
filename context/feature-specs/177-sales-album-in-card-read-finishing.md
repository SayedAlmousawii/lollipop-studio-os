## Goal

Surface albums in the Sales view and make their **finishing** editable in-card — Phase 7 / POS Sales redesign Piece 3, build-order item **B5, Part 1 (operational/read half)**. This is the **first consumer of the F1 Album domain** (Spec 169, `src/modules/albums/`), which until now is only touched by post-commit sync. Part 1 covers **read surfacing + display + live finishing edits** — the operational, no-price half. **Part 2 (separate spec)** adds the priced operations (extra pages, size/product swap, Add standalone album) that stage to OrderCommit. Splitting isolates all financial-staging risk into Part 2.

## Read First

- `context/reviews/pos-sales-redesign-planning.md`:
  - Piece 3 → "Left panel" → "**Configure album → modal (NEW placement)**"; "Album — in-card config (was: Album tab)":
    - **Field mapping:** cover material / thread / layout / cover text / cover image ref / instructions → **operational, live `OrderAlbum`** (this is Part 1). size → product swap → OrderCommit; pages-over-base → extra-pages add-on → OrderCommit (these are **Part 2**).
    - **Modal split:** **Specifications** (size, pages — priced) vs **Finishing** (operational, no price), with explicit copy ("size & pages stage for commit; finishing saves immediately"). Part 1 builds the **Finishing** section live; the Specifications section is **display-only** in Part 1 (current size + pages shown read-only; its edit controls arrive in Part 2).
    - **Add album** = standalone (add-on path → OrderCommit) — **Part 2**. **Bundled albums auto-derived from packages** — Part 1 displays whatever `OrderAlbum` rows exist.
    - Cover = **gradient placeholder + cover text + cover-image-ref text as the corner tag** (no real images).
  - Build order → "**B5 — Album in-card: configure-album modal in package card (handles 2 albums) + standalone album rows. (needs F1 + B2)**".
- `src/modules/albums/` (F1 — the API to consume):
  - `getOrderAlbums({ orderId })` → `OrderAlbumRow[]`. Fields: `id, orderId, orderPackageId, sourceType (PACKAGE|ADDON), backingLineKind, backingLineId, coverMaterial, threadColor, layout, coverText, coverImageRef, instructions, extraPages, createdAt, updatedAt`.
  - `updateOrderAlbumFinishing({ id, coverMaterial?, threadColor?, layout?, coverText?, coverImageRef?, instructions? })` → live operational write (all six are trimmed nullable text; `album.schema.ts`). **This is Part 1's only write.**
  - `ORDER_ALBUM_SOURCE_TYPE` (`PACKAGE` = bundled, lives under a package via `orderPackageId`; `ADDON` = standalone). `createOrderAlbum` / `buildExtraAlbumPageAddOnStagingChange` exist but are **Part 2**.
  - Only current consumer: `order-commit-execution.service.ts` → `syncOrderAlbumsAfterCommit` (materializes/reconciles albums at commit). Part 1 reads the rows that sync has materialized; it does **not** create or derive albums.
- `app/(app)/orders/[orderId]/sales/page.tsx` — where album data must be loaded/surfaced and passed to the cards (alongside the existing `getPOSWorkspace` / `getSalesPageView` reads). `actions.ts` — where the new finishing server action lives (mirror the existing sales action wiring: `ActorContext`, permission assert, `revalidate`).
- `src/components/orders/pos-package-composition.tsx` — `PackageCompositionCard` (B2): bundled-album display + "Configure album" action go in its body. `src/components/orders/pos-add-on-marketplace.tsx` — standalone albums render as rows here (or a sibling section), reusing B2 row styling.
- `context/architecture-context.md` / `context/code-standards.md` — module pattern, `ActorContext`, permission asserts, read-layer standards (projectors are pure; no `@/lib/db` in `app/**` or `src/components/**`). `context/ui-context.md` — tokens.

## Rules

- **Operational only. No OrderCommit / financial path in Part 1.** Part 1 reads albums and writes the six **finishing** fields via `updateOrderAlbumFinishing` (immediate, operational). It does **not**: create albums, change album size/product, change page count, stage anything, or touch `buildExtraAlbumPageAddOnStagingChange` / `createOrderAlbum` / the commit engine. Those are **Part 2**.
- **Reuse the F1 service; do not reimplement album logic.** All album reads/writes go through `src/modules/albums/` functions. No direct Prisma in components or page.
- **Display existing rows; do not derive.** Part 1 renders whatever `getOrderAlbums` returns (bundled albums materialized by post-commit sync + any standalone rows). It does not create or auto-derive albums — that is F1/commit behavior. If a package has no materialized album row, it simply shows no album block (acceptable for Part 1).
- **Finishing fields are free text** (the six nullable-text fields) — render as text inputs/areas; trim + nullable per the schema. No enums, no real image upload (cover image is a **text ref** only).
- **Specifications shown read-only in Part 1.** Display the album's current size/product label and page count (from existing data) as read-only, with copy signposting that editing size/pages arrives next — but do **not** wire any edit/staging control for them here.
- **Permission + activity.** The finishing server action must assert the appropriate actor permission (use the existing Sales/order edit permission the other sales actions use) and revalidate the Sales route. Record activity only if F1/the existing pattern does; do not invent a new activity kind.
- **Confined scope.** `app/(app)/orders/[orderId]/sales/` (page.tsx, actions.ts, a new modal/section component) + the two left-panel components (`pos-package-composition.tsx`, `pos-add-on-marketplace.tsx`) + a read-layer album surfacing for the Sales page. No engine, no financial-case, no schema, no projector-computation change. No B6 (notes) / B7 (tokens) work.
- Token-driven; reuse `Dialog`, `Button`, `Input`/`Textarea`, `Label`; no raw hex.

## Scope

### In Scope

1. **Album read surfacing for the Sales page:**
   - Load `getOrderAlbums({ orderId })` and shape it for the view: **bundled** albums grouped by `orderPackageId` (to render inside the matching package card) and **standalone** (`sourceType === ADDON`) albums as their own list. Surface via the Sales page read (load in `page.tsx` and pass down, or a thin read-layer album projection — keep it pure; prices are not computed here).

2. **Bundled-album display in the package card** (`PackageCompositionCard` body):
   - For each album belonging to the package, a compact album block: **cover placeholder** (gradient + `coverText` overlay + `coverImageRef` text as a corner tag), current **size/product** label + **page count** (read-only), and a finishing summary (e.g. material · thread · layout when set).
   - A **"Configure album"** action opening the album modal (Part 1 = Finishing editable, Specifications read-only). Handles a package with **two** albums (one block + trigger each).

3. **Standalone-album rows** (`pos-add-on-marketplace.tsx` or a sibling section):
   - `sourceType === ADDON` albums render as rows (B2 row styling) with a **"Configure"** button → the same modal.

4. **Album modal — Finishing (live) + Specifications (read-only):**
   - **Finishing section** (editable): `coverMaterial`, `threadColor`, `layout`, `coverText`, `coverImageRef`, `instructions` — text inputs, saved via the new finishing server action calling `updateOrderAlbumFinishing`. Immediate save (operational); explicit copy: "Finishing saves immediately." Reflect success/validation.
   - **Specifications section** (read-only in Part 1): current size/product + page count, with copy: "Size & pages stage for commit — editing them is coming next." No edit controls wired.

5. **Finishing server action** (`actions.ts`): wraps `updateOrderAlbumFinishing` with `ActorContext` + permission assert + Sales-route revalidate. No staging, no commit.

### Out of Scope (→ Part 2 / later)

- **Part 2:** extra pages (`buildExtraAlbumPageAddOnStagingChange` → staged), size/product swap (→ OrderCommit), **Add standalone album** (`createOrderAlbum` + add-on staging), and any OrderCommit-preview price impact for albums.
- **Part 2 backing migration:** when size/product swap is wired, it must migrate/dedup the existing logical `OrderAlbum` backing row from `PACKAGE_ITEM` to `ORDER_PACKAGE_ITEM_UPGRADE` across commits instead of leaving both rows visible for one album.
- No Sales/UI album creation or derivation, no schema change, no financial computation, no commit-engine financial/staging change. Commit-time `OrderAlbum` materialization is included only to make F1 album rows exist for display.
- **B6** (notes), **B7** (tokens). No change to the right column (B3 shipped) or photos (B4 shipped) beyond coexisting.

## Implementation Direction

Load `getOrderAlbums({ orderId })` in `page.tsx` (it's a server component already doing the order reads); partition into a `Map<orderPackageId, OrderAlbumRow[]>` for bundled and a `OrderAlbumRow[]` for standalone, and pass the relevant slice into each `PackageCompositionCard` and the standalone list. Keep this pure read shaping — no price math.

Add the album block + "Configure album" trigger inside `PackageCompositionCard`'s expanded body (it already has the package's `orderPackageId`). Render the cover as a token gradient with `coverText` overlaid and `coverImageRef` as a small corner tag (no `<img>`). For standalone albums, add rows in the add-on area with a "Configure" trigger.

The modal reuses the `Dialog` primitives already in these files. Its Finishing section is a small client form over the six text fields that submits to a new `updateOrderAlbumFinishingAction(orderId, input)` server action (in `actions.ts`) which asserts permission, calls `updateOrderAlbumFinishing`, and revalidates the Sales path. The Specifications section is static read-only text in Part 1. State the "saves immediately" vs "stages for commit (coming next)" distinction in copy so the two-phase behavior is clear to staff.

Minor label/placement choices are allowed UI assumptions — state them in the PR. Keep `development` shippable: Part 1 adds album visibility + finishing editing without removing or breaking anything; the priced controls simply aren't present yet.

The success bar for Part 1: albums show up on the Sales page (bundled in their package card, standalone as rows) with a cover placeholder and read-only size/pages, and "Configure album" opens a modal where editing the six finishing fields saves immediately via the F1 service — with no commit/staging anywhere.

## Post-Implementation

- Update `context/progress-tracker.md`: Feature History entry for Spec 177 (Sales album in-card Part 1 — read surfacing + display + live finishing; first F1 consumer; priced ops deferred to Part 2).
- In `context/reviews/pos-sales-redesign-planning.md`, note **B5 Part 1 shipped** (album read + finishing) and that **B5 Part 2** (priced: pages/size/add) + B6/B7 remain.

## Acceptance Criteria

- The Sales page reads albums via `getOrderAlbums` and renders them: **bundled** albums inside their package card, **standalone** albums as rows; each shows a cover placeholder (gradient + `coverText` + `coverImageRef` tag), read-only size/product + page count, and a finishing summary.
- A package with **two** albums shows both, each with its own Configure trigger.
- **"Configure album" / "Configure"** opens a modal whose **Finishing** section edits the six fields (`coverMaterial`, `threadColor`, `layout`, `coverText`, `coverImageRef`, `instructions`) and **saves immediately** via a new server action calling `updateOrderAlbumFinishing`; the **Specifications** section is **read-only** with copy signposting Part 2.
- **No priced/commit path:** no album creation, no size/page edit, no staging, no `buildExtraAlbumPageAddOnStagingChange`/`createOrderAlbum`/commit-engine use; the finishing action does not stage or commit.
- All album access goes through `src/modules/albums/`; no direct Prisma in `app/**`/`src/components/**`; the finishing action asserts permission and revalidates.
- Scope confined to the Sales route folder + the two left-panel components + read surfacing; token-driven, no raw hex; no schema/engine/financial change.
- `npm run build` passes. `npm run lint` passes. Existing Sales mount/source guard stays green.
