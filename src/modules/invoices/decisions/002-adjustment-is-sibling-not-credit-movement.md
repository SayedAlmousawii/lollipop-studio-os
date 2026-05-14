# ADR 002: Adjustment Is Sibling, Not Credit Movement

## Status

Accepted.

## Context

Locked FINAL invoices must remain immutable. Additive commercial edits after the FINAL is locked create a new receivable instead of changing the original invoice.

## Decision

ADJUSTMENT invoices are receivables, not credit movements. They are settled via `PaymentAllocation`, never via `DocumentApplication`.

`parentInvoiceId` records the audit relationship to the parent FINAL invoice. The financial math does not depend on that parent pointer.

## Consequences

- Every ADJUSTMENT is a sibling of the FINAL in the same `FinancialCase`.
- ADJUSTMENT invoices never chain to other ADJUSTMENT invoices.
- `DocumentApplication` remains reserved for credit transfers such as DEPOSIT to FINAL and future CREDIT_NOTE applications.
