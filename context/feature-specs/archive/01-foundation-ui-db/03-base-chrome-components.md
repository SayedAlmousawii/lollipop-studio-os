Build the reusable app layout (chrome) for Studio OS: sidebar, topbar, and content shell.

Use existing design tokens and UI direction (dark sidebar + light workspace).

⸻

Rules

* Read agents.md first
* Use design tokens (no hardcoded colors)
* Do NOT modify shadcn/ui components

⸻

Scope

Layout only. No business logic, data, or feature UI.

⸻

Components

AppShell

* Full-height layout
* Sidebar (left) + Topbar (top)
* Scrollable content area
* Consistent padding

Sidebar

* Sections:
    * Dashboard
    * Bookings, Calendar, Customers, Packages, Invoices
    * Sessions, Selection, Editing, Production, Delivery
    * Commissions, Reports
    * Settings
* Dark style
* Active item state
* Lucide icons
* Logo (top) + user block (bottom)

Topbar

* Page title
* Search input (Search bookings...)
* New Booking button
* Notification + user icon

PageContainer

* Handles width, padding, spacing
* Used inside AppShell

⸻

Requirements

Styling

* Use tokens (background, surface, border, text, accent)
* Rounded corners, clean spacing
* Stable layout (chrome fixed, content scrolls)
* Reusable across pages

Responsive

Desktop: sidebar + topbar layout

⸻

Acceptance

* Dashboard uses AppShell
* Sidebar + Topbar fully visible
* Active state works
* Proper spacing + layout
* No duplicated layout in pages
* No shadcn edits

⸻

Done Checks

Run:

npm run lint
npm run typecheck
npm run build

Also verify:

* No errors (console/build)
* No hardcoded colors
* Clean layout alignment

⸻

Out of Scope

All business logic, data, and advanced features.