# 77 Architecture Gap Analysis

## How to update this document

Append architecture findings under the relevant section as review phases complete. Keep one finding per bullet or short subentry, include the affected files or services when known, and leave untouched sections marked with `TBD - to be filled during Phase A/B/C/etc.` until reviewed.

## A. Architecture Inconsistencies

### Modules owning the same data

TBD - to be filled during Phase A/B/C/etc.

### Duplicate financial formula implementations

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase D: Canonical effective-paid math is centralized in `src/modules/invoices/invoice.calculation.ts`, but duplicate balance-display formulas remain in `src/modules/orders/order.service.ts`. `calculateFinalBalanceDue` and `mapPOSInvoiceSummary` subtract Deposit paid amount from Final Invoice values instead of relying on canonical `DocumentApplication`-backed `remainingAmount`.

## B. Overly Complex Flows

### Flows requiring more than 3 service calls for a single user action

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase B: INT-12 confirms the operational refund workflow must call the combined `issueRefundWithPayment` service to create both REFUND invoice and OUT payment atomically. Calling `createRefundInvoice` alone is a document primitive and does not satisfy the full workflow matrix.
- 2026-05-15 Phase C: Refund architecture needs a distinct overpayment-cap service. `createRefundInvoice` currently caps against inbound allocations, which is not equivalent to refundable credit after CREDIT_NOTE issuance.
- 2026-05-15 Phase E: POS settlement currently requires staff to pay the Final Invoice in POS, leave POS for the invoice list, manually close/lock the invoice, then return to POS for ADJUSTMENT behavior. Full payment and final locking should be one settlement operation.

### Business logic leaked into API handlers or components

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase D: No new API/component financial write paths were added. Static regression checks found payment creation remains centralized in `src/modules/payments/payment.service.ts`; invoice document application writes remain in `src/modules/invoices/invoice.service.ts`.

## C. Maintainability Concerns

### Files larger than 300 lines that mix multiple concerns

TBD - to be filled during Phase A/B/C/etc.

### Invariant checks scattered instead of centralized

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: Phase A adds a dedicated `tests/financial-phase-a/` runner with reusable schema, migration, and invariant check modules. Existing service-level invariants remain in `src/modules/financial/invariants.ts`, so there are still two verification surfaces: runtime/service invariants and CI query invariants.
- 2026-05-15 Phase B: Layer 3 integration assertions now live in `tests/financial-phase-b/`, while Phase A query invariants remain in `tests/financial-phase-a/`. This keeps phase scope clear, but financial verification is now split across runtime invariants plus Phase A and Phase B CI suites.
- 2026-05-15 Phase C: Layer 4 assertions now live in `tests/financial-phase-c/`. The split is still manageable, but financial verification now spans Phase A query checks, Phase B service workflows, Phase C edge cases, and runtime invariants.
- 2026-05-15 Phase D: Layer 5 assertions now live in `tests/financial-phase-d/` and are wired into the backend invariant runner after Phase C. The verification surface is intentionally phase-organized, but regression ownership now spans four phase folders plus runtime invariants.

## D. Cleanup Recommendations

### Retired code paths that should be deleted

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: No retired production code paths were deleted in this phase. Legacy backend test fixtures should be normalized in a later cleanup so they no longer create financial cases for default-`PENDING` bookings.
- 2026-05-15 Phase D: `calculateFinalBalanceDue`, `mapPOSInvoiceSummary` deposit subtraction, `hasBasePayment`, and `REQUIRED_BASE_PAYMENT_AMOUNT` should be retired or rewritten to consume canonical invoice balances/applications. REG-LEGACY-01 keeps this path visible until corrected.

### Deprecated fields that are still read

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase D: No active `PaymentType.BASE` enum usage remains, but base-payment terminology still drives workflow readiness helpers in `src/modules/orders/order.service.ts`.

### Legacy fallback paths that can now be removed

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase D: Locked-edit dual-read discrepancy logging still fires in adjustment/credit-note classifier workflows even though the new path succeeds. Pure invoice reads do not emit the warning. Release gates should distinguish this known dual-read cleanup need from real data corruption.
- 2026-05-15 Phase E: The live locked-edit flow still emits `financial.rearch.dual_read.discrepancy` logs during valid ADJUSTMENT and manager-required CREDIT_NOTE attempts. This is now visible during normal manual POS use and should be cleaned up before log-based operational monitoring is trusted.

## E. Future Scalability Concerns

### Single-allocation invariant and future multi-tranche payments

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: CI now enforces exactly one `PaymentAllocation` per `Payment`. This intentionally locks the current single-allocation architecture and should be revisited before any future multi-tranche allocation feature.
- 2026-05-15 Phase C: EC-37 confirms payment race safety is still app-layer balance checking without row-level invoice locks. This should be revisited before higher-volume POS usage or multi-tranche allocation support.

### `identifier_sequences` partitioning strategy for high volume

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase C: EC-42 verifies booking reference generation self-heals when `identifier_sequences` falls behind existing `BK-` references. The strategy is correct for current volume, but concurrency stress remains Layer 7 scope.

### Shared invoice number sequence and audit isolation concerns

TBD - to be filled during Phase A/B/C/etc.

## F. Auditability Concerns

### Financial actions creating `AuditLog` entries with full context

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: No `AuditLog` schema exists, which prevents exact locked-invoice immutability verification and full financial action audit coverage.
- 2026-05-15 Phase B: The integration suite asserts `OrderActivity` entries for order-scoped financial/workflow actions (`Invoice created`, `Payment received`, `Auto-adjustment issued`, `Credit note issued`, `Refund payment recorded`, `Order completed`). Booking creation, confirmation, and no-show still cannot produce spec-level `AuditLog` assertions because the model is absent.
- 2026-05-15 Phase C: EC-31 characterizes photographer reassignment after check-in as financially neutral but unaudited when written directly. A first-class audit model or service-only reassignment path is still needed.
- 2026-05-15 Phase E: Browser QA confirmed order activity is visible for refund, credit note, invoice adjustment, and delivery actions, but there is still no first-class financial AuditLog view in the UI. Accountant-facing audit verification remains activity-feed based rather than audit-record based.

### `actorUserId` gap status on audit-critical services

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase B: Order-scoped tested services preserve `actorUserId` through `OrderActivity` for payment, package, credit-note, refund, and delivery actions. Booking status actions still have no first-class actor/audit persistence.

### Invoice closure attribution gap

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: Invoice closed/locked state is asserted, but closure attribution remains outside the schema-level invariant suite because there is no dedicated audit snapshot/actor record to join.
- 2026-05-15 Phase B: INT-07 and INT-09 assert invoice-closure activities (`Invoice settled`, `Adjustment settled`) on orders, but Deposit invoice closure during booking confirmation has no equivalent first-class audit record.
