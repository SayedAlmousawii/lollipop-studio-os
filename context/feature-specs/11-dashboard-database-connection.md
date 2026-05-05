## Goal
Connect the existing Dashboard page to real database data using Prisma.

## Rules
- Read `AGENTS.md` first.
- Use existing project architecture and code standards.
- Do not modify shadcn/ui generated files.
- Do not redesign the Dashboard page.
- Do not add create/edit/delete functionality.
- Do not add authentication or permissions in this unit.
- Keep this unit read-only.

## Scope
Replace all static/mock data on the dashboard with real data fetched from PostgreSQL through Prisma.

## Requirements
- Create `src/modules/dashboard/dashboard.service.ts` with a `getDashboardData()` function.
- `getDashboardData()` returns a single object with three sections:

### stats
Computed via individual Prisma queries scoped to today / this week:
- `todaySessionCount` — `db.booking.count` where `sessionDate` falls within today (midnight → 23:59:59)
- `todayConfirmed` — same scope, `status: "CONFIRMED"`
- `todayPending` — same scope, `status: "PENDING"`
- `revenueToday` — `db.payment.aggregate._sum.amount` where `createdAt` falls within today; default `0` if null
- `pendingTasks` — `db.order.count` where `status IN [WAITING_SELECTION, EDITING, READY]`
- `newCustomersThisWeek` — `db.customer.count` where `createdAt >= start of current week (Monday 00:00)`

### todaySchedule
`db.booking.findMany` where `sessionDate` falls within today, ordered by `sessionDate asc`, include `customer` (for name).
Map each row to `{ time: string; customerName: string; status: ScheduleStatus }`:
- `time` — formatted as `"HH:MM"` (24-hour, en-GB locale)
- `customerName` — from `booking.customer.name`
- `status` — map `BookingStatus` enum:
  - `PENDING` → `"Pending"`
  - `CONFIRMED` → `"Confirmed"`
  - `CANCELLED` | `NO_SHOW` → `"Cancelled"`
  - `COMPLETED` → `"Confirmed"`

### recentActivity
No audit log table exists in the schema. Derive from recent database events:
- Fetch last 3 payments: `db.payment.findMany({ take: 3, orderBy: { createdAt: "desc" }, include: { order: { include: { booking: { include: { customer: true } } } } } })`
- Fetch last 3 bookings created: `db.booking.findMany({ take: 3, orderBy: { createdAt: "desc" }, include: { customer: true } })`
- Merge the two sets, sort by `createdAt` descending, take top 6.
- Format each as `{ timestamp: string; description: string }`:
  - `timestamp` — relative time string (`"X min ago"`, `"X hrs ago"`, `"Yesterday"`) computed from `createdAt` vs current time
  - `description` — human-readable string:
    - Payment: `"Deposit received from {customerName} — SAR {amount}"`
    - Booking: `"New booking created for {customerName}"`

## Page changes
- Convert `app/(dashboard)/page.tsx` to an async server component.
- Remove all three mock arrays (`MOCK_STATS`, inline KPI values, schedule array, activity array).
- Call `getDashboardData()` and pass `stats`, `todaySchedule`, and `recentActivity` to the relevant render sections.
- KPI card values must be formatted as strings before passing to `StatCard` (e.g. `String(stats.todaySessionCount)`).

## Expected Files
**Create:**
- `src/modules/dashboard/dashboard.service.ts`

**Modify:**
- `app/(dashboard)/page.tsx`

**Do not modify:**
- `src/components/dashboard/*.tsx` (stat-card, schedule-item, activity-item, section-header)
- Prisma schema
- shadcn/ui components
- Other pages or components

## Done Checks
- Dashboard loads real data from the database.
- No mock/static data arrays remain in the page.
- Today's Schedule shows actual bookings for today (empty state renders gracefully if none).
- Recent Activity shows derived entries (empty state renders gracefully if none).
- No TypeScript errors.
- No console errors.
- `npm run build` passes.
- Update `context/progress-tracker.md`.

## Out of Scope
- Audit log / event sourcing
- Real-time updates (WebSocket / polling)
- Filters or drill-downs on the dashboard
- Authentication / role checks
- API routes
