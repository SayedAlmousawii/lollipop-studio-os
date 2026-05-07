## Goal

Reduce the overloaded `Order` model by extracting editing workflow state into a dedicated `EditingJob` entity without changing the current business flow.

---

## Read First

- `agents.md`
- `context/project-overview-summary.md`
- `context/architecture-summary.md`
- `context/target-data-model.md`
- `context/reviews/current-database-er-diagram.md`
- `context/feature-specs/27-order-workflow-sub-status-foundation.md`
- `context/feature-specs/31-editing-workflow-tab.md`

---

## Rules

- Preserve current editing business rules unless a schema move requires a minimal compatibility adjustment
- Keep this unit focused on editing extraction only
- Do NOT redesign production, delivery, invoices, or package logic here
- Service-layer transitions must remain the source of truth
- Update `context/reviews/current-database-er-diagram.md` if the implemented schema shape changes

---

## Scope

### In Scope

- Add a dedicated `EditingJob` model
- Move editing-owned fields out of `Order`
- Backfill new editing records from current `Order` data
- Update service-layer reads/writes so existing editing workflows continue working through the new model

### Out of Scope

- Production extraction
- Delivery model redesign
- Commission redesign
- Customer-facing approval portals

---

## Required Schema Direction

Create an `EditingJob` model that owns editing-phase concerns such as:

- `orderId`
- `jobId` or canonical job link
- `assignedEditorId`
- `status`
- `revisionCount`
- progress/timestamp fields
- notes/context fields if required

Ownership should move away from storing editing workflow columns directly on `Order`.

---

## Migration Direction

- Backfill one editing record per order where editing workflow data currently exists
- Keep enough compatibility on the `Order` read model so current pages do not break mid-migration
- Remove old `Order` editing columns only when the new read/write path is stable

If a field cannot be mapped safely, keep it temporarily rather than losing workflow meaning.

---

## Service Layer

Expected service behavior:

- editing actions read/write `EditingJob`
- order detail reads compose editing workflow state from the new sub-entity
- current validation rules and completion guards still apply

Do not leave duplicate writable sources of truth active longer than necessary.

---

## Acceptance Criteria

- Editing workflow data has a dedicated persisted owner
- Existing editing actions still work after migration
- Order pages can still render the expected editing workflow state
- Current business rules remain intact
- `context/reviews/current-database-er-diagram.md` is updated if the implemented schema changes its described structure
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Migration deploy/status checks pass
- Update `context/progress-tracker.md`

---

## Assumptions

- Delivery can remain order-owned for now if editing extraction is the main goal of this unit
