## Goal

Create a dedicated `/production` page that shows all orders currently in the PRODUCTION workflow stage, giving production staff a single view of in-flight work.

---

## Read First

- `app/orders/page.tsx` and `src/components/orders/orders-table.tsx` — follow the same page + table + filters + server-action pattern
- `src/modules/orders/order.service.ts` — use `orderStatus: "PRODUCTION"` as the base filter
- `src/modules/orders/order.constants.ts` — understand `productionStatus` sub-status values (`NOT_STARTED`, `IN_PROGRESS`, `READY_FOR_PICKUP`, `COMPLETED`)

---

## Rules

- No schema changes
- Business logic stays in service files; UI only calls server actions
- Mirror the editing queue structure from 54a exactly
- Do not add new packages

---

## Implementation Direction

Create `app/production/page.tsx` mirroring the editing queue structure. Pre-applies `orderStatus: "PRODUCTION"`. Columns: job number, customer name, session date, production sub-status, section summary (optional — a simple "X sections complete" count is sufficient if individual section status adds too much complexity to the list view). Each row links to `/orders/[orderId]`. Add a nav link visible to STAFF and ADMIN roles. Permissions: require `order:read`.

---

## Acceptance Criteria

- [ ] `/production` page renders without error
- [ ] Only orders with PRODUCTION workflow status appear
- [ ] Each row links to the correct order hub
- [ ] Page is accessible to STAFF and ADMIN roles
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
