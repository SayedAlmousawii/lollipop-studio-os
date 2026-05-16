## Goal

Link every `Package` into the new taxonomy (Department → Session Type → Package Family) and give every package a duration. This lets downstream specs scope package pickers to a department + session type, compute booking duration from package selection, and route extra-photo pricing through the package's session type.

This spec changes the `Package` model and the package admin UI only. Booking and Order remain singular (single `packageId`) in this spec — multi-package on Booking + Order is Spec 70.

---

## Read First

- `prisma/schema.prisma` — current `Package` model and existing `Booking.packageId` / `Order.originalPackageId` / `Order.finalPackageId` relations
- `context/feature-specs/67-package-taxonomy-foundation.md` — `SessionType` and `PackageFamily` tables this spec depends on
- `context/feature-specs/56-packages-management-and-schema.md` — Package + Product + PackageItem architecture; `bundleAdjustment` rule
- `src/modules/packages/package.service.ts`
- `src/modules/packages/package.schema.ts`
- `src/modules/packages/package.types.ts`
- `src/components/packages/` — current package admin UI

---

## Rules

- Spec 67 must be merged first — this spec assumes `SessionType` and `PackageFamily` exist and are seeded
- A package belongs to exactly one `PackageFamily`. Department and session type are derived transitively (family → session type → department). They are not stored as redundant FKs on Package.
- `durationMinutes` is package-level. There is no session-type or department default — every package carries its own duration.
- Duration is a positive integer (minutes). Service-layer validation rejects creates/edits with `durationMinutes <= 0`.
- Existing `Package.price`, `Package.photoCount`, `Package.bundleAdjustment`, and `PackageItem` structure are unchanged
- Package template edits still must not retroactively change existing order compositions or locked invoices (invariant from Spec 56 carries through)
- Do not touch `Booking.packageId`, `Order.originalPackageId`, or `Order.finalPackageId` in this spec — they remain singular until Spec 70

---

## Scope

### In Scope

- Add `packageFamilyId` (non-null FK) and `durationMinutes Int` to `Package`
- Update package admin create/edit UI to require selecting Department → Session Type → Package Family before naming the package, and to require a duration
- Update package list UI to display the department, session type, family, and duration
- Update package service reads/writes to handle the new fields
- Add a service helper `getPackageSessionType(packageId)` that returns the transitive session type (used by Spec 69 for pricing and Spec 70 for multi-package wiring)
- Update package list filters: allow filtering by department and session type
- Seed updates: existing seeded packages must be assigned to a family + duration during the migration

### Out of Scope

- Multi-package on Booking or Order (Spec 70)
- Session-type-scoped extra-photo pricing (Spec 69)
- Package family admin CRUD UI (catalog stays seed-driven per Spec 67)
- Booking duration calculation across multiple packages (Spec 70)
- Calendar/scheduler changes (Spec 70)
- Retiring the `BookingSessionType` enum on `Booking.sessionType` (Spec 70)

---

## Data Model

Update `Package`:

```prisma
model Package {
  // existing fields...
  packageFamilyId   String
  durationMinutes   Int     @default(0)

  packageFamily     PackageFamily @relation(fields: [packageFamilyId], references: [id])

  @@index([packageFamilyId, isActive])
}
```

Add back-relation to `PackageFamily`:

```prisma
model PackageFamily {
  // existing fields from Spec 67...
  packages Package[]
}
```

Notes:

- `packageFamilyId` is non-nullable. Migration must assign every existing package to a family before the constraint is applied (see Migration below).
- `durationMinutes` defaults to 0 at the schema level for safe migration, but the service layer rejects 0/negative on create or edit.
- No `sessionTypeId` or `departmentId` stored on `Package` directly — derived through the family relation.

---

## Migration

Existing development data is reset before this series runs (per the lifecycle architecture decision), but the migration must still be correct because the seed creates packages.

Order of operations:

1. Add `packageFamilyId` to `Package` as nullable + add `durationMinutes` with default 0
2. Update the seed to assign every seeded package a `packageFamilyId` and a `durationMinutes > 0`. Use the `<SESSION_TYPE>_DEFAULT` family seeded in Spec 67 as the assignment target where the original session type can be inferred from the package name; otherwise assign to `KD_REGULAR_DEFAULT` (the broadest default).
3. Backfill any non-seed packages: if there are dev packages without a clear session type, map them to `KD_REGULAR_DEFAULT`. Document the mapping in the migration script.
4. In a second migration step, set `packageFamilyId` to non-nullable.

This two-step approach is required because nullable-then-required is the only safe path for a non-nullable FK on existing rows.

---

## Service Layer

`src/modules/packages/package.service.ts`:

- `createPackage` must require `packageFamilyId` and `durationMinutes > 0`. Validate the family exists and is active. Reject if invalid.
- `updatePackage` must allow changing `packageFamilyId` (re-classification) and `durationMinutes`. Editing the family does not retroactively change historical orders or invoices (existing invariant).
- `listPackages` must accept optional `departmentId` and `sessionTypeId` filters. Filter by joining through `PackageFamily → SessionType`.
- New helper `getPackageSessionType(packageId): { sessionTypeId, sessionTypeCode, departmentId, departmentCode }` — single query, used by downstream specs.
- Read models that already expose package data (booking detail, order detail, package list) must additionally expose the family name, session type name, and department name for display. These are read live from the relation — not snapshotted.

`src/modules/packages/package.schema.ts`:

- Add zod validation for `packageFamilyId` (cuid) and `durationMinutes` (positive integer).

---

## UI Requirements

### Package List

- Display columns: Package name, Department, Session Type, Family, Price, Duration, Active
- Add filter dropdowns: Department (active departments) and Session Type (active session types under the selected department; reset when department changes)
- Sort by family + name within the selected scope

### Package Create / Edit

- Step 1 cascade: Department → Session Type → Package Family. Each selector is disabled until the previous is chosen. Family options come from `PackageFamily` rows under the selected session type.
- After the family is chosen, the rest of the form (name, price, photoCount, bundleAdjustment, durationMinutes, items) is enabled.
- `durationMinutes` is a required positive integer input labeled "Session duration (minutes)".
- Editing an existing package preselects the cascade based on the package's current family. Changing the family is allowed but must show a confirmation: "This will change which session types can pick this package. Existing orders are not affected."

### Validation Errors

- Surface family-not-found and duration <= 0 errors inline near the offending field.

---

## Acceptance Criteria

- `Package.packageFamilyId` exists in Prisma as a non-nullable FK to `PackageFamily`
- `Package.durationMinutes` exists as `Int` with default `0`
- Migration runs cleanly on a reset dev database
- Every seeded package has a `packageFamilyId` and `durationMinutes > 0`
- Package create form requires Department → Session Type → Package Family cascade and a positive duration
- Package edit form preselects the cascade and allows reassignment
- Package list shows department, session type, family, and duration columns
- Package list filters by department and session type
- `getPackageSessionType(packageId)` helper returns the transitive session type and department
- `npx prisma validate` passes
- `npm run build` passes
- `npm run lint` passes
- `context/progress-tracker.md` is updated

---

## Decisions

- **Family is the only FK on Package.** Department and session type are read through the family relation rather than stored redundantly. Denormalizing was considered for query simplicity, but the join is one hop and a redundant FK creates a consistency problem if a family is ever moved between session types.
- **Duration is per-package, not per-session-type.** The package-arch review is explicit: NB Package 1 = 1 hour, NB Package 7 = 2 hours. A session-type default would be wrong from day one.
- **Schema default of 0 + service-layer guard.** Avoids a brittle three-step migration. The service layer is the only path that creates packages, so the invariant `durationMinutes > 0` holds for any package that actually reaches Booking or Order flows.
- **No package-family CRUD UI.** Families are seeded under session types and rarely change. Matching the precedent from Spec 25 (departments) and Spec 67 (session types) keeps catalog admin uniform.
- **Family change is allowed but flagged.** Reclassification is a real business operation (e.g., a package moves from one session type to another). Blocking it would force delete-and-recreate, which loses history. The confirmation dialog makes the intent explicit.

---

## Assumptions

- All existing dev packages can be mapped to one of the seeded `<SESSION_TYPE>_DEFAULT` families during migration. The Kids → Regular default is a safe catch-all for unclassifiable rows.
- The package admin UI is the only entry point for creating packages — no scripts or seeds outside the migration create them with arbitrary fields.
- Owner has accepted that changing a package's family does not retroactively reclassify historical orders or invoices.
