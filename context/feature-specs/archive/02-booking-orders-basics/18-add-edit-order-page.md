

##Goal

Build the Edit Order page that allows staff to modify an existing order’s:

* package (upgrade)
* selected photo count
* add-ons
* notes

while respecting the system’s state-driven workflow and financial integrity.

This page is critical because orders evolve after the session based on customer selections and upgrades  ￼.

⸻

## Read First

* `agents.md`
* `progress-tracker.md`￼

⸻

## Rules

* Do NOT modify shadcn/ui components
* Use existing design tokens
* Use server actions + service layer (no direct DB in UI)
* Follow module boundaries:
    * Orders module owns order data
    * Invoice module owns financial totals
* Do NOT directly edit invoices from this page
* All changes must be traceable (future audit)

⸻

## Scope

## ✅ In Scope

* Edit order UI
* Update order data in DB
* Package upgrade logic (UI + service)
* Selected photos input
* Add-ons (basic structure)
* Notes editing

## ❌ Out of Scope

* Invoice recalculation logic (handled separately)
* Payment handling
* Commission calculation
* Editing/production statuses

⸻

## 🧩 Data Model Context

From architecture:

Orders own:

* originalPackage
* finalPackage
* selectedPhotos
* addOns
* deliverables
* orderStatus  ￼

⸻

## 🖥️ Page Route

/orders/[orderId]/edit

Already exists as placeholder → now implement fully.

⸻

## 🧾 Page Layout

Header

* Title: Edit Order
* Subtitle: customer name + package
* Back button → Order Details
* Save button (primary)

⸻

Section 1: Order Summary (Read-only)

Display:

* Customer name
* Booking date
* Original package
* Current final package
* Order status

⸻

Section 2: Package Adjustment

Fields:

* Package selector (dropdown)
* Show:
    * original package price
    * selected package price

UI behavior:

* If changed → mark as Upgrade
* Show difference (read-only label)

⸻

Section 3: Photo Selection

Fields:

* Selected photos count (number input)

Display:

* Included photos (from package)
* Extra photos (calculated UI only)

⸻

Section 4: Add-ons

Basic V1:

* Add-on list (manual inputs)
    * name
    * price

Buttons:

* Add item
* Remove item

⸻

Section 5: Notes

* Textarea for internal notes

⸻

## 🔄 Behavior Rules

1. Package Upgrade

* If package changes:
    * update finalPackageId
    * DO NOT modify original package

System invariant:

“Package upgrade must replace final package, not add a second package”  ￼

⸻

2. Financial Separation

* This page:
    * DOES NOT update invoice totals
* Instead:
    * triggers future recalculation (separate feature)

⸻

3. Status Safety

* Editing allowed only if:
    * order not DELIVERED

⸻

4. Validation

* selectedPhotos ≥ 0
* package must exist
* add-ons price ≥ 0

⸻

## 🧠 Service Layer

File

src/modules/orders/order.service.ts

New Function

updateOrder(orderId: string, input: UpdateOrderInput)

⸻

Input Type

type UpdateOrderInput = {
  finalPackageId: string
  selectedPhotos: number
  addOns: {
    name: string
    price: number
  }[]
  notes?: string
}

⸻

Responsibilities

* Validate input
* Update order fields
* Replace add-ons (simple V1 approach)
* Return updated order

⸻

## 🧪 Server Action

File

app/orders/[orderId]/edit/actions.ts

Action

updateOrderAction

Responsibilities:

* Parse form data
* Validate with Zod
* Call service
* Redirect → /orders/[orderId]

⸻

## 🧩 UI Component

File

src/components/orders/edit-order-form.tsx

Requirements

* Client component
* Uses:
    * useActionState
    * useFormStatus
* Handles:
    * field state
    * loading state
    * error display

⸻

## 📄 Page Implementation

File

app/orders/[orderId]/edit/page.tsx

Behavior

* Fetch:
    * order details
    * packages list
* Render:
    * header
    * form component

⸻

## 🎨 UI Notes

* Use cards for sections
* Maintain spacing consistency
* Reuse:
    * inputs
    * select
    * textarea
* Highlight upgrades visually (accent color)

⸻

## 🧪 Edge Cases

* No packages available → disable save
* Order not found → 404
* Large photo count → allowed (validated later in pricing)

⸻

## ✅ Definition of Done

* Edit page fully functional
* Order updates persist in DB
* No TypeScript errors
* Build passes
* UI consistent with design system
* No invoice logic leakage into orders
* update `progress-tracker.md`
