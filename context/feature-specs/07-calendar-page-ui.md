Here’s the cleaner FullCalendar-based spec:

# Unit: Calendar Page
## Goal
Build the Studio OS Calendar page using FullCalendar for viewing studio bookings in Month, Week, and Day views.
## Rules
- Read `agents.md` first
- Use existing design tokens
- Do NOT modify shadcn/ui generated files
- Use mock/static booking data only
- Install FullCalendar packages only
- UI only, no backend or real booking logic yet
## Install
npm install @fullcalendar/react @fullcalendar/daygrid @fullcalendar/timegrid @fullcalendar/interaction
## Scope
Create a production-ready calendar UI foundation using FullCalendar as the calendar engine.
Out of scope:
- Real booking creation
- Database/API integration
- Google Calendar sync
- Drag/drop rescheduling
- Multi-staff/resource calendar
## Components
components/calendar/
- calendar-grid.tsx
  - Main FullCalendar wrapper
  - Handles active view, date navigation, and event rendering
- calendar-header.tsx
  - Page title: Calendar
  - Subtitle
  - Month / Week / Day toggle
  - Previous / Next buttons
  - Today button
  - Current period label
  - New Booking button
- calendar-filters.tsx
  - Department filter placeholder
  - Status filter placeholder
- calendar-event-content.tsx
  - Custom FullCalendar event rendering
  - Shows time, customer name, and session type
- calendar-event-popover.tsx
  - Uses shadcn Popover
  - Shows customer, session type, time, status, package, photographer
- calendar-mock-data.ts
  - 15–20 mock bookings
Page files:
- app/calendar/page.tsx
- app/calendar/layout.tsx
## Calendar Views
Use FullCalendar views:
- Month: `dayGridMonth`
- Week: `timeGridWeek`
- Day: `timeGridDay`
Default view:
- `dayGridMonth`
## Header Behavior
Use custom header, not FullCalendar default header.
Set:
```tsx
headerToolbar={false}

Header controls should call FullCalendar API:

calendarApi.prev()
calendarApi.next()
calendarApi.today()
calendarApi.changeView("dayGridMonth")
calendarApi.changeView("timeGridWeek")
calendarApi.changeView("timeGridDay")

Mock Booking Fields

Each booking should include:

* id
* customerName
* sessionType: Newborn | Kids | Family | Other
* start
* end
* status: Pending | Confirmed | Cancelled
* packageName
* photographerName

Use FullCalendar event format:

{
  id: "booking-1",
  title: "Sarah Ahmed",
  start: "2026-05-05T10:00:00",
  end: "2026-05-05T11:30:00",
  extendedProps: {
    customerName: "Sarah Ahmed",
    sessionType: "Newborn",
    status: "Confirmed",
    packageName: "Premium Newborn Package",
    photographerName: "Ali"
  }
}

Event Colors

Color-code by session type using existing tokens:

* Newborn:
    * background: --color-accent-soft
    * text: --color-accent
* Kids:
    * background: --color-info-soft
    * text: --color-info
* Family:
    * background: --color-success-soft
    * text: --color-success
* Other:
    * background: --color-surface-soft
    * text: --color-text-secondary

No hardcoded hex colors.

FullCalendar Config

Required settings:

<FullCalendar
  ref={calendarRef}
  plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
  initialView="dayGridMonth"
  headerToolbar={false}
  events={mockBookings}
  height="auto"
  slotMinTime="08:00:00"
  slotMaxTime="20:00:00"
  nowIndicator
  eventContent={renderEventContent}
  eventClick={handleEventClick}
/>

Styling Requirements

* Match Studio OS direction
* Use Tailwind + design tokens
* Calendar borders use --color-border
* Surfaces use --color-surface
* Weekend/today styling should be customized if practical
* Event chips should be compact, rounded, and truncated
* Header controls should wrap on mobile
* Calendar may horizontally scroll on smaller screens

Popover

On event click, show a shadcn Popover/Dialog-style detail card with:

* Customer name
* Session type
* Time
* Status badge
* Package name
* Assigned photographer

Do not rely only on browser tooltip.

Functional Requirements

* Calendar page loads inside AppShell
* Month / Week / Day toggle works
* Previous / Next navigation works
* Today button resets date
* Current period label updates
* Mock bookings render correctly
* Events are color-coded
* Event click opens booking details popover
* Filters bar is visible
* Sidebar highlights Calendar

Implementation Order

1. Install FullCalendar packages
2. Create mock booking data
3. Build calendar-header.tsx
4. Build calendar-filters.tsx
5. Build calendar-event-content.tsx
6. Build calendar-event-popover.tsx
7. Build calendar-grid.tsx
8. Compose app/calendar/page.tsx
9. Confirm AppShell/PageContainer usage
10. Confirm sidebar active state for Calendar
11. Run checks

Done Checks

npm run lint
npm run typecheck
npm run build

Manual checks:

* No console errors
* No broken imports
* No unused variables
* No hardcoded colors where tokens exist
* Calendar works in Month / Week / Day views
* Popover opens correctly
* Sidebar highlights Calendar
* No shadcn generated files edited

This version is better because FullCalendar handles the hard calendar logic, while your app still controls the Studio OS styling and structure.