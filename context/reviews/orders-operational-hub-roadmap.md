# Orders Operational Hub Roadmap

## Purpose

This document gives Codex a clear roadmap for converting the current Orders area from a lightweight order summary/editor into a full operational hub for Studio OS.

Use this file as a reference when creating future unit feature specs. Do not implement everything at once. Each unit should be small, focused, reviewable, and aligned with the existing project architecture.

---

## Current Problem

The current Orders pages are a good early foundation, but they mostly behave like:

> "Here is the order information. You can edit some fields."

The intended architecture requires the Orders area to become:

> "The central workspace where the studio moves a customer job from booking/session completion through selection, editing, production, payment, delivery, and completion."

The Order page should eventually become the main operational hub for:
- customer/session context
- selected package and final package
- payment and invoice state
- selection workflow
- editing workflow
- production workflow
- delivery/pickup workflow
- activity history
- storage/media links
- operational actions

---

## Important Build Rule

Do not build the final tabbed UI first with fake or disconnected data.

Build the data and workflow foundation first, then build each UI tab on top of real service/module behavior.

The goal is to avoid a decorative UI that looks operational but does not actually control real workflow state.

---

## Target Order Hub UI Direction

The final Order detail page should use a clean tabbed layout instead of showing every workflow section at once.

Recommended tabs:

```text
Overview | Selection | Editing | Production | Delivery | Financials | Activity
```

### Header Area

The top of the page should show only the most important order context:

- order number / public order ID
- customer
- session date/time/type
- package summary
- financial summary
- overall workflow status
- primary next action

### Overview Tab

The Overview tab should show:
- next required action
- high-level workflow progress
- key order notes
- recent activity
- links to the most important related records

### Selection Tab

The Selection tab should show:
- selected photo count
- included photo limit
- extra photo count
- upgrade recommendation
- add-ons
- selection notes
- action to create/record payment adjustment

### Editing Tab

The Editing tab should show:
- assigned editor
- editing status
- editing progress
- revision status
- customer approval status
- actions like reassign editor, request revision, mark complete, send to production

### Production Tab

The Production tab should show:
- album design status
- printing status
- album assembly status
- vendor/outsource status
- framed prints status
- action to mark production ready for pickup

### Delivery Tab

The Delivery tab should show:
- ready for pickup status
- customer notification status
- picked up status
- delivered/completed status
- action to mark order completed

### Financials Tab

The Financials tab should show:
- invoice summary
- paid amount
- balance due
- payment stages
- package upgrade adjustments
- add-on adjustments
- link to full invoice/payment records

### Activity Tab

The Activity tab should show:
- chronological audit/activity timeline
- important order events
- payment events
- workflow status changes
- package/add-on changes
- assignment changes

---

## Recommended Unit Spec Sequence

The following unit specs .md files should be created first then implemented in order after approval.

---

# Unit 26 — Order Package Changes + Invoice Sync

## Goal

Make financially meaningful order edits update the invoice/payment layer correctly.

## Why This Matters

Currently, package and add-on edits can change the order without keeping invoice totals, adjustments, and balance due in sync.

## Required Behavior

When an order package changes:
- calculate upgrade/downgrade difference correctly
- update or create invoice adjustment lines
- update invoice total/balance due
- preserve payment history
- do not silently overwrite paid amounts

When add-ons change:
- calculate add-on totals
- update invoice adjustments
- update balance due

## Important Rule

Upgrade math should be based on the difference between the paid/original package and the final package, not simply selected package price minus original package price if the financial context is more specific.

## Expected UI Impact

The order edit flow should not just say “package changed.” It should show the financial consequence, such as:

```text
Package upgraded from Classic to Premium
Adjustment required: +200 KD
Invoice balance updated
```

---

# Unit 27 — Order Workflow Sub-Status Foundation

## Goal

Stop deriving all workflow labels from one flat order status. Add real workflow sub-status fields.

## Why This Matters

The future tabbed Order hub needs each department/workflow area to own its own state.

## Suggested Fields

Exact enum names can be adjusted by Codex based on current schema conventions.

Possible fields:

```text
selectionStatus
editingStatus
productionStatus
deliveryStatus
paymentStatus
```

## Example States

Selection:
```text
PENDING
IN_PROGRESS
COMPLETED
```

Editing:
```text
NOT_STARTED
ASSIGNED
IN_PROGRESS
REVISION_REQUESTED
AWAITING_APPROVAL
APPROVED
COMPLETED
```

Production:
```text
NOT_STARTED
WAITING_FOR_EDITING
IN_PROGRESS
WAITING_FOR_VENDOR
READY_FOR_PICKUP
COMPLETED
```

Delivery:
```text
NOT_READY
READY_FOR_PICKUP
CUSTOMER_NOTIFIED
PICKED_UP
COMPLETED
```

## Required Behavior

- Order status can remain as a high-level status.
- Sub-statuses should power the tabbed workflow UI.
- Do not fake sub-statuses from one flat status.
- Services should own status transitions.
- UI should read real stored workflow state.

---

# Unit 28 — Order Activity / Audit Log Foundation

## Goal

Create an activity timeline that can later power the Activity tab.

## Why This Matters

A real operational hub needs traceability:
- what happened
- who did it
- when it happened
- what changed

## Events to Track

Start with important events only:

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

## Suggested Data Shape

Possible table/model:

```text
OrderActivity
- id
- orderId
- userId nullable for now
- type
- title
- description
- metadata JSON
- createdAt
```

Since the system is currently admin-first, user/role enforcement can be simple for now. The important part is to create a traceable history structure.

---

# Unit 29 — Tabbed Order Hub UI Shell

## Goal

Build the main tabbed Order detail page structure.

## Why This Comes After Foundation

The shell should display real order, invoice, workflow, and activity data wherever available.

## Required UI

Create a clean Order detail layout with:

- page header
- order summary cards
- workflow summary/progress strip
- tabs:
  - Overview
  - Selection
  - Editing
  - Production
  - Delivery
  - Financials
  - Activity

## Scope

This unit should focus on layout and page structure only.

Do not fully implement every tab action yet.

## Overview Tab Content

Include:
- next action card
- order progress summary
- recent activity preview
- important notes
- links to customer, booking, invoice, and package records where available

---

# Unit 30 — Selection Workflow Tab

## Goal

Make the Selection tab operational.

## Required UI

Show:
- package photo limit
- selected photo count
- extra selected photos
- upgrade recommendation
- add-ons
- selection notes
- selection completed timestamp

## Required Actions

Possible actions:
- update selected photo count
- add/remove add-ons
- recommend upgrade
- mark selection completed
- create payment adjustment if needed

## Business Logic

The system should guide staff between:

```text
Keep current package + pay extras/add-ons
```

or

```text
Upgrade package + pay difference
```

This should reduce manual decision-making by staff.

---

# Unit 31 — Editing Workflow Tab

## Goal

Make the Editing tab operational.

## Required UI

Show:
- assigned editor
- assigned date
- editing status
- progress indicator
- edited photo count
- revision count
- customer approval state
- estimated completion date

## Required Actions

Possible actions:
- assign/reassign editor
- mark editing started
- request revision
- mark editing complete
- mark customer approved
- send to production

## Notes

This does not need full media upload support yet. It can reference external storage/manual links until the media system exists.

---

# Unit 32 — Production Workflow Tab

## Goal

Make the Production tab operational.

## Required UI

Show production sections for:
- album design
- printing
- album assembly
- vendor/outsource work
- framed prints
- final production readiness

## Required Actions

Possible actions:
- mark album design started/completed
- mark sent to print
- mark vendor work in progress/completed
- mark prints ready
- mark production ready for pickup

## Rule

Production should normally start after editing/customer approval is complete, unless a manager/admin overrides this later.

For now, since this is admin-first, the UI can show warnings instead of complex permission blocking.

---

# Unit 33 — Delivery Workflow Tab

## Goal

Make the Delivery tab operational.

## Required UI

Show:
- ready for pickup state
- customer notification state
- pickup state
- delivered/completed state
- pickup notes
- completed by
- completed at

## Required Actions

Possible actions:
- prepare for pickup
- send/record customer notification
- mark as picked up
- mark order completed

## Business Rule

An order should only be completed when:
- payment is settled or explicitly allowed by admin
- production is ready/completed
- pickup/delivery is recorded

---

# Unit 34 — Financials + Activity Tabs

## Goal

Complete the supporting tabs for financial visibility and operational traceability.

## Financials Tab Should Show

- invoice number
- invoice status
- package price
- upgrade adjustments
- add-on adjustments
- invoice total
- paid amount
- balance due
- payment stages
- links to invoice/payment records

## Activity Tab Should Show

- full chronological activity timeline
- filter by event type if simple
- most recent events first or grouped by date
- clear labels for financial, workflow, note, and assignment events

## Important

The Financials tab should be read-focused if invoice editing already belongs to the invoice module. Avoid duplicating too much invoice-editing logic directly inside the Order page.

---

## Admin-First Permission Approach

For now, Studio OS is being built admin-first.

That means:
- assume the active user is admin
- admin can perform all actions
- do not build a large role permission system yet

However:
- structure services so role checks can be added later
- keep sensitive operations in service/action layers, not only UI
- create activity/audit logs now so future user tracking can be added cleanly

Temporary assumption:

```ts
const currentUserRole = "ADMIN";
```

or use the existing project auth/user placeholder pattern if one already exists.

---

## Implementation Guidance for Codex

When creating each unit spec:

1. Read and fololw the style,structure of previous unit specs, eg.  `context/feature-specs/25-studio-departments.md`
2. Keep each unit small.

