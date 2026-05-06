## Goal

Add human-friendly public IDs for bookings, orders, invoices, and payments, plus one shared immutable `jobNumber` that links the full workflow together.

---

## Read First

- `agents.md`
- `context/target-data-model.md`

---

## Rules

- Keep raw database `id` fields internal-only
- Additive change only; do not replace internal primary keys
- Keep the shared `jobNumber` immutable after booking creation
- Keep scope focused on identifier design, generation, persistence, and basic display/search wiring

---

## Scope

### In Scope

- Add `publicId` to:
  - `Booking`
  - `Order`
  - `Invoice`
  - `Payment`
- Add shared `jobNumber` to workflow-linked records starting from booking creation
- Generate `jobNumber` when a booking is created
- Ensure order/invoice/payment records inherit the same `jobNumber`
- Define department-code-based `jobNumber` format such as `NB-2026-00124`
- Keep invoice-specific numbering alongside this system
- Update affected UI reads so staff can see and search these identifiers where needed

### Out of Scope

- Replacing raw database IDs as relational keys
- Changing core booking/order/payment workflow rules
- Full audit log redesign
- Barcode/QR features
- External customer portal requirements

---

## Identifier Requirements

### Public IDs

- Each booking, order, invoice, and payment must have its own unique human-friendly `publicId`
- `publicId` identifies one record only
- `publicId` should be safe to expose in UI, search, and printed/exported references

### Job Number

- `jobNumber` identifies the whole workflow thread, not a single record
- `jobNumber` is created once at booking creation
- `jobNumber` must never change after creation
- Related order, invoice, and payment records must reuse the booking's `jobNumber`

---

## Format

- `jobNumber` format: department code + year + sequence
- Example: `NB-2026-00124`
- Department code source must be explicit and stable
- Sequence generation must be concurrency-safe

---

## Service Layer

- Identifier generation must live in service-layer code
- Do not generate public IDs in UI components
- Use database-safe sequencing or equivalent locking strategy; never derive the next value from a simple row count

---

## Acceptance Criteria

- Raw `id` remains the internal primary key everywhere
- Bookings, orders, invoices, and payments each have a unique `publicId`
- Booking creation generates immutable `jobNumber`
- Order, invoice, and payment creation inherit the correct `jobNumber`
- Staff-facing reads can show the new identifiers where appropriate
- Search can use these identifiers where required by the unit design
- Update `context/progress-tracker.md`

---

## Assumptions

- `invoiceNumber` remains a separate finance-facing identifier and is not replaced by `publicId` or `jobNumber`
- Department prefixes such as `NB` will come from a defined mapping, not arbitrary free text formatting at render time
