# Progress Tracker

Update this file after every meaningful implementation
change.

## Current Phase

- Feature 12 Complete

## Current Goal

- Calendar page connected to real database data.

## Completed

- Feature 12: Calendar Database Connection (`context/feature-specs/12-calendar-database-connection.md`):
  - `src/modules/calendar/calendar.service.ts` — `getCalendarEvents()` fetches all bookings via Prisma with related `customer` and `package`; maps `SessionType` enum to `"Newborn" | "Kids" | "Family" | "Other"`; maps `BookingStatus` enum to `"Pending" | "Confirmed" | "Cancelled"`; derives colors from `SESSION_TYPE_COLORS`; `photographerName` defaults to `"—"` (no DB column yet); wrapped with `withRetry`
  - `src/components/calendar/calendar-grid.tsx` — added `events: CalendarBooking[]` prop; removed `mockBookings` import; `handleEventClick` and FullCalendar `events` prop now use the passed `events` array
  - `app/calendar/page.tsx` — converted to async server component; calls `getCalendarEvents()` and passes result as `events` prop to `<CalendarGrid />`

- Feature 11: Dashboard Database Connection (`context/feature-specs/11-dashboard-database-connection.md`):
  - `src/modules/dashboard/dashboard.service.ts` — `getDashboardData()` returns `{ stats, todaySchedule, recentActivity }`; `stats` computed from 6 individual Prisma queries (today/week ranges pinned to UTC); `todaySchedule` maps today's bookings to `{ time, customerName, status }` with `"HH:MM"` formatting via `en-GB` locale; `recentActivity` merges last 3 payments and last 3 bookings, sorted by `createdAt` desc, top 6; relative timestamps computed at call time; wrapped with `withRetry`
  - `app/(dashboard)/page.tsx` — converted to async server component; all three mock arrays removed; calls `getDashboardData()`; KPI values formatted as strings; empty-state paragraphs render gracefully when schedule or activity lists are empty

- Feature 10: Bookings Page Database Connection (`context/feature-specs/10-bookings-page-database-connection.md`):
  - `src/modules/bookings/booking.service.ts` — `getBookings()` fetches all bookings via Prisma with related `customer`, `package`, and `order.invoice`; maps DB enums to UI `Booking` shape; `assignedStaff` defaults to `"—"` (no DB column yet); Prisma read wrapped with `withRetry`; `formatSessionDate` pinned to UTC via `Intl.DateTimeFormat` with invalid-Date guard
  - `app/bookings/page.tsx` — now async server component; `MOCK_BOOKINGS` array removed; calls `getBookings()` from service
  - `src/components/bookings/bookings-table.tsx` — Booking ID column removed (consistent with customers page)
  - No changes to Prisma schema, shadcn components, or bookings-filters

- Feature 09: Customer Page Database Connection (`context/feature-specs/09-customer-page-database-connection.md`):
  - `src/modules/customers/customer.types.ts` — new domain type module; `Customer` interface extracted here from `customers-table.tsx` to decouple domain type from UI component
  - `src/modules/customers/customer.service.ts` — `getCustomers()` fetches all customers via Prisma with `_count` for children and bookings, latest booking date, and maps DB types to UI `Customer` shape; Prisma read wrapped with `withRetry`; `formatSessionDate` pinned to UTC via `Intl.DateTimeFormat` with invalid-Date guard; imports `Customer` from `customer.types` (not from UI component)
  - `src/components/customers/customers-table.tsx` — Customer ID column removed from the table header and rows; `Customer` interface now re-exported from `customer.types`
  - `app/customers/page.tsx` — now async server component; MOCK_CUSTOMERS array removed; calls `getCustomers()` from service
  - `src/lib/retry.ts` — shared `withRetry<T>` helper: 3 attempts, 150 ms × attempt backoff, `RangeError` guard on invalid `attempts` param, rethrows with contextual label
  - TypeScript clean; `npm run build` passes

- Feature 08: Database Foundation (`context/feature-specs/08-database-foundation.md`):
  - Prisma 7 + `@prisma/client` installed
  - `@prisma/adapter-pg` + `pg` installed (required by Prisma 7 — URL-based datasource removed from schema.prisma)
  - `.env` with default `DATABASE_URL`, `.env.example` for reference
  - `prisma.config.ts` — `defineConfig` with `datasource.url` for CLI/migrate commands (Prisma 7 breaking change)
  - `prisma/schema.prisma` — 8 enums (UserRole, CustomerStatus, SessionType, BookingStatus, OrderStatus, InvoiceStatus, PaymentMethod, PaymentType) + 8 models (User, Customer, Child, Package, Booking, Order, Invoice, Payment)
  - `src/lib/db/index.ts` — singleton PrismaClient with `PrismaPg` adapter, dev-safe global caching
  - `prisma/seed.ts` — 5 users, 3 packages, 3 customers, 3 children, 3 bookings, 2 orders, 2 invoices, 4 payments
  - `package.json` — `db:generate`, `db:migrate`, `db:seed`, `db:studio` scripts + `prisma.seed` field
  - `prisma/migrations/20260505000000_init/migration.sql` — generated via `prisma migrate diff`
  - `prisma generate` passes; TypeScript compiles clean; Next.js build passes; all existing pages intact
  - **Note:** Run `prisma migrate dev` and `npm run db:seed` once PostgreSQL is configured

- Feature 07: Calendar Page UI (`context/feature-specs/07-calendar-page-ui.md`):
  - FullCalendar packages installed:
    - `@fullcalendar/react`
    - `@fullcalendar/daygrid`
    - `@fullcalendar/timegrid`
    - `@fullcalendar/interaction`
  - `src/components/calendar/calendar-mock-data.ts` — centralized mock booking data with session-type color mapping
  - `src/components/calendar/calendar-header.tsx` — custom Calendar header with Month / Week / Day toggle, previous/next/today controls, current period label, and New Booking button
  - `src/components/calendar/calendar-filters.tsx` — department and status filter placeholders
  - `src/components/calendar/calendar-event-content.tsx` — compact custom event chip rendering
  - `src/components/calendar/calendar-event-popover.tsx` — booking detail dialog using shadcn Dialog
  - `src/components/calendar/calendar-grid.tsx` — FullCalendar wrapper with view switching, date navigation, event click handling, and mock event rendering
  - `app/calendar/page.tsx` + `app/calendar/layout.tsx` — Calendar route with AppShell and PageContainer
  - Sidebar Calendar link confirmed active
  - Manual dev check passes; Calendar renders with sidebar/topbar and booking detail dialog
  
- Feature 06: Customers Page UI (`context/feature-specs/06-customers-page-ui.md`):
  - `src/components/customers/customer-status-badge.tsx` — badge for Active/Inactive
  - `src/components/customers/customers-filters.tsx` — client component: search input + status select
  - `src/components/customers/customers-table.tsx` — table with all columns, actions dropdown, accepts `Customer[]` prop
  - `app/customers/layout.tsx` + `app/customers/page.tsx` — customers route with AppShell, header, filters, 10-row mock table
  - Lint, TypeScript, and build all pass

- Feature 05: Bookings Page UI (`context/feature-specs/05-booking-page-ui.md`):
  - `src/components/bookings/booking-status-badge.tsx` — badge for Pending/Confirmed/Completed/Cancelled
  - `src/components/bookings/payment-status-badge.tsx` — badge for Unpaid/Partial/Paid/Refunded
  - `src/components/bookings/bookings-filters.tsx` — client component: search input + status/date/package selects
  - `src/components/bookings/bookings-table.tsx` — table with all columns, actions dropdown, accepts `Booking[]` prop
  - `app/bookings/layout.tsx` + `app/bookings/page.tsx` — bookings route with AppShell, header, filters, 8-row mock table
  - Lint, TypeScript, and build all pass

- Feature 04: Dashboard Page UI (`context/feature-specs/04-dashboard-page-ui.md`):
  - `src/components/dashboard/stat-card.tsx` — KPI card (title, value, subtext, optional icon)
  - `src/components/dashboard/section-header.tsx` — section title + optional description
  - `src/components/dashboard/schedule-item.tsx` — time · customer name · status badge row; exports `ScheduleStatus` union type
  - `src/components/dashboard/activity-item.tsx` — timestamp + description row
  - `app/(dashboard)/page.tsx` — full dashboard page: 4-column KPI grid, Today's Schedule panel, Recent Activity panel; all mock/static data
  - Lint, TypeScript, and build all pass

- Feature 03: Base Chrome Components (`context/feature-specs/03-base-chrome-components.md`):
  - `src/components/layout/sidebar.tsx` — dark sidebar with 5 grouped nav sections, Lucide icons, active state via `usePathname`, logo (top), user block (bottom)
  - `src/components/layout/topbar.tsx` — page title, search input, New Booking button, notifications + user icon
  - `src/components/layout/app-shell.tsx` — full-height shell (sidebar left, topbar + scrollable main right)
  - `src/components/layout/page-container.tsx` — `max-w-7xl` content wrapper with consistent padding
  - `app/(dashboard)/layout.tsx` + `app/(dashboard)/page.tsx` — dashboard route group using AppShell
  - Sidebar design tokens added to `app/globals.css` (`--color-sidebar`, `--color-sidebar-foreground`, etc.)
  - `app/layout.tsx` updated: Inter font, title "Studio OS", `h-full` body
  - Lint, TypeScript, and build all pass

- Feature 02: Design system unit (`context/feature-specs/02-design-system.md`):
  - shadcn/ui installed and configured for Next.js + Tailwind v4
  - `src/lib/utils.ts` with `cn()` helper (clsx + tailwind-merge)
  - `lucide-react` installed
  - 15 shadcn components installed in `src/components/ui/`:
    button, card, dialog, input, label, textarea, select, tabs,
    badge, table, dropdown-menu, separator, sheet, tooltip, sonner
  - Design tokens from `ui-context.md` added to `app/globals.css`
  - Build passes with no TypeScript or compile errors

## In Progress

- None.

## Next Up

- Feature 13 and beyond (not yet specified)

## Open Questions

- `context/architecture.md` was referenced by the repo instructions but is not present in `context/`.

## Architecture Decisions

- **Prisma 7 adapter pattern**: Prisma 7 removed URL-based datasource from `schema.prisma`. The connection URL now lives in `prisma.config.ts` (for CLI/migrations) and is passed via `@prisma/adapter-pg` to `PrismaClient` directly. All db access goes through `src/lib/db/index.ts`.
- tsconfig `@/*` alias set to `["./src/*", "./*"]` so shadcn imports (`@/lib/utils`, `@/components/ui/*`) resolve to `src/` without requiring `app/` to move inside `src/`.
- `@theme inline` used in `globals.css` so Tailwind color utility classes get values baked in, avoiding CSS custom property shadowing of the `:root` design token declarations.
- shadcn `--color-accent` maps to `#EFE3CF` (soft hover background) per shadcn convention; the gold accent is exposed as `--color-primary` / `bg-primary`. Raw gold is still available as `var(--color-accent)` from `:root`.
- `app/(dashboard)/` route group used for all chrome-wrapped pages so `AppShell` is declared once in the group layout, never duplicated in pages.
- Sidebar is the only `"use client"` layout component (needs `usePathname`); Topbar, AppShell, PageContainer are server components.

## Session Notes

- Read required context files: `project-overview.md`, `ui-context.md`, `code-standards.md`, `ai-workflow-rules.md`, and this tracker.
- Tailwind v4 is in use (`@tailwindcss/postcss`); shadcn/ui configured to work with Tailwind v4.
- `class-variance-authority` was not auto-installed by shadcn add; installed manually.
