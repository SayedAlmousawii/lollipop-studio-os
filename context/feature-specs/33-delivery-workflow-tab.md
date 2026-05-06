## Goal

Make the Delivery tab operational so staff can move an order from ready-for-pickup through notification, pickup, and completion with enforceable workflow state.

---

## Read First

- `agents.md`
- `context/feature-specs/27-order-workflow-sub-status-foundation.md`
- `context/feature-specs/28-order-activity-audit-log-foundation.md`
- `context/feature-specs/29-tabbed-order-hub-ui-shell.md`
- `context/feature-specs/32-production-workflow-tab.md`

---

## Rules

- Keep this unit focused on delivery workflow only
- Use stored delivery state, not display-only labels
- Completion should be a controlled workflow action, not a free-form edit
- Allow admin-first override patterns only where the business rule explicitly permits them

---

## Scope

### In Scope

- Build the Delivery tab UI
- Show readiness, notification, pickup, and completion state
- Capture pickup notes and completion metadata
- Support the core delivery actions that move the order to completion

### Out of Scope

- SMS/WhatsApp/email automation
- Route logistics or shipping integrations
- Customer portal pickup confirmation
- Refund or post-delivery dispute handling

---

## Required UI

Show:

- ready for pickup state
- customer notification state
- pickup state
- delivered/completed state
- pickup notes
- completed by
- completed at

---

## Required Actions

- prepare for pickup
- send/record customer notification
- mark as picked up
- mark order completed

---

## Business Rules

An order should only be completed when:

- payment is settled or explicitly allowed by admin
- production is ready/completed
- pickup/delivery is recorded

The UI should explain why completion is blocked or requires override.

---

## Service Layer

Expected service behavior:

- validate delivery transition rules
- persist completion metadata
- support explicit admin override path if allowed
- record delivery/completion activity events

Do not place final-completion guards only in the UI.

---

## Acceptance Criteria

- Delivery tab shows readiness, notification, pickup, and completion state
- Staff can move the order through the main delivery actions
- Order completion enforces the defined business rule or explicit admin override
- Completion metadata is stored
- Significant delivery changes create activity records
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Update `context/progress-tracker.md`

---

## Assumptions

- V1 can treat pickup and final delivery as one internal completion path as long as notes and timestamps remain clear
