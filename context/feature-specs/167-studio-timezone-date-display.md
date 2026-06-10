# 167 · Studio Timezone for Date Display & Filters (Asia/Kuwait)

> Bug fix, read-layer/display only. **No schema, stored-data, financial-engine, enum, or money-math
> change.** Centralizes the studio timezone (**Asia/Kuwait, UTC+3, no DST**) and routes all list/detail
> date *display* formatters and the invoice created-date *filter boundaries* through it, so dates read
> and filter by the studio's local calendar day instead of UTC.

## Goal

Records created late in the Kuwait evening land just before UTC midnight (e.g. `2026-06-09T23:57Z`),
which is already **June 10** in Kuwait. Today the orders/invoices/bookings/customers lists format with
`timeZone: "UTC"`, so they display the **wrong day** ("9 Jun"). The dashboard already uses
`Asia/Kuwait` and is correct. Additionally, the Spec 166 invoice created-date filter builds day
boundaries with `Date.UTC(...)`, so selecting "Jun 10" **excludes** Kuwait-local `00:00–02:59` rows.
Display and filter must move to the studio timezone **together** — otherwise a column reads "10 Jun"
while the "Jun 10" filter still drops it.

## Read First

- `src/modules/dashboard/dashboard.service.ts` — the correct, existing pattern: `STUDIO_TIME_ZONE =
  "Asia/Kuwait"`, `KUWAIT_UTC_OFFSET_HOURS = 3`, `getStudioDateParts`, and the day-boundary math
  (`Date.UTC(y, m-1, d, -KUWAIT_UTC_OFFSET_HOURS, …)`). This logic is what gets centralized.
- `src/lib/formatting/money.ts` — the established shared-formatter module pattern; add the date util
  beside it as `src/lib/formatting/dates.ts`.
- The six UTC display formatters to convert:
  - `src/modules/invoices/invoice.service.ts` `formatDate` (l.~4144).
  - `src/modules/orders/order.service.ts` `formatDate` (l.~2543) **and** `formatDateTime` (l.~2554).
  - `src/modules/bookings/booking.service.ts` `formatDate` (l.~1460).
  - `src/modules/orders/order-activity.service.ts` `formatDateTime` (l.~83).
  - `src/modules/customers/customer.service.ts` `formatDate` (l.~690).
- The filter boundary functions to convert: `src/modules/invoices/invoice.service.ts`
  `parseDateStart` / `parseDateEnd` (l.~3973) — currently `Date.UTC(...)` whole-day bounds.

## Rules

- **Display + query-boundary only.** No schema/migration/stored-data change; stored timestamps stay
  UTC in the DB. This spec only changes how they are *formatted* and how filter *day boundaries* are
  computed. No money math, no engine, no enum/numbering.
- **One source of truth for the studio timezone.** Define `STUDIO_TIME_ZONE` + offset once in
  `src/lib/formatting/dates.ts`; every formatter and boundary imports it. No more inline
  `timeZone: "UTC"` literals in the converted spots, and no duplicate timezone constants.
- **Read-layer discipline.** Formatting stays in the read/service layer (services return formatted
  strings, as today); no `@/lib/db` under `app/**` or `src/components/**`; components keep rendering
  strings.
- **Fixed offset is safe.** Kuwait observes **no DST** (UTC+3 year-round), so the numeric offset used
  for day-boundary math is exact and constant. (Display formatters use `Intl` with `timeZone`, which
  is correct regardless.)

## Scope

### In Scope

- **Add `src/lib/formatting/dates.ts`** exporting:
  - `STUDIO_TIME_ZONE = "Asia/Kuwait"` and `KUWAIT_UTC_OFFSET_HOURS = 3`.
  - `formatStudioDate(date)` → `en-GB` `{ day:"numeric", month:"short", year:"numeric" }` in
    `STUDIO_TIME_ZONE` (the current `formatDate` shape, just studio-tz).
  - `formatStudioDateTime(date)` → same plus `{ hour:"2-digit", minute:"2-digit", hour12:false }` in
    `STUDIO_TIME_ZONE` (the current `formatDateTime` shape).
  - `studioDayRange(dateInput: "YYYY-MM-DD")` → `{ start: Date; end: Date }` giving the UTC instants
    that bound that **Kuwait calendar day** (start = Kuwait `00:00:00.000`, end = Kuwait
    `23:59:59.999`), using the dashboard's offset formula. Returns `undefined`/null-safe on invalid
    input (preserve `parseDateInput`'s `YYYY-MM-DD` validation).
  - Null/invalid-date guards mirroring the existing formatters (e.g. return `"—"` where they do).
- **Convert the six display formatters** to delegate to `formatStudioDate` / `formatStudioDateTime`
  (replace their inline `Intl … timeZone:"UTC"`). Output shape/locale unchanged — only the timezone.
- **Convert the invoice filter boundaries:** `parseDateStart`/`parseDateEnd` (or the `buildInvoiceWhere`
  `createdAt` range) compute the day window via `studioDayRange`, so selecting a Kuwait day includes
  that day's Kuwait-local `00:00–23:59` rows. The validation/lenient-drop behavior from Spec 166 is
  preserved (invalid dates ignored, not thrown).
- **De-duplicate the dashboard constant:** dashboard imports `STUDIO_TIME_ZONE` /
  `KUWAIT_UTC_OFFSET_HOURS` from the new util instead of its local copies (keep dashboard's
  specialized week/today logic; just stop redefining the constants).

### Out of Scope

- Any change to stored timestamps, schema, or a data migration (DB stays UTC).
- User-configurable / multi-timezone support (studio is single-tenant Asia/Kuwait).
- Reworking the dashboard's week/today aggregation logic beyond importing the shared constants.
- Client-side date formatting changes — none expected (dates are formatted in the read layer); if any
  raw client-side `toLocaleDateString`/UTC formatting is found, note it for a follow-up rather than
  expanding scope here.
- Any unrelated `timeZone` usage that is intentionally UTC (none identified; all six are display bugs).

## Implementation Direction

1. **Add the util** (`src/lib/formatting/dates.ts`) with the constants, two formatters, and
   `studioDayRange`, ported from the dashboard's proven offset math.
2. **Point the six formatters at it** — each becomes a thin call to `formatStudioDate` /
   `formatStudioDateTime`; keep their null guards.
3. **Fix the invoice filter** to derive `createdAt` `gte`/`lte` from `studioDayRange`, keeping Spec
   166's validation and the single shared `where` (rows + subtotalRows unchanged).
4. **Refactor dashboard** to import the shared constants (no behavior change there).
5. Add focused tests (below). Run lint + build.

## Observability Checklist

### Rollback Plan
- Pure display/query-boundary revert; no schema/engine change, no data migration.

### Customer-Visible Surface
- Internal admin date columns/filters only; no customer-facing receipt/document change.

## Considerations / Risks

- **Boundary correctness is the crux.** A Kuwait day `[00:00, 23:59:59.999]` maps to UTC
  `[prevDay 21:00, day 20:59:59.999]`. The filter window must use these instants so a row at
  `…T23:57Z` (Kuwait next-day 02:57) is included under the next Kuwait day, matching how it now
  displays. Add an explicit test at the midnight edge.
- **Display ↔ filter must agree.** After this change, the day a row *shows* and the day it *filters
  under* must be the same Kuwait day — that's the whole point; assert it in a test.
- **No backward day-shift risk.** Kuwait is east of UTC, so date-only values stored at UTC midnight
  still render on the same calendar day (03:00) — converting UTC→Kuwait cannot move a date earlier.
- **No DST:** the fixed +3 offset for boundary math is exact year-round.

## Acceptance Criteria

- A record created at `2026-06-09T23:57:46Z` displays as **10 Jun 2026** on the invoices, orders,
  bookings, customers, and order-activity surfaces (studio timezone), not "9 Jun".
- Selecting the **Jun 10** created-date filter on `/invoices` **includes** that record (and excludes
  one created at Kuwait-local Jun 9 23:59), i.e. the filter day window matches the displayed day.
- `STUDIO_TIME_ZONE` / `KUWAIT_UTC_OFFSET_HOURS` exist once in `src/lib/formatting/dates.ts`; the six
  formatters and the dashboard import them; no remaining inline `timeZone:"UTC"` in the converted spots
  and no duplicate timezone constant.
- No schema/stored-data/engine/money-math change; read-layer discipline preserved (no `@/lib/db` under
  `app/**` or `src/components/**`); the invoice filter still shares one `where` for rows + subtotals.
- `npm run build` and `npm run lint` pass; tests cover `formatStudioDate`/`formatStudioDateTime` at the
  UTC-evening edge, `studioDayRange` boundaries, and the invoice filter including/excluding the correct
  Kuwait day (display↔filter agreement).
