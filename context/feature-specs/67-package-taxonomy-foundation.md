## Goal

Lay the schema foundation for the new package architecture by introducing two new catalog tables — `SessionType` and `PackageFamily` — scoped under the existing `StudioDepartment`. This is a schema + seed spec only. No model on `Booking`, `Package`, or `Order` is rewired in this unit; that work happens in the follow-up specs (68 Package model upgrade, 69 session-type pricing, 70 multi-package on Booking + Order).

The existing `SessionType` Prisma enum stays in place during this spec and is retired in Spec 70 when Booking is migrated to per-line session types.

---

## Read First

- `prisma/schema.prisma` — current `SessionType` enum and `StudioDepartment` model
- `context/feature-specs/25-studio-departments.md` — pattern for catalog tables seeded under department codes (`NB`, `KD`)
- `context/reviews/package-arch.md` — business hierarchy this spec encodes
- `context/architecture-summary.md` — module ownership rules

---

## Rules

- Schema + seed only — no service, action, or UI changes in this spec
- Do not modify `Booking`, `Package`, or `Order` models in this spec
- Do not remove the existing `SessionType` Prisma enum in this spec — it remains the source of truth for `Booking.sessionType` until Spec 70 rewires Booking
- Keep the catalog tables flexible: `PackageFamily` is modeled as a real table even though current business reality has one family per session type, so the business can add subdivisions later without a migration
- Catalog rows must have stable `code` values so identifier generation, future reporting, and downstream specs can reference them without relying on display names

---

## Scope

### In Scope

- Add `SessionType` model to Prisma (renamed from current enum target; see Naming Conflict)
- Add `PackageFamily` model to Prisma
- Seed the full catalog for both departments
- Run migration

### Out of Scope

- Adding `sessionTypeId` / `packageFamilyId` to `Package` (Spec 68)
- Adding `sessionTypeId` to `Booking` rows or to a new `BookingPackage` line (Spec 70)
- Removing the `SessionType` Prisma enum (Spec 70)
- Session-type-scoped pricing for extra photos (Spec 69)
- Any admin UI for managing session types or families
- Any service layer that reads these tables (added in dependent specs as needed)

---

## Naming Conflict

`SessionType` is already taken by a Prisma enum (`NEWBORN`, `KIDS`, `FAMILY`, `MATERNITY`, `OTHER`). Two Prisma identifiers cannot share a name.

Resolution: rename the existing enum to `BookingSessionType` in this spec (mechanical rename across all references in `src/`), then introduce the new `SessionType` model under the freed name. The enum remains in use on `Booking.sessionType` until Spec 70 retires it entirely.

Files known to reference the existing enum (verify before editing — there may be more):

- `src/components/bookings/new-booking-form.tsx`
- `src/components/bookings/edit-booking-form.tsx`
- `src/modules/calendar/calendar.service.ts`
- `prisma/schema.prisma`

Rename rule: `SessionType` → `BookingSessionType` everywhere it refers to the enum. Field name `Booking.sessionType` stays the same.

---

## Data Model

### SessionType (new)

```prisma
model SessionType {
  id           String   @id @default(cuid())
  code         String   @unique
  name         String
  departmentId String
  isActive     Boolean  @default(true)
  sortOrder    Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  department      StudioDepartment @relation(fields: [departmentId], references: [id])
  packageFamilies PackageFamily[]

  @@index([departmentId, isActive, sortOrder])
  @@map("session_types")
}
```

Update `StudioDepartment` to add the back-relation:

```prisma
model StudioDepartment {
  // existing fields...
  sessionTypes SessionType[]
}
```

### PackageFamily (new)

```prisma
model PackageFamily {
  id            String   @id @default(cuid())
  code          String   @unique
  name          String
  sessionTypeId String
  isActive      Boolean  @default(true)
  sortOrder     Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  sessionType SessionType @relation(fields: [sessionTypeId], references: [id])

  @@index([sessionTypeId, isActive, sortOrder])
  @@map("package_families")
}
```

A `Package` will later (Spec 68) link to exactly one `PackageFamily`, which transitively determines its `SessionType` and `Department`.

---

## Catalog Requirements

- `SessionType.code` is globally unique across all departments (so a `code` alone identifies the row unambiguously). Prefix codes by department where there is overlap risk — see Seed Data below.
- `PackageFamily.code` is also globally unique.
- Inactive rows must remain readable for historical references but must not appear in pickers (filtering applied in Spec 68 onward).
- `sortOrder` controls display order in future pickers.

---

## Seed Data

Departments already exist from Spec 25 (`NB`, `KD`).

### Session Types

Newborn department (`NB`):

| code | name | sortOrder |
|---|---|---|
| NB_NEWBORN | Newborn | 10 |
| NB_MATERNITY | Maternity | 20 |
| NB_GENDER_REVEAL | Gender Reveal | 30 |
| NB_HOSPITAL | Hospital | 40 |

Kids department (`KD`):

| code | name | sortOrder |
|---|---|---|
| KD_REGULAR | Regular | 10 |
| KD_BIRTHDAY | Birthday | 20 |
| KD_SPECIAL | Special | 30 |
| KD_MINI_SPECIAL | Mini Special | 40 |
| KD_SPECIAL_OCCASION | Special Occasion | 50 |
| KD_FAMILY | Family | 60 |
| KD_DUCK | Duck | 70 |

### Package Families

Seed one default family per session type. The business hierarchy in `package-arch.md` lists packages directly under session types, with no intermediate "family" name surfaced. Modeling the family table now keeps the schema ready for future subdivision (e.g., a "Premium" family added to Birthday) without another migration.

For every session type seeded above, create one `PackageFamily`:

- `code` = `<SESSION_TYPE_CODE>_DEFAULT` (e.g. `NB_NEWBORN_DEFAULT`)
- `name` = session type name + ` Packages` (e.g. `Newborn Packages`)
- `sessionTypeId` = id of the parent session type
- `sortOrder` = 10

This seeding decision is documented in Decisions below and should be revisited with the owner if/when packages are imported in Spec 68.

---

## Migration

- Generate a single Prisma migration that:
  - Renames the existing `SessionType` enum to `BookingSessionType`
  - Creates the `session_types` table
  - Creates the `package_families` table
- Run a seed script (or extend the existing seed) that idempotently creates the catalog rows above
- Existing development data is reset per the foundation pattern (memory: lifecycle architecture revision) — no production backfill concern

---

## Acceptance Criteria

- `SessionType` and `PackageFamily` models exist in `prisma/schema.prisma`
- The previous `SessionType` enum is renamed to `BookingSessionType` and all `src/` references compile
- `Booking.sessionType` still uses `BookingSessionType` and continues to function unchanged
- Migration runs cleanly on a reset dev database
- Seed creates 11 `SessionType` rows (4 NB + 7 KD) with the exact codes listed above
- Seed creates 11 `PackageFamily` rows, one per session type, with `<CODE>_DEFAULT` codes
- Re-running the seed is idempotent (upsert on `code`)
- `npx prisma validate` passes
- `npm run build` passes
- `npm run lint` passes
- `context/progress-tracker.md` is updated

---

## Decisions

- **Family table is real, not collapsed into session type.** Current business reality is one family per session type, but the package-arch review explicitly names `Package Family` as a hierarchy level. Modeling it now avoids a future migration if the business introduces subdivisions like "Birthday Standard" vs "Birthday Premium" under one session type.
- **Codes are department-prefixed.** `NB_NEWBORN` and `KD_BIRTHDAY` rather than just `NEWBORN` / `BIRTHDAY`. This keeps codes globally unique (matching the pattern used by `StudioDepartment.code`) and makes them self-describing in logs and reports.
- **The existing `SessionType` enum is renamed, not deleted, in this spec.** It still drives `Booking.sessionType` until Spec 70 rewires Booking to per-package session types. Deleting it now would require touching booking creation, edit, calendar, and identifier code — out of scope for a foundation spec.
- **One family per session type in the seed.** The package-arch doc lists packages directly under session types without naming intermediate families. Seeding one `_DEFAULT` family preserves the hierarchy in the schema while accurately reflecting today's business reality.
- **No admin UI in this spec.** Adding session types or families is a low-frequency operation; building CRUD UI now would expand scope without business need. Catalog changes go through seed updates until a CRUD need emerges.

---

## Assumptions

- Departments `NB` and `KD` from Spec 25 are present and their `id`s are stable; the seed script can look them up by `code`.
- The owner has confirmed the 11 session type names listed in `package-arch.md` are exhaustive for V1. New types will be added by extending the seed.
- The enum rename to `BookingSessionType` will not break Clerk auth, migrations, or any external integration — the enum is internal to Prisma and the application code.
