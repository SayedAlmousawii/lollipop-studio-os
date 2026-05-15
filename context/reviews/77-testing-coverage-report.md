# 77 Testing Coverage Report

## How to update this document

Append workflow coverage findings as each testing phase completes. Record pass/fail or not-run status under the matching section, note the phase that produced the result, and keep skipped items with a reason plus risk note. Use `TBD - to be filled during Phase A/B/C/etc.` where coverage work has not been done yet.

## A. Covered Workflows

### INT-xx scenarios with pass/fail status

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: No Layer 3 `INT-xx` workflow tests were implemented; this phase intentionally stopped at Layers 0, 1, and 2.
- 2026-05-15 Phase B: INT-01 through INT-15 are now covered by `tests/financial-phase-b/workflow-integration.ts` and pass through `npm run test:backend-invariants`. Coverage is service-layer first, with deterministic fixtures for pending, confirmed, checked-in, final-invoice, locked-final, credit-note, refund, package-upgrade, no-show, and delivery workflows.
- 2026-05-15 Phase C: E1-E12 and EC-13 through EC-42 are now covered by `tests/financial-phase-c/edge-cases.ts` and run after Phase A/B inside `npm run test:backend-invariants`. The suite combines pure classifier assertions, service workflow checks, stale-state simulations, and characterization tests for current dangerous gaps.
- 2026-05-15 Phase D: Layer 5 regression coverage now runs through `tests/financial-phase-d/` inside `npm run test:backend-invariants`. REG-74-01 through REG-76-03 cover Feature 74/75/76 regressions, REG-70-01 through REG-70-03 cover multi-package regressions, and REG-LEGACY-01 characterizes a retired deposit-deduction path that still affects editing readiness display.

## B. Untested Workflows

### Scenarios from the matrix not covered by tests

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: Layers 3 through 10 remain unimplemented by request. INV-14 locked-field immutability and INV-18 FinancialCase total-to-order reconciliation are documented gaps rather than forced CI checks.
- 2026-05-15 Phase B: Layer 3 is covered. Layers 4 through 10 remain unimplemented by request, except for rollback checks embedded in INT-03, INT-04, INT-08, and INT-10 because Phase B explicitly required transaction rollback coverage.
- 2026-05-15 Phase C: Layer 4 is covered. Layers 5 through 10 remain unimplemented by request. True concurrent database race tests remain only characterized where deterministic row-lock harnessing is not yet available.
- 2026-05-15 Phase D: Layer 5 is covered. Layers 6 through 10 remain unimplemented by request. UI/POS manual QA, true concurrency harnessing, permission-negative matrix expansion, failure recovery, and production reconciliation runner design remain outside this phase.

## C. Skipped Scenarios

### Skipped scenarios, reasons, and risk

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: INV-14 skipped for exact verification because there is no audit-log snapshot source. Risk: a locked invoice could be mutated outside service paths without a testable before/after proof.
- 2026-05-15 Phase A: INV-18 skipped from CI because the spec assigns full order-total reconciliation to the reconciliation runner. Risk: CI proves financial record shape but not full operational revenue composition.
- 2026-05-15 Phase B: Exact `AuditLog` assertions are skipped because no `AuditLog` model exists. Phase B asserts `OrderActivity` for order-scoped workflows and records booking-level audit absence as an architecture gap.
- 2026-05-15 Phase C: EC-37 is covered as a static characterization because the payment service lacks invoice row-level locking. Risk: simultaneous payment submissions still need a deterministic race harness or service-level lock implementation.
- 2026-05-15 Phase C: EC-32/EC-33 are covered as commission-model characterizations because no `Commission` model exists. Risk: package upgrade commission correctness cannot be proven until commission persistence lands.
- 2026-05-15 Phase C: EC-39 is covered as a voucher-schema characterization because no GiftCardRedemption/voucher schema exists. Risk: future voucher-backed deposits require new schema and settlement tests.
- 2026-05-15 Phase D: Full manual POS settlement-panel rendering was not exercised in a browser; REG-75-02 verifies the service detail surface exposes outstanding ADJUSTMENT invoices. Risk: UI copy/layout regressions remain Layer 6 manual QA.

## D. Confidence Levels

| Area | Confidence | Notes |
|---|---|---|
| PaymentAllocation choke point | High after Phase A | CI blocks missing, duplicate, amount-mismatched, and invoice-mismatched allocations. |
| DocumentApplication binding | High after Phase A | CI blocks missing/duplicate DEPOSIT-to-FINAL applications and CREDIT_NOTE applications targeting non-FINAL invoices. |
| Locked invoice immutability | Low after Phase C | Service paths preserve locked FINALs, but EC-27 proves direct Prisma can unset `isLocked`. |
| Classifier routing | Medium after Phase C | E1-E12 are covered, including mixed and blocked cases. E11 exposes a paid-adjustment reversal gap. |
| Multi-package invoice math | Medium after Phase C | EC-29 and EC-40 cover multi-package line grouping and adjustment sibling behavior. Broader regression remains Layer 5. |
| Concurrency safety | Low after Phase C | EC-23 covers stale closed-invoice payment rejection; EC-37 documents missing row-level lock proof. |
| Layer 5 regression snapshots | Medium after Phase D | Feature 74/75/76 and multi-package regressions are covered through deterministic service tests. UI rendering and true concurrent races remain later-layer work. |

## E. High-Risk Unverified Areas

### Specific risks that remain untested or only partially tested

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: Existing legacy backend test fixtures can create lifecycle-invalid financial shapes if Phase A global checks are run after them. The Phase A CI suite uses dedicated deterministic fixtures and runs before legacy smoke fixtures.
- 2026-05-15 Phase B: Valid locked-final edit workflows currently emit `financial.rearch.dual_read.discrepancy` warnings because old-path locked edits fail while new classifier paths succeed or require manager approval. Tests pass, but log-based release gates need refinement before edge-case and concurrency phases.
- 2026-05-15 Phase C: Refund capacity and paid-adjustment reversal are the highest-risk newly verified gaps. Characterization tests pass because they document current behavior, but they should become failure-expecting tests when the production fixes land.
- 2026-05-15 Phase D: REG-LEGACY-01 documents that editing readiness can still display no outstanding balance and allow start when the canonical Final Invoice has `20.000 KD` remaining, because `src/modules/orders/order.service.ts` subtracts Deposit paid amount from Final Invoice remaining balance.
