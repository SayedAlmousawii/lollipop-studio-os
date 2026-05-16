## Goal

Make the existing Customers list page operational by wiring URL-driven search and status filters, then connecting the row actions to real routes.

---

## Read First 

- `agents.md`
- `context/feature-specs/09-customer-page-database-connection.md`
- `context/reviews/customers-page-gap-review.md`

---

## Rules

- Keep filtering URL-driven and server-rendered; do not add a separate client-side data source
- Do NOT add customer create/edit forms in this unit
- Do NOT add a full customer profile implementation in this unit
- If `New Booking` passes `customerId` in the URL, support only lightweight preselection; do not redesign the booking flow
- Do not modify the database schema

---

## Scope

### In Scope

- Read `search` and `status` from `searchParams` in `app/customers/page.tsx`
- Extend `getCustomers()` to accept optional filters
- Make the search input update the URL
- Make the status dropdown update the URL
- Wire row actions:
  - View Profile -> `/customers/[customerId]`
  - New Booking -> `/bookings/new?customerId=[customerId]`
  - Edit Customer -> `/customers/[customerId]/edit` if the route already exists later, otherwise render a disabled placeholder with clear "Coming soon" wording
- Add optional customer preselection support on `app/bookings/new/page.tsx` / `NewBookingForm` when `customerId` is present

### Out of Scope

- New customer creation
- Customer editing form
- Customer detail page UI
- Children CRUD
- New booking business logic changes beyond customer prefill

---

## Filtering Requirements

`getCustomers()` in `src/modules/customers/customer.service.ts` should support:

- `search?: string`
- `status?: "ACTIVE" | "INACTIVE"`

Behavior:

- `search` matches customer name and phone
- empty or whitespace-only `search` behaves as no filter
- invalid status values are ignored and treated as "all"
- default sort remains newest customers first unless an existing service rule says otherwise

---

## UI Requirements

### Customers Page

`app/customers/page.tsx` should:

- read the current URL filters from `searchParams`
- pass normalized filters into `getCustomers()`
- pass current values into `CustomersFilters`

### CustomersFilters

`src/components/customers/customers-filters.tsx` should:

- initialize from the current URL values
- update the query string when search/status changes
- preserve the other filter when one control changes
- reset `page`-like params if any are added later; for now only manage `search` and `status`

Debounced search is allowed if it stays simple; immediate URL updates are also acceptable.

### CustomersTable

`src/components/customers/customers-table.tsx` should:

- make row actions navigate to real routes
- avoid placeholder menu items that appear clickable but do nothing
- show a simple empty state row if no customers match the filters

---

## Booking Prefill Requirement

The `New Booking` row action should feel functional on first release.

Minimal support is enough:

- read `customerId` from the new booking page URL
- preselect the matching customer in the booking form when found
- ignore invalid or missing IDs safely

Do not add new booking validation or workflow behavior beyond that prefill.

---

## Acceptance Criteria

- Visiting `/customers?search=sara` filters the list by customer name or phone
- Visiting `/customers?status=ACTIVE` filters the list by active customers
- Updating the search box changes the URL and refreshes the list
- Updating the status filter changes the URL and refreshes the list
- Row actions no longer point to decorative menu items
- `View Profile` navigates to `/customers/[customerId]`
- `New Booking` navigates to `/bookings/new?customerId=[customerId]`
- The new booking form preselects the customer when a valid `customerId` is provided
- Empty filter results show a clear empty state
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Update `context/progress-tracker.md`

---

## Assumptions

- A temporary disabled `Edit Customer` action is acceptable in this unit if Feature 38 has not been implemented yet
- The existing booking page can accept a small UX enhancement for customer preselection without turning this into a booking feature rewrite
