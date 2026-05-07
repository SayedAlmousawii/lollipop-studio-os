## Goal

Introduce the canonical `Job` entity and connect it to `Booking` first, establishing the shared operational job thread without changing the current business flow.

---

## Read First

- `agents.md`
- `context/project-overview-summary.md`
- `context/architecture-summary.md`
- `context/reviews/identifier-architecture-review.md`
- `context/reviews/current-database-er-diagram.md`
- `context/feature-specs/24-public-ids-and-job-number.md`

---

## Rules

- Preserve the current booking → order → invoice/payment → editing → production → delivery business flow
- Do NOT change financial formulas, workflow meanings, or user-facing permissions in this unit
- Keep `jobNumber` immutable and staff-facing
- Keep this unit narrowly focused on `Job` ownership plus `Booking.jobId`
- Update `context/reviews/current-database-er-diagram.md` if the implemented schema shape changes

---

## Scope

### In Scope

- Add a canonical `Job` model that owns the shared `jobNumber`
- Add `jobId` to `Booking`
- Backfill `Job` rows and `Booking.jobId` from existing booking data
- Update booking creation so new bookings create and attach to the canonical `Job`
- Keep current booking reads working during transition

### Out of Scope

- Adding `jobId` to `Order`, `Invoice`, or `Payment`
- Removing existing `jobNumber` columns
- Retiring booking/order/invoice `publicId` fields
- Rebuilding routing to use `jobNumber`
- Editing/production extraction

---

## Required Schema Direction

Add a `Job` entity with a shape similar to:

```text
id
jobNumber unique
customerId
createdAt
updatedAt
```

Add nullable-then-backfilled `Booking.jobId`.

After backfill, `Booking.jobId` should become required for active workflow records if the migration can do so safely.

Keep `Booking.jobNumber` temporarily so current reads and compatibility paths are not broken during transition.

---

## Migration Direction

- Create one `Job` row per distinct existing booking job number
- Backfill `Booking.jobId` from `Booking.jobNumber`
- Add the indexes needed for safe job lookups and joins
- Validate that every migrated booking points to the correct canonical job before tightening nullability

If any legacy booking cannot be mapped safely, fail loudly and document the data case rather than silently assigning an incorrect job.

---

## Service Layer

Expected service behavior:

- booking creation must create the `Job` row as part of the same transactional flow that generates the job number
- booking read models may continue exposing `jobNumber` for UI use
- new booking writes should treat `jobId` as canonical ownership even if `jobNumber` is still stored for compatibility

Do not move business logic into components, routes, or ad hoc migration helpers.

---

## Compatibility Guardrails

- Current user-facing workflow should behave the same after migration
- No visible identifier redesign is required in this unit beyond keeping current pages functional
- Existing code may continue reading `Booking.jobNumber` temporarily, but new writes should not treat it as the only source of truth

---

## Acceptance Criteria

- A canonical `Job` model exists
- `Booking` can reference `Job` through `jobId`
- Existing booking data is backfilled safely
- New booking writes attach to the correct `jobId`
- Current booking behavior continues to work without intentional workflow changes
- `context/reviews/current-database-er-diagram.md` is updated if the implemented schema changes its described structure
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Migration deploy/status checks pass
- Update `context/progress-tracker.md`

---

## Assumptions

- `jobNumber` remains the only staff-facing operational identifier even after `jobId` is introduced
- Transitional duplication of `jobNumber` may remain for compatibility until later cleanup units remove it deliberately
