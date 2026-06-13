## Goal

Make the album **Specifications** editable — Phase 7 / POS Sales redesign Piece 3, build-order item **B5, Part 2 (priced half)**. Part 1 (Spec 177) surfaced albums and made **finishing** editable live, leaving the **Specifications** section (size, pages) **read-only**. Part 2 wires those priced edits — **extra pages**, **size/product swap**, and **Add standalone album** — each through the **existing** OrderCommit staging paths (no new engine work, no new line kinds). After Part 2, the album modal is fully functional: finishing saves immediately (Part 1), size & pages **stage for commit** (Part 2), and the receipt + financial cards (B3) reflect the staged price impact automatically via the existing preview.

## Read First

- `context/reviews/pos-sales-redesign-planning.md` — "Album — in-card config":
  - **Field mapping:** size → **product swap** → OrderCommit; pages-over-base → **flat per-page extra-pages add-on** → OrderCommit (one global "Extra album page" product). These are Part 2.
  - **Modal split:** Specifications (size, pages — priced; **price impact from `OrderCommitPreview`**) vs Finishing (Part 1). Copy "size & pages stage for commit" becomes **active** in Part 2.
  - **"Size change explicit"** ("Change album product / size"). **"One album = one line"** (size is the product line; extra pages is the single quantity add-on; no per-option lines).
  - **Add album = standalone** (add-on path → OrderCommit); **bundled albums auto-derived** (now materialized at commit by **B5 Part 0**).
  - **Finishing = live write decision (recorded 2026-06-13)** — unchanged; Part 2 only touches the priced Specifications.
- `src/modules/albums/` (F1):
  - `buildExtraAlbumPageAddOnStagingChange({ snapshot, orderAlbum: { id?, orderPackageId, sourceType }, requestedExtraPages })` → returns an **`ADD_ON` staging change** (ADD / UPDATE_QUANTITY / REMOVE) for the `addon-extra-album-page` product, scoped to the album's package (`parentPackageTarget` when `sourceType === PACKAGE`). Returns `null` when no change is needed. **This is the extra-pages mechanism — reuse it; do not hand-roll page staging.**
  - `createOrderAlbum({ orderId, orderPackageId?, sourceType, backingLineKind, backingLineId })` → idempotent create; supports a `draft:`-prefixed `backingLineId` (remapped at commit by `syncOrderAlbumsAfterCommit`, per F1 A-2) so a just-added standalone album is configurable **before** commit.
  - `EXTRA_ALBUM_PAGE_PRODUCT_ID = "addon-extra-album-page"`, `ORDER_ALBUM_SOURCE_TYPE`, `ORDER_ALBUM_BACKING_LINE_KIND`.
- Existing staging machinery to **reuse** (Part 2 surfaces these from the album modal — it does **not** invent new staging):
  - `stageSalesChangeAction(orderId, expectedVersion, change)` (`app/(app)/orders/[orderId]/sales/actions.ts`) — stages an OrderCommit draft change.
  - Add-on handlers (`POSAddOnHandlers`): `addAddOn`, `removeAddOn`, `changeAddOnQuantity?` — for standalone album size (remove old album add-on + add new album product) and Add-album.
  - `handlers.upgradePackageItem` (the existing `ItemUpgradeDialog` path in `pos-package-composition.tsx`) — for **bundled** album size (swap the album `PackageItem`/`OrderPackageItemUpgrade` to a different album product). This is the same mechanism behind the "Upgrade / Replace" controls already on the album deliverable line.
- Spec 177 (`context/feature-specs/177-sales-album-in-card-read-finishing.md`) — the album modal + Specifications section (currently read-only) that Part 2 makes editable; the album read surfacing and `SalesAlbumView` shape.
- B5 **Part 0** (album materialization at commit) — must be merged first, so albums exist to configure.
- `context/architecture-context.md` / `context/code-standards.md` — read-layer + "no new financial line kind", "don't reopen the financial engine" (Specs 120–151). `context/ui-context.md` — tokens.

## Rules

- **Stage through existing paths only. No new financial line kind, no engine change.** Extra pages → the `addon-extra-album-page` `ADD_ON` line via `buildExtraAlbumPageAddOnStagingChange`. Size → product swap via the existing item-upgrade (bundled) or add-on remove+add (standalone). Add album → existing `addAddOn`. The OrderCommit engine still only sees `ADD_ON` / `PACKAGE_ITEM_UPGRADE`; it never learns "album."
- **Never recompute price.** The staged change flows through `OrderCommitPreview` → the existing receipt + financial cards (B3) update on their own. Part 2 does **not** compute album price deltas, totals, or "after commit" numbers in the UI — it stages a change and lets the preview/projectors do the math.
- **Reuse the F1 helper for pages.** Build the page-staging change with `buildExtraAlbumPageAddOnStagingChange` (it already handles ADD/UPDATE_QUANTITY/REMOVE and package scoping); do not construct extra-page add-on changes by hand.
- **Specifications priced; finishing unchanged.** Part 2 only makes the Specifications section editable and adds the Add-album affordance. The Part 1 finishing form (live write) is untouched. The "size & pages stage for commit; finishing saves immediately" copy now reflects both halves being active.
- **Respect ownership/lock/policy.** Priced album edits stage like any other sales change — gate them with the same draft-ownership / lock / edit-mode policy the composition uses (so they're disabled when the order is locked or the draft is owned by someone else), and carry `expectedVersion` like the other staging calls.
- **Confined scope.** Sales route folder (`page.tsx`, `actions.ts`, the album modal/components) + the album modal component from Part 1 + the two left-panel components. May add a thin server action for extra-pages staging (loads the current snapshot, calls the helper, stages). No schema change, no new line kind, no financial-case/engine change, no projector recomputation.
- Token-driven; reuse `Dialog`, `Button`, `Input`, `Select` (for size options), existing item-upgrade/add-on UI patterns; no raw hex.

## Scope

### In Scope

1. **Extra pages (Specifications):**
   - A page-count control in the modal's Specifications section. On change, stage via a server action that loads the current draft/committed snapshot, calls `buildExtraAlbumPageAddOnStagingChange({ snapshot, orderAlbum: { id, orderPackageId, sourceType }, requestedExtraPages })`, and stages the returned change with `stageSalesChangeAction` (skip when it returns `null`). Carry `expectedVersion`.
   - The new/updated/removed `addon-extra-album-page` line then appears in the staged changes / receipt / financial via the existing preview — no UI price math.

2. **Size / product swap (Specifications):**
   - **"Change album product / size"** control listing the album-product size options.
   - **Bundled album** (`backingLineKind` PACKAGE_ITEM / ORDER_PACKAGE_ITEM_UPGRADE): stage via the existing `upgradePackageItem` path, targeting the album's backing package item — same mechanism as the existing Upgrade/Replace on the deliverable line, surfaced here scoped to the album.
   - **Standalone album** (`backingLineKind` ORDER_ADD_ON): stage `removeAddOn` (current album add-on) + `addAddOn` (new album product) — there is no swap handler, so it's remove-old + add-new. Keep the album's `OrderAlbum` finishing intact across the swap (the operational row persists; only the backing line changes, reconciled at commit per Part 0/F1 A-2).

3. **Add standalone album:**
   - An **"Add album"** affordance (the existing Commercial-Actions / marketplace entry, or a dedicated control) stages adding an album product as an order-level `addAddOn`. To make it **configurable before commit**, also `createOrderAlbum` with `sourceType: ADDON` and a `draft:`-prefixed `backingLineId` (remapped at commit) so the new album shows a Configure modal immediately; otherwise it materializes at commit (Part 0). Pick one and state it in the PR — prefer immediate createOrderAlbum-with-draft-backing for in-card config parity.

4. **Activate Specifications copy:** flip the Part 1 "editing comes next" signposting to the active "size & pages stage for commit" behavior; finishing copy unchanged.

### Out of Scope

- Part 1 finishing (done), B6 notes, B7 tokens. No right-column/receipt/financial code change (they react via existing preview).
- No new financial line kind, no album price catalog/option-deltas (rejected in F1 Locked Decision #4), no engine/financial-case change, no schema change, no UI price recomputation.
- **Upgrade-transition album dedup** (base-item album row → upgrade-backed row across commits): Part 2 owns this **only** to the extent its size-swap creates it — when swapping a bundled album's backing line, ensure the existing `OrderAlbum` row follows the new backing line rather than orphaning (migrate the row / let F1 reconcile), and do not leave two rows for one album. (This pairs with the Part 0 caveat.)

## Implementation Direction

Most of Part 2 is wiring controls in the Specifications section to existing staging. For **pages**, add a small server action (e.g. `stageAlbumExtraPagesAction(orderId, expectedVersion, { albumId, orderPackageId, sourceType, requestedExtraPages })`) that loads the current snapshot (same source the page already has — draft `pendingSnapshot` or committed), calls `buildExtraAlbumPageAddOnStagingChange`, and stages the result via the existing staging pipeline; return the standard action-state. Keep the snapshot handling server-side — don't ship the whole snapshot to the client.

For **size**, branch on `backingLineKind`: bundled → reuse the `upgradePackageItem` handler/dialog wiring scoped to the album's package item; standalone → sequence `removeAddOn(currentAlbumAddOn)` + `addAddOn(newAlbumProduct)`. Ensure the album's operational `OrderAlbum` row is preserved/migrated to the new backing line so finishing isn't lost and no duplicate album row results (coordinate with Part 0's materialization + F1's commit reconcile).

For **Add album**, reuse `addAddOn` for the priced line; optionally `createOrderAlbum` with a `draft:` backing id so it's configurable pre-commit (F1 supports the draft→materialized remap at commit).

Let the **preview do all the math** — once a change is staged, the B3 receipt/financial cards already recompute from `composition`/`financialPreview`. Verify the album price delta shows up there with no new UI calculation. Gate every priced control with the same ownership/lock/edit-mode policy the composition uses, and pass `expectedVersion`. Minor label/placement choices are allowed UI assumptions — state them in the PR.

The success bar for Part 2: from the album modal you can change page count and album size, and add a standalone album; each stages an OrderCommit change through the existing paths; the receipt + financial cards reflect the price impact automatically; finishing still saves live; and no new line kind or engine change is introduced.

## Post-Implementation

- Update `context/progress-tracker.md`: Feature History entry for Spec 178 (album Specifications priced — extra pages + size swap + Add album, all via existing staging; completes B5).
- In `context/reviews/pos-sales-redesign-planning.md`, mark **B5 complete** (Parts 0/1/2) and leave B6 (notes) + B7 (tokens).

## Acceptance Criteria

- The album modal's **Specifications** section is **editable**: page count and album size/product can be changed, and the "size & pages stage for commit" copy is active; finishing still saves immediately (Part 1 unchanged).
- **Extra pages** stage via `buildExtraAlbumPageAddOnStagingChange` + `stageSalesChangeAction` (ADD/UPDATE_QUANTITY/REMOVE handled by the helper; no hand-rolled page staging); skipped when the helper returns `null`.
- **Size swap** stages via the existing paths — bundled via `upgradePackageItem`, standalone via `removeAddOn`+`addAddOn`; the album's `OrderAlbum` finishing persists across the swap with no duplicate/orphaned row.
- **Add standalone album** stages an album-product `addAddOn` and yields a configurable album (immediate via `createOrderAlbum` draft-backing, or at commit via Part 0).
- **No price math in the UI and no engine change:** staged album changes flow through `OrderCommitPreview` to the existing receipt + financial cards; no new financial line kind, no album price catalog, no schema/financial-case/engine change; the engine still sees only `ADD_ON`/`PACKAGE_ITEM_UPGRADE`.
- Priced controls respect ownership/lock/edit-mode policy and carry `expectedVersion`, like other sales staging.
- Scope confined to the Sales route folder + album modal/left-panel components; no `@/lib/db` under `app/**`/`src/components/**`; tokens/primitives reused, no raw hex.
- `npm run build`, `npm run lint`, and `npm run test:centralization` pass; existing Sales mount/source guard stays green.
