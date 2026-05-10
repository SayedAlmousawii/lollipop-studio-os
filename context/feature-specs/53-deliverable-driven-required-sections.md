**Status: Deferred — schema design needs review before implementation.**

---

## Goal

Encode which production sections are required for a given order based on its deliverables, and enforce that those sections are completed before production can be marked `READY_FOR_PICKUP`.

---

## Read First

- `context/reviews/workflow-guard-audit.md`
- `context/architecture-summary.md`
- `prisma/schema.prisma` — read the `OrderAddOnOption`, `OrderAddOn`, and `Package` models in full, and the `OrderActivityType` enum for context on the existing snapshot pattern
- `src/modules/orders/order.service.ts` — read the production workflow section: `markProductionReadyForPickup` case in `resolveProductionUpdate`, `buildProductionSections`, `resolveProductionReadinessWarning`, and how `OrderAddOn` rows are created when add-ons are saved

---

## Rules

- Schema changes are required — plan migration carefully before writing any service code
- Business rule enforcement lives in service functions, not server actions or UI
- No UI component changes beyond surfacing warnings already handled by existing mechanisms
- Required sections are determined at the time of the `READY_FOR_PICKUP` check — use the snapshot on `OrderAddOn`, not the live `OrderAddOnOption` state
- Do not backfill `deliverableTypeSnapshot` on existing `OrderAddOn` rows automatically — existing rows with null snapshots must not be blocked

---

## Background

P2b from the guard audit: "Which production sections are required depends on what deliverables are on the order. If an order has an album add-on, then `albumDesign` and `assemblyStatus` are required before `READY_FOR_PICKUP`. No such mapping or enforcement exists."

**Current state:**
- `OrderAddOnOption.category` is a free-text `String` with no schema-enforced values
- `OrderAddOn` carries `nameSnapshot` and `priceSnapshot` but no deliverable type snapshot
- `Package` has no deliverable defaults field
- The link between a deliverable type and its required production sections is implicit business knowledge not yet in the data model

**Why this was deferred from 52b:**
The guard cannot be written without knowing which deliverable types map to which sections. That mapping must first be encoded in the schema before the service can enforce it.

---

## Scope

### In Scope

1. Define a `DeliverableType` enum in `prisma/schema.prisma` and run the migration
2. Add a nullable `deliverableType` field to `OrderAddOnOption`
3. Add a nullable `deliverableTypeSnapshot` field to `OrderAddOn`, captured from the option at add-on selection time
4. Define the mapping from deliverable type to required production section fields — in service code, not schema
5. At `markProductionReadyForPickup`, compute which sections are required based on the order's add-on snapshots and assert they are completed
6. Update `resolveProductionReadinessWarning` to surface which required sections are still incomplete
7. Update `buildProductionSections` to expose a `required` flag on each section in the read model, so the production tab UI can indicate which sections must be done

### Out of Scope

- Package-level deliverable defaults — packages would need their own deliverable mapping; defer to a later unit
- Admin UI for setting `deliverableType` on `OrderAddOnOption` rows — out of scope; the admin updates these directly or via a later panel
- Backfilling `deliverableTypeSnapshot` on existing `OrderAddOn` rows — null snapshots are skipped by the guard

---

## Deliverable Types

Define these initial types in the enum. Validate the names against domain knowledge before finalizing — adjust if the studio uses different terminology:

| DeliverableType | Required production sections |
|---|---|
| `ALBUM` | albumDesignStatus, assemblyStatus |
| `PRINTS` | printingStatus |
| `FRAMED_PRINTS` | framedPrintsStatus |
| `VENDOR_ITEM` | vendorStatus |
| `DIGITAL_ONLY` | none |

This mapping lives in service code as a constant — it does not need to be in the schema.

---

## Migration Path

1. Add the `DeliverableType` enum and the two nullable columns — no data migration needed since both columns are nullable
2. Admin manually sets `deliverableType` on existing `OrderAddOnOption` rows as operational availability allows
3. New `OrderAddOn` rows automatically capture `deliverableTypeSnapshot` at selection time once the service change is deployed
4. Existing `OrderAddOn` rows with null snapshots are treated as having no deliverable requirements — the guard skips them

---

## Implementation Direction

Read the schema and the full production workflow section of `order.service.ts` before writing any code. Pay attention to how `OrderAddOn` rows are currently created (the snapshot pattern), how the `ProductionOrderState` query is structured, and how `buildProductionSections` and `resolveProductionReadinessWarning` use the order state.

**Schema changes**
Add the `DeliverableType` enum and the two nullable fields. The `OrderAddOnOption.deliverableType` field stores the canonical type. The `OrderAddOn.deliverableTypeSnapshot` field is a snapshot captured at selection time — follow the same snapshot pattern already used for `nameSnapshot` and `priceSnapshot`. Run a migration with a descriptive name.

**Deliverable-to-section mapping**
Define the mapping as a constant in `order.service.ts`. It maps each `DeliverableType` value to the set of production section fields that are required when that deliverable is on the order. `DIGITAL_ONLY` maps to an empty set.

**Capturing the snapshot**
Find where `OrderAddOn` records are created in the service when add-ons are saved or updated. When creating an `OrderAddOn`, read `deliverableType` from the associated `OrderAddOnOption` and write it to `deliverableTypeSnapshot`. If the option has no `deliverableType`, the snapshot is null. Read the existing add-on creation path carefully to understand how option data is fetched and how to slot the snapshot in without duplicating queries.

**Guard in `markProductionReadyForPickup`**
After the guards already present (editing prerequisite from 52a, dependency order from 52b), compute the set of required sections from the order's add-on snapshots. An add-on with a null snapshot contributes no requirements. For each required section, check whether it is `COMPLETED`. If any are not, throw with a staff-readable message that names the incomplete sections. The check must not block orders where all add-on snapshots are null.

Also include `orderAddOns` with their `deliverableTypeSnapshot` in the `ProductionOrderState` query if it is not already selected there.

**`resolveProductionReadinessWarning`**
Compute the required sections the same way as above and check for incomplete ones. If any are found, return a warning message that names the incomplete sections. Add this after the existing warnings.

**`buildProductionSections`**
Each section in the read model should indicate whether it is required for this specific order. Compute the required sections set from the order's add-on snapshots and expose a `required` flag on each `OrderProductionSection`. Read the existing `OrderProductionSection` type to understand what fields it already carries, then add `required` to it. The production tab UI can use this flag to show a visual indicator — this does not require any component changes if the type change is sufficient.

---

## Post-Implementation

**`context/progress-tracker.md`**
- Update Now section: Feature 53 complete; deliverable-driven section requirements enforced
- Add to Feature History: "Feature 53: Deliverable-driven required sections — DeliverableType enum added; OrderAddOnOption and OrderAddOn carry deliverable type; production READY_FOR_PICKUP enforces required sections based on active deliverables."

---

## Acceptance Criteria

1. `DeliverableType` enum exists in schema and migration ran cleanly
2. `OrderAddOnOption.deliverableType` is a nullable `DeliverableType` column
3. `OrderAddOn.deliverableTypeSnapshot` is a nullable `DeliverableType` column, populated at add-on selection time
4. `markProductionReadyForPickup` throws with a clear message when a required section is not completed
5. Orders with no typed add-on snapshots are not blocked — the guard is skipped gracefully
6. `resolveProductionReadinessWarning` names the incomplete required sections in its warning
7. `OrderProductionSection` read model includes a `required` flag per section
8. TypeScript passes
9. `npm run build` passes
10. `npm run lint` passes
11. Update `context/progress-tracker.md`

---

## Assumptions

- Package-level deliverable defaults are deferred — only add-on-driven requirements are enforced in this unit
- The admin sets `deliverableType` on `OrderAddOnOption` rows manually; this spec does not provide a UI for it
- Existing `OrderAddOn` rows with null snapshots are treated as having no requirements — no false blocks on live orders
