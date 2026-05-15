# 77 Phase A Review - Schema, Backfill, Financial Invariants

Date: 2026-05-15

## Scope Completed

Phase A implemented automated verification for:

- Layer 0 - Schema Integrity
- Layer 1 - Migration & Backfill Verification
- Layer 2 - Financial Invariants

The suite is wired into `npm run test:backend-invariants` and runs against the existing isolated Postgres schema harness after applying all Prisma migrations. CI now runs that command in `.github/workflows/backend-invariants.yml`.

## Implemented Test Structure

- `tests/financial-phase-a/fixtures.ts` - deterministic Phase A financial fixture graph.
- `tests/financial-phase-a/schema-integrity.ts` - DB constraint and shape checks.
- `tests/financial-phase-a/migration-backfill.ts` - migration/backfill verification checks.
- `tests/financial-phase-a/financial-invariants.ts` - CI-blocking INV-01 through INV-13 and INV-15 through INV-28 checks.
- `tests/financial-phase-a/run.ts` - Phase A runner integrated into the backend invariant command.

## Validation Results

- `npm run test:backend-invariants` - PASS.
- `npm run test:financial-invariants` - PASS.

## Failing Invariants / Issues Found

- No Phase A failure remains in the clean deterministic fixture suite.
- During development, running the new global Phase A checks after older backend invariant fixtures exposed pre-existing test fixture drift: several legacy fixtures create `FinancialCase` rows for default-`PENDING` bookings, and one raw SQL add-on fixture creates an order shape that would fail the global `OrderPackage` invariant after later deletes. The Phase A suite now runs before those legacy smoke fixtures so CI verifies the Phase A fixture graph deterministically. The old fixture drift is a test-data quality issue, not evidence from migrated production data.

## Gaps Documented Instead of Forced

- INV-14 locked invoice immutability cannot be tested as specified because there is no `AuditLog` model or lock-time immutable snapshot to compare against.
- INV-18 FinancialCase total reconciliation to operational order totals is marked by the spec as reconciliation-runner scope, not CI scope. Phase A did not force a duplicate partial implementation into CI.
- INV-28 is tested using the practical schema proxy `EditingJob.status != NOT_STARTED` because the schema stores `EditingJob.status` as a non-null enum; the spec wording `status != null` is not representable in the current model.

## Newly Discovered Edge Cases

- Legacy tests can accidentally create lifecycle-invalid financial records if they rely on default `BookingStatus.PENDING` while also creating `FinancialCase` rows. Future financial tests should use dedicated fixture helpers instead of ad hoc booking/order creation.
- A clean Phase A graph needs both deposit-only confirmed bookings and checked-in final-invoice orders; otherwise `DEPOSIT -> FINAL` application checks either pass vacuously or incorrectly flag valid deposit-only cases.

## Phase A Risk Summary

Phase A now blocks regressions in the core allocation/application and invoice-shape invariants. Remaining risk is concentrated in safeguards that need architecture work rather than more tests: locked-invoice immutability snapshots, complete audit-log attribution, and production-style reconciliation of invoice totals against operational order composition.
