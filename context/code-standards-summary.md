# Code Standards Summary

## 1. Purpose
Implementation rules for how code must be structured, named, validated, and protected across the codebase.

---

## 2. Key Rules / Principles

**Layer rule (never skip):**
```
UI → API route / server action → service layer → database
```

**Tech standards:**

| Area | Standard |
|---|---|
| Language | TypeScript (no `any`) |
| Frontend | Next.js + React |
| Styling | Tailwind CSS |
| Database | PostgreSQL + Prisma |
| Validation | Zod (all forms, API inputs, financial records) |
| API style | REST routes or server actions (thin — validate, check permissions, call service, return) |
| Statuses | TypeScript enums or `as const` unions — never raw strings |

**Module file pattern** (each domain gets its own folder):
```
modules/bookings/
├── booking.service.ts    # Business logic + DB ops
├── booking.schema.ts     # Zod schemas
├── booking.types.ts      # TypeScript types
├── booking.constants.ts  # Status values, labels, fixed rules
└── booking.utils.ts      # Small helpers only
```

---

## 3. Required Patterns / Constraints

**Naming conventions:**

| Item | Convention | Example |
|---|---|---|
| Files | kebab-case | `booking-card.tsx` |
| Components | PascalCase | `BookingCard` |
| Functions | camelCase | `createBooking()` |
| Variables | camelCase | `selectedPackage` |
| Constants | UPPER_SNAKE_CASE | `BASE_DEPOSIT_AMOUNT` |
| DB Models | PascalCase | `Booking`, `Invoice` |
| Enums/Statuses | UPPER_SNAKE_CASE | `WAITING_SELECTION` |

**Status definition pattern:**
```ts
export const BOOKING_STATUS = {
  PENDING: "PENDING",
  DEPOSIT_PAID: "DEPOSIT_PAID",
  CONFIRMED: "CONFIRMED",
  CANCELLED: "CANCELLED",
  NO_SHOW: "NO_SHOW",
} as const;
```

**Zod + type inference pattern:**
```ts
export const createBookingSchema = z.object({
  customerId: z.string(),
  sessionDate: z.date(),
  packageId: z.string(),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
```

**Permission check pattern:**
```ts
requirePermission(user, "payment:update");
```

**Audit log fields required for sensitive actions:**
```
userId | action | entityType | entityId | oldValue | newValue | timestamp | note
```

**Sensitive actions requiring audit logs:**
- payment added/edited/deleted
- package upgraded
- package price overridden
- add-on added/removed
- commission created/edited/paid
- voucher issued/used
- order marked delivered
- manual status override

**Financial logic rules:**
- All financial logic lives in service files — never in components or API routes
- Upgrade charge formula: `finalPackagePrice − alreadyPaidPackagePrice` (not addition)
- Never duplicate financial formulas across files

**DB access rules:**
- Prisma queries only inside service files
- Shared DB client in `lib/db`
- Use transactions for: package upgrades, payments, commission creation, voucher usage, order delivery, invoice changes

**Form rules:**
- Zod validation on all forms
- Show errors near fields
- Disable submit while saving
- Show success/failure feedback
- Dangerous actions require confirmation

---

## 4. What to Avoid

- No `any` in TypeScript
- No raw strings for statuses — always use defined constants
- No Prisma queries in components, pages, or API handlers
- No business logic in UI components (no financial calculations, no package logic, no commission logic)
- No duplication of financial formulas
- No inline styles; no random hex colors in components
- No multi-step financial operations without transactions
- No silent failures — financial failures must surface

---

## 5. When to Read Full Document

Read `code-standards.md` when:
- Adding a new module and unsure about file structure
- Implementing a new financial calculation
- Designing a new audit log pattern
- Reviewing form or validation requirements in detail

---

## Recommended Usage
**Always read this summary** before starting any implementation unit.
