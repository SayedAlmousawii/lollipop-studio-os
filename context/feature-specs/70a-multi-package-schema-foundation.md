## Goal

Introduce the schema needed for a Booking and an Order to carry multiple packages. This spec is purely additive: new `BookingPackage` and `OrderPackage` join tables and their back-relations. Every existing column on `Booking` and `Order` stays untouched so all current flows continue to compile and run. Behavior is wired in Specs 70b and 70c; retirement of the singular fields is Spec 70d.

Deposit amount remains a payment-time concern (no schema change here) — the record-deposit dialog gains an editable amount input in Spec 70b.

---

## Read First

- `prisma/schema.prisma` — current `Booking`, `Order`, `Package` shapes
- `context/feature-specs/67-package-taxonomy-foundation.md` — `SessionType` table
- `context/feature-specs/68-package-model-upgrade.md` — `Package.packageFamilyId`
- `context/feature-specs/69-session-type-extra-photo-pricing.md` — `MediaType` enum
- `context/reviews/package-arch.md` — sections 5, 6, 9, 10

---

## Rules

- Schema and migration only — no service, action, or UI changes
- Do not remove or modify any existing field on `Booking`, `Order`, or `Package`
- New join-table fields that will become required after 70b/70c run are added as nullable or with defaults now
- The two-step nullable-then-required migration pattern (used in Spec 68) applies to any field that becomes required after data is populated
- All existing dev data is reset before this series runs — no production backfill concern, but seed scripts must produce valid join rows

---

## Scope

### In Scope

- New `BookingPackage` model
- New `OrderPackage` model
- Back-relations on `Booking`, `Order`, `Package`, `SessionType`
- Migration
- Seed updates so any seeded booking/order includes one `BookingPackage` / `OrderPackage` row mirroring its current singular `packageId`

### Out of Scope

- Booking add/edit form changes (70b)
- POS / order edit changes (70c)
- Invoice line builder changes (70c)
- Commission service changes (70c)
- Deliverables aggregation (70c)
- Removing any singular `packageId` / `sessionType` / snapshot field (70d)
- Retiring the `BookingSessionType` enum (70d)
- Retiring `calculateExtraPhotoCharge` or the `addon-extra-photo` product (70d)

---

## Data Model

### BookingPackage (new)

```prisma
model BookingPackage {
  id            String   @id @default(cuid())
  bookingId     String
  packageId     String
  sessionTypeId String
  quantity      Int      @default(1)
  sortOrder     Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  booking     Booking     @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  package     Package     @relation(fields: [packageId], references: [id])
  sessionType SessionType @relation(fields: [sessionTypeId], references: [id])

  @@index([bookingId, sortOrder])
  @@index([packageId])
  @@index([sessionTypeId])
  @@map("booking_packages")
}
```

Notes:

- `sessionTypeId` is stored on the line, not derived. Per owner Q3: a single booking can mix packages from different session types, so the line itself owns the session type.
- `quantity` defaults to 1; supports the rare case of two of the same package in one booking (e.g., two Mini Special slots).
- `onDelete: Cascade` because a `BookingPackage` is meaningless without its booking.

### OrderPackage (new)

```prisma
model OrderPackage {
  id                          String   @id @default(cuid())
  orderId                     String
  packageId                   String
  sessionTypeId               String
  originalPackagePriceSnapshot Decimal? @db.Decimal(10, 3)
  finalPackagePriceSnapshot    Decimal? @db.Decimal(10, 3)
  selectedPhotoCount           Int?
  extraDigitalCount            Int      @default(0)
  extraPrintCount              Int      @default(0)
  sortOrder                    Int      @default(0)
  createdAt                    DateTime @default(now())
  updatedAt                    DateTime @updatedAt

  order       Order       @relation(fields: [orderId], references: [id], onDelete: Cascade)
  package     Package     @relation(fields: [packageId], references: [id])
  sessionType SessionType @relation(fields: [sessionTypeId], references: [id])

  @@index([orderId, sortOrder])
  @@index([packageId])
  @@index([sessionTypeId])
  @@map("order_packages")
}
```

Notes:

- Snapshots are nullable now; populated at the same lifecycle moments that today's `Order.originalPackagePriceSnapshot` and `Order.finalPackagePriceSnapshot` are populated (check-in and POS final selection respectively). The order-level snapshot fields remain in 70a — they are duplicated into the first line in 70b/70c — and are dropped in 70d.
- `selectedPhotoCount`, `extraDigitalCount`, `extraPrintCount` are per-line. The owner-confirmed aggregation rule (Q1) is: the order view sums these across all `OrderPackage` rows. Aggregation is a read-time helper added in 70c.
- `extraDigitalCount` and `extraPrintCount` default to 0 so existing rows are valid without backfill.

### Back-relations

```prisma
model Booking {
  // existing fields...
  packages BookingPackage[]
}

model Order {
  // existing fields...
  packages OrderPackage[]
}

model Package {
  // existing fields...
  bookingPackages BookingPackage[]
  orderPackages   OrderPackage[]
}

model SessionType {
  // existing fields from Spec 67...
  bookingPackages BookingPackage[]
  orderPackages   OrderPackage[]
}
```

---

## Migration

1. Create `booking_packages` and `order_packages` tables with the columns above
2. Seed/backfill:
   - For every existing `Booking` with a non-null `packageId`, create one `BookingPackage` row mirroring it (sortOrder 0, quantity 1, sessionTypeId = the row mapped from the current `Booking.sessionType` enum value via a code-to-id lookup)
   - For every existing `Order` with `originalPackageId` set, create one `OrderPackage` row with both `packageId` and the order's snapshot values copied in (snapshots populated only if the order-level snapshot was set)
   - Booking dev data resets before this runs — but the migration logic must still be correct for seed-generated rows

Mapping from old `BookingSessionType` enum to new `SessionType` rows:

| Enum value | SessionType code |
|---|---|
| NEWBORN | NB_NEWBORN |
| KIDS | KD_REGULAR |
| FAMILY | KD_FAMILY |
| MATERNITY | NB_MATERNITY |
| OTHER | KD_REGULAR |

`OTHER` → Kids Regular is a safe catch-all (matches the Spec 68 fallback).

---

## Acceptance Criteria

- `BookingPackage` and `OrderPackage` exist in `prisma/schema.prisma` with the fields above
- All back-relations are present and Prisma client typechecks
- Migration runs cleanly on a reset dev database
- Seed creates one `BookingPackage` per seeded `Booking` and one `OrderPackage` per seeded `Order`
- All existing flows (booking creation, order edit, POS, invoice generation, calendar, commission) compile and run with no behavior change
- `npx prisma validate` passes
- `npm run build` passes
- `npm run lint` passes
- `context/progress-tracker.md` is updated

---

## Decisions

- **`sessionTypeId` is stored on every line.** Per owner Q3, packages from different session types can coexist in one booking. Deriving it from `Package → PackageFamily → SessionType` would work for the most common case, but only line-level storage allows the (rare) future case where the same package gets used under a different session type. Cheap to store, expensive to retrofit.
- **Snapshots stay on Order too, for now.** Spec 70a duplicates them into the first OrderPackage line during seed, but does not yet drop them. 70d removes the order-level columns once 70c is using the line-level ones exclusively.
- **No `depositAmount` field on Booking.** The deposit is a payment-time concern: the record-deposit dialog captures the amount when the staff actually records the payment (Spec 70b). Storing it on the booking before payment would create a second source of truth that has to stay in sync with what's actually entered at recording time.
- **No `paid` or `confirmed` flag on `BookingPackage`.** Order/booking lifecycle states stay where they are (Booking.status, Order.status). The join table is just composition.
- **`quantity` lives on `BookingPackage` but not on `OrderPackage`.** The Order side wants each package to be independently upgradable per the Q1 answer, so two of the same package become two rows. The Booking side is just a scheduling intent — quantity captures it without forcing two near-identical rows.

---

## Assumptions

- The enum-to-SessionType mapping above is acceptable for seed data. Owner has signed off on `OTHER → KD_REGULAR` as the catch-all.
- No production data exists to migrate. Seed correctness is sufficient.
- Cascade-delete on `BookingPackage` / `OrderPackage` is acceptable — if the parent is removed, the lines have no meaning.
