# 85 — Session Type Admin CRUD

## Goal

Give managers and admins a UI to create, edit, and archive session types without engineering involvement. Today `SessionType` is already a relational table, but its rows are populated only via `prisma/seed.ts` and any change requires a code deploy. This unit adds an admin-facing CRUD surface, an `active` flag for archive-only soft-delete, on-row calendar display fields to replace the hardcoded calendar lookup, and a frozen auto-generated `code` so the existing FK contract (`sessionTypeId` everywhere downstream) stays intact.

## Read First

- [prisma/schema.prisma:386-435](prisma/schema.prisma#L386-L435) — `StudioDepartment`, `SessionType`, `SessionTypeExtraPhotoPricing` models.
- [prisma/seed.ts:48-75](prisma/seed.ts#L48-L75) — current hardcoded `SESSION_TYPE_CATALOG`. This becomes the initial seed only; new types come from the UI afterward.
- [src/modules/calendar/calendar.service.ts:97-129](src/modules/calendar/calendar.service.ts#L97-L129) — hardcoded `CALENDAR_SESSION_TYPE_BY_CODE` / `CALENDAR_SESSION_TYPE_BY_DEPARTMENT_CODE`. Must move to row-level columns.
- [src/components/products/product-form.tsx](src/components/products/product-form.tsx) and [src/components/packages/package-form.tsx](src/components/packages/package-form.tsx) — CRUD form pattern (server action + `useActionState` + dialog) to mirror.
- [src/lib/permissions/index.ts:8-65](src/lib/permissions/index.ts#L8-L65) — permission registry. Reuse `PACKAGE_CATALOG_MANAGE` (already gates the pricing page).
- [app/pricing/page.tsx](app/pricing/page.tsx) — example of a permission-gated admin page in this codebase.

## Rules

- `SessionType.code` is **frozen after creation**. Codes appear as join keys in reconciliation SQL and historical logs; mutability would silently invalidate them.
- `SessionType.departmentId` is **frozen after creation**. Department is part of the row's identity; changing it after orders exist would migrate historical orders across departments.
- `SessionType` rows are **never hard-deleted**. Archive via `active = false`. Historical FKs from `OrderPackage`, `BookingPackage`, `PackageFamily`, and `SessionTypeExtraPhotoPricing` must remain valid.
- Names must be **unique per department**, case-insensitive. Names matching an archived row in the same department are **blocked** — managers must either un-archive the existing row or pick a different name. Prevents auto-generated code collisions and ambiguous reporting.
- Auto-generated code format: `{DEPARTMENT_CODE}_{SLUGIFIED_NAME}` (uppercase, non-alphanumerics → `_`). Examples: department `KD` + name "Birthday Party" → `KD_BIRTHDAY_PARTY`. Generation happens server-side at create time; the user never sees a code input.
- Calendar display attributes (`calendarLabel`, `calendarColor`) live on the row, set at create/edit time. The hardcoded calendar lookup tables are removed.
- This unit does not touch invoice math, reconciliation, the booking flow, or extra-photo pricing CRUD (that's a follow-up spec).

## Scope

### In Scope

- **Schema changes** in [prisma/schema.prisma](prisma/schema.prisma) on `SessionType`:
  - Add `active Boolean @default(true)`.
  - Add `calendarLabel String` (the human-friendly label currently in `CALENDAR_SESSION_TYPE_BY_CODE`).
  - Add `calendarColor String?` (nullable — falls back to department default at the calendar layer if unset).
  - Add a case-insensitive unique constraint on `(departmentId, lower(name))`. Implement via `@@unique([departmentId, name])` plus a citext-style migration, or a partial unique index — whichever fits the project's migration conventions.
  - Migration also backfills `calendarLabel` for existing rows from the current hardcoded `CALENDAR_SESSION_TYPE_BY_CODE` mapping, defaulting to `name` when no mapping exists.

- **Service layer** — new module `src/modules/session-types/session-type.service.ts`:
  - `listSessionTypes({ includeArchived?: boolean })` — returns rows ordered by department then name. Defaults to active-only.
  - `createSessionType({ departmentId, name, calendarLabel, calendarColor }, actor)` — validates, auto-generates `code`, persists. Throws on name collision (active OR archived in the same department).
  - `updateSessionType(id, { name?, calendarLabel?, calendarColor? }, actor)` — `departmentId` and `code` not accepted. Re-validates name uniqueness if name changes.
  - `archiveSessionType(id, actor)` — sets `active = false`. Idempotent.
  - `unarchiveSessionType(id, actor)` — sets `active = true`. Re-validates that no other active row in the same department now collides on name.
  - All mutations gated by `requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE)`.
  - Pure code-generation helper `generateSessionTypeCode(departmentCode, name): string` — exported and unit-tested in isolation.

- **Server actions** in `app/session-types/actions.ts` wrapping the service for `useActionState` consumption (mirror [app/orders/[orderId]/sales/actions.ts](app/orders/[orderId]/sales/actions.ts) shape).

- **Admin page** at `app/session-types/page.tsx`:
  - Permission-gated by `PACKAGE_CATALOG_MANAGE` at the page level (same as `/pricing`).
  - Lists session types grouped by department, with an "Include archived" toggle.
  - Each row shows: name, code (display-only), calendar label, calendar color swatch, archive status.
  - Per-row actions: Edit, Archive (or Unarchive if already archived).
  - "New session type" button → dialog with department picker + name + calendar label + calendar color.

- **Components** at `src/components/session-types/`:
  - `session-type-form.tsx` — create/edit dialog. Department is a select on create, a read-only display on edit. Mirrors the product-form pattern.
  - `session-type-table.tsx` — grouped table with the per-row actions.

- **Picker filtering** — every existing picker that lists session types must filter to `active = true`. Audit and update [src/components/bookings/new-booking-form.tsx](src/components/bookings/new-booking-form.tsx) and any other surface that surfaces session-type options (typically flowing through `getPackages()`-style helpers — fix at the source where possible).

- **Calendar refactor** in [src/modules/calendar/calendar.service.ts:97-129](src/modules/calendar/calendar.service.ts#L97-L129):
  - Replace `CALENDAR_SESSION_TYPE_BY_CODE` reads with the row's `calendarLabel`.
  - Replace `CALENDAR_SESSION_TYPE_BY_DEPARTMENT_CODE` fallback with `sessionType.calendarLabel ?? department.code` (or whatever the existing fallback semantics are — preserve behavior).
  - Color resolution similarly reads from `sessionType.calendarColor` with the existing default when null.
  - Delete the hardcoded constants once call sites are migrated.

- **Seed update** in [prisma/seed.ts](prisma/seed.ts):
  - Existing `SESSION_TYPE_CATALOG` entries gain `calendarLabel` (carrying forward the current hardcoded labels) and `calendarColor` (where defined).
  - Seed remains the initial-population mechanism only; it is no longer the source of truth.

- **Tests**:
  - Unit: `generateSessionTypeCode` — covers prefix joining, slugification of spaces / hyphens / non-ASCII, uppercasing.
  - Unit: service — create blocks name collision against active row, against archived row; archive is idempotent; unarchive re-validates collision; update rejects `departmentId` / `code` changes.
  - Integration: page renders for ADMIN / MANAGER, 403s for other roles.
  - Integration: archived session type does not appear in the booking-form picker.
  - Regression: existing calendar render with seeded session types produces the same `calendarLabel` and color before vs. after refactor (snapshot or value-equality check against current behavior).

### Out of Scope

- Extra photo pricing CRUD — separate follow-up unit. Today's flow ([prisma/seed.ts:130-191](prisma/seed.ts#L130-L191) seeds `SessionTypeExtraPhotoPricing` rows for every session type) means a newly-created session type will have no pricing row. **This unit must either:** (a) require the operator to follow up via SQL/seed (acceptable short-term, documented in the admin page UI as a banner: "After creating a session type, contact engineering to configure extra-photo pricing"), or (b) auto-create pricing rows with `unitPrice = 0` and let the follow-up CRUD spec set real values. **Recommendation: (b)** — the row exists, just zero-priced — so reconciliation joins do not become left-joins-with-null-handling. See `Implementation Direction §3`.
- Department CRUD. `StudioDepartment` rows remain seed-managed.
- Reordering session types in pickers (no `sortOrder` column).
- Bulk import / export.
- Audit log entries beyond what `requireCurrentAppUserPermission` already records.
- Renaming the `code` field or changing its format for existing rows.

## Implementation Direction

### 1. Code generation

`generateSessionTypeCode(departmentCode, name)`:
- Uppercase department code.
- Slugify name: trim, uppercase, replace runs of non-`[A-Z0-9]` with `_`, strip leading/trailing `_`.
- Concatenate as `{DEPT}_{SLUG}`.
- Pure function in `src/modules/session-types/session-type-code.ts`. No DB access — collision detection lives in the service via the name-uniqueness rule (which is one-to-one with code uniqueness given the format).

### 2. Name-uniqueness check

In the service, before insert/update/unarchive:
- Query for any `SessionType` in the same `departmentId` with `name ILIKE :name` (or equivalent for the project's chosen case-insensitive strategy). Include archived rows.
- If found and the row is not the one being updated, throw a typed error (`SessionTypeNameConflictError`) that the server action surfaces back as a form error.

### 3. Pricing-row auto-creation

On `createSessionType`, also create two `SessionTypeExtraPhotoPricing` rows (`DIGITAL` and `PRINT`) with `unitPrice = 0`, inside the same transaction. Keeps the reconciliation invariant ([src/modules/financial/reconciliation-invariants.ts:217-222](src/modules/financial/reconciliation-invariants.ts#L217-L222)) safe — the joins it performs continue to find a row. The follow-up pricing CRUD spec will set real values; until then the admin page surfaces a "pricing not yet configured" indicator next to any session type whose digital or print `unitPrice` is `0`.

### 4. Calendar refactor

Migrate in two commits within this unit if useful: (a) read the new columns *with the hardcoded constants as fallback*, (b) once seeded data is verified, delete the constants. Single commit is fine if the seed migration is rock-solid.

### 5. Implementation order

1. Schema migration + seed update (backfills `calendarLabel`, `active`, `calendarColor`).
2. Pure `generateSessionTypeCode` helper + unit tests.
3. Service module + unit tests (mock DB or use a test transaction).
4. Server actions.
5. Admin page + form + table.
6. Calendar service refactor — verify against existing render output.
7. Picker filtering audit (booking form, anywhere else surfacing session-type lists).
8. Tests + regression.

## Observability Checklist

### Dashboards / Metrics

- Counter: `session_type.create` / `session_type.update` / `session_type.archive` / `session_type.unarchive` — tagged with actor role and department.
- Counter: `session_type.name_conflict` — when a create/unarchive is blocked. Indicates managers hitting the archived-name rule; if frequent, may warrant reconsidering the rule.
- Counter: `session_type.pricing_zero` — gauge for session types currently at `unitPrice = 0` for either media type. Should trend to zero once the pricing CRUD ships.

### Rollback Plan

- Schema down-migration: drop `active`, `calendarLabel`, `calendarColor` columns and the new unique constraint. The `code` field and all FKs remain intact.
- Rolled-back deploys keep working: existing code paths read `code` and `name`, which are unchanged. Newly-created session types via the admin UI persist as ordinary rows; rolling back the schema would drop their `calendarLabel` / `calendarColor` but not the row itself — calendar would fall back to the hardcoded constants (which would no longer exist if also reverted, so revert as a pair).
- Non-recoverable data: `calendarColor` values entered by admins during the window the feature was live would be lost on rollback. Low impact — purely display.

### Customer-Visible Surface

- Staff (ADMIN/MANAGER): new "Session Types" admin page; ability to create/edit/archive session types and their calendar display attributes.
- Staff (other roles): no visible change. Pickers continue to show active session types.
- Customers: no direct change.

## Post-Implementation

- Update `context/architecture-summary.md` with the new service module and the calendar refactor (calendar labels/colors now live on `SessionType` rows).
- Update `context/ui-context-summary.md` with the new `/session-types` admin page.
- Update `context/progress-tracker.md`.
- File the follow-up spec for Extra Photo Pricing CRUD (this unit's prerequisite is now satisfied — managers can add session types; the pricing CRUD only needs to edit existing rows).

## Acceptance Criteria

- A user with `PACKAGE_CATALOG_MANAGE` can navigate to `/session-types`, create a new session type by picking a department and entering a name + calendar label + calendar color, and see it appear immediately in the booking-form picker.
- A user without `PACKAGE_CATALOG_MANAGE` receives a 403 on `/session-types`.
- Creating a session type named "Birthday" in a department that already has an active or archived "Birthday" row is rejected with a clear inline error.
- `SessionType.code` and `SessionType.departmentId` are not editable in the edit dialog.
- Archiving a session type removes it from the booking-form picker but the corresponding rows in `OrderPackage` / `BookingPackage` / `SessionTypeExtraPhotoPricing` remain unchanged and historical data continues to render correctly.
- Unarchiving a session type whose name collides with another active row in the same department is rejected with a clear error.
- The calendar renders the same labels and colors for all existing seeded session types after the refactor as it did before (regression-clean).
- `CALENDAR_SESSION_TYPE_BY_CODE` and `CALENDAR_SESSION_TYPE_BY_DEPARTMENT_CODE` no longer exist in the codebase; grep returns zero hits.
- A newly-created session type has two `SessionTypeExtraPhotoPricing` rows (`DIGITAL`, `PRINT`) at `unitPrice = 0`, and the admin page indicates "pricing not yet configured" for it.
- `npm run build` passes.
- `npm run lint` passes.
