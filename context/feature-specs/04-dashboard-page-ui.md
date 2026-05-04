
Goal

Build the main Dashboard UI using AppShell to validate layout and establish UI patterns.

⸻

Rules

* Read agents.md first
* Use design tokens (no hardcoded colors)
* Do NOT modify shadcn/ui components
* Use mock/static data only

⸻

Scope

UI only. No backend, API, or real data.

⸻

Sections

KPI Cards

* Examples:
    * Today’s Sessions
    * Revenue
    * Pending Tasks
* Simple card layout (title + value + small subtext)

⸻

Today’s Schedule

* List of upcoming sessions/bookings
* Show:
    * Time
    * Customer name
    * Status
* Clean row layout (no complex logic)

⸻

Recent Activity / Workflow

* Simple list (e.g. “Photos uploaded”, “Editing completed”)
* Timestamp + short description

⸻

Components (Reusable)

* StatCard
* SectionHeader
* ScheduleItem
* ActivityItem

Keep them simple and reusable.

⸻

Structure

app/dashboard/page.tsx
components/dashboard/
  stat-card.tsx
  section-header.tsx
  schedule-item.tsx
  activity-item.tsx

⸻

Implementation Order

1. Create dashboard components
2. Add mock data inside page file
3. Build KPI cards grid
4. Build schedule section
5. Build activity section
6. Compose full page layout

⸻

Layout Requirements

* Use AppShell + PageContainer
* Clear vertical sections
* Consistent spacing between sections
* Grid for KPI cards (responsive)

⸻

Styling

* Use tokens (surface, border, text, accent)
* Cards = surface
* Subtext = text-muted
* Clean, minimal, readable

⸻

Functional

* Static rendering only
* No interactions required yet
* Components structured for future data integration

⸻

Responsive

* KPI cards stack on smaller screens
* Lists remain readable
* No complex mobile behavior required

⸻

Acceptance

* Dashboard renders inside AppShell
* KPI cards visible and aligned
* Schedule + Activity sections present
* Clean spacing and layout
* No duplicated layout logic

⸻

Done Checks

npm run lint
npm run typecheck
npm run build

Manual:

* No console errors
* No hardcoded colors
* Layout matches design direction

⸻

Out of Scope

* Real data/API
* Filtering/search
* Calendar integration
* Actions or mutations
* Role-based UI

