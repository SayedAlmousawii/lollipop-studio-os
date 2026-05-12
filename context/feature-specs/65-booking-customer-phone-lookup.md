# Feature 65 — Booking Customer Phone Lookup & Find-or-Create

## Goal

Replace the name-based customer combobox on the new booking form with a phone-first lookup that matches the established identity model: phone is the unique customer key, name is display-only. If a customer exists for the entered phone they are attached automatically; if not, a new customer record is created from the phone and optional name in the same transaction. Duplicate customers from name confusion become impossible at the service layer.

## Read First

- `context/feature-specs/55e-customer-phone-enforcement.md` — original phone-as-primary-identifier spec
- `src/modules/customers/customer.service.ts` — `getCustomerPhoneSuggestions()`, `getCustomerByPhone()` — reuse these rather than writing new queries
- `src/modules/customers/customer.schema.ts` — `customerPhoneSchema` and `createCustomerSchema` — understand how phone is normalised and stored
- `src/modules/customers/customer.utils.ts` — `formatCustomerPhone()`
- `src/modules/bookings/booking.service.ts` — `createBookingInDb()` and `createBookingSchema` — the entry point being changed
- `src/components/bookings/new-booking-form.tsx` — current name-based combobox to replace
- `app/bookings/new/page.tsx` — currently loads all customers; that call is removed
- `app/(dashboard)/page.tsx` — reference for the existing phone suggestion UX pattern (Feature 57g)

## Rules

- Phone is required; name is optional — enforce in both the UI and the booking schema
- `findOrCreateCustomerByPhone()` must run inside the existing `createBookingInDb` transaction — not as a separate round-trip before booking creation
- If a customer is found by phone, the submitted `customerName` is ignored — do not overwrite the existing customer's name
- If a customer is created, they are created with `status: ACTIVE` and the submitted name; if no name is submitted, store an empty string — check `Customer.name` nullability in the schema before deciding between empty string or null
- Phone normalisation must use the same `customerPhoneSchema` transform already in `customer.schema.ts` — do not write a separate normalisation path
- The `initialCustomerId` query param from customer profile "New Booking" links must keep working — resolve to phone server-side before rendering; do not pass raw IDs into the form
- Do not load all customers on the page — `getCustomers()` call is removed entirely
- Do not modify the edit booking form in this unit — it already requires an existing customer and is out of scope

## Scope

### In Scope

- `customer.service.ts`: add `findOrCreateCustomerByPhone(tx, { phone, name? })` — looks up by normalised phone, creates if not found, returns `customerId`
- `booking.service.ts` / `booking.schema.ts`: replace `customerId` input with `phone` (required) + `customerName` (optional); call `findOrCreateCustomerByPhone()` inside the transaction before booking creation
- `app/bookings/new/page.tsx`: remove `getCustomers()` call; if `customerId` query param is present, resolve the customer's phone from the DB and pass as `initialCustomerPhone` to the form
- `new-booking-form.tsx`: replace `CustomerCombobox` with a phone input using live server-side suggestions (reuse `getCustomerPhoneSuggestions` via a server action — no new API route); suggestions show phone as primary, name as secondary; selecting a suggestion auto-fills the name as a read-only display; clearing the phone clears the name; if no suggestion is selected (new customer path), name field is a plain editable optional text input

### Out of Scope

- Edit booking form customer field
- Bookings table or list customer display
- Any other surface that references customers by name
- Retroactive cleanup of existing customer name data

## Implementation Direction

**Service layer first.** Add `findOrCreateCustomerByPhone(tx: PrismaClient, input: { phone: string; name?: string }): Promise<string>` to `customer.service.ts`. Normalise the phone using the same transform in `customerPhoneSchema`, query `customer.findUnique({ where: { phone } })`, return `id` if found. If not found, `customer.create` with the normalised phone, optional name, and `status: ACTIVE`. Return the new id.

Update `createBookingSchema` to replace `customerId: z.string()` with `phone: customerPhoneSchema` and `customerName: z.string().trim().max(120).optional()`. In `createBookingInDb`, call `findOrCreateCustomerByPhone` at the top of the transaction to resolve `customerId`, then proceed exactly as before.

**Page.** In `app/bookings/new/page.tsx`, remove `getCustomers()` entirely. If a `customerId` search param is present, do a lightweight `db.customer.findUnique({ where: { id }, select: { phone: true } })` to resolve the phone and pass it as `initialCustomerPhone`. The form no longer receives a customers list.

**Form.** Replace `CustomerCombobox` with a `CustomerPhoneInput` component following the dashboard phone suggestion pattern: debounced input (300ms), server-action-backed suggestions showing phone as primary and name as secondary, keyboard navigation, outside-click/Escape dismiss. On suggestion select: store the normalised phone in a hidden input, show the customer name in a read-only field below. If the receptionist types a phone that returns no suggestions (new customer): show an optional editable name text input instead of the read-only display. Pass `initialCustomerPhone` as the default value to pre-fill the field when coming from a customer profile link.

The existing `getCustomerPhoneSuggestions` in `customer.service.ts` is the correct data source — call it from a server action, not a new API route.

## Post-Implementation

- Update `context/progress-tracker.md` — Now section and Feature History

## Acceptance Criteria

- [ ] New booking form has no customer name combobox — replaced by phone input with live server-side suggestions
- [ ] Suggestions display phone as the primary label and name as secondary
- [ ] Selecting a suggestion locks the name to the existing customer's name (read-only)
- [ ] Entering a phone with no suggestion shows an optional editable name field
- [ ] Submitting with an existing customer phone attaches the booking to that customer without creating a duplicate
- [ ] Submitting with a new phone creates a customer record and attaches the booking
- [ ] Existing customer's name is never overwritten by the submitted name field
- [ ] `initialCustomerId` query param from customer profile "New Booking" link still pre-fills the phone field correctly
- [ ] `getCustomers()` is no longer called on the new booking page
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
