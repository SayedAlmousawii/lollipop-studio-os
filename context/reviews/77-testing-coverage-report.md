# 77 Testing Coverage Report

## How to update this document

Append workflow coverage findings as each testing phase completes. Record pass/fail or not-run status under the matching section, note the phase that produced the result, and keep skipped items with a reason plus risk note. Use `TBD - to be filled during Phase A/B/C/etc.` where coverage work has not been done yet.

## A. Covered Workflows

### INT-xx scenarios with pass/fail status

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: No Layer 3 `INT-xx` workflow tests were implemented; this phase intentionally stopped at Layers 0, 1, and 2.
- 2026-05-15 Phase B: INT-01 through INT-15 are now covered by `tests/financial-phase-b/workflow-integration.ts` and pass through `npm run test:backend-invariants`. Coverage is service-layer first, with deterministic fixtures for pending, confirmed, checked-in, final-invoice, locked-final, credit-note, refund, package-upgrade, no-show, and delivery workflows.

## B. Untested Workflows

### Scenarios from the matrix not covered by tests

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: Layers 3 through 10 remain unimplemented by request. INV-14 locked-field immutability and INV-18 FinancialCase total-to-order reconciliation are documented gaps rather than forced CI checks.
- 2026-05-15 Phase B: Layer 3 is covered. Layers 4 through 10 remain unimplemented by request, except for rollback checks embedded in INT-03, INT-04, INT-08, and INT-10 because Phase B explicitly required transaction rollback coverage.

## C. Skipped Scenarios

### Skipped scenarios, reasons, and risk

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: INV-14 skipped for exact verification because there is no audit-log snapshot source. Risk: a locked invoice could be mutated outside service paths without a testable before/after proof.
- 2026-05-15 Phase A: INV-18 skipped from CI because the spec assigns full order-total reconciliation to the reconciliation runner. Risk: CI proves financial record shape but not full operational revenue composition.
- 2026-05-15 Phase B: Exact `AuditLog` assertions are skipped because no `AuditLog` model exists. Phase B asserts `OrderActivity` for order-scoped workflows and records booking-level audit absence as an architecture gap.

## D. Confidence Levels

| Area | Confidence | Notes |
|---|---|---|
| PaymentAllocation choke point | High after Phase A | CI blocks missing, duplicate, amount-mismatched, and invoice-mismatched allocations. |
| DocumentApplication binding | High after Phase A | CI blocks missing/duplicate DEPOSIT-to-FINAL applications and CREDIT_NOTE applications targeting non-FINAL invoices. |
| Locked invoice immutability | Low after Phase A | Exact INV-14 needs audit snapshots or DB trigger support. |
| Classifier routing | Higher after Phase B | INT-08, INT-10, INT-11, and INT-13 now verify additive, reductive, credit-note, and package-upgrade locked-final service paths. Layer 4 edge-case expansion is still pending. |
| Multi-package invoice math | Partial after Phase A | Existing backend invariant tests still cover selected-photo/pricing math; full Phase 77 matrix is later scope. |
| Concurrency safety | Not covered in Phase A | Layer 7 was explicitly out of scope. |

## E. High-Risk Unverified Areas

### Specific risks that remain untested or only partially tested

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: Existing legacy backend test fixtures can create lifecycle-invalid financial shapes if Phase A global checks are run after them. The Phase A CI suite uses dedicated deterministic fixtures and runs before legacy smoke fixtures.
- 2026-05-15 Phase B: Valid locked-final edit workflows currently emit `financial.rearch.dual_read.discrepancy` warnings because old-path locked edits fail while new classifier paths succeed or require manager approval. Tests pass, but log-based release gates need refinement before edge-case and concurrency phases.
