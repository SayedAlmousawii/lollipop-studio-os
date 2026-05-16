## Goal
Build the Packages page: create the UI and connect it to real database data in a single unit.

## Rules
- Read `AGENTS.md` first.
- Use existing project architecture and code standards.
- Do not modify shadcn/ui generated files.
- Do not add create/edit/delete functionality yet.
- Do not add authentication or permissions in this unit.
- Keep this unit read-only.

## Context
The sidebar already has a Packages nav link but the route does not exist. The `Package` model is in the Prisma schema with seed data (3 packages). Packages are referenced by bookings and orders. Follow the exact same pattern used for the Customers page (Feature 09).

## Scope
Create the Packages page route, connect it to PostgreSQL via Prisma, and display all packages in a table.

## Package Model Fields
- `id`, `name`, `price` (Decimal 10,3), `photoCount` (Int), `description` (String?), `isActive` (Boolean)
- Relations: `bookings[]`, `originalOrders[]`, `finalOrders[]`

## Requirements
- Use the existing Prisma client from `src/lib/db`.
- Use `withRetry` from `src/lib/retry` for the DB call.
- Fetch all packages ordered by `price ASC`.
- Include `_count: { select: { bookings: true } }` to show booking count per package.
- Format price as `"150.000 KD"` using `Intl.NumberFormat` with `minimumFractionDigits: 3`.
- Page must use `AppShell` (via layout) and `PageContainer`.
- Filters (search by name, status select) are rendered but non-functional placeholders.

## Table Columns

| Column | Value |
|---|---|
| Name | `package.name` |
| Price | formatted price string |
| Photos Included | `package.photoCount` |
| Description | `package.description` or `—` |
| Bookings | booking count |
| Status | Active / Inactive badge |
| Actions | Dropdown with Edit (placeholder) |

## Expected Files
Create:
- `app/packages/layout.tsx`
- `app/packages/page.tsx`
- `src/modules/packages/package.types.ts`
- `src/modules/packages/package.service.ts`
- `src/components/packages/package-status-badge.tsx`
- `src/components/packages/packages-filters.tsx`
- `src/components/packages/packages-table.tsx`

Do not modify:
- Prisma schema
- shadcn/ui components
- unrelated pages/components

## Reference Implementations
Mirror these files exactly (structure, imports, patterns):
- `app/customers/page.tsx` → page structure
- `app/customers/layout.tsx` → layout structure
- `src/modules/customers/customer.service.ts` → service pattern
- `src/components/customers/customers-table.tsx` → table pattern
- `src/components/customers/customer-status-badge.tsx` → badge pattern (`bg-success-soft text-success` / `bg-danger-soft text-danger`)
- `src/components/customers/customers-filters.tsx` → filters pattern

## Done Checks
- Navigating to `/packages` loads the page without errors.
- All 3 seeded packages appear (Basic, Standard, Premium).
- Price displays as `150.000 KD` format.
- Active badge renders green for all 3 (all seeded as `isActive: true`).
- Booking count column renders (0 or actual count from DB).
- Search input and status filter render without errors (no functionality required).
- No TypeScript errors (`npx tsc --noEmit`).
- No console errors.
- `npm run build` passes.
- Update `context/progress-tracker.md`.

## Out of Scope
- Create package form
- Edit / delete package
- Package detail page
- Filtering / search logic
- Authentication / role checks
- API routes
