# Customer Module Completion Roadmap

## Purpose

This document gives Codex a clear roadmap for completing the Customers module in Studio OS.

Do not implement the customer module directly from this document. Instead, use this roadmap as the reference source to create separate upcoming unit feature spec files.

The current Customers page is implemented as a real database-backed list, but it is still mostly read-only. The next goal is to turn it into a complete operational customer management module.

Reference review: `/context/reviews/customers-page-gap-review.md`

## Current State

The Customers list page already:

- Loads real database data
- Shows customer name, phone, children count, bookings count, last session, status, and actions
- Displays status badges correctly

However, several UI controls are currently decorative:

- New Customer button
- Search input
- Status dropdown
- View Profile action
- New Booking action
- Edit Customer action

The module also lacks:

- Customer create/update server actions
- Customer Zod validation schema
- Search/status filtering logic
- Customer profile/detail page
- Child management UI
- Full customer history view

## Architecture Boundary

The Customers module should own:

- Parent/customer profile
- Phone number and contact details
- Linked children
- Customer notes/preferences
- Customer-level history links

The Customers module should not own:

- Invoice logic
- Payment logic
- Job production status
- Editing queue status
- Order fulfillment state

Those belong to the Invoice, Payment, Orders, and Production modules.

Customer pages may display linked bookings/orders, but should not duplicate their data.

---

# Recommended Unit Feature Specs

## Feature 36 — Customer Filters and Row Actions

### Goal

Make the existing Customers list page functional by wiring search, status filtering, and row action navigation.

### Scope

Create a unit feature spec that covers:

- Passing `search` and `status` from URL search params into the customers service
- Updating `getCustomers()` to support optional filters
- Making the search input update the URL
- Making the status dropdown update the URL
- Wiring row actions:
  - View Profile → `/customers/[customerId]`
  - New Booking → `/bookings/new?customerId=[customerId]`
  - Edit Customer → either disabled for now or linked later

### Do Not Include

- Customer creation
- Customer editing form
- Customer detail page implementation
- Children management

---

## Feature 37 — New Customer Flow

### Goal

Allow staff/admin to create a new customer.

### Scope

Create a unit feature spec that covers:

- `customer.schema.ts`
- `createCustomer()` server action
- New customer form
- `/customers/new` route, preferred over modal for now
- New Customer button linking to the new route
- Validation for required customer fields
- Redirecting back to Customers page or customer profile after creation

### Do Not Include

- Editing existing customers
- Children CRUD
- Booking creation
- Invoice/order logic

---

## Feature 38 — Edit Customer Flow

### Goal

Allow staff/admin to update an existing customer profile.

### Scope

Create a unit feature spec that covers:

- `updateCustomer()` server action
- Reusable customer form component
- `/customers/[customerId]/edit` route
- Edit Customer row action linking to edit route
- Loading existing customer data into the form
- Validation using the shared customer schema

### Do Not Include

- Children editing
- Booking/order editing
- Customer detail dashboard expansion

---

## Feature 39 — Customer Detail/Profile Page

### Goal

Create the main customer profile hub.

### Scope

Create a unit feature spec that covers:

- `getCustomerById()`
- `/customers/[customerId]/page.tsx`
- Customer profile summary card
- Contact details
- Children list preview
- Linked bookings list
  - Linked orders list
  - Basic customer history section
  - Actions:
  - Edit Customer
  - New Booking for this customer
  - Add Child, if Feature 40 is next

### Do Not Include

- Full children CRUD
- Invoice editing
- Payment management
- Production workflow controls

---

## Feature 40 — Children Management

### Goal

Allow customer profiles to manage linked children.

### Scope

Create a unit feature spec that covers:

- Add child flow
- Edit child flow
- Children list inside customer profile
- Child fields needed for studio workflow
- Linking child records to future bookings
- Validation schema for child data if needed

### Do Not Include

- Full booking workflow changes
- Order/invoice logic
- Loyalty app integration

---

## Feature 41 — Customer Notes, Preferences, and Tags

### Goal

Add useful internal studio context to customer profiles.

### Scope

Create a unit feature spec that covers:

- Internal customer notes
- Preferences
- Optional tags such as VIP, frequent customer, needs follow-up, etc.
- Optional consent placeholders if already supported by the data model
- Displaying this info on the customer profile page

### Do Not Include

- Marketing automation
- Loyalty points
- WhatsApp integration
- Advanced reporting

---

# Suggested Implementation Order

Codex should create the unit feature specs in this order:

1. `36-customer-filters-and-row-actions.md`
2. `37-new-customer-flow.md`
3. `38-edit-customer-flow.md`
4. `39-customer-detail-profile-page.md`
5. `40-children-management.md`
6. `41-customer-notes-preferences-tags.md`

Each unit spec should be small, focused, and safe to implement in one PR.

## Important Rule

Do not combine all customer work into one large feature. The Customers module touches routing, server actions, validation, database queries, and workflow navigation, so it should be completed through multiple small unit specs.
