## Goal

Surface deliverables information in two places it is currently missing: the order overview tab and the package display in the selection tab.

---

## Rules

- No schema changes in this spec — package deliverable fields (albumCount, canvasCount, digitalFiles) are a future schema addition; this spec uses existing data only
- Changes are confined to `app/orders/[orderId]/page.tsx` and the service mapping layer

---

## Part 1 — Deliverables Card on Order Overview Tab

**Location:** `app/orders/[orderId]/page.tsx` — `OverviewTab` function

**Current state:** The overview tab shows "Next Action," "Workflow Progress," "Key Notes," and related records. It has no deliverables summary.

**Fix:** Add a Deliverables card to the left column of `OverviewTab`, below the "Workflow Progress" card.

The card should show:
- Package name and photo limit
- Selected photos count (and extra photos if any)
- Add-ons list (name + price for each `OrderAddOn`)
- A clear "none" state when no add-ons exist

**Data source:** `OrderDetail` already has the fields needed — read `order.finalPackageName`, `order.includedPhotoCount`, `order.extraPhotoCount`, `order.selectedPhotos`, and `order.addonsSummary`. Check what is available on `OrderDetail` in `src/modules/orders/order.types.ts` before writing the component — use only what is already mapped.

If `order.addonsSummary` is a formatted string (as used in the Production tab), use it directly. If a list of structured add-ons is needed, check whether `OrderDetail` already exposes them — do not add a new query if the data is already present.

---

## Part 2 — Package Description in Selection Tab

**Location:** `app/orders/[orderId]/page.tsx` — `SelectionTab` function

**Current state:** The selection tab's InfoGrid shows package name, photo limit, selected photos, and extra selected. It does not show what deliverables are included in the package (albums, digital files, canvases).

**Constraint:** The `Package` model only has `photoCount` and `description` — there are no structured fields for album count or canvas count. A schema addition is required for structured tracking and is deferred.

**Fix for this spec:** Surface the package `description` field in the selection tab's package info card. Add a row to the InfoGrid:

```ts
["Package includes", selection.packageDescription ?? "—"],
```

Expose `packageDescription` on `OrderSelectionWorkflow` in `order.types.ts`, and map it from `order.finalPackage?.description ?? order.originalPackage?.description ?? null` in the service.

**Note for future spec:** When package deliverable fields (albumCount, canvasCount, digitalFilesCount) are added to the schema, replace the description row with structured rows per deliverable type. Track this in `context/reviews/open-issues-review.md` under Feature Gaps.

---

## Post-Implementation

**`context/progress-tracker.md`**
- Update Now section: Feature 55c complete; next is 55d
- Add to Feature History: "Feature 55c: Deliverables card on overview tab; package description surfaced in selection tab."

---

## Acceptance Criteria

1. Order overview tab shows a Deliverables card with package name, photo limit, selected count, and add-ons
2. When no add-ons exist, the card shows a clear empty state
3. Selection tab shows the package description under the package info section
4. No new DB queries are introduced — existing mapped fields are reused
5. TypeScript passes
6. `npm run build` passes
7. `npm run lint` passes
8. Update `context/progress-tracker.md`
