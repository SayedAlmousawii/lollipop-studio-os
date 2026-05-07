## Goal

Reduce the overloaded `Order` model by extracting production workflow state into dedicated `ProductionJob` records without changing the current business flow.

---

## Read First

- `agents.md`
- `context/project-overview-summary.md`
- `context/architecture-summary.md`
- `context/target-data-model.md`
- `context/reviews/current-database-er-diagram.md`
- `context/feature-specs/27-order-workflow-sub-status-foundation.md`
- `context/feature-specs/32-production-workflow-tab.md`
- `context/feature-specs/33-delivery-workflow-tab.md`

---

## Rules

- Preserve current production business rules unless a schema move requires a minimal compatibility adjustment
- Keep this unit focused on production extraction only
- Do NOT redesign editing, delivery, invoices, or package logic here
- Service-layer transitions must remain the source of truth
- Update `context/reviews/current-database-er-diagram.md` if the implemented schema shape changes

---

## Scope

### In Scope

- Add a dedicated `ProductionJob` model
- Move production-owned fields out of `Order`
- Backfill new production records from current `Order` data
- Update service-layer reads/writes so existing production workflows continue working through the new models

### Out of Scope

- Editing extraction
- Full delivery model redesign
- Vendor management expansion
- Reporting redesign beyond what is required to keep current reads correct

---

## Required Schema Direction

Create a `ProductionJob` model that owns production-phase concerns such as:

- `orderId`
- `jobId` or canonical job link
- `jobType` or section classification
- `status`
- started/completed timestamps
- vendor/context fields where applicable

The exact shape may reflect current workflow sections, but ownership should move away from storing many production workflow columns directly on `Order`.

---

## Migration Direction

- Backfill production records from the current production section fields in a deterministic way
- Keep enough compatibility on the `Order` read model so current pages do not break mid-migration
- Remove old `Order` production columns only when the new read/write path is stable

If a field cannot be mapped safely, keep it temporarily rather than losing workflow meaning.

---

## Service Layer

Expected service behavior:

- production actions read/write `ProductionJob`
- order detail reads compose production workflow state from the new sub-entities
- current validation rules and readiness/completion guards still apply

Do not leave duplicate writable sources of truth active longer than necessary.

---

## Acceptance Criteria

- Production workflow data has a dedicated persisted owner
- Existing production actions still work after migration
- Order pages can still render the expected production workflow state
- Current business rules remain intact
- `context/reviews/current-database-er-diagram.md` is updated if the implemented schema changes its described structure
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Migration deploy/status checks pass
- Update `context/progress-tracker.md`

---

## Assumptions

- V1 can keep production modeling pragmatic rather than introducing a full manufacturing subsystem
