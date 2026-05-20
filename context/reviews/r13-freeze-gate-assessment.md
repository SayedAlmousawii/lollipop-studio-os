# R13 Freeze Gate Assessment

Generated: 2026-05-20

R13 is not a feature phase. It is the final freeze gate after the R0-R12 centralization roadmap. Its job is to prove the centralized architecture is stable, behavior-preserving, and safe to trust in production-like studio workflows.

Do not treat R13 as:

- a new architecture phase
- a redesign phase
- a feature phase
- a broad refactor phase

Treat R13 as:

- stabilization
- verification
- confidence gating
- production-safety validation
- final parity and operational QA

---

## Architecture / Verification Assessment

After R12, the centralization architecture is mostly in the desired shape:

- Financial read truth lives in `src/modules/financial-cases/`.
- Composition read truth lives in `src/modules/orders/composition/`.
- Edit-mode policy lives in `src/modules/orders/policies/edit-mode-policy.ts`.
- Workflow policies live in `src/modules/orders/policies/` and `src/modules/bookings/booking-workflow-policy.ts`.
- R11 intentionally did not introduce `getOrderDetailsView(orderId)`; order detail still uses page-level orchestration with centralized projectors/policies.
- R12 removed the main legacy compatibility helpers and added source guards.

The current architecture should be considered centralized enough for a freeze gate. R13 should validate the finished distributed projector/policy architecture rather than continuing the centralization roadmap.

Known remaining architectural follow-up:

- `orders-table-projections.service.ts` still has a deferred performance/centralization cleanup noted in `context/progress-tracker.md`. This should not become R13 feature work unless verification proves a real behavior divergence. It is a follow-up, not automatically a freeze blocker.

---

## Existing Verification Coverage

The repo already has meaningful verification coverage across R0-R12.

Covered well:

- Backend invariants through `npm run test:backend-invariants`.
- Financial reconciliation through `npm run financial:reconcile`.
- Financial invariant fixture coverage and INV-18 regression.
- `FinancialCaseSummary` / projector coverage for booking, active, adjusted, credit-noted, refunded, overpaid, overridden, and missing-summary states.
- Adjustment Workspace staged/finalize coverage, including selected-photo baseline regressions.
- R9 edit-mode policy matrix coverage.
- R10 booking, editing, production, and delivery workflow policy coverage.
- Orders table and customer-history projection checks.
- Source-level guards for service-only DB access, local money parsing, deleted helpers, projector purity, and compatibility cleanup.

Main coverage gap:

- Many targeted `node:test` files are not exposed through package scripts or CI. The safety net exists, but the freeze gate currently depends on knowing which individual files to run.

R13 should make verification discoverable and repeatable before it adds new tests.

---

## Highest Risk Areas After R0-R12

1. End-to-end real workflow parity: booking confirmation -> check-in -> POS settlement -> selection -> editing -> production -> delivery.
2. Locked and post-lock flows: Adjustment Workspace staging, selected-photo baselines, financial vs operational session configuration edits.
3. Financial readout parity across surfaces: order header, financial tab, locked/draft sidebars, orders table, customer history, booking page, invoice/payment dialog.
4. Workflow availability parity: buttons/actions should remain available or blocked exactly as before unless intentionally centralized/fixed.
5. Terminology drift: remaining "base payment" copy should be classified as acceptable legacy wording, intentional correction, or cleanup.
6. CI/test discoverability: the R1-R12 verification surface is larger than the package scripts imply.

---

## What R13 Should Contain

R13 should contain a bounded verification program:

- automated verification
- financial reconciliation verification
- adjustment workspace verification
- workflow policy verification
- regression/parity verification
- architecture invariant verification
- operational/manual QA checklist
- smoke tests for real workflows
- freeze/finalization expectations

R13 should avoid:

- new read models
- new projector architecture
- new workflow architecture
- broad refactors
- UI redesign
- schema changes
- feature behavior changes

If R13 finds a bug, the fix should be the smallest behavior-preserving correction needed to make the existing centralized architecture trustworthy.

---

## Recommended R13 Structure

Do not draft one giant implementation spec. Split R13 into small verification tasks plus one freeze checklist.

### R13a - Verification Inventory + Test Gate Wiring

Purpose: define the complete R13 verification matrix and make the existing test surface runnable.

Recommended contents:

- Inventory existing R1-R12 tests by area.
- Identify which tests are already in scripts/CI and which are only individually runnable.
- Add a small npm script or test runner only if needed to group existing centralization tests.
- Create the canonical R13 freeze checklist.
- No business behavior changes.

### R13b - Automated Centralization Regression Gate

Purpose: prove core centralization behavior through automated gates.

Recommended contents:

- Run/wire financial, composition, policy, parity, architecture, smoke, and source-guard tests.
- Add only missing regression tests where a critical parity behavior has no automated assertion.
- Avoid new abstractions or new test frameworks.

### R13c - End-To-End Workflow Smoke Verification

Purpose: prove real studio workflows still behave correctly end-to-end.

Recommended contents:

- Minimal service-level smoke coverage for booking confirmation/check-in.
- POS invoice/payment flow.
- Locked adjustment flow.
- Editing start gate.
- Production readiness.
- Delivery pickup / override behavior.
- Prefer existing fixtures and service calls over browser-heavy testing.

### R13d - Manual Operational QA + Freeze Signoff

Purpose: capture the parts that are risky to verify only with unit tests.

Recommended contents:

- Manual QA checklist for desktop/tablet staff workflows.
- POS visual/interaction parity checks.
- Order detail and booking detail checks.
- Adjustment Workspace checks.
- Reconciliation secrets and monitor checks.
- Known acceptable behavior changes.
- Final signoff criteria.

---

## Automated vs Manual Verification

Automate:

- `npm run build`
- `npm run lint`
- `npm run test:backend-invariants`
- `npm run test:financial-invariants`
- `npm run financial:reconcile` against fixture/dev data
- R1-R12 targeted tests
- source guards for DB access, local money parsing, deleted helpers, and projector/policy ownership
- minimal service-level end-to-end workflow smoke tests

Manual:

- visual parity of POS, order details, booking details, and Adjustment Workspace
- real migrated dev database spot checks
- staff workflow ergonomics
- reconciliation secrets / Slack / Healthchecks setup
- final confirmation of intentionally changed terminology such as "deposit" replacing "base payment"

---

## Recommended Acceptance Criteria

R13 is complete only when:

- Build and lint pass.
- Backend invariants pass.
- Financial invariants pass.
- Financial reconciliation passes on the intended R13 fixture/dev target.
- All R1-R12 centralization regression tests are either wired into a known command or explicitly listed in the manual R13 runbook.
- Architecture guards pass:
  - no DB imports in `app/**` or `src/components/**`
  - no component/page financial math reintroduced
  - no local formatted-money parsing reintroduced
  - removed R12 helpers stay removed
  - projectors remain pure
  - workflow action lists remain policy-owned
- Financial readouts match canonical projector expectations across representative states.
- Adjustment Workspace selected-photo baseline parity is verified.
- Workflow policy availability and blockers are verified.
- Core studio workflow smoke checks pass.
- Manual QA checklist is completed or explicitly deferred with owner approval.
- Any intentional behavior changes are documented and covered by tests.
- Remaining follow-ups are non-blocking and listed in `context/progress-tracker.md`.

---

## Completion Blockers

R13 should block completion if any of the following occur:

- `npm run build` fails.
- `npm run lint` fails.
- backend invariants fail.
- financial invariants fail.
- financial reconciliation reports unexpected violations.
- any R0-R12 source guard fails.
- a canonical projector or policy gives a different business result without documented intentional improvement.
- Adjustment Workspace selected-photo baseline parity regresses.
- workflow action availability drifts without documentation and tests.
- financial totals/statuses differ across centralized surfaces.
- manual smoke testing finds a broken core studio workflow.
- production reconciliation secrets or monitoring are not configured and the deferral is not explicitly accepted.

---

## Recommended Implementation Order

1. Create the R13 verification inventory and freeze checklist.
2. Add or document a single command/runbook for all existing centralization tests.
3. Run the current automated gates and record failures as R13 findings.
4. Add minimal missing parity tests only for critical uncovered workflows.
5. Run financial reconciliation against the R13 target data.
6. Run service-level end-to-end smoke flows.
7. Complete manual operational QA.
8. Document intentional behavior changes and non-blocking follow-ups.
9. Mark the centralization roadmap trusted only after all blockers are resolved.

---

## Recommended Parity-Verification Areas

Explicitly parity-verify these old business behaviors against the centralized paths:

- Financial totals/statuses for draft, locked, locked+adjusted, credit-noted, refunded, overpaid, overridden, and no-final-invoice states.
- Orders table and customer history invoice/payment status labels.
- Booking-stage financial display.
- Payment dialog / invoice-list financial context.
- Draft POS package/add-on/session-configuration totals.
- Locked POS current composition.
- Adjustment Workspace current composition and pending preview.
- Selected-photo included baseline, selected count, digital/print extra split, and extra-photo total.
- Add-on marketplace current rows, duplicate counts, "Added" state, empty states, and removal target behavior.
- Edit-mode policy routing for locked financial edits, locked operational edits, open-workspace edits, delivered-order blocks, and adjustment-mode staging.
- Booking, editing, production, and delivery workflow action availability and blockers.
- Delivery payment settlement from `FinancialCaseSummary`.
- Terminology cleanup such as "Base payment" -> "deposit", where intentional.

---

## Definition Of "Centralization Roadmap Complete And Trusted"

The roadmap can be considered complete and trusted when:

- Centralized read models and policies are the only business-display truth for the R0-R12 target surfaces.
- Old operational/business behavior is proven equivalent or intentionally improved.
- Intentional improvements are documented, architecturally safer, and covered by tests.
- Automated gates pass.
- Manual operational QA passes.
- Financial reconciliation is operational and monitored.
- Remaining follow-ups are non-blocking, explicit, and tracked.

---

## Recommendation For Next Spec Drafting

Draft multiple R13 specs/tasks next, not one large spec.

Recommended next draft:

- Start with **R13a - Verification Inventory + Test Gate Wiring**.

R13a should define the matrix and runnable gate first. That prevents R13 from becoming a sprawling second roadmap and keeps it aligned with its real purpose: final confidence, not more centralization work.
