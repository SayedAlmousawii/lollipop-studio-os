Goal

Build the main Customers page UI for viewing and managing studio customers.

⸻

Rules

* Read agents.md first
* Use existing design tokens
* Do NOT modify shadcn/ui components
* Use mock/static data only

⸻

Scope

UI only. No backend, database, or real customer logic.

⸻

Page Content

Header

* Page title: Customers
* Subtitle: short description
* Primary button: New Customer

⸻

Filters Bar

Include simple UI controls for:

* Search customers (by name or phone)
* Status filter placeholder

No real filtering logic required yet unless easy.

⸻

Customers Table

Show mock customers with:

* Customer ID
* Full name
* Phone number
* Number of children
* Total bookings
* Last session date
* Status
* Actions menu placeholder

⸻

Customer Statuses

Use simple badge styles for:

* Active
* Inactive

⸻

Components

components/customers/
  customers-table.tsx
  customers-filters.tsx
  customer-status-badge.tsx

⸻

Page File

app/customers/page.tsx
app/customers/layout.tsx

⸻

Implementation Order

1. Create customers mock data (8–10 customers)
2. Create customer status badge component
3. Create filters bar
4. Create customers table
5. Build customers page using AppShell + PageContainer
6. Confirm sidebar link highlights Customers

⸻

Styling Requirements

* Use tokens for background, surface, border, text, and accent
* Table should be clean and readable
* Badges should use existing semantic tokens
* Keep spacing consistent with Bookings page

⸻

Functional Requirements

* Static table renders correctly
* Sidebar active route highlights Customers
* Actions menu can be placeholder only
* Components should be reusable later with real data

⸻

Responsive

* Table should not break on smaller screens
* Allow horizontal scroll if needed
* Filters can stack on mobile

⸻

Acceptance Criteria

* Customers page loads inside AppShell
* Filters bar is visible
* Mock customers table is visible
* Status badges render correctly
* No duplicated layout code
* No shadcn generated files edited

⸻

Done Checks

npm run lint
npm run typecheck
npm run build

Manual checks:

* No console errors
* No broken imports
* No unused variables
* No hardcoded colors where tokens exist
* Layout matches Studio OS direction
