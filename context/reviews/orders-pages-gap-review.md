# Orders Pages Gap Review

## Scope

Reviewed:

- `app/orders/[orderId]/page.tsx`
- `app/orders/[orderId]/edit/page.tsx`
- `src/components/orders/edit-order-form.tsx`
- `app/orders/[orderId]/edit/actions.ts`
- `src/modules/orders/order.service.ts`

Compared against:

- `context/architecture-context.md`
- `context/project-overview.md`

Date: 2026-05-06

---

## Summary

The current order detail and edit pages are a solid early admin surface for:

- viewing order/customer/package/invoice summary
- editing final package
- editing selected photo count
- editing add-ons
- editing notes

But they are still materially behind the architecture and project overview in three important areas:

1. workflow depth
2. financial correctness
3. access control / traceability

They currently behave more like a lightweight order summary editor than the full workflow hub described in the project docs.

---

## Findings

### 1. No permission checks or role enforcement on order editing

Current behavior:

- `updateOrderAction` validates form data and calls `updateOrder()`
- `updateOrder()` updates package, selected photo count, add-ons, and notes
- no visible permission check exists in the page, action, or service

Relevant code:

- `app/orders/[orderId]/edit/actions.ts`
- `src/modules/orders/order.service.ts`

Why this is a gap:

The architecture says:

- every user must log in
- every action must be checked against role permissions
- sensitive actions require manager/admin permission

Relevant doc references:

- `context/architecture-context.md` - Auth Rules
- `context/architecture-context.md` - Role Permissions

Impact:

- any authenticated staff path that can reach this action may be able to change order data too broadly
- financial and workflow-sensitive edits are not protected by role

---

### 2. No audit logging for package or financial-impacting changes

Current behavior:

- order updates are saved directly
- no audit log entry is created when package, add-ons, or notes are changed

Relevant code:

- `src/modules/orders/order.service.ts`

Why this is a gap:

The architecture requires audit logging for:

- payment changes
- package changes
- commission changes
- financial overrides

The project principles also say actions must be traceable by who and when.

Relevant doc references:

- `context/architecture-context.md` - Core Invariants #7 and #11
- `context/project-overview.md` - System Principles

Impact:

- no historical accountability for sensitive changes
- managers cannot verify who changed package/add-on/financially relevant order data

---

### 3. Workflow status is flattened instead of using real sub-statuses

Current behavior:

- the order detail page shows selection, editing, production, and delivery statuses
- those values are not stored independently
- they are derived from a single `order.status` by `mapWorkflowStatus()`

Relevant code:

- `app/orders/[orderId]/page.tsx`
- `src/modules/orders/order.service.ts`

Why this is a gap:

The architecture explicitly separates ownership across:

- Orders
- Editing
- Production

It also states that editing, printing, album production, and pickup must be separate sub-statuses, not one flat status.

Relevant doc references:

- `context/architecture-context.md` - Module Responsibilities
- `context/architecture-context.md` - Core Invariants #8

Impact:

- the UI gives an impression of workflow detail that the data model does not really support
- different departments cannot independently own and update their part of the workflow
- reporting and operational visibility will be shallow or misleading

---

### 4. Package changes do not drive invoice/payment recalculation

Current behavior:

- edit page allows changing final package
- edit page allows changing add-ons
- service saves those order fields only
- no invoice total recalculation happens here
- no upgrade payment or add-on payment logic is applied here

Relevant code:

- `src/components/orders/edit-order-form.tsx`
- `src/modules/orders/order.service.ts`

Why this is a gap:

The project overview expects:

- dynamic pricing
- multi-stage payments
- package upgrades and add-ons to work correctly
- automatic calculation of upgrades/add-ons

The architecture assigns invoice totals and payment stages to the invoice/payment area.

Relevant doc references:

- `context/project-overview.md` - Goals
- `context/project-overview.md` - Invoice & Payment System
- `context/project-overview.md` - Success Criteria / Definition of Done
- `context/architecture-context.md` - Invoice / Payment Module

Impact:

- order edits can diverge from invoice/payment reality
- staff can change financially meaningful order data without the financial layer staying in sync

---

### 5. Upgrade math shown in UI does not match the architecture rule

Current behavior:

- edit UI shows `selected package price - original package price`

Relevant code:

- `src/components/orders/edit-order-form.tsx`

Why this is a gap:

The architecture says upgrade charges must be based on the difference between:

- original paid package
- final package

Not simply original package price vs selected package price.

Relevant doc references:

- `context/architecture-context.md` - Core Invariants #5

Impact:

- staff may see the wrong upgrade expectation
- even if this is display-only today, it reinforces the wrong business rule

---

### 6. Invoice creation flow is missing from the order page

Current behavior:

- if an invoice exists, the page links to it
- if an invoice does not exist, the page shows a disabled `Create Invoice` button
- no creation path is available from the order detail page

Relevant code:

- `app/orders/[orderId]/page.tsx`

Why this is a gap:

The project overview includes:

- invoice generation
- payment tracking

Relevant doc references:

- `context/project-overview.md` - Invoice & Payment System

Impact:

- a staff member can reach the order page and still be unable to complete the financial workflow
- operational flow is interrupted at a core V1 step

---

### 7. Selection workflow support is too thin

Current behavior:

- edit page allows entering selected photo count
- it shows included photos and extra photos
- add-ons are manually typed
- there is no clear recommendation flow for:
  - keep package + pay add-ons
  - upgrade package + pay difference

Relevant code:

- `src/components/orders/edit-order-form.tsx`

Why this is a gap:

The project overview expects the selection system to:

- track selected photos
- compare against package limits
- suggest upgrades vs add-ons

Relevant doc references:

- `context/project-overview.md` - Selection System
- `context/project-overview.md` - Selection Phase
- `context/project-overview.md` - Payment Adjustment Phase

Impact:

- the user must manually reason through the next pricing step
- the system is not yet guiding the staff through the intended selection-to-payment workflow

---

### 8. Editing workflow is visible only as text, not as operational controls

Current behavior:

- detail page displays an `Editing status`
- there is no editing assignment UI
- there is no revision loop UI
- there is no customer approval workflow surface

Why this is a gap:

The project overview expects editing workflow support for:

- assigning editors
- tracking status
- revision loops

The architecture gives the Editing module clear ownership over:

- assigned editor
- edit status
- revision loop
- edit complete flag
- customer approval status

Relevant doc references:

- `context/project-overview.md` - Editing Workflow
- `context/architecture-context.md` - Editing Module

Impact:

- the order page cannot act as a real handoff point into editing operations
- much of the editing lifecycle still appears to live outside the system

---

### 9. Production and delivery workflow are not fully represented

Current behavior:

- detail page displays `Production status` and `Delivery status`
- these are derived labels, not full workflow controls
- there is no visible support for:
  - print job status
  - album design status
  - vendor album status
  - ready for pickup tracking
  - pickup completion details

Why this is a gap:

The architecture and project overview expect production/delivery workflow tracking inside the system.

Relevant doc references:

- `context/project-overview.md` - Production Phase
- `context/project-overview.md` - Delivery Phase
- `context/project-overview.md` - Production Tracking
- `context/architecture-context.md` - Production Module
- `context/architecture-context.md` - Core Invariants #10

Impact:

- delivery readiness cannot be reliably managed from actual production work
- order completion can become a label rather than an enforced workflow outcome

---

### 10. Synology/manual folder link support is absent from the order pages

Current behavior:

- no visible field or section for manual Synology folder link/path

Why this is a gap:

The architecture states that in V1 the order record should store a manual Synology folder link/path.

Relevant doc references:

- `context/architecture-context.md` - Synology NAS / V1 approach

Impact:

- the order page is missing one of the documented operational links between business data and actual media storage

---

### 11. The order detail page is mostly informational, not a workflow console

Current behavior:

- view summary
- edit order
- open invoice if present

Why this is a gap:

The project vision is that a session should move from booking to delivery entirely inside the system, with clear visibility and action paths for each department.

Relevant doc references:

- `context/project-overview.md` - Goals
- `context/project-overview.md` - Success Criteria
- `context/project-overview.md` - Definition of Done

Impact:

- visibility exists, but operational completion still depends on missing workflows
- the pages do not yet serve as the central control surface described by the project

---

## What The Current Pages Do Well

- Clear summary presentation of customer, package, invoice, and order basics
- Basic package replacement flow already exists
- Selected photo count and simple overage visibility exist
- Add-ons can be captured
- Delivered orders are protected from editing at the service level
- Business logic is kept in the service layer rather than in the page component

These are a good foundation. The main issue is not quality of the current slice; it is that the slice is still much narrower than the documented system behavior.

---

## Recommended Fix Order

### Unit 1: Security and traceability

Focus:

- permission checks for order view/edit actions
- role-aware editing restrictions
- audit logging for package/add-on/manual override changes

Why first:

- this protects the system before expanding sensitive workflows

---

### Unit 2: Financial correctness around order edits

Focus:

- align upgrade math with paid-package rule
- connect package/add-on changes to invoice/payment consequences
- expose a proper create invoice path if missing

Why next:

- package editing without financial correctness will create inconsistent business data

---

### Unit 3: Real workflow sub-status model

Focus:

- separate selection/editing/production/delivery statuses
- stop deriving all workflow labels from a single flat order status

Why next:

- this is the foundation for department-owned workflow updates

---

### Unit 4: Selection decision workflow

Focus:

- guide staff between:
  - keep package + add-ons
  - upgrade package + difference payment
- make over-limit photo handling more structured

Why next:

- this is where order logic, package logic, and payments meet in daily operations

---

### Unit 5: Editing, production, and delivery operations

Focus:

- editor assignment
- revision loop
- production job tracking
- delivery readiness / pickup completion

Why next:

- this is needed to match the project’s end-to-end workflow promise

---

### Unit 6: Synology/manual storage linkage

Focus:

- manual NAS folder path/link on the order
- visible storage section on detail page

Why later:

- operationally useful, but less foundational than security, finance, and workflow correctness

---

## Proposed Feature Candidates

Possible next-unit specs that would address these gaps cleanly:

1. `Order permissions + audit logging`
2. `Order package changes + invoice sync`
3. `Order workflow sub-status foundation`
4. `Selection decision flow`
5. `Editing assignment and revision tracking`
6. `Production and delivery tracking`
7. `Order Synology folder link`

---

## Final Take

The current order pages are a good skeleton, but they are still much closer to:

- summary
- basic editing

than to the full:

- state-driven
- department-aware
- financially reliable
- end-to-end operational workflow

described in the architecture and project overview.
