# Studio OS — Architecture

Canonical architecture, module ownership, invariants, and the read-layer standards every feature must follow.

This is a **main doc** (always loaded by default). Older `architecture-summary.md` content has been merged here; the summary is archived in `context/_archive/summaries/`.

---

## 1. Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router) + React (TypeScript) |
| Styling | Tailwind CSS + shadcn/ui + Lucide icons |
| Backend | Next.js server actions + service modules (no separate API service in V1) |
| Database | PostgreSQL via Prisma |
| Auth | Clerk (`@clerk/nextjs`) — session/identity. Prisma `User` is the source of truth for role and internal identity. |
| File Storage | Synology NAS (manual folder link in V1) |
| Payments | Manual recording in V1 |
| Notifications | Manual / template in V1 |

Layer flow:
```text
Staff Browser → Next.js (page / server action) → service module → PostgreSQL
```

The database is the single source of truth. Google Calendar, WhatsApp, Synology are integrations — never sources of truth.

---

## 2. Folder Structure (actual, current)

```text
src/
├── app/                    # Pages, layouts, server actions (no DB imports here)
├── components/             # UI; never imports the DB
│   ├── financial/          # Shared read-only financial UI (payment summary, total source, linked documents, line items)
│   ├── orders/             # POS, sidebars, composition cards
│   ├── session-configurations/
│   └── ...
├── modules/                # Business logic; the only place DB is touched
│   ├── audit/                  # AuditLog writes
│   ├── bookings/
│   ├── calendar/
│   ├── commissions/
│   ├── composition-view/       # Shared composition normalizer
│   ├── customers/
│   ├── dashboard/
│   ├── departments/
│   ├── development/            # Dev-only resets and utilities
│   ├── financial/              # Cross-entity financial rules (classifier, invariants, reconciliation)
│   ├── financial-cases/        # FinancialCaseSummary canonical read model + surface projectors (see §7)
│   ├── identifiers/            # BK / JOB / INV reference generation
│   ├── invoices/
│   ├── jobs/
│   ├── order-commits/          # OrderCommit snapshots, drafts, staging reducers, preview, commit execution
│   ├── orders/
│   ├── packages/
│   ├── payments/
│   ├── pricing/
│   ├── products/
│   ├── refunds/
│   ├── session-configurations/
│   └── session-types/
├── lib/
│   ├── auth/
│   ├── db/                 # Prisma client — importable only from modules/, lib/, tests/, scripts/
│   ├── formatting/         # Shared formatters (money, dates) — single source per format
│   ├── invoices/
│   ├── permissions/
│   ├── retry.ts
│   └── utils.ts
└── types/
```

---

## 3. Module Ownership

| Module | Owns | Does NOT own |
|---|---|---|
| Customers | parent profile, phone, children, session history | invoices, job statuses |
| Bookings | date/time, dept, session type, status, photographer, themes; atomic confirmation that generates BK reference + FinancialCase + locked Deposit Invoice | final invoice, package upgrade |
| Packages | templates, prices, included items, add-on definitions, upgrade rules | per-customer orders |
| SessionTypes | admin-managed taxonomy, frozen code, calendar label/color, archive state, default PackageFamily + zero-priced extra-photo pricing rows on create | department CRUD, package pricing |
| Pricing | active session-type extra-photo unit prices, transactional paired DIGITAL/PRINT updates | invoice snapshotting, package pricing, price history |
| Orders | original package, final package, selected photos, deliverables, add-ons, order state, price snapshots, POS workspace | financial truth (delegated to FinancialCase) |
| FinancialCase | financial grouping hub — owns all Invoices and Payments for a workflow thread; bridges Booking → Job | operational workflow state |
| FinancialCases (read layer) | `FinancialCaseSummary` canonical read model + surface projectors (header, financials tab, sales sidebar, payment dialog, orders table, booking page, invoice list) | mutations of any kind |
| OrderCommits | `OrderCommit` committed snapshots, `OrderCommitDraft` pending staging, snapshot reducers, preview/diff engine, commit execution, `commitOrderChanges` financial emission | financial truth (delegated to FinancialCase) |
| Invoices / Payments | invoice total, deposit invoice, final invoice, adjustment/credit-note/refund invoices, allocation, status; locked-invoice contract | display projections (delegated to FinancialCases read layer) |
| Session Configurations | per-session-type operational/financial modifiers, snapshot selection writes, pricing, post-lock routing | order composition |
| Composition View | shared composition normalizer (`buildCompositionView`) and presentational card for locked/composition displays | derivation of effective composition (delegated to Orders) |
| Identifiers | BK / JOB / INV sequences, self-healing on drift | business workflow |
| Editing / Production / Delivery | workflow states, transition rules, assignment, completion | financial state |
| Commissions | upgrade tracking, photographer commission calc, status | invoice writes |
| Refunds | REFUND invoice + outbound payment, source-payment traceability, cap enforcement | invoice line composition |
| Audit | append-only AuditLog records co-transactional with actions | anything else |
| Dashboard / Reports | read-only derivations for KPIs | mutations |

---

## 4. Role Permissions

| Role | Access |
|---|---|
| Admin | Full access |
| Manager | Full view; can edit assignments, overrides, commissions, reports |
| Receptionist | Customers + bookings; no financial overrides or commissions |
| Reservation Employee | Calendar + scheduling; no financial access |
| Photographer | Assigned sessions only; no payments/invoices/commissions |
| Editor | Assigned editing jobs only; no financial data |
| Accountant | Invoices + payments + reports; no editing/production changes |

Auth rules:
- Every user must log in (Clerk session).
- Every action must check role permissions via `requirePermission` / `assertActorPermission`.
- Financial, commission, and package-price-override changes must be audit-logged (AuditLog rows co-transactional with the action).
- High-risk server actions pass `actorUserId` to service operations for attribution.

---

## 5. V1 Integration Stance

- Payments: manual recording (no gateway).
- Synology: store folder path string on the order; manual linking.
- Calendar: internal system is the source of truth; no Google Calendar sync in V1.
- WhatsApp: manual messages only.
- No background jobs required in V1 (nightly reconciliation runs via scheduled workflow only).

Add integrations after V1 workflow is stable; never as sources of truth.

---

## 6. Canonical Architecture Standards (permanent rules)

These are standing engineering law. Every spec and every PR must satisfy them. They are not phase rules and do not expire.

### 6.1 Write/Read Separation

- **Canonical write services own all mutations.** Every database mutation goes through a `modules/<domain>/<domain>.service.ts` function. UI, pages, server actions, and API routes never mutate the DB directly.
- **Canonical read models own all display truth.** Business semantics — totals, payment status, composition, available actions, blocked reasons, formatted money — are produced by service-layer read models, never by pages or components.
- **No mixed roles.** A function either mutates or it derives display. A function that mutates does not return display strings; a function that derives display does not write.

### 6.2 One Truth, Many Projections

- **One canonical read model per business concept**, exposing raw structured fields (numbers, enums, references). FinancialCaseSummary is the financial example; OrderCompositionViewModel will be the composition example.
- **Surface-specific projector functions** consume the canonical model and produce typed DTOs shaped for one surface (header chip, table row, sidebar, dialog, page section).
- Projectors **may** reshape, filter, group, and re-label. Projectors **may not** recompute business semantics independently.
- A new financial/composition/workflow surface = new projector, never a new derivation.

### 6.3 Dumb UI

- UI components and pages render. They do not compute money, derive status, decide allowed actions, or assemble totals from partial rows.
- No formatted-string parsing in UI. Read raw numbers/enums from projector output.
- No business strings hardcoded in UI when a policy or projector can supply them (blocked reasons, action labels, badge copy).

### 6.4 Service-Only DB Access

- `@/lib/db` (the Prisma client) is imported **only** from `src/modules/**`, `src/lib/**`, `tests/**`, and `scripts/**`.
- `app/**` and `src/components/**` never import the DB client. Server actions call service functions; pages call service loaders.

### 6.5 Centralized Policies

- Edit-mode rules (draft / locked / adjustment) live in one policy module. Every UI consumer reads from it. Service-layer write guards remain authoritative; the policy reads the same predicates the guards use.
- Workflow availability rules (booking / editing / production / delivery) live in per-area policy builders. UI never hardcodes action lists.

### 6.6 Centralized Formatting

- One money formatter at `src/lib/formatting/money.ts`. No surface defines its own.
- One status-label source per status enum (the enum's `*.constants.ts` file). No component redefines labels.

### 6.7 Module-Scope Discipline

- New financial concepts bound to a FinancialCase live in `modules/financial-cases/`.
- Cross-entity financial rules (classifier, invariants, reconciliation) live in `modules/financial/`.
- Operational composition lives in `modules/orders/composition/`.
- Each module owns its DB writes, its policies, its read models, and its projectors.

---

## 7. Canonical Read Layer

The read layer translates database state into display truth. It is built on the standards above.

### 7.1 FinancialCaseSummary (canonical financial read model — live)

`modules/financial-cases/` exists and is the live canonical financial read layer.

- One service in `modules/financial-cases/` exposes `getFinancialCaseSummary({ financialCaseId | orderId | bookingId })`.
- The summary contains: invoice total, effective paid, deposit applied, remaining, overpaid / refund capacity, linked documents (DEP / FINAL / ADJ / CN / REFUND), status classification.
- The summary handles boundary states explicitly, including the booking-stage state (confirmed booking, no Job yet, no Final Invoice yet) — it returns booking-stage fields (`depositPaid`, `awaitingFinalInvoiceAfterCheckIn`, `finalInvoicePending`) instead of synthesizing a final-invoice state.

### 7.2 Surface Projectors

Each UI surface consumes its own projector in `modules/financial-cases/projections/`:

| Projector | Used by |
|---|---|
| `toOrderHeaderFinancial` | Order detail header cards |
| `toFinancialTabBlock` | Order detail Financials tab |
| `toSalesSidebarDraft` / `toSalesSidebarLocked` | Sales view sidebars |
| `toPaymentDialogContext` | Payment / refund dialogs |
| `toOrdersTableRow` | Orders list table |
| `toBookingPageFinancial` | Booking detail page |
| `toInvoiceListRow` | Invoice list table |

A new financial surface = add a new projector. Do not recompute from raw invoice/payment rows.

### 7.3 Live Read Models (same pattern)

- **OrderCompositionViewModel** in `modules/orders/composition/` — packages, item upgrades, add-ons, extra photos, session configurations, deliverables, totals; base / effective projections. Live.
- **OrderEditModePolicy** in `modules/orders/policies/` — draft, locked, and blocked-message edit affordances across POS and configure-session surfaces; Adjustment Workspace affordances retired. Live.
- **Workflow policy builders** per area (booking / editing / production / delivery) — available actions, blockers, labels, manager-override requirements. Live.
- **SalesPageView** in `modules/order-commits/projections/` — unified Sales surface view-model composing `Order*` composition, `OrderCommitDraft`, `OrderCommitPreview`, and `FinancialCaseSummary`. Live.

---

## 8. Core Invariants (never violate)

1. The database is the source of truth — not Google Calendar, WhatsApp, or Synology.
2. Pending bookings consume no references (no BK, no JOB, no invoice numbers). They are calendar holds only and are hard-deleted on cancellation.
3. Booking confirmation is atomic: deposit recording generates the BK reference, creates the FinancialCase, and issues a locked closed Deposit Invoice (default 20 KD, minimum 20 KD, immutable thereafter) in one transaction.
4. Booking check-in is atomic and payment-free: generates the JOB reference, creates the canonical Job, stamps `FinancialCase.jobId`, and creates the initial `WAITING_SELECTION` Order.
5. A session cannot move to editing until the Final Invoice remaining balance is fully paid (`PaymentType.FINAL`). `PaymentType.BASE` is retired.
6. Package upgrade = replace the final package (not a second line). Upgrade charge = `finalPackagePrice − originalPaidPackagePrice`.
7. Commission is created only from package upgrade revenue.
8. Every payment, package change, commission change, and price override is audit-logged co-transactionally via `AuditLog`.
9. Editing / printing / album / pickup are separate sub-statuses, not one flat status.
10. Staff can only update their responsible workflow area (unless manager / admin).
11. An order is not marked delivered until all required production jobs are complete.
12. Manual overrides must store who, when, and why.
13. Package template edits never retroactively change old invoices or orders.
14. All order edits (locked and unlocked) flow through `OrderCommitDraft` staging → `OrderCommitPreview` → `commitOrderChanges`. `commitOrderChanges` is the sole production financial-emission path; financial emission mode is determined by the FINAL invoice's lock state: no FINAL → CREATE_BASE; unlocked FINAL → REBUILD_UNLOCKED (rebuild in place, no ADJ/CREDIT); locked FINAL → EMIT_ADJUSTMENT (ADJ / CREDIT_NOTE / refund-needed). Session-configuration, add-on, package-item-upgrade, package, and photo staging all route through `stageOrderCommitDraftChange` reducers. Reduction approval is solely the OrderCommit Review & Commit dialog path.
15. `commitOrderChanges` materializes approved pending snapshot state into `Order*` rows, emits financial documents, creates an `OrderCommit` record, links emitted invoices via `OrderCommitDocument`, writes audit/activity logs, and deletes the draft — all in a single serializable transaction.
16. `OrderCommitPreview` is the service-layer source for all commit-consequence display: commit kind, net delta, approval requirements, document plan, payment impact, refund impact. UI surfaces read from `OrderCommitPreview`; they do not recompute any of these fields.
17. `SalesPageView` is the display-only read model for the unified Sales page. It composes `Order*` composition, optional `OrderCommitDraft.pendingSnapshotJson`, optional `OrderCommitPreview`, and `FinancialCaseSummary` without DB writes or business recomputation.
18. Adjustment invoices are financial documents only. Post-lock operational state is materialized into `OrderPackage`, `OrderAddOn`, `OrderPackageItemUpgrade`, and session-configuration selection rows during `commitOrderChanges`; locked composition projections read those `Order*` rows, not finalized adjustment invoice line items.
19. Locked invoices remain content-immutable, but unpaid locked invoices can accept append-only payments and refresh payment-derived fields. A DB trigger blocks frozen-field mutation of locked invoices; every service lock path writes an `InvoiceLockSnapshot`.
20. Payment settlement acquires an invoice row lock before balance reads; fully paid FINAL invoices auto-close to `CLOSED + isLocked=true` inside the settlement transaction.
21. PaymentAllocation totals cannot exceed the invoice's `totalAmount` (DB trigger); ADJUSTMENT invoices cannot parent another ADJUSTMENT (DB trigger).

---

## 9. What to Avoid

- Do not place business logic outside `modules/*/`.
- Do not query the DB from UI components or pages, or from `app/**` server actions/loaders.
- Do not parse formatted money strings in components.
- Do not compute money, status, or composition in components or pages.
- Do not treat external integrations as sources of truth.
- Do not add integrations before V1 workflow is stable.
- Do not introduce alternative libraries for validation, DB, styling, or auth (stay on Zod, Prisma, Tailwind, Clerk).
- Do not modify `prisma/schema.prisma`, financial / commission core logic, or auth configuration without explicit instruction.

---

## 10. Related Docs

- `context/code-standards.md` — code shape, naming, validation, audit fields, read-layer rules.
- `context/ai-workflow-rules.md` — agent behavior, scoping, completion gates.
- `context/target-data-model.md` — Prisma schema reference for the canonical data model.
- `context/reviews/unified-order-commit-live-pos-roadmap.md` — OrderCommit / unified Sales / AW retirement roadmap (Phases 1–7); active reference for post-lock edit architecture.
- `context/ui-context.md` — visual tokens, component rules, page patterns.
