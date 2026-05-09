# Customers Page – Gap Review
**Date:** 2026-05-07
**Covers:** Feature Specs 6 & 9 vs architecture-context.md and project-overview.md

---

## Features 6 & 9 — Status: Done
Both specs are fully implemented. The customers list page loads real DB data, the table renders all columns (name, phone, children, bookings, last session, status, actions), and the status badge works correctly.

---

## Buttons / UI That Do Nothing

| Element | Location | Issue |
|---|---|---|
| **New Customer** button | `app/customers/page.tsx` header | No `onClick`, no modal/form, no server action |
| **Search input** | `src/components/customers/customers-filters.tsx` | No state, no handler — purely decorative |
| **Status dropdown** | `src/components/customers/customers-filters.tsx` | No `onChange`, no filtering logic |
| **View Profile** menu item | `src/components/customers/customers-table.tsx` actions | Hardcoded string — no navigation |
| **New Booking** menu item | `src/components/customers/customers-table.tsx` actions | Hardcoded string — no navigation |
| **Edit Customer** menu item | `src/components/customers/customers-table.tsx` actions | Hardcoded string — no navigation |

---

## Missing Functions / Logic

| Missing | Notes |
|---|---|
| `createCustomer()` server action | No `app/customers/actions.ts` exists |
| `updateCustomer()` server action | Same — no CRUD actions file |
| Customer Zod schema | No `customer.schema.ts` (contrast: `booking.schema.ts` exists) |
| Filter params in `getCustomers()` | Service accepts no search/status arguments |
| URL-driven filter state | No `searchParams` wiring in `app/customers/page.tsx` |
| `getCustomerById()` | No detail/profile lookup function |

---

## Missing Pages / Routes

| Route | Purpose |
|---|---|
| `app/customers/[customerId]/page.tsx` | Customer profile / detail hub |
| `app/customers/new/page.tsx` (or modal) | Create customer form |

---

## Architecture vs Current State

From `architecture-context.md`, the Customers Module must own:

| Ownership | Current State |
|---|---|
| Parent/customer profile | ✗ No detail/profile page |
| Phone number | ✓ Stored and displayed in list |
| Linked children | ✗ Count shown; no add/view/edit children UI |
| Customer history | ✗ Last session date only — no full booking/order history |

From `project-overview.md`, Customer Management V1 features:

| Feature | Current State |
|---|---|
| Parent (phone-based) | ✓ Partial — list only, no create/edit |
| Children tracking | ✗ Count only — no management |
| Session history | ✗ Not implemented |

---

## What Needs to Be Built (Priority Order)

1. **Filter wiring** — pass `search` + `status` searchParams to `getCustomers()`, make filter inputs update the URL
2. **New Customer flow** — Zod schema + modal/form + `createCustomer` server action
3. **Edit Customer flow** — reuse form + `updateCustomer` server action
4. **Row action navigation** — wire View Profile → `/customers/[id]`, New Booking → `/bookings/new?customerId=[id]`
5. **Customer detail page** (`app/customers/[customerId]/page.tsx`) — profile, children list, linked bookings/orders
6. **Children management** — add/view/edit children within the customer profile

---

## Files to Modify / Create

| File | Action |
|---|---|
| `src/modules/customers/customer.service.ts` | Add filter params to `getCustomers`, add `getCustomerById` |
| `src/components/customers/customers-filters.tsx` | Add URL param wiring |
| `src/components/customers/customers-table.tsx` | Wire row action links to real routes |
| `app/customers/page.tsx` | Wire `searchParams` to service call |
| `app/customers/actions.ts` | Create (createCustomer, updateCustomer) |
| `src/modules/customers/customer.schema.ts` | Create Zod validation schema |
| `app/customers/[customerId]/page.tsx` | Create customer detail page |

---

## Architecture Notes
The Customers Module must **not** own invoices, job statuses, or production states — those belong to the Orders/Invoice modules. The customer profile should link to orders/bookings but not duplicate their data.
