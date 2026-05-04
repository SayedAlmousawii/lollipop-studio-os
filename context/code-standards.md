# code-standards.md

# Studio OS – Code Standards

## 1. Development Approach

Studio OS will start as a Next.js full-stack application for speed and simplicity.

However, the code must be written cleanly so the backend can be separated later if needed.

Core rule:

text UI → API/server action → service layer → database 

Do not skip layers.

---

## 2. Technology Standards

| Area | Standard |
|---|---|
| Language | TypeScript |
| Frontend | Next.js + React |
| Styling | Tailwind CSS |
| Database | PostgreSQL |
| ORM | Prisma |
| Validation | Zod |
| API Style | REST-style routes / server actions |
| Status Values | TypeScript enums or constant unions |

---

## 3. Folder Structure

Use feature-based organization.

text src/ ├── app/ ├── components/ ├── modules/ ├── lib/ ├── integrations/ └── types/ 

Each business feature should live in its own module:

text modules/bookings/ ├── booking.service.ts ├── booking.schema.ts ├── booking.types.ts ├── booking.constants.ts └── booking.utils.ts 

---

## 4. Module Pattern

Each module should follow this pattern:

| File | Purpose |
|---|---|
| *.service.ts | Business logic and database operations |
| *.schema.ts | Zod validation schemas |
| *.types.ts | TypeScript types |
| *.constants.ts | Status values, labels, fixed rules |
| *.utils.ts | Small helper functions only |

Example:

text modules/invoices/ ├── invoice.service.ts ├── invoice.schema.ts ├── invoice.types.ts ├── invoice.constants.ts └── invoice.utils.ts 

---

## 5. Naming Conventions

| Item | Convention | Example |
|---|---|---|
| Files | kebab-case | booking-card.tsx |
| Components | PascalCase | BookingCard |
| Functions | camelCase | createBooking() |
| Variables | camelCase | selectedPackage |
| Constants | UPPER_SNAKE_CASE | BASE_DEPOSIT_AMOUNT |
| Database Models | PascalCase | Booking, Invoice |
| Enums / Statuses | UPPER_SNAKE_CASE | WAITING_SELECTION |

---

## 6. TypeScript Rules

- Use TypeScript everywhere.
- Do not use any unless absolutely unavoidable.
- Prefer explicit types for business objects.
- Keep shared types inside the relevant module.
- Do not duplicate types across modules.
- Use Zod schemas for runtime validation.
- Infer types from Zod when useful.

Example:

ts export const createBookingSchema = z.object({   customerId: z.string(),   sessionDate: z.date(),   packageId: z.string(), });  export type CreateBookingInput = z.infer<typeof createBookingSchema>; 

---

## 7. UI Component Rules

- UI components should not contain business logic.
- UI components may handle display, local UI state, and user interaction.
- Financial calculations must not happen inside React components.
- Package upgrade logic must not happen inside React components.
- Commission logic must not happen inside React components.

Bad:

ts const commission = upgradeAmount * 0.1; 

inside a component.

Good:

ts calculatePhotographerCommission(upgradeAmount); 

inside a commission service/helper.

---

## 8. API / Server Action Rules

API routes or server actions should be thin.

They may:
- validate input
- check permissions
- call service functions
- return response

They should not:
- contain complex business logic
- directly calculate invoices
- directly calculate commissions
- directly update multiple unrelated systems without service coordination

---

## 9. Service Layer Rules

Service files own business logic.

Examples:
- creating bookings
- confirming deposits
- upgrading packages
- calculating invoice totals
- assigning editors
- marking production complete
- calculating commissions

Example:

ts await upgradeOrderPackage({   orderId,   newPackageId,   performedByUserId, }); 

The service should handle:
- validation
- database update
- invoice update
- audit log
- commission update if needed

---

## 10. Database Access Rules

- Prisma queries should stay inside service files.
- UI components must never call Prisma directly.
- Shared database client lives in lib/db.
- Do not spread raw database logic across pages/components.
- Use transactions for multi-step financial or workflow updates.

Use transactions for:
- package upgrades
- payments
- commission creation
- voucher usage
- order delivery
- invoice changes

---

## 11. Status Rules

All workflow statuses must be defined as enums or constant unions.

Do not use random strings.

Example:

ts export const BOOKING_STATUS = {   PENDING: "PENDING",   DEPOSIT_PAID: "DEPOSIT_PAID",   CONFIRMED: "CONFIRMED",   CANCELLED: "CANCELLED",   NO_SHOW: "NO_SHOW", } as const; 

Important status groups:

- Booking status
- Payment status
- Order status
- Editing status
- Print status
- Album status
- Pickup status
- Commission status
- Voucher status

---

## 12. Validation Rules

Use Zod for:
- forms
- API inputs
- payment records
- package creation
- add-ons
- upgrades
- commission settings
- voucher creation

Invalid data must be rejected before reaching the database.

---

## 13. Financial Logic Rules

Financial logic must be centralized.

Centralize logic for:
- deposit amount
- base package payment
- upgrade difference
- add-on totals
- package replacement
- commission calculation
- voucher usage
- discounts/overrides

Never duplicate financial formulas in multiple places.

Important rule:

text Package upgrade = final package price - already paid package price 

Not:

text old package + new package 

---

## 14. Package Rules

- Packages are templates.
- Orders store original package and final package.
- Package upgrades replace the final package.
- Add-ons are added on top of the final package.
- Old invoices/orders must not change if a package template is edited later.

This means orders should store snapshots of important package data.

---

## 15. Audit Logging Rules

Create audit logs for sensitive actions:

- payment added/edited/deleted
- package upgraded
- package price overridden
- add-on added/removed
- commission created/edited/paid
- voucher issued/used
- order marked delivered
- manual status override
- refund/complaint/dispute

Each audit log should store:

text userId action entityType entityId oldValue newValue timestamp note 

---

## 16. Permission Rules

Every protected action must check permissions.

Examples:

- Only manager/admin can override prices.
- Only manager/admin can approve commissions.
- Only accountant/manager/admin can edit payments.
- Editors can only update assigned editing jobs.
- Photographers can view assigned sessions but not financial data.
- Receptionists can create bookings but not modify commissions.

Permission checks should live in reusable helpers.

Example:

ts requirePermission(user, "payment:update"); 

---

## 17. Error Handling Rules

- Errors should be clear and user-friendly.
- Do not expose raw database errors to users.
- Log technical errors internally.
- Financial failures must not silently pass.
- Multi-step operations must fail safely.

Example:

If package upgrade succeeds but invoice update fails, the entire operation should roll back.

---

## 18. Styling Rules

- Use Tailwind CSS.
- Avoid inline styles.
- Avoid random hex colors in components.
- Use shared UI components for buttons, inputs, modals, tables, cards, and badges.
- Follow ui-context.md once it is created.
- Keep layouts consistent across dashboard pages.

---

## 19. Form Rules

Forms should:
- use Zod validation
- show clear error messages
- prevent invalid submission
- disable submit while saving
- show success/failure feedback

Important forms:
- create booking
- record payment
- upgrade package
- add add-on
- assign editor
- mark job complete
- issue voucher

---

## 20. Reporting Rules

Reports must be generated from source data, not manually entered totals.

Reports should be based on:
- payments
- invoices
- upgrades
- commissions
- job statuses
- audit logs where needed

Daily/monthly totals must match recorded payments.

---

## 21. Comments and Documentation

Use comments only when logic is not obvious.

Comment:
- financial calculations
- package upgrade rules
- commission logic
- workflow transitions
- permission decisions

Do not comment obvious code.

---

## 22. Testing / Verification Checklist

Before a feature is considered complete:

- TypeScript has no errors
- No console errors
- Forms validate correctly
- Permissions are checked
- Financial calculations are correct
- Audit logs are created for sensitive actions
- Status transitions work correctly
- UI works on desktop and tablet widths
- Existing flows are not broken

---

## 23. AI Coding Agent Rules

When using Codex or another AI coding agent:

- Work on one feature unit at a time.
- Read context files before coding.
- Do not invent new architecture.
- Do not add dependencies unless needed.
- Do not change financial logic without explicit instruction.
- Do not modify unrelated files.
- Update progress tracker after meaningful changes.
- Ask when requirements are missing instead of guessing.

---

## 24. Core Codebase Rule

The codebase must remain easy to separate later.

That means:

text Business logic must live in modules, not UI pages. Database access must live in services, not components. Financial rules must be centralized, not duplicated. Permissions must be enforced before sensitive actions. 

---