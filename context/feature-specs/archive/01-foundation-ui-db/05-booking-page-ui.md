Goal

Build the main Bookings page UI for viewing and managing studio bookings.

⸻

Rules

* Read agents.md first
* Use existing design tokens
* Do NOT modify shadcn/ui components
* Use mock/static data only

⸻

Scope

UI only. No backend, database, or real booking logic.

⸻

Page Content

Header

* Page title: Bookings
* Subtitle: short description
* Primary button: New Booking

⸻

Filters Bar

Include simple UI controls for:

* Search bookings
* Status filter
* Date filter placeholder
* Package filter placeholder

No real filtering logic required yet unless easy.

⸻

Bookings Table

Show mock bookings with:

* Booking ID
* Customer name
* Session date
* Package
* Status
* Payment status
* Assigned staff
* Actions menu placeholder

⸻

Booking Statuses

Use simple badge styles for:

* Pending
* Confirmed
* Completed
* Cancelled

⸻

Payment Statuses

Use simple badge styles for:

* Unpaid
* Partial
* Paid
* Refunded

⸻

Components

src/components/bookings/
  bookings-table.tsx
  booking-status-badge.tsx
  payment-status-badge.tsx
  bookings-filters.tsx

⸻

Page File

app/bookings/page.tsx

⸻

Implementation Order

1. Create bookings mock data
2. Create status badge components
3. Create filters bar
4. Create bookings table
5. Build bookings page using AppShell + PageContainer
6. Confirm sidebar link works

⸻

Styling Requirements

* Use tokens for background, surface, border, text, and accent
* Table should be clean and readable
* Badges should use existing semantic tokens if available
* Keep spacing consistent with Dashboard page

⸻

Functional Requirements

* Static table renders correctly
* Sidebar active route highlights Bookings
* Actions menu can be placeholder only
* Components should be reusable later with real data

⸻

Responsive

* Table should not break on smaller screens
* Allow horizontal scroll if needed
* Filters can stack on mobile

⸻

Acceptance Criteria

* Bookings page loads inside AppShell
* Filters bar is visible
* Mock bookings table is visible
* Status/payment badges render correctly
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