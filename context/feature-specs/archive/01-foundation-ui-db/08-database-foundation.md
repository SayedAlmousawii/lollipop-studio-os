## Goal
Set up the database foundation for Studio OS using PostgreSQL and Prisma.

This unit should create the base database setup, Prisma client, initial schema structure, and migration workflow so future pages can use real data shapes instead of disconnected mock data.

---

## Rules

- Read `agents.md` first.
- Follow existing architecture and code standards.
- Do not build UI in this unit.
- Do not add real business workflows yet.
- Do not implement auth, permissions, payments, commissions, or reports yet.
- Do not connect existing pages to the database unless explicitly required.
- Keep the schema simple and foundational.
- Use PostgreSQL + Prisma only.

---

## Scope

Set up:

- Prisma
- PostgreSQL connection configuration
- Database client helper
- Initial schema models
- First migration
- Seed file with simple sample data

---

## Initial Models

Create foundational models only:

- User
- Customer
- Child
- Booking
- Package
- Order
- Invoice
- Payment

Keep fields minimal but realistic enough to support upcoming UI pages.

Use enums or constant-safe values for core statuses where appropriate.

---

## Implementation Order

1. Confirm current project database setup.
2. Install/configure Prisma if missing.
3. Configure PostgreSQL environment variables.
4. Create Prisma schema with initial models.
5. Create database client helper.
6. Add seed data.
7. Run Prisma generate and migration.
8. Verify the database can be seeded successfully.
9. Update progress tracker.

---

## Done Checks

- Prisma is configured.
- PostgreSQL connection works.
- Initial migration runs successfully.
- Prisma client generates successfully.
- Seed script runs successfully.
- No TypeScript or lint errors.
- Existing UI pages still load.
- Progress tracker is updated.

---

## Notes

This unit is only the foundation. Future units will connect pages to database-backed services step by step.