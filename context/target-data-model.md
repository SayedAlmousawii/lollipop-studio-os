# Target Data Model

## Purpose

This document describes the ideal V1 schema direction for Studio OS based on:

- the current implementation shape in [current-data-model.md](/Users/bo3li/Desktop/lollipop-studio-os/context/current-data-model.md)
- the findings in [current-data-model-review.md](/Users/bo3li/Desktop/lollipop-studio-os/context/current-data-model-review.md)
- the intended system behavior in [architecture-context.md](/Users/bo3li/Desktop/lollipop-studio-os/context/architecture-context.md)
- the business workflow in [project-overview.md](/Users/bo3li/Desktop/lollipop-studio-os/context/project-overview.md)

This is a design target only. It is not an implementation plan and does not imply schema changes have been made.

---

## Design Principles

The ideal V1 schema should follow these rules:

1. Keep the database as the source of truth
2. Make each department's workflow explicit
3. Use structured tables for financial and operational records
4. Avoid duplicated business truth when a derived source already exists
5. Preserve traceability for all sensitive actions
6. Keep V1 practical and not over-engineered

---

## Proposed V1 Entities

### 1. User

**Purpose:** staff identity, roles, and assignment target

**Core fields**
- `id`
- `name`
- `email`
- `role`
- `isActive`
- `createdAt`
- `updatedAt`

**Notes**
- Used for photographer assignment, editor assignment, manual overrides, and audit actions

### 2. Customer

**Purpose:** parent/customer account and relationship anchor

**Core fields**
- `id`
- `name`
- `phone`
- `status`
- `notes`
- `createdAt`
- `updatedAt`

### 3. Child

**Purpose:** child profile linked to customer

**Core fields**
- `id`
- `customerId`
- `name`
- `dateOfBirth`
- `notes`

### 4. Package

**Purpose:** reusable package template

**Core fields**
- `id`
- `name`
- `basePrice`
- `includedPhotoCount`
- `description`
- `isActive`
- `createdAt`
- `updatedAt`

### 5. PackageItem

**Purpose:** structured package contents

**Core fields**
- `id`
- `packageId`
- `itemType`
- `label`
- `quantity`
- `notes`

**Examples**
- printed photos
- album
- frame
- digital files

### 6. AddOnDefinition

**Purpose:** reusable add-on catalog

**Core fields**
- `id`
- `name`
- `price`
- `isActive`
- `description`

### 7. Booking

**Purpose:** scheduling and pre-session workflow

**Core fields**
- `id`
- `customerId`
- `packageId`
- `sessionDate`
- `sessionType`
- `department`
- `status`
- `assignedPhotographerId` nullable
- `notes`
- `createdAt`
- `updatedAt`

**Important notes**
- Do not use `depositPaid` as a separate source of truth if deposit state can be derived from payments
- Booking owns scheduling and assignment, not final order pricing

### 8. BookingTheme

**Purpose:** selected themes for a booking

**Core fields**
- `id`
- `bookingId`
- `themeName`
- `notes`

**Reason**
- Themes are part of booking ownership in the architecture and should not be hidden in free-text notes alone

### 9. Order

**Purpose:** post-session commercial and fulfillment record

**Core fields**
- `id`
- `bookingId` unique
- `customerId`
- `originalPackageId`
- `finalPackageId`
- `selectedPhotoCount`
- `status`
- `synologyPath` nullable
- `notes`
- `createdAt`
- `updatedAt`

**Important notes**
- `bookingId` stays 1:1 with order
- `synologyPath` supports the manual V1 storage-link requirement

### 10. OrderAddOn

**Purpose:** structured add-ons chosen for an order

**Core fields**
- `id`
- `orderId`
- `addOnDefinitionId` nullable
- `nameSnapshot`
- `priceSnapshot`
- `quantity`
- `notes`

**Reason**
- Snapshot fields preserve history even if catalog definitions later change

### 11. UpgradeRecord

**Purpose:** explicit tracking of package upgrade events

**Core fields**
- `id`
- `orderId`
- `fromPackageId`
- `toPackageId`
- `previousPaidPackageAmount`
- `upgradeCharge`
- `changedByUserId`
- `reason` nullable
- `createdAt`

**Reason**
- The current package FK comparison is useful, but a dedicated upgrade record is better for audit, reporting, and commissions

### 12. Invoice

**Purpose:** customer-facing financial document

**Core fields**
- `id`
- `orderId`
- `bookingId`
- `customerId`
- `invoiceNumber`
- `invoiceType`
- `parentInvoiceId` nullable
- `totalAmount`
- `paidAmount`
- `remainingAmount`
- `status`
- `isLocked`
- `issuedAt` nullable
- `closedAt` nullable
- `createdAt`
- `updatedAt`

**Suggested `invoiceType` values**
- `PRIMARY`
- `ADJUSTMENT`

**Important notes**
- Keep explicit invoice classification instead of inferring from creation order
- Denormalized amounts are acceptable if recalculated consistently

### 13. Payment

**Purpose:** append-only money movement record

**Core fields**
- `id`
- `invoiceId`
- `amount`
- `method`
- `paymentType`
- `reference` nullable
- `paidAt`
- `recordedByUserId`
- `createdAt`

**Suggested `paymentType` values**
- `DEPOSIT`
- `BASE`
- `UPGRADE`
- `ADDON`
- `OTHER`

### 14. EditingJob

**Purpose:** editing workflow and revision loop

**Core fields**
- `id`
- `orderId`
- `assignedEditorId` nullable
- `status`
- `revisionCount`
- `customerApprovalStatus`
- `startedAt` nullable
- `completedAt` nullable
- `approvedAt` nullable
- `notes`

**Suggested status shape**
- `PENDING`
- `IN_PROGRESS`
- `AWAITING_CUSTOMER_APPROVAL`
- `REVISION_REQUIRED`
- `COMPLETED`

### 15. ProductionJob

**Purpose:** production and fulfillment workflow

**Core fields**
- `id`
- `orderId`
- `jobType`
- `status`
- `vendorName` nullable
- `startedAt` nullable
- `completedAt` nullable
- `notes`

**Suggested `jobType` values**
- `PRINT`
- `ALBUM_DESIGN`
- `ALBUM_VENDOR`

**Suggested status shape**
- `PENDING`
- `IN_PROGRESS`
- `READY`
- `COMPLETED`
- `CANCELLED`

### 16. Commission

**Purpose:** photographer commission tracking

**Core fields**
- `id`
- `orderId`
- `userId`
- `upgradeRecordId`
- `commissionAmount`
- `status`
- `calculatedAt`
- `paidAt` nullable
- `notes`

**Reason**
- The project overview treats commissions as a V1 feature, so they should not remain implicit

### 17. AuditLog

**Purpose:** traceability for sensitive actions

**Core fields**
- `id`
- `userId`
- `action`
- `entityType`
- `entityId`
- `oldValue` JSON nullable
- `newValue` JSON nullable
- `note` nullable
- `createdAt`

**Required coverage**
- payments
- invoice changes
- package upgrades
- add-on changes
- commission changes
- manual status overrides
- order delivery override actions

---

## Core Relationships

```text
Customer (1)
 ├── Children (N)
 ├── Bookings (N)
 │    ├── BookingThemes (N)
 │    └── Order (1)
 │         ├── OrderAddOns (N)
 │         ├── UpgradeRecords (N, usually 0..1 in V1)
 │         ├── Invoices (N)
 │         │    └── Payments (N)
 │         ├── EditingJobs (N, usually 1 active chain)
 │         ├── ProductionJobs (N)
 │         └── Commissions (N)
 └── AuditLogs (indirect by entity references)
```

---

## Ownership Boundaries

### Booking module owns
- customer booking link
- package at booking time
- date/time
- session type
- department
- photographer assignment
- themes
- booking status

### Orders module owns
- order lifecycle
- original vs final package
- selected photo count
- chosen add-ons
- storage path

### Invoices and payments module owns
- invoice totals
- payment records
- deposit/base/upgrade/add-on payment classification
- invoice locking and closure

### Editing module owns
- editor assignment
- edit status
- customer approval loop

### Production module owns
- print/album/vendor workflow
- readiness for delivery

### Commission module owns
- upgrade-linked commission records
- commission payment status

### Audit layer owns
- who changed what, when, and why

---

## Recommended V1 Lifecycle

### Booking phase

1. Create booking
2. Optionally attach themes
3. Assign photographer if known
4. Record deposit as a `Payment`
5. Treat deposit state as derived from payment history
6. Confirm booking only when deposit rule is satisfied

### Post-session phase

1. When session is completed, create the order if it does not exist
2. Order starts with:
   - `originalPackageId = booking.packageId`
   - `finalPackageId = booking.packageId`
3. Invoice creation should follow one explicit rule only
4. Order updates that affect price must trigger invoice recalculation rules

### Selection and pricing phase

1. Update selected photos
2. Add structured add-ons
3. Change final package when upgraded
4. Create `UpgradeRecord` when package replacement changes payment expectation
5. Recalculate invoice totals consistently

### Editing and production phase

1. Create an editing job when the order is ready for editing
2. Move into production only when editing is complete and approved
3. Create one or more production jobs based on deliverables
4. Mark order delivered only when all production work is complete

---

## Fields or Patterns to Avoid in the Target Model

- `Booking.depositPaid` as an independent source of truth
- JSON-only add-ons when structured rows are practical
- invoice role inferred only by creation order
- hidden staff assignment inside notes
- workflow-critical data stored only as free text

---

## Minimal V1 vs Nice-to-Have

### Must exist in ideal V1

- `Booking.department`
- `Booking.assignedPhotographerId`
- booking themes
- `Order.synologyPath`
- structured add-ons
- `EditingJob`
- `ProductionJob`
- `Commission`
- `AuditLog`
- explicit invoice classification

### Can stay simple in V1

- one active editing job per order
- basic production job types only
- manual commission payout flow
- manual Synology path entry
- simple theme records instead of a complex theme catalog

---

## Final Recommendation

The ideal V1 schema should keep the current strengths:

- strong core customer/booking/order/invoice/payment flow
- explicit original/final package tracking
- append-only payments
- invoice locking and adjustment support

But it should add enough structure to fully support the V1 business promise:

- department-aware bookings
- assigned staff workflow
- editing and production tracking
- structured upgrades and add-ons
- commissions
- auditability
- storage linkage

That would make the schema consistent with the intended Studio OS scope without overbuilding beyond V1.
