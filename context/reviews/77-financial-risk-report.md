# 77 Financial Risk Report

## How to update this document

Append findings under the relevant subsection during each verification phase. Preserve the existing headings, add dated bullets or short subentries, and keep unresolved items marked until explicitly verified. Use `TBD - to be filled during Phase A/B/C/etc.` when a section has not been reviewed yet.

## A. Potential Corruption Vectors

### Financial records created outside the choke point

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: CI now includes a clean deterministic financial fixture graph that verifies every `Payment` has exactly one `PaymentAllocation` and that allocation invoice/amount match the payment. During development, running the checks after older backend smoke fixtures exposed test-data drift where default-`PENDING` bookings were paired with `FinancialCase` rows. Production code was not changed for this; future tests should use Phase A-style financial fixture helpers.

### Service functions accepting `db` client directly instead of through a transaction

TBD - to be filled during Phase A/B/C/etc.

### Places where `invoice.totalAmount` is mutated post-creation

TBD - to be filled during Phase A/B/C/etc.

## B. Unresolved Architectural Weaknesses

### Single-allocation invariant enforced in the app layer only

TBD - to be filled during Phase A/B/C/etc.

### Locked invoice immutability enforced in the service layer only

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: INV-14 cannot be verified exactly because the schema has no `AuditLog` model or lock-time snapshot of locked invoice fields. This remains an architectural risk: tests can assert current locked state, but cannot prove `totalAmount`, `invoiceType`, or `financialCaseId` never changed after lock.

### Remaining `PaymentType.BASE` references

TBD - to be filled during Phase A/B/C/etc.

## C. Dangerous Assumptions

### Financial calculations reading `invoice.paidAmount` as a cached field

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: The new invariant suite verifies effective paid amount from `PaymentAllocation` and `DocumentApplication` for open-invoice overpayment/negative-balance checks. It intentionally does not treat cached `invoice.paidAmount` as authoritative for balance safety.

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

## E. Transactional Weaknesses

### Multi-step operations not wrapped in explicit `$transaction`

TBD - to be filled during Phase A/B/C/etc.

### Async operations outside the transaction boundary

TBD - to be filled during Phase A/B/C/etc.
