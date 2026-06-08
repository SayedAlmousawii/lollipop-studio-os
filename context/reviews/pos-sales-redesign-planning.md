# POS Sales Redesign — Planning Doc

> ⚠️ **UNDER REVISION (2026-06-07).** Owner requested major changes; **Piece 3 has been rewritten** for a **single-view (no-tabs)** direction. Pieces 1–2 (Album / Notes backend domains) **carry over**. Several Piece 3 details are still open (see Piece 3 → Open Items). **Do not draft specs or implement** until those close and this banner is lifted.

**Status:** Planning in progress — **owner-driven revision underway** (single-view direction). No specs drafted yet.
**Started:** 2026-06-07
**Context:** Phase 7 of `unified-order-commit-live-pos-roadmap.md` (polish/redesign). Driven by the Claude-Design mockup handoff in `context/pos-redesign-handoff/`.

## Purpose

Capture the planning thread for the Sales page redesign so decisions are not lost between sessions. The mockup is used for **UI/layout/style only** — its operational/financial mental model is ignored (it was generated from a few context sentences and is not accurate). Each piece gets its own section with **Locked Decisions** and **Open Items**.

## Guiding constraints (carried from the roadmap)

- Canonical sources unchanged: `Order*` rows, `OrderCommitDraft.pendingSnapshotJson`, `OrderCommitPreview`, `FinancialCaseSummary`.
- Projector rule holds: UI never recomputes financial deltas, approval, refund, document plans, ownership, or workflow state.
- **Do not reopen the OrderCommit financial engine** (Specs 120–151). New surfaces ride existing line kinds; no new financial line type.
- Dev environments reset between specs; production has no order data → migration burden is effectively nil.

## Direction (owner-revised 2026-06-07)

Lean toward our **current** design; borrow selectively from the mockup. **No tabs.** One continuous Sales view:

- **Left:** an editable **composition panel** — collapsible rows for packages and add-ons (incl. standalone albums), with photos and album configured **in-card via modals**, plus a dashed "+ add another…" CTA.
- **Right:** two **read-only glance cards** — a live **Order summary ("customer receipt")** and a **simplified Financial summary**.
- **Shell:** fixed, with only the panel(s) scrolling (no whole-page scroll).

**Emerging interaction pattern:** *every row is a collapsible row* — some expand to reveal info/actions, some don't. Becoming the app-wide standard; specifics TBD as we build.

## Mockup → adopt inventory (UI/layout only)

| Area | Adopt |
|---|---|
| Shell | Fixed shell, partial scroll (only panel scrolls); sidebar collapse toggle (deferred polish) |
| Style | Visual language + component kit (cards, rows, badges, chips, buttons). Use our tokens; tweak toward the mockup only where clearly better. |
| Composition | Collapsible package/add-on **rows** in one scrollable area; expand-to-edit; dashed "+ add another…" CTA |
| Photos | Per-package **photo summary in the package card → modal** to edit count + digital/print/split extras |
| Album | **In-card / in-row** "Configure album" → modal (no tab) |
| Notes | **Add-note → modal** (no tab); notes also render on order-details |
| Right column | Live **Order summary (receipt)** card + **simplified Financial summary** card (replaces staged-changes delta rail) |

---

## Piece 1 — Albums

### Background (current reality)

- There is **no album entity** today. "Album" is `ProductCategory.ALBUM` — albums are **Products**.
- Albums reach an order through existing billing paths only:
  - **Package-included** → `PackageItem` (changed at order time → `OrderPackageItemUpgrade`).
  - **Standalone** → `OrderAddOn` (order-level, per Spec 138).
  - **Config-driven upgrade** → `LINKED_PRODUCT` session config → `OrderAddOn`.
- Album **pricing already exists**. What's missing is album **configuration** (cover material, page count, thread, cover image, cover text, layout, instructions).
- Both backing lines carry their own `priceSnapshot` + `nameSnapshot`, independent of `Product.canonicalPrice` (confirmed in schema).
- Production already tracks an `albumDesignStatus` flag on the order (knows album work exists, not what the album is).

### Business input (from owner, 2026-06-07)

- The **only** financially-impacting album options are:
  - **Album size** — already modeled as a separate album `Product` per size.
  - **Extra pages** — **flat price per page**, needs a lightweight solution.
- Everything else (cover material, thread, layout, cover image, cover text, instructions) has **no price impact** → operational/cosmetic.

### Locked Decisions

1. **Albums are a first-class operational domain**, not session configs. No session-config category dimension is added; session configuration stays generic and unchanged.
2. **New `OrderAlbum` entity — operational only, carries no price.** Fields:
   - `id`, `orderId`
   - `sourceType`: `PACKAGE | ADDON`
   - reference to the size-bearing album product line (the `OrderAddOn` / `PackageItem` / `OrderPackageItemUpgrade`)
   - `coverMaterial`, `threadColor`, `layout`, `coverText`, `instructions`
   - `coverImageRef` — **simple free-text** (employee types e.g. "img-001"); not tied to photo-ID selection
   - `extraPages` — display count only; the money lives on the add-on line
   - timestamps
3. **Album rides existing financial line kinds. No new financial line type.** OrderCommit keeps seeing only `ADD_ON` and `PACKAGE_ITEM_UPGRADE`. The financial engine never learns the word "album."
   - **Album size** → existing album `Product` per size (`OrderAddOn` standalone / `PackageItem` or `OrderPackageItemUpgrade` bundled). **No new work.**
   - **Extra pages** → an `OrderAddOn` line: product = "Extra album page", `quantity` = number of extra pages, flat `priceSnapshot`. Reuses Spec 138 quantity-based add-on staging. One global "Extra album page" product (flat per-page price).
4. **No album-option pricing catalog, no option-delta system, no reducer changes.** The earlier "re-price the album line by option deltas" model is rejected as over-complex for actual business need.
5. **Album service split:**
   - Cosmetic/operational field edits → write `OrderAlbum` **live** (no OrderCommit).
   - Size change → existing product add/swap staging → OrderCommit.
   - Extra-pages change → `ADD_ON` quantity staging → OrderCommit.
6. **"One album = one line."** Options do not become separate add-on lines (no "+Cover", "+Pages" lines). Size is the product line; extra pages is the single quantity add-on line; everything else is operational metadata.

### Open Items

- **A-1 (catalog check):** Confirm no album size/upgrade currently lives as a `LINKED_PRODUCT` session config in catalog/seed. If it does, retire it so there's one source of truth. (Data/catalog change, not code.)
- **A-2 (commit remap):** `OrderAlbum`'s backing-line reference must remap `draft:` → materialized id on commit (the Spec 138/143 pattern).
- **A-3 (draft guard):** Operational `OrderAlbum` writes are exempt from the Spec 135 active-draft guard (out-of-snapshot, non-financial) — confirm safe.
- **A-4 (extra-page product):** Create the single global "Extra album page" product (flat price) — confirm category/flags and price value with owner.
- **A-5 (in-card presentation):** Decide how album config is presented **in the package card** (bundled, possibly **two** albums → configs for both) vs a **standalone album row** (own row → Configure button). Same modal in both.

---

## Piece 2 — Notes

**Status:** Scoped (2026-06-07). UI home revised to **modal + order-details display** (no Notes tab).

### Background (current reality)

- **No `Note` model exists.** Notes today are scattered single `notes String?` free-text fields on many rows: `Order.notes`, `OrderAddOn.notes`, `OrderPackageItemUpgrade.notes`, `EditingJob.notes`, `ProductionJob.notes`, a delivery pickup-notes field, plus booking/customer/invoice/payment ones. `OrderPackage` itself has no note field.
- An `OrderActivity` append-only log exists with a `NOTE_ADDED` type (audit history, not editable notes).
- The mockup's "multiple typed, authored, timestamped notes" is net-new.

### Locked Decisions

1. **Purpose-typed order note system** — a first-class `Note` domain, not `TEXT` session configs, not one giant textarea.
2. **Six kinds:** `CUSTOMER · PHOTOGRAPHER · EDITING · PRODUCTION · DELIVERY · INTERNAL`. No catch-all "general."
3. **Freeform operational annotations only.** Notes do **not** store financial events, package changes, album option changes, commit history, discounts, approvals, or audit events. Those live in OrderCommit history / FinancialCase history / `AuditLog`.
4. **Album specs stay structured on `OrderAlbum`.** Production Notes = freeform print/production remainder only (print sizing, finishing, special handling) — **not** album cover text / material / layout (those are `OrderAlbum` fields). No double-entry.
5. **`Note` model** — order-anchored, optional package scope, non-financial:
   ```
   Note
   - id
   - orderId          (required — the anchor)
   - orderPackageId   (nullable — set = package-scoped, null = order-level)
   - kind             CUSTOMER | PHOTOGRAPHER | EDITING | PRODUCTION | DELIVERY | INTERNAL
   - body             text
   - authorUserId     (nullable — null = customer-relayed, typed by staff)
   - createdAt / updatedAt
   ```
6. **Non-financial → live writes, never through OrderCommit.**
7. **Existing stage-specific note fields coexist for now** (`EditingJob.notes`, `ProductionJob.notes`, delivery notes, `Order.notes`). Not absorbed in this pass.
8. **New `Note` records are editable** (working annotations; the audit log owns immutable history).
9. **Adding a note emits a `NOTE_ADDED` `OrderActivity`** for timeline visibility.
10. **UX — add-note modal (no tab, no fixed sections).** An **"Add note"** action opens a **modal** (pick kind + body + optional applies-to-package selector; order-level default). Both order-level and per-package add-note exist; **exact placement TBD**. New notes **also render on the order-details page** (shared infrastructure). Where notes are *displayed within the Sales view* is TBD (see Piece 3 open items).

### Future Direction (intent, not this pass)

- **Single shared note across surfaces:** EDITING / PRODUCTION / DELIVERY (and peers) notes should eventually be **one shared record** between the Sales surface and the order-details workflow tabs — the same note the editor/producer sees is the one written in Sales.
- **Near-term bridge:** even before full absorption, surface the new typed `Note` records (read-only is fine) on the order-details page / workflow tabs.
- **Later:** absorb the existing stage-specific note fields into the `Note` system as the single source of truth.

### Foundational-correctness requirement (build right from v1)

The v1 Notes build **must** be structured so migrating to the shared-note future direction is trivial — no rework of the data model or service:

- The `Note` entity and its service are **shared, surface-agnostic infrastructure** from day one — owned by a Notes module, **not** by the Sales page. The Sales surface is just the first consumer.
- Notes are queryable by `(orderId, kind, orderPackageId)` so any surface (Sales, editing/production/delivery workflow tabs, order-details) can fetch the relevant slice without Sales-specific assumptions.
- New `Note` records are the **single source of truth** for typed notes immediately; only the *legacy* stage-specific fields coexist. Do not write new notes into any Sales-only structure.
- This means order-details can read `Note` records as soon as v1 ships (the read-only bridge), and later absorption only retires legacy fields — no Note-model migration.

### Open Items

- **N-1: RESOLVED** — per-package "Add note" defaults to kind `CUSTOMER` (changeable). See Piece 3 → S-A.
- **N-2:** Order-details display of new notes (the near-term bridge) — confirm which surfaces and that read-only is acceptable for v1.

---

## Piece 3 — Single-view Sales redesign (UI)

**Status:** Re-scoped 2026-06-07 after owner revision. **Replaces the earlier five-tab design** (now removed — see Superseded). Depends on Album + Notes domains existing first.

### Background (current reality)

- Today's Sales page is a single scrolling column (Package Composition → Selected Photos → Add-on Marketplace → staged/commit) + sticky financial sidebar.
- `PageContainer` (centered `max-w-7xl`, page-scroll) is incompatible with a fixed-shell/partial-scroll layout → the Sales view bypasses it.
- **Global-layout escape hatch — VERIFIED, no AppShell change.** `AppShell` is already `flex h-screen overflow-hidden` with `<main class="flex-1 overflow-y-auto">`. The Sales view mounts as a `h-full flex flex-col overflow-hidden` root inside `<main>` and owns its internal scroll. The current Sales `layout.tsx` / `PageContainer` usage is replaced.
- Sidebar (`src/components/layout/sidebar.tsx`) has **no collapse toggle** today — net-new, app-wide (deferred polish).

### Locked Decisions — shell & layout

1. **Single view, no tabs.** One route, kept nested at `/orders/[orderId]/sales` (no routed tab segments, no tab bar). v2 relocation to top-level `/sales/[orderId]` remains parked.
2. **Fixed shell, partial scroll.** Header pinned; the **left composition panel** scrolls internally; the **right glance cards** pinned (scroll independently only if tall — see S-F). No whole-page scroll.
3. **Two-column layout** — left editable composition panel (`1fr`), right glance column (~380px) with two cards. Map spacing to our tokens.
4. **Header** (carried from prior shell decisions): restyle of current header; back-to-order in the **topbar**; `h1` = customer phone; show ref / state / date / photographer when available; duration blank; session-type badge omitted (no clean order-level value for multi-package).
5. **Style strategy:** mockup = design direction; map to shadcn/app tokens; **no raw mockup CSS, no Sales-only design system**; tweak shared tokens only where clearly better.
6. **Drafts auto-persist** on every stage → "Draft auto-saved" status label, not a Save button. **Commit CTA placement (footer vs header) is TBD** (S-C).

### Left panel — editable composition (single view)

One scrollable area of **collapsible rows**:

- **Package cards** (collapsible; first open by default). Expanded body holds:
  - **Included deliverables** — content tiles; per-tile upgrade/replace via existing `ItemUpgradeDialog` (staff must see which deliverable changes).
  - **Photos summary → modal (NEW placement).** Card shows a photo summary at a glance (selected vs included, extras). Click → **modal** to set photo count + digital/print/split extras (commercial → OrderCommit). This is today's `POSPhotoCountCard` behavior moved into a per-package modal.
  - **Configure album → modal (NEW placement).** "Configure album" action opens the album modal; if the package includes **two** albums, the modal covers configs for both.
  - **Configure session** (`ConfigureSessionPanel`); **Upgrade tier / Swap package** (`PackageUpgradeDialog`); **Add note** (modal; placement TBD).
  - Thumbnail = tier-derived placeholder (initials/tier label/icon). **No image uploads.**
- **Add-on rows** (order-level), **including standalone albums** (they're normal add-ons): collapsible rows; some expand to a short summary + **Configure** button (→ album modal for standalone albums), some don't.
- **Dashed "+ add another package / add-on / product" CTA** at the bottom.

### Right column — two glance cards (read-only)

Right column is **read-only**; all editing happens on the left.

**1. Order summary (live draft) — the "customer receipt."**
- Live, itemized readout of the current draft: each package (title + included sub-items) **with line price**, add-ons **with price**, # selected photos (+ extras), etc.
- North star: *what the customer is getting* — the thing you'd hand a customer to confirm their order.
- Live-updates as the left panel changes. Projector over the draft `pendingSnapshot` / current composition — **display only**.

**2. Financial summary — simplified.**
- Sales users care about money, not invoices/documents. Show: **paid · remaining · discounts · deposits · total**; in **draft state**: **previous total vs new total + pending diff**.
- **Removed from the always-on card:** invoice list/breakdown, document plan, payment/refund impact, approval reasons, financial-case ids. Those are **commit-time** concerns → live in the **Review & commit dialog**, not the sales readout.
- Source: `FinancialCaseSummary` + `preview.totals` (Spec 127), projector-only.

### Album — in-card config (was: Album tab)

Album domain (Piece 1) unchanged; UI home moved from a tab to **in-card / in-row modals**.
- **Field mapping (unchanged):** size → product swap → OrderCommit · pages-over-base → flat per-page extra-pages add-on → OrderCommit · cover material / thread / layout / cover text / cover image ref / instructions → operational, live `OrderAlbum`.
- **Modal split:** **Specifications** (size, pages — priced; price impact from `OrderCommitPreview`) vs **Finishing** (operational, no price). Explicit copy ("size & pages stage for commit; finishing saves immediately"). Size change explicit ("Change album product / size").
- **Add album** = standalone (add-on path → OrderCommit); **bundled albums auto-derived** from packages.
- Cover = gradient placeholder + cover text + cover-image-ref **text** as the corner tag (no real images).

### Notes — add-note modal + order-details (was: Notes tab)

Notes domain (Piece 2) unchanged; UI home moved from a tab to **a modal**.
- **Add note** action → modal (kind + body + optional applies-to-package selector; order-level default). Order-level and per-package both exist; **placement TBD**.
- New notes **also render on order-details** (shared infrastructure).
- Editable; delete with confirmation; emits `NOTE_ADDED` activity.

### Open Items

- **S-A — Add-note placement: RESOLVED (2026-06-07).**
  - **Two entry points, same modal:** (1) **"+ Add note"** in the left-panel Notes section → **order-level default** (no package), user picks kind; (2) **"Add note"** action on each **package card** → **pre-scoped to that package**, kind **defaults to `CUSTOMER`** (changeable).
  - **Scope is pre-filled but changeable** in the modal (one consistent modal; can switch order-level / package).
  - Modal fields unchanged (Piece 2 #10): kind + body + optional applies-to-package selector.
- **S-B — Notes display in the Sales view: RESOLVED (2026-06-07).**
  - **Always-visible**, not behind a button.
  - **A collapsible "Notes" section/row at the bottom of the left panel** (fits the "every row is a collapsible row" pattern; sits in the editing flow). Grouped **by kind** (only kinds with notes render).
  - **Per-package `CUSTOMER` notes also render inline on their package card** (quick "customer requested…" context). Other kinds (INTERNAL/EDITING/PRODUCTION/DELIVERY + order-level CUSTOMER) live in the general Notes section.
  - Add-note is still a modal (placement = S-A); new notes also render on order-details (shared infra).
- **S-C — Commit CTA placement + clean state: RESOLVED (2026-06-07).**
  - **Commit home:** **bottom of the right column** — a commit area sits as a third element beneath the receipt + financial cards. **No footer bar, no header CTA.** Layout stays two regions (left edit / right summary+commit).
  - **Context-aware commit area:**
    - **Draft state** → **Review & commit** (`OrderCommitReviewDialog` → `commitSalesChangesAction`) + **Discard draft** + a small **"Draft"** indicator.
    - **Clean / no-draft state** → **no** Review & commit, **no** Discard; show a quiet **"No changes to commit"** indicator + a **Record payment** button (opens the existing `POSRecordPaymentDialog`).
  - **Payment collection lives here** (the clean-state Record-payment button) — resolves where payments go now that the Payments tab is gone. Invoice/document detail still belongs to the commit dialog / order-details, not the always-on cards.
  - **Mode pill:** keep the small **"Draft"** indicator in draft state; **drop** the separate "Clean" pill (the "No changes to commit" text covers it).
  - **No "Draft auto-saved" text** (skipped). Drafts still auto-persist on every stage; we just don't surface a label.
- **S-D — Order summary ("customer receipt") contents: RESOLVED (2026-06-07).**
  - **Granularity:** package-level + extras (for now). Each **package** is one line (name + price); **add-ons, extra photos, session-config fees, albums** are their own lines. Included deliverables are **not** itemized individually.
  - **Grouping:** **grouped by package** — a package's add-ons/configs/photos/album nest under it; order-level add-ons form their own group.
  - **Prices/totals split:** receipt shows **per-line prices + a single subtotal/total**. Discounts, deposits, paid, and remaining stay on the **Financial summary** card — no duplication of the money math.
  - **Operational (no-price) configs:** **skip for now** (don't render $0 config selections like "Twins"/"Cake theme" on the receipt).
  - **Labels:** **customer-facing** — clean labels, no internal codes/ids.
  - **Source/behavior:** **live draft preview during draft state; last-committed preview during no-draft state** — same source switch as the editable composition panel (projector over current `Order*` composition when no draft, over `pendingSnapshot` when a draft exists). Projector-only, no recomputation.
- **S-E — Order-level editing for same-session multi-package (photos + session configs):** today both are **per-`OrderPackage`** (photos via `OrderPackage.selectedPhotoCount`; session-config selections via `OrderPackageSessionConfigurationSelection`, scoped by each package's `sessionTypeId`). Multi-package orders are *usually* one session type, so per-package editing repeats the same input N times. **Opportunity:** offer an **order-level editing surface** that configures once and **fans out** to each same-session package — *keeping per-package storage unchanged* (required for per-line pricing and mixed session types). This is a UI-aggregation change, not a data-model change. Apply the **same decision to both photos and session configs** for consistency.
  - **⚠️ BLOCKED on owner confirmation:** does a multi-package order ever contain **different session types**? 
    - If **always one session type** → the order-level editing surface is clean and clearly worth it.
    - If **mixed session types are possible** → order-level editing must degrade to per-package (or group by session type) when types differ; the per-package model is mandatory and the order-level surface is a same-session-only convenience.
  - Owner to confirm; plan the UX once answered.
- **S-F — Right-column scroll behavior: RESOLVED (2026-06-07).** Right column stacks: **Order summary (receipt) → Financial summary → commit area** (the S-C context-aware block). Only the **receipt's line list scrolls internally**; the **financial card + commit area stay pinned** at the bottom, always visible. (Mirrors the mockup rail: variable part scrolls, money + action always in view.)
- **S-G — Phased spec breakdown: RESOLVED (2026-06-07).**

  > **Labels are relative ordering only.** Do **not** map to repo spec numbers here — assign real `spec/NN-<slug>` numbers at implementation time (the plan may be built later, off the then-current sequence).

  **Foundations — backend, no UI dependency; parallelizable, land first:**
  - **F1 — Album domain:** `OrderAlbum` entity + "Extra album page" product + album service (size/pages → OrderCommit; operational fields live).
  - **F2 — Notes domain:** shared, surface-agnostic `Note` module + service (6 kinds, order/package scope, `NOTE_ADDED` activity).
  - **F3 — Sidebar collapse (S-H2):** standalone, app-wide; independent of everything — can land anytime.

  **Sales single-view — shell first, then surfaces:**
  - **B1 — Shell skeleton:** single view (no tabs), fixed shell / partial scroll, bypass `PageContainer`, header restyle, left-panel + right-column region scaffolding (placeholder content).
  - **B2 — Composition rows restyle:** left panel = collapsible package + add-on rows + dashed "+ add another…" CTA. **Functionally unchanged.** *(needs B1)*
  - **B3 — Right column:** receipt card + simplified financial card + context-aware commit area (commit/discard ↔ record-payment). *(needs B1)*
  - **B4 — Photos in-card:** per-package photo summary → modal (count + digital/print/split extras; today's `POSPhotoCountCard` behavior). **Its own spec.** *(needs B2)*
  - **B5 — Album in-card:** configure-album modal in package card (handles 2 albums) + standalone album rows. *(needs F1 + B2)*
  - **B6 — Notes UI:** left-panel Notes section + per-package customer notes inline + add-note modal. *(needs F2 + B1/B2)*
  - **B7 — Token reconciliation / visual polish (S-H):** deferred, last.

  **Owner-blocked — sequence later:** order-level photos + session configs (S-E); session-config quick-config surface (S-I).
- **S-H — Token reconciliation:** deferred polish — map the mockup's visual style onto existing shadcn/app tokens; tweak a token only where clearly better. Final pass; core build doesn't depend on it.
- **S-H2 — Sidebar collapse: its own standalone spec.** App-wide collapse/expand toggle on the main sidebar (net-new; `src/components/layout/sidebar.tsx` has none today). **Independent of the Sales redesign** — can land anytime, even early. Persist collapsed state (e.g. localStorage), collapsed rail shows icons only. Include in the S-G breakdown as a standalone spec.
- **S-I — Session-config quick-config surface (owner idea, exploratory):** owner floated showing **session configs** (e.g. Twins surcharge, age range, cake) as a **quick-config surface** in place of / alongside the current add-on marketplace on the composition panel — so common config toggles are one tap, framed as "configuring the session" not "adding a fee." Feasible on what we have: configs resolve per package via `sessionTypeId`; `ConfigureSessionPanel` already renders them; financial ones stage as `SESSION_CONFIGURATION` lines, linked-product ones as `OrderAddOn`. Open: how this coexists with the add-on marketplace (replace? complement?), per-package vs the S-E order-level surface, and which configs surface as "quick." Exploratory until owner firms it up.

### Superseded (removed in this revision)

- Routed **five-tab** structure (Composition / Photos / Album / Notes / Payments) and all tab paths.
- Dedicated **Photos tab** → per-package **photo modal** inside the package card.
- Dedicated **Album tab** → **in-card / in-row** album modal.
- Dedicated **Notes tab** (grouped-by-kind) → **add-note modal** + order-details display.
- Dedicated **Payments tab** → **simplified Financial summary** card; invoice/document/impact detail moves to the Review & commit dialog.
- **Staged-changes delta rail** → live **Order summary (customer receipt)** card.
</content>
