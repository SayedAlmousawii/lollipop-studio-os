# Identifier Architecture Review

_Generated: 2026-05-07 | Read-only analysis. No schema or code changes made._

---

## Purpose

This document compares the current identifier and data-model implementation against the target architecture direction:

- Employees operate using **one shared operational Job Number** (`NB-2026-00018`)
- Booking/Order public IDs are system-internal identifiers, not employee-facing references
- Invoice and payment numbers are separate, globally incrementing financial identifiers
- Job numbers reset yearly (year is embedded in the format, so global uniqueness is preserved)
- IDs are never recycled

Sources: `prisma/schema.prisma`, `src/modules/identifiers/identifier.service.ts`, `identifier.constants.ts`, `src/modules/invoices/invoice.service.ts`, UI table/filter/detail components, `context/target-data-model.md`, `context/feature-specs/24-public-ids-and-job-number.md`.

---

## Identifier Philosophy

Three distinct roles exist in the system. Every identifier should serve exactly one of them.

| Role | Purpose | Audience | Current examples |
|---|---|---|---|
| **Internal DB identity** | Stable FK anchor; never exposed outside the DB layer | Database engine only | `Booking.id`, `Order.id` (cuid) |
| **Operational identity** | Single workflow reference staff navigate by; must be human-readable and searchable | All departments | `jobNumber` (`NB-2026-00018`) |
| **Financial identity** | Immutable document number for accounting, audit, and compliance | Accountant, auditors | `Invoice.invoiceNumber` (`INV-00001`), `Payment.publicId` (`PAY-00001`) |

Any identifier that does not cleanly fill one of these three roles is redundant. The current implementation has a fourth implicit category — "record-level public IDs" (`BKG-XXXXX`, `ORD-XXXXX`, `INV-PUB-XXXXX`) — that serves neither operational nor financial needs once the job number and internal cuids already exist. This is the core identifier redundancy problem.

---

## Complete Identifier Inventory

| Identifier | Format | Source | Yearly Reset? | Currently Employee-Facing? |
|---|---|---|---|---|
| `Booking.id` | cuid | Prisma auto | no | URL param only — internal |
| `Booking.publicId` | `BKG-00001` | `booking_public_id_seq` (PG seq) | no | **Yes** — "Booking ID" table column + detail header |
| `Booking.jobNumber` | `NB-2026-00018` | `identifier_sequences` table | **yes** | **Yes** — "Job Number" column + detail + customer page |
| `Order.id` | cuid | Prisma auto | no | URL param only — internal |
| `Order.publicId` | `ORD-00001` | `order_public_id_seq` (PG seq) | no | **Yes** — "Order ID" table column + detail header |
| `Order.jobNumber` | `NB-2026-00018` | inherited from Booking | **yes** | **Yes** — "Job Number" column + detail |
| `Invoice.id` | cuid | Prisma auto | no | not shown |
| `Invoice.publicId` | `INV-PUB-00001` | `invoice_public_id_seq` (PG seq) | no | search/filter only — not a table column |
| `Invoice.invoiceNumber` | `INV-00001` | `invoice_number_seq` (PG seq) | no | **Yes** — primary invoice label in table + detail |
| `Invoice.jobNumber` | `NB-2026-00018` | inherited from Booking/Order | **yes** | **Yes** — invoice detail + search |
| `Payment.id` | cuid | Prisma auto | no | not shown |
| `Payment.publicId` | `PAY-00001` | `payment_public_id_seq` (PG seq) | no | **Yes** — payment history table "Payment ID" |
| `Payment.jobNumber` | `NB-2026-00018` | inherited | **yes** | partial |

**PostgreSQL sequences (defined outside Prisma schema, in migrations):**
- `booking_public_id_seq` → `Booking.publicId`
- `order_public_id_seq` → `Order.publicId`
- `invoice_public_id_seq` → `Invoice.publicId`
- `payment_public_id_seq` → `Payment.publicId`
- `invoice_number_seq` → `Invoice.invoiceSeq` / `Invoice.invoiceNumber`

**Application-managed sequence table:**
- `identifier_sequences(scope, year)` composite PK → `jobNumber` (generated at booking creation, inherited downstream)

---

## Gap Analysis

### Gap 1 — Employees see two public identifiers per booking and order

The bookings table shows both "Booking ID" (`BKG-00001`) and "Job Number" (`NB-2026-00018`). The orders table shows both "Order ID" (`ORD-00001`) and "Job Number". The booking detail header reads "Booking BKG-00001 · Job NB-2026-00018".

**Target:** employees see and use only the job number for all operational activity. BKG/ORD identifiers should be invisible to staff.

### Gap 2 — BKG-XXXXX and ORD-XXXXX carry no operational meaning

Both are globally-sequential with no year or department context. They are not correlated with the job number (BKG-00003 ≠ ORD-00003 ≠ NB-2026-00003). Staff cannot derive any workflow information from them. Given the job number already exists and is shown alongside them, they are redundant as employee-facing identifiers.

**Note:** `Invoice.publicId` ("INV-PUB-XXXXX") is already treated correctly — it is used internally for search cross-references but never shown in any table column or detail header. Booking and Order publicIds should reach this same treatment.

### Gap 3 — URL routing uses internal cuids, not job numbers

All routes use the internal cuid as the URL segment:
- `/bookings/[bookingId]` — `bookingId` is a cuid
- `/orders/[orderId]` — `orderId` is a cuid
- `/invoices/[id]` — `id` is a cuid

Employees cannot navigate to a record by job number. Sharing links requires copying an opaque database ID. The target architecture calls for job-number-based routing (e.g. `/bookings/NB-2026-00018`).

### Gap 4 — Invoice has two co-existing "INV-" identifiers

`Invoice.invoiceNumber` = `INV-00001` (financial document number, employee-facing).
`Invoice.publicId` = `INV-PUB-00001` (system-internal, search use only).

The "PUB" infix prevents an exact naming collision and distinguishes them in the application. However, the invoice search filter queries both simultaneously (`publicId` and `invoiceNumber`), so searching "INV-" could return matches from either sequence. This is a minor developer confusion risk, not an operational bug.

### Gap 5 — Order carries 30+ workflow fields that belong in sub-entities

All editing, production, and delivery timestamps and sub-statuses live directly on `Order`:
- 7 editing timestamps + editing status fields
- 6 production section status fields + production timestamps
- 5 delivery timestamps + delivery status fields
- plus revision count, editor assignment, photo counts

Per `context/target-data-model.md`, `EditingJob` and `ProductionJob` should be separate entities. The current monolithic Order model creates coupling between scheduling, financials, editing, production, and delivery concerns.

### Gap 6 — Order.addOns is unstructured JSON

`Order.addOns Json @default("[]")` stores add-on selections without FK enforcement. The `OrderAddOnOption` table is a catalogue but has no formal relationship to Order. Price at time of selection is not preserved. Reporting queries (e.g. "how many orders included add-on X") require JSON parsing across all rows.

### Gap 7 — Order.deliveryCompletedBy is a loose string

`Order.deliveryCompletedBy String?` has no FK to `User`. If this represents a staff member, it should be a nullable FK (`deliveryCompletedById String?`).

### Gap 8 — Yearly reset safety (already correct)

`identifier_sequences(scope, year)` composite PK ensures `NB-2026-00001` and `NB-2027-00001` are distinct records. The year is embedded in every job number string. Cross-year queries are unambiguous. **No action needed here.**

### Gap 9 — Cancelled bookings permanently consume a job number

This is intentional and correct — IDs must never be recycled. A rebooked customer gets a new job number. Staff will see gaps in per-year sequences (00014, 00015 cancelled, 00016 next active). This is expected behaviour and should be documented operationally rather than worked around.

### Gap 10 — No canonical Job entity

The job number is a propagated string across Booking, Order, Invoice, Payment. There is no single table to query `WHERE jobNumber = 'NB-2026-00018'` to retrieve the complete job record. Cross-entity lookups require multi-table joins or parallel queries. A future `Job` entity could serve as the canonical anchor.

---

## Identifier Redundancy Re-evaluation

The gap analysis above treats `Booking.publicId` and `Order.publicId` as candidates for UI demotion (Phase 1). This section goes deeper: should these identifiers exist at all in the long-term schema, and is `Invoice.publicId` similarly redundant?

### Booking.publicId (BKG-XXXXX) — Long-Term Redundancy

**Current justification for the field:** provides a stable, non-cuid reference for bookings that is safe to expose. Generated once, globally sequential.

**Why it is redundant given the current design:**
- `Booking.id` (cuid) already serves as the stable internal FK anchor for all relations.
- `Booking.jobNumber` already serves as the human-readable operational reference.
- `BKG-XXXXX` has no year, no department context, and no meaning employees can derive from it.
- It is not correlated with the job number (BKG-00003 is not necessarily the third job of any year or department).
- URL routing currently uses the cuid, not `publicId`, as the URL slug — so `publicId` is not even the URL identifier it was presumably designed to be.

**Conclusion:** `BKG-XXXXX` fills none of the three identifier roles cleanly. Its only residual use is a legacy-compatible "nicer than cuid" string that pre-dates the job number. If routes move to job number slugs (Phase 2), this field has no remaining justification and should be treated as a removal candidate in V1.1.

### Order.publicId (ORD-XXXXX) — Long-Term Redundancy

Same analysis as `Booking.publicId`. An order is always 1:1 with a booking, so the booking's `jobNumber` fully identifies it. `ORD-XXXXX` adds a third parallel identifier for the same operational thread with no distinguishing information. Removal candidate in V1.1 alongside `Booking.publicId`.

**Concrete harm of keeping both:** two separate globally-incrementing sequences (`booking_public_id_seq`, `order_public_id_seq`) that increment independently produce numbers like BKG-00031 and ORD-00019 for the same customer job. Staff given either number in isolation have no way to cross-reference without a system lookup. The job number already solves this — both records carry `NB-2026-00018`.

### Invoice.publicId (INV-PUB-XXXXX) — Redundant Given invoiceNumber

**Current justification:** provides a system-level reference for invoice records independent of the sequential financial `invoiceNumber`.

**Why it is redundant:**
- `Invoice.id` (cuid) already serves as the stable internal FK anchor for all `Payment` relations and adjustment chains.
- `Invoice.invoiceNumber` (`INV-00001`) already serves as the official financial document identifier, globally sequential and immutable.
- `Invoice.publicId` (`INV-PUB-00001`) is not shown in any employee-facing table column or detail header today. It is only used in the invoice search filter as a secondary search target alongside `invoiceNumber`.
- The `INV-PUB-` prefix was explicitly introduced to prevent a naming collision with `invoiceNumber` — which itself signals that two identifiers on the same record are competing for the same conceptual space.

**Current actual use in code:** `formatInvoiceReference()` in `invoice.service.ts` uses `order.publicId` and `booking.publicId` (not `invoice.publicId`) to build a cross-reference label. `invoice.publicId` is searched in the filter but returns the same record that `invoiceNumber` would find.

**Conclusion:** `Invoice.publicId` is a redundant wrapper around an internal cuid. `Invoice.invoiceNumber` is the correct financial-role identifier. `Invoice.id` is the correct internal-role identifier. Remove `Invoice.publicId` from the schema in V1.1 — no employee-facing surface will need updating since it is already hidden.

### Summary of Redundancy Findings

| Identifier | Redundant? | Correct replacement | Recommended action |
|---|---|---|---|
| `Booking.publicId` (`BKG-XXXXX`) | Yes — long-term | `jobNumber` (operational) + `id` (internal) | Demote in Phase 1; remove in V1.1 |
| `Order.publicId` (`ORD-XXXXX`) | Yes — long-term | `jobNumber` (operational) + `id` (internal) | Demote in Phase 1; remove in V1.1 |
| `Invoice.publicId` (`INV-PUB-XXXXX`) | Yes — now | `invoiceNumber` (financial) + `id` (internal) | Remove in V1.1; no UI change needed |
| `Invoice.invoiceNumber` (`INV-XXXXX`) | No | — | Keep; correct financial identifier |
| `Payment.publicId` (`PAY-XXXXX`) | No | — | Keep; correct financial receipt reference |
| `jobNumber` | No | — | Keep; correct operational identifier |

---

## Canonical Job Entity Proposal

### The Core Problem with Propagated Strings

Currently `jobNumber` (`NB-2026-00018`) is a string that is generated once in `Booking` and then copied verbatim into `Order.jobNumber`, `Invoice.jobNumber`, and `Payment.jobNumber` at creation time. This propagation pattern has several weaknesses:

1. **No referential integrity.** There is no FK constraint ensuring that `Order.jobNumber = 'NB-2026-00018'` actually corresponds to an existing booking. A bug or data migration error could silently create an order with a job number that matches nothing.
2. **No canonical lookup point.** `SELECT * FROM bookings WHERE jobNumber = 'NB-2026-00018'` is required to find the booking; a separate query finds the order; another finds invoices. There is no single table that owns the job number as a primary key.
3. **Redundant storage.** The same string is stored in 4+ tables per job. With 10,000 jobs in the system, that is 40,000+ duplicate string values with no FK guarantees.
4. **Accidental mismatch risk.** If a job number were ever written incorrectly to one downstream entity (typo in a migration script, or a future code path that generates its own number), the mismatch would be silent — no DB constraint catches it.

### Proposed Job Entity

A `Job` model would make `jobNumber` a first-class primary entity with its own row, and replace the propagated string with a FK to `Job.id`.

```
Job {
  id          String   PK (cuid)
  jobNumber   String   UK  ← e.g. NB-2026-00018; generated once; immutable
  customerId  String   FK → Customer
  createdAt   DateTime
}
```

All downstream entities would carry `jobId String FK → Job.id` instead of (or in addition to, during migration) the raw `jobNumber` string.

### Proposed Future Entity Ownership Structure

```
Customer
└── Job (1:N — one customer can have multiple jobs over time)
      ├── jobNumber: NB-2026-00018  ← single source of truth
      ├── Booking (1:1 or 1:N if rebooking is ever supported)
      ├── Order (1:1 with Booking)
      ├── Invoice(s) (1:N — deposit, base, adjustments)
      ├── Payment(s) (1:N — via Invoice)
      ├── EditingJob (1:1 active chain per Order)
      ├── ProductionJob(s) (1:N per Order)
      └── OrderActivity / AuditLog (1:N)
```

All entities query the Job by `Job.id` (FK) for joins, and display `Job.jobNumber` to employees.

### Advantages Over the Current Propagated-String Pattern

| Advantage | Explanation |
|---|---|
| **Referential integrity** | `jobId FK → Job.id` enforced by the DB; no orphaned or mismatched job numbers |
| **Single source of truth** | `jobNumber` lives in exactly one row; all other tables reference `Job.id` |
| **Simpler cross-entity queries** | `SELECT * FROM invoices WHERE jobId = ?` instead of `WHERE jobNumber = ?` across four tables |
| **Easier reporting** | Aggregate across all entities for a job with a single JOIN path through `Job` |
| **No string duplication** | Downstream entities hold a 25-byte cuid FK, not a repeated 15-char string |
| **Mismatch prevention** | A `Payment` with an incorrect `jobId` fails at the DB constraint level, not silently in code |
| **Clean operational hub** | The `Job` row becomes the natural landing page for "Job NB-2026-00018" — one lookup, all records |

### Identifier Roles in the Target Structure

With a canonical `Job` entity, the three identifier roles map cleanly:

| Role | Identifier | Stored on |
|---|---|---|
| Internal DB identity | cuid | `Job.id`, `Booking.id`, `Order.id`, `Invoice.id`, `Payment.id` — all FK references use these |
| Operational identity | `Job.jobNumber` | `Job` table only — all other entities hold `jobId FK` not a copy of the string |
| Financial identity | `Invoice.invoiceNumber`, `Payment.publicId` | Their respective tables; globally sequential; never reset |

`Booking.publicId`, `Order.publicId`, and `Invoice.publicId` have no role in this model and would not exist.

### Migration Approach

Introducing a `Job` entity is a Phase 3+ concern. The migration path is:

1. Add `Job` table with `jobNumber` as unique key.
2. Backfill one `Job` row per distinct `jobNumber` currently in the `bookings` table.
3. Add `jobId` FK column to `Booking`, `Order`, `Invoice`, `Payment` (nullable during migration).
4. Backfill `jobId` by joining on the existing `jobNumber` string.
5. Add NOT NULL constraint once backfill is verified.
6. Deprecate the redundant `jobNumber` string columns on downstream entities.
7. Remove them in a follow-up migration once all queries are updated.

This is a significant but mechanical migration with no business logic changes required.

---

## Recommendations

### What Should Stay

| Item | Reason |
|---|---|
| `jobNumber` format (`DEPT-YEAR-NNNNN`) | Correct, immutable, yearly-reset safe, propagated downstream. |
| `identifier_sequences` table + `generateJobNumber()` | Concurrency-safe, correct design. |
| `Invoice.invoiceNumber` (`INV-XXXXX`, global seq) | Correct financial identifier. Globally incrementing, never resets. |
| `Invoice.invoiceSeq` + `invoice_number_seq` PG sequence | Correct source for financial document numbering. |
| `Payment.publicId` (`PAY-XXXXX`) | Correct payment receipt reference. Globally sequential. |
| All internal cuid PKs | Never expose to users. Keep as DB keys. |
| `Invoice.parentInvoiceId` adjustment chain | Correct design for amendment history. |
| Denormalization of `customerId` on `Order` | Justified by documented schema comment. |

### What Should Change — UI Demotion (no schema changes required)

These changes remove BKG/ORD identifiers from employee-facing surfaces while keeping the DB fields intact.

| Change | Scope | Risk |
|---|---|---|
| Remove "Booking ID" (`BKG-XXXXX`) column from bookings table | UI only | Low |
| Remove "Order ID" (`ORD-XXXXX`) column from orders table | UI only | Low |
| Simplify booking detail header to show only `jobNumber` | UI only | Low |
| Remove BKG/ORD from bookings-filters search targets | UI + service | Low |
| Restrict invoice filter search to invoiceNumber + jobNumber + customer only | UI + service | Low |

### What Requires Schema + Migration Work (future)

| Change | Effort | Risk | When |
|---|---|---|---|
| Change URL routing from `[bookingId]` cuid to `[jobNumber]` | Medium — all pages and service lookups | Medium | Near-term |
| Add `@@index([jobNumber])` to Booking | Low | Low | With Phase 2 |
| Remove `Booking.publicId` and `Order.publicId` from schema entirely | Low — drop columns + PG sequences | Low | V1.1 after Phase 2 ships |
| Remove `Invoice.publicId` from schema | Low — drop column + PG sequence | Low | V1.1; no UI changes needed |
| Extract `EditingJob` and `ProductionJob` as separate entities | High — schema migration + service rewrite | High | V1.1+ |
| Replace `Order.addOns` JSON with structured `OrderAddOn` join table | Medium — schema migration + service update | Medium | V1.1+ |
| Formalize `Order.deliveryCompletedBy` as nullable FK to `User` | Low | Low | Near-term |
| Introduce canonical `Job` entity; replace propagated `jobNumber` strings with `jobId FK` | High — schema migration across 4+ tables; backfill required | Medium | Phase 3 / V2 |

### What Should Be Deprecated (keep in DB until removal, remove from UI now)

| Item | Phase 1 action | Long-term action |
|---|---|---|
| `Booking.publicId` (`BKG-XXXXX`) as employee-facing reference | Remove from UI; keep DB field | Remove field + `booking_public_id_seq` in V1.1 |
| `Order.publicId` (`ORD-XXXXX`) as employee-facing reference | Remove from UI; keep DB field | Remove field + `order_public_id_seq` in V1.1 |
| `Invoice.publicId` (`INV-PUB-XXXXX`) | Already hidden from UI; no action needed | Remove field + `invoice_public_id_seq` in V1.1 |
| Propagated `jobNumber` string columns on `Order`, `Invoice`, `Payment` | Keep as-is | Replace with `jobId FK → Job.id` in Phase 3 |

---

## Migration Strategy

### Phase 1 — UI Demotion (recommended now, zero schema risk)

1. Remove the "Booking ID" column from bookings-table.tsx.
2. Remove the "Order ID" column from orders-table.tsx.
3. Simplify booking and order detail page headers to show only `jobNumber`.
4. Update bookings-filters.tsx: remove BKG publicId from search; keep jobNumber + customer name.
5. Update invoices-filters.tsx: keep invoiceNumber + jobNumber + customer name; remove direct publicId search.
6. All DB fields and sequences remain untouched.

**Zero schema migrations. Zero risk to financial data. Safe to do any time.**

### Phase 2 — Job-Number URL Routing (medium effort)

1. Add `@@index([jobNumber])` to Booking in schema (requires migration).
2. Add `getBookingByJobNumber()` and `getOrderByJobNumber()` service methods.
3. Rename routes: `/bookings/[jobNumber]`, `/orders/[jobNumber]`.
4. Add redirect handlers for old cuid-based URLs.
5. DB relations continue to use cuid PKs — only URL slugs change.

### Phase 3 — Schema Cleanup: Remove Redundant publicId Fields (V1.1)

1. Drop `Booking.publicId` column and `booking_public_id_seq` sequence.
2. Drop `Order.publicId` column and `order_public_id_seq` sequence.
3. Drop `Invoice.publicId` column and `invoice_public_id_seq` sequence.
4. Remove `generatePublicId()` calls for BOOKING, ORDER, and INVOICE kinds from service layer.
5. Update the identifier constants file to remove the three retired kinds.
6. No employee-facing UI changes required — all three are already hidden or being hidden in Phase 1.

Prerequisite: Phase 2 (URL routing to jobNumber) must be complete before dropping `Booking.publicId` and `Order.publicId`, in case any remaining internal code referenced them as URL slugs.

### Phase 4 — Sub-Entity Extraction (V1.1+)

1. Design and migrate `EditingJob` and `ProductionJob` tables.
2. Migrate existing Order fields to new tables with a data migration script.
3. Update order service to delegate to editing/production sub-services.
4. Update UI workflow tabs.
5. Do not begin until Phases 1–3 are fully shipped.

### Phase 5 — Canonical Job Entity (V2)

Full migration as described in the Canonical Job Entity Proposal section above. This is the highest-effort phase and should be planned separately once V1.1 is stable.

---

## Risks and Tradeoffs

| Risk | Severity | Mitigation |
|---|---|---|
| Staff accustomed to BKG/ORD IDs lose familiar references | Low — job number already shown alongside | Job number is already visible; transition is cosmetic |
| cuid-based URLs 404 after Phase 2 | Medium | Add redirect middleware; phase gradually |
| Two INV-prefixed identifiers (`invoiceNumber` + `publicId`) confuse developers | Low | INV-PUB prefix distinguishes; document clearly |
| Yearly job number reset gaps confuse staff | Low | Expected by design; document operationally |
| FileMaker migration — no ID continuity | Low | Expect a clean cut; build a reference-mapping doc if needed |
| Cross-year reporting on job numbers | Low | Year embedded in format; filter by year prefix in ambiguous queries |

---

## Operational Workflow Summary (target state)

```
Customer created
  └── Booking created
        ├── jobNumber generated once: NB-2026-00018  ← employees always use this
        ├── Booking.publicId: BKG-00042              ← system-internal only
        ├── Deposit Invoice created  → inherits jobNumber
        │     └── invoiceNumber: INV-00007            ← financial record ID
        ├── Deposit Payment          → inherits jobNumber
        │     └── Payment.publicId: PAY-00012         ← receipt reference
        └── [session completes]
              └── Order created
                    ├── Order.publicId: ORD-00031     ← system-internal only
                    ├── Order inherits jobNumber: NB-2026-00018
                    ├── Base Invoice  → inherits jobNumber
                    ├── Base Payment  → inherits jobNumber
                    └── [selection → editing → production → delivery]
```

Staff interact with `NB-2026-00018` at every step. All downstream records are discoverable from this single thread.

---

## Recommended Prisma Adjustments Summary

**Phase 1 — UI demotion (no schema change):** None.

**Phase 2 — URL routing (low-risk schema change):**
```prisma
model Booking {
  @@index([jobNumber])  // enables job-number-based URL lookups
}
```

**Phase 3 — Remove redundant publicId fields (V1.1):**
- Drop `Booking.publicId` field + `booking_public_id_seq` sequence
- Drop `Order.publicId` field + `order_public_id_seq` sequence
- Drop `Invoice.publicId` field + `invoice_public_id_seq` sequence
- Remove `PUBLIC_ID_KIND.BOOKING`, `ORDER`, `INVOICE` from `identifier.constants.ts`

**Phase 4 — Sub-entity extraction (V1.1+):**
- Add `OrderAddOn` model replacing `Order.addOns` JSON
- Add `EditingJob` model extracting editing fields from `Order`
- Add `ProductionJob` model extracting production fields from `Order`
- Change `Order.deliveryCompletedBy String?` → `Order.deliveryCompletedById String?` (FK to User)

**Phase 5 — Canonical Job entity (V2):**
- Add `Job` model with `jobNumber UK`, `customerId FK`
- Add `jobId String FK → Job.id` to `Booking`, `Order`, `Invoice`, `Payment`
- Backfill `jobId` from existing `jobNumber` strings
- Deprecate then drop the propagated `jobNumber` string columns on downstream entities
