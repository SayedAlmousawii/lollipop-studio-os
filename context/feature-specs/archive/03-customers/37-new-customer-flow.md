## Goal

Allow authorized studio users to create a new customer through a dedicated page and validated server action.

---

## Read First if needed

- `agents.md`
- `context/feature-specs/09-customer-page-database-connection.md`
- `context/reviews/customers-page-gap-review.md`

---

## Rules

- Use a full page route at `/customers/new`; do not use a modal in this unit
- Use the current Prisma model only; do not add database fields
- Keep validation shared so Feature 38 can reuse it
- Default new customers to active unless the current UI already needs explicit status selection
- Do NOT add children creation, booking creation, or customer detail expansion in this unit

---

## Scope

### In Scope

- Create `src/modules/customers/customer.schema.ts`
- Create customer creation validation for the current supported fields:
  - `name`
  - `phone`
  - `status` if exposed in the form
  - `notes` as optional
- Create a server action for customer creation
- Create `/customers/new/page.tsx`
- Add a reusable customer form component if that keeps Feature 38 smaller
- Link the Customers page `New Customer` button to the new route
- Redirect on success to either:
  - `/customers/[customerId]` if Feature 39 already exists, or
  - `/customers`

### Out of Scope

- Editing existing customers
- Children CRUD
- Booking creation
- Orders, invoices, or payment logic

---

## File Direction

Preferred files:

- `src/modules/customers/customer.schema.ts`
- `src/modules/customers/customer.service.ts`
- `src/components/customers/customer-form.tsx`
- `app/customers/actions.ts`
- `app/customers/new/page.tsx`
- `app/customers/page.tsx`

The action location may be adjusted to match an established customer-module convention, but create and update actions should end up co-located consistently.

---

## Form Requirements

The new customer form should capture only supported V1 data:

- full name
- phone number
- optional internal notes
- optional status selector only if it adds real operational value now

UX expectations:

- field-level validation errors
- disabled submit while saving
- success path redirects cleanly
- duplicate phone numbers surface a clear error message

---

## Service Layer

Add a dedicated service method for customer creation in `src/modules/customers/customer.service.ts`.

Expected behavior:

- validate normalized inputs from the action
- create the `Customer` row
- surface unique phone conflicts clearly
- keep Prisma access inside the service layer

---

## Acceptance Criteria

- Clicking `New Customer` from `/customers` opens `/customers/new`
- Submitting valid data creates a real customer record
- Invalid data shows field errors without crashing
- Duplicate phone numbers show a clear, user-friendly error
- Successful create redirects to the customer list or customer profile
- The form and action reuse the shared customer schema
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Update `context/progress-tracker.md`

---

## Assumptions

- Current V1 customer creation is limited to fields already present on the `Customer` model
- If the profile page does not exist yet, redirecting back to `/customers` is acceptable for the first release
