# 168 · Session Moment as a Single Instant (`sessionStartsAt`)

> **Data-model + backend change** (explicitly authorized). Replaces the ambiguous, split
> `Booking.sessionDate (DateTime) + sessionTime (String)` representation with **one authoritative UTC
> instant `Booking.sessionStartsAt`**, computed from the Kuwait-local (date + time) at write time and
> displayed everywhere via the Spec 167 studio-timezone util. Fixes the order-detail +3h session-time
> bug at its root and makes the session moment robust for the calendar, sorting, filtering, and any
> future consumer. Owner decisions (locked 2026-06-10): **new clearly-named field**; **dev data is
> disposable — wipe & recreate, no backfill.**

## Goal

A session happens at a specific Kuwait wall-clock moment (e.g. *11 Jun 2026, 17:00 Kuwait*). Today that
moment is stored ambiguously and inconsistently:
- `sessionDate: DateTime` — sometimes midnight (real booking form sends a date-only value), sometimes
  carrying a **naive** wall-clock time (the dev seeder / combined inputs bake `17:00` in, stored as
  `17:00Z`). It is timezone-ambiguous either way.
- `sessionTime: String "HH:MM"` — a separate, redundant "authoritative" time.

Because there is no single reliable instant, every consumer improvises: the booking views show the
date + the `sessionTime` string; **order detail formats the naive `sessionDate` datetime** and (after
Spec 167's studio-tz formatting) shows it **+3h wrong** (17:00 → 20:00); the **calendar** uses
`sessionDate.toISOString()` as the event start and inherits the same ambiguity. Store the moment once,
correctly, and read it everywhere.

## Read First

- `prisma/schema.prisma` `model Booking` (l.~557): `sessionDate DateTime` + `sessionTime String` — the
  fields being replaced.
- `src/lib/formatting/dates.ts` (Spec 167) — the studio-timezone util to extend with a
  wall-clock→instant helper and (optionally) a time-only formatter.
- Write path: `src/modules/bookings/booking.service.ts` create (~l.457) and update/reschedule (~l.577);
  `src/modules/bookings/booking.schema.ts` (`sessionDate`/`sessionTime` inputs, l.44-47, 66-67).
- Display/consumer sites (must move to `sessionStartsAt`):
  - `src/modules/orders/order.service.ts` — `formatDateTime(booking.sessionDate)` at **l.627** and
    **l.873** (the order-detail bug); the order session-date filter (`toUtcDateBoundary`, ~l.2046).
  - `src/modules/calendar/calendar.service.ts` — event `start`/`end` from `sessionDate` (l.70, 86-87).
  - `src/modules/bookings/booking.service.ts` list/detail (`formatSessionDate` + `sessionTime`,
    ~l.298, 1491, 1532) and the booking session-date filter (~l.1413).
  - `src/modules/customers/customer.service.ts`, `src/modules/dashboard/dashboard.service.ts`,
    `src/modules/order-commits/projections/sales-page-view.{loader,types}.ts`,
    `src/modules/orders/order.types.ts`, `src/modules/customers/customer.types.ts`.
  - Components reading session fields: `bookings-table.tsx`, `new-booking-form.tsx`,
    `edit-booking-form.tsx`, `orders-filters.tsx`, `production-queue-table.tsx`,
    `editing-queue-table.tsx`, `phone-sales-search.tsx`.
- Dev seeding: `src/modules/development/dev-create-booking.service.ts` (`buildNextDaySessionDate`,
  `TEST_BOOKING_TIME`).
- `context/code-standards.md` — the Spec 167 date/time standard to extend.

## Rules

- **One instant is the source of truth.** `Booking.sessionStartsAt: DateTime` (UTC) is the session
  moment. No other column stores session date or time; `sessionDate` and `sessionTime` are **removed**.
- **Kuwait-local in, UTC stored, Kuwait-local out.** Inputs are Kuwait wall-clock (date + `HH:MM`);
  convert to the UTC instant at write time; display via the studio-tz util. Kuwait has **no DST** →
  the fixed +3 offset is exact.
- **No naive datetimes, no split date/time storage.** This is the modeling rule the bug violated.
- **Read-layer discipline preserved.** Services compute/format; no `@/lib/db` under `app/**` or
  `src/components/**`; components render strings the read layer provides.
- **Wipe & recreate** (owner decision): destructive migration is acceptable; **no historical backfill**.

## Scope

### In Scope

- **Schema:** add `Booking.sessionStartsAt DateTime`; **remove** `sessionDate` and `sessionTime`.
  Migration drops the old columns and adds the new one (dev data reset; no backfill). Update any index
  / `orderBy` that referenced `sessionDate` to use `sessionStartsAt`.
- **Util (`dates.ts`):** add
  - `studioWallClockToInstant(date: "YYYY-MM-DD", time: "HH:MM"): Date` →
    `Date.UTC(y, m-1, d, H - KUWAIT_UTC_OFFSET_HOURS, M, 0, 0)` (Kuwait local → UTC instant; null-safe).
  - `formatStudioTime(date: Date): string` → `HH:MM` (24h) in `STUDIO_TIME_ZONE`, for surfaces that
    want time only. (`formatStudioDate` / `formatStudioDateTime` already exist.)
- **Write path:** booking create + update/reschedule compute
  `sessionStartsAt = studioWallClockToInstant(input.date, input.time)` and persist only that. The
  booking **input schema/forms keep separate date + time fields for UX** (a date picker + a time
  picker) — only the *stored representation* unifies; the server action combines them.
- **Displays → `sessionStartsAt`:**
  - Order detail (l.627 + l.873): `formatStudioDateTime(sessionStartsAt)` — fixes the +3h bug.
  - Booking list/detail: `formatStudioDate(sessionStartsAt)` (+ `formatStudioTime` where a separate
    time is shown).
  - Customer, dashboard, sales-page-view, and the queue/table components: same swap, via the util.
- **Calendar:** event `start = sessionStartsAt.toISOString()`, `end = start + durationMinutes`; ensure
  the calendar renders in `STUDIO_TIME_ZONE` so events land in the correct slot.
- **Filters:** booking and order session-date range filters operate on `sessionStartsAt` using
  `studioDayRange` (Kuwait day boundaries), replacing the old date-based UTC boundary logic.
- **Dev seeding:** `dev-create-booking` sets `sessionStartsAt` via `studioWallClockToInstant`
  (replacing `buildNextDaySessionDate` + `sessionTime`).
- **Standard:** extend `context/code-standards.md` — *session/appointment moments are stored as a
  single UTC instant (`sessionStartsAt`) and displayed via `dates.ts`; never split a moment across a
  date column + a time string, and never store a naive wall-clock datetime.*

### Out of Scope

- Multi-timezone / per-tenant timezones (studio is single-tenant Asia/Kuwait).
- Other date fields already correct after Spec 167 (true instants like `createdAt`, `issuedAt`).
- Any change to session **duration** modeling beyond using it for the calendar `end` as today.
- Financial engine, money math, invoices/credit logic — untouched.

## Implementation Direction

1. **Schema + migration:** add `sessionStartsAt`, drop `sessionDate`/`sessionTime`, fix referencing
   `orderBy`/indexes; regenerate dev data (no backfill).
2. **Util:** add `studioWallClockToInstant` + `formatStudioTime` to `dates.ts` (+ tests).
3. **Write path + schema/forms:** combine date + time inputs → `sessionStartsAt` on create/update;
   forms keep their two pickers.
4. **Consumers:** replace every `sessionDate`/`sessionTime` read with `sessionStartsAt` + the studio
   formatters (order detail, bookings, calendar, customer, dashboard, sales-page-view, components).
5. **Filters:** move booking/order session range filters onto `sessionStartsAt` + `studioDayRange`.
6. **Dev seeding + standard + tests.** Run lint + build.

## Observability Checklist

### Rollback Plan
- Schema revert (re-add old columns, drop `sessionStartsAt`) + code revert; dev data regenerated either
  way. Destructive migration is acceptable per owner decision.

### Customer-Visible Surface
- Internal scheduling/admin surfaces; no customer-facing receipt/document change.

## Considerations / Risks

- **Conversion correctness is the crux.** A Kuwait `17:00` must store as `14:00Z` and render back as
  `17:00`. Assert round-trip (`studioWallClockToInstant` then `formatStudioDateTime`) in tests,
  including a late-evening case that crosses the UTC date line (e.g. Kuwait `23:30` → prev-day `20:30Z`,
  still displays the correct Kuwait day).
- **Destructive migration.** `sessionDate`/`sessionTime` are dropped; this is intentional (dev data
  disposable). Confirm no production data before running. Do NOT ship this against a populated prod DB
  without a backfill (explicitly out of scope here).
- **Find every consumer.** The grep list above is the starting set; a stray reader left on the old
  fields will fail to compile (fields removed) — treat compile errors as the checklist, and ensure no
  `sessionDate`/`sessionTime` references remain.
- **Calendar render timezone.** FullCalendar must interpret the ISO start in `STUDIO_TIME_ZONE`, not
  browser-local, or events shift again. Verify event placement explicitly.
- **Filter ⇄ display agreement** (as in Spec 167): the day a session shows and the day it filters under
  must match — now both derive from `sessionStartsAt`.

## Acceptance Criteria

- `Booking` has a single `sessionStartsAt: DateTime`; `sessionDate` and `sessionTime` no longer exist;
  no code references them.
- A booking entered as Kuwait **11 Jun 2026, 17:00** stores `2026-06-11T14:00:00Z` and displays
  **17:00** on order detail, booking views, calendar, and any other surface — never 20:00.
- The **order-detail session time** matches the booking's session time exactly (the original bug is gone).
- The **calendar** places the event at the correct Kuwait time (start from `sessionStartsAt`, rendered
  in `STUDIO_TIME_ZONE`).
- Session date-range **filters** operate on `sessionStartsAt` via `studioDayRange`, and the day a
  session filters under equals the day it displays.
- `dates.ts` round-trip tests pass (wall-clock → instant → formatted), including the UTC-date-crossing
  evening case; `code-standards.md` carries the single-instant rule.
- No financial/money/engine change; read-layer discipline preserved (no `@/lib/db` in `app/**` or
  `src/components/**`); `npm run lint` and `npm run build` pass.
