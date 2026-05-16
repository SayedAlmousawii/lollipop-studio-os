## Goal

Introduce a session-type-scoped pricing catalog for extra photos, split by media type (digital vs print). Replace the implicit single-product pricing (`product.id = "addon-extra-photo"`) with structured rows keyed by `(sessionTypeId, mediaType)`. Provide a service helper that returns the unit price for a given session type + media type combination, ready to be consumed by Spec 70's multi-package POS and invoice flows.

This spec adds the catalog and the lookup. It does **not** rewire existing invoice/order code to use the new lookup — that wiring happens in Spec 70, where Order and OrderPackage gain per-line digital/print counts and per-line session type.

---

## Read First

- `prisma/schema.prisma` — current `Product` model and `InvoiceLineType.EXTRA_PHOTOS`
- `context/feature-specs/67-package-taxonomy-foundation.md` — `SessionType` table
- `context/feature-specs/68-package-model-upgrade.md` — package-to-session-type linkage
- `src/modules/invoices/invoice.service.ts` — current `calculateExtraPhotoCharge` (around line 928) which reads a single `addon-extra-photo` product
- `context/reviews/package-arch.md` — sections 7 and 8 (extra-photo pricing rules)

---

## Rules

- Spec 67 must be merged first (depends on `SessionType`)
- Spec 68 must be merged first (depends on packages knowing their session type)
- Both digital and print prices are stored as **data**. There is no encoded business rule like "digital = print − 1 KD" in the codebase. The owner may set whatever digital price they want per session type.
- Pricing is per `(sessionTypeId, mediaType)` only. There is no package-level override. (Per owner answer to Q6.)
- Existing `calculateExtraPhotoCharge` in `invoice.service.ts` is left untouched in this spec — Spec 70 replaces it after Booking and Order gain per-line session type and per-line media-split counts.
- The legacy `product.id = "addon-extra-photo"` row stays in place during this spec to keep existing flows working. It is retired in Spec 70.
- Pricing changes do not retroactively change locked invoices (existing invariant). The lookup is only used at invoice line creation time.

---

## Scope

### In Scope

- Add `MediaType` enum (`DIGITAL`, `PRINT`)
- Add `SessionTypeExtraPhotoPricing` model
- Seed one row per `(sessionTypeId, mediaType)` combination — 11 session types × 2 media types = 22 rows
- Add service helper `getExtraPhotoUnitPrice(sessionTypeId, mediaType)`
- Add admin read-only list view of the pricing catalog (no edit UI in this spec — pricing is edited via seed updates until a CRUD need emerges, matching the pattern from Specs 25 / 67)

### Out of Scope

- Replacing `calculateExtraPhotoCharge` with the new lookup (Spec 70)
- Splitting `Order.selectedPhotoCount` into digital + print counts (Spec 70)
- Adding `OrderPackage` and wiring extra photos per package (Spec 70)
- Admin CRUD UI for managing pricing rows
- Retiring the `addon-extra-photo` product row (Spec 70)
- Adding `extraPhotoCount` / digital / print fields anywhere on Order or OrderPackage (Spec 70)

---

## Data Model

### MediaType enum (new)

```prisma
enum MediaType {
  DIGITAL
  PRINT
}
```

### SessionTypeExtraPhotoPricing model (new)

```prisma
model SessionTypeExtraPhotoPricing {
  id            String    @id @default(cuid())
  sessionTypeId String
  mediaType     MediaType
  unitPrice     Decimal   @db.Decimal(10, 3)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  sessionType SessionType @relation(fields: [sessionTypeId], references: [id])

  @@unique([sessionTypeId, mediaType])
  @@index([sessionTypeId])
  @@map("session_type_extra_photo_pricing")
}
```

Update `SessionType` to add the back-relation:

```prisma
model SessionType {
  // existing fields from Spec 67...
  extraPhotoPricing SessionTypeExtraPhotoPricing[]
}
```

Notes:

- `unitPrice` uses `Decimal(10, 3)` — matches the precision used across the financial schema (Package.price, Invoice.totalAmount, etc.).
- The `@@unique([sessionTypeId, mediaType])` constraint guarantees exactly one price per combination — the upsert key for the seed and any future admin updates.

---

## Seed Data

Seed 22 rows — one per `(sessionType, mediaType)` combination. The owner has not provided final prices yet. Use placeholder values now and flag the seed file for owner review before Spec 70 ships:

- Print unit price: `3.000` KD for all session types (placeholder)
- Digital unit price: `2.000` KD for all session types (placeholder, matches the "digital = print − 1 KD" current heuristic but stored as data, not computed)

The seed must be idempotent: upsert on `(sessionTypeId, mediaType)`.

Include a comment in the seed file:

```text
// PLACEHOLDER PRICES — owner to confirm per-session-type values before Spec 70 ships.
// Digital is intentionally stored as an independent number, not computed from print.
```

---

## Service Layer

New module: `src/modules/pricing/` (or add to existing packages module if a pricing module does not exist).

Files:

- `pricing.service.ts` — exposes `getExtraPhotoUnitPrice(sessionTypeId: string, mediaType: MediaType): Promise<Decimal>`
- `pricing.types.ts` — return type definitions

Behavior:

- `getExtraPhotoUnitPrice` queries `SessionTypeExtraPhotoPricing` by the unique key. Throws if no row exists for the requested combination (this should be impossible given seeded data; treat absence as a programming error, not a runtime case to recover from).
- Result is a Prisma `Decimal`, consistent with the rest of the financial code.
- No caching layer in this spec.

This helper is **not consumed** by any existing service in this spec. Spec 70 introduces the call sites.

---

## UI Requirements

### Pricing Catalog (read-only)

Add a single page under the existing admin section showing the pricing catalog. Columns:

- Department
- Session Type
- Media Type (Digital / Print)
- Unit Price (KD)

Group by Department → Session Type for readability. No edit affordances. Header text: "Extra-photo prices are seeded. Contact engineering to update."

This is a low-effort read-only surface so the owner can verify the seeded prices without running SQL. CRUD UI is deferred until the owner asks for it.

---

## Acceptance Criteria

- `MediaType` enum exists in Prisma
- `SessionTypeExtraPhotoPricing` model exists with unique `(sessionTypeId, mediaType)`
- Migration runs cleanly on a reset dev database
- Seed creates exactly 22 rows (one per session type per media type) with the placeholder prices
- Re-running the seed is idempotent (upsert on `(sessionTypeId, mediaType)`)
- `getExtraPhotoUnitPrice(sessionTypeId, mediaType)` returns the correct `Decimal` value for each seeded combination
- `getExtraPhotoUnitPrice` throws a clear error if called with a non-existent combination
- Read-only admin page lists all 22 rows grouped by department + session type
- Existing `calculateExtraPhotoCharge` in `invoice.service.ts` is unchanged and continues to use the `addon-extra-photo` product
- `npx prisma validate` passes
- `npm run build` passes
- `npm run lint` passes
- `context/progress-tracker.md` is updated

---

## Decisions

- **Pricing is data, not computation.** The current real-world heuristic is "digital = print − 1 KD," but storing both values independently means tomorrow's owner can break that relationship without a code change. The seed comment makes the relationship visible without encoding it.
- **No package-level price override.** Per owner Q6 answer — pricing is per session type only. Adding an override column now would invite YAGNI complexity.
- **`MediaType` is an enum, not a table.** Digital vs print is a closed two-value set. An enum is correct; a table would be over-engineering.
- **No call sites changed in this spec.** Spec 70 is already going to be the largest change in the series. Keeping Spec 69 to pure foundation (table + lookup + read-only display) means Spec 70 can wire the lookup in confidently against tested infrastructure.
- **Read-only admin page included.** Without it, the owner has no way to verify the seeded prices until POS shows them in Spec 70. Cheap to build, removes a blind spot.
- **Pricing module is new.** Currently no dedicated module owns pricing rules. Creating `modules/pricing/` now sets up a home for future pricing logic (package-level overrides, time-based price changes, etc.) without polluting the orders or invoices module.

---

## Assumptions

- Owner will confirm or revise the placeholder prices before Spec 70 ships. The seed file is the single source — no spreadsheet or external doc to maintain.
- Extra photos remain the only session-type-scoped pricing dimension in V1. If add-ons later need session-type pricing too, that gets its own spec and table (or extends this module).
- Decimal precision of `(10, 3)` is sufficient — matches every other money column in the schema.
