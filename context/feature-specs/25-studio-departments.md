## Goal

Create a database-backed `StudioDepartment` catalog and link bookings to it so department selection uses stable predefined options instead of free text.

---

## Read First

- `agents.md`
- `context/feature-specs/22-booking-model-and-flow-alignment.md`
- `context/feature-specs/24-public-ids-and-job-number.md`

---

## Rules

- Keep this unit focused on booking department modeling and form selection only
- Do not change booking status workflow
- Do not change deposit, invoice, payment, order, package, or commission logic except where references must keep compiling
- Preserve existing booking display behavior while moving the stored department relationship to a stable database record
- Keep raw department IDs internal-only; staff-facing UI should display department names/codes
- Keep the initial department catalog limited to:
  - Newborn
  - Kids

---

## Scope

### In Scope

- Add `StudioDepartment` model to Prisma
- Seed/backfill initial departments:
  - `Newborn` with code `NB`
  - `Kids` with code `KD`
- Link `Booking` records to `StudioDepartment`
- Migrate existing booking department text to a department relation
- Update booking creation to require a department ID from active departments
- Update booking edit to require a department ID from active departments
- Replace department text fields with dropdowns on:
  - Add Booking
  - Edit Booking
- Update booking list/detail/edit/calendar reads to display department name from the relation
- Update job-number department prefix generation to use the department code when available
- Update `context/progress-tracker.md`

### Out of Scope

- Department management CRUD screens
- Department permissions
- Department-specific package filtering
- Department-specific pricing
- Department-specific photographer assignment rules
- Calendar color customization by department
- Historical department audit log
- Renaming existing public IDs or existing job numbers

---

## Data Model

Add:

```prisma
model StudioDepartment {
  id        String    @id @default(cuid())
  name      String
  code      String    @unique
  isActive  Boolean   @default(true)
  sortOrder Int       @default(0)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  bookings Booking[]

  @@map("studio_departments")
}
```

Update `Booking`:

```prisma
model Booking {
  departmentId String
  department   StudioDepartment @relation(fields: [departmentId], references: [id])
}
```

Migration should backfill existing bookings using known text values where possible.

Fallback rule:

- Existing `department` values matching `Newborn`, `NEWBORN`, `NB`, or similar should map to Newborn
- Existing `department` values matching `Kids`, `KIDS`, `KD`, or similar should map to Kids
- Unknown existing values should map to Kids unless a safer current-data review suggests otherwise before implementation

After backfill, the old free-text `Booking.department` field should be removed only if all application reads are updated in the same unit.

---

## Department Requirements

- Departments must have stable unique `code` values
- `code` drives new booking job-number prefixes
- `name` is the staff-facing label
- Only active departments should appear in add/edit booking dropdowns
- Existing bookings should remain readable even if their department is later inactive

---

## Service Layer

Use the booking module or a small department module for department reads.

Required service behavior:

- Fetch active department options for booking forms
- Validate selected `departmentId` exists and is active during booking creation
- Validate selected `departmentId` exists during booking edit
- Booking read models should expose:
  - `departmentId`
  - department display name
  - department code when needed for identifier generation

Job-number generation should use the linked department code for new bookings. Existing immutable job numbers must not be changed.

---

## UI Requirements

### Add Booking

- Replace department text input with a dropdown
- Dropdown options come from active `StudioDepartment` rows
- Department is required
- Show validation errors near the field

### Edit Booking

- Replace department text input with a dropdown
- Current department should be preselected
- Department is required while booking is editable
- Preserve the existing disabled behavior for non-editable bookings

---

## Acceptance Criteria

- `StudioDepartment` exists in Prisma and database migration
- Seed/backfill creates Newborn and Kids departments
- Bookings link to a department by `departmentId`
- Add Booking uses a department dropdown from database options
- Edit Booking uses a department dropdown from database options
- Free-text department input is removed from add/edit forms
- Booking list/detail/edit/calendar views continue showing a readable department label
- New booking job numbers use `StudioDepartment.code`
- Existing job numbers are not renamed
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- `context/progress-tracker.md` is updated

---

## Decisions

- Use a database-backed catalog instead of a hard-coded UI-only dropdown because departments are now part of identifier generation and future reporting.
- Keep V1 catalog intentionally small: Newborn and Kids only.
- Do not add department admin screens in this unit.

---

## Assumptions

- It is acceptable to map unknown existing department text to Kids during migration unless current data inspection shows this would be unsafe.
- Existing immutable `jobNumber` values remain unchanged even if their legacy text department maps differently after migration.
