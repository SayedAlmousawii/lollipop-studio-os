## Goal

Make `OrderPackage` the operational source of truth for package identity by splitting today's single `packageId` into `originalPackageId` (immutable per line) and `currentPackageId` (mutable). Re-point every reader so the order header, composition snapshots, and POS workspace stop conflating original and current package. No workspace finalize behavior changes — invoice-line replay still drives locked-view composition. This spec is mechanical schema + read-layer plumbing.

## Read First

- `context/reviews/adjustment_workspace_operational_state_architecture_plan.md`
- `context/reviews/orders-package-source-of-truth-review.md`
- `prisma/schema.prisma` — `OrderPackage`, `BookingPackage`, `Order`
- `src/modules/orders/order.service.ts` — `mapOrderRow`, `updateOrderPackage`, `getPOSWorkspace`
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts` — `captureCurrentOrderComposition`
- `src/modules/orders/composition/` — every projector that reads `orderPackage.package`

## Rules

- Destructive migration is acceptable. No real production data exists; dev resets bookings/orders between spec tests. Update seed/demo data and test fixtures in the same change.
- `originalPackageId` and `currentPackageId` are both required (non-null) on every `OrderPackage` row.
- `bookingPackageId` is a nullable FK to support future order-only package additions that have no booking line.
- Pre-lock package swaps mutate `currentPackageId` and `currentPackageNameSnapshot` only. They must never write `originalPackageId` after the row is created.
- Original package identity is derived at `OrderPackage` creation time from the `BookingPackage` that seeded the line. For lines added later without a booking origin, `originalPackageId = currentPackageId` at creation.
- `finalPackagePriceSnapshot` is intentionally initialized at `OrderPackage` creation to match `originalPackagePriceSnapshot`. `null` no longer means "no package swap yet"; original/current package identity and original/final package price snapshots are symmetric at creation.
- No workspace finalize logic changes in this spec. Adjustment invoice replay (`applySignedInvoiceLines`) continues to drive locked composition.

## Scope

### In Scope

- Schema: drop `OrderPackage.packageId` and the single `package` relation. Add `originalPackageId` (FK, not null), `currentPackageId` (FK, not null), `bookingPackageId` (FK, nullable), `originalPackageNameSnapshot` (String, not null), `currentPackageNameSnapshot` (String, not null). Replace the `package` Prisma relation with `originalPackage` and `currentPackage` relations. Keep `originalPackagePriceSnapshot` and `finalPackagePriceSnapshot` untouched.
- Destructive Prisma migration that drops and recreates the affected columns.
- Order creation path: seed both identity fields and `bookingPackageId` from the originating `BookingPackage`.
- `updateOrderPackage`: write `currentPackageId` and `currentPackageNameSnapshot`. Leave `originalPackageId` alone.
- `mapOrderRow`: `originalPackageName` derived from `originalPackageNameSnapshot` aggregation, `finalPackageName` from `currentPackageNameSnapshot`. The header bug is fixed here.
- `captureCurrentOrderComposition` and every composition projector: read `currentPackageId` / `currentPackageNameSnapshot` for the "current" package line. Use `originalPackageId` / `originalPackageNameSnapshot` anywhere "original" is shown.
- POS workspace reader: read `currentPackageId` for the active package, `originalPackageId` for any "originally booked" display.
- Seed data, demo data generator, and any test factory that constructs `OrderPackage` directly.

### Out of Scope

- Workspace finalize behavior. Adjustment invoice replay still drives locked-view composition.
- New `OrderActivity` types for workspace materialization.
- `AdjustmentWorkspace.operationalStateAppliedAt` idempotency flag (next spec).
- `OrderPackageChange` / `UpgradeRecord` ledger.
- Any change to `OrderAddOn`, `OrderPackageItemUpgrade`, or `OrderPackageSessionConfigurationSelection`.

## Implementation Direction

Land the schema change first as a single destructive Prisma migration. Replace the existing `package` relation on `OrderPackage` with two relations (`originalPackage`, `currentPackage`) and the matching name-snapshot columns. The unique constraint and indexes that referenced `packageId` should be migrated to whichever identity column they semantically targeted — most "find package on this order" indexes target current state, so prefer `currentPackageId` for those; add a separate index on `originalPackageId` only if a reader needs it.

The widest read-layer touch is everywhere the Prisma include uses `package: true` on `OrderPackage`. Each call site must be audited and routed to either `originalPackage` or `currentPackage` based on the surface's intent — order header card original vs current, POS package selector, composition projectors, captured snapshot. Use the `formatOrderPackageNames` pattern but feed it the correct field; do not collapse both sides into one helper.

Order creation today builds `OrderPackage` rows from `BookingPackage`. Extend that flow to capture `bookingPackageId`, `originalPackageId`, `originalPackageNameSnapshot` at the same time. Any code path that creates an `OrderPackage` outside the booking flow (if any exists today; verify) must default `originalPackageId = currentPackageId` and `bookingPackageId = null`.

At row creation, initialize `finalPackagePriceSnapshot` to the same package price as `originalPackagePriceSnapshot`. This preserves symmetric row semantics: original/current package identity starts equal, and original/final package price starts equal.

`updateOrderPackage` must keep the deletion of `OrderPackageItemUpgrade` rows on package swap (current behavior). It only changes which field it writes for identity.

For composition projectors, the rule is: "current package line shown to the user" reads `currentPackage*` fields; "originally booked package" reads `originalPackage*` fields. `captureCurrentOrderComposition` produces lines labeled with the current package name and `refId = currentPackageId`. This matches what the locked view should ultimately show, since workspace finalize for swaps still produces invoice deltas (replayed by the projection).

`BookingPackage.@@unique([bookingId, packageId])` is left alone for this spec but should be flagged in the spec PR description if it conflicts with future multi-package-of-same-id needs.

## Post-Implementation

- Update `context/architecture-context.md` if it documents the old `OrderPackage.packageId` shape.
- Update `context/target-data-model.md` to reflect the new identity fields.
- Update `context/progress-tracker.md` Now / Key State.

## Acceptance Criteria

- A package swap (pre-lock) on an `OrderPackage` line preserves `originalPackageId` and `originalPackageNameSnapshot`; `currentPackageId` and `currentPackageNameSnapshot` reflect the new package.
- Order header / detail page shows distinct original vs current package names after a pre-lock swap, regardless of whether the order has any invoice yet.
- Composition projectors (Overview deliverables, locked POS, production deliverables) all read the current-package fields for the active line and continue to render correctly for orders with no workspace activity.
- No call site imports `orderPackage.package` (the old single relation) anywhere in `src/`.
- Seed data and demo data generator produce orders whose `originalPackageId == currentPackageId` at creation, and whose `bookingPackageId` is set when seeded from a booking.
- All existing tests pass after fixture updates; no test relies on `OrderPackage.packageId`.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
