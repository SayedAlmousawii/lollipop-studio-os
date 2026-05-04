## Goal
Connect the existing Bookings page UI to real database data using Prisma.

## Rules
- Read `AGENTS.md` first.
- Use existing project architecture and code standards.
- Do not modify shadcn/ui generated files.
- Do not redesign the Bookings page.
- Do not add create/edit/delete functionality yet.
- Do not add authentication or permissions in this unit.
- Keep this unit read-only.

## Scope
Replace the current mock/static bookings data with data fetched from PostgreSQL through Prisma.

## Requirements
- Create `src/modules/bookings/booking.service.ts` with a `getBookings()` function following the same pattern as `src/modules/customers/customer.service.ts`.
- Fetch bookings via `db.booking.findMany()`, including:
  - Related `customer` (for name)
  - Related `package` (for package name)
  - Related `order` with nested `invoice` if present (for payment status)
- Map DB fields to the existing `Booking` interface in `src/components/bookings/bookings-table.tsx`:
  - `id` — raw CUID (React key only, not displayed)
  - `customerName` — from `booking.customer.name`
  - `sessionDate` — formatted date string (same `formatSessionDate` helper pattern as customers)
  - `package` — from `booking.package.name`
  - `status` — map `BookingStatus` enum → `"Pending" | "Confirmed" | "Completed" | "Cancelled"`
  - `paymentStatus` — derive from order invoice if present, default `"Unpaid"`
  - `assignedStaff` — no DB column yet; use `"—"` as placeholder
- Remove `MOCK_BOOKINGS` array from `app/bookings/page.tsx`.
- Convert `app/bookings/page.tsx` to an async server component.
- Remove the Booking ID column from `bookings-table.tsx` (consistent with customers page).

## Expected Files
**Create:**
- `src/modules/bookings/booking.service.ts`

**May modify:**
- `app/bookings/page.tsx`
- `src/components/bookings/bookings-table.tsx`

**Do not modify:**
- Prisma schema
- shadcn/ui components
- `bookings-filters.tsx` unless minor type adjustment required
- Unrelated pages/components

## Done Checks
- Bookings page loads real seeded bookings from the database.
- No mock booking array remains in the page.
- Existing table still renders correctly.
- Booking ID column removed from the table.
- No TypeScript errors.
- No console errors.
- `npm run build` passes.
- Update `context/progress-tracker.md`.

## Out of Scope
- Create / edit / cancel booking forms
- Booking detail page
- Filters wired to real data
- assignedStaff field (no DB column yet)
- Authentication / role checks
- API routes
