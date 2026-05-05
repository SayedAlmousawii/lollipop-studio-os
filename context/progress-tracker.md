# Progress Tracker

Update this file after every meaningful implementation
change.

## Current Phase

- Feature 21 Complete

## Current Goal

- Booking deposit recording implemented; spec at `context/feature-specs/21-booking-deposit-recording.md`.

## Completed

- Feature 21: Booking Deposit Recording (`context/feature-specs/21-booking-deposit-recording.md`):
  - `src/modules/bookings/booking.schema.ts` — added `recordBookingDepositSchema` and inferred input type for booking ID, amount, payment method, and optional reference
  - `src/modules/bookings/booking.service.ts` — added transactional `recordBookingDeposit()` that verifies pending booking, prevents duplicate deposit payments, creates/reuses the order, creates/reuses the invoice, and records a `DEPOSIT` payment through the payments module; booking list/edit deposit status and confirmation guard now read invoice payments instead of `Booking.depositPaid`
  - `src/modules/invoices/invoice.service.ts` — extracted `createInvoiceForOrderWithClient()` so booking deposit recording can create invoices inside the same transaction while preserving the existing `createInvoiceForOrder()` API
  - `src/modules/payments/payment.service.ts` — extracted `recordPaymentWithClient()` so booking deposit recording reuses the existing payment creation/status recalculation logic inside the same transaction while preserving `recordPayment()`
  - `app/bookings/actions.ts` — added `recordDepositAction` with FormData parsing, Zod validation, service call, structured errors, success state, and `/bookings` + `/calendar` revalidation
  - `src/components/bookings/record-deposit-form.tsx` — added deposit form with default `20.000` KD amount, payment method, optional reference, inline errors, success feedback, and disabled saving state
  - `src/components/bookings/bookings-table.tsx` — added row-level `Record Deposit` dialog for pending unpaid bookings and changed the status column label from Payment to Deposit
  - `src/components/bookings/booking-status-actions.tsx` — disables `Confirm Booking` until deposit status is paid while preserving the service-layer guard
  - `npm run build` and `npm run lint` pass
  - Decision: deposit status is derived from `Payment.paymentType = DEPOSIT` on invoices linked through the booking order; no booking deposit field is written
  - Decision: the deposit workflow runs in one Prisma transaction so invoice/payment creation cannot leave the booking UI falsely updated if payment recording fails
  - Decision: the form lives in a dialog on the bookings table because the spec allows a modal and keeps staff on the booking page
  - Assumption: default payment method is `KNET`; staff can switch to `CASH` or `LINK`

- Feature 20: Booking Status Workflow (`context/feature-specs/20-booking-status-workflow.md`):
  - `src/modules/bookings/booking.schema.ts` — added `updateBookingStatusSchema` and inferred input type for booking ID + Prisma booking status validation
  - `src/modules/bookings/booking.service.ts` — added explicit status transition rules, deposit guard for confirmation, and transactional `updateBookingStatus()` that creates an order when moving to `COMPLETED`
  - `src/modules/orders/order.service.ts` — added `createOrderFromBooking()` plus a transaction-aware helper that reuses existing orders, creates no duplicates, links customer/booking/package, sets original and final package from the booking package, initializes selected photos to `0`, and starts orders as `ACTIVE`
  - `app/bookings/actions.ts` — added `updateBookingStatusAction` with FormData parsing, Zod validation, service call, and revalidation for `/bookings` and `/calendar`
  - `src/components/bookings/booking-status-actions.tsx` — added valid status action controls for pending/confirmed bookings with inline action errors, pending state, and cancel confirmation
  - `src/components/bookings/bookings-table.tsx` — renders only valid status actions: pending can confirm/cancel, confirmed can complete/cancel, completed/cancelled show none
  - `npm run build` and `npm run lint` pass
  - Decision: the confirmation guard uses the existing `Booking.depositPaid` field because deposit tracking exists directly on booking in the current schema
  - Decision: completing a booking and creating/reusing its order run inside the same Prisma transaction to avoid status/order mismatch
  - Decision: completing a booking without a package is blocked because the feature requires the booking package to become both original and final order package

- Feature 19: Add/Edit Booking Page (`context/feature-specs/19-add-edit-booking-page.md`):
  - `src/modules/bookings/booking.schema.ts` — added `updateBookingSchema` and `UpdateBookingInput` for editable booking fields
  - `src/modules/bookings/booking.service.ts` — added `getEditableBookingById()` and `updateBooking()` with input validation, customer/package existence checks, completed/cancelled edit blocking, and deposit-preserving updates
  - `app/bookings/[bookingId]/edit/actions.ts` — added `updateBookingAction` with FormData parsing, date/time validation, service call, booking revalidation, and redirect to `/bookings`
  - `app/bookings/[bookingId]/edit/page.tsx` — added edit route with booking/customer/package fetching and 404 handling
  - `src/components/bookings/edit-booking-form.tsx` — added client form using `useActionState` and `useFormStatus`, read-only summary, customer/package/date/time/session type/notes sections, disabled save states, and inline field errors
  - `src/components/bookings/bookings-table.tsx` — linked the existing Edit Booking action to `/bookings/[bookingId]/edit`
  - `npm run build` and `npm run lint` pass
  - Decision: date and time are submitted as separate fields and combined into a UTC `Date` in the server action, matching existing seeded booking timestamps and calendar usage
  - Decision: deposit status is displayed read-only and is never updated by this page
  - Assumption: the edit package dropdown lists existing packages from the packages page fetch; package price changes remain booking-only and do not touch orders, invoices, or payments
  - Follow-up field audit: `project-overview.md` and `architecture-context.md` also identify booking-owned department, assigned photographer, selected themes, booking status, and deposit status. Current Prisma `Booking` only has `status` and `depositPaid` for that set; department/photographer/themes need schema decisions, deposit remains payment-owned in this UI, and editable booking status needs workflow/audit requirements before implementation.
  - Follow-up fix: Edit Booking now preserves and allows the existing Prisma `MATERNITY` session type instead of mapping it to `OTHER`; `npm run build` and `npm run lint` pass

- Feature 18: Add/Edit Order Page (`context/feature-specs/18-add-edit-order-page.md`):
  - `prisma/schema.prisma` + `prisma/migrations/20260505030000_order_add_ons/migration.sql` — added order-owned `addOns` JSON storage for the spec's replaceable add-ons V1
  - `src/modules/orders/order.schema.ts` — added Zod validation for package, selected photos, add-ons, and notes
  - `src/modules/orders/order.types.ts` — added editable order, package, and add-on types
  - `src/modules/orders/order.service.ts` — added `getEditableOrderById()` and `updateOrder()`; validates input, blocks delivered orders, verifies the selected package exists, replaces `finalPackageId`, selected photo count, add-ons, and notes without invoice changes
  - `src/modules/packages/package.types.ts` + `src/modules/packages/package.service.ts` — added active package options with numeric prices/photo counts for the edit UI
  - `app/orders/[orderId]/edit/actions.ts` — added `updateOrderAction` with FormData parsing, Zod validation, service call, revalidation, and redirect to order detail
  - `app/orders/[orderId]/edit/page.tsx` — replaced placeholder with order/package fetching, 404 handling, and form render
  - `src/components/orders/edit-order-form.tsx` — added client form using `useActionState` and `useFormStatus` with summary, package adjustment, photo selection, add-ons, notes, disabled save edge cases, and upgrade highlighting
  - `npm run db:generate`, `npx prisma migrate deploy`, `npx prisma migrate status`, `npm run build`, and `npm run lint` pass
  - Decision: add-ons persist as order-owned JSON because the current schema had no add-on model/field while the feature requires DB persistence and simple V1 replacement
  - Decision: invoice totals are not recalculated or edited from this page; package price difference is UI-only
  - Assumption: active packages are offered for selection, while the order's current/original package is also shown if it is no longer active so existing orders remain editable
  - Follow-up fix: `updateOrder()` now connects `finalPackage` through Prisma's relation update API instead of writing `finalPackageId` directly; `npm run build` and `npm run lint` pass

- Feature 17: Orders Page DB Improvements (`context/feature-specs/17-orders-page-db-improvements`):
  - `src/modules/orders/order.types.ts` — replaced mock-list shape with order list/detail display types plus URL filter types
  - `src/modules/orders/order.service.ts` — added `getOrders(filters)`, `getOrderById(orderId)`, URL filter parsing, Prisma-backed order/customer/booking/package/invoice mapping, invoice totals, and workflow display labels
  - `app/orders/page.tsx` — removed `MOCK_ORDERS`; now awaits Next 16 `searchParams`, parses filters, and renders real database orders
  - `app/orders/[orderId]/page.tsx` — new order detail route with order summary, financial summary, deliverables, workflow status, notes, edit placeholder link, and invoice link/placeholder
  - `app/orders/[orderId]/edit/page.tsx` — placeholder edit route for the required edit action without building full edit logic
  - `src/components/orders/orders-filters.tsx` — existing search/status/invoice controls now update URL params (`search`, `orderStatus`, `invoiceStatus`)
  - `src/components/orders/orders-table.tsx` — updated to required columns and actions: View Details, Edit Order, Create/View Invoice
  - `src/components/orders/order-status-badge.tsx`, `src/components/orders/invoice-status-badge.tsx` — aligned badge labels with current Prisma order and invoice statuses
  - `npm run build` passes
  - Decision: order list financial values are summed from all invoices linked to the order; displayed invoice status uses the newest invoice, or `No Invoice` when none exists
  - Decision: create invoice remains a disabled placeholder when no invoice exists, because this feature explicitly excludes invoice/payment logic
  - Assumption: deliverables beyond selected/included/extra photo counts are not yet modeled, so albums / prints / add-ons displays `—`

- Feature 16: Invoice & Payment Foundation System (`context/feature-specs/16-invoice-payment-foundation-system.md`):
  - `prisma/schema.prisma` — updated invoice/payment foundation: `DRAFT → ISSUED → PARTIAL → PAID → CLOSED`, invoice numbers, paid/remaining amounts, lock fields, parent adjustment invoices, payment `paidAt`, `paymentType`, `reference`, and append-only payment records
  - `prisma/migrations/20260505010000_invoice_payment_foundation/migration.sql` — migration for invoice status flow, locked invoice fields, adjustment relation, payment field changes, and removal of one-invoice-per-order uniqueness
  - `prisma/seed.ts` — updated seed invoices/payments for invoice numbers, remaining amounts, new payment fields, and new invoice status enum
  - `src/modules/invoices/invoice.schema.ts` — Zod schema for adjustment invoices
  - `src/modules/payments/payment.schema.ts` — Zod schema for payment recording
  - `src/modules/invoices/invoice.types.ts` — invoice list/detail UI types
  - `src/modules/invoices/invoice.service.ts` — invoice creation, listing, detail fetch, issue, close, status recalculation, and adjustment invoice creation
  - `src/modules/payments/payment.service.ts` — append-only payment recording, invoice payment history, and revenue-by-date-range helper based on `Payment.amount` + `paidAt`
  - `app/invoices/actions.ts` — server actions for issuing, closing, recording payment, and creating adjustment invoices
  - `app/invoices/layout.tsx`, `app/invoices/page.tsx`, `app/invoices/[id]/page.tsx` — invoices list and detail pages with locked invoice handling, payment history, payment form, and adjustment form
  - `src/components/invoices/invoice-status-badge.tsx`, `src/components/invoices/invoices-table.tsx`, `src/components/invoices/payment-history-table.tsx` — minimal invoice UI components
  - `src/modules/bookings/booking.service.ts` — adjusted booking payment status lookup for `Order.invoices[]`
  - `src/modules/dashboard/dashboard.service.ts` — revenue and recent activity now read payment `paidAt`/invoice customer data
  - Prisma client regenerated; local migration applied and marked as applied; `npm run build` passes
  - Decision: adjustment invoices are only allowed for locked parent invoices and never mutate the locked parent
  - Decision: payments cannot be recorded directly against locked invoices; staff must use an adjustment invoice for new post-lock money
  - Post-review fixes:
    - `prisma/schema.prisma` + `prisma/migrations/20260505020000_invoice_number_sequence/migration.sql` — added DB-backed `invoiceSeq` sequence for atomic invoice number generation
    - `src/modules/invoices/invoice.service.ts` — paginated `getInvoices()` defaults, clear locked/missing issue errors, draft-preserving status recalculation, and sequence-based invoice number generation
    - `app/invoices/actions.ts` + `src/components/invoices/record-payment-form.tsx` — structured payment validation errors, pending submit state, disabled fields while saving, and shared Select usage
    - `app/invoices/[id]/page.tsx` — local route props type replaces ambiguous global `PageProps`; payment form delegated to the client component
    - `prisma/seed.ts` — kept seeded invoice numbers aligned with generated invoice sequences
    - Validation: `npm run db:generate`, `npx prisma migrate deploy`, `npx prisma migrate status`, and `npm run build` pass

- Feature 15: Add New Booking Page (`context/feature-specs/15-add-new-booking.md`):
  - `src/modules/bookings/booking.schema.ts` — Zod `createBookingSchema` + `CreateBookingInput` type for the 5 form fields
  - `src/modules/bookings/booking.service.ts` — added `createBookingInDb()` which creates a booking with `status=PENDING` and `depositPaid=0`
  - `app/bookings/new/actions.ts` — `createBooking` server action: parses FormData, validates with Zod, calls service, redirects to `/bookings` on success or returns field errors
  - `src/components/bookings/new-booking-form.tsx` — client component using `useActionState` + `useFormStatus`; 5 fields (customer select, package select, date input, session type select, notes textarea); inline field-level errors; loading state on submit
  - `app/bookings/new/page.tsx` — async server component; fetches customers + active packages in parallel; renders page header with back link + form card
  - `app/bookings/page.tsx` — "New Booking" button now links to `/bookings/new` via `<Link>` + `asChild`
  - TypeScript clean; `npm run build` passes; `/bookings/new` route live

- Feature 14: Orders Page UI (`context/feature-specs/14-orders-payments-page-ui.md`):
  - `src/modules/orders/order.types.ts` — `OrderStatus` (7 values), `InvoiceStatus` (4 values), `Order` interface
  - `src/components/orders/order-status-badge.tsx` — pill badge; 7 statuses with correct color mapping (info/warning/success/danger)
  - `src/components/orders/invoice-status-badge.tsx` — pill badge; 4 statuses mirroring `payment-status-badge.tsx` colors
  - `src/components/orders/orders-filters.tsx` — client component: search input + Order Status select + Invoice Status select (non-functional placeholders)
  - `src/components/orders/orders-table.tsx` — 10-column table (Customer, Package, Order Status, Total, Paid, Remaining, Invoice Status, Method, Created, Actions); Remaining shown in red when > `"0.000 KD"`, muted otherwise
  - `app/orders/layout.tsx` — `AppShell` with `pageTitle="Orders"`
  - `app/orders/page.tsx` — async server component; 6-row `MOCK_ORDERS` array covering all 4 `InvoiceStatus` values and 5+ distinct `OrderStatus` values
  - `src/components/layout/sidebar.tsx` — Orders link added under Bookings/Customers group with `ReceiptText` icon pointing to `/orders`
  - TypeScript clean; `npm run build` passes; `/orders` route live



- Feature 13: Packages Page (`context/feature-specs/13-packages-page.md`):
  - `src/modules/packages/package.types.ts` — `Package` interface with `id`, `name`, `price` (formatted string), `photoCount`, `description`, `bookingCount`, `status`
  - `src/modules/packages/package.service.ts` — `getPackages()` fetches all packages via Prisma with `_count.bookings`, ordered by `price ASC`; price formatted as `"150.000 KD"` via `Intl.NumberFormat`; wrapped with `withRetry`
  - `src/components/packages/package-status-badge.tsx` — `Active` (green) / `Inactive` (red) badge matching customer badge pattern
  - `src/components/packages/packages-filters.tsx` — client component: search by name input + status select (non-functional placeholders)
  - `src/components/packages/packages-table.tsx` — table with Name, Price, Photos Included, Description, Bookings, Status, Actions columns
  - `app/packages/layout.tsx` — `AppShell` with `pageTitle="Packages"`
  - `app/packages/page.tsx` — async server component; calls `getPackages()`, renders header, filters, table
  - TypeScript clean; `npm run build` passes; `/packages` route live

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

- Feature 19 and beyond (not yet specified)

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
