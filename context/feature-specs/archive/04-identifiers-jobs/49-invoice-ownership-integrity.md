## Goal

Make invoice ownership rules explicit and enforced so every invoice belongs to one customer-owned job thread, while booking/order links remain clear workflow context for session invoices.

---

## Read First

- `agents.md`
- `context/project-overview-summary.md`
- `context/architecture-summary.md`
- `context/reviews/current-database-er-diagram.md`
- `context/reviews/identifier-architecture-review.md`
- `context/feature-specs/34-financials-activity-tabs.md`

---

## Rules

- Preserve existing invoice/payment business behavior unless a tighter integrity rule is required to reflect current intended logic
- Keep invoice and payment identity separate
- Keep this unit narrowly focused on invoice ownership integrity
- Avoid broad financial redesign in this unit
- Do not add a blanket rule that every invoice must have `bookingId` or `orderId`
- Update `context/reviews/current-database-er-diagram.md` if the implemented schema shape changes

---

## Scope

### In Scope

- Tighten invoice linkage expectations between job/customer ownership and optional booking/order workflow context
- Add constraints, indexes, or validations that make current intended invoice relationships safer
- Keep current invoice and payment flows working after migration

### Out of Scope

- Reworking invoice totals or payment formulas
- Replacing invoice adjustment chains
- Implementing gift vouchers, retail sales, or standalone sales flows
- Adding `JobType` or broader job categorization
- Rebuilding the financials UI
- Permissions redesign
- Full audit-log redesign

---

## Invoice Ownership Principle

- Every invoice must belong to one customer-owned job thread.
- `Invoice.customerId` and `Invoice.jobId` are the required ownership anchors.
- `Invoice.bookingId` and `Invoice.orderId` are nullable contextual links used by session workflow invoices.
- The current session workflow uses one rolling invoice: it starts at booking, then attaches to the order when the order exists.
- Booking/order links must be internally consistent with the invoice's `jobId` and `customerId` whenever they are present.
- Adjustment invoices inherit the same ownership thread and contextual links from their parent invoice.

---

## Required Schema Direction

This unit should address at least these review findings:

- clarify that an invoice always belongs to a customer-owned job thread, not universally to a booking or order
- enforce `customerId` + `jobId` as the required invoice ownership anchors
- keep `bookingId` and `orderId` optional, but validate them as consistent workflow context when present
- preserve the current rolling booking/order invoice model without blocking future non-session invoice types

Schema/composite FK constraints should ensure invoice `jobId`, `customerId`, `bookingId`, and `orderId` are mutually consistent where practical. If some invoice rule cannot be expressed purely in Prisma schema constraints, service-layer validation must make the rule explicit and unavoidable.

---

## Migration Direction

- normalize invoice ownership data to the selected valid patterns before tightening constraints
- preserve or backfill invoice `jobId` and `customerId` as the required ownership anchors
- attach current session workflow invoices to their booking/order context where safely resolvable
- do not migrate toward `bookingId NOT NULL` or `orderId NOT NULL`

Do not silently discard legacy invoice context.

---

## Service Layer

Expected service behavior:

- invoice creation/update paths validate the intended ownership anchors and contextual links consistently
- workflow invoice creation prevents duplicate primary invoices for the same booking/order job
- booking-created invoices are reused as the rolling invoice when the order is created
- read models continue to expose clear invoice context to current pages

This unit should make current intended rules stricter, not invent new business steps.

---

## Future Job Types Note

Future voucher, retail, or standalone sales invoices should be modeled as customer-owned job threads without requiring booking/order context. A likely future direction is to add explicit job categorization, for example:

```text
JobType = SESSION | VOUCHER | RETAIL | OTHER
```

A future voucher flow could then be modeled as:

```text
Customer -> Job(type: VOUCHER) -> Invoice
```

Feature 49 must not implement vouchers, standalone sales, or `JobType`; it should only keep invoice ownership compatible with that direction by treating `bookingId` and `orderId` as contextual links rather than universal ownership requirements.

---

## Acceptance Criteria

- Invoice ownership rules are explicit and enforced consistently
- `customerId` and `jobId` are treated as required invoice ownership anchors
- `bookingId` and `orderId` remain optional but are validated when present
- Current rolling booking/order invoice behavior is preserved
- Current invoice and payment flows still work after migration
- No intentional business-flow redesign is introduced
- `context/reviews/current-database-er-diagram.md` is updated if the implemented schema changes its described structure
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Migration deploy/status checks pass
- Update `context/progress-tracker.md`

---

## Assumptions

- The current software already has an intended rolling session invoice pattern even if the schema has not enforced it yet
- `Job` is the canonical customer-owned thread for invoice ownership, not exclusively a photography-session-only concept
