## Goal

Build the Orders page — a read-only list view showing all orders with their invoice summary and last payment method. Mock data only; no database connection in this feature.

⸻

## Rules

- Read `AGENTS.md` and `context/code-standards-summary.md` before writing any code.
- Mirror the Packages page pattern (`context/feature-specs/13-packages-page.md`) exactly.
- Do **not** modify any shadcn/ui component files under `src/components/ui/`.
- Do **not** touch Prisma schema, seed, or any existing service files.
- UI only — all data comes from a mock array in `app/orders/page.tsx`.
- `npm run build` must pass with zero TypeScript errors before marking done.

⸻

## Context

The database already has `Order`, `Invoice`, and `Payment` models (see `prisma/schema.prisma`). This feature builds the page shell so the team can review the layout before Feature 15 wires it to the database.

Existing badge and table patterns to follow:
- Badge pattern → `src/components/bookings/payment-status-badge.tsx`
- Table pattern → `src/components/packages/packages-table.tsx`
- Filters pattern → `src/components/packages/packages-filters.tsx`
- Types module pattern → `src/modules/packages/package.types.ts`
- Layout / page pattern → `app/packages/layout.tsx` + `app/packages/page.tsx`

⸻

## Scope

### Order UI Type

File: `src/modules/orders/order.types.ts`

```ts
export type OrderStatus =
  | "Active"
  | "Awaiting Selection"
  | "Editing"
  | "In Production"
  | "Ready"
  | "Delivered"
  | "Cancelled";

export type InvoiceStatus = "Unpaid" | "Partial" | "Paid" | "Refunded";

export interface Order {
  id: string;
  customerName: string;
  packageName: string;       // finalPackage.name ?? originalPackage.name ?? "—"
  orderStatus: OrderStatus;
  invoiceTotal: string;      // e.g. "150.000 KD"
  paidAmount: string;        // e.g. "75.000 KD"
  remainingAmount: string;   // invoiceTotal − paidAmount, e.g. "75.000 KD"
  invoiceStatus: InvoiceStatus;
  paymentMethod: string;     // "Cash" | "KNET" | "Link" | "—"
  createdAt: string;         // formatted date string, e.g. "15 Jan 2026"
}
```

⸻

### DB → UI Enum Mapping

**OrderStatus** (DB `OrderStatus` enum → UI string):

| DB value           | UI label            |
|--------------------|---------------------|
| ACTIVE             | "Active"            |
| WAITING_SELECTION  | "Awaiting Selection"|
| EDITING            | "Editing"           |
| PRODUCTION         | "In Production"     |
| READY              | "Ready"             |
| DELIVERED          | "Delivered"         |
| CANCELLED          | "Cancelled"         |

**InvoiceStatus** (DB `InvoiceStatus` enum → UI string):

| DB value  | UI label   |
|-----------|------------|
| UNPAID    | "Unpaid"   |
| PARTIAL   | "Partial"  |
| PAID      | "Paid"     |
| REFUNDED  | "Refunded" |

⸻

### Components

#### `src/components/orders/order-status-badge.tsx`

Pill badge. Color mapping:

| Status              | Classes                              |
|---------------------|--------------------------------------|
| Active              | `bg-info-soft text-info`             |
| Awaiting Selection  | `bg-warning-soft text-warning`       |
| Editing             | `bg-warning-soft text-warning`       |
| In Production       | `bg-info-soft text-info`             |
| Ready               | `bg-success-soft text-success`       |
| Delivered           | `bg-success-soft text-success`       |
| Cancelled           | `bg-danger-soft text-danger`         |

Mirror the exact span + Record structure from `payment-status-badge.tsx`.

#### `src/components/orders/invoice-status-badge.tsx`

Pill badge. Color mapping mirrors `payment-status-badge.tsx` exactly (same four values, same colors):

| Status   | Classes                          |
|----------|----------------------------------|
| Unpaid   | `bg-danger-soft text-danger`     |
| Partial  | `bg-warning-soft text-warning`   |
| Paid     | `bg-success-soft text-success`   |
| Refunded | `bg-info-soft text-info`         |

#### `src/components/orders/orders-filters.tsx`

Client component (`"use client"`). Three controls in a flex row:

1. **Search** — text input, placeholder `"Search by customer or package…"`, Search icon (lucide).
2. **Order Status** — `<Select>` with options: All Statuses, Active, Awaiting Selection, Editing, In Production, Ready, Delivered, Cancelled.
3. **Invoice Status** — `<Select>` with options: All Statuses, Unpaid, Partial, Paid, Refunded.

All three are non-functional placeholders (no state wired up). Mirror `packages-filters.tsx`.

#### `src/components/orders/orders-table.tsx`

Accepts `orders: Order[]` prop. Columns:

| # | Header         | Data field / notes                          |
|---|----------------|---------------------------------------------|
| 1 | Customer       | `customerName` — `font-medium text-text-primary` |
| 2 | Package        | `packageName` — `text-text-secondary`       |
| 3 | Order Status   | `<OrderStatusBadge status={orderStatus} />` |
| 4 | Total          | `invoiceTotal` — `text-text-primary`        |
| 5 | Paid           | `paidAmount` — `text-success`               |
| 6 | Remaining      | `remainingAmount` — `text-danger` when > "0.000 KD", else `text-text-secondary` |
| 7 | Invoice Status | `<InvoiceStatusBadge status={invoiceStatus} />` |
| 8 | Method         | `paymentMethod` — `text-text-secondary`     |
| 9 | Created        | `createdAt` — `text-text-secondary`         |
| 10| Actions        | `DropdownMenu` with View + Edit items (non-functional) |

Mirror `packages-table.tsx` for hover state, row structure, and actions column.

⸻

### Route Files

#### `app/orders/layout.tsx`

```tsx
import AppShell from "@/components/layout/app-shell";

export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  return <AppShell pageTitle="Orders">{children}</AppShell>;
}
```

#### `app/orders/page.tsx`

Async server component. Contains a `MOCK_ORDERS: Order[]` array with **6 rows** covering a variety of statuses. Renders:

1. Page header — `<h1>` "Orders" + subtitle "Manage orders, invoices, and payment records."
2. `<OrdersFilters />`
3. `<OrdersTable orders={MOCK_ORDERS} />`

Mock data must cover at least: one of each `InvoiceStatus` value, and at least three distinct `OrderStatus` values.

⸻

## Expected Files

```text
src/modules/orders/order.types.ts
src/components/orders/order-status-badge.tsx
src/components/orders/invoice-status-badge.tsx
src/components/orders/orders-filters.tsx
src/components/orders/orders-table.tsx
app/orders/layout.tsx
app/orders/page.tsx
```

⸻

## Reference Implementations

| What to build          | Mirror from                                              |
|------------------------|----------------------------------------------------------|
| Types module           | `src/modules/packages/package.types.ts`                  |
| Order status badge     | `src/components/bookings/booking-status-badge.tsx`       |
| Invoice status badge   | `src/components/bookings/payment-status-badge.tsx`       |
| Filters component      | `src/components/packages/packages-filters.tsx`           |
| Table component        | `src/components/packages/packages-table.tsx`             |
| Layout + page          | `app/packages/layout.tsx` + `app/packages/page.tsx`      |

⸻

## Sidebar Link

The sidebar (`src/components/layout/sidebar.tsx`) must include an **Orders** link pointing to `/orders`. Add it under the same nav group as Bookings and Customers. Use the `ReceiptText` icon from `lucide-react`.

⸻

## Done Checks

- [ ] `/orders` route renders without errors in dev server
- [ ] All 6 mock rows visible in the table
- [ ] `OrderStatusBadge` shows correct color for each of the 7 statuses
- [ ] `InvoiceStatusBadge` shows correct color for all 4 statuses
- [ ] Remaining amount column shows red when balance > 0, muted when 0
- [ ] Orders sidebar link is active when on `/orders`
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` passes
- [ ] Update `context/progress-tracker.md`.

⸻

## Out of Scope

- Database connection (Feature 15)
- Functional filter/search state
- Order detail / drawer / modal
- Payment history panel
- Create / edit / delete order actions
- Pagination
