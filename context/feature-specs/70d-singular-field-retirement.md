## Goal

Remove the singular package and session-type fields that 70b and 70c kept alive for compatibility. Drop the `BookingSessionType` enum entirely. Retire the legacy `addon-extra-photo` product and the `calculateExtraPhotoCharge` helper. After this spec, multi-package is the only model — there is no dual-write fallback and no legacy path.

This is a cleanup spec. It ships only after 70a–c are stable and every read/write goes through the join tables.

---

## Read First

- `context/feature-specs/70a-multi-package-schema-foundation.md`
- `context/feature-specs/70b-booking-multi-package-flow.md`
- `context/feature-specs/70c-order-multi-package-flow.md`
- `prisma/schema.prisma`
- Every file flagged in 70b/70c as a dual-write site
- `src/modules/invoices/invoice.service.ts` — `calculateExtraPhotoCharge`

---

## Rules

- This spec ships only after 70a–c are in production and stable
- Before any removal, every reader of the field must be confirmed to operate through the join tables instead. A grep audit precedes any drop.
- The migration drops columns and enum values; existing rows of `BookingPackage` / `OrderPackage` are the source of truth and no data is lost
- No new behavior is introduced. If something currently doesn't work via the multi-package path, fix it in 70c, not here.

---

## Scope

### In Scope

**Schema drops on `Booking`:**

- `packageId`
- `sessionType` (the column on Booking — the enum is dropped separately below)
- Indexes / FKs that reference the above

**Schema drops on `Order`:**

- `originalPackageId`
- `finalPackageId`
- `originalPackagePriceSnapshot`
- `finalPackagePriceSnapshot`
- Indexes / FKs that reference the above

**Schema drops on `Package` back-relations:**

- The `Booking[] @relation("BookingPackage")` relation (Booking no longer has the singular FK)
- The `Order[] @relation("OriginalPackage")` and `Order[] @relation("FinalPackage")` relations

**Enum drop:**

- `BookingSessionType` enum is removed from Prisma. No remaining column uses it after `Booking.sessionType` is dropped.

**Code drops:**

- `calculateExtraPhotoCharge` in `src/modules/invoices/invoice.service.ts`
- Any helper that resolves `Order.originalPackage` / `Order.finalPackage` directly through the singular FK
- The deprecated `changeOrderPackage(orderId, newPackageId)` signature from Spec 70c (routed-to-first-line shim)
- Dual-write stamping logic in `booking.service.ts` and `order.service.ts`
- Reverse enum mapping helpers from Spec 70b

**Data drops:**

- Delete the `addon-extra-photo` `Product` row (or set `isActive = false` if soft-delete is preferred — see Decisions). The Spec 69 pricing catalog has fully replaced its purpose.

**Audit:**

- Run a repo-wide grep for `packageId` (on Booking), `originalPackageId`, `finalPackageId`, `BookingSessionType`, `sessionType` (on Booking), and `addon-extra-photo`. Any non-test reference is a blocker — fix or convert before dropping.

### Out of Scope

- Any new feature
- Any behavior change beyond removing dead paths
- Database backfill (rows in `BookingPackage` / `OrderPackage` are already the source of truth from 70a–c)

---

## Migration

Single migration with the following operations, in order:

1. Drop the dual-write stamping in service code (deploy first, so writes stop touching the columns)
2. Drop FK constraints on `Booking.packageId`, `Order.originalPackageId`, `Order.finalPackageId`
3. Drop columns:
   - `Booking.packageId`
   - `Booking.sessionType`
   - `Order.originalPackageId`
   - `Order.finalPackageId`
   - `Order.originalPackagePriceSnapshot`
   - `Order.finalPackagePriceSnapshot`
4. Drop the `BookingSessionType` enum type from the database
5. Delete or deactivate the `addon-extra-photo` product

Run order in deployment: code change (stop writing) → migration (drop columns) → release. The two-phase deploy is mandatory to avoid runtime errors mid-deploy.

---

## Acceptance Criteria

- `Booking.packageId` and `Booking.sessionType` no longer exist in Prisma
- `Order.originalPackageId`, `Order.finalPackageId`, `Order.originalPackagePriceSnapshot`, `Order.finalPackagePriceSnapshot` no longer exist in Prisma
- The `BookingSessionType` Prisma enum is removed
- The `calculateExtraPhotoCharge` function is removed
- The `addon-extra-photo` product is removed or deactivated
- A repo-wide grep for the dropped identifiers returns zero non-test hits
- All booking, order, POS, invoice, commission, and calendar flows continue to work
- `npx prisma validate` passes
- `npm run build` passes
- `npm run lint` passes
- `context/progress-tracker.md` is updated

---

## Decisions

- **Hard-delete the `addon-extra-photo` product, not soft-delete.** Spec 69's pricing catalog has fully replaced it; leaving the row alive invites a future bug where someone re-points pricing through it. If product-deletion is blocked by FK constraints elsewhere (e.g., historical `OrderAddOn.productId` references), fall back to `isActive = false` and a name suffix like `[RETIRED] Extra Photo`.
- **Drop the enum, don't keep it for legacy reasons.** Once `Booking.sessionType` is gone, the enum has zero usages. Keeping unused enums in Prisma creates ambient confusion.
- **Two-phase deploy is mandatory.** Migrations that drop columns referenced by running code crash mid-deploy. Stop writing first, then drop. This is the only spec in the series with this constraint.
- **Audit is a hard gate, not a soft step.** Skipping the grep audit and discovering a missed reference in production is a regression that 70a–c worked hard to prevent. The grep must be clean before merge.
- **No new tests in this spec.** Behavior is unchanged. Existing tests written in 70b and 70c cover the multi-package paths; removing the legacy code paths doesn't introduce anything new to test.

---

## Assumptions

- 70a–c have been in production for long enough that no in-flight booking or order still depends on the singular fields. If a stale read path is discovered post-deploy, the fix is to convert that reader, not to restore the columns.
- The `addon-extra-photo` product has no historical `OrderAddOn` rows that would block deletion. If it does, soft-deletion is acceptable.
- No external integration (reporting, exports, BI) reads the dropped columns. If any exists, it must be converted before this spec merges.
