# 166 · Financial Documents Register — Filters (Type · Date range · Outstanding only)

> Follow-up to Spec 165. **Presentation/read-layer + a client filter control only.** No `Invoice`
> model, enum, numbering, financial-engine, or money-math change. Adds filter predicates to the
> register's existing single `where` chokepoint so both the paginated rows and the full-set footer
> subtotals reflect the active filters. Owner decisions (locked 2026-06-10): filters = **Type**,
> **Date range**, **Outstanding only**; date basis = **`createdAt`**. (Status filtering deliberately
> excluded — accountant status is partly derived for credit notes and is not a clean DB predicate.)

## Goal

Let the accountant scope the Financial Documents register and read **period/segment-correct
subtotals**. Today `/invoices` has only free-text search (job/invoice number, phone). Spec 165 already
computes footer subtotals over the **full filtered set** (a second `findMany` sharing the same
`where`), so adding filter predicates to that one `where` makes the footer re-tally automatically —
e.g. "Adjustments, created this month" shows just those rows *and* their gross/credits/receivable
subtotals.

## Read First

- `context/feature-specs/165-financial-documents-register-presentation.md` — the register this extends
  (the merged spec; #244 `5c10f21`).
- `src/modules/invoices/invoice.service.ts`:
  - `getInvoices({ page, pageSize, search })` → `InvoiceRegisterView` (l.~860): the dual query — `rows`
    (paginated) and `subtotalRows` (full set) both built from `buildInvoiceWhere(search)`.
  - `buildInvoiceWhere(search)` (l.~3806): the single `where` chokepoint to extend.
  - `buildInvoiceRegisterSubtotals` (l.~1080): `receivable` = Σ `remainingAmount` on **FINAL +
    ADJUSTMENT** rows — the definition "Outstanding only" must match.
- `app/invoices/page.tsx` — reads `searchParams.search` only; must also read the new filter params.
- `src/components/invoices/invoices-filters.tsx` — client control, currently just the search input.
- `prisma/schema.prisma` `enum InvoiceType { DEPOSIT FINAL ADJUSTMENT REFUND CREDIT_NOTE SALE }`.
- `context/ui-context.md` — tokens, control/badge patterns (light-mode luxury admin).
- **Reuse the orders-list filter pattern (the template for this spec):**
  - `app/orders/page.tsx` — `parseOrderFilters(searchParams)` → `getOrders(filters)` →
    `<OrdersFilters currentFilters={filters} … />`. Mirror this wiring exactly.
  - `src/modules/orders/order.service.ts` `parseOrderFilters` + `order.types.ts` `OrderFilters` —
    the param-parsing + typed-filter shape to mirror as `parseInvoiceFilters` / `InvoiceFilters`.
  - `src/components/orders/orders-filters.tsx` — the client control to mirror: search `Input`,
    shadcn `Select` dropdowns, the shared `DateRangePicker`, toggle `Button`, a **Reset filters**
    button, all driven by `router.replace` URL params (treating `""`/`"all"` as delete).
  - `src/components/ui/date-range-picker.tsx` (`@/components/ui/date-range-picker`) — **reuse
    directly** for the `createdAt` range; do not build a new date control.
- **New multi-select Type control = searchable combobox (`Popover` + `Command` + `Checkbox`):**
  - The kit already has `popover` + `button`; it does **not** have `command` or `checkbox`. Add both
    via the shadcn CLI: `npx shadcn@latest add command checkbox` (core `@shadcn` registry — no
    community registry). After adding, **re-theme the generated files to the app's tokens** (surface
    `#FFFFFF`, border `#E6DED2`, accent, text-primary/secondary) — shadcn defaults use generic
    `bg-background`/`text-muted-foreground` semantic tokens.
  - Do NOT use/modify `toggle-group.tsx` (single-value only) or `dropdown-menu.tsx` (a menu can't host
    a clean search box — Radix menu typeahead fights an inner input). The searchable list belongs to
    `Command` (cmdk).
  - Model after the shadcn **`@shadcn/combobox-popover`** example, adapted to multi-select (panel stays
    open on toggle; each item renders a `Checkbox`).

## Rules

- **Presentation + read-layer + one client control only.** No engine/model/enum/numbering/money-math
  change. Filters are pure `Prisma.InvoiceWhereInput` predicates ANDed into the existing `where`.
- **One `where`, two queries.** All filters go through `buildInvoiceWhere` so `rows`, `subtotalRows`,
  and therefore the footer subtotals always reflect the same filter set. Never filter rows in the
  component or filter the two queries differently.
- **Filters AND with search.** An active search (its existing OR-group) is combined with the filter
  predicates via `AND`; clearing one must not clear the other.
- **Read-layer discipline.** No `@/lib/db` under `app/**` or `src/components/**`. The page parses
  search params and passes typed args; the client control only reads/writes URL query params.
- **Reuse the orders-list filter pattern for structure and wiring:** `parseInvoiceFilters` mirrors
  `parseOrderFilters`; `InvoicesFilters` mirrors `OrdersFilters` (search `Input` + shared
  `DateRangePicker` + toggle `Button` + Reset, all via URL params). Reuse `DateRangePicker` and
  existing primitives. **In scope: add the `command` + `checkbox` shadcn primitives and build one new
  reusable `MultiSelect`** (searchable `Popover` + `Command` + `Checkbox` combobox) for the Type
  filter — themed to app tokens, usable on other list pages later.
- **Filter ⇄ footer consistency.** "Outstanding only" must select exactly the rows the `receivable`
  subtotal sums (FINAL/ADJUSTMENT with `remainingAmount > 0`), so the filtered view and its footer agree.

## Scope

### In Scope

- **Add `InvoiceFilters` type + `parseInvoiceFilters(searchParams)`** in the invoice module, mirroring
  `OrderFilters` / `parseOrderFilters`:
  - `search?: string` (existing behavior),
  - `types?: InvoiceType[]` (multi-select; each value validated against the enum — drop unknowns),
  - `createdFrom?: string` / `createdTo?: string` (date strings, as the `DateRangePicker` emits),
  - `outstandingOnly?: boolean`.
  Parsing is array-safe and lenient: unknown/invalid values are dropped, not errors. `"all"`/empty =
  unset (same convention as orders).
- **`getInvoices(filters: InvoiceFilters)`** takes the parsed object (keeping `page`/`pageSize`) and
  threads it into the `where` builder. The dual `rows`/`subtotalRows` query still shares one `where`.
- **Extend `buildInvoiceWhere`** to take the filter object (e.g.
  `buildInvoiceWhere({ search, types, createdFrom, createdTo, outstandingOnly })`) and AND these in:
  - **Type:** `types?.length ? { invoiceType: { in: types } } : {}`.
  - **Date range (createdAt):** `{ createdAt: { gte: <start-of createdFrom>, lte: <end-of createdTo> } }`.
    Treat bounds as **inclusive whole days** (start of `from` day → end of `to` day, in the app's
    existing date convention) so a same-day from/to returns that day's rows.
  - **Outstanding only:** `{ invoiceType: { in: [FINAL, ADJUSTMENT] }, remainingAmount: { gt: 0 } }`
    — matching the `receivable` subtotal definition exactly.
  - **Search** stays its current OR-group; the function returns `{ AND: [searchGroup?, ...filters] }`
    (omit empty clauses; return `undefined` when nothing is set, preserving today's behavior).
- **`/invoices` page** calls `parseInvoiceFilters(await props.searchParams)` and passes the result to
  `getInvoices` (exactly like `app/orders/page.tsx`); also passes `currentFilters` to the control.
- **Add the `command` + `checkbox` shadcn primitives** (`npx shadcn@latest add command checkbox`, core
  `@shadcn`), then **re-theme the generated files** to the app tokens (surface/border/accent/text) —
  shadcn defaults ship generic `bg-background`/`text-muted-foreground` classes.
- **Add a reusable `MultiSelect` component** (`src/components/ui/multi-select.tsx`): a searchable
  combobox = `Popover` (panel) + `Button` (trigger) + `Command` (`CommandInput` search box +
  `CommandList`/`CommandEmpty`/`CommandItem` per option) + `Checkbox` per row.
  - Props ≈ `{ options: {value,label}[]; selected: string[]; onChange(next: string[]); placeholder?;
    searchable?: boolean; className? }`. `searchable` (default true) toggles the `CommandInput`.
  - **Multi-select behavior:** clicking an item toggles its value in `selected` and **keeps the panel
    open** (no close-on-select); `Command` provides filtering + keyboard nav.
  - **Trigger summary:** placeholder when empty, the single label when one is picked, and
    `"<label>, <label> +N"` when several (e.g. `"Final, Credit note +1"`).
  - Pure presentation; no data fetching. Themed with existing tokens (light-mode luxury admin).
- **Rebuild `InvoicesFilters` on the `OrdersFilters` skeleton**, beside the existing search box:
  - a **Type** filter using the new searchable `MultiSelect` (Deposit / Final / Adjustment / Credit
    note / Refund), bound to the repeatable `type` URL param,
  - the shared **`DateRangePicker`** bound to `from`/`to` (createdAt range),
  - an **Outstanding only** toggle `Button` (orders toggle styling: `aria-pressed`, active/inactive
    token classes),
  - and a **Reset filters** `Button` (disabled when no filters active),
  takes `currentFilters: InvoiceFilters`, and writes/removes each URL query param via `router.replace`
  (preserving unrelated params). The `type` param is **repeatable** (`?type=FINAL&type=ADJUSTMENT`);
  parse it array-safely (`getAll`). Reflects active filters from the URL on load.
- **Empty state:** when filters yield zero rows, the table shows a clear "no documents match these
  filters" empty state and the footer subtotals read zero — not a broken/blank table.

### Out of Scope

- **Status filtering** (excluded by owner decision; CN status is derived, not a DB predicate).
- Any engine/model/enum/numbering/money-math change; no change to subtotal *definitions* (only which
  rows feed them, via the shared `where`).
- Pagination redesign — page remains as today; filters simply narrow the set. (See Considerations.)
- Saved/named filter presets, CSV export, period rollups/AR aging (future reporting project).
- The invoice **detail** page and the Sales linked-documents surface (165 Part B/C) — unchanged.

## Implementation Direction

1. **Read layer:** add `InvoiceFilters` + `parseInvoiceFilters` (mirror `OrderFilters`/
   `parseOrderFilters`); change `getInvoices` to take the filter object and thread it into
   `buildInvoiceWhere`; keep the dual `rows`/`subtotalRows` query sharing the one `where`. No new
   aggregation — subtotals already recompute over `subtotalRows`.
2. **`buildInvoiceWhere`:** build an `AND` array of present predicates (search OR-group + type +
   date + outstanding); return `undefined` when empty so the unfiltered path is byte-equivalent to today.
3. **Page:** call `parseInvoiceFilters(await props.searchParams)` and pass to `getInvoices` +
   `currentFilters` to the control (mirror `app/orders/page.tsx`). No DB access in the page.
4. **Primitives + MultiSelect:** `npx shadcn@latest add command checkbox`, re-theme the generated
   files to app tokens, then add `src/components/ui/multi-select.tsx` (searchable `Popover` + `Command`
   + `Checkbox` combobox; toggle-keeps-open; `"+N"` summary trigger).
5. **Client control:** rebuild `InvoicesFilters` on the `OrdersFilters` skeleton — search `Input`, Type
   `MultiSelect`, shared `DateRangePicker`, Outstanding-only toggle `Button`, Reset `Button` — all via
   URL params (`router.replace`), preserving the existing search and unrelated params.

## Observability Checklist

### Rollback Plan
- Pure read-layer + client-control revert; no schema/engine change, no migration.

### Customer-Visible Surface
- Internal accountant-facing register only; no customer-facing change.

## Considerations / Risks

- **Date bounds / timezone:** inclusive whole-day semantics on `createdAt` must use the app's existing
  date handling so `to` includes the end of the chosen day; an exclusive or naive-midnight bound would
  silently drop same-day rows. Invalid dates are ignored, not thrown.
- **Filter ⇄ subtotal divergence** is the main correctness risk: rows and `subtotalRows` MUST share the
  identical `where`. Do not add a filter to one query and not the other.
- **Outstanding-only must mirror the `receivable` definition** (FINAL/ADJUSTMENT, `remainingAmount > 0`).
  If the subtotal definition ever changes, this predicate changes with it.
- **Pagination interaction:** subtotals are full-filtered-set (correct); if/when pagination lands, the
  footer must keep aggregating the whole filtered set, not the page.
- **New primitives need a theming pass:** `command`/`checkbox` ship with generic shadcn semantic
  classes; left as-is they'll look off against the luxury-admin palette. Re-theme to app tokens.
  (`command` pulls the `cmdk` dependency — install with the project package manager.)
- **Multi-select close-on-select:** the combobox must NOT close when an item is toggled (users pick
  several); ensure selecting an item only updates state and the panel stays open until dismissed.

## Acceptance Criteria

- The register supports **Type** (multi-select via the new searchable `MultiSelect` combobox =
  `Popover`+`Command`+`Checkbox`; panel stays open while toggling; multiple types combine as
  `invoiceType IN`; trigger shows a `"Final, Credit note +1"` summary), **date-range (on `createdAt`,
  inclusive)**, and **Outstanding only** filters, combinable with each other and with free-text search
  (ANDed); a **Reset filters** action clears them. The control mirrors `OrdersFilters` wiring and reuses
  `DateRangePicker`; the `type` param is repeatable and parsed array-safely.
- **Footer subtotals re-tally to the filtered set** — e.g. filtering to Adjustments narrows both the
  rows and the gross/credits/net/receivable subtotals to adjustments; an empty result shows zero
  subtotals and an empty-state table, not a blank/broken page.
- **Outstanding only** returns exactly FINAL/ADJUSTMENT rows with `remainingAmount > 0` (matching the
  `receivable` subtotal), and its footer Receivable equals the sum of the visible Outstanding column.
- Unknown/invalid filter params are ignored; the unfiltered register is unchanged from today
  (`buildInvoiceWhere` returns `undefined` when nothing is set).
- No `@/lib/db` under `app/**` or `src/components/**`; no engine/model/enum/numbering/money-math change;
  rows and subtotals share one `where`.
- `npm run build` and `npm run lint` pass; tests cover the where-builder for each filter and
  combinations (type, date inclusive bounds, outstanding-only = open charges, search+filter AND), and
  that subtotals reflect the filtered set.
