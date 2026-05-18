# Studio OS — Code Standards

How code is structured, named, validated, and protected. This is a **main doc** (always loaded by default). Older `code-standards-summary.md` content has been merged here; the summary is archived in `context/_archive/summaries/`.

For architecture and read-layer principles, see `context/architecture-context.md`.

---

## 1. Core Layer Rule

```text
UI → server action / page loader → service module → database
```

Never skip a layer. The service module is the only place that touches Prisma.

---

## 2. Tech Standards

| Area | Standard |
|---|---|
| Language | TypeScript (no `any`) |
| Frontend | Next.js (App Router) + React |
| Styling | Tailwind CSS + shadcn/ui + Lucide |
| Database | PostgreSQL + Prisma |
| Validation | Zod (all forms, action inputs, financial records) |
| API style | Server actions or thin route handlers — validate, check permissions, call service, return |
| Statuses | TypeScript enums or `as const` unions; never raw strings |
| Auth | Clerk session + Prisma `User` role |

---

## 3. Module File Pattern

Each domain owns its folder:

```text
modules/bookings/
├── booking.service.ts    # Business logic + DB ops
├── booking.schema.ts     # Zod schemas
├── booking.types.ts      # TypeScript types
├── booking.constants.ts  # Status values, labels, fixed rules
└── booking.utils.ts      # Small helpers only
```

Service files own business logic. They handle validation, DB updates, related-record updates, audit logs, and commission updates as one transactional whole when applicable.

---

## 4. Naming Conventions

| Item | Convention | Example |
|---|---|---|
| Files | kebab-case | `booking-card.tsx` |
| Components | PascalCase | `BookingCard` |
| Functions | camelCase | `createBooking()` |
| Variables | camelCase | `selectedPackage` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_DEPOSIT_AMOUNT` |
| DB models | PascalCase | `Booking`, `Invoice` |
| Enums / statuses | UPPER_SNAKE_CASE | `WAITING_SELECTION` |

---

## 5. Status Definition Pattern

All workflow statuses are constants — never raw strings.

```ts
// BookingStatus — lifecycle revision is current.
// PENDING bookings are calendar holds with no references.
// Deposit recording atomically flips PENDING → CONFIRMED.
// CHECKED_IN replaces the old COMPLETED state.
export const BOOKING_STATUS = {
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  CHECKED_IN: "CHECKED_IN",
  CANCELLED: "CANCELLED",
  NO_SHOW: "NO_SHOW",
} as const;
```

Important status groups: BookingStatus, OrderStatus, PaymentStatus, InvoiceStatus, InvoiceType, PaymentType, EditingStatus, ProductionStatus, AlbumStatus, PickupStatus, CommissionStatus, VoucherStatus.

---

## 6. Zod + Type Inference

```ts
export const createBookingSchema = z.object({
  customerPhone: z.string(),
  sessionDate: z.date(),
  packageId: z.string(),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
```

Zod validates: forms, server-action inputs, payment records, package creation, add-ons, upgrades, commission settings, voucher creation. Invalid data is rejected before reaching the database.

---

## 7. Permission & Audit Patterns

```ts
requirePermission(user, "payment:update");
```

Every protected action checks permission. High-risk server actions pass `actorUserId` into service operations.

**Audit log fields** for sensitive actions:

```text
userId | action | entityType | entityId | oldValue | newValue | timestamp | note
```

**Sensitive actions requiring audit logs** (co-transactional with the action via `recordAuditLog`):
- payment added / edited / deleted
- package upgraded
- package price overridden
- add-on added / removed
- commission created / edited / paid
- voucher issued / used
- order marked delivered
- manual status override
- invoice lock / unlock
- refund / credit-note issuance
- post-lock workspace finalize

---

## 8. Financial Logic Rules

- All financial logic lives in service files. Never in components, pages, or server actions.
- **No duplicated financial formulas.** A formula has exactly one definition.
- Upgrade charge formula: `finalPackagePrice − originalPaidPackagePrice` (subtraction; never addition).
- `PaymentType.BASE` is retired. The remaining-balance payment against the Final Invoice at POS uses `PaymentType.FINAL`.
- Invoice split: `InvoiceType.DEPOSIT` (created at confirmation, immediately PAID + LOCKED) and `InvoiceType.FINAL` (created at POS finalization). Do not use a single evolving invoice for both stages.
- Editing cannot start until the Final Invoice remaining balance is fully paid.
- Multi-step financial operations run inside a transaction; failures roll back the whole operation.

---

## 9. Read-Layer Rules (canonical; tied to architecture standards)

These mirror §6 of `context/architecture-context.md`. They are repeated here because most code review happens against this file.

- **Do not compute business semantics in components or pages.** Money totals, payment status, composition state, allowed actions, blocked reasons — all come from service-layer read models.
- **Do not parse formatted money strings.** Read raw numbers from projector output.
- **New financial / composition / workflow display surfaces require a projector** in the relevant module (`modules/financial-cases/projections/` for FinancialCase-bound displays). Do not re-derive in the page or component.
- **One money formatter** lives at `src/lib/formatting/money.ts`. No surface defines its own.
- **One status-label source per enum** lives in that enum's `*.constants.ts`. No component redefines labels.
- **One canonical read model per business concept**; surface projectors reshape but never recompute.

---

## 10. DB Access Rules

- Prisma queries only inside service files (`src/modules/**/*.service.ts`).
- Shared DB client lives in `src/lib/db`.
- **Do not import `@/lib/db` from `app/**` or `src/components/**`.** Allowed only in `src/modules/**`, `src/lib/**`, `tests/**`, `scripts/**`.
- Use transactions for: package upgrades, payments, commission creation, voucher usage, order delivery, invoice changes, post-lock workspace finalize.

---

## 11. UI Component Rules

- UI components handle display, local UI state, and user interaction.
- No financial calculations, no package logic, no commission logic, no composition derivation inside components.
- No inline styles; no random hex colors. Use design tokens (see `context/ui-context.md`).
- Use shared UI components (Button, Input, Select, Card, Table, Badge, Tabs, Dialog, Toast, Status Timeline). Do not create one-off variants.

---

## 12. API / Server Action Rules

Server actions and route handlers are thin:
- validate input (Zod)
- check permissions
- call a service function
- return response

They never contain complex business logic, financial calculations, commission math, or cross-system updates outside service coordination.

---

## 13. Form Rules

- Zod validation on all forms.
- Errors shown near fields.
- Submit disabled while saving.
- Success / failure feedback shown.
- Dangerous actions require confirmation.

Important forms: create booking, record payment, upgrade package, add add-on, assign editor, mark job complete, issue voucher, finalize workspace.

---

## 14. Error Handling Rules

- Errors must be clear and user-friendly.
- Do not expose raw database errors to users.
- Log technical errors internally.
- Financial failures must surface — never silently swallow.
- Multi-step operations fail safely (transactions; full rollback on error).

---

## 15. Comments and Documentation

Comment only when the *why* is non-obvious — financial calculations, package upgrade rules, commission logic, workflow transitions, permission decisions. Do not comment obvious code.

---

## 16. Verification Before Completion

Before marking a unit complete:
- TypeScript has no errors
- No console errors
- Forms validate correctly
- Permissions enforced
- Financial calculations verified
- Audit logs created for sensitive actions
- Status transitions work
- UI renders correctly on desktop and tablet widths
- No unrelated features broken
- `npm run build` passes
- `npm run lint` passes

---

## 17. What to Avoid

- No `any` in TypeScript.
- No raw strings for statuses.
- No Prisma queries in components, pages, server actions, or any file under `app/**` or `src/components/**`.
- No business logic in UI components.
- No duplicated financial formulas.
- No formatted-money parsing in UI.
- No inline styles; no random hex colors.
- No multi-step financial operations without transactions.
- No silent failures — financial failures must surface.

---

## 18. Related Docs

- `context/architecture-context.md` — module ownership, invariants, canonical read layer.
- `context/ai-workflow-rules.md` — how the agent behaves (scoping, splitting, completion).
- `context/ui-context.md` — visual tokens, component variants, page patterns.
- `context/target-data-model.md` — Prisma schema for the canonical data model.
