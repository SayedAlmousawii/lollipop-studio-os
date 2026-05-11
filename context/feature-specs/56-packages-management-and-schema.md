##56e moved after feature 57.



## Goal

Redesign the package data model from a flat commercial price into a structured commercial bundle architecture. Introduce a canonical Product catalog (albums, canvases, digital files, prints, etc.) that packages reference for their included deliverables. Add a bundle adjustment field to packages so the difference between a package's marketed price and the sum of its included product prices is explicit and trackable. Add invoice line items so every finalized invoice snapshots its full price breakdown immutably. Build or rebuild the admin UIs for both products and packages.

This spec supersedes the earlier Feature 56 draft and the deferred note in Feature 55c about structured package deliverable fields.

---

## Architectural Foundation (read before anything else)

The business model is a **commercial bundle**, not an additive cart:

```text
Package.price (final marketed price)
  = sum(PackageItem.canonicalPrice × qty)   ← raw deliverable total
  + Package.bundleAdjustment                ← can be negative (discount) or positive
```

The `bundleAdjustment` belongs to the bundle, not to individual products. This is critical for upgrade logic:

- Album upgrade within a package: charge = `newProduct.canonicalPrice − oldProduct.canonicalPrice`
- The bundle adjustment does NOT change on an item upgrade
- Package-level upgrade (Silver → Gold): replace entire composition, apply new bundle adjustment

Invoice line items snapshot every price component at invoice lock time so historical invoices never recalculate from future price changes.

---

## Read First

- `prisma/schema.prisma` — current `Package`, `Product`, `Order`, `OrderAddOn`, `Invoice`, `Payment` models
- `src/modules/packages/package.service.ts`
- `src/modules/packages/package.types.ts`
- `src/modules/orders/order.types.ts` — `OrderSelectionWorkflow`, `OrderFinancialSummary`
- `src/modules/invoices/invoice.service.ts`
- `context/reviews/POS-review.md`
- `context/reviews/owner-feedback-review-doc.md` — Problems 3 and 4
- `context/architecture-summary.md` — invariants 4 and 5

---

## Rules

- Split into sub-units before any code. No code ships under the parent `56` label.
- Schema changes are non-breaking additions. Existing records must keep working.
- `Package.price` remains the canonical commercial price. Do not remove or rename it.
- `Package.photoCount` stays — order flows depend on it heavily.
- Safe removal for both Products and Packages: archive/deactivate if referenced; hard delete only when no references exist.
- Business rules live in service layer. Server actions and UI stay thin.
- Invoice line items must be written at invoice lock time, not computed on read.
- Package template edits must NOT retroactively change existing order compositions or locked invoices.

---

## Scope

### In Scope

- New `Product` model — canonical product catalog with categories and canonical prices
- New `PackageItem` model — links packages to products with quantity and price snapshot
- `bundleAdjustment` field on `Package`
- New `InvoiceLineItem` model — snapshot of every price component at invoice lock time
- Admin UI: `/products` page (create, edit, archive)
- Admin UI: `/packages` page rebuild (create, edit, archive with deliverable composition)
- Service layer for all new models
- Downstream adoption: order selection and financial summary surfaces read from structured fields

### Out of Scope

- POS / Commercial Workspace page (separate feature spec)
- Approval workflow / anti-fraud controls (separate feature spec)
- Adjustment invoices (separate feature spec)
- Retroactively rewriting historical invoice totals
- Customer-facing catalog

---

## Sub-Units

### 56a — Product Catalog: Schema + Admin UI

**Schema addition — new `Product` model:**

```text
Product
├── id            cuid
├── name          String               e.g. "Premium Album", "Luxury Canvas 20×30"
├── category      ProductCategory      ALBUM | CANVAS | DIGITAL | PRINT | FRAME | USB | OTHER
├── canonicalPrice Decimal (10,3)
├── description   String?
├── isActive      Boolean @default(true)
├── isPackageDeliverable Boolean @default(true)
├── isAddOn       Boolean @default(false)
├── createdAt / updatedAt
└── packageItems  PackageItem[]
```

**Admin UI — `/products` page:**

- New sidebar nav item: "Products" (admin / manager only)
- Table: name, category, canonicalPrice, capability flags, status badge, actions
- Create product: dialog/form with name, category, price, optional description, and capability flags
- Edit product: same form pre-populated
- Archive: deactivate if referenced by any `PackageItem`; hard delete only if no references
- Category shown as a readable label (Album, Canvas, Digital, etc.)

**Service layer (`src/modules/products/product.service.ts`):**

- `getProducts()` — all products with `_count: { packageItems: true }` plus capability flags for admin display
- `getActiveProductOptions()` — for package builder dropdowns, grouped by category, filtered to active `isPackageDeliverable` products
- `createProduct(data)` — Zod-validated, including `isPackageDeliverable` and `isAddOn`
- `updateProduct(id, data)` — Zod-validated, including `isPackageDeliverable` and `isAddOn`
- `archiveProduct(id)` — sets `isActive: false`; blocks if `packageItems` exist on active packages

**Catalog decision:** `Product` is now the single canonical catalog for both package-included deliverables and standalone add-ons (extra canvas, USB, prints, extra photos). Products use capability flags to control where they appear:

- `isPackageDeliverable` — available inside package composition
- `isAddOn` — sellable as a standalone order add-on

`OrderAddOnOption` has been retired in favor of Product-backed add-on snapshots.

---

### 56b — Package Schema Redesign

**Schema additions:**

New `PackageItem` model:

```text
PackageItem
├── id              cuid
├── packageId       String  → Package
├── productId       String  → Product
├── quantity        Int @default(1)
├── priceSnapshot   Decimal (10,3)   snapshot of Product.canonicalPrice at item-add time
├── sortOrder       Int @default(0)
├── createdAt / updatedAt
├── @@index([packageId])
└── @@unique([packageId, productId])   one row per product in a package; multiplicity is stored in quantity
```

Updated `Package` model (additive changes only):

```text
Package
├── (existing fields unchanged)
├── bundleAdjustment  Decimal (10,3) @default(0)  stored, not derived
└── items             PackageItem[]
```

`bundleAdjustment` is stored explicitly (not computed on read). When a package is saved, compute it as:

```text
bundleAdjustment = Package.price − sum(PackageItem.priceSnapshot × quantity)
```

This makes the adjustment visible and auditable without recalculation.

**Service layer (`src/modules/packages/package.service.ts` expansion):**

- `getPackageWithItems(id)` — full package with `PackageItem[]` and nested `Product`
- `createPackage(data)` — creates package + items, computes `bundleAdjustment`
- `updatePackage(id, data)` — updates package + items, recomputes `bundleAdjustment`; blocked for price fields if invoice is locked against this package
- `archivePackage(id)` — sets `isActive: false`; blocked if active bookings or orders reference it
- Guard: package template edits do not touch any `Order` or `Invoice` row

---

### 56c — Package Management UI Rebuild

Replace the current read-only `/packages` page with a full management surface.

**Package table additions:**

- Show `bundleAdjustment` as a formatted line (e.g., `−30.000 KD` or `+0.000 KD`)
- Show deliverable summary: e.g., "1× Premium Album · 1× Canvas · 40 Photos"
- Active / Inactive badge
- Actions: Edit, Archive (replacing current placeholder Edit dropdown)

**Create / Edit package form:**

- Package name, price, photoCount, description (optional)
- Deliverable items section:
  - Select product from `getActiveProductOptions()` (grouped by category)
  - Set quantity
  - Snapshot price auto-fills from product's `canonicalPrice` (editable override allowed)
  - Add / remove items inline
- Bundle adjustment preview computed client-side as user adds items:
  ```text
  bundleAdjustment = price − sum(items)
  ```
  Show it clearly: "Bundle adjustment: −30.000 KD"
- Validation: price must be set; at least one deliverable item is recommended but not blocked

**Archive flow:**

- If package has active bookings or orders: show count, disable hard delete, offer archive
- If unused: allow hard delete with confirmation

---

### 56d — Invoice Line Items: Schema + Snapshot Logic

**Schema addition — new `InvoiceLineItem` model:**

```text
InvoiceLineItem
├── id           cuid
├── invoiceId    String  → Invoice
├── lineType     InvoiceLineType
│     PACKAGE_BASE          ← base package price
│     BUNDLE_ADJUSTMENT     ← package discount/adjustment (usually negative)
│     ITEM_UPGRADE          ← individual product upgrade delta
│     ADD_ON                ← standalone add-on
│     EXTRA_PHOTOS          ← extra-photo charge
│     MANUAL_DISCOUNT       ← manual reduction
│     MANUAL_SURCHARGE      ← manual addition
├── description  String           e.g. "Gold Package", "Album Upgrade (Premium → Luxury)"
├── quantity     Int @default(1)
├── unitPrice    Decimal (10,3)   can be negative for adjustments/discounts
├── lineTotal    Decimal (10,3)   quantity × unitPrice
├── sortOrder    Int @default(0)
├── createdAt
└── @@index([invoiceId])
```

**Invoice model addition:**

```text
Invoice
├── (existing fields unchanged)
└── lineItems    InvoiceLineItem[]
```

**Snapshot rule:** Line items are written exactly once, at the moment the invoice transitions from `DRAFT` → `ISSUED` (or at first payment if issued without explicit lock). After that point, line items are immutable — they must not be recalculated or overwritten.

**Service layer (`src/modules/invoices/invoice.service.ts` addition):**

- `snapshotInvoiceLineItems(invoiceId, orderId)` — builds and writes `InvoiceLineItem` rows from current order state:
  1. `PACKAGE_BASE` — current `finalPackage.price` or `originalPackage.price`
  2. `BUNDLE_ADJUSTMENT` — from `Package.bundleAdjustment`
  3. `ITEM_UPGRADE` — if package was upgraded, delta between final and original package price
  4. `ADD_ON` — one row per `OrderAddOn`
  5. `EXTRA_PHOTOS` — extra photo charge if any
  Called inside the existing invoice issue/lock flow; idempotent (skips if rows already exist)
- `getInvoiceWithLineItems(invoiceId)` — returns invoice + sorted line items

**Type additions (`invoice.types.ts`):**

- `InvoiceLineItem` interface
- `InvoiceLineType` union
- Add `lineItems: InvoiceLineItem[]` to existing `InvoiceDetail`

**Note on backward compatibility:** Existing invoices have no line items. The `OrderFinancialSummary` computed fields (`basePackagePrice`, `upgradeAmount`, `addOnTotal`, etc.) remain working for unlocked invoices. Locked invoices with line items should prefer the snapshot line items for display.

---

### 56e — Downstream Adoption

After 56a–56d are stable, update order-facing surfaces that currently depend on `description` or loosely computed fields.

**Order selection tab (replaces 55c's description-based fix):**

- `OrderSelectionWorkflow.packageDescription` → replace with `packageItems: PackageItemDisplay[]`
- Selection tab shows a structured deliverables list: "1× Premium Album (80.000 KD), 1× Canvas (30.000 KD), 40 Photos"
- Bundle adjustment shown separately: "Bundle discount: −30.000 KD"
- Service: `getOrderSelectionWorkflow()` joins `finalPackage.items` and maps to display types

**Order overview tab:**

- Deliverables card (currently using `addonsSummary` free text) switches to structured items from `PackageItem` + `OrderAddOn` rows
- Separates "Included in package" from "Paid add-ons" visually

**Financial summary (`OrderFinancialSummary`):**

- When invoice has line items: render directly from `InvoiceLineItem` rows
- When invoice has no line items (pre-56d or draft): keep existing computed fields

**`open-issues-review.md` cleanup:**

- Remove "Package Deliverables Missing from Order Tab" once this unit ships
- Update the Feature 55c note about structured fields being deferred

---

## Schema Migration Strategy

All additions are non-breaking:

- New tables (`Product`, `PackageItem`, `InvoiceLineItem`) start empty — existing records unaffected
- `Package.bundleAdjustment` defaults to `0` — existing packages have no adjustment until edited and resaved
- `Invoice.lineItems` is optional — existing invoices render via computed fields until line items are written

Existing packages with only `description` continue to work. Staff can migrate packages gradually by editing them in the new UI.

---

## Post-Implementation

- `context/progress-tracker.md` — record each 56x sub-unit separately
- `context/reviews/open-issues-review.md` — remove Package Deliverables gap note after 56e

---

## Acceptance Criteria

1. Feature 56 is treated as a parent with sub-units 56a–56e; no code ships under the parent label.
2. A `Product` model exists as the canonical price catalog for both package deliverables and standalone add-ons.
3. `PackageItem` links packages to products with quantity and a price snapshot at definition time.
4. `Package.bundleAdjustment` is stored explicitly and visible in the package management UI.
5. `InvoiceLineItem` rows are written at invoice issue/lock time and are never overwritten after that point.
6. Package create/edit/archive works safely without touching existing order or invoice records.
7. Product create/edit/archive works safely; archive is blocked when items are in active packages.
8. Downstream order surfaces use structured `PackageItem` data instead of `description` free text (56e).
9. Existing order and invoice records continue to function throughout rollout.
10. Each sub-unit passes TypeScript, lint, and build before the next begins.
