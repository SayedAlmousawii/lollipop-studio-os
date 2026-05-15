# 77 Architecture Gap Analysis

## How to update this document

Append architecture findings under the relevant section as review phases complete. Keep one finding per bullet or short subentry, include the affected files or services when known, and leave untouched sections marked with `TBD - to be filled during Phase A/B/C/etc.` until reviewed.

## A. Architecture Inconsistencies

### Modules owning the same data

TBD - to be filled during Phase A/B/C/etc.

### Duplicate financial formula implementations

TBD - to be filled during Phase A/B/C/etc.

## B. Overly Complex Flows

### Flows requiring more than 3 service calls for a single user action

TBD - to be filled during Phase A/B/C/etc.

### Business logic leaked into API handlers or components

TBD - to be filled during Phase A/B/C/etc.

## C. Maintainability Concerns

### Files larger than 300 lines that mix multiple concerns

TBD - to be filled during Phase A/B/C/etc.

### Invariant checks scattered instead of centralized

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: Phase A adds a dedicated `tests/financial-phase-a/` runner with reusable schema, migration, and invariant check modules. Existing service-level invariants remain in `src/modules/financial/invariants.ts`, so there are still two verification surfaces: runtime/service invariants and CI query invariants.

## D. Cleanup Recommendations

### Retired code paths that should be deleted

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: No retired production code paths were deleted in this phase. Legacy backend test fixtures should be normalized in a later cleanup so they no longer create financial cases for default-`PENDING` bookings.

### Deprecated fields that are still read

TBD - to be filled during Phase A/B/C/etc.

### Legacy fallback paths that can now be removed

TBD - to be filled during Phase A/B/C/etc.

## E. Future Scalability Concerns

### Single-allocation invariant and future multi-tranche payments

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: CI now enforces exactly one `PaymentAllocation` per `Payment`. This intentionally locks the current single-allocation architecture and should be revisited before any future multi-tranche allocation feature.

### `identifier_sequences` partitioning strategy for high volume

TBD - to be filled during Phase A/B/C/etc.

### Shared invoice number sequence and audit isolation concerns

TBD - to be filled during Phase A/B/C/etc.

## F. Auditability Concerns

### Financial actions creating `AuditLog` entries with full context

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: No `AuditLog` schema exists, which prevents exact locked-invoice immutability verification and full financial action audit coverage.

### `actorUserId` gap status on audit-critical services

TBD - to be filled during Phase A/B/C/etc.

### Invoice closure attribution gap

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: Invoice closed/locked state is asserted, but closure attribution remains outside the schema-level invariant suite because there is no dedicated audit snapshot/actor record to join.
