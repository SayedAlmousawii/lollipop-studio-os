## Goal

Add the `OrderAlbum` operational domain — Phase 7 / POS Sales redesign Piece 1, build-order item **F1**. This is a backend-only foundation: a new entity that records album configuration metadata (size/pages/operational fields) for package-included and standalone albums, the global "Extra album page" add-on product, and the service layer to create/read/update `OrderAlbum` rows and keep their backing-line references correct across `commitOrderChanges`. No UI in this spec — Spec B5 (Album in-card config) consumes this domain later.

## Read First

- `context/reviews/pos-sales-redesign-planning.md` — Piece 1 (Albums): Locked Decisions 1–6 and Open Items A-1 through A-5. This spec implements A-1 through A-4; A-5 (multi-album-per-package UI disambiguation) is explicitly deferred to B5.
- `src/modules/order-commits/order-commit-add-on-reducer.ts` — the existing `ADD_ON` staging reducer (ADD / UPDATE_QUANTITY / REMOVE) this domain rides on for extra-pages changes. Read this to understand the `OrderCommitDraftStagingChange` shape for the `ADD_ON` domain and how `draftOrderAddOnId` / quantity work.
- `src/modules/order-commits/order-commit-materialization.service.ts` and `src/modules/order-commits/order-commit-execution.service.ts` — how `commitOrderChanges` builds `draftToOrderEntityMap` (draft id → materialized `Order*` row id) and remaps snapshot lines (`remapMaterializedSessionConfigurationSnapshot`) inside the commit transaction. `OrderAlbum.backingLineId` needs the same remap treatment.
- `src/modules/order-commits/order-commit.constants.ts` — `ORDER_COMMIT_ORDER_ENTITY_KIND` / snapshot line-kind constant pattern; mirror this style for the new `OrderAlbumBackingLineKind` enum.
- `prisma/seed.ts` lines ~600–666 — existing "Album 20x20" / "Album 30x30" `Product` seed rows (category `ALBUM`, `isAddOn: true`, `isPackageDeliverable: false`); follow this pattern for the new "Extra album page" product.

## Rules

- **No new financial line kind.** OrderCommit/`commitOrderChanges` must remain unaware of the word "album." `OrderAlbum` carries no price and is never read by the financial engine, preview, or diff services (Locked Decision 3).
- **Cosmetic/operational fields are live writes.** `coverMaterial`, `threadColor`, `layout`, `coverText`, `coverImageRef`, `instructions` write directly to `OrderAlbum` — no `OrderCommitDraft`, no draft guard, no audit log. They are out-of-snapshot, non-financial operational metadata (Open Item A-3). Do not add `assertNoActiveOrderCommitDraft` (or any equivalent) to these writes.
- **Size and extra-pages changes ride existing staging — do not add new domains.** Album size = swap the underlying package/add-on line via the already-built `PACKAGE` / `ADD_ON` staging (no new work). Extra pages = a quantity change on a single "Extra album page" `ADD_ON` line, using the existing add-on reducer. This spec adds a small pure helper that builds that staging change; it does not add a reducer, snapshot line kind, or staging domain.
- **"One album = one line."** Never create separate add-on lines per option (no "+Cover", "+Thread" lines). The "Extra album page" line is the single quantity-based line covering all extra pages for the album it is scoped to.
- **A-1 is already resolved — no catalog cleanup needed.** Investigation during planning found no album size/upgrade modeled as a `LINKED_PRODUCT` session configuration anywhere in `prisma/seed.ts` or `src/modules/session-configurations/`. Do not search for or retire anything here.
- Follow `context/code-standards.md` module file pattern: new module `src/modules/albums/` with `album.service.ts`, `album.schema.ts`, `album.types.ts`, `album.constants.ts`. Zod-validate all service inputs. No `@/lib/db` imports outside `src/modules/**` / `src/lib/**` / `tests/**`.

## Scope

### In Scope

1. **Schema** (`prisma/schema.prisma`):
   - New enum `OrderAlbumSourceType`: `PACKAGE | ADDON` — whether the album arrived via a package (bundled) or as an order-level add-on (standalone).
   - New enum `OrderAlbumBackingLineKind`: `PACKAGE_ITEM | ORDER_PACKAGE_ITEM_UPGRADE | ORDER_ADD_ON` — which table `backingLineId` points into. `PACKAGE_ITEM` = catalog package-included album item (no upgrade yet); `ORDER_PACKAGE_ITEM_UPGRADE` = the album size has been upgraded within a package; `ORDER_ADD_ON` = a standalone or order-level add-on album.
   - New model `OrderAlbum`:
     - `id`, `orderId` (→ `Order`, cascade)
     - `orderPackageId` (nullable → `OrderPackage`, cascade) — set when `sourceType = PACKAGE`, identifies which package the album belongs to; null for `ADDON`.
     - `sourceType: OrderAlbumSourceType`
     - `backingLineKind: OrderAlbumBackingLineKind`, `backingLineId: String` — the size-bearing line, **not** FK-constrained (it is polymorphic across `PackageItem` / `OrderPackageItemUpgrade` / `OrderAddOn`, mirroring how `OrderCommitSnapshotLineV1.orderEntityId` is an unconstrained reference).
     - `coverMaterial`, `threadColor`, `layout`, `coverText`, `coverImageRef`, `instructions` — all nullable `String`, operational only.
     - `extraPages: Int @default(0)` — display cache only; refreshed from the committed snapshot (see Implementation Direction). Never written by the operational/finishing service path.
     - `createdAt` / `updatedAt`.
     - Indexes on `orderId` and `orderPackageId`.
     - `@@unique([orderId, orderPackageId, backingLineKind, backingLineId])` — the album identity tuple (see `createOrderAlbum` idempotency below). Must include `orderPackageId` because a `PACKAGE_ITEM`-kind `backingLineId` is a catalog `PackageItem.id` that is **not** unique across two `OrderPackage`s in the same order; without the package scope two legitimately distinct bundled albums would collide. `orderPackageId` is nullable (`ADDON` albums) — that is fine for the composite unique.
   - Add the inverse relations: `albums OrderAlbum[]` on `Order` and on `OrderPackage`.
   - Generate the migration.

2. **Seed**: add one global "Extra album page" `Product` row following the existing album-product upsert pattern (~line 600–666): `category: ALBUM`, `isAddOn: true`, `isPackageDeliverable: false`, `isActive: true`, a placeholder flat `canonicalPrice` (pick a small round number, e.g. `1`), and a code-comment flagging the price as **owner-confirm-pending** (Open Item A-4 — the actual per-page price needs business sign-off, but a placeholder unblocks the domain). Give it a stable seed id (e.g. `addon-extra-album-page`) and export its id as a constant (see below) so service code never hardcodes the literal string in more than one place.

3. **New module `src/modules/albums/`**:
   - `album.constants.ts` — `ORDER_ALBUM_SOURCE_TYPE`, `ORDER_ALBUM_BACKING_LINE_KIND` constant objects (mirroring the `as const` status pattern in `code-standards.md` §5), and `EXTRA_ALBUM_PAGE_PRODUCT_ID` (the seed id from step 2).
   - `album.types.ts` / `album.schema.ts` — Zod schemas + inferred types for: creating an `OrderAlbum` row, updating the finishing/operational fields, and the extra-pages staging-change input.
   - `album.service.ts`:
     - `getOrderAlbums({ orderId })` — returns all `OrderAlbum` rows for an order (raw fields; no projector needed yet — B5/B7 will build surface projectors).
     - `createOrderAlbum(input)` — creates an `OrderAlbum` row given `orderId`, `sourceType`, optional `orderPackageId`, `backingLineKind`, `backingLineId`. Used when staff first opens "Configure album" for a line that has no `OrderAlbum` row yet (idempotent on the full identity tuple `(orderId, orderPackageId, backingLineKind, backingLineId)`: if a row already exists, return it rather than duplicating). The `@@unique` above enforces this at the DB level so concurrent first-opens cannot race two rows in.
     - `updateOrderAlbumFinishing(input)` — live write of the six operational fields by `OrderAlbum.id`. No draft guard, no `OrderCommitDraft` interaction.
     - `buildExtraAlbumPageAddOnStagingChange(input)` — **pure** function (no DB access) that, given an `OrderCommitSnapshotV1`, an `OrderAlbum` (or its `orderPackageId`/scope), and a requested `extraPages` count, returns the `ADD_ON` `OrderCommitDraftStagingChange` (`ADD` / `UPDATE_QUANTITY` / `REMOVE`, per the existing reducer's action shape) needed to make the "Extra album page" line's quantity match the requested count for that scope. Returns `null` if no change is needed (already at the requested count). For the `ADD` branch it must generate a `draft:`-prefixed `draftOrderAddOnId` (the staging schema enforces `.startsWith("draft:")`; a bare id fails validation). This is the helper a future B5 staging action will call before passing the change to `stageOrderCommitDraftChange`.

4. **Commit-time backing-line remap and extraPages refresh (Open Item A-2)**:
   - Inside `commitOrderChanges`'s transaction (in `order-commit-execution.service.ts`, after `materializeOrderCommitDraftIntoOrderRows` produces `draftToOrderEntityMap` and the committed snapshot is finalized), add a step that loads all `OrderAlbum` rows for the order and:
     - For any row whose `backingLineId` is a `draft:`-prefixed id present in `draftToOrderEntityMap`, rewrite `backingLineId` to the materialized id.
     - For any row whose `backingLineId` is a `draft:`-prefixed id **not** present in the map (its backing line was removed during this draft), leave `backingLineId` unchanged — do not throw. `OrderAlbum` is non-financial metadata and must never fail or block a commit.
     - Refresh `extraPages` on each row from the committed snapshot: find the "Extra album page" `ADD_ON` line scoped to the same package (or order-level for `sourceType = ADDON`) and set `extraPages` to its `quantity` (0 if no such line exists). Add a code comment noting this scopes by `parentOrderPackageId` only, so a package holding **two** albums (the deferred A-5 case) would write the same package-level page count onto both rows — per-album page attribution is B5's problem when it supports 2 albums per package. Single-album behavior (F1 scope) is correct as-is.
   - This logic should live in `src/modules/albums/album.service.ts` as a small exported function (e.g. `syncOrderAlbumsAfterCommit`) that `order-commit-execution.service.ts` calls — keep `OrderAlbum` writes inside the albums module per module-ownership rules, but call it from the commit transaction so it stays atomic.

### Out of Scope

- No UI of any kind (B5 — Album in-card config, depends on F1 + B2).
- No new `OrderCommitSnapshotLineV1` line kind, reducer, or staging domain.
- No multi-album-per-package UI disambiguation (Open Item A-5 — deferred to B5).
- No Notes domain (F2) or sidebar collapse (F3) — separate specs.
- No changes to the existing "Album 20x20" / "Album 30x30" product rows or pricing.
- No wiring of `buildExtraAlbumPageAddOnStagingChange` into an actual server action — that lands with B5.

## Implementation Direction

Add the schema first (enums + `OrderAlbum` model + relations + migration), then the seed product, then the `src/modules/albums/` module. The service functions are intentionally small and independent: `getOrderAlbums` / `createOrderAlbum` / `updateOrderAlbumFinishing` are plain Prisma CRUD with Zod-validated inputs and no interaction with `OrderCommitDraft` at all — there is nothing to guard because this table did not exist before and no existing guard touches it.

For `buildExtraAlbumPageAddOnStagingChange`, follow the shape of the `ADD_ON` staging changes consumed by `reduceOrderCommitDraftAddOn` — look at how Spec 138's marketplace add/remove handlers and `order-commit-add-on-reducer.ts` construct `{ domain: "ADD_ON", action: "ADD" | "UPDATE_QUANTITY" | "REMOVE", ... }` payloads, including `draftOrderAddOnId` generation for new lines and `target` resolution for existing lines. The helper should search the given snapshot for an existing "Extra album page" `ADD_ON` line scoped to the album's package (`parentOrderPackageId` matching `OrderAlbum.orderPackageId`, or `null` for order-level standalone albums) and decide ADD (none exists, requested > 0) / UPDATE_QUANTITY (exists, requested differs and > 0) / REMOVE (exists, requested = 0) / no-op (exists, requested matches, or none exists and requested = 0).

For the commit-time remap/refresh step, follow the existing pattern in `order-commit-execution.service.ts` where `draftToOrderEntityMap` is produced and `remapMaterializedSessionConfigurationSnapshot` is called on the committed snapshot — add the `OrderAlbum` sync call alongside that, after the committed snapshot is finalized (so the "Extra album page" line's final quantity is known) and before/within the same transaction as the rest of materialization. Use the transaction client (`tx`) already threaded through that function rather than the shared `db` client.

## Post-Implementation

- Update `context/progress-tracker.md`: add a Feature History entry for Spec 169, and a note under "POS / orders / composition" Key State that the `OrderAlbum` operational domain exists (no price, live finishing writes, size/pages ride existing staging, backing-line remapped on commit).
- In `context/reviews/pos-sales-redesign-planning.md`, mark Piece 1 Open Items A-1 through A-4 as resolved/closed by Spec 169 (A-5 remains open for B5).

## Acceptance Criteria

- `OrderAlbum` model + `OrderAlbumSourceType` + `OrderAlbumBackingLineKind` enums exist in `prisma/schema.prisma` with a generated migration; `Order` and `OrderPackage` expose `albums OrderAlbum[]`.
- A global "Extra album page" `Product` row is seeded (category `ALBUM`, `isAddOn: true`, `isPackageDeliverable: false`) with its id exported as `EXTRA_ALBUM_PAGE_PRODUCT_ID`.
- `src/modules/albums/album.service.ts` exposes `getOrderAlbums`, `createOrderAlbum` (idempotent on `(orderId, orderPackageId, backingLineKind, backingLineId)`), `updateOrderAlbumFinishing`, `buildExtraAlbumPageAddOnStagingChange`, and `syncOrderAlbumsAfterCommit`, all Zod-validated.
- `updateOrderAlbumFinishing` performs a live write with no `OrderCommitDraft` interaction and is unaffected by an active draft.
- `commitOrderChanges` calls `syncOrderAlbumsAfterCommit` inside its transaction: draft-id `backingLineId`s present in `draftToOrderEntityMap` are remapped to materialized ids, missing-from-map draft ids are left unchanged without throwing, and `extraPages` is refreshed from the committed snapshot's matching "Extra album page" line quantity.
- `buildExtraAlbumPageAddOnStagingChange` returns `null` when no change is needed and otherwise returns a valid `ADD_ON` `OrderCommitDraftStagingChange` matching the existing reducer's expected shape for ADD / UPDATE_QUANTITY / REMOVE.
- New tests cover: `OrderAlbum` CRUD + idempotent create, the staging-change helper's ADD/UPDATE_QUANTITY/REMOVE/no-op branches, and an OrderCommit execution test proving backing-line remap + `extraPages` refresh on commit (including the "removed during draft" no-throw case).
- `npm run build` passes.
- `npm run lint` passes.
