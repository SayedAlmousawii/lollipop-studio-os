## Goal

Split the overloaded `OrderAddOn` model into two semantically distinct tables: `OrderAddOn` (true add-ons referencing a product) and `OrderPackageItemUpgrade` (package-item upgrades referencing a snapshotted package item). This is a three-step spec — each step is independently revertable. All order flows work correctly throughout.

Depends on Spec 73 (schema groundwork). Must land before Spec 75a (Phase 2 adjustment automation), which needs clean upgrade vs add-on separation for its edit-classifier.

---

## Read First

- `prisma/schema.prisma` — current `OrderAddOn` model (post Spec 73)
- `src/modules/orders/order.service.ts` — the primary consumer; read the full file. Key areas:
  - Lines ~954–962: `deleteMany` using `packageItemId: { not: null }` — upgrade deletion via the add-on table
  - Lines ~1109–1163: `findFirst`/`update`/`create` using `packageItemId: currentItem.id` — upgrade upsert
  - Lines ~1265–1291: `orderAddOn.create` with `packageItemId` — upgrade creation
  - Lines ~1376–1400: `orderAddOn.findFirst`/`delete` with `packageItemId: null` — filtering at read time
  - Lines ~3241–3247: `mapStructuredAddOns` — splits the combined array by `packageItemId` presence at display time
- `src/modules/orders/order.types.ts` — `OrderAddOn` type + any `packageItemId` field references
- `src/modules/orders/order.schema.ts` — validation schemas referencing `packageItemId`
- `src/modules/invoices/invoice.service.ts` — reads `orderAddOns` for invoice line-item generation
- `src/modules/products/product.service.ts` — any `orderAddOn` / `packageItemId` references

---

## Rules

- Three steps; do not collapse them into one migration+service change
- After each step, all order flows (add-on creation, upgrade selection, POS, invoice generation) work correctly
- No data is ever in an inconsistent state between steps — both tables are valid and readable at all times during the transition
- `OrderAddOn.packageItemId` is NOT dropped until step 3, after all service code has been migrated
- The unique constraint on `OrderPackageItemUpgrade` is `(orderId, orderPackageId, packageItemId)` — same key that existed on `OrderAddOn`; no new constraints are invented

---

## Step 1 — Add `OrderPackageItemUpgrade` table (schema only)

**What changes:** Schema + migration only. `OrderAddOn` is completely unchanged. Service code is unchanged.

**New model:**
```prisma
model OrderPackageItemUpgrade {
  id             String   @id @default(cuid())
  orderId        String
  orderPackageId String
  packageItemId  String
  nameSnapshot   String
  priceSnapshot  Decimal  @db.Decimal(10, 3)
  quantity       Int      @default(1)
  notes          String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  order        Order        @relation(fields: [orderId], references: [id], onDelete: Cascade)
  orderPackage OrderPackage @relation(fields: [orderPackageId], references: [id], onDelete: Cascade)
  packageItem  PackageItem  @relation(fields: [packageItemId], references: [id], onDelete: Restrict)

  @@unique([orderId, orderPackageId, packageItemId])
  @@index([orderId])
  @@index([orderPackageId])
  @@index([packageItemId])
  @@map("order_package_item_upgrades")
}
```

Add the inverse relation on `Order`: `packageItemUpgrades OrderPackageItemUpgrade[]`

Add the inverse relation on `OrderPackage`: `packageItemUpgrades OrderPackageItemUpgrade[]`

Add the inverse relation on `PackageItem`: `orderUpgrades OrderPackageItemUpgrade[]`

**Verification (step 1):**
- Migration runs clean; `order_package_item_upgrades` table exists and is empty
- All existing order flows work unchanged — nothing reads or writes the new table yet
- `OrderAddOn` rows with `packageItemId` still exist and are used normally

---

## Step 2 — Migrate service code to use the correct table

**What changes:** Service, schema validation, and type files. No schema migration. Both tables exist; step 2 makes service code write/read each table correctly.

After this step, new upgrades write to `order_package_item_upgrades` and new true add-ons write to `order_add_ons`. Existing `OrderAddOn` rows with `packageItemId` (written before step 2) remain in the old table until step 3's backfill.

**Files to update:**

### `src/modules/orders/order.types.ts`
- Introduce `OrderPackageItemUpgrade` type (mirroring the Prisma-generated shape)
- Keep the existing `OrderAddOn` type but document it as "true add-ons only" going forward
- Update any union/intersection types that treat them as one

### `src/modules/orders/order.schema.ts`
- Any Zod input schema that accepts `packageItemId` for an add-on now routes to upgrade-specific paths
- True add-on inputs keep their existing shape (no `packageItemId` field)

### `src/modules/orders/order.service.ts`

**Read paths** — wherever `orderAddOns` is fetched, add a parallel fetch of `packageItemUpgrades`:

Prisma `include` blocks that currently include `orderAddOns: { select: { packageItemId: ... } }` need to also include:
```ts
packageItemUpgrades: {
  select: { id: true, packageItemId: true, nameSnapshot: true, priceSnapshot: true, quantity: true, notes: true, orderPackageId: true }
}
```

Update `mapStructuredAddOns` (line ~3158) and `mapPOSAddOns` (line ~395) to read from `order.packageItemUpgrades` for upgrade rows instead of filtering `orderAddOns` by `packageItemId === null`. The `filter(row => !row.packageItemId)` guard at line ~3247 is removed after read paths are corrected.

**Write paths — upgrades (currently writing to `orderAddOn`):**

- Line ~954: `tx.orderAddOn.deleteMany({ packageItemId: { not: null } })` → `tx.orderPackageItemUpgrade.deleteMany({ orderId: ... })`
- Lines ~1112–1163 (upgrade upsert):
  - `tx.orderAddOn.findFirst({ packageItemId: currentItem.id })` → `tx.orderPackageItemUpgrade.findFirst({ packageItemId: currentItem.id, orderId: ... })`
  - `tx.orderAddOn.update(...)` → `tx.orderPackageItemUpgrade.update(...)`
  - `tx.orderAddOn.create({ packageItemId: currentItem.id, ... })` → `tx.orderPackageItemUpgrade.create({ packageItemId: ..., orderPackageId: ..., ... })`
- Lines ~1265–1291 (upgrade creation): `tx.orderAddOn.create({ packageItemId: ... })` → `tx.orderPackageItemUpgrade.create(...)`

**Write paths — true add-ons (currently mixed in with upgrades):**

- Lines ~1376–1400 already filter for `packageItemId: null` (i.e. true add-ons). These can stay as-is — after the column is dropped in step 3, the filter becomes unnecessary, but it is not harmful now.

### `src/modules/invoices/invoice.service.ts`

Wherever `order.orderAddOns` is read to generate invoice line items, also read `order.packageItemUpgrades` and merge them into the line-item generation logic. The invoice line-item representation of an upgrade is the same as an add-on line — this is a read path change only.

### `src/modules/products/product.service.ts`

Audit any `orderAddOn` / `packageItemId` references and migrate to the correct table.

**Verification (step 2):**
- Create a new upgrade through the normal flow → row appears in `order_package_item_upgrades`, NOT in `order_add_ons`
- Create a new true add-on → row appears in `order_add_ons` with no `packageItemId`
- POS, invoice generation, and order summary all reflect upgrades and add-ons correctly
- Pre-existing `OrderAddOn` rows with `packageItemId` (from before this step) are still readable via the old path — no data loss

---

## Step 3 — Backfill, drop column, enforce constraints

**What changes:** Schema migration + data migration. All service code is already on the new table; this step cleans up the old data and enforces the new constraints.

**Data migration (in a transaction):**

1. Pre-flight assertion: `SELECT COUNT(*) FROM order_add_ons WHERE package_item_id IS NOT NULL` — capture this number (call it N).
2. Insert N rows into `order_package_item_upgrades` from `order_add_ons WHERE package_item_id IS NOT NULL`:
```sql
INSERT INTO order_package_item_upgrades
  (id, order_id, order_package_id, package_item_id, name_snapshot, price_snapshot, quantity, notes, created_at, updated_at)
SELECT
  gen_random_uuid()::text, order_id, order_package_id, package_item_id,
  name_snapshot, price_snapshot, quantity, notes, created_at, updated_at
FROM order_add_ons
WHERE package_item_id IS NOT NULL
ON CONFLICT (order_id, order_package_id, package_item_id) DO NOTHING;
-- ON CONFLICT handles rows that were re-created via Step 2 for the same order
```
3. Delete those rows from `order_add_ons`: `DELETE FROM order_add_ons WHERE package_item_id IS NOT NULL`
4. Post-flight assertion: `SELECT COUNT(*) FROM order_add_ons WHERE package_item_id IS NOT NULL` → 0

**Schema changes (same migration, after data migration):**

- Drop `OrderAddOn.packageItemId` column + its `@@index` + its `packageItem` relation
- Remove the old `@@unique([orderId, orderPackageId, packageItemId])` constraint
- Add new `@@unique([orderId, orderPackageId, productId])` on `OrderAddOn`
- Make `OrderAddOn.productId` NOT NULL
- Remove `OrderAddOn.orderPackage` relation and `orderPackageId` field if they are only used for the upgrade path (audit first — they may be valid for true add-ons too)

**Verification (step 3):**
- `SELECT COUNT(*) FROM order_add_ons WHERE package_item_id IS NOT NULL` → column no longer exists (query errors)
- `SELECT COUNT(*) FROM order_add_ons WHERE product_id IS NULL` → 0
- `SELECT COUNT(*) FROM order_package_item_upgrades` ≥ pre-migration N (may be higher due to step-2 rows already there)
- All order flows work — no code references `orderAddOn.packageItemId` anymore (verify with `grep -r packageItemId src/`)
- Upgrade creation, deletion, POS rendering, invoice generation all work correctly with only the new table

---

## Out of Scope

- Any change to how upgrades vs add-ons are priced or displayed beyond what is needed to read from the correct table
- Phase 2 adjustment automation (75a) — that spec uses the clean table structure established here
- Commission snapshot logic — unchanged; reads from the same snapshots

---

## Dependency note for Phase 2

Spec 75a (ADJUSTMENT invoice primitives) depends on 73c being complete. The adjustment edit-classifier must be able to distinguish "new true add-on added" from "new package-item upgrade selected" — that distinction is only clean once `OrderAddOn` and `OrderPackageItemUpgrade` are separate tables. Do not begin 75a until all three steps of 73c are merged.
