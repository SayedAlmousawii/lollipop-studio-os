# Implementation Review — Specs 67–70d

## Executive Summary

The 67–70d series ships substantial infrastructure correctly — the taxonomy hierarchy (Department → SessionType → PackageFamily) is clean, the per-line schema (`BookingPackage`, `OrderPackage`) is in place, the singular-field retirement (70d) is complete and matches spec, and the booking flow is genuinely multi-package end-to-end with aggregated duration in the calendar.

However, the order/POS side has serious gaps. The implementation looks "multi-package aware" at the schema and the POS read model, but several key write paths still operate as if there is only one package — most damagingly the **Selection Workflow**, which is single-package-only and silently bypasses extra-photo invoicing entirely. There is also a real **invoice math bug**: any package upgrade double-counts the upgrade delta on the locked invoice (sum of line items ≠ `Invoice.totalAmount`), and `Order.selectedPhotoCount` lives in parallel with `OrderPackage.selectedPhotoCount` with no source-of-truth discipline.

Code quality is otherwise solid: transaction discipline, retry wrappers, sortOrder discipline, and snapshotting are consistently applied. The taxonomy and pricing modules are well-shaped foundations.

## What Was Done Well

1. **Schema-first discipline.** The migration set is ordered and each migration is reviewable on its own: `package_taxonomy_foundation` → `package_model_upgrade` → `session_type_extra_photo_pricing` → `multi_package_schema_foundation` → `singular_package_field_retirement`. This is exactly the layering the specs called for.
2. **70d retirement is genuinely clean.** The grep audit returns zero hits for `BookingSessionType`, `originalPackageId`, `finalPackageId`, `Order.originalPackagePriceSnapshot`, `calculateExtraPhotoCharge`, `addon-extra-photo` in the codebase. The product is soft-deleted with a `[RETIRED]` prefix, matching the spec's fallback decision.
3. **Booking multi-package flow is end-to-end.** [booking.service.ts](../../src/modules/bookings/booking.service.ts) creates/updates/syncs `BookingPackage` rows correctly, the form supports add/remove/quantity/reorder, the calendar [calendar.service.ts:45-52](../../src/modules/calendar/calendar.service.ts#L45-L52) aggregates duration across lines, and the deposit dialog is editable with the right validation (`>= 20`).
4. **Final invoice builder iterates `OrderPackage` correctly** ([invoice.service.ts:845-911](../../src/modules/invoices/invoice.service.ts#L845-L911)). Emits one PACKAGE_BASE per line, BUNDLE_ADJUSTMENT per line, EXTRA_PHOTOS per line per media type, with session-type-scoped pricing via `getExtraPhotoUnitPriceWithClient`. This is the architecture the spec asked for.
5. **Cascade package admin UI.** Department → Session Type → Family → Package picker is implemented as specified in 68.
6. **Per-line POS panels exist.** [pos-package-composition.tsx](../../src/components/orders/pos-package-composition.tsx) renders one panel per `OrderPackage` and posts `orderPackageId` to scoped actions.
7. **Snapshotting discipline preserved.** `originalPackagePriceSnapshot` is set at order creation per line; `finalPackagePriceSnapshot` is set on POS upgrade per line. Activity logging covers `ORDER_PACKAGE_LINE_CHANGED` and `ORDER_PACKAGE_EXTRAS_CHANGED`.
8. **Locking + isolation.** `lockBookingForUpdate` uses `SELECT ... FOR UPDATE`; financial transactions are wrapped in `db.$transaction` consistently.

## Critical Issues

### C1. Selection workflow does not generate extra-photo charges
**Where:** [order.service.ts:925-986](../../src/modules/orders/order.service.ts#L925-L986) (`updateOrderSelectionWorkflow`) → [order.service.ts:2359-2374](../../src/modules/orders/order.service.ts#L2359-L2374) (`updateOrder`)

**Problem:** The Selection Workflow form posts a single `extraPhotos` number. `updateOrder` writes that as `OrderPackage[0].selectedPhotoCount` and `Order.selectedPhotoCount`, but **never touches `extraDigitalCount` or `extraPrintCount`**. The invoice line builder and `calculateOrderPackageExtraPhotoTotal` read **only** `extraDigitalCount + extraPrintCount`. So a workflow like:

1. Editor selects 30 photos in selection workflow (10 included)
2. `OrderPackage.selectedPhotoCount = 30`, but `extraDigitalCount = 0, extraPrintCount = 0`
3. `syncOrderInvoiceForFinancialEdit` runs → `nextExtraPhotoCharge = 0`
4. Final invoice `totalAmount = packagePrice + addons` (extras silently dropped)

**Why it matters:** The studio's primary upsell — extra photos beyond the included count — is currently uninvoiced unless the POS staff manually opens a separate POS extras form. The selection workflow is the editor's natural entry point and it leaves money on the floor.

**Severity:** Critical (revenue loss + invoice integrity).

**Fix direction:** The selection workflow needs to either (a) capture digital/print split per line (matching POS schema), or (b) translate a single `extraPhotos` number into one of the two media types by default and let POS reallocate. Whatever the choice, `updateOrder` must write `extraDigitalCount` / `extraPrintCount`. Longer-term, retire `updateOrder` and route selection through a per-line `updateOrderPackageSelection(orderPackageId, ...)` that mirrors POS.

---

### C2. Invoice line totals double-count package upgrades
**Where:** [invoice.service.ts:845-888](../../src/modules/invoices/invoice.service.ts#L845-L888) (`buildInvoiceLineItems`)

**Problem:** When a package upgrades (e.g., Silver 60 → Gold 90), `updateOrderPackage` re-connects `OrderPackage.package` to the new package and sets `finalPackagePriceSnapshot = 90`. Then on invoice close, the line builder emits:

- `PACKAGE_BASE` from `packageRow.items` = Gold items total = 100
- `BUNDLE_ADJUSTMENT` from `packageRow.bundleAdjustment` = -10
- `PACKAGE_UPGRADE` = `finalSnapshot - originalSnapshot` = 30

Sum of locked line items = **120**. Meanwhile `Invoice.totalAmount` is computed in `createInvoiceForOrderWithClient` and `syncOrderInvoiceForFinancialEdit` using `finalPackagePriceSnapshot ?? package.price` = **90**. Locked-invoice line total ≠ `Invoice.totalAmount` on every upgraded order.

**Why it matters:** Two competing sources of truth for the same invoice. Customers may see "Total 90 KD" on one screen and a line breakdown summing to 120 on the printed invoice. Accountancy reconciliation will fail.

**Severity:** Critical (data integrity, financial).

**Fix direction:** Pick one of:
- **(a)** `PACKAGE_BASE` reads `originalPackagePriceSnapshot` (description preserves original package name via a new snapshotted field), `PACKAGE_UPGRADE` keeps the delta. Requires storing the original package name (or id) on `OrderPackage`.
- **(b)** Drop the `PACKAGE_UPGRADE` line entirely; show upgrade in metadata/activity log only. PACKAGE_BASE on its own already reflects the final value.
- **(c)** When upgrade exists, compute PACKAGE_BASE as `originalPackagePriceSnapshot` and skip the items-sum path so the math stays consistent.

The spec itself is ambiguous here; the correct decision needs your input on whether the customer-facing invoice should show "Silver 60 + Upgrade 30" or just "Gold 90".

---

### C3. `Order.selectedPhotoCount` is a parallel source of truth
**Where:** Schema still has `Order.selectedPhotoCount Int?`; written in [order.service.ts:2370](../../src/modules/orders/order.service.ts#L2370) and read in many places ([order.service.ts:398, 583, 745, 2391](../../src/modules/orders/order.service.ts#L398), etc.)

**Problem:** Two columns now hold "selected photos":
- `Order.selectedPhotoCount` (legacy aggregate)
- `OrderPackage.selectedPhotoCount` (per-line, the new model)

`updateOrder` dual-writes them. `syncOrderSelectedPhotoCountFromPackageLines` exists but isn't called from every write path. Read sites mix the two — sometimes preferring the aggregate, sometimes preferring the line value. They can and will drift.

**Why it matters:** Read paths that prefer the legacy field will silently show wrong totals after per-line edits via the POS extras flow. The order detail page falls back to `row.selectedPhotoCount` when the line aggregate is 0 ([order.service.ts:581-584](../../src/modules/orders/order.service.ts#L581-L584)), masking bugs that exist on the line side.

**Severity:** Critical (data integrity).

**Fix direction:** Decide whether `Order.selectedPhotoCount` is (a) derived/computed-on-read from `OrderPackage` rows, (b) auto-synced via a single helper called from every write, or (c) removed entirely (a follow-up retirement spec). Option (c) is cleanest given 70d already retired the snapshot fields. Until then, ban direct reads — wrap behind a `getOrderTotalSelectedPhotoCount(orderId)` helper that always sums from lines.

---

### C4. `updateOrder` wipes all add-ons including other lines'
**Where:** [order.service.ts:2376-2387](../../src/modules/orders/order.service.ts#L2376-L2387)

**Problem:**
```ts
await tx.orderAddOn.deleteMany({ where: { orderId } });
if (data.addOns.length > 0) {
  await tx.orderAddOn.createMany({
    data: data.addOns.map((addOn) => ({
      orderId,
      productId: addOn.productId ?? null,
      ...
      // no orderPackageId set
    })),
  });
}
```

`updateOrder` deletes **every** `OrderAddOn` row on the order — including any scoped to lines 2..N via `orderPackageId` — and recreates only the ones in the current form payload, all unscoped (`orderPackageId = null`). For a multi-package order, editing the order through the legacy edit page wipes line-2 add-ons.

**Why it matters:** Silent data loss the moment a user opens the legacy edit page on any multi-package order. The form has no knowledge of line-scoped add-ons, so they're invisible-then-gone.

**Severity:** Critical (silent data loss).

**Fix direction:** Either route the legacy edit page through a per-line flow (and remove `updateOrder` for multi-package orders), or have `updateOrder` only touch add-ons unscoped from `orderPackageId`. The first option is cleaner since the legacy single-package model is dead.

---

### C5. Selection workflow only sees the first package line
**Where:** [order.service.ts:651-806](../../src/modules/orders/order.service.ts#L651-L806) (`getOrderSelectionWorkflowById`)

**Problem:** The Selection Workflow read model and form are scoped to `order.packages[0]`. For a multi-package order, the editor cannot select photos for packages 2..N. The UI ([selection-workflow-form.tsx](../../src/components/orders/selection-workflow-form.tsx)) has one package picker and one extra-photo input.

**Why it matters:** Spec 70c was explicit: "Editor sees N panels (one per package), each with its own target photo count and extras." Implementation supports only one. Multi-package orders can't actually complete selection correctly.

**Severity:** Critical (workflow gap; multi-package promise unfulfilled).

**Fix direction:** Restructure the selection workflow as `OrderSelectionWorkflowLine[]` mirroring the POS panels. The order-level `OrderSelectionStatus.COMPLETED` should roll up only when every line is line-complete (introduce `OrderPackage.selectionCompletedAt` or a status column).

---

### C6. Extra-photo pricing computed using only the first line's session type in several places
**Where:** [order.service.ts:763-767](../../src/modules/orders/order.service.ts#L763-L767) and the POS workspace `extraPhotoUnitPrice: packageLines[0]?.extraDigitalUnitPrice ?? 0` at [order.service.ts:433](../../src/modules/orders/order.service.ts#L433)

**Problem:** Computing `extraPhotoUnitPrice` for the selection workflow uses `firstLine.sessionType.id` only. If an order has Birthday + Newborn packages, every extra photo charge in the selection UI is priced at Birthday's rate, regardless of which package the extras apply to. The invoice line builder fortunately gets this right per-line — but the user-facing displays will be wrong, leading to staff/customer mismatch when invoice prints.

**Why it matters:** Diverges from owner Q1 (per-package session type) and Q6 (per-session-type pricing). The invoice will be correct; the live display the staff uses to discuss price with the customer will be wrong.

**Severity:** Critical (customer-facing pricing inconsistency).

**Fix direction:** Same as C5 — selection workflow becomes per-line and each line computes its own pricing from its own `sessionTypeId`.

## Medium Issues

### M1. `edit-order-form.tsx` still uses the singular `originalPackage` / `finalPackage` compat shape
**Where:** [edit-order-form.tsx:32-65](../../src/components/orders/edit-order-form.tsx#L32-L65) and [order.service.ts:3498-3501](../../src/modules/orders/order.service.ts#L3498-L3501)

**Problem:** `mapEditableOrderRow` sets `originalPackage` and `finalPackage` both to the **same** current package object from the first line. The form then talks about "package upgrade" vs "downgrade" using `packageAdjustmentBaseline` from the (legacy) invoice summary — semantics no longer match the underlying schema. There is no real `originalPackage` distinction anymore.

**Why it matters:** Misleading UI. The form looks functional but its mental model is a single-package world. Combined with C4, opening this page on any multi-package order is destructive.

**Severity:** Medium (UI workflow bug; becomes critical via C4).

**Fix direction:** Either remove the legacy edit page (POS workspace is the canonical edit surface now) or rewrite it as per-line cards.

---

### M2. Duplicated `getExtraPhotoUnitPrice` implementation
**Status:** Fixed in Feature 70e.5a.

**Where:** [pricing.service.ts:20-43](../../src/modules/pricing/pricing.service.ts#L20-L43) and [invoice.service.ts:987-1007](../../src/modules/invoices/invoice.service.ts#L987-L1007)

**Problem:** Spec 69 defined `getExtraPhotoUnitPrice` in `pricing.service.ts`, but `invoice.service.ts` redefines a `getExtraPhotoUnitPriceWithClient` doing the same query because the pricing module doesn't expose a transaction-client variant. Two copies of the same business logic, two error messages that will drift, two callers to keep aligned.

**Severity:** Medium (maintainability).

**Fix direction:** Export `getExtraPhotoUnitPriceWithClient(client, sessionTypeId, mediaType)` from `pricing.service.ts` and delete the invoice-side copy. The `ExtraPhotoPricingNotFoundError` from pricing module should be the only error type.

---

### M3. Calendar session-type coloring is hardcoded by name
**Status:** Fixed in Feature 70e.5b.

**Where:** [calendar.service.ts:84-100](../../src/modules/calendar/calendar.service.ts#L84-L100)

**Problem:** `mapCalendarSessionType` is a string-name allowlist of 6 Kids session types. New session types added via seed (e.g., owner adds "School") will silently bucket to "Other" with no visual distinction.

**Severity:** Medium (display-only, but failure mode is silent).

**Fix direction:** Color by `SessionType.code` or by `Department.code`, not by display name. The seeded codes are designed for exactly this kind of stable mapping.

---

### M4. Session type lock on package change blocks the spec's "allow override" intent
**Where:** [order.service.ts:1051-1053](../../src/modules/orders/order.service.ts#L1051-L1053) and [order.service.ts:2350-2354](../../src/modules/orders/order.service.ts#L2350-L2354)

**Problem:** `updateOrderPackage` rejects any new package whose family is in a different session type than the line's current `sessionTypeId`. Spec 70c said "scoped to the line's session type by default; allow override to switch session type if needed." Current implementation is "block, no override."

**Severity:** Medium (workflow restriction not in spec).

**Fix direction:** Either accept the restriction (and update spec) or add an override path. The restriction is defensible — switching session types changes invoice pricing — but it should be a documented decision.

---

### M5. `Package.durationMinutes` default 60, not the spec's 0
**Where:** [schema.prisma:262](../../prisma/schema.prisma#L262)

**Problem:** Spec 68 said `@default(0)` with service-layer rejection of `<= 0`. Implementation uses `@default(60)`. The service validator still rejects `<= 0`, so functionally fine — but the default is misleading. A package created bypassing the service layer (script, raw insert) would silently ship with `60 minutes`, hiding a missing-duration bug.

**Severity:** Low/Medium (defensive design deviation).

**Fix direction:** Either accept the implementation choice (and update the spec's Decisions) or change to `@default(0)` for fail-loud behavior. I'd accept the implementation — 60 is a reasonable studio default — but document it.

---

### M6. `updateBooking` allows package changes on CONFIRMED bookings after Deposit Invoice is locked
**Where:** [booking.service.ts:434-519](../../src/modules/bookings/booking.service.ts#L434-L519)

**Problem:** The status guard rejects CHECKED_IN/CANCELLED/NO_SHOW, but not CONFIRMED. After deposit recording, the booking is CONFIRMED with a locked Deposit Invoice. Staff can still change the package list. This is arguably fine (the Final Invoice will reflect the change, the Deposit Invoice stays locked), but there is no audit entry and no warning shown to the user.

**Severity:** Medium (silent state change after a financial event).

**Fix direction:** Either explicitly allow it with an audit log entry (`BOOKING_PACKAGES_CHANGED`) and a UI warning ("Deposit already recorded; only the Final Invoice will reflect this change"), or block it and require a manager override.

---

### M7. `OrderAddOn.orderPackageId` is nullable with `onDelete: SetNull`
**Where:** [schema.prisma:603](../../prisma/schema.prisma#L603)

**Problem:** When an `OrderPackage` is deleted, its scoped add-ons become orphaned (null `orderPackageId` but still attached to the order). They'll appear unscoped in the POS UI — effectively transferring an add-on from a deleted line to "the order at large."

**Severity:** Medium (edge case, but real after a multi-package order is reduced).

**Fix direction:** Either `onDelete: Cascade` (delete add-on with its line) or `onDelete: Restrict` (force the user to remove add-ons before removing the line). Cascade matches the existing pattern for `OrderAddOn → Order`.

## Minor Issues

### Mn1. `OrderActivity.metadata` mixes `Decimal.toFixed(3)` strings and raw numbers
Some metadata writes (`packageAdjustmentAmount`) use `.toFixed(3)`, others (`invoice.totalAmount`) use already-formatted strings. Inconsistent across the codebase. Low impact — only affects log readability.

### Mn2. Commission service is a stub
[commission.service.ts](../../src/modules/commissions/commission.service.ts) accepts the input and does nothing. Spec 70c explicitly noted commission persistence "lands in the commission unit," so this is expected, but worth flagging — no upgrades currently produce commission records, and the per-line iteration described in the spec doesn't exist yet.

### Mn3. `EditableBooking.packageId` / `packageName` / `sessionType` legacy fields are populated from the first line
The booking detail and edit view types still carry singular `packageId`, `packageName`, `sessionType` fields filled from `packages[0]`. For mixed-session-type bookings this is misleading (booking detail header shows only the first line's session type). The per-package list below is correct; the header just lies.

### Mn4. `BookingPackage` has no uniqueness constraint on `(bookingId, packageId)`
The schema permits duplicate package lines (different rows for the same package). `resolveBookingPackageLines` deduplicates by collapsing into `quantity`, but a direct DB insert or a different code path could create duplicates. Not a runtime risk today but a latent invariant gap.

### Mn5. POS workspace exposes a single `extraPhotoUnitPrice` field
`workspace.extraPhotoUnitPrice: packageLines[0]?.extraDigitalUnitPrice ?? 0` — a header-level scalar that's only correct if there's one line or all lines share the same session type. Per-line panels do the right thing; this top-level field is misleading and should be removed or recomputed per line.

### Mn6. `Order.addOns Json @default("[]")` column still present
The pre-existing JSON `addOns` column on `Order` was not retired in this series (and the specs didn't say to). It's now dead duplicate of `OrderAddOn` rows. Worth a follow-up retirement spec.

### Mn7. PACKAGE_FAMILY admin UI doesn't exist
Per spec 67/68: "No admin CRUD UI." That's intentional, but there is also no read-only catalog view. Owner has no way to inspect what families exist short of running SQL or reading the seed.

## Architectural / Workflow Observations

**The dual-write pattern from 70b/70c is gone (per 70d), but its readers aren't fully cleaned up.** Pieces of the codebase still think singular (legacy `updateOrder`, `EditableOrder`, the legacy edit form, the selection workflow). The retirement spec successfully dropped the columns, but the implicit "first-line-is-the-package" pattern survived in code shape. The reviewer's mental model has to constantly translate between "this code path treats `OrderPackage[0]` as the whole order" and "this one is genuinely per-line." That asymmetry is the root cause of C1, C4, C5.

**Two write surfaces (POS / selection workflow / legacy edit) compete for the same fields.** `OrderPackage.selectedPhotoCount`, `extraDigitalCount`, `extraPrintCount` are written by POS extras flow and partially by selection workflow and not at all by legacy edit. There is no canonical "selection write" service that all UI paths funnel through. A single per-line service (`updateOrderPackageLine(orderPackageId, { selectedPhotoCount?, extraDigitalCount?, extraPrintCount?, packageId? })`) would fix several issues at once.

**Invoice-line ↔ invoice-total reconciliation is implicit.** Today's design computes `totalAmount` one way (`finalPackagePriceSnapshot` sum + addons + extras) and `lineItems` another way (`PACKAGE_BASE` from items + `BUNDLE_ADJUSTMENT` + `PACKAGE_UPGRADE` + ...). These should be the same number by construction. A test asserting `Σ lineItems.lineTotal == Invoice.totalAmount` on every locked invoice would have caught C2.

**Aggregation helpers are missing.** `getBookingDurationMinutes` exists for bookings, but order-side `getOrderTotalSelectedPhotoCount`, `getOrderTotalExtraPhotoCount`, `getOrderTotalDuration` were promised by spec 70c and don't exist. Order detail aggregation is done ad-hoc at read sites with inconsistent fallbacks. Centralizing these would eliminate the `Order.selectedPhotoCount` confusion (C3).

**Naming inconsistency on rename:** Spec called for the legacy enum to be renamed to `BookingSessionType`. Implementation deleted it instead in 70d (consistent with 70d's intent), but the intermediate state went straight from the original enum → table without the documented rename pause. Functionally fine since 70d shipped together.

## Recommended Next Actions

1. **Fix C2 (invoice math) before any further POS work.** Decide which line shape you want and add a test asserting line sum == totalAmount on every locked FINAL invoice. This is the most damaging bug and the cheapest to verify.
2. **Fix C1 (selection workflow extras).** Either wire digital/print into the selection form or default the existing `extraPhotos` value to one media type at the service layer. Without this fix, current production-ish data is silently dropping revenue.
3. **Decide on `Order.selectedPhotoCount` (C3).** I'd recommend a small follow-up retirement spec that drops it, with all reads going through a new `getOrderTotalSelectedPhotoCount` helper. Could be 70e.
4. **Replace or retire `updateOrder` / legacy edit page (C4, M1).** It's a single-package surface in a multi-package world. The POS workspace already does everything it does, better. Retire the route or rewrite as line panels.
5. **Make the Selection Workflow per-line (C5, C6).** Mirror POS structure. Lift selection completion to a per-line state with order-level rollup.
6. **Consolidate pricing lookups (M2).** Single `getExtraPhotoUnitPriceWithClient` exported from `pricing.service.ts`.
7. **Add invariant tests.**
   - `Σ InvoiceLineItem.lineTotal == Invoice.totalAmount` for every locked invoice
   - `Σ OrderPackage.selectedPhotoCount == Order.selectedPhotoCount` (until C3 is resolved)
   - Every `OrderPackage` line has `originalPackagePriceSnapshot != null` after check-in
8. **Add owner-visible pricing catalog page** (was in spec 69 scope, doesn't appear to ship — verify; owner has no way to see seeded prices).

The taxonomy and schema foundations are good and don't need rework. The work concentrates on the order-side write paths and the invoice math — fix those four critical issues and the series delivers the multi-package promise.
