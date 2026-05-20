# Feature 109 - R13b: Automated Centralization Regression Gate

## Goal

Close the narrow set of automated-coverage gaps the R13a inventory and freeze checklist exposed where a real regression has already been observed or a manual usage path has surfaced a missing guard. R13b locks those gaps into the existing `test:centralization` gate, completes the intentional "Base payment" → "deposit" terminology cleanup with dual source + render guards, and triages the one isolated test failure surfaced during R13a.

R13b is a **focused regression-hardening phase**. It is not a broad parity-matrix phase. Cross-surface parity matrices and workflow-level smoke verification are explicitly the job of R13c. R13b only covers parity gaps already proven by real regressions (recent fixes `f074dfd` selected-photo baselines, `6c2c48f` POS commercial quick actions) or surfaced during manual usage/testing of the centralized edit-mode interactivity contract. No new test framework, no new abstractions, no orchestrator refactor.

## Read First

- `AGENTS.md` — narrow context rule, docs-only progress behavior.
- `context/reviews/r13-freeze-gate-assessment.md` — R13 purpose, R13b scope ("run/wire ... add only missing regression tests where a critical parity behavior has no automated assertion").
- `context/reviews/r13-freeze-checklist.md` — the one R13b-candidate parity line ("Terminology cleanup... no dedicated automated assertion in the inventory; R13b candidate").
- `context/reviews/r13-verification-inventory.md` — current matrix; every new test added by R13b must land here with `decision = centralization-gate`.
- `context/feature-specs/108-r13a-verification-inventory.md` — wiring contract for `test:centralization`.
- `context/progress-tracker.md` Open Follow-Ups — names the two R13b inputs (terminology assertion + `pos-reductive-approval` triage).
- `scripts/run-centralization-tests.ts` — the literal file list R13b extends.
- `tests/orders/centralization-cleanup.test.ts` — pattern for source-level invariant guards (R12 style).
- `src/components/orders/editing-workflow-form.tsx`, `src/modules/orders/order.service.ts` — the two known live "base payment" strings.
- `tests/integration/pos-reductive-approval.test.ts` — the failing test under triage.
- Recent commits `f074dfd` (selected-photo baselines) and `6c2c48f` (POS commercial quick actions) — establish the projector ↔ UI contracts R13b parity-locks.

## Rules

- **Verification-only mindset.** R13b adds tests and replaces literal user-facing strings as part of the intentional terminology cleanup. No projector, policy, write-service, schema, or workflow behavior change.
- **No new abstractions or helpers.** New parity tests share fixtures with existing tests where possible. Do not introduce a "parity DSL," shared matrix builder, or new fixture loader.
- **No new test framework.** Continue with `node:test` via `node --import tsx --test` per the R13a wiring.
- **Every new test goes into the gate.** Each new `*.test.ts(x)` file ships with (a) an inventory row tagged `centralization-gate`, and (b) an entry in `scripts/run-centralization-tests.ts`. Byte-equivalence of the two lists is preserved (asserted in R13a acceptance, still required here).
- **`pos-reductive-approval` is diagnose-and-classify only.** R13b does not fix production code on its behalf. If the diagnosis identifies a real bug, R13b opens a follow-up entry and stops. If it identifies a broken test, R13b fixes the test only and wires it into the gate.
- **No CI workflow file change.** Same as R13a.
- **The terminology cleanup is the one production-source change R13b is allowed to make.** It replaces the two known live "base payment" strings with their intentional "deposit" equivalents and locks the result with a source guard. No other production-source edits.
- **No churn in existing test files** except (a) adding the render snapshot guard for the deposit terminology on a surface that already has a render test, and (b) the targeted edit to `tests/integration/pos-reductive-approval.test.ts` if and only if triage classifies it as a broken test.

## Scope

### In Scope

#### A. `pos-reductive-approval` triage

- Reproduce the failure in isolation (the failure mode noted in `progress-tracker.md`: `posActionErrorMessage` receives a non-object `PrismaClientKnownRequestError` right-hand side).
- Determine the cause: production bug, stale fixture, brittle assertion, or test harness mismatch.
- If the cause is a **broken test** (fixture/assertion/harness): fix only the test, add it to the `test:centralization` runner, and update its inventory entry from `out-of-scope-for-R13` to `centralization-gate`.
- If the cause is a **real production bug**: do **not** fix it in R13b. Document the diagnosis (file + line + observed vs expected) in `context/progress-tracker.md` Open Follow-Ups as a discrete R13 finding with the proposed fix-spec name. Leave the inventory entry as `out-of-scope-for-R13` and add a brief note in `context/reviews/r13-verification-inventory.md` referencing the finding. The freeze gate documents the deferral; it does not pretend the test is green.

#### B. Terminology cleanup — "Base payment" → "deposit"

- Replace the two known live user-facing strings:
  - `src/components/orders/editing-workflow-form.tsx:87` — "...until the base payment exists." → "...until the deposit exists."
  - `src/modules/orders/order.service.ts:3207` — "Record base payment on booking to begin selection" → "Record deposit on booking to begin selection".
- Grep once more before committing for `base payment`, `Base payment`, `Base Payment` (case-insensitive) across `app/`, `src/`. Replace every additional live user-facing occurrence with the intentional "deposit" wording. Code-only identifiers, variable names, fixture/seed text, and comments are out of scope unless they are user-visible strings.
- Add a source-level guard test at `tests/architecture/deposit-terminology.test.ts` that:
  - Scans every production source file under `app/` and `src/` (excluding `**/*.test.ts(x)`, `tests/`, `scripts/`, `node_modules/`, generated Prisma client, and any explicit allowlist).
  - Asserts the case-insensitive regex `/\bbase payment\b/i` matches zero occurrences in user-visible string positions. To avoid false positives on code identifiers, scope the assertion to string-literal positions: a per-line check that the match falls inside a single- or double-quoted string or a JSX text node is acceptable; if scoping proves brittle, fall back to a strict literal-text scan of the same files and document any allowlisted occurrence inline with a comment naming this spec.
  - Maintains an explicit allowlist (empty after R13b ships) so future intentional appearances must be declared, not silently introduced.
- Add a render-level snapshot guard on one representative surface: extend `tests/orders/financial-sidebar-draft.test.tsx` (or whichever existing draft-state render test already covers the deposit string) with one additional assertion that the rendered output contains "deposit" and does **not** contain "base payment" (case-insensitive). If no existing render test covers this string, add a single small new render test at `tests/orders/deposit-terminology-render.test.tsx` that renders the editing-workflow-form gating message and asserts the same. Do not introduce a new fixture or render helper — reuse what the chosen existing test uses.
- Both the source guard and the render guard are added to the inventory as `centralization-gate` and wired into the runner.

#### C. Parity assertions for the three regression-proven gaps

Each gap below ships as one new focused test file. All new files are `centralization-gate` and wired into the runner. Each assertion is **read-only**: it asserts the relationship between an existing canonical projector/policy output and an existing UI consumer or surface — it does not introduce new projector or policy code. Each is included because a real regression (commit on file) or a manual usage path has already demonstrated the missing guard.

1. **Adjustment Workspace selected-photo baseline parity** — `tests/adjustment-workspace/selected-photo-baseline-parity.test.ts`. Regression source: `f074dfd` ("fix: preserve adjustment selected-photo baselines"). Construct one fixture per state covered by `to-draft-pos-composition.ts` after that fix (locked, locked+staged, locked+finalized). Assert: the `selectedPhotoBaseline` numbers projected by `order-composition.service.ts` equal the baseline numbers that `adjustment-workspace.service.ts` carries through staging and finalization. Cross-module parity, not re-derivation — import from both modules and assert equality on the same fixture.
2. **Commercial Actions add-on catalog parity** — `tests/orders/commercial-actions-add-on-catalog-parity.test.tsx`. Regression source: `6c2c48f` ("fix: enable pos commercial quick actions"). Build one fixture exercising the add-on marketplace states tracked by `tests/orders/pos-handler-components.test.tsx` after that fix (current rows, duplicate counts, "Added" state, empty state, removal target). Render `pos-add-on-marketplace.tsx` and assert the rendered rows match the projected catalog one-to-one, including duplicate counts and removal-target IDs. Reuse the existing fixture from `pos-handler-components.test.tsx`; do not invent a new one.
3. **Locked vs adjustment edit interactivity parity** — `tests/orders/edit-mode-interactivity-parity.test.tsx`. Surfaced via manual usage of the centralized edit-mode contract; the policy unit tests do not currently render-verify the policy ↔ UI relationship. For one locked order fixture, render the order detail edit surface twice — once in locked mode, once with the Adjustment Workspace open — and assert which controls are interactive (enabled/disabled/hidden) in each mode. The expected interactivity comes from `edit-mode-policy.ts`.

The following parity matrices are explicitly **deferred to R13c** (broader cross-surface and workflow smoke verification owns them, not R13b):

- Orders table ↔ customer history financial parity (cross-surface).
- Adjustment Workspace package/session metadata parity (cross-projector matrix).
- Workflow action availability parity (cross-policy matrix).

Each is recorded as an R13c input in `context/progress-tracker.md` Open Follow-Ups so R13c starts with the queue already named.

#### D. Wiring

- Every new test file (or render-test extension that creates a new file) appears in `scripts/run-centralization-tests.ts`.
- Each new entry is added to `context/reviews/r13-verification-inventory.md` under its correct category with `decision = centralization-gate` and a one-sentence scope summary.
- The inventory ↔ runner byte-equivalence asserted in R13a acceptance is preserved.
- The freeze checklist parity-area lines covered by the three regression-proven tests (selected-photo baseline, Commercial Actions add-on catalog, edit-mode interactivity) are updated to also link to the new parity test.
- The three deferred matrices (orders table ↔ customer history, Adjustment Workspace package/session metadata, workflow action availability) have their corresponding freeze-checklist lines annotated as "R13c candidate — broader cross-surface/cross-projector/cross-policy parity matrix" so the deferral is visible at the checklist level.
- The single R13b-candidate line in the checklist ("Terminology cleanup... no dedicated automated assertion") is updated to link to `tests/architecture/deposit-terminology.test.ts` and the render guard.

#### E. Validation runs

- `npm run test:centralization` exits 0 with the new files included.
- `npm run test:backend-invariants`, `npm run test:financial-invariants`, `npm run build`, `npm run lint` all exit 0.
- If the `pos-reductive-approval` triage concludes "broken test, fixed", `npm run test:centralization` includes that file in its run set and still exits 0.

### Out of Scope

- Any production code change other than the two known "base payment" → "deposit" string replacements (and any additional live user-visible occurrences uncovered by the final grep).
- Fixing the `pos-reductive-approval` failure if triage classifies it as a real production bug.
- New projector code, new policy code, new view-model code.
- **Orders table ↔ customer history financial parity** — cross-surface matrix, deferred to R13c.
- **Adjustment Workspace package/session metadata parity** — cross-projector matrix, deferred to R13c.
- **Workflow action availability parity** — cross-policy matrix, deferred to R13c.
- Any other broad cross-surface, cross-projector, or cross-policy parity matrix not already proven necessary by a real regression or a manual-usage finding. Such matrices belong to R13c.
- Smoke tests for end-to-end real workflows — deferred to R13c.
- Manual QA checklist body content — deferred to R13d.
- Reconciliation target selection, reconciliation secret setup, monitoring wiring.
- Any change to `context/architecture-context.md`, `context/code-standards.md`, `context/ai-workflow-rules.md`, `context/project-overview.md`, `context/target-data-model.md`, `context/ui-context.md`.
- Any change to the body of `context/reviews/centralization-roadmap.md` or `context/reviews/r13-freeze-gate-assessment.md`.
- Renaming, relocating, splitting, or consolidating existing test files.
- New npm scripts, new CI workflow files.
- Replacing `node:test` with another framework.
- Adding a "parity DSL," shared cross-surface fixture loader, or test-utility module.
- Performance changes to `orders-table-projections.service.ts` (still tracked as a separate follow-up).
- Adjustment Workspace, Edit-mode policy, or workflow policy business behavior changes.

## Implementation Direction

R13b is six small parity tests + two terminology guards + one triage, with consistent wiring.

### 1. Triage `pos-reductive-approval`

Run the file in isolation: `node --import tsx --test tests/integration/pos-reductive-approval.test.ts`. Capture the stack trace and the exact line where `posActionErrorMessage` receives the non-object RHS. Walk the call chain from the test fixture through to the action error path. Classify:

- **Broken test** → minimal fix in the test or its local helper. Update inventory entry to `centralization-gate`. Add to runner.
- **Real production bug** → write a discrete finding entry in `progress-tracker.md` Open Follow-Ups (one short paragraph: symptom, suspected cause, file + line, proposed fix-spec name). Add a one-line note in the inventory entry. Do not modify production code.

In either branch, the test must not be left in a state where it passes by accident or is silently skipped.

### 2. Terminology cleanup

Edit the two known strings, then grep for any remaining live occurrences and replace those too. Add `tests/architecture/deposit-terminology.test.ts` with the scan logic and an explicit allowlist (empty). Add or extend a single render test asserting "deposit" appears and "base payment" does not on a representative surface.

### 3. Three regression-proven parity tests

Each test is one file, one fixture per relevant state, direct equality assertion between two existing canonical sources. No abstraction layer between them. Prefer reusing fixtures already present in the file the parity test borrows from. The three are: selected-photo baseline parity, Commercial Actions add-on catalog parity, locked vs adjustment edit interactivity parity (see §C). Anything broader is R13c.

For tests that render React, follow the existing `*.test.tsx` patterns in `tests/orders/` and `tests/composition-view/` — same testing-library setup, same render helpers. Do not introduce a new render harness.

### 4. Runner + inventory + checklist sync

After the new files exist:

- Append each path to `scripts/run-centralization-tests.ts` in alphabetical order within its category-adjacent block (matching the file's existing ordering style).
- Append each entry to `context/reviews/r13-verification-inventory.md` under its correct category with `decision = centralization-gate`, alphabetized within the category.
- Edit the relevant parity-area lines in `context/reviews/r13-freeze-checklist.md` to reference the new tests. Update the terminology line to link to the source guard and the render guard.

### 5. Validation

Run the full automated gate set listed in §E. Capture exit codes in the PR description (or in the commit body if no PR), not in a tracked file.

### 6. Progress tracker

Update `context/progress-tracker.md` Now to reflect R13b status. Remove the two completed Open Follow-Ups (the terminology assertion is now wired; `pos-reductive-approval` is either fixed or has been re-cast as a discrete finding). If a new discrete finding was added during triage, it appears as a new Open Follow-Up.

Add three new Open Follow-Up entries naming the deferred parity matrices as R13c inputs:

- "R13c: orders table ↔ customer history financial parity (cross-surface matrix)."
- "R13c: Adjustment Workspace package/session metadata parity (cross-projector matrix)."
- "R13c: workflow action availability parity (cross-policy matrix)."

## What R13b Must Not Touch

- `prisma/`, `app/api/`, any write-service file in `src/modules/**/*.service.ts` for behavior — string-only edits in `order.service.ts` for the terminology cleanup are the sole exception.
- `src/modules/financial-cases/**`, `src/modules/orders/composition/**`, `src/modules/orders/policies/**`, `src/modules/bookings/booking-workflow-policy.ts`, `src/modules/orders/adjustment-workspace/**` — read-only for R13b.
- `.github/workflows/**`.
- `context/architecture-context.md`, `context/code-standards.md`, `context/ai-workflow-rules.md`, `context/project-overview.md`, `context/target-data-model.md`, `context/ui-context.md`, `context/development-utilities.md`, `context/git-conventions.md`.
- Body of `context/reviews/centralization-roadmap.md` or `context/reviews/r13-freeze-gate-assessment.md`.
- Any existing test file's assertions, except the targeted render-guard extension in §B and the triage fix in §A (if classified as broken test).

## Observability Checklist

### Dashboards / Metrics

- No new metric. The expanded `test:centralization` gate is the entire R13b signal.

### Rollback Plan

- Revert the new test files, undo their inventory and runner entries, restore the two "base payment" strings, revert the render-guard extension, and remove any new Open Follow-Up entries. No schema, no data, no runtime impact.

### Customer-Visible Surface

- Two visible string changes: "base payment" → "deposit" in the editing-workflow gating message and in the locked-selection placeholder string. No other UI change.

## Post-Implementation

- `context/progress-tracker.md` Now reflects R13b completion and names R13c as the next spec.
- The two prior Open Follow-Ups (terminology assertion, `pos-reductive-approval` triage) are removed or replaced with the discrete finding produced by triage.
- `context/reviews/r13-verification-inventory.md` includes the new test rows.
- `context/reviews/r13-freeze-checklist.md` no longer flags any line as an R13b candidate. The terminology line links to the new source + render guards. The three deferred cross-surface/cross-projector/cross-policy matrices are clearly annotated as R13c candidates.

## Acceptance Criteria

- `tests/architecture/deposit-terminology.test.ts` exists, scans `app/` and `src/`, asserts zero case-insensitive `base payment` matches in user-visible string positions, and includes an explicit (empty) allowlist constant.
- A render-level deposit-terminology assertion exists — either as a new file `tests/orders/deposit-terminology-render.test.tsx` or as a clearly-marked extension of an existing draft-state render test in `tests/orders/` — and asserts the rendered surface contains "deposit" and not "base payment" (case-insensitive).
- Production source contains zero live user-visible "base payment" occurrences. The two known strings (`editing-workflow-form.tsx:87` and `order.service.ts:3207`) are replaced with "deposit"-worded equivalents that preserve the original meaning. Any additional live occurrence uncovered by the grep is replaced or explicitly allowlisted with a code comment naming this spec.
- The three regression-proven parity tests exist at the paths named in §C (selected-photo baseline, Commercial Actions add-on catalog, locked vs adjustment edit interactivity), each ships with a single focused fixture per state, and each asserts equality between two existing canonical sources without introducing new projector, policy, or view-model code.
- The three deferred parity matrices (orders table ↔ customer history financial, Adjustment Workspace package/session metadata, workflow action availability) are recorded in `context/progress-tracker.md` Open Follow-Ups as R13c inputs. They are not implemented in R13b.
- Every new test file from §B and §C appears in `scripts/run-centralization-tests.ts` and in `context/reviews/r13-verification-inventory.md` with `decision = centralization-gate`. The inventory ↔ runner byte-equivalence holds: every `centralization-gate` row is in the runner; every runner line is in the inventory.
- `context/reviews/r13-freeze-checklist.md` no longer marks the terminology line as an R13b candidate. The parity-area lines referencing the three new tests are updated to include the new inventory rows. The three deferred matrices have their corresponding checklist lines annotated as R13c candidates.
- `tests/integration/pos-reductive-approval.test.ts` is one of: (a) fixed as a broken test, moved to `centralization-gate`, and included in the runner; or (b) classified as a real production bug, with the diagnosis captured in `context/progress-tracker.md` Open Follow-Ups and the inventory entry annotated. It is not silently skipped, deleted, or marked passing without resolution.
- `npm run test:centralization` exits 0 with all new files included.
- `npm run test:backend-invariants` exits 0.
- `npm run test:financial-invariants` exits 0.
- `npm run build` exits 0.
- `npm run lint` exits 0 (the pre-existing warning in `tests/financial-phase-c/edge-cases.ts` may remain — it is not introduced by R13b).
- No file under `prisma/`, `app/api/`, `.github/workflows/`, or `src/modules/**` (other than the single string-replacement edit in `order.service.ts`) is modified.
- No new npm script, no new CI workflow file, no new test framework, no new test-utility module is added.
- `context/progress-tracker.md` Now reflects R13b completion. The two completed Open Follow-Ups are removed; any new discrete finding from triage is added.
- `context/reviews/centralization-roadmap.md`, `context/reviews/r13-freeze-gate-assessment.md`, `context/architecture-context.md`, and `context/code-standards.md` are unchanged.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector instead of re-deriving in pages or components. (R13b adds no new such surface; all new assertions read from existing projectors/policies.)
