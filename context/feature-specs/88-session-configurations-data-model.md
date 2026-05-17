# 88 — Session Configurations: Data Model & Migrations

## Goal

Introduce the persistence layer for a new first-class entity, **Session Configurations** — contextual operational and/or financial modifiers (twins, age range, cake, t-shirt, weekend surcharge, etc.) that attach to a session type and are selected per `OrderPackage` during order setup.

This spec **only** lays the schema, enums, and migration scaffolding. No CRUD UI, no pricing engine wiring, no order-page integration — those land in specs 89–93. After this spec the tables exist, are queryable, and can hold definition + selection rows, but nothing in the running app reads or writes them yet.

## Read First

- `context/reviews/session-config-plan.md` — owner-facing plan summarising the feature and the agreed direction.
- [prisma/schema.prisma:401-421](prisma/schema.prisma#L401-L421) — `SessionType` model; configurations FK to this.
- [prisma/schema.prisma:344-363](prisma/schema.prisma#L344-L363) — `Product` model; linked-product configs FK to this.
- [prisma/schema.prisma:564-588](prisma/schema.prisma#L564-L588) — `OrderPackage` model; selections FK to this (one Configure Session panel per package card).
- [prisma/schema.prisma:661-678](prisma/schema.prisma#L661-L678) — `AuditLog` model; post-lock operational edits use this (no new audit entity).
- [prisma/migrations/20260517030000_session_type_admin_crud](prisma/migrations/20260517030000_session_type_admin_crud) — most recent comparable migration; copy its file layout and SQL style.
- [prisma/migrations/20260516010000_audit_log_model](prisma/migrations/20260516010000_audit_log_model) — reference for adding a new `AuditEntityType` enum value.

## Rules

- **Schema only.** Do not touch any service, loader, page, component, or seed beyond what the migration itself requires. Specs 89+ wire behavior.
- **Snapshot-at-selection is non-negotiable.** Selection rows must carry their own snapshot columns (`snapshotConfigurationCode`, `snapshotLabel`, `snapshotPriceDelta`, `snapshotFinancialBehavior`, `snapshotInputType`, `snapshotPricingMode`, optional linked-product snapshots). Never compute or read these from the definition tables at order-read time. This is the only way later admin edits to a configuration cannot retroactively mutate historical orders. Adding a code path that reads price/label from `session_configurations` for an existing selection is a review-blocker.
- **`snapshotInputType` is required (non-nullable).** Consuming code (specs 89, 91, 93) must use it as the single source of truth when deciding whether to read `optionId`, `numericValue`, or `textValue` from a selection row. The live `SessionConfiguration.inputType` must never be used for this dispatch on an existing selection, because it can have drifted since selection time.
- **`snapshotConfigurationCode` is required (non-nullable).** Carries the configuration's `code` at selection time for historical reporting, debugging, and audit-log readability — so a deleted-or-renamed configuration's selections remain interpretable from the selection row alone, without joining back to a possibly-stale definition row.
- **Selections attach to `OrderPackage`, not `Order`.** The Configure Session button lives on each package card; an order with two packages may have two independent selection sets.
- **`is_active` soft-delete only.** Definition rows are never hard-deleted. Inactive rows must remain resolvable so historical `OrderPackage`s render correctly.
- **Decimal precision matches existing money columns:** `Decimal @db.Decimal(10, 3)` for KD amounts. No floats.
- **No foreign-key cascade on delete from `session_configurations` or `session_configuration_options` to selection rows.** Selections are independent records once snapshotted. Use `onDelete: Restrict` so an admin can never delete a config that still has selections — they must deactivate.
- **One selection row per (order_package_id, configuration_id).** Re-selecting overwrites the same row (updated snapshot fields, new `updatedAt`). Enforced by `@@unique`.
- **The migration is greenfield.** No data backfill, no rename of existing tables. Down-migration drops the three new tables and removes the new enum values cleanly.
- **Migration naming:** `20260518020000_session_configurations_data_model` (next slot after today's existing `20260518010000_*`).

## Scope

### In Scope

- New Prisma models in [prisma/schema.prisma](prisma/schema.prisma):
  - `SessionConfiguration` — definition row.
  - `SessionConfigurationOption` — child rows for `select` / tiered configurations.
  - `OrderPackageSessionConfigurationSelection` — per-order-package snapshotted selection.
- New Prisma enums:
  - `SessionConfigurationInputType` — `TOGGLE | SELECT | NUMBER | TEXT | COUNTER`.
  - `SessionConfigurationPricingMode` — `NONE | FIXED | TIERED | LINKED_PRODUCT`.
  - `SessionConfigurationFinancialBehavior` — `OPERATIONAL | FINANCIAL`.
  - `SessionConfigurationLinkProductDisplay` — `LINE_ITEM | MODIFIER_ONLY` (nullable on the model; only set when `pricingMode = LINKED_PRODUCT`).
  - `SessionConfigurationCounterPricingMode` — `PER_UNIT | TIERED` (nullable; only set when `inputType = COUNTER` and `pricingMode != NONE`).
- New value on the existing `AuditEntityType` enum:
  - `ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION` — so spec 92 can audit post-lock operational edits without inventing a new audit entity.
- Relation wiring:
  - `SessionType.configurations: SessionConfiguration[]` back-relation.
  - `Product.linkedSessionConfigurations: SessionConfiguration[]` back-relation (nullable FK from config → product).
  - `OrderPackage.sessionConfigurationSelections: OrderPackageSessionConfigurationSelection[]` back-relation.
- A single migration directory `prisma/migrations/20260518020000_session_configurations_data_model/migration.sql` containing:
  - All three `CREATE TABLE` statements.
  - All five new enum types.
  - The added `ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION` value on `AuditEntityType` (use `ALTER TYPE ... ADD VALUE` — Postgres-safe).
  - All indexes and unique constraints listed below.
- A short note appended to `context/architecture-summary.md` describing the new tables and that selections snapshot pricing.

### Out of Scope

- Any service, query, mutation, server action, loader, route, or page that reads or writes the new tables. Specs 89+.
- Any UI: admin CRUD page, Configure Session panel, summary chip, invoice surfacing. Specs 89, 91, 93.
- Pricing engine integration (totals, invoice generation gate). Spec 90.
- Adjustment Workspace integration. Spec 92.
- Seed data and demo configurations. Optional follow-up; not required for this spec.
- Permissions / role gates on the not-yet-existent admin page.

## Implementation Direction

### 1. Model shapes

Add the following Prisma models. Field comments are illustrative — keep schema clean, do not include them in the actual file unless they explain a non-obvious invariant.

```prisma
model SessionConfiguration {
  id                  String                                @id @default(cuid())
  code                String                                @unique
  name                String
  sessionTypeId       String
  inputType           SessionConfigurationInputType
  pricingMode         SessionConfigurationPricingMode
  financialBehavior   SessionConfigurationFinancialBehavior
  required            Boolean                               @default(false)
  isActive            Boolean                               @default(true)
  sortOrder           Int                                   @default(0)

  // Pricing-mode-dependent fields. All nullable; populated only when relevant.
  fixedPriceDelta     Decimal?                              @db.Decimal(10, 3)
  linkedProductId     String?
  linkProductDisplay  SessionConfigurationLinkProductDisplay?
  counterPricingMode  SessionConfigurationCounterPricingMode?
  counterUnitPrice    Decimal?                              @db.Decimal(10, 3)

  createdAt           DateTime                              @default(now())
  updatedAt           DateTime                              @updatedAt

  sessionType         SessionType                           @relation(fields: [sessionTypeId], references: [id], onDelete: Restrict)
  linkedProduct       Product?                              @relation(fields: [linkedProductId], references: [id], onDelete: Restrict)
  options             SessionConfigurationOption[]
  selections          OrderPackageSessionConfigurationSelection[]

  @@index([sessionTypeId, isActive, sortOrder])
  @@index([linkedProductId])
  @@map("session_configurations")
}

model SessionConfigurationOption {
  id              String   @id @default(cuid())
  configurationId String
  label           String
  value           String
  priceDelta      Decimal  @db.Decimal(10, 3) @default(0)
  sortOrder       Int      @default(0)
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  configuration SessionConfiguration @relation(fields: [configurationId], references: [id], onDelete: Restrict)
  selections    OrderPackageSessionConfigurationSelection[]

  @@unique([configurationId, value])
  @@index([configurationId, isActive, sortOrder])
  @@map("session_configuration_options")
}

model OrderPackageSessionConfigurationSelection {
  id                          String   @id @default(cuid())
  orderPackageId              String
  configurationId             String
  optionId                    String?
  numericValue                Decimal? @db.Decimal(10, 3)
  textValue                   String?

  snapshotConfigurationCode   String
  snapshotLabel               String
  snapshotPriceDelta          Decimal  @db.Decimal(10, 3) @default(0)
  snapshotFinancialBehavior   SessionConfigurationFinancialBehavior
  snapshotInputType           SessionConfigurationInputType
  snapshotPricingMode         SessionConfigurationPricingMode
  snapshotLinkedProductId     String?
  snapshotLinkProductDisplay  SessionConfigurationLinkProductDisplay?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  orderPackage  OrderPackage                @relation(fields: [orderPackageId], references: [id], onDelete: Cascade)
  configuration SessionConfiguration        @relation(fields: [configurationId], references: [id], onDelete: Restrict)
  option        SessionConfigurationOption? @relation(fields: [optionId], references: [id], onDelete: Restrict)

  @@unique([orderPackageId, configurationId])
  @@index([orderPackageId])
  @@index([configurationId])
  @@index([snapshotLinkedProductId])
  @@map("order_package_session_configuration_selections")
}
```

Notes:
- `onDelete: Cascade` on `orderPackage` is intentional — if an order package is deleted, its selections go with it. All other FKs are `Restrict`, protecting definition rows from accidental delete while live selections exist.
- The three optional value columns (`optionId`, `numericValue`, `textValue`) cover all five input types; the consuming code (spec 89/91) decides which one to populate based on `snapshotInputType`. Do **not** add a DB-level CHECK constraint enforcing exactly-one — selection rows for `TOGGLE` legitimately have all three null (the row's existence is the "on" state).
- Toggle "on" = row exists; toggle "off" = row absent. No boolean column needed.

### 2. Enum additions

Add the five new enums adjacent to the existing enum block in `schema.prisma`. Append a new value to `AuditEntityType` rather than redefining it.

### 3. Back-relations

Edit existing models to add the back-relation arrays:
- `SessionType` → add `configurations SessionConfiguration[]`.
- `Product` → add `linkedSessionConfigurations SessionConfiguration[]`.
- `OrderPackage` → add `sessionConfigurationSelections OrderPackageSessionConfigurationSelection[]`.

No other field on these models changes.

### 4. Migration SQL

Generate the migration with `npx prisma migrate dev --name session_configurations_data_model --create-only`, then inspect the generated SQL before applying. Verify:
- New enum types are created before the tables that reference them.
- `ALTER TYPE "AuditEntityType" ADD VALUE 'ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION'` is present (Prisma should produce this automatically; if not, hand-edit).
- All three `@@index` declarations show up as `CREATE INDEX`.
- Unique constraints are emitted as `UNIQUE INDEX` on `(configurationId, value)` and `(orderPackageId, configurationId)`.

Run `npx prisma migrate dev` after the inspection to apply.

### 5. Architecture summary update

Append to `context/architecture-summary.md` a short subsection ("Session Configurations") naming the three tables, that they are session-type-scoped, and that selections snapshot pricing/labels at write time. One short paragraph — point readers at specs 89+ for behavior.

## Observability Checklist

### Dashboards / Metrics

- None this phase. Tables are unused by application code until spec 89.

### Rollback Plan

- Down-migration: drop the three tables, then `DROP TYPE` the five new enums. The added `AuditEntityType` value cannot be cleanly removed in Postgres without rebuilding the enum; the down-migration leaves the new value present and unused, which is harmless (no rows ever wrote it).
- No flag (no runtime code path uses the tables yet).
- Non-recoverable data: none — greenfield tables with zero rows on rollback.

### Customer-Visible Surface

- None. Staff and customers see no change from this spec.

## Post-Implementation

- Update `context/architecture-summary.md` per the in-scope note above.
- Update `context/progress-tracker.md`.
- Do **not** archive `context/reviews/session-config-plan.md`; it remains the source plan for specs 89–93.

## Acceptance Criteria

- `prisma/schema.prisma` contains the three new models and the five new enums exactly as specified, plus the appended `AuditEntityType` value.
- The `OrderPackageSessionConfigurationSelection` model declares `snapshotInputType` and `snapshotConfigurationCode` as **non-nullable** columns. A schema review check (grep) confirms neither field carries a `?` modifier.
- Back-relations exist on `SessionType`, `Product`, and `OrderPackage`. No other field on these three models is modified.
- `prisma/migrations/20260518020000_session_configurations_data_model/migration.sql` exists, creates the three tables, creates the five enums, and contains the `ALTER TYPE "AuditEntityType" ADD VALUE` statement.
- `npx prisma migrate dev` applies cleanly on a fresh database.
- `npx prisma migrate reset` followed by `npx prisma migrate dev` applies the full history cleanly (validates ordering vs. prior migrations).
- A grep for `SessionConfiguration` across `src/`, `app/`, and `prisma/seed.ts` returns hits **only** in `prisma/schema.prisma` and (generated) `node_modules/.prisma/` — confirming no production code consumes the tables yet.
- `npx prisma generate` succeeds and produces typed client bindings for the three new models.
- `npm run build` passes.
- `npm run lint` passes.
