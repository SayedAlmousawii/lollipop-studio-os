# 77 Phase B Review - Workflow Integration Matrix

Date: 2026-05-15

## Scope Completed

Phase B implemented Layer 3 service-level workflow coverage for INT-01 through INT-15 only. No later edge-case, concurrency, security, reconciliation, or UI phases were implemented.

## Implemented Test Structure

- `tests/financial-phase-b/fixtures.ts` - deterministic service fixtures for pending, confirmed, checked-in, final-invoice, locked-final, and delivery-ready workflows.
- `tests/financial-phase-b/assertions.ts` - money, payment allocation, order activity, audit-gap, no-financial-record, and rollback assertions.
- `tests/financial-phase-b/workflow-integration.ts` - INT-01 through INT-15 workflow matrix.
- `tests/financial-phase-b/run.ts` - Phase B runner.
- `tests/backend-invariants/run.ts` - now runs Phase A then Phase B before legacy backend smoke invariants.

## Validation Results

- `npm run test:backend-invariants` - PASS.
- `npm run lint` - PASS.

## Workflow Coverage Summary

- INT-01 pending booking creation: PASS; asserts no FinancialCase, Invoice, or Payment.
- INT-02 pending booking hard deletion: PASS; asserts booking/package/theme references are gone.
- INT-03 booking confirmation: PASS; asserts BK reference, FinancialCase, locked Deposit invoice, Deposit payment, allocation, and rollback after simulated mid-transaction failure.
- INT-04 check-in: PASS; asserts Job, Order, FinancialCase job stamp, deposit preservation, OrderActivity, and rollback after simulated job-before-order failure.
- INT-05 final invoice creation: PASS; asserts FINAL invoice, deposit DocumentApplication, open/unlocked state, package/add-on total, and order activity.
- INT-06 partial final payment: PASS; asserts allocation, `PARTIAL`, unlocked invoice, and remaining balance recalculation.
- INT-07 full final payment: PASS; asserts `CLOSED` locked FINAL invoice and editing-start eligibility.
- INT-08 additive locked-final edit: PASS; asserts ADJUSTMENT creation, locked FINAL preservation, no CREDIT_NOTE, activity, and zero-price rollback.
- INT-09 adjustment payment: PASS; asserts payment allocation and locked closed ADJUSTMENT.
- INT-10 reductive locked-final edit: PASS; asserts manager approval requirement and no partial add-on/invoice/application/activity writes.
- INT-11 credit note issuance: PASS; asserts locked closed CREDIT_NOTE and DocumentApplication to FINAL.
- INT-12 refund issuance: PASS; uses `issueRefundWithPayment` to assert REFUND invoice, OUT payment, allocation, and refund trace.
- INT-13 package upgrade: PASS; asserts package final snapshot and delta-only ADJUSTMENT while FINAL stays locked at original amount.
- INT-14 no-show: PASS; asserts NO_SHOW, preserved FinancialCase, and unchanged locked Deposit invoice.
- INT-15 delivery completion and guards: PASS; asserts delivery completion plus blocked open-payment, editing-incomplete production readiness, and production-not-ready delivery attempts.

## Rollback Coverage

- INT-03 simulates failure after BK reference and FinancialCase creation but before invoice creation; all writes roll back.
- INT-04 simulates failure after Job creation and booking job stamp but before Order creation; all writes roll back.
- INT-08 verifies zero-price locked-final add-on attempts do not leave add-ons or adjustment invoices.
- INT-10 verifies manager-required reductive edits do not remove the add-on or create CREDIT_NOTE/Application/Activity rows.

## Findings Before Edge-Case Testing

- First-class audit logging remains unavailable. Phase B asserts `OrderActivity` for order-scoped audit-surrogate events, but booking creation, booking confirmation, and no-show cannot satisfy the spec's `AuditLog` requirement because no `AuditLog` model exists.
- Valid locked-final edit tests emit `financial.rearch.dual_read.discrepancy` warnings because the old locked-invoice path throws while the classifier path succeeds or returns a manager-required error. This is expected from the current dual-read implementation, but it conflicts with using "zero discrepancy warnings" as an operational gate.
- The spec uses `OPEN` invoice terminology, while the schema uses `DRAFT`, `ISSUED`, `PARTIAL`, `PAID`, and `CLOSED`. Phase B treats non-`CLOSED`, unlocked FINAL invoices as open and asserts concrete enum states where payments are involved.
- Refund issuance requires the combined `issueRefundWithPayment` service to meet the INT-12 expected DB state. Calling `createRefundInvoice` alone intentionally creates only the receivable document and not the outbound payment.
