## Goal

Add session-date range and assigned-editor filters to the orders list so staff can find "all sessions this week" and editors can find "orders assigned to me."

---

## Read First

- `src/modules/orders/order.types.ts` — `OrderFilters` interface (add `sessionDateFrom?`, `sessionDateTo?`, `editorId?`)
- `src/modules/orders/order.service.ts` — `parseOrderFilters()` (extend to parse the new params) and `fetchOrders()` (add where clauses for date range and editor)
- `src/components/orders/orders-filters.tsx` — existing filter UI; add date pickers and an editor dropdown following the same URL-param pattern already used for `orderStatus` and `invoiceStatus`
- `app/orders/page.tsx` — how filters are read from searchParams and passed to `getOrders()`

---

## Rules

- No schema changes
- Business logic stays in service files; UI only calls server actions
- Follow the existing URL-param filter pattern exactly — no new state management
- Do not add new packages (type="date" inputs are sufficient; no calendar widget)

---

## Implementation Direction

Extend `OrderFilters` with three optional fields: `sessionDateFrom?: string` (ISO date), `sessionDateTo?: string` (ISO date), `editorId?: string`. In `parseOrderFilters()`, read and validate these from the raw filter object. In `fetchOrders()`, apply them to the Prisma `where` clause: `sessionDate >= sessionDateFrom` and `sessionDate <= sessionDateTo` on the nested `booking` relation; `editingJob.editorId === editorId` on the nested `EditingJob` relation (check the actual field name in the Prisma schema before writing the where clause). In `orders-filters.tsx`, add a date-from and date-to input (type="date" is sufficient), and an editor dropdown populated from the active users list filtered to EDITOR and ADMIN roles. Follow the same URL-param update pattern used by the existing status filters so the page is bookmarkable and server-rendered.

---

## Acceptance Criteria

- [ ] Session date from/to filters narrow the orders list correctly
- [ ] Editor filter shows only orders with that editor assigned in the editing job
- [ ] Filters persist in the URL and survive page reload
- [ ] Clearing a filter removes it from the URL and resets the list
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
