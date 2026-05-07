# Current Database ER Diagram

_Generated: 2026-05-07 | Source: `prisma/schema.prisma` | Updated for the canonical `Job` entity and `Booking.jobId`._

---

## Summary

The database has **14 models** and **14 enums** running on PostgreSQL via Prisma ORM. The schema covers the full studio workflow: customer and children management, canonical job ownership, booking scheduling, photography session themes, package selection, order lifecycle (selection → editing → production → delivery), invoicing with adjustment chains, and payment recording.

The central workflow thread now starts at `Job`, which owns the immutable operational `jobNumber` and links first to `Booking`. `Order` remains the downstream operational hub created one-to-one from a booking and now also carries its own `jobId` FK back to the canonical job. `Invoice` and `Payment` similarly point back to the same job thread for downstream joins while the order still aggregates the post-session workflow state: high-level workflow statuses, editing timestamps, section-level production statuses, delivery timestamps/override fields, assigned editor, NAS folder path, and financial references (invoices, activities).

`Customer.id` is intentionally denormalized into `Order` to allow direct customer-scoped queries without joining through `Booking`.

---

## ER Diagram

```mermaid
erDiagram
    User {
        string id PK
        string name
        string email UK
        UserRole role
        datetime createdAt
        datetime updatedAt
    }

    Customer {
        string id PK
        string name
        string phone UK
        CustomerStatus status
        string notes
        datetime createdAt
        datetime updatedAt
    }

    Job {
        string id PK
        string jobNumber UK
        string customerId FK
        datetime createdAt
        datetime updatedAt
    }

    Child {
        string id PK
        string name
        datetime dateOfBirth
        string customerId FK
        datetime createdAt
        datetime updatedAt
    }

    Package {
        string id PK
        string name
        decimal price
        int photoCount
        string description
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }

    OrderAddOnOption {
        string id PK
        string name
        string category
        decimal price
        boolean isActive
        int sortOrder
        datetime createdAt
        datetime updatedAt
    }

    StudioDepartment {
        string id PK
        string name
        string code UK
        boolean isActive
        int sortOrder
        datetime createdAt
        datetime updatedAt
    }

    Booking {
        string id PK
        string publicId UK
        string jobNumber UK
        string jobId UK
        string customerId FK
        string packageId FK
        datetime sessionDate
        SessionType sessionType
        string departmentId FK
        BookingStatus status
        string assignedPhotographerId FK
        string notes
        datetime createdAt
        datetime updatedAt
    }

    BookingTheme {
        string id PK
        string bookingId FK
        string themeName
        string notes
        datetime createdAt
        datetime updatedAt
    }

    Order {
        string id PK
        string publicId UK
        string jobNumber
        string jobId FK UK
        string bookingId FK
        string customerId FK
        string originalPackageId FK
        string finalPackageId FK
        int selectedPhotoCount
        json addOns
        OrderStatus status
        OrderSelectionStatus selectionStatus
        OrderEditingStatus editingStatus
        OrderProductionStatus productionStatus
        OrderDeliveryStatus deliveryStatus
        string assignedEditorId FK
        datetime editingAssignedAt
        datetime editingStartedAt
        datetime editingCompletedAt
        datetime customerApprovedAt
        datetime sentToProductionAt
        int editedPhotoCount
        int revisionCount
        datetime estimatedEditingCompletionAt
        OrderProductionSectionStatus productionAlbumDesignStatus
        OrderProductionSectionStatus productionPrintingStatus
        OrderProductionSectionStatus productionAssemblyStatus
        OrderProductionSectionStatus productionVendorStatus
        OrderProductionSectionStatus productionFramedPrintsStatus
        OrderProductionSectionStatus productionFinalStatus
        datetime productionReadyAt
        datetime deliveryPreparedAt
        datetime customerNotifiedAt
        datetime pickedUpAt
        datetime deliveryCompletedAt
        string deliveryCompletedBy
        string deliveryPickupNotes
        string deliveryOverrideReason
        string nasFolderPath
        string notes
        datetime createdAt
        datetime updatedAt
    }

    OrderActivity {
        string id PK
        string orderId FK
        string userId FK
        OrderActivityType type
        string title
        string description
        json metadata
        datetime createdAt
    }

    Invoice {
        string id PK
        string publicId UK
        string jobNumber
        string jobId FK
        string orderId FK
        string bookingId FK
        string customerId FK
        int invoiceSeq UK
        string invoiceNumber UK
        decimal totalAmount
        decimal paidAmount
        decimal remainingAmount
        InvoiceStatus status
        boolean isLocked
        string parentInvoiceId FK
        string notes
        datetime issuedAt
        datetime closedAt
        datetime createdAt
        datetime updatedAt
    }

    Payment {
        string id PK
        string publicId UK
        string jobNumber
        string jobId FK
        string invoiceId FK
        decimal amount
        PaymentMethod method
        PaymentType paymentType
        datetime paidAt
        string reference
        string notes
        datetime createdAt
    }

    IdentifierSequence {
        string scope PK
        int year PK
        int lastValue
        datetime createdAt
        datetime updatedAt
    }

    Customer ||--o{ Child : "has"
    Customer ||--o{ Job : "owns"
    Customer ||--o{ Booking : "has"
    Customer ||--o{ Order : "has (denormalized)"
    Customer ||--o{ Invoice : "billed on"

    Job ||--o| Booking : "anchors"
    Job ||--o| Order : "anchors"
    Job ||--o{ Invoice : "owns"
    Job ||--o{ Payment : "owns"
    Booking }o--|| StudioDepartment : "held at"
    Booking }o--o| Package : "booked with"
    Booking }o--o| User : "assigned photographer"
    Booking ||--o{ BookingTheme : "has"
    Booking ||--o| Order : "generates"
    Booking ||--o{ Invoice : "invoiced on"

    Order }o--|| Booking : "generated from"
    Order }o--o| Package : "original package"
    Order }o--o| Package : "final package"
    Order }o--o| User : "assigned editor"
    Order ||--o{ OrderActivity : "has"
    Order ||--o{ Invoice : "invoiced on"
    User ||--o{ OrderActivity : "attributed to"

    Invoice }o--o| Invoice : "adjustment of"
    Invoice ||--o{ Payment : "received"
```

---

## Main Relationships (Plain English)

- **Customer → Child**: A customer can have zero or more children. The current child record remains intentionally small: only `name`, optional `dateOfBirth`, and timestamps, linked back to a single customer.
- **Customer → Job → Booking → Order**: The core workflow chain now starts with a canonical `Job` row that owns the immutable `jobNumber`. Each current booking points to one job through `Booking.jobId`; once the session completes, one `Order` is created from that booking and continues the operational workflow.
- **Job ownership**: `Job.customerId` is the canonical customer owner for the job thread. Booking creation now creates the job and attaches it transactionally, while the transitional `Booking.jobNumber` string remains stored for compatibility reads. `Order`, `Invoice`, and `Payment` now also keep canonical `jobId` links for downstream joins.
- **Booking → Package**: A booking may reference a package at time of booking (optional). The actual final package used can differ and is tracked on the `Order` as `finalPackageId`.
- **Order → Package (×2)**: An order records both the package originally booked (`originalPackageId`) and the package the customer ends up with after any upgrades (`finalPackageId`).
- **Order workflow state**: `Order` now stores both top-level workflow enums and deeper phase metadata directly on the row: editing assignment/start/completion fields, approval and handoff timestamps, section-level production statuses, ready-for-pickup timestamps, pickup/completion metadata, and manual delivery override reason fields.
- **Order → User (editor)**: An editor staff member can be assigned to an order for the editing phase.
- **Booking → User (photographer)**: A photographer staff member can be assigned to a booking.
- **Invoice → Order / Booking**: An invoice can be associated with either an order or a booking (or both — schema allows it). Customer is always required on an invoice.
- **Invoice → Invoice (self-ref)**: An invoice can be an adjustment of another invoice via `parentInvoiceId`, enabling invoice amendment chains.
- **Invoice → Payment**: Each invoice can have multiple payment records against it, each recording the amount, method (CASH / KNET / LINK), and payment type (DEPOSIT, BASE, UPGRADE, ADDON, OTHER).
- **Order → OrderActivity**: Every significant state change on an order is logged as an activity record, optionally attributed to a staff user through nullable `userId`.
- **OrderAddOnOption**: A standalone reference/catalogue table. Add-ons selected for an order are stored as JSON in `Order.addOns` — no formal FK enforced.
- **IdentifierSequence**: A standalone sequence table used to generate scoped, year-prefixed public IDs (e.g., booking and order public identifiers). No FK relations.

---

## Unclear or Uncertain Relationships

| Item | Status | Detail |
|---|---|---|
| `Order.addOns` (JSON) | **Uncertain FK** | Field stores add-on data as raw JSON. Likely references `OrderAddOnOption` IDs, but no database-level FK exists. Schema does not enforce referential integrity here. |
| `Order.deliveryCompletedBy` | **Uncertain type** | Declared as `String?` with no FK relation. Could be a free-text name or a User ID. Not modeled as a formal FK to `User`. |
| `Invoice.orderId` + `Invoice.bookingId` | **Ambiguous scope** | Both fields are optional, so an invoice can be linked to an order, a booking, both, or neither. The business rule governing which combination is valid is not enforced at the schema level. |
| `Invoice.parentInvoiceId` self-reference | **Depth unknown** | The schema supports an unlimited chain of invoice adjustments. No maximum depth or circular-reference guard is enforced. |
| `BookingTheme` cascade | **Confirmed** | `onDelete: Cascade` is set — themes are hard-deleted when their booking is deleted. No equivalent cascade exists on `Order`, `Invoice`, or `Payment`. |

---

## Possible Future Improvements

- Remove `Booking.publicId` and `Order.publicId` fields once URL routing moves to `jobNumber` slugs — both are made redundant by the existing `jobNumber` and internal cuid.
- Remove `Invoice.publicId` field — `Invoice.id` (cuid) handles internal FK use and `invoiceNumber` handles financial display; the field serves neither role cleanly.
- Introduce a canonical `Job` entity with `Job.jobNumber` as the single source of truth, replacing the current pattern of propagating `jobNumber` as a copied string across `Order`, `Invoice`, and `Payment`.
- Replace `Order.addOns` JSON field with a proper join table to `OrderAddOnOption` to enforce referential integrity and enable querying by add-on.
- Formalize `Order.deliveryCompletedBy` as a nullable FK to `User` if it represents a staff member.
- Clarify (and possibly enforce via constraint or application rule) whether an `Invoice` should link to an `Order`, a `Booking`, or both simultaneously.
- Add a depth limit or flat-adjustment model to prevent unbounded `Invoice` adjustment chains.
- Consider cascade rules for `Order`, `Invoice`, and `Payment` consistent with `BookingTheme`'s cascade behavior.

---

## Identifier Architecture Notes

_Added: 2026-05-07 | See full analysis: `context/reviews/identifier-architecture-review.md`_

### External PostgreSQL Sequences (not visible in Prisma schema)

The following sequences exist in the database but are defined outside `schema.prisma` (created via raw migrations):

| Sequence | Feeds | Format |
|---|---|---|
| `booking_public_id_seq` | `Booking.publicId` | `BKG-00001` |
| `order_public_id_seq` | `Order.publicId` | `ORD-00001` |
| `invoice_public_id_seq` | `Invoice.publicId` | `INV-PUB-00001` |
| `payment_public_id_seq` | `Payment.publicId` | `PAY-00001` |
| `invoice_number_seq` | `Invoice.invoiceSeq` / `Invoice.invoiceNumber` | `INV-00001` |

The `IdentifierSequence` table (shown in the ER diagram) feeds `jobNumber` only — it is a separate, application-managed sequence.

### Correction: Invoice.publicId Format

`Invoice.publicId` is formatted as `INV-PUB-XXXXX` (prefix defined in `identifier.constants.ts` as `"INV-PUB"`), **not** `INV-XXXXX`. The `INV-XXXXX` format belongs exclusively to `Invoice.invoiceNumber`. These two identifiers are distinct and use separate sequences.

### Which Identifiers Are Employee-Facing vs System-Internal

| Identifier | Employee-Facing? | Notes |
|---|---|---|
| `Booking.publicId` (`BKG-XXXXX`) | Currently yes — **should be demoted then removed** | Shown in table column and detail header; Phase 1: remove from UI; V1.1: drop field entirely |
| `Booking.jobNumber` (`DEPT-YEAR-NNNNN`) | Yes — **primary operational ID** | The one identifier employees should use for all workflow |
| `Order.publicId` (`ORD-XXXXX`) | Currently yes — **should be demoted then removed** | Same treatment as `Booking.publicId`; redundant given jobNumber is already 1:1 with order |
| `Order.jobNumber` | Yes — inherited from Booking | Correct |
| `Invoice.publicId` (`INV-PUB-XXXXX`) | **No** — already system-internal; **redundant** | `Invoice.id` handles FK use; `invoiceNumber` handles financial display; this field serves neither role cleanly. V1.1: drop field |
| `Invoice.invoiceNumber` (`INV-XXXXX`) | Yes — financial document reference | Correct; globally incrementing, never resets |
| `Payment.publicId` (`PAY-XXXXX`) | Yes — payment receipt reference | Correct; keep |

### Identifier Philosophy (Target)

Every identifier should serve exactly one of three roles:

| Role | Correct identifier | Examples |
|---|---|---|
| **Internal DB identity** | cuid (Prisma auto) | `Booking.id`, `Order.id`, `Invoice.id` |
| **Operational identity** | `jobNumber` | `NB-2026-00018` — generated once at booking, inherited downstream |
| **Financial identity** | Immutable document number | `Invoice.invoiceNumber` (`INV-00001`), `Payment.publicId` (`PAY-00001`) |

`Booking.publicId`, `Order.publicId`, and `Invoice.publicId` do not fit any of these three roles cleanly and are identified as redundant in the architecture review.

### Target Architecture Intent

The target architecture direction, in phases:

1. **Phase 1 (UI only, no schema change):** Remove `BKG-XXXXX` and `ORD-XXXXX` from all employee-facing tables, headers, and search filters. `jobNumber` becomes the sole operational identifier staff use.
2. **Phase 2 (near-term schema):** Change URL routing from `[cuid]` slugs to `[jobNumber]` slugs (e.g. `/bookings/NB-2026-00018`).
3. **Phase 3 (V1.1 schema cleanup):** Drop `Booking.publicId`, `Order.publicId`, and `Invoice.publicId` fields and their associated PostgreSQL sequences. `Invoice.invoiceNumber` and `Payment.publicId` remain untouched.
4. **Phase 4 (V1.1+):** Extract `EditingJob` and `ProductionJob` as separate entities; replace `Order.addOns` JSON with a structured join table.
5. **Phase 5 (V2):** Introduce a canonical `Job` entity — `jobNumber` moves to `Job.jobNumber` as the single source of truth, and all downstream entities hold `jobId FK → Job.id` instead of the current propagated string.

See `context/reviews/identifier-architecture-review.md` for the full gap analysis, redundancy re-evaluation, canonical Job entity proposal, and risk details.
