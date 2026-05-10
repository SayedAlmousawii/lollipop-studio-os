# Feature 54 — Operational Page Completion Review
Date: 2026-05-10

---

## Goal

Survey all main operational areas, document gaps that block daily staff use, and define implementation sub-units for each high-value gap. This is a review + spec document — no code is produced here. Sub-units 54a–54e are the action output.

---

## Read First

- `context/reviews/Next-build-plan-may-8.md` — Phase 3 goals and scope framing
- `src/modules/orders/order.types.ts` — `OrderFilters` interface (currently: search, orderStatus, invoiceStatus only)
- `src/modules/orders/order.service.ts` — `getOrders()`, `parseOrderFilters()`, `fetchOrders()` — understand the filter pipeline before touching it
- `src/components/bookings/booking-status-actions.tsx` — current status transition map (Pending → Confirm/Cancel; Confirmed → Cancel only)
- `src/modules/bookings/booking.service.ts` — `updateBookingStatus()` already handles NO_SHOW; verify transition guards before UI work

---

## Rules

- Each sub-unit must stay within its own scope; do not combine units
- No schema changes unless explicitly noted in the sub-unit
- Business logic stays in service files; UI only calls server actions
- Reuse existing patterns: follow `getOrders()` filter shape for 54d, follow `STATUS_ACTIONS` map pattern for 54c
- Do not add new packages

---

## Scope

### In Scope
- 54a: Editing queue page
- 54b: Production queue page
- 54c: Booking no-show UI (service already supports it)
- 54d: Orders list session-date and editor filters
- 54e: Ready-for-pickup quick filter on orders list

### Out of Scope
- Financial summary clarity, selection count bug, estimated editing date default → Feature 55
- Customer call log, bulk operations, email/print invoices → Phase 5
- No-show deposit refund logic → Feature 63 (policy not decided)
- Standalone payments list page → Phase 5 reporting
- Calendar server-side date scoping → deferred; client-side filtering is sufficient at current data volume

---

## Gap Analysis

### Bookings
Complete for daily use with one gap: confirmed bookings have no no-show path. The service (`updateBookingStatus()`) already handles `NO_SHOW` as a terminal status with the same service path as cancel. The UI (`booking-status-actions.tsx`) does not surface it — only Cancel is available on CONFIRMED bookings.

### Orders
The tabbed hub is complete. The orders list lacks two everyday filters: session date range (staff need "all sessions this week") and assigned editor (editors need "my queue"). `OrderFilters` has no date or staff fields. `fetchOrders()` already selects `booking.sessionDate` in its query — adding a where clause is the only service change needed.

### Invoices
Operationally complete for Phase 3: locking (`closeInvoice()`), adjustment invoice creation (`createAdjustmentInvoice()`), and payment recording all exist in both service and UI.

### Payments
Recorded through booking dialogs and invoice detail. No standalone page needed at this phase.

### Editing (workflow)
The editing tab inside the order hub covers single-order management. The major gap is cross-order visibility: editors cannot see all work assigned to them or all orders in editing state from one place. No `/editing` page exists.

### Production (workflow)
Same structural gap as editing: no cross-order production queue. Production staff must visit each order hub individually. No `/production` page exists.

### Delivery (workflow)
Orders in `READY_FOR_PICKUP` state are invisible at the list level unless the staff member knows to filter by status. The "Ready" filter exists in `OrderStatusFilter` but there is no prominent affordance to reach it quickly.

### Calendar
Operational for daily use: month/week navigation, department filter, and event popover all work. One structural gap: `getCalendarEvents()` fetches all bookings with no date range — everything loads upfront and filtering is client-side only. This is a future scale concern, not a daily blocker at current data volumes. No sub-unit needed at this phase; server-side date scoping should be deferred until data volume makes it necessary.

### Customer Profile Hub
Operationally complete: linked bookings/orders are visible and clickable, internal notes, child management, and activity timeline are all present.

---

## Sub-Units

---

### 54a — Editing Queue Page

#### Goal
Create a dedicated `/editing` page that shows all orders currently awaiting or undergoing editing, giving editors and admins a single view of active editing work.

#### Shipped
- `/editing` page at `app/editing/page.tsx` using the same server-component + table pattern
- `getEditingQueue()` service function queries `status IN (SELECTION_COMPLETED, EDITING)` — editors see both queued and active orders
- `SELECTION_COMPLETED` added to `OrderStatus` enum; completing selection auto-advances `order.status` from `WAITING_SELECTION` to `SELECTION_COMPLETED`
- Columns: Job Number (linked to order hub), Customer, Session Date, Editing Status, Assigned Editor
- Gated by `WORKFLOW_EDITING_UPDATE` permission (EDITOR + ADMIN; RECEPTIONIST redirected)

#### Acceptance Criteria
- [x] `/editing` page renders without error
- [x] Orders with `SELECTION_COMPLETED` or `EDITING` status appear; `WAITING_SELECTION` does not
- [x] Completing selection automatically advances `order.status` to `SELECTION_COMPLETED`
- [x] Each row links to the correct order hub
- [x] Page is accessible to EDITOR and ADMIN roles; redirects RECEPTIONIST
- [x] `npm run build` passes
- [x] `npm run lint` passes

---

### 54b — Production Queue Page

#### Goal
Create a dedicated `/production` page that shows all orders currently in the PRODUCTION workflow stage, giving production staff a single view of in-flight work.

#### Read First
- Same references as 54a — follow the identical page + table pattern
- `src/modules/orders/order.service.ts` — use `orderStatus: "PRODUCTION"` as the base filter
- Understand the `productionStatus` sub-status values (`NOT_STARTED`, `IN_PROGRESS`, `READY_FOR_PICKUP`, `COMPLETED`) in `order.constants.ts`

#### Implementation Direction
Create `app/production/page.tsx` mirroring the editing queue structure. Pre-applies `orderStatus: "PRODUCTION"`. Columns: job number, customer name, session date, production sub-status, section summary (optional — a simple "X sections complete" count is sufficient if individual section status adds too much complexity to the list view). Each row links to `/orders/[orderId]`. Add a nav link visible to STAFF and ADMIN roles. Permissions: require `order:read`.

#### Acceptance Criteria
- [ ] `/production` page renders without error
- [ ] Only orders with PRODUCTION workflow status appear
- [ ] Each row links to the correct order hub
- [ ] Page is accessible to STAFF and ADMIN roles
- [ ] `npm run build` passes
- [ ] `npm run lint` passes

---

### 54c — Booking No-Show Recording

#### Goal
Surface the `NO_SHOW` status transition for confirmed bookings in the UI. The service already supports it — this is a UI-only gap.

#### Read First
- `src/components/bookings/booking-status-actions.tsx` — the `STATUS_ACTIONS` map; currently `Confirmed` only has `Cancel Booking`
- `src/modules/bookings/booking.service.ts` — verify `updateBookingStatus()` handles `NO_SHOW` and what transition guard (if any) is in place for a CONFIRMED → NO_SHOW transition; confirm it is treated as a terminal state (no further transitions)
- `app/bookings/actions.ts` — `updateBookingStatusAction` already wires through to the service; no new action needed

#### Implementation Direction
Add `{ label: "Record No-Show", nextStatus: "NO_SHOW" }` to the `Confirmed` entry in `STATUS_ACTIONS`. Mark it as destructive so the confirmation dialog fires (same `isDestructive` flag used for cancel). The confirmation message should distinguish from cancellation — "Mark this booking as a no-show?" is sufficient. No service changes are needed. No schema changes. Verify in the service that a confirmed booking with or without base payment can transition to NO_SHOW (the business needs this path open regardless of payment state — a no-show means the customer didn't arrive, not that they paid). If the service has an unexpected guard blocking this, document it and ask before working around it.

#### Acceptance Criteria
- [ ] "Record No-Show" button appears on CONFIRMED bookings
- [ ] Confirmation dialog fires before submission
- [ ] Booking transitions to NO_SHOW status on confirm
- [ ] NO_SHOW bookings show no further action buttons (terminal state)
- [ ] No-show is visually distinct from cancelled in the status badge (verify `booking-status-badge.tsx` has a NO_SHOW case)
- [ ] `npm run build` passes
- [ ] `npm run lint` passes

---

### 54d — Orders List Session Date & Editor Filters

#### Goal
Add session-date range and assigned-editor filters to the orders list so staff can find "all sessions this week" and editors can find "orders assigned to me."

#### Read First
- `src/modules/orders/order.types.ts` — `OrderFilters` interface (add `sessionDateFrom?`, `sessionDateTo?`, `editorId?`)
- `src/modules/orders/order.service.ts` — `parseOrderFilters()` (extend to parse the new params) and `fetchOrders()` (add where clauses for date range and editor)
- `src/components/orders/orders-filters.tsx` — existing filter UI; add date pickers and an editor dropdown following the same URL-param pattern already used for `orderStatus` and `invoiceStatus`
- `app/orders/page.tsx` — how filters are read from searchParams and passed to `getOrders()`

#### Implementation Direction
Extend `OrderFilters` with three optional fields: `sessionDateFrom?: string` (ISO date), `sessionDateTo?: string` (ISO date), `editorId?: string`. In `parseOrderFilters()`, read and validate these from the raw filter object. In `fetchOrders()`, apply them to the Prisma `where` clause: `sessionDate >= sessionDateFrom` and `sessionDate <= sessionDateTo` on the nested `booking` relation; `editingJob.editorId === editorId` on the nested `EditingJob` relation (check the actual field name in the Prisma schema before writing the where clause). In `orders-filters.tsx`, add a date-from and date-to input (type="date" is sufficient — no calendar widget needed), and an editor dropdown populated from the active users list. The editor dropdown should only fetch users with the EDITOR or ADMIN role. Follow the same URL-param update pattern used by the existing status filters so the page is bookmarkable and server-rendered.

#### Acceptance Criteria
- [ ] Session date from/to filters narrow the orders list correctly
- [ ] Editor filter shows only orders with that editor assigned in the editing job
- [ ] Filters persist in the URL and survive page reload
- [ ] Clearing a filter removes it from the URL and resets the list
- [ ] `npm run build` passes
- [ ] `npm run lint` passes

---

### 54e — Ready for Pickup Quick Filter

#### Goal
Make orders in the READY_FOR_PICKUP state discoverable from the orders list without requiring staff to know the exact filter value to type.

#### Read First
- `app/orders/page.tsx` — how `orderStatus` filter is applied
- `src/components/orders/orders-filters.tsx` — existing filter UI
- Confirm that `orderStatus: "READY"` correctly surfaces orders with production sub-status READY_FOR_PICKUP (check `mapWorkflowStatus()` in `order.service.ts`)

#### Implementation Direction
Add a prominent "Ready for Pickup" quick-filter chip or shortcut button to the orders list page or filters area. Clicking it sets `orderStatus=READY` in the URL params — the same as if the staff member had selected "Ready" from the status dropdown. This is a UI affordance only; no service changes are needed. The chip should appear visually distinct (e.g., a highlighted badge showing the count of READY orders if easy to derive from existing data, otherwise just a button). Keep it simple — if count adds complexity, skip it and just add the shortcut link.

#### Acceptance Criteria
- [ ] "Ready for Pickup" shortcut appears on the orders list
- [ ] Clicking it filters the list to READY orders only
- [ ] The filter is reflected in the URL
- [ ] `npm run build` passes
- [ ] `npm run lint` passes

---

## Post-Implementation

After each sub-unit:
- Update `context/progress-tracker.md` with the sub-unit status
- Mark files created/modified

After all sub-units:
- Update `context/reviews/Next-build-plan-may-8.md` — mark Feature 54 complete, update Phase 3 state

---

## Acceptance Criteria (Feature 54 overall)

- [ ] All five sub-units (54a–54e) have their own spec section with Goal, Implementation Direction, and per-unit Acceptance Criteria ✅ (this document)
- [ ] Gap analysis for all eight operational areas is documented ✅ (this document)
- [ ] No code was written or modified as part of Feature 54 itself
- [ ] `context/progress-tracker.md` updated to show Feature 54 in progress
