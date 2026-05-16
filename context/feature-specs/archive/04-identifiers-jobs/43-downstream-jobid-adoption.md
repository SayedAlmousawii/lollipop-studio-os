## Goal

Extend canonical job ownership to downstream workflow records by attaching `Order`, `Invoice`, and `Payment` to `Job` through `jobId`.

---

## Read First

- `agents.md`
- `context/reviews/identifier-architecture-review.md`
- `context/reviews/current-database-er-diagram.md`
- `context/feature-specs/42-job-entity-booking-foundation.md`

---

## Rules

- Preserve the current booking/order/invoice/payment workflow behavior
- Do NOT change financial formulas, numbering rules, or user-facing permissions in this unit
- Keep this unit focused on downstream `jobId` adoption only
- Reuse the canonical `Job` introduced in Feature 42 rather than inventing parallel linkage
- Update `context/reviews/current-database-er-diagram.md` if the implemented schema shape changes

---

## Scope

### In Scope

- Add `jobId` to `Order`
- Add `jobId` to `Invoice`
- Add `jobId` to `Payment`
- Backfill downstream `jobId` references from existing workflow-linked data
- Update service-layer creation flows so new downstream records attach through `jobId`
- Keep current reads working while the old propagated `jobNumber` fields still exist during transition

### Out of Scope

- Removing existing `jobNumber` columns in the same unit
- Retiring booking/order/invoice `publicId` fields
- Rebuilding routing to use `jobNumber`
- Editing/production extraction
- Add-on restructuring

---

## Required Schema Direction

Add nullable-then-backfilled `jobId` references to:

- `Order`
- `Invoice`
- `Payment`

After backfill, these references should become required where the record is part of the active workflow chain and the migration can tighten them safely.

Keep the existing `jobNumber` string fields temporarily so current reads and compatibility paths are not broken during transition.

---

## Migration Direction

- Backfill `Order.jobId` through its linked booking
- Backfill `Invoice.jobId` through its linked booking/order chain and existing job number data
- Backfill `Payment.jobId` through its linked invoice chain and existing job number data
- Add indexes needed for safe downstream job joins
- Validate that migrated records point to the correct canonical job before removing transitional nullability

If any legacy rows cannot be mapped safely, fail loudly and document the data case rather than silently assigning an incorrect job.

---

## Service Layer

Expected service behavior:

- order creation must reuse `jobId` from the linked booking
- invoice creation must reuse `jobId` from the linked booking/order chain
- payment creation must reuse `jobId` from the linked invoice chain
- read models may continue exposing `jobNumber` for UI use, but should source it from canonical job ownership where practical

Do not move business logic into components, routes, or ad hoc migration helpers.

---

## Compatibility Guardrails

- Current user-facing workflow should behave the same after migration
- Existing queries that still rely on `jobNumber` may remain temporarily, but new writes should treat `jobId` as canonical
- No visible identifier redesign is required in this unit beyond keeping current pages functional

---

## Acceptance Criteria

- `Order`, `Invoice`, and `Payment` can each reference `Job` through `jobId`
- Existing downstream data is backfilled safely
- New order/invoice/payment writes attach to the correct `jobId`
- Current business flow continues to work without intentional workflow changes
- `context/reviews/current-database-er-diagram.md` is updated if the implemented schema changes its described structure
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Migration deploy/status checks pass
- Update `context/progress-tracker.md`

---

## Assumptions

- The old propagated `jobNumber` strings may remain temporarily for compatibility until a later cleanup unit removes them deliberately
