## Goal

Wire the Order, POS, invoice line builder, commission service, and deliverables view onto `OrderPackage`. Every package on an order is independently upgradable, has its own price snapshots, its own extra-photo counts split by digital and print, and contributes its own line to the Final Invoice. Order-level totals (selected photo count, deliverables list, commission total) become aggregations across `OrderPackage` rows.

Extra-photo pricing switches from the legacy `addon-extra-photo` product to the Spec 69 `getExtraPhotoUnitPrice(sessionTypeId, mediaType)` lookup.

The singular `Order.originalPackageId`, `Order.finalPackageId`, `Order.originalPackagePriceSnapshot`, and `Order.finalPackagePriceSnapshot` stay on the model and are dual-written by this spec. 70d removes them.

---

## Read First

- `context/feature-specs/70a-multi-package-schema-foundation.md`
- `context/feature-specs/70b-booking-multi-package-flow.md`
- `context/feature-specs/69-session-type-extra-photo-pricing.md`
- `context/feature-specs/61-check-in-rewrite.md` — Order creation at check-in, original snapshot stamping
- `context/feature-specs/63-final-invoice-pos.md` — Final Invoice creation at POS
- `context/feature-specs/57-pos-commercial-workspace.md`
- `src/modules/orders/order.service.ts`
- `src/modules/invoices/invoice.service.ts` — especially `calculateExtraPhotoCharge` and final invoice line builder
- `src/modules/commissions/` — commission calculation
- `src/components/orders/` — order detail, deliverables section, POS components

---

## Rules

- Specs 70a and 70b must be merged first
- `Order.originalPackageId`, `Order.finalPackageId`, `Order.originalPackagePriceSnapshot`, and `Order.finalPackagePriceSnapshot` are not removed in this spec. Every write to `OrderPackage` must keep these in sync with the first line (`sortOrder = 0`):
  - `Order.originalPackageId` ← `OrderPackage[0].packageId` (the original at check-in)
  - `Order.finalPackageId` ← `OrderPackage[0].packageId` (after any upgrade on the first line)
  - `Order.originalPackagePriceSnapshot` ← `OrderPackage[0].originalPackagePriceSnapshot`
  - `Order.finalPackagePriceSnapshot` ← `OrderPackage[0].finalPackagePriceSnapshot`
- Each `OrderPackage` is independently upgradable (owner Q1). Upgrading line A does not touch line B.
- Commission per order = sum of `(finalPackagePriceSnapshot − originalPackagePriceSnapshot)` across all `OrderPackage` rows (owner Q5).
- Extra-photo pricing comes from `getExtraPhotoUnitPrice(orderPackage.sessionTypeId, mediaType)`. The legacy `addon-extra-photo` product is no longer consulted (it is retired in Spec 70d).
- Each `OrderPackage` line carries its own `extraDigitalCount` and `extraPrintCount`. The order detail / deliverables view aggregates `sum(extraDigitalCount + extraPrintCount)` across lines for the "total extra photos" display (owner Q1).
- Bundle adjustment stays per-package — sum the `Package.bundleAdjustment` of each line; do not introduce an order-level bundle (owner Q3).
- Editing flows must not retroactively change locked invoices (existing invariant).

---

## Scope

### In Scope

- Order creation at check-in (Spec 61 flow): for each `BookingPackage` row, create one `OrderPackage` row with `originalPackagePriceSnapshot` set to the current `Package.price`
- POS workspace UI: per-line panels, each with its own package picker, upgrade action, extra-photo counts (digital + print), and computed delta
- POS package change action: operates on a specific `OrderPackage` line; updates its `packageId` and `finalPackagePriceSnapshot`
- Final Invoice line builder (Spec 63 flow): emits one `PACKAGE_BASE` line per `OrderPackage` plus the necessary `BUNDLE_ADJUSTMENT`, `PACKAGE_UPGRADE`, and `EXTRA_PHOTOS` lines per package
- Extra-photo lines: one `EXTRA_PHOTOS` line per `OrderPackage` per media type with count > 0; unit price from `getExtraPhotoUnitPrice(orderPackage.sessionTypeId, mediaType)`
- Commission service: iterate `OrderPackage`, sum `(final − original)`
- Order detail view: package list (one card per line), per-line photo selection, per-line upgrade status, aggregated totals at the top (total selected photos, total extras, total deliverables, commission)
- Deliverables section: aggregate across lines for display, but show contributions per line for transparency
- Selection workflow: per-line photo selection (each package has its own included count and extras)
- Activity log: new entry types for line-level package changes and line-level photo selection updates

### Out of Scope

- Removing singular fields on Order (70d)
- Retiring the `addon-extra-photo` product (70d)
- Retiring `calculateExtraPhotoCharge` (70d) — it stays in place, unused by new code paths after this spec, deleted in 70d
- Retiring the `BookingSessionType` enum (70d)
- Refunds or credit notes on a single line (out of scope for V1)
- A "split selection across packages later" UX — selection is per-line from the start

---

## Service Layer

### Order creation

`src/modules/orders/order.service.ts` (or the check-in service per Spec 61):

- `createOrderFromBooking` iterates the booking's `BookingPackage` rows and creates one `OrderPackage` per row, copying `packageId`, `sessionTypeId`, and `sortOrder`. `originalPackagePriceSnapshot` ← current `Package.price`. `finalPackagePriceSnapshot` left null until POS finalization.
- Stamp the singular `Order.originalPackageId` and `Order.originalPackagePriceSnapshot` from the first line.

### POS package change

- `changeOrderPackageOnLine(orderPackageId, newPackageId)` — updates that specific line's `packageId`, sets `finalPackagePriceSnapshot` to current `newPackage.price`. Audit-logged. If a Final Invoice exists and is not locked, the invoice is regenerated (see Final Invoice rule below).
- The legacy `changeOrderPackage(orderId, newPackageId)` action is deprecated. If anything still calls it, route it to operate on the line at `sortOrder = 0` for backwards compatibility; emit a deprecation log line. Removed in 70d.

### POS extra-photo entry

- Per-line inputs: digital count, print count. Stored on `OrderPackage.extraDigitalCount` / `OrderPackage.extraPrintCount`.
- Validation: both non-negative integers.

### Final Invoice line builder

In `src/modules/invoices/invoice.service.ts`, replace the package-handling portion of the final invoice builder:

For each `OrderPackage` (in `sortOrder`):

1. Emit a `PACKAGE_BASE` line: `description = "<Package name>"`, `unitPrice = sum(package items canonicalPrice × qty)`, `quantity = 1`
2. If `Package.bundleAdjustment != 0`, emit a `BUNDLE_ADJUSTMENT` line: signed value matching the package's adjustment
3. If `originalPackagePriceSnapshot` and `finalPackagePriceSnapshot` differ, emit a `PACKAGE_UPGRADE` line: `lineTotal = finalSnapshot − originalSnapshot`
4. For each media type with count > 0:
   - `EXTRA_PHOTOS` line, `description = "Extra photos – <Digital|Print> (<Package name>)"`, `quantity = count`, `unitPrice = getExtraPhotoUnitPrice(orderPackage.sessionTypeId, mediaType)`, `lineTotal = quantity × unitPrice`

`sortOrder` on invoice lines: contiguous integers grouped by `OrderPackage` so the invoice renders in package order.

Add-ons (`OrderAddOn`) still emit `ADD_ON` lines at the end. No change to add-on behavior in this spec.

### Commission

In `src/modules/commissions/`:

- Replace the order-level commission calculation with iteration over `OrderPackage` rows:
  ```
  commission = Σ max(0, finalPackagePriceSnapshot - originalPackagePriceSnapshot)
  ```
- Per-line commission rows (if commission breakdown is stored): one per upgraded line. Order-level commission record stays as the parent.
- Commission reports group by order but show line-level contributions on detail views.

### Deliverables / order detail aggregation

New helpers in `order.service.ts`:

- `getOrderTotalPhotoCount(orderId)` — sums `(package.photoCount + extraDigitalCount + extraPrintCount)` across `OrderPackage` rows
- `getOrderTotalExtraPhotoCount(orderId)` — sums `(extraDigitalCount + extraPrintCount)`
- `getOrderTotalDuration(orderId)` — for display parity with Booking aggregate

Order detail read model exposes both per-line breakdowns and the aggregates.

---

## UI Requirements

### POS Workspace

- One panel per `OrderPackage` (vertical list). Each panel contains:
  - Header: package name, department, session type
  - Package change picker (scoped to the line's session type by default; allow override to switch session type if needed)
  - Price delta display: `Original 60 KD → Final 90 KD (+30 KD)`
  - Extra photo inputs: Digital count, Print count, with computed line totals using the Spec 69 prices
  - Per-line subtotal
- Order-level summary at the bottom: total of all line subtotals, total add-ons, deposit applied, remaining balance

### Order Detail Page

- Replace the single-package display with a stacked list of package cards
- Each card shows: package name, session type, included photo count, selected photo count, extras (digital + print), upgrade status
- Top-of-page totals: total selected photos, total extras, total duration (matches booking), total order value, deposit applied, remaining balance
- Deliverables section aggregates products across all packages' `PackageItem` lists (per owner Q1: one total count for staff visibility), with a per-package breakdown available on click

### Selection Workflow

- Photo selection is per-line. Editor sees N panels (one per package), each with its own target photo count and extras.
- Completion is per-line; the order-level `OrderSelectionStatus` rolls up: `COMPLETED` only when every line is selection-complete.

### Activity Log

New `OrderActivityType` entries — extend the existing enum:

- `ORDER_PACKAGE_ADDED` (in case of post-check-in addition; rare but possible)
- `ORDER_PACKAGE_LINE_CHANGED` (replaces / augments `PACKAGE_CHANGED` for line-scoped changes; the existing enum value stays for backwards compatibility on legacy rows)
- `ORDER_PACKAGE_EXTRAS_CHANGED`

---

## Acceptance Criteria

- Check-in creates one `OrderPackage` per `BookingPackage`, with `originalPackagePriceSnapshot` populated
- POS supports independent per-line package changes
- POS supports per-line digital + print extra-photo entry
- Final Invoice emits one `PACKAGE_BASE` line per `OrderPackage`, with the correct `BUNDLE_ADJUSTMENT`, `PACKAGE_UPGRADE`, and `EXTRA_PHOTOS` lines per package
- Extra-photo unit prices come from `getExtraPhotoUnitPrice(sessionTypeId, mediaType)` and not from any product row
- Commission = `Σ max(0, final − original)` across `OrderPackage` rows
- Order detail page shows per-line cards and aggregated totals
- Deliverables view shows aggregated counts plus per-package breakdown
- Selection workflow operates per line
- Singular `Order.originalPackageId`, `Order.finalPackageId`, and order-level snapshots stay in sync with the first `OrderPackage`
- Existing tests still pass; new tests cover the per-line flows
- `npm run build` passes
- `npm run lint` passes
- `context/progress-tracker.md` is updated

---

## Decisions

- **Dual-write Order singular fields.** Same logic as 70b's booking dual-write: legacy readers stay alive until 70d's cleanup spec. The first line drives the singular values.
- **Extra photos remain a per-line concern, not converted to add-ons.** Per owner Q9: extras are package-driven with set prices. Adding them as `OrderAddOn` rows would duplicate that pricing logic and lose the "extras of package X" semantic. They stay as fields on `OrderPackage` with invoice lines emitted from those fields.
- **One `EXTRA_PHOTOS` line per package per media type.** Aggregating across packages on the invoice would hide which package drove the extras. Per-package per-media-type lines make the invoice self-documenting and let the customer see exactly what they're paying for. The order detail UI aggregates for staff convenience — the invoice does not.
- **No order-level bundle adjustment.** Per owner Q3, bundle adjustment is per-package. Sum-of-line bundle adjustments is the invoice total adjustment; no second-tier bundle exists.
- **Selection is per-line from the start.** Letting selection be order-level and then asking the editor to retro-allocate photos to packages would be a worse UX and would complicate the deliverables aggregation. Per-line up front is clearer.
- **Commission per line, summed.** Owner Q5 said "just the sum for now." Per-line commission records are kept so future commission reports can attribute revenue to specific packages, but no per-line commission logic differs from order-level.
- **Legacy `changeOrderPackage` is routed to the first line.** Some integration or test code may still call it. Routing to `sortOrder = 0` keeps it working without lying about its behavior. 70d removes it.

---

## Assumptions

- Spec 70a's seeded `OrderPackage` rows mirror existing `Order.originalPackageId` correctly; this spec's first-run on dev data does not require additional backfill.
- The Spec 69 `getExtraPhotoUnitPrice` helper is in place and returns valid prices for every seeded `(sessionTypeId, mediaType)` combination.
- Commission storage already supports per-order records; adding per-line metadata is additive, not a redesign.
- POS layout can accommodate multiple package panels without a wholesale redesign — vertical stacking is acceptable for V1.
