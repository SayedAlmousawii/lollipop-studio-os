# ADR 003: Credit Note Target And Math

## Status

Accepted.

## Context

Locked FINAL invoices must remain immutable, but staff still need an audited way to reduce the customer receivable after lock.

## Decision

CREDIT_NOTEs always target FINAL invoices. The math reduction is expressed via `DocumentApplication(source=CREDIT_NOTE, target=FINAL, amountApplied=total)`.

The CREDIT_NOTE invoice itself has a positive `totalAmount`; the reduction direction is encoded in the application semantics. Phase 1's `computeEffectivePaidFromAllocations` consumes `DocumentApplication` rows targeting an invoice, so credit notes flow into existing invoice status recalculation.

## Consequences

- CREDIT_NOTEs never target ADJUSTMENT or DEPOSIT invoices.
- CREDIT_NOTE issuance is non-monetary and does not create a Payment.
- If the FINAL becomes overpaid after the credit note, a separate REFUND flow records the outbound money movement.
