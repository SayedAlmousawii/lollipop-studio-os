## Goal

Allow authorized studio users to update an existing customer using a dedicated edit page and the shared customer form/schema.

---

## Read First

- `agents.md`
- `context/feature-specs/37-new-customer-flow.md`
- `context/reviews/customers-page-gap-review.md`

---

## Rules

- Reuse the shared customer schema and form from Feature 37
- Limit editing to fields already on the `Customer` model
- Do NOT add child editing in this unit
- Do NOT expand this unit into a full customer dashboard
- Do not modify the database schema

---

## Scope

### In Scope

- Add `updateCustomer()` server action
- Create `/customers/[customerId]/edit/page.tsx`
- Load the current customer values into the form
- Wire the customer list row action to the edit route
- Save updates through the service layer
- Redirect back to the customer profile if available, otherwise to `/customers`

### Out of Scope

- Children editing
- Booking/order editing
- Invoice/payment logic
- Customer profile dashboard expansion

---

## Route Requirements

`app/customers/[customerId]/edit/page.tsx` should:

- fetch the current customer from the service layer
- render a not-found state if the customer does not exist
- pass default values into the shared customer form

Do not query Prisma directly from the page.

---

## Service Layer

Add the smallest service support needed for edit loading and saving:

- `updateCustomer()` mutation method
- a read helper for a single customer record if one does not already exist

Expected behavior:

- update `name`, `phone`, `status`, and `notes` only
- guard unique phone conflicts with a clear error
- keep data normalization consistent with Feature 37

---

## Acceptance Criteria

- `Edit Customer` from the customers list opens `/customers/[customerId]/edit`
- Existing customer values are preloaded into the form
- Submitting valid changes updates the real customer record
- Validation errors and duplicate phone conflicts surface clearly
- Missing customer IDs render a proper not-found path
- The edit flow reuses the shared customer schema and form from Feature 37
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Update `context/progress-tracker.md`

---

## Assumptions

- If Feature 39 is not implemented yet, redirecting to `/customers` after save is acceptable
- A focused single-record read helper is acceptable even if the richer profile read model arrives in Feature 39
