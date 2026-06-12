## Goal

Move the per-package **photo count + extras** editing into the package card — Phase 7 / POS Sales redesign Piece 3, build-order item **B4**. Today the photo controls live in a standalone "Selected Photos" card (`POSPhotoCountCard`) stacked below the composition, repeating one `POSPhotoLineForm` per package. B4 retires that standalone card: each **package card** (from B2) gains a **photo summary at a glance** in its expanded body, and clicking it opens a **per-package modal** hosting the existing photo form (selected count + digital/print/split extras). This is a **placement/presentation change**: the photo handler, projection, staging, and policy are unchanged — the exact same `POSPhotoLineForm` renders, just inside a modal launched from the card.

## Read First

- `context/reviews/pos-sales-redesign-planning.md`:
  - Piece 3 → "Left panel" → **"Photos summary → modal (NEW placement)"**: the card shows a photo summary at a glance (selected vs included, extras); click → **modal** to set photo count + digital/print/split extras (commercial → OrderCommit). **"This is today's `POSPhotoCountCard` behavior moved into a per-package modal."**
  - Build order → **"B4 — Photos in-card: per-package photo summary → modal (count + digital/print/split extras; today's `POSPhotoCountCard` behavior). Its own spec. (needs B2)"**
- `context/pos-redesign-handoff/project/hifi/photo-selection.jsx` / `photo-selection.css` — visual language for the per-package photo summary + extras (included allowance, digital/print/split mode, counts/prices). **Take the summary/extras presentation only.** The handoff's actual photo-ID **picker grid** (choosing specific photos) is **out of scope** — B4 is counts + extras (the `extras` block), matching `POSPhotoCountCard`, not a photo picker.
- `src/components/orders/pos-package-composition.tsx`:
  - `POSPhotoCountCard` (currently exported, used in `page.tsx`) — one `<Card>` "Selected Photos" mapping `composition.packageLines` → `POSPhotoLineForm`. **This standalone card is what B4 removes.**
  - `POSPhotoLineForm({ line, handlers, policy })` — the self-contained per-package form (selected count + digital/print extras + billing mode) driven by `handlers.changeSelectedPhotoCount` and the `editPolicies.selectedPhotoCountChange` policy. **Reuse this verbatim inside the modal.**
  - `PackageCompositionCard` (from B2) — already receives `handlers` (incl. `changeSelectedPhotoCount`) and `editPolicies` (incl. `selectedPhotoCountChange`), plus the `line` whose photo fields (`includedPhotoCount`, `selectedPhotoCount`, `extraDigitalCount`, `extraPrintCount`, `extraPhotoCount`, `extra*UnitPrice`, `extraPhotoTotal`) supply the glance. **No new props from `page.tsx` are needed.**
- `app/(app)/orders/[orderId]/sales/page.tsx` — imports + renders `POSPhotoCountCard` in the left stack; B4 removes that import/usage. No other page change.
- `src/components/ui/dialog` — the existing `Dialog`/`DialogContent`/`DialogTrigger` primitives already used in this file (e.g. `PackageUpgradeDialog`, `ItemUpgradeDialog`). Reuse the same modal pattern.
- `context/ui-context.md` — tokens.

## Rules

- **Placement / presentation only. Functionally unchanged.** B4 does **not** change `handlers.changeSelectedPhotoCount`, the photo projection, the staging/commit path, `editPolicies.selectedPhotoCountChange`, photo billing math, or `POSPhotoLineForm`'s internals. The same form, same submission, same results — only its host (a per-package modal launched from the card) and a new glance summary change.
- **No photo picker.** B4 is counts + digital/print/split extras only (today's `POSPhotoCountCard` scope). Do **not** add a photo-ID selection grid, thumbnails of chosen photos, or any new selection capability/data.
- **Reuse `POSPhotoLineForm` verbatim** inside the modal — do not fork or reimplement it. Reuse the existing `Dialog` primitives and the modal conventions already in this component.
- **Remove the standalone photo card.** Delete the `POSPhotoCountCard` usage from `page.tsx` (left stack). The component may be removed, or kept only if still referenced elsewhere (it is not — verify and remove the export if unused). Do not leave a duplicate photo surface.
- **Per-package, in the B2 card body.** The glance + modal trigger live inside `PackageCompositionCard`'s expanded body, alongside the existing Upgrade/Swap/Configure-session actions. One modal per package.
- **Stay in lane.** No album (B5), notes (B6), right-column (B3 — already shipped), or token-reconciliation (B7) work. No left-panel change beyond the photo relocation.
- Token-driven; reuse shared primitives; no inline raw hex; no `@/lib/db` under `app/**` or `src/components/**`.

## Scope

### In Scope

1. **Photo glance summary in the package card** (`PackageCompositionCard` body):
   - A compact, read-at-a-glance row showing **selected vs included** photos and **extras** (e.g. "10 / 10 included · 2 digital · 1 print extra", or "no extras"), derived from the existing `line` photo fields. Customer-neutral, token-styled, matching the card's tile/row language.
   - When the policy is non-interactive (locked), the glance still renders (read-only) without a launch affordance, or with a disabled one — mirror how the other card actions reflect `policy.isInteractive`.

2. **Per-package photo modal:**
   - A **Configure / Edit photos** affordance (button or the clickable glance) opens a `Dialog` whose body is the existing `POSPhotoLineForm` for that package (`line`, `handlers`, `policy = editPolicies.selectedPhotoCountChange`).
   - The form behaves exactly as today: selected count + digital/print/split extras, autosave/submit through `handlers.changeSelectedPhotoCount`, same validation and `expectedVersion`/staging behavior. Closing the modal does not change submission semantics.
   - Title/description make the package context clear (package name). Honor the policy: non-interactive → read-only/disabled as the form already does.

3. **Remove `POSPhotoCountCard` from the left stack** (`page.tsx`): drop the import and the `<POSPhotoCountCard … />` usage; remove the now-unused export/component if nothing else references it. The left panel after B4 is package cards (with in-card photos) + add-on rows + dashed CTA — no separate "Selected Photos" card.

### Out of Scope

- No photo-ID picker / selection grid / chosen-photo thumbnails (not `POSPhotoCountCard` behavior; no backend).
- No change to `handlers.changeSelectedPhotoCount`, the photo projection, staging/commit, edit policies' logic, or `POSPhotoLineForm`'s internals.
- **B5** (album in-card), **B6** (notes), **B7** (tokens). No right-column change (B3 shipped). No new data field or workspace read.

## Implementation Direction

In `PackageCompositionCard` (the B2 card), add the photo glance + modal alongside the existing actions, using the `handlers`, `editPolicies.selectedPhotoCountChange` policy, and `line` it already holds — no new props through `page.tsx`. Build the glance from the line's existing photo fields (`selectedPhotoCount` / `includedPhotoCount` and the `extra*` fields). Wire a `Dialog` (same primitives as `PackageUpgradeDialog`/`ItemUpgradeDialog` in this file) whose content renders `<POSPhotoLineForm line={line} handlers={handlers} policy={editPolicies.selectedPhotoCountChange} />` verbatim. Keep the same `key`/remount behavior the standalone card used if it matters for resetting the form's projected draft (the old card keyed the form on `line.id:selectedPhotoCount:extraDigitalCount:extraPrintCount` — preserve an equivalent key so the modal form re-syncs to the latest projection).

Then remove `POSPhotoCountCard` from `page.tsx` (import + usage), and delete the component/export if unreferenced. Confirm `POSPhotoLineForm` and its helpers stay (now only used by the modal).

Reflect the policy: where `selectedPhotoCountChange` is non-interactive, the glance is read-only and the launch affordance is disabled/hidden, consistent with the form's own `policy.isInteractive` handling. Minor label/placement choices are allowed UI assumptions — state them in the PR.

The success bar for B4: each package card shows a photo summary at a glance, clicking it opens a modal with the same photo count + digital/print/split controls that worked before (same handler, same staging, same results), and the standalone "Selected Photos" card is gone.

## Post-Implementation

- Update `context/progress-tracker.md`: Feature History entry for Spec 176 (Sales photos in-card — per-package photo glance + modal; standalone Selected Photos card removed; placement-only).
- In `context/reviews/pos-sales-redesign-planning.md`, mark **B4 shipped** and leave B5–B7 as follow-ons.

## Acceptance Criteria

- Each package card shows a **photo summary at a glance** (selected vs included + extras) in its expanded body, derived from existing line fields; clicking the summary/affordance opens a **per-package modal**.
- The modal hosts the **existing `POSPhotoLineForm`** for that package — selected count + digital/print/split extras — wired to `handlers.changeSelectedPhotoCount` and `editPolicies.selectedPhotoCountChange`, with identical behavior, validation, staging, and `expectedVersion` as before.
- The standalone **`POSPhotoCountCard` ("Selected Photos") is removed** from the Sales page; no duplicate photo surface remains; the unused component/export is deleted if nothing else references it.
- **No functional change:** photo handler, projection, staging/commit, billing math, and policy logic are unchanged; no photo-ID picker added; no new data field/read.
- Policy is honored: non-interactive (locked) state renders read-only/disabled as the form already does.
- Scope confined to `pos-package-composition.tsx` + `page.tsx`; token-driven, no raw hex, no `@/lib/db` under `app/**`/`src/components/**`; shared `Dialog` primitives reused.
- `npm run build` passes. `npm run lint` passes. Existing Sales mount/source guard stays green.
