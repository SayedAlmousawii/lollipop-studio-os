## Goal

Make orders in the READY_FOR_PICKUP state discoverable from the orders list without requiring staff to know the exact filter value to type.

---

## Read First

- `app/orders/page.tsx` — how `orderStatus` filter is applied
- `src/components/orders/orders-filters.tsx` — existing filter UI
- `src/modules/orders/order.service.ts` — confirm that `orderStatus: "READY"` correctly surfaces orders with production sub-status READY_FOR_PICKUP (check `mapWorkflowStatus()`)

---

## Rules

- No schema changes
- No service changes
- UI affordance only: sets `orderStatus=READY` in URL params

---

## Implementation Direction

Add a prominent "Ready for Pickup" quick-filter chip or shortcut button to the orders list page or filters area. Clicking it sets `orderStatus=READY` in the URL params — the same as if the staff member had selected "Ready" from the status dropdown. This is a UI affordance only; no service changes are needed. The chip should appear visually distinct (e.g., a highlighted badge showing the count of READY orders if easy to derive from existing data, otherwise just a button). Keep it simple — if count adds complexity, skip it and just add the shortcut link.

---

## Acceptance Criteria

- [ ] "Ready for Pickup" shortcut appears on the orders list
- [ ] Clicking it filters the list to READY orders only
- [ ] The filter is reflected in the URL
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
