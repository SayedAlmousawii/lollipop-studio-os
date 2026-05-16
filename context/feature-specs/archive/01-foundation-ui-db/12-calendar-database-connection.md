## Goal
Connect the existing Calendar page to real database data using Prisma.

## Rules
- Read `AGENTS.md` first.
- Use existing project architecture and code standards.
- Do not modify shadcn/ui generated files.
- Do not redesign the Calendar page.
- Do not add create/edit/delete functionality.
- Do not add authentication or permissions in this unit.
- Keep this unit read-only.

## Scope
Replace the mock `CalendarBooking` array in `calendar-grid.tsx` with real bookings fetched from PostgreSQL through Prisma.

## Architectural Constraint
`CalendarGrid` is a `"use client"` component (FullCalendar requires browser APIs). It cannot fetch data directly.
The solution is to lift data fetching to the server:
1. `app/calendar/page.tsx` becomes an async server component that fetches events.
2. `CalendarGrid` is updated to accept an `events: CalendarBooking[]` prop.
3. `CalendarBooking` objects are safe to cross the server/client boundary because all fields are plain strings (no `Date` objects).

## Requirements

### Service
Create `src/modules/calendar/calendar.service.ts` with a `getCalendarEvents()` function following the same pattern as `src/modules/bookings/booking.service.ts`.

- `db.booking.findMany({ include: { customer: { select: { name: true } }, package: { select: { name: true } } }, orderBy: { sessionDate: "asc" } })`
- Map each row to a `CalendarBooking` object (type imported from `@/components/calendar/calendar-mock-data`):
  - `id` — `booking.id`
  - `title` — `booking.customer.name`
  - `start` — `booking.sessionDate.toISOString()`
  - `end` — same as `start` (no session-end time in schema yet)
  - `backgroundColor / textColor / borderColor` — derived from `SESSION_TYPE_COLORS[sessionType]` (reuse existing map from `calendar-mock-data.ts`)
  - `extendedProps.customerName` — `booking.customer.name`
  - `extendedProps.sessionType` — map `SessionType` enum:
    - `NEWBORN` → `"Newborn"`
    - `KIDS` → `"Kids"`
    - `FAMILY` → `"Family"`
    - `MATERNITY` | `OTHER` → `"Other"`
  - `extendedProps.status` — map `BookingStatus` enum:
    - `PENDING` → `"Pending"`
    - `CONFIRMED` | `COMPLETED` → `"Confirmed"`
    - `CANCELLED` | `NO_SHOW` → `"Cancelled"`
  - `extendedProps.packageName` — `booking.package?.name ?? "—"`
  - `extendedProps.photographerName` — `"—"` (no DB column yet)

### CalendarGrid component
Update `src/components/calendar/calendar-grid.tsx`:
- Add `events: CalendarBooking[]` to the component props interface.
- Remove the `import { mockBookings } from "./calendar-mock-data"` line.
- Replace the `events={mockBookings}` FullCalendar prop with `events={events}`.
- Keep `SESSION_TYPE_COLORS` import if used elsewhere in the file; otherwise remove it.

### Calendar page
Update `app/calendar/page.tsx`:
- Convert to an async server component.
- Call `getCalendarEvents()` from the service.
- Pass the result as the `events` prop to `<CalendarGrid />`.

## Expected Files
**Create:**
- `src/modules/calendar/calendar.service.ts`

**Modify:**
- `src/components/calendar/calendar-grid.tsx` — add `events` prop, remove mock import
- `app/calendar/page.tsx` — async server component, fetch and pass events

**Do not modify:**
- `src/components/calendar/calendar-mock-data.ts` — `CalendarBooking` type and `SESSION_TYPE_COLORS` are still needed
- `calendar-header.tsx`, `calendar-filters.tsx`, `calendar-event-content.tsx`, `calendar-event-popover.tsx`
- Prisma schema
- shadcn/ui components
- Other pages

## Done Checks
- Calendar page loads real seeded bookings from the database.
- No mock booking array is imported or used in `calendar-grid.tsx`.
- Existing calendar views (month/week/day), navigation, and event popover still work correctly.
- Event colours still reflect session type correctly.
- No TypeScript errors.
- No console errors.
- `npm run build` passes.
- Update `context/progress-tracker.md`.

## Out of Scope
- Create / edit / cancel booking from calendar
- Filters wired to real data
- assignedStaff / photographerName field (no DB column yet)
- Authentication / role checks
- API routes
