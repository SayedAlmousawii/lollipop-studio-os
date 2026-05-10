# Architecture Summary

## 1. Purpose
System structure, module boundaries, storage model, auth/roles, and invariants for Studio OS.

---

## 2. Key Rules / Principles

**Stack:**

| Layer | Technology |
|---|---|
| Frontend | Next.js + React (TypeScript) |
| Styling | Tailwind CSS |
| Database | PostgreSQL via Prisma |
| Auth | Clerk (`@clerk/nextjs`) |
| File Storage | Synology NAS (manual folder link in V1) |
| Payments | Manual recording in V1 |
| Notifications | Manual/template in V1 |

**Layer flow:** `Staff Browser → Next.js Dashboard → API/Services → PostgreSQL → Optional Integrations`

Database is the single source of truth. Google Calendar, WhatsApp, Synology are integrations — not sources of truth.

---

## 3. Required Patterns / Constraints

**Folder structure:**
```text
src/
├── app/              # Pages/routes
├── components/       # ui/, forms/, tables/, calendar/, layout/
├── modules/          # Business logic per domain
│   ├── customers/
│   ├── bookings/
│   ├── packages/
│   ├── orders/
│   ├── invoices/
│   ├── payments/
│   ├── editing/
│   ├── production/
│   ├── commissions/
│   └── reports/
├── lib/              # db/, auth/, permissions/, validators/, utils/
├── integrations/     # google-calendar/, payments/, whatsapp/, synology/
└── types/
```

**Module ownership (what each module owns):**

| Module | Owns | Does NOT Own |
|---|---|---|
| Customers | parent profile, phone, children, session history | invoices, job statuses |
| Bookings | date/time, dept, session type, status, photographer, themes, deposit status | final invoice, package upgrade logic |
| Packages | templates, prices, included items, add-on definitions, upgrade rules | customer-specific orders |
| Orders | original package, final package, selected photos, deliverables, add-ons, order state | — |
| Invoices/Payments | invoice total, deposit, base payment, upgrade payment, add-on payment, method, status | — |
| Editing | assigned editor, edit status, revision loop, approval status | — |
| Production | print job, album design, vendor album, pickup status | — |
| Commissions | upgrade tracking, commission calc, commission status, reports | — |

**Role permissions:**

| Role | Access |
|---|---|
| Admin | Full access to everything |
| Manager | Full view; can edit assignments, overrides, commissions, reports |
| Receptionist | Customers + bookings; cannot do financial overrides or commissions |
| Reservation Employee | Calendar + scheduling; no financial access |
| Photographer | Assigned sessions only; no payments/invoices/commissions |
| Editor | Assigned editing jobs only; no financial data |
| Accountant | Invoices + payments + reports; no editing/production changes |

**Auth rules:**
- Every user must log in
- Every action must check role permissions
- Financial changes must be audit logged
- Commission changes must be audit logged
- Package price overrides must be audit logged

**V1 decisions (do not over-engineer):**
- Payments: manual recording (no gateway)
- Synology: store folder path string in order record
- Calendar: internal system is source of truth
- WhatsApp: manual messages only
- No background jobs required in V1

---

## 4. Core Invariants (never violate)

1. DB is source of truth — not Google Calendar, WhatsApp, or Synology
2. Booking cannot be confirmed until 20 KD deposit is recorded
3. Session cannot move to editing until base package payment is recorded
4. Package upgrade = replace final package (not add a second line)
5. Upgrade charge = final package price − original paid package price
6. Commission created only from package upgrade revenue
7. Every payment, package change, commission change, price override = audit logged
8. Editing / printing / album / pickup are separate sub-statuses (not one flat status)
9. Staff can only update their responsible workflow area (unless manager/admin)
10. Order must not be marked delivered until all required production jobs are complete
11. Manual overrides must store: who changed it, when, and why
12. Package template edits must not retroactively change old invoices/orders

---

## 5. What to Avoid

- Do not place business logic outside `modules/*/`
- Do not query the DB from UI components or pages
- Do not treat external integrations as sources of truth
- Do not skip the service layer in API routes
- Do not add integrations before V1 workflow is stable

---

## 6. When to Read Full Document

Read `architecture-context.md` when:
- Designing a new module or changing folder structure
- Adding a new role or permission rule
- Evaluating a new integration strategy
- Unsure about which module owns a piece of data

---

## Recommended Usage
**Read when working on data structure, module boundaries, roles/permissions, or integration decisions.**
