## Goal

Create a lightweight order activity foundation so important order events become traceable and can later power the Activity tab.

---

## Read First

- `agents.md`
- `context/feature-specs/26-order-package-changes-invoice-sync.md`
- `context/feature-specs/27-order-workflow-sub-status-foundation.md`

---

## Rules

- Keep this unit focused on order activity/audit foundations only
- Track important events first; do not attempt a giant universal audit system
- Prefer structured metadata over long free-text logs
- Make writes happen in service/action layers, not directly in UI components
- Admin-first is acceptable for now, but data shape must allow future user attribution

---

## Scope

### In Scope

- Add an order activity record/model
- Define initial activity event types
- Record key order, financial, and workflow events from current order flows
- Add order activity reads needed for future timeline UI
- Store basic actor context where available

### Out of Scope

- Full cross-module audit system for the whole application
- Activity filtering UI
- Rich note/comment threads
- Customer-facing communication logs

---

## Events To Track

Start with:

```text
ORDER_CREATED
PACKAGE_CHANGED
ADD_ON_CHANGED
PAYMENT_RECEIVED
INVOICE_ADJUSTED
SELECTION_UPDATED
SELECTION_COMPLETED
EDITOR_ASSIGNED
EDITING_STATUS_CHANGED
PRODUCTION_STATUS_CHANGED
DELIVERY_STATUS_CHANGED
ORDER_COMPLETED
NOTE_ADDED
```

Additional event types are allowed only if needed to support the current order workflow units cleanly.

---

## Suggested Data Shape

Create a simple `OrderActivity` structure such as:

```text
id
orderId
userId nullable
type
title
description
metadata JSON
createdAt
```

Metadata should hold machine-usable context such as:

- old/new status values
- package IDs or names
- invoice/payment identifiers
- assigned editor ID

---

## Service Layer

Expected behavior:

- create helper utilities for recording order activity
- record activity inside the same transactional flow as the business event when appropriate
- expose timeline-safe read models for order pages

This unit should not require every historical event in the app to backfill perfectly. Focus on future correctness from the point of implementation onward.

---

## Integration Targets

At minimum, activity logging should be added to the order flows that already exist or are introduced immediately before/after this unit:

- order creation
- package change
- add-on change
- invoice adjustment caused by order edits
- workflow sub-status changes
- order completion

---

## Acceptance Criteria

- Order activity persistence exists
- Key event types are defined
- Core order events write activity records
- Activity reads can return chronological order history for one order
- Activity metadata is structured enough for future timeline rendering
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Update `context/progress-tracker.md`

---

## Assumptions

- `userId` may remain nullable in early admin-first flows if the current auth placeholder cannot provide a stable actor ID yet
