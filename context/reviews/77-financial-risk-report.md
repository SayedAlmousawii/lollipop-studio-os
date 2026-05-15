# 77 Financial Risk Report

## How to update this document

Append findings under the relevant subsection during each verification phase. Preserve the existing headings, add dated bullets or short subentries, and keep unresolved items marked until explicitly verified. Use `TBD - to be filled during Phase A/B/C/etc.` when a section has not been reviewed yet.

## A. Potential Corruption Vectors

### Financial records created outside the choke point

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: CI now includes a clean deterministic financial fixture graph that verifies every `Payment` has exactly one `PaymentAllocation` and that allocation invoice/amount match the payment. During development, running the checks after older backend smoke fixtures exposed test-data drift where default-`PENDING` bookings were paired with `FinancialCase` rows. Production code was not changed for this; future tests should use Phase A-style financial fixture helpers.
- 2026-05-15 Phase B: INT-01 through INT-15 use service-layer workflow calls for user actions and assert payment allocation/document application shapes after each financial transition. Test setup still uses direct fixture writes for preconditions such as pre-invoice add-ons and delivery-ready states; those writes are isolated to deterministic fixtures and not production paths.

### Service functions accepting `db` client directly instead of through a transaction

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase B: Payment, credit-note, refund, and adjustment flows are verified through exported services that wrap multi-write operations in `$transaction`; rollback checks cover simulated booking-confirmation/check-in failures plus classifier failures for zero-price additions and manager-required reductions.

### Places where `invoice.totalAmount` is mutated post-creation

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase B: INT-13 verifies a locked FINAL invoice remains at the original `500.000` total after a package upgrade and that only a `100.000` ADJUSTMENT invoice is created for the delta. INT-08 similarly verifies additive edits create ADJUSTMENT siblings instead of mutating the locked FINAL.

## B. Unresolved Architectural Weaknesses

### Single-allocation invariant enforced in the app layer only

TBD - to be filled during Phase A/B/C/etc.

### Locked invoice immutability enforced in the service layer only

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: INV-14 cannot be verified exactly because the schema has no `AuditLog` model or lock-time snapshot of locked invoice fields. This remains an architectural risk: tests can assert current locked state, but cannot prove `totalAmount`, `invoiceType`, or `financialCaseId` never changed after lock.
- 2026-05-15 Phase B: Service workflows for additive edits, package upgrades, credit notes, refunds, and delivery preserve locked FINAL invoices in tested scenarios. DB-level locked-invoice mutation prevention is still absent.

### Remaining `PaymentType.BASE` references

TBD - to be filled during Phase A/B/C/etc.

## C. Dangerous Assumptions

### Financial calculations reading `invoice.paidAmount` as a cached field

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: The new invariant suite verifies effective paid amount from `PaymentAllocation` and `DocumentApplication` for open-invoice overpayment/negative-balance checks. It intentionally does not treat cached `invoice.paidAmount` as authoritative for balance safety.
- 2026-05-15 Phase B: INT-05 through INT-12 query invoice state after every payment/application/refund transition and verify recalculated `remainingAmount` directly. No stale recalculation was observed in the tested service workflows.

### Places reading `Order.selectedPhotoCount` instead of deriving from `OrderPackage` lines

TBD - to be filled during Phase A/B/C/etc.

### Remaining references to the retired virtual deposit credit path

TBD - to be filled during Phase A/B/C/etc.

## D. Missing Safeguards

### DB-level trigger preventing locked invoice mutation

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: Still missing. Locked invoice immutability is not DB-enforced, and there is no audit snapshot to support an automated INV-14 comparison.

### DB-level constraint preventing ADJUSTMENT chaining

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: CI now blocks ADJUSTMENT parent chains via query invariant (`INV-08`), but there is no DB-level CHECK/trigger preventing a direct write from setting an ADJUSTMENT parent to another ADJUSTMENT.

### Row-level locking documented in invoice payment service

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase B: Payment workflows are transaction-safe in the sequential matrix, but concurrent payment/race coverage remains Layer 7 scope. The Phase B tests do not prove row-level lock behavior under simultaneous writes.

## E. Transactional Weaknesses

### Multi-step operations not wrapped in explicit `$transaction`

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase B: Tested booking confirmation, check-in, final payment closure, locked-final edits, credit-note issuance, refund-with-payment, and delivery completion leave no partial writes in the rollback cases covered by INT-03, INT-04, INT-08, and INT-10.

### Async operations outside the transaction boundary

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase B: No partial-write issue was reproduced from async work outside transaction boundaries. The remaining concern is observability noise: valid locked-final classifier tests emit dual-read discrepancy warnings even though the transaction outcome is correct.
