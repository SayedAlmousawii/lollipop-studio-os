## Goal

Lay the schema foundation for the lifecycle architecture revision. This is a schema-only spec — no service or UI changes. Every subsequent spec in the 60–63 series depends on this migration being in place first.

---

## Read First

- `prisma/schema.prisma` — read the full file before touching anything; pay close attention to every composite unique and composite FK relation involving `jobId`
- `src/modules/identifiers/identifier.service.ts` and `identifier.constants.ts` — understand the sequence generation before modifying `identifier_sequences`
- `src/modules/invoices/invoice.service.ts` — understand how composite constraints are used in queries before removing them
- `context/reviews/lifecycle-review.md` — the architectural rationale behind every change here

---

## Rules

- Schema and migration only — no service, action, or UI changes in this spec
- Do not merge Job and Order — keep as separate models
- Existing development data will be reset before this spec runs — no backfill logic needed
- New fields that replace `jobId` as grouping keys (`financialCaseId` on Invoice and Payment) should be added as nullable in this spec; they become required once Specs 60–63 populate them
- The composite unique constraints and composite FK relations involving `jobId` across Booking, Order, Invoice, and Payment are the highest-risk area — redesign every one of them carefully; nullable fields cannot anchor composite FK relations in Prisma

---

## Scope

### In Scope

**BookingStatus enum**
Replace `COMPLETED` with `CHECKED_IN`. `CHECKED_IN` is the state a confirmed booking enters when the client arrives and a Job/Order is created. It is not a synonym for delivered — it marks the start of operational work.

**Booking model**
- `jobId` → nullable (`String?`) — pending and confirmed bookings no longer require a Job
- `jobNumber` → nullable (`String?`) — same reason
- `publicId` → nullable (`String?`) — will be null for pending bookings; becomes the BK reference when generated at confirmation (Spec 60)

**New FinancialCase model**
Internal grouping entity. No public ID. Fields: `id` (cuid), `bookingId` (unique), `customerId`, `jobId` (nullable — stamped at check-in in Spec 61), `createdAt`, `updatedAt`. Relations: `booking Booking`, `customer Customer`, `job Job?`, `invoices Invoice[]`, `payments Payment[]`.

**New InvoiceType enum**
`DEPOSIT`, `FINAL`, `ADJUSTMENT`, `REFUND`, `CREDIT_NOTE`

**Invoice model**
- Add `financialCaseId String?` — nullable now, required after Spec 60 populates it
- Add `invoiceType InvoiceType?` — nullable now, required after all invoice creation is updated
- `jobId` → nullable (`String?`)
- `jobNumber` → nullable (`String?`)
- Redesign all composite unique constraints and FK relations that include `jobId` — see Implementation Direction

**Payment model**
- Add `financialCaseId String?` — nullable now
- `jobId` → nullable (`String?`)
- `jobNumber` → nullable (`String?`)
- Redesign the composite FK relation to Invoice that includes `jobId` — see Implementation Direction

**PaymentType enum**
Remove `BASE`. Add `FINAL`. New full set: `DEPOSIT`, `FINAL`, `UPGRADE`, `ADDON`, `OTHER`.

**identifier_sequences model**
Add `kind String @default("JOB")`. Update the `@@unique` constraint from `([scope, year])` to `([scope, year, kind])`. The default `"JOB"` ensures all existing sequence rows remain valid and readable by the current job number generation logic without a data migration.

**Order model**
Add `originalPackagePriceSnapshot Decimal? @db.Decimal(10, 3)` and `finalPackagePriceSnapshot Decimal? @db.Decimal(10, 3)`. These are set at specific lifecycle moments in later specs and used as the source of truth for commission calculations.

**Run migration**

### Out of Scope

- Any service layer changes
- Any UI changes
- Any identifier generation changes (those live in Specs 60 and 61)
- Job + Order merge (deferred pending multi-package business decision)

---

## Implementation Direction

**Composite constraint audit — do this before writing a single line**

Read `prisma/schema.prisma` fully and list every `@@unique`, `@unique`, and `@relation` that includes `jobId` as a field. There are several across Booking, Order, Invoice, and Payment. These were added in Features 42–43 to enforce cross-model job ownership integrity. With `jobId` becoming nullable, they all break — a nullable field cannot be part of a composite FK relation in Prisma.

The pattern to follow for each: drop the composite, use the simpler single-field unique or relation that already exists. The financial grouping integrity that `jobId` composites were enforcing will be handled by `financialCaseId` in the new architecture.

Specific areas to resolve:
- `Booking`: has composite uniques involving `jobId` that are referenced as FK targets by `Order`. Drop the `jobId` from these composites — Order can relate to Booking via `bookingId` alone.
- `Order`: has composite uniques involving `jobId` referenced by Invoice, EditingJob, ProductionJob. Same approach — simplify to single-field relations where possible.
- `Invoice`: has `@@unique([id, jobId])` referenced by Payment's composite FK. Drop this composite; the Payment → Invoice relation should use `invoiceId` alone.
- `Payment`: the `@relation` to Invoice currently uses `(invoiceId, jobId)` as the composite FK. Simplify to `invoiceId` only.

Work through each model's relations to ensure the simplified constraints still enforce the integrity that matters, just without `jobId` as the anchor.

**FinancialCase placement**
Add it between the Customer model and the Job model in the schema file, as it conceptually sits between the customer relationship and the operational job.

**identifier_sequences kind field**
The existing upsert logic in `generateJobNumber` uses `ON CONFLICT ("scope", "year")` in raw SQL. After adding the `kind` column, that conflict target must change to `("scope", "year", "kind")`. Read the existing raw SQL in `identifier.service.ts` carefully — the conflict clause will need to match the new unique constraint. This is a service-layer concern but note it here so the migration and the service change are coordinated in the same unit if needed, or flagged for Spec 60/61 to address.

**PaymentType BASE removal**
Search the full codebase for usages of `PaymentType.BASE` before removing it from the enum. Any reference must be noted as needing update in subsequent specs. Do not silently remove — if there are active usages, the migration will fail or TypeScript will surface errors, which is the correct signal.

---

## Post-Implementation

- Update `context/progress-tracker.md`

---

## Acceptance Criteria

1. `BookingStatus` enum contains `CHECKED_IN` and does not contain `COMPLETED`
2. `Booking.jobId` and `Booking.jobNumber` are nullable in schema and migration
3. `Booking.publicId` is nullable
4. `FinancialCase` model exists with all specified fields
5. `InvoiceType` enum exists with all five values
6. `Invoice` has `financialCaseId`, `invoiceType` fields; `jobId` and `jobNumber` are nullable
7. `Payment` has `financialCaseId`; `jobId` and `jobNumber` are nullable
8. `PaymentType` contains `FINAL` and does not contain `BASE`
9. `identifier_sequences` has a `kind` field; `@@unique([scope, year, kind])` is the constraint
10. `Order` has `originalPackagePriceSnapshot` and `finalPackagePriceSnapshot` fields
11. No composite unique or FK relation in the schema still references a nullable `jobId` as a required part of the composite
12. Migration runs cleanly with no errors
13. `npm run build` passes
14. `npm run lint` passes
15. Update `context/progress-tracker.md`
