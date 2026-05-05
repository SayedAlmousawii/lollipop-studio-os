# Current Data Model

## Entities

| Entity | Table | Key Fields |
|--------|-------|-----------|
| **User** | `users` | id, name, email, role (enum) |
| **Customer** | `customers` | id, name, phone (unique), status |
| **Child** | `children` | id, name, dateOfBirth, customerId FK |
| **Package** | `packages` | id, name, price, photoCount, isActive |
| **Booking** | `bookings` | id, customerId FK, packageId FK, sessionDate, sessionType, status, depositPaid |
| **Order** | `orders` | id, bookingId FK (unique), customerId FK, originalPackageId FK, finalPackageId FK, selectedPhotoCount, addOns (JSON), status |
| **Invoice** | `invoices` | id, orderId FK, customerId FK, invoiceNumber (seq), totalAmount, paidAmount, remainingAmount, status, isLocked, parentInvoiceId FK (self-ref) |
| **Payment** | `payments` | id, invoiceId FK, amount, method (CASH/KNET/LINK), paymentType (DEPOSIT/BASE/UPGRADE/ADDON/OTHER), paidAt |

### Field detail

**User**
- `role`: ADMIN, MANAGER, RECEPTIONIST, RESERVATION, PHOTOGRAPHER, EDITOR, ACCOUNTANT
- Not linked to any other entity (no assignment to bookings or orders)

**Booking**
- `status`: PENDING → CONFIRMED → COMPLETED | CANCELLED | NO_SHOW
- `sessionType`: NEWBORN, KIDS, FAMILY, MATERNITY, OTHER
- `depositPaid`: boolean — redundant, see Observations

**Order**
- `status`: ACTIVE → WAITING_SELECTION → EDITING → PRODUCTION → READY → DELIVERED | CANCELLED
- `addOns`: JSONB array of `{ name: string, price: number }` objects
- `originalPackageId` / `finalPackageId`: separate FKs to Package — tracks if customer upgraded

**Invoice**
- `status`: DRAFT → ISSUED → PARTIAL → PAID → CLOSED
- `invoiceNumber`: auto-generated via PostgreSQL sequence, format `INV-00001`
- `isLocked`: set to true on close — blocks direct edits and new payments
- `parentInvoiceId`: self-referential FK for adjustment child invoices
- `paidAmount` / `remainingAmount`: denormalized, recalculated on every payment

**Payment**
- Append-only — never modified or deleted after creation
- `paymentType`: DEPOSIT, BASE, UPGRADE, ADDON, OTHER
- `method`: CASH, KNET, LINK

---

## Relationships

```
Customer (1)
 ├── (1:N) Children
 ├── (1:N) Bookings
 │         └── (1:1) Order  ←→  Package (originalPackageId + finalPackageId)
 │                   └── (1:N) Invoices
 │                              ├── (1:N) Payments
 │                              └── (1:N) Adjustments (self-ref via parentInvoiceId)
 └── (denorm FK on Order and Invoice)
```

- `Booking` ↔ `Order` is strict 1:1 (`bookingId` is UNIQUE on orders)
- `customerId` is denormalized onto both Order and Invoice (copied from Booking to avoid join)
- Invoice has a self-referential relationship — adjustment invoices link to a locked parent

---

## Module Ownership

| Module | Entity / Concern | Path |
|--------|-----------------|------|
| `bookings` | Booking, deposit trigger | `src/modules/bookings/` |
| `orders` | Order, production pipeline | `src/modules/orders/` |
| `invoices` | Invoice, adjustment flow | `src/modules/invoices/` |
| `payments` | Payment, revenue calculation | `src/modules/payments/` |
| `customers` | Customer, Child | `src/modules/customers/` |
| `packages` | Package catalog | `src/modules/packages/` |
| `calendar` | Read-only Booking view | `src/modules/calendar/` |
| `dashboard` | Aggregated reads (all entities) | `src/modules/dashboard/` |

---

## Lifecycle Flow

### Order creation
- **Trigger:** Booking transitions to `COMPLETED`
- **Code:** `booking.service.ts` → `updateBookingStatus()` → `createOrderFromBookingWithClient()`
- **Initial state:** `status = ACTIVE`, `selectedPhotoCount = 0`
- `originalPackageId` and `finalPackageId` are both set to `booking.packageId` at creation

### Invoice creation
- Invoice is **not** created when an Order is created — it is created lazily
- **Trigger:** First deposit recorded via `recordBookingDeposit()`
- **Code:** `booking.service.ts` lines 250–314
- Creation sequence:
  1. Create Order if none exists
  2. Create Invoice at `DRAFT`
  3. Immediately transition Invoice → `ISSUED`
  4. Record payment with `paymentType = DEPOSIT`
  5. Call `recalculateInvoiceStatus()` to update `paidAmount` / `remainingAmount`

### Payment linking
- Payment has `invoiceId FK → Invoice`
- Every payment creation triggers `recalculateInvoiceStatus()` in `payment.service.ts`
- Recalculation logic:
  - `paidAmount = 0` → `ISSUED`
  - `0 < paidAmount < totalAmount` → `PARTIAL`
  - `paidAmount >= totalAmount` → `PAID`
- `PAID` does **not** auto-close — `closeInvoice()` must be called manually (sets `isLocked = true`)

### Deposit handling
- A deposit is a regular `Payment` record with `paymentType = DEPOSIT`
- There is no separate deposit invoice — same invoice receives all payment types
- `Booking.depositPaid` boolean exists but the real source of truth is querying for a DEPOSIT payment record on the invoice
- Business rules enforced in code:
  - Cannot confirm booking without a deposit payment
  - Cannot record a second deposit (duplicate blocked)
  - Cannot record payment against a locked invoice
  - UI defaults deposit amount to 20 KD; amount is user-editable

---

## Observations & Inconsistencies

| # | Issue | Impact |
|---|-------|--------|
| 1 | `Booking.depositPaid` boolean is redundant — truth lives in Payment records | Risk of stale value |
| 2 | Order exists before Invoice — window where an Order has no Invoice | Edge case if deposit never recorded |
| 3 | `User` entity has no FK to Booking/Order — no photographer or staff assignment | Unimplemented feature |
| 4 | Updating an Order (package, photos, add-ons) does **not** recalculate Invoice `totalAmount` | Invoice goes stale after order edits |
| 5 | `customerId` denormalized on Order and Invoice — could diverge from source | Data integrity risk |
| 6 | No `isPrimary` or `invoiceType` flag on Invoice — UI infers primary invoice by creation order | Fragile if invoice order changes |
| 7 | `addOns` stored as JSON on Order but not reflected in Invoice `totalAmount` at creation | Add-ons require manual payment entries to be captured |
| 8 | Revenue uses `Payment.paidAt` (cash basis), not invoice totals (accrual basis) | No accrual-basis reporting available |
