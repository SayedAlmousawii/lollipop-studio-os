## Goal

Create a dedicated `/editing` page that shows all orders currently awaiting or undergoing editing (status `SELECTION_COMPLETED` or `EDITING`), giving editors a single view of their active work.

---

## Read First

- `app/orders/page.tsx` and `src/components/orders/orders-table.tsx` — follow the same page + table + server-action pattern
- `src/modules/orders/order.service.ts` — `getEditingQueue()`; queries `status IN (SELECTION_COMPLETED, EDITING)`
- `src/modules/orders/order.types.ts` — `EditingQueueItem` type

---

## Rules

- Schema change limited to adding `SELECTION_COMPLETED` to the `OrderStatus` enum — no table changes
- Business logic stays in service files; UI only calls server actions
- Reuse existing page + table + server-action pattern from orders list
- Do not add new packages

---

## Implementation Direction

`app/editing/page.tsx` uses the same server-component + table pattern as the orders list. A dedicated `getEditingQueue()` service function queries orders where `status IN (SELECTION_COMPLETED, EDITING)` and fetches job number, customer name, session date, editing sub-status (from `editingJob.status`), and assigned editor name (from `editingJob.assignedEditor`). Each row links to `/orders/[orderId]`. The page requires `WORKFLOW_EDITING_UPDATE` permission (no `order:read` exists in this system), which correctly allows EDITOR and ADMIN and redirects RECEPTIONIST. The sidebar nav link was already present.

**`SELECTION_COMPLETED` status:** Added to the `OrderStatus` enum. When `selectionStatus` transitions to `COMPLETED` and `order.status === WAITING_SELECTION`, the order automatically advances to `SELECTION_COMPLETED`. This makes the full stage progression: `WAITING_SELECTION → SELECTION_COMPLETED → EDITING → PRODUCTION → READY → DELIVERED`. `markStarted` advances from `SELECTION_COMPLETED` to `EDITING`; editing sub-statuses track granular progress within the stage.

---

## Acceptance Criteria

- [x] `/editing` page renders without error
- [x] Orders with `SELECTION_COMPLETED` or `EDITING` status appear; `WAITING_SELECTION` orders do not
- [x] Completing selection automatically advances `order.status` to `SELECTION_COMPLETED`
- [x] Each row links to the correct order hub
- [x] Page is accessible to EDITOR and ADMIN roles; redirects RECEPTIONIST
- [x] `npm run build` passes
- [x] `npm run lint` passes
