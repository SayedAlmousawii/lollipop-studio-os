## Goal

Build a dedicated Commercial Workspace (POS) page for each order. This is the primary surface where staff construct the commercial agreement with the customer: composing deliverables, selecting upgrades, adding standalone items, and reviewing financial totals before collecting payment. It is a first-class destination reachable from multiple entry points, not a tab embedded inside the order detail page.

---

## Dependency

**Feature 56 (56a, 56b, 56c) must be complete before 57b begins.** The composition area requires `PackageItem` structured deliverables, `Product` catalog, and `bundleAdjustment` from Feature 56. Route and layout (57a) can be scaffolded independently.

---

## Read First

- `context/feature-specs/56-packages-management-and-schema.md` — package/product/line-item architecture
- `context/reviews/POS-review.md` — full UX direction, layout sections, philosophy
- `context/reviews/owner-feedback-review-doc.md` — Problems 3, 4, 5 (pricing, POS, payment timing)
- `prisma/schema.prisma` — `Order`, `Package`, `PackageItem`, `Invoice`, `OrderAddOn`, `Product`
- `src/modules/orders/order.service.ts` — existing order data fetch patterns
- `src/modules/orders/order.types.ts` — existing type shapes
- `app/orders/[orderId]/page.tsx` — existing order detail layout to understand what to NOT inherit
- `context/architecture-summary.md` — invariants 4 and 5

---

## Rules

- The POS is a read/write commercial surface. All writes go through the service layer — no direct DB access from the page or components.
- Financial fields are never computed in UI components. Totals, adjustments, and balances are computed in the service layer.
- The POS must respect `invoice.isLocked`. When the invoice is locked, composition changes require an adjustment flow (scoped to a future spec). Surface the locked state clearly — do not silently block actions.
- Package template records must never be mutated. All modifications apply to the order composition only.
- Role guard: only roles with `ORDER_FINANCIAL_WRITE` (or equivalent) can make commercial changes. Read-only view is allowed for roles with order read access.
- Zod-validate all inputs at the server action boundary before calling services.

---

## Route and Navigation

**Route:** `/orders/[orderId]/sales`

**Entry points (all link directly to this route):**

| Entry Point | Location |
|---|---|
| "Open Sales View" button | Order detail page header / overview tab |
| "Sales" action | Orders list row action menu |
| Order card link | Dashboard phone search results (Feature 57e) |
| Direct URL / bookmark | Any browser |

The POS does not require navigating through the order detail page. It is independently accessible by URL.

**Back navigation:** "← Back to Order" link in the POS header returns to `/orders/[orderId]`.

---

## Layout

The POS has its **own layout** (`app/orders/[orderId]/sales/layout.tsx`) that overrides the parent order detail tab layout. It does not inherit the tab bar or the order detail shell.

**Layout structure:**

```
┌─────────────────────────────────────────────────────────┐
│  POS Header: job number · customer · session date · back │
├──────────────────────────────────┬──────────────────────┤
│                                  │                      │
│   Left / Main Area               │  Financial Sidebar   │
│   (composition + actions)        │  (summary + status)  │
│                                  │                      │
└──────────────────────────────────┴──────────────────────┘
```

Main area: scrollable, takes ~65% width.  
Financial sidebar: sticky, ~35% width, accounting-focused tone.

On narrow viewports the sidebar stacks below the main area.

---

## Data Layer

**New service function: `getPOSWorkspace(orderId)`**

Location: `src/modules/orders/order.service.ts` (or extract to `src/modules/pos/pos.service.ts` if the function grows large)

Returns a single `POSWorkspace` object containing everything the POS page needs in one call:

```ts
interface POSWorkspace {
  // Order identity
  orderId: string
  jobNumber: string
  orderStatus: OrderStatusLabel
  sessionDate: string
  customerName: string
  customerPhone: string

  // Package composition (requires Feature 56)
  originalPackage: POSPackage | null
  currentPackage: POSPackage | null        // finalPackage
  packageItems: POSPackageItem[]           // from PackageItem joined to Product
  bundleAdjustment: number                 // Package.bundleAdjustment
  rawDeliverableTotal: number              // sum(packageItems.priceSnapshot × qty)

  // Photo count
  includedPhotoCount: number
  selectedPhotoCount: number
  extraPhotoCount: number
  extraPhotoUnitPrice: number
  extraPhotoTotal: number

  // Standalone add-ons on this order
  addOns: POSAddOn[]

  // Available options for actions
  packageOptions: POSPackageOption[]       // for package upgrade picker
  productOptions: POSProductOption[]       // grouped by category, for item upgrade picker
  addOnCatalog: POSAddOnCatalogItem[]      // from Product where isAddOn=true, for marketplace

  // Financial snapshot
  invoice: POSInvoiceSummary | null
}

interface POSPackage {
  id: string
  name: string
  price: number
  priceLabel: string
  photoCount: number
  bundleAdjustment: number
}

interface POSPackageItem {
  id: string                // PackageItem.id
  productId: string
  productName: string
  category: string          // ALBUM | CANVAS | DIGITAL | PRINT | etc.
  quantity: number
  priceSnapshot: number     // price locked at package definition time
  priceSnapshotLabel: string
}

interface POSAddOn {
  id: string                // OrderAddOn.id
  optionId: string | null
  name: string
  price: number
  priceLabel: string
}

interface POSPackageOption {
  id: string
  name: string
  price: number
  priceLabel: string
  isCurrentPackage: boolean
  upgradeDelta: number      // price - currentPackage.price (can be negative for downgrades)
  upgradeDeltaLabel: string
}

interface POSProductOption {
  id: string
  name: string
  category: string
  canonicalPrice: number
  canonicalPriceLabel: string
}

interface POSAddOnCatalogItem {
  id: string
  name: string
  category: string
  price: number
  priceLabel: string
}

interface POSInvoiceSummary {
  invoiceId: string
  invoiceNumber: string
  invoiceStatus: InvoiceStatusLabel
  isLocked: boolean
  packageBaseTotal: number
  bundleAdjustment: number
  addOnTotal: number
  extraPhotoTotal: number
  invoiceTotal: number
  paidAmount: number
  remainingAmount: number
}
```

**Computed totals (service layer, not UI):**

```
invoiceTotal =
  currentPackage.price         (already includes bundleAdjustment)
  + extraPhotoTotal
  + sum(addOns.price)
  + manualAdjustments          (future)
```

---

## Sub-Units

### 57a — Route Foundation + Layout

**Scope:** Establish the route, layout, and skeleton page with real data loading. No composition UI yet.

**Files:**

- `app/orders/[orderId]/sales/layout.tsx` — own layout, no tab bar; includes POS header with job number, customer name, back link
- `app/orders/[orderId]/sales/page.tsx` — fetches `getPOSWorkspace(orderId)`, renders skeleton sections with placeholder content
- `src/modules/orders/order.service.ts` (or new `pos.service.ts`) — `getPOSWorkspace()` function + `POSWorkspace` types
- `src/modules/orders/order.types.ts` (or new `pos.types.ts`) — all POS-specific interfaces

**Entry point wiring:**

- Add "Open Sales View" button to the order detail page header
- Add "Sales" to the order list row action menu

**Acceptance:** navigating to `/orders/[orderId]/sales` renders the POS layout with real order identity data (job number, customer, session date). The back link works. TypeScript, lint, and build pass.

---

### 57b — Package Composition Area

**Dependency:** Feature 56b (PackageItem + bundleAdjustment) must be complete.

**UI section — Package Composition:**

Displays the current package's structured deliverables as visual cards:

```
┌──────────────────────────────────────────┐
│  Gold Package                            │
│                                          │
│  [Album card]   [Canvas card]            │
│  Premium Album  Canvas 20×30             │
│  1×  80.000 KD  1×  30.000 KD           │
│  [Upgrade]      [Replace]                │
│                                          │
│  [Photos card]                           │
│  40 Edited Photos                        │
│  Included                                │
└──────────────────────────────────────────┘
  Raw total: 150.000 KD
  Bundle adjustment: −30.000 KD
  ─────────────────────────────
  Package price: 120.000 KD
```

Each deliverable card shows: product name, quantity, price snapshot, and action buttons (Upgrade / Replace where applicable).

**Package upgrade action:**

- "Upgrade Package" button opens a picker showing `packageOptions` with delta labels (e.g., "+40.000 KD")
- Selecting a new package calls `updateOrderFinalPackage(orderId, newPackageId)` — existing service
- After update, `getPOSWorkspace` is re-fetched and composition re-renders

**Item upgrade action (within package):**

- "Upgrade" on an album card opens a product picker filtered to the same category
- Selecting a replacement product calls a new service action `upgradePackageItem(orderId, packageItemId, newProductId)`
- Charge = `newProduct.canonicalPrice − currentItem.priceSnapshot` — added as an `ITEM_UPGRADE` line on the invoice
- This does NOT change the package template; it records the delta on the order

**Server actions:**

- `updateOrderPackage(orderId, packageId)` — existing, wraps current upgrade logic
- `upgradeOrderPackageItem(orderId, packageItemId, newProductId)` — new; validates invoice not locked, computes delta, writes `OrderAddOn` row with type `ITEM_UPGRADE` and the price delta

**Acceptance:** composition area renders real `PackageItem` rows; bundle adjustment is visible; package upgrade picker works; item upgrade computes correct delta and adds it to the order.

---

### 57c — Action Buttons + Add-On Marketplace

**UI section — Quick Action Buttons:**

Always-visible row of large action buttons:

```
[ + Add Album ]  [ + Add Canvas ]  [ + Add Prints ]  [ + Add Digital ]  [ Upgrade Package ]
```

Each "Add" button opens a product picker for that category (reads from `productOptions` grouped by category). Selecting a product adds it as a standalone `OrderAddOn` at the product's canonical price.

These are standalone add-ons, not modifications to the package composition. They are NOT subject to the bundle adjustment.

**UI section — Add-On Marketplace:**

Horizontal scrollable row of catalog cards (from `addOnCatalog`):

```
[Extra Photos +10]  [Mini Album]  [Acrylic Frame]  [USB Drive]  [Thank-You Cards]
  +15.000 KD          +35.000 KD    +20.000 KD       +5.000 KD    +8.000 KD
   [+ Add]             [+ Add]        [+ Add]          [+ Add]      [+ Add]
```

One-click add. If the item is already on the order, the button shows "Added" with a remove option.

**Existing add-ons on order:**

Display current `addOns` list below the marketplace with name, price, and a remove button. Remove calls `removeOrderAddOn(orderId, addOnId)`.

**Server actions:**

- `addOrderAddOn(orderId, optionId)` — existing or adapt from selection workflow; validates invoice not locked
- `addOrderProductAddOn(orderId, productId)` — new; adds a product as a standalone add-on at canonical price
- `removeOrderAddOn(orderId, addOnId)` — existing; validates invoice not locked

**Acceptance:** action buttons open correct category pickers; marketplace shows catalog items; adding and removing add-ons updates the order and re-renders financial totals correctly.

---

### 57d — Financial Summary Sidebar

**UI section — Financial Summary:**

Sticky sidebar, accounting-tone, read-mostly:

```
┌───────────────────────────┐
│  Invoice #INV-0042        │
│  Status: Partial          │
│                           │
│  Package (Gold)  120.000  │
│  Extra Photos      15.000 │
│  Mini Album        35.000 │
│  ─────────────────────── │
│  Total           170.000  │
│                           │
│  Paid              80.000 │
│  Remaining         90.000 │
│                           │
│  [ Record Payment ]       │
└───────────────────────────┘
```

When invoice is locked: show a "Invoice Locked" badge. Composition changes are blocked with a visible message (approval flow is a future spec).

When invoice has `InvoiceLineItem` rows (post-56d): render from line items. When not yet snapshotted (draft): render from computed service totals.

**"Record Payment" button:** opens existing payment recording flow (links to or embeds the payment modal already used on the order financial tab).

**Acceptance:** sidebar shows correct computed totals from service layer; locked state is clearly displayed; payment button opens the existing payment flow.

---

### 57e — Dashboard Phone Search Entry Point

**Scope:** Add a phone number search widget to the main dashboard that returns a customer's order history and links directly to the POS for each order.

**UI:**

Search input on dashboard (phone number). On submit:

1. Fetch customer by phone → `getCustomerByPhone(phone)`
2. Fetch their orders → `getOrdersByCustomerId(customerId)` (recent, limited to ~10)
3. Render a compact order list: session date, package name, status, payment status
4. Each row has an "Open Sales" button → `/orders/[orderId]/sales`

**Service functions:**

- `getCustomerByPhone(phone)` — exists or adapt from customer service
- `getOrdersByCustomerId(customerId)` — lightweight order list, no workflow data

**Acceptance:** phone search returns correct customer and their orders; "Open Sales" links navigate to the correct POS page; empty state shows when no customer or no orders are found.

---

## Post-Implementation

- `context/progress-tracker.md` — record each 57x sub-unit separately
- Feature 58 (adjustment invoices / approval workflows) can be specced once 57d is stable — the locked-invoice guard in 57b/57c creates the integration point

---

## Acceptance Criteria

1. `/orders/[orderId]/sales` is a standalone route with its own layout; it does not inherit the order detail tab bar.
2. The page is reachable directly by URL and from at least two entry points (order detail + orders list).
3. Package composition displays structured `PackageItem` deliverables with bundle adjustment shown separately.
4. Package upgrade and item upgrade flows write to the order, not the package template.
5. Standalone add-ons (marketplace and product picker) are correctly separated from package composition.
6. All commercial totals are computed in the service layer, never in UI components.
7. Invoice locked state is clearly surfaced; changes are blocked with a visible message (not silently).
8. Financial sidebar renders from `InvoiceLineItem` rows when available, computed totals otherwise.
9. Dashboard phone search (57e) produces a direct "Open Sales" link to the POS.
10. All sub-units pass TypeScript, lint, and build before the next begins.
