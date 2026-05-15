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
- 2026-05-15 Phase E: Layer 6 manual browser QA is documented in `context/reviews/77-phase-e-ui-pos-operational-qa.md`. Covered paths include pending booking detail, deposit confirmation, check-in, POS selection/add-ons, Final Invoice payments, manual invoice close, locked invoice ADJUSTMENT creation and payment, invoice-detail REFUND/CREDIT_NOTE issuance, editing assignment/start/complete/approval, production readiness, notification, and pickup completion.
- 2026-05-15 Phase F: Layers 7, 8, and 9 now run through `tests/financial-phase-f/` inside `npm run test:backend-invariants`. Coverage includes concurrent booking deposit, double-click Final Invoice payment, concurrent locked-POS additions, stale credit-note approval, final-1% settlement race, stale closed-invoice payment, permission-negative service checks, forbidden workflow transitions, hidden mutation-path search, and rollback injection cases.
- 2026-05-15 Phase G: Layer 10 reconciliation coverage now runs at the end of `npm run test:backend-invariants` through `tests/financial-phase-g/reconciliation.ts`. It executes the read-only runner against real seeded database rows, verifies `CRITICAL`/`HIGH`/`MEDIUM` severity classification with deliberate reconciliation-risk fixtures, verifies alert payload routing, and proves the reconciliation transaction rejects writes.

## B. Untested Workflows

### Scenarios from the matrix not covered by tests

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: Layers 3 through 10 remain unimplemented by request. INV-14 locked-field immutability and INV-18 FinancialCase total-to-order reconciliation are documented gaps rather than forced CI checks.
- 2026-05-15 Phase B: Layer 3 is covered. Layers 4 through 10 remain unimplemented by request, except for rollback checks embedded in INT-03, INT-04, INT-08, and INT-10 because Phase B explicitly required transaction rollback coverage.
- 2026-05-15 Phase C: Layer 4 is covered. Layers 5 through 10 remain unimplemented by request. True concurrent database race tests remain only characterized where deterministic row-lock harnessing is not yet available.
- 2026-05-15 Phase D: Layer 5 is covered. Layers 6 through 10 remain unimplemented by request. UI/POS manual QA, true concurrency harnessing, permission-negative matrix expansion, failure recovery, and production reconciliation runner design remain outside this phase.
- 2026-05-15 Phase E: Layer 6 is covered manually for the primary admin/manager operational path. Layers 7 through 10 remain unimplemented by request. Browser role-negative checks for non-manager credit note/refund UX remain unverified because only the admin Clerk session was available for the manual run.
- 2026-05-15 Phase F: Layers 7, 8, and 9 are covered automatically. Layer 10 production reconciliation runner design remains outside this phase. Browser-level role-negative checks are still not covered; Phase F verifies service/server-action-adjacent permission boundaries.
- 2026-05-15 Phase G: Layer 10 runner architecture is covered automatically. The future persisted `reconciliation_runs` dashboard widget is not implemented because this phase remained read-only and schema changes were not authorized.
- 2026-05-15 Phase G: `npm run financial:reconcile` was also smoke-run against the local dev database. It executed successfully and exited `1` because it reported a real `INV-18` order/revenue mismatch; this verifies production-style CLI reporting against non-fixture data.

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
- 2026-05-15 Phase E: New-customer phone-first booking, pending cancellation DB trace verification, confirmed cancellation, no-show, package upgrade/downgrade, commission persistence, and browser non-manager credit-note/refund attempts were not fully executed. Risk: these remain lower-confidence UI paths even though adjacent service behavior is covered in earlier phases.
- 2026-05-15 Phase F: Browser-level stale-tab and role-negative UX was not automated; stale state is covered at service level. Refund-overpayment cap and direct `recordPayment()` permission bypass are characterization checks rather than desired-state failure tests.
- 2026-05-15 Phase G: Slack network delivery is verified through alert payload construction and an in-memory transport, not a real webhook call. Risk: production still needs secret configuration and an external monitor for webhook outage/no-report conditions.

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
| Layer 6 manual POS UX | Medium after Phase E | Primary admin/manager flow was exercised live. Confidence is reduced by skipped role-negative browser checks, package upgrade/downgrade gaps, and multiple observed UX failures. |
| Layer 7 concurrency safety | Medium-low after Phase F | True simultaneous service calls are now exercised, but payment settlement still lacks invoice row-level locking and remains a documented high-risk boundary. |
| Layer 8 permission enforcement | Medium after Phase F | Credit/refund/POS payment/delivery permissions are covered, but low-level `recordPayment()` and optional actor-role handling remain bypass risks for internal callers. |
| Layer 9 failure recovery | High after Phase F | Injected rollback cases leave no partial writes and no invariant violations. |
| Layer 10 production reconciliation | Medium-high after Phase G | Read-only runner, real-row execution, severity classification, and alert payloads are covered. Confidence is reduced only by unimplemented persisted run history and untested live Slack delivery. |

## E. High-Risk Unverified Areas

### Specific risks that remain untested or only partially tested

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: Existing legacy backend test fixtures can create lifecycle-invalid financial shapes if Phase A global checks are run after them. The Phase A CI suite uses dedicated deterministic fixtures and runs before legacy smoke fixtures.
- 2026-05-15 Phase B: Valid locked-final edit workflows currently emit `financial.rearch.dual_read.discrepancy` warnings because old-path locked edits fail while new classifier paths succeed or require manager approval. Tests pass, but log-based release gates need refinement before edge-case and concurrency phases.
- 2026-05-15 Phase C: Refund capacity and paid-adjustment reversal are the highest-risk newly verified gaps. Characterization tests pass because they document current behavior, but they should become failure-expecting tests when the production fixes land.
- 2026-05-15 Phase D: REG-LEGACY-01 documents that editing readiness can still display no outstanding balance and allow start when the canonical Final Invoice has `20.000 KD` remaining, because `src/modules/orders/order.service.ts` subtracts Deposit paid amount from Final Invoice remaining balance.
- 2026-05-15 Phase E: Manual QA reproduced high-risk staff-facing gaps: full payment does not auto-lock the Final Invoice in POS, a paid Draft invoice can still be mutated, refund defaults exceed visible overpayment, and production can be marked ready while production sections are still incomplete.
- 2026-05-15 Phase F: Payment row-level locking remains the highest-risk automated finding. The new race suite exercises simultaneous payment/settlement, but the production service still relies on stale balance reads and app-layer guards.
- 2026-05-15 Phase G: Reconciliation reduces undetected corruption duration but does not prevent corruption at write time. The highest operational risks are missed nightly execution, missing production secrets, and treating Slack delivery as the only durable audit trail.
