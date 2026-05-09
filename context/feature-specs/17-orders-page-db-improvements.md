
## Goal

Improve the Orders page from a simple list into a real workflow page with database-backed data, working filters/search, and navigation to order details.

## Read First

- Read `agents.md`
- Read `context/project-overview.md`
- Read `context/architecture-context.md`
- Read `context/progress-tracker.md`
- Use existing design tokens
- Do not modify generated shadcn/ui components

## Scope

- Orders list page
- Orders service
- Search/filter behavior
- Order detail route
- Basic action placeholders
- Do not build invoice/payment logic here
- Do not create standalone “New Order” page yet

## Order Creation Rule

Orders should be created from bookings, not directly from the Orders page.
Recommended source:
- Booking detail page action: `Create Order`
- Later: automatic order creation when session is marked completed
For now, Orders page should not have a “New Order” primary button unless it links users to bookings.

## Orders List Requirements

Connect `/orders` to real database data.
Show columns:
- Customer
- Booking Date
- Original Package
- Final Package
- Order Status
- Invoice Status
- Total
- Paid
- Remaining
- Created Date
- Actions
Actions:
- View Details
- Edit Order
- Create/View Invoice

## Search + Filters

Make existing fake UI functional.
Support:
- Search by customer name
- Filter by order status
- Filter by invoice status
  
Implementation options:
- For now, client-side filtering is acceptable if the dataset is small
- Better long-term: URL search params + server-side filtering

Recommended V1:
Use URL search params:

/orders?search=sara&orderStatus=EDITING&invoiceStatus=PARTIAL

Order Detail Page

Create:

app/orders/[orderId]/page.tsx

Show sections:

1. Order Summary

* Customer
* Booking date
* Session type
* Original package
* Final package
* Order status
* Created date

2. Financial Summary

* Invoice status
* Total
* Paid
* Remaining

3. Deliverables

* Selected photo count
* Included photo count
* Extra photos
* Albums / prints / add-ons

4. Workflow Status

* Selection status
* Editing status
* Production status
* Delivery status

5. Notes

* Internal order notes

Edit Order Button

Add an edit button, but keep it simple.

For now:

* It can link to /orders/[orderId]/edit
* Or open a placeholder “Edit coming soon” state

Do not build full edit logic yet unless this feature is small enough.

Services

Create/update:

src/modules/orders/order.service.ts
src/modules/orders/order.types.ts

Service functions:

getOrders(filters)
getOrderById(orderId)

The service should map Prisma data into UI-safe display data.

Rules

* Do not put financial calculation logic inside UI components.
* Do not create duplicate invoice logic here.
* Keep package templates separate from final order package.
* Orders must remain linked to bookings.
* Empty states should display cleanly.
* Use existing badge/table/button/card components.

Acceptance Criteria

* /orders uses real database data.
* Search works.
* Order status filter works.
* Invoice status filter works.
* Each order has a View Details action.
* /orders/[orderId] displays real order details.
* Edit action exists as a placeholder or route link.
* No standalone new order flow is created.
* TypeScript passes.
* npm run build passes.
* Update context/progress-tracker.md.

So the clean answer is:

Orders are born from bookings.
Orders are managed from the Orders page.
Invoices are born from orders.
Payments are recorded against invoices.