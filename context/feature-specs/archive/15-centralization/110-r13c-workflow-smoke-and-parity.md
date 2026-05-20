# Feature 110 - R13c: Workflow Smoke + Deferred Parity Matrices

## Goal

Prove the centralized R0–R12 architecture behaves correctly across real studio workflows end-to-end, and close the three cross-surface / cross-projector / cross-policy parity matrices that R13b deferred. R13c adds service-level golden-path smoke coverage for booking → check-in → POS → adjustment → editing → production → delivery (six per-stage flows + one combined cross-stage walk-through), plus the three deferred parity tests. All new coverage lands behind existing gates — `npm run test:backend-invariants` for smoke flows (which need the isolated schema harness) and `npm run test:centralization` for parity matrices. No new test framework, no new harness, no new runner.

R13c is the last verification phase before R13d (manual QA + freeze signoff). It is a verification phase, not a refactor.

## Read First

- `AGENTS.md` — narrow context rule, docs-only progress behavior.
- `context/reviews/r13-freeze-gate-assessment.md` — R13c section ("Prefer existing fixtures and service calls over browser-heavy testing").
- `context/reviews/r13-freeze-checklist.md` — the three deferred parity lines annotated as "R13c candidate" (orders table ↔ customer history financial parity; Adjustment Workspace package/session metadata parity; cross-policy workflow action availability parity).
- `context/reviews/r13-verification-inventory.md` — current matrix; every new test added by R13c must land here.
- `context/feature-specs/108-r13a-verification-inventory.md` — wiring contract for `test:centralization`.
- `context/feature-specs/109-r13b-automated-regression-gate.md` — pattern for narrow regression-hardening additions; R13c follows the same single-file-per-concern shape.
- `context/progress-tracker.md` Open Follow-Ups — names the three R13c parity inputs.
- `tests/backend-invariants/harness.ts` — `withIsolatedBackendInvariantSchema(run)` is the smoke-test fixture primitive.
- `tests/backend-invariants/run.ts` — pattern for adding new flows to the backend-invariants runner (single process, single isolated schema, dynamic imports).
- `tests/backend-invariants/package-options.smoke.ts` and `tests/backend-invariants/invoice-math.invariant.ts` — closest existing patterns for smoke vs invariant shape.
- `tests/adjustment-workspace/finalize-integration.test.ts` — closest existing integration pattern; reference for adjustment-flow shape but **not** the harness for smoke (the harness is the backend-invariants one).
- `scripts/run-centralization-tests.ts` — the literal file list R13c extends for the parity tests.
- `src/modules/bookings/booking.service.ts`, `src/modules/orders/order.service.ts`, `src/modules/financial-cases/`, `src/modules/orders/composition/`, `src/modules/orders/policies/`, `src/modules/orders/adjustment-workspace/` — the centralized service surface the smoke flows call.

## Rules

- **Verification-only.** R13c adds tests and inventory/checklist entries. It does not change any projector, policy, write-service, schema, component, or page behavior. The only exception is if smoke testing surfaces a real bug, in which case the bug is recorded as a discrete finding per the triage rule below — it is not fixed inside R13c.
- **Reuse existing harnesses and fixtures.** No new test framework, no new fixture loader, no new "smoke DSL." Smoke flows use `withIsolatedBackendInvariantSchema(...)` and join the existing `tests/backend-invariants/run.ts` runner. Parity tests use the shape established by R13b (one file, one direct equality assertion, no abstraction).
- **Smoke flows are service-level, not browser-level.** Each flow calls the actual service functions (`bookingService`, `orderService`, `adjustmentWorkspaceService`, `paymentService`, etc.) against the isolated schema. No rendering, no Playwright/Cypress, no HTTP.
- **Golden path only for smoke.** No negative paths, no error-state coverage. Each flow asserts the canonical centralized read layer (projectors / policies) returns the expected values at each step. Error paths and negative assertions remain outside R13c.
- **One combined cross-stage walk-through.** In addition to the six per-stage smoke files, R13c adds one file that chains the stages in a single fixture lifecycle (book → confirm → check-in → settle → start editing → finalize adjustment → produce → deliver). It asserts state transitions chain correctly and the centralized read layer reports coherent values across the chain.
- **Parity tests share the R13b shape.** Each new parity test is one file, one fixture per relevant state, direct equality assertion between two existing canonical sources. No new projector / policy / view-model code.
- **No CI workflow file change.** Same as R13a/R13b.
- **No production code change** other than the single discrete-finding documentation path if smoke surfaces a real bug.
- **Inventory ↔ runner byte-equivalence holds** for `test:centralization` (asserted in R13a, preserved through R13b, preserved here). Smoke files do not enter the `test:centralization` runner — they live in `tests/backend-invariants/` and are invoked by `run.ts`, which is already wired to `npm run test:backend-invariants`. They still get inventory entries (category: Workflow Smoke; reachability: `test:backend-invariants`; decision: `existing-script`).
- **Each smoke file must remain runnable from the existing `tests/backend-invariants/run.ts` orchestration only.** Do not add a parallel runner, do not add a new npm script.

## Scope

### In Scope

#### A. Workflow smoke flows (six per-stage + one combined)

Each per-stage flow is one new file under `tests/backend-invariants/` named `*.smoke.ts` (matching `package-options.smoke.ts`). Each file exports a single `runXxxSmokeTest(databaseUrl: string)` function and is invoked from `tests/backend-invariants/run.ts` inside the existing `withIsolatedBackendInvariantSchema` block.

1. **Booking confirmation + check-in** — `tests/backend-invariants/booking-confirmation-checkin.smoke.ts`. Build a confirmed booking, run check-in, assert: booking workflow policy returns the expected post-check-in action availability; `FinancialCaseSummary` for the booking reports the expected deposit/active stage transition values.
2. **POS invoice + payment** — `tests/backend-invariants/pos-invoice-payment.smoke.ts`. From a checked-in booking, run draft POS composition, finalize an invoice, settle a payment. Assert: `OrderCompositionViewModel` returns the locked POS composition with expected totals; `FinancialCaseSummary` reports the active-stage paid/remaining values; `OrdersTableRowProjection` reflects the same.
3. **Locked adjustment flow** — `tests/backend-invariants/locked-adjustment.smoke.ts`. From a locked order, open Adjustment Workspace, stage one item add and one item remove, finalize. Assert: pre-finalize, `pendingChangesView` projector reports the staged net delta; post-finalize, `FinancialCaseSummary` reflects the finalized adjustment; selected-photo baseline parity holds across the transition.
4. **Editing start gate** — `tests/backend-invariants/editing-start-gate.smoke.ts`. From an active-stage order with paid deposit, attempt to start editing; assert the editing workflow policy returns the start-allowed action. Run the start; assert the post-start policy state matches the expected editing-mode action set.
5. **Production readiness** — `tests/backend-invariants/production-readiness.smoke.ts`. From an in-editing order, transition to production-ready; assert the production workflow policy returns the production-ready action set and `ProductionDeliverablesProjection` reflects the expected aggregate photo counts.
6. **Delivery pickup / override behavior** — `tests/backend-invariants/delivery-pickup.smoke.ts`. From a production-ready order, run delivery pickup with a settled balance; then run a second fixture with an override path (e.g. manager override on a non-zero balance). Assert the delivery workflow policy returns the expected action availability in both cases and `FinancialCaseSummary` reports the expected post-delivery payment-settlement values.
7. **Combined cross-stage walk-through** — `tests/backend-invariants/end-to-end-studio-walkthrough.smoke.ts`. One fixture lifecycle from booking creation through delivery. Asserts state transitions chain correctly and the centralized read layer returns coherent values at every checkpoint. This file does not duplicate per-stage assertions wholesale — it captures only the chain-level invariants: that each transition's output is the next stage's valid input, and that `FinancialCaseSummary`, `OrderCompositionViewModel`, and the four workflow policies remain coherent across the chain.

For each smoke file:

- Use `withIsolatedBackendInvariantSchema` only via the parent `run.ts` block — the file itself receives `databaseUrl`, does its work, and returns. No top-level harness invocation per file.
- Reuse fixture builders from existing backend-invariants files where possible. If a fixture pattern doesn't yet exist for a particular stage, build the minimal seed inline in the smoke file — do not introduce a shared fixture module.
- Each smoke file is registered in `tests/backend-invariants/run.ts` after the existing entries, alphabetized by file name within a new "Workflow smoke" comment block.

#### B. Three deferred parity matrices

Each ships as one new `*.test.ts(x)` file added to `test:centralization`.

1. **Orders table ↔ customer history financial parity** — `tests/orders/orders-table-customer-history-parity.test.ts`. For one set of shared fixtures (draft, locked, locked+adjusted, refunded, credit-noted, overpaid, overridden), call both `getOrdersTableFinancialProjections({ orderIds })` and the customer-order-history wrapper and assert that for every shared `orderId` the financial fields (`invoiceStatus`, `paymentStatus`, `totalAmount`, `paidAmount`, `remainingAmount`) are byte-equivalent across both surfaces. The existing single-surface tests do not assert this cross-surface property.
2. **Adjustment Workspace package/session metadata parity** — `tests/adjustment-workspace/package-session-metadata-parity.test.ts`. For one locked order with packages and session configurations, assert the package name, included counts, session-configuration code, and operational metadata visible in Adjustment Workspace's current-composition projection match what `order-composition.service.ts` projects for the locked POS surface. Cross-projector parity; no new projector code.
3. **Workflow action availability parity** — `tests/orders/workflow-action-availability-parity.test.ts`. For one fixture per workflow stage (booking, editing, production, delivery), invoke the corresponding policy builder and assert the returned action availability matrix matches a small hand-authored expected table that mirrors the documented R10 baseline availability rules. The four existing per-policy tests cover their own policies in depth; this test asserts the cross-policy invariant that no action availability has silently drifted from R10.

#### C. Wiring

- Each per-stage and combined smoke file appears in `tests/backend-invariants/run.ts` and in `context/reviews/r13-verification-inventory.md` under a new "Workflow Smoke" category with reachability `test:backend-invariants` and decision `existing-script`.
- Each parity test appears in `scripts/run-centralization-tests.ts` (alphabetized within its category-adjacent block) and in `context/reviews/r13-verification-inventory.md` with decision `centralization-gate`.
- Inventory ↔ runner byte-equivalence for `test:centralization` is preserved.
- `context/reviews/r13-freeze-checklist.md` is updated:
  - The three R13c-candidate parity lines now also reference the new parity tests.
  - A new "Workflow Smoke" section appears under Automated Gates (Must Pass), or — if the existing structure makes that awkward — the existing "Parity Verification Areas" picks up the smoke references with a brief lead-in. Pick whichever fits with the file's current shape; do not redesign the document.

#### D. Triage policy if smoke surfaces a real bug

If any smoke flow fails because of a genuine production-code defect (not a fixture issue):

- Capture the diagnosis (file + line + observed vs expected) in `context/progress-tracker.md` Open Follow-Ups as a discrete R13 finding with the proposed fix-spec name.
- Add a one-line note in the inventory entry for that smoke file.
- Mark the smoke file with a top-level skip or guard **only** if the bug blocks the entire flow; otherwise the smoke file ships with the failing assertion documented but isolated so it does not silently mask the regression. Prefer documented-and-failing over silent-skip; R13c is a gate, not a hider.
- Do not fix the production bug in R13c.

#### E. Progress tracker

- Remove the three completed Open Follow-Ups for the deferred parity matrices.
- If any smoke triage produced a finding, add it as a new Open Follow-Up.
- Update Now to reflect R13c completion and name R13d as the next spec.

#### F. Validation

- `npm run test:backend-invariants` exits 0 with the new smoke files included.
- `npm run test:centralization` exits 0 with the three new parity files included.
- `npm run test:financial-invariants`, `npm run build`, `npm run lint` all exit 0.

### Out of Scope

- Browser-level / Playwright / Cypress tests.
- Negative-path or error-state coverage in smoke flows. Smoke is golden-path only.
- New service functions, new projector code, new policy code, new view-model code, new write logic.
- New harness, new fixture loader, new shared smoke utility module.
- A new npm script. Smoke runs through `test:backend-invariants`; parity runs through `test:centralization`.
- A new CI workflow file.
- Fixing any production bug surfaced during smoke testing (handled by §D triage policy).
- Adding negative assertions to smoke flows to verify error handling.
- Reworking `tests/backend-invariants/run.ts` orchestration beyond appending the new flows. Existing entries' order, fixture handling, and dynamic-import shape are unchanged.
- Manual QA checklist body content — deferred to R13d.
- Reconciliation target selection, reconciliation secret setup, monitoring wiring — operational concerns owned by R13d signoff.
- Any change to `context/architecture-context.md`, `context/code-standards.md`, `context/ai-workflow-rules.md`, `context/project-overview.md`, `context/target-data-model.md`, `context/ui-context.md`.
- Any change to the body of `context/reviews/centralization-roadmap.md` or `context/reviews/r13-freeze-gate-assessment.md`.
- Renaming, relocating, splitting, or consolidating existing test files.

## Implementation Direction

R13c is seven smoke files + three parity files + consistent wiring + triage discipline.

### 1. Seven smoke files (§A.1–§A.7)

For each per-stage file:

- Top of file imports the relevant service module(s) under test and the centralized read layer they should expose.
- Exported function shape: `export async function runXxxSmokeTest(databaseUrl: string): Promise<void>`.
- Seed the minimum fixture inline. Reuse fixture helpers from sibling backend-invariants files if a matching one already exists; otherwise build inline. Do not introduce a shared fixture module — R13c size discipline forbids it.
- Run the service calls, then assert the centralized projector/policy outputs against expected values using `node:assert/strict`.
- Print one progress line per major step to stdout (matches the existing `.smoke.ts` / `.invariant.ts` convention if any; otherwise minimal logging is fine).
- Register the file in `tests/backend-invariants/run.ts` after the existing entries, in a new "Workflow smoke" block, alphabetized by file name.

For the combined cross-stage file (§A.7):

- Single fixture lifecycle. Avoid re-asserting per-stage details; assert only chain-level invariants:
  - Each transition's output is structurally valid as the next stage's input.
  - `FinancialCaseSummary` remains coherent across the chain (totals, paid, remaining match expected at each checkpoint).
  - The four workflow policies' action-availability outputs do not contradict each other at any checkpoint.
  - Selected-photo baselines flow through the chain without drift.

### 2. Three parity files (§B.1–§B.3)

Follow the R13b shape exactly: one file, one fixture per relevant state, direct equality assertion between two existing canonical sources, no abstraction layer.

For (B.1) and (B.3), reuse existing fixtures from the closest sibling test where possible. For (B.2), reuse the locked-order fixture from `tests/orders/order-composition-view-model.test.ts` (or the closest existing locked-order POS composition fixture).

### 3. Inventory + runner + checklist sync

After all ten new files exist:

- Append each parity file path to `scripts/run-centralization-tests.ts` (alphabetized within its category-adjacent block).
- Append each smoke file path to a new "Workflow Smoke" category in `context/reviews/r13-verification-inventory.md` with reachability `test:backend-invariants` and decision `existing-script`.
- Append each parity file to `context/reviews/r13-verification-inventory.md` under its correct category with decision `centralization-gate`.
- Update the three R13c-candidate parity lines in `context/reviews/r13-freeze-checklist.md` to reference the new parity tests, dropping the "R13c candidate" annotation.
- Reference the workflow smoke files in the checklist's automated-gates or parity-verification section (whichever fits the file's existing shape — do not restructure).
- Re-verify inventory ↔ runner byte-equivalence for `test:centralization`.

### 4. Triage discipline (§D)

Smoke flows must not silently skip. Documented-and-failing is acceptable; silent-skip is not.

### 5. Validation (§F)

Run the full automated gate set. Capture exit codes in the PR description (or commit body) rather than a tracked file.

### 6. Progress tracker (§E)

Remove the three completed Open Follow-Ups. Add any new R13c smoke findings. Update Now to name R13d as next.

## What R13c Must Not Touch

- `prisma/`, `app/`, `src/` — read-only for R13c. No production-code edits.
- `.github/workflows/**`.
- `context/architecture-context.md`, `context/code-standards.md`, `context/ai-workflow-rules.md`, `context/project-overview.md`, `context/target-data-model.md`, `context/ui-context.md`, `context/development-utilities.md`, `context/git-conventions.md`.
- Body of `context/reviews/centralization-roadmap.md` or `context/reviews/r13-freeze-gate-assessment.md`.
- Existing test files' contents (smoke and parity additions are new files only).
- `tests/backend-invariants/harness.ts` — used as-is. No edits.
- `tests/backend-invariants/run.ts` orchestration logic — only the appended registration block for the new smoke files is allowed.

## Observability Checklist

### Dashboards / Metrics

- No new metric. R13c adds tests only.
- The expanded `test:backend-invariants` and `test:centralization` outputs are the entire R13c signal.

### Rollback Plan

- Revert the new test files, undo their inventory/runner/run.ts entries, restore the three R13c-candidate annotations in the checklist, and revert the progress-tracker edits. No schema, no data, no runtime impact.

### Customer-Visible Surface

- Zero. Internal verification only.

## Post-Implementation

- `context/progress-tracker.md` Now reflects R13c completion and names R13d as the next spec.
- The three deferred parity Open Follow-Ups are removed.
- Any new smoke-triage findings appear as discrete Open Follow-Ups with proposed fix-spec names.
- `context/reviews/r13-verification-inventory.md` includes the seven smoke rows and the three parity rows.
- `context/reviews/r13-freeze-checklist.md` no longer flags the three matrices as R13c candidates and references the smoke flows.

## Acceptance Criteria

- Seven smoke files exist at the paths named in §A (six per-stage + one combined). Each exports a single `runXxxSmokeTest(databaseUrl)` function and is registered in `tests/backend-invariants/run.ts` inside the existing `withIsolatedBackendInvariantSchema` block. No smoke file invokes the harness on its own.
- Each smoke file asserts golden-path behavior of the centralized read layer at every checkpoint via `node:assert/strict`. No negative paths, no error-state assertions.
- The combined cross-stage smoke (§A.7) chains booking → check-in → POS → adjustment → editing → production → delivery in a single fixture lifecycle and asserts only chain-level invariants (transition validity, `FinancialCaseSummary` coherence, workflow-policy non-contradiction, selected-photo baseline continuity).
- Three parity files exist at the paths named in §B. Each is one file, one fixture per relevant state, direct equality assertion between two existing canonical sources. No new projector, policy, or view-model code is introduced.
- Every new smoke file appears in `context/reviews/r13-verification-inventory.md` under a new "Workflow Smoke" category with reachability `test:backend-invariants` and decision `existing-script`. None appears in `scripts/run-centralization-tests.ts`.
- Every new parity file appears in both `scripts/run-centralization-tests.ts` and `context/reviews/r13-verification-inventory.md` with decision `centralization-gate`. The inventory ↔ runner byte-equivalence holds: every `centralization-gate` row is in the runner; every runner line is in the inventory.
- `context/reviews/r13-freeze-checklist.md` no longer marks the three matrices as R13c candidates. The corresponding lines link to the new parity tests. The smoke flows are referenced in the checklist's automated-gates or parity-verification section.
- `context/progress-tracker.md` no longer lists the three R13c parity follow-ups. Any new smoke-triage findings appear as discrete Open Follow-Ups with proposed fix-spec names.
- `npm run test:backend-invariants` exits 0 with the seven new smoke files registered and executed.
- `npm run test:centralization` exits 0 with the three new parity files included.
- `npm run test:financial-invariants` exits 0.
- `npm run build` exits 0.
- `npm run lint` exits 0 (the pre-existing warning in `tests/financial-phase-c/edge-cases.ts` may remain — it is not introduced by R13c).
- No file under `prisma/`, `app/`, `src/`, `.github/workflows/` is modified.
- No new npm script, no new CI workflow file, no new test framework, no new harness, no new shared smoke-utility module is added.
- `tests/backend-invariants/harness.ts` is unchanged. `tests/backend-invariants/run.ts` changes are limited to appending the seven smoke-file registrations.
- `context/architecture-context.md`, `context/code-standards.md`, body of `context/reviews/centralization-roadmap.md`, and `context/reviews/r13-freeze-gate-assessment.md` are unchanged.
- If smoke surfaces a real production bug, R13c records the finding per §D and does not fix the bug in this spec.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector instead of re-deriving in pages or components. (R13c adds no new such surface; all new assertions read from existing projectors/policies.)
