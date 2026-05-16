## Goal

Make the Production tab operational so staff can track the post-editing production pipeline inside the order hub.

---

## Read First

- `agents.md`
- `context/feature-specs/27-order-workflow-sub-status-foundation.md`
- `context/feature-specs/28-order-activity-audit-log-foundation.md`
- `context/feature-specs/29-tabbed-order-hub-ui-shell.md`
- `context/feature-specs/31-editing-workflow-tab.md`

---

## Rules

- Keep this unit focused on production workflow only
- Start with structured production tracking, not a full vendor management system
- Prefer warnings over complex role/permission blocking for now
- Use stored workflow state and service-owned transitions

---

## Scope

### In Scope

- Build the Production tab UI
- Show production sections for album design, printing, assembly, vendor/outsource work, framed prints, and final readiness
- Support core production progress actions
- Mark production readiness for pickup

### Out of Scope

- Vendor directory management
- Purchase orders or external print integrations
- Delivery completion controls
- Inventory/stock systems

---

## Required UI

Show production sections for:

- album design
- printing
- album assembly
- vendor/outsource work
- framed prints
- final production readiness

Each section should show current status clearly and support simple next-step actions.

---

## Required Actions

- mark album design started/completed
- mark sent to print
- mark vendor work in progress/completed
- mark prints ready
- mark production ready for pickup

---

## Workflow Rules

- Production should normally start after editing/customer approval is complete
- In admin-first V1, show warnings if staff move forward unusually early rather than blocking every edge case
- Marking production ready for pickup should update both production state and delivery readiness context as needed

---

## Service Layer

Expected service behavior:

- persist production section states
- validate major transition rules
- record production activity events
- expose a production summary read model suitable for the tab UI

If one top-level production sub-status is not enough for the tab, this unit may add section-level fields as long as scope remains production-only.

---

## Acceptance Criteria

- Production tab shows the main production pipeline sections
- Staff can update core production stages from the tab
- Production readiness for pickup is tracked in stored state
- Significant production changes create activity records
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Update `context/progress-tracker.md`

---

## Assumptions

- V1 can model production with a small set of internal statuses and notes rather than a full job-ticket system
