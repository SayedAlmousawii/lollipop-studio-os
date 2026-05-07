# Current Database ER Diagram

_Generated: 2026-05-07 | Source: `prisma/schema.prisma` | Updated for the canonical `Job` entity and `Booking.jobId`._

---

## Summary

The database has **16 models** and **14 enums** running on PostgreSQL via Prisma ORM. The schema covers the full studio workflow: customer and children management, canonical job ownership, booking scheduling, photography session themes, package selection, order lifecycle (selection → editing → production → delivery), invoicing with adjustment chains, and payment recording.

The central workflow thread now starts at `Job`, which owns the immutable operational `jobNumber` and links first to `Booking`. `Order` remains the downstream operational hub created one-to-one from a booking and now also carries its own `jobId` FK back to the canonical job. `Invoice` and `Payment` similarly point back to the same job thread for downstream joins while post-session workflow ownership is being split into dedicated sub-entities. Editing assignment, timestamps, revision counts, and approval/handoff state live on `EditingJob`, while production status, section progress, and pickup readiness now live on `ProductionJob`, both linked one-to-one to `Order` and `Job`. Booking, order, and invoice public IDs still exist in the schema for compatibility, but active staff-facing reads and searches now use `jobNumber` / `invoiceNumber` instead.

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
        json addOns "deprecated - no longer source of truth"
        OrderStatus status
        OrderSelectionStatus selectionStatus
        OrderDeliveryStatus deliveryStatus
        datetime deliveryPreparedAt
        datetime customerNotifiedAt
        datetime pickedUpAt
        datetime deliveryCompletedAt
        string deliveryCompletedById FK "nullable - active actor reference"
        string deliveryCompletedBy "legacy fallback only - not active source of truth"
        string deliveryPickupNotes
        string deliveryOverrideReason
        string nasFolderPath
        string notes
        datetime createdAt
        datetime updatedAt
    }

    OrderAddOn {
        string id PK
        string orderId FK
        string addOnOptionId FK "nullable"
        string nameSnapshot
        decimal priceSnapshot
        int quantity
        string notes "nullable"
        datetime createdAt
        datetime updatedAt
    }

    ProductionJob {
        string id PK
        string jobId FK UK
        string orderId FK UK
        OrderProductionStatus status
        OrderProductionSectionStatus albumDesignStatus
        OrderProductionSectionStatus printingStatus
        OrderProductionSectionStatus assemblyStatus
        OrderProductionSectionStatus vendorStatus
        OrderProductionSectionStatus framedPrintsStatus
        OrderProductionSectionStatus finalStatus
        datetime productionStartedAt
        datetime readyForPickupAt
        datetime completedAt
        string vendorName
        string notes
        datetime createdAt
        datetime updatedAt
    }

    EditingJob {
        string id PK
        string jobId FK UK
        string orderId FK UK
        string assignedEditorId FK
        OrderEditingStatus status
        int editedPhotoCount
        int revisionCount
        datetime editingAssignedAt
        datetime editingStartedAt
        datetime editingCompletedAt
        datetime customerApprovedAt
        datetime sentToProductionAt
        datetime estimatedEditingCompletionAt
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
    Job ||--o| EditingJob : "anchors"
    Job ||--o| ProductionJob : "anchors"
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
    Order ||--o| EditingJob : "owns"
    Order ||--o| ProductionJob : "owns"
    Order }o--o| User : "delivery completed by"
    EditingJob }o--o| User : "assigned editor"
    Order ||--o{ OrderActivity : "has"
    Order ||--o{ OrderAddOn : "has"
    OrderAddOnOption o|--o{ OrderAddOn : "snapshots"
    Order ||--o{ Invoice : "invoiced on"
    User ||--o{ OrderActivity : "attributed to"

    Invoice }o--o| Invoice : "adjustment of"
    Invoice ||--o{ Payment : "received"
```

---

## Main Relationships (Plain English)

- **Customer → Child**: A customer can have zero or more children. The current child record remains intentionally small: only `name`, optional `dateOfBirth`, and timestamps, linked back to a single customer.
- **Customer → Job → Booking → Order**: The core workflow chain now starts with a canonical `Job` row that owns the immutable `jobNumber`. Each current booking points to one job through `Booking.jobId`; once the session completes, one `Order` is created from that booking and continues the operational workflow.
- **Job ownership**: `Job.customerId` is the canonical customer owner for the job thread. Booking creation now creates the job and attaches it transactionally, while the transitional `Booking.jobNumber` string remains stored for compatibility reads. `Order`, `Invoice`, and `Payment` now also keep canonical `jobId` links for downstream joins, and the older booking/order/invoice public IDs are no longer used in active staff-facing flows.
- **Booking → Package**: A booking may reference a package at time of booking (optional). The actual final package used can differ and is tracked on the `Order` as `finalPackageId`.
- **Order → Package (×2)**: An order records both the package originally booked (`originalPackageId`) and the package the customer ends up with after any upgrades (`finalPackageId`).
- **Order workflow state**: `Order` keeps the commercial and delivery hub state, while production workflow persistence now lives on `ProductionJob` and editing workflow persistence lives on `EditingJob`.
- **Order → EditingJob**: Each order owns one editing job row for the editing phase.
- **Order → ProductionJob**: Each order owns one production job row for the current V1 production workflow, including section-level progress and readiness timestamps.
- **Order → User (delivery actor)**: When an order is completed through the delivery workflow, `Order.deliveryCompletedById` records the FK of the staff member who performed completion. The legacy `Order.deliveryCompletedBy` free-text field is retained only as a non-authoritative fallback for orders completed before this FK was introduced.
- **EditingJob → User (editor)**: An editor staff member can be assigned to an editing job.
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
| `Order.addOns` (JSON) | **Deprecated** | Field is kept for transition compatibility but is no longer the active source of truth. Structured `OrderAddOn` rows are now written and read instead. Will be removed in a future cleanup migration. |
| `Order.deliveryCompletedBy` | **Legacy fallback** | Retained as a non-authoritative field for orders completed before the FK migration. New completions write `deliveryCompletedById` (FK to `User`) instead. Read model prefers the FK-backed name; falls back to this string only if the FK is null. |
| `Invoice.orderId` + `Invoice.bookingId` | **Ambiguous scope** | Both fields are optional, so an invoice can be linked to an order, a booking, both, or neither. The business rule governing which combination is valid is not enforced at the schema level. |
| `Invoice.parentInvoiceId` self-reference | **Depth unknown** | The schema supports an unlimited chain of invoice adjustments. No maximum depth or circular-reference guard is enforced. |
| `BookingTheme` cascade | **Confirmed** | `onDelete: Cascade` is set — themes are hard-deleted when their booking is deleted. No equivalent cascade exists on `Order`, `Invoice`, or `Payment`. |

---

## Possible Future Improvements

- Remove the transitional `Booking.publicId`, `Order.publicId`, and `Invoice.publicId` fields once the remaining compatibility dependencies are gone and the schema cleanup is approved.
- Continue the downstream transition to canonical `Job` ownership by moving reads and reports toward `jobId` joins, then retire propagated job-number compatibility fields once all workflow paths use the existing `Job` relation.
- Drop the deprecated `Order.addOns` JSON field once all compatibility paths confirm the structured `OrderAddOn` rows are stable.
- Drop `Order.deliveryCompletedBy` (free-text legacy field) once all pre-migration delivery completions are confirmed reconciled or no longer needed.
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
| `Booking.publicId` (`BKG-XXXXX`) | No for active flows - compatibility only | Retained in schema for transition, but no longer surfaced in staff-facing reads/search |
| `Booking.jobNumber` (`DEPT-YEAR-NNNNN`) | Yes — **primary operational ID** | The one identifier employees should use for all workflow |
| `Order.publicId` (`ORD-XXXXX`) | No for active flows - compatibility only | Retained in schema for transition, but no longer surfaced in staff-facing reads/search |
| `Order.jobNumber` | Yes — inherited from Booking | Correct |
| `Invoice.publicId` (`INV-PUB-XXXXX`) | No for active flows - compatibility only | Retained in schema for transition, but no longer surfaced in staff-facing reads/search |
| `Invoice.invoiceNumber` (`INV-XXXXX`) | Yes — financial document reference | Correct; globally incrementing, never resets |
| `Payment.publicId` (`PAY-XXXXX`) | Yes — payment receipt reference | Correct; keep |

### Identifier Philosophy (Target)

Every identifier should serve exactly one of three roles:

| Role | Correct identifier | Examples |
|---|---|---|
| **Internal DB identity** | cuid (Prisma auto) | `Booking.id`, `Order.id`, `Invoice.id` |
| **Operational identity** | `jobNumber` | `NB-2026-00018` — generated once at booking, inherited downstream |
| **Financial identity** | Immutable document number | `Invoice.invoiceNumber` (`INV-00001`), `Payment.publicId` (`PAY-00001`) |

`Booking.publicId`, `Order.publicId`, and `Invoice.publicId` do not fit any of these three roles cleanly and are now treated as transitional compatibility fields rather than staff-facing identifiers.

### Target Architecture Intent

The target architecture direction, in phases:

1. **Phase 1 (UI/read cleanup, no schema change):** Complete. `BKG-XXXXX` and `ORD-XXXXX` are no longer shown in active employee-facing tables, headers, or search filters. `jobNumber` is the sole operational identifier staff use.
2. **Phase 2 (near-term schema):** Change URL routing from `[cuid]` slugs to `[jobNumber]` slugs (e.g. `/bookings/NB-2026-00018`).
3. **Phase 3 (V1.1 schema cleanup):** Drop the transitional `Booking.publicId`, `Order.publicId`, and `Invoice.publicId` fields and their associated PostgreSQL sequences once compatibility dependencies are fully retired. `Invoice.invoiceNumber` and `Payment.publicId` remain untouched.
4. **Phase 4 (V1.1+):** Extract `EditingJob` and `ProductionJob` as separate entities; replace `Order.addOns` JSON with a structured join table.
5. **Phase 5 (V2):** Complete the identifier cleanup around the existing canonical `Job`: migrate any remaining downstream reads to `jobId` joins, remove propagated job-number string dependencies from child entities, and drop redundant fields only after compatibility paths are retired.

See `context/reviews/identifier-architecture-review.md` for the full gap analysis, redundancy re-evaluation, canonical Job entity proposal, and risk details.
