## Goal
Connect the existing Customers page UI to real database data using Prisma.

## Rules
- Read `AGENTS.md` first.
- Use existing project architecture and code standards.
- Do not modify shadcn/ui generated files.
- Do not redesign the Customers page.
- Do not add create/edit/delete functionality yet.
- Do not add authentication or permissions in this unit.
- Keep this unit read-only.

## Scope
Replace the current mock/static customers data with data fetched from PostgreSQL through Prisma.

## Requirements
- Use the existing Prisma client from `src/lib/db`.
- Fetch customers from the database.
- Include each customer’s children count if available.
- Keep the existing Customers table UI.
- Keep existing filters/search UI as-is unless minor type adjustments are required.
- Make sure the page still uses `AppShell` and `PageContainer`.

## Expected Files
May modify:
- `app/customers/page.tsx`
- `src/components/customers/customers-table.tsx`
- customer-related types if needed

Do not modify:
- Prisma schema unless absolutely required
- shadcn/ui components
- unrelated pages/components

## Done Checks
- Customers page loads real seeded customers from the database.
- No mock customer array remains in the page.
- Existing table still renders correctly.
- No TypeScript errors.
- No console errors.
- `npm run build` passes.
- Update `context/progress-tracker.md`.

## Out of Scope
- Create customer form
- Edit customer
- Delete customer
- Customer detail page
- Authentication/role checks
- API routes