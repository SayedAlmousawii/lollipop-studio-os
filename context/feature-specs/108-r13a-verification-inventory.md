# Feature 108 - R13a: Verification Inventory + Test Gate Wiring

## Goal

Make the existing R0–R12 centralization safety net discoverable and runnable as a single, named gate so R13 can be executed without insider knowledge of which `node:test` files to invoke. Inventory the existing tests by area, wire a single npm script that runs the centralization regression set, and publish the canonical R13 freeze checklist. No business behavior changes, no new architecture, no new abstractions.

## Read First

- `AGENTS.md` — narrow context rule, docs-only progress behavior.
- `context/reviews/r13-freeze-gate-assessment.md` — R13 purpose, structure (R13a→R13d), recommended scope, blockers.
- `context/feature-specs/107-r12-compatibility-cleanup.md` — most recent completed centralization spec; baseline that R13 verifies.
- `context/progress-tracker.md` — current Now, Open Follow-Ups (orders-table-projections performance follow-up, any deferred R12 sub-changes).
- `package.json` — existing `test:backend-invariants`, `test:financial-invariants`, `financial:reconcile`, `build`, `lint` scripts.
- `tests/` — existing `node:test` files across `architecture/`, `financial/`, `financial/financial-case-summary/`, `orders/`, `bookings/`, `composition-view/`, `adjustment-workspace/`, `formatting/`, `audit/`, `auth/`, `invoices/`, `payments/`, `pricing/`, `session-configurations/`, `session-types/`, `integration/`.

## Rules

- **Inventory and wiring only. No new tests, no rewrites, no consolidation of existing test files.** If a parity hole is found during inventory, it is logged for R13b — it is not filled here.
- **No production code change.** Only changes allowed are: `package.json` scripts, a runner shim if needed, and documentation files under `context/reviews/`.
- **No new test framework, no jest, no vitest.** Continue using `node --test` / `node:test` exactly as existing scripts do.
- **No CI workflow file change** in this spec. CI integration is a separate concern; R13a documents which command CI *should* call but does not edit CI configuration.
- **Single canonical command.** The wired script must run the full R13 automated regression set in one invocation. It must not silently skip files. Failures must exit non-zero.
- **No behavior-touching imports moved.** Wiring the runner must not require renaming, relocating, or restructuring existing test files. If a test file is currently runnable in isolation via `node --import tsx --test path/to/file.test.ts`, the wiring uses that exact invocation pattern.
- **Inventory document is the source of truth for the matrix.** The R13 freeze checklist references it; it does not duplicate its content.

## Scope

### In Scope

- Walk `tests/` and produce a categorized inventory document at `context/reviews/r13-verification-inventory.md`. Categories: Architecture Guards, Financial Invariants, FinancialCase Summary / Projector Parity, Orders / Projections, Bookings, Composition View, Adjustment Workspace, Edit-Mode / Workflow Policies, Money Formatting, Audit, Auth, Other Backend Invariants. Each entry lists the test file path, the area it covers, and whether it is currently reachable via `npm run test:backend-invariants`, `npm run test:financial-invariants`, both, or **neither**.
- Add a single npm script (`test:centralization`) that runs every `tests/**/*.test.ts` file relevant to R0–R12 centralization regression coverage via `node --import tsx --test` with an explicit file list (no glob expansion ambiguity). The script must succeed with exit 0 only if every wired test passes.
- The wired script must include, at minimum, every file currently in the inventory's Architecture Guards, FinancialCase Summary / Projector Parity, Orders / Projections, Bookings (centralization-relevant only — not unrelated booking tests), Composition View, Adjustment Workspace, Edit-Mode / Workflow Policies, and Money Formatting categories. Audit/auth/session/pricing/integration files that are unrelated to R0–R12 centralization are documented in the inventory but not required to be wired into `test:centralization` — they remain runnable individually and are covered by the existing per-area scripts where they exist.
- Add a small thin runner script at `scripts/run-centralization-tests.ts` (or extend an existing pattern if one exists for `test:backend-invariants`) that takes the explicit file list and shells out to `node --import tsx --test` once with all files. The runner must not invent new test discovery logic — it is a literal file list invoked in one process.
- Publish `context/reviews/r13-freeze-checklist.md` — the canonical R13 freeze gate checklist. It enumerates the automated gates (with the exact npm command for each), the manual QA checklist headings (deferred to R13d for body content), the acceptance/blocker list mirrored from `r13-freeze-gate-assessment.md`, and a pointer to the inventory.
- Update `context/progress-tracker.md` Now to reflect R13a in flight / completed, and add R13a to the centralization roadmap status.
- Cross-reference the new inventory + checklist from `context/reviews/centralization-roadmap.md` (one-line pointer at the bottom of the document — no rewrite).

### Out of Scope

- Writing any new test, parity assertion, smoke test, or fixture. All such work belongs to R13b / R13c.
- Modifying any existing test file's contents, imports, or assertions.
- Consolidating multiple test files into one, splitting a file, or relocating files.
- Removing, retiring, or rewording existing test names.
- Editing CI workflow files (`.github/workflows/**`).
- Wiring reconciliation (`financial:reconcile`) into `test:centralization`. It stays a separate command per the assessment; the checklist lists it as a parallel required gate.
- Wiring `build` or `lint` into `test:centralization`. They stay separate top-level gates.
- Adding orchestrator scripts that produce summary reports, JSON exports, or HTML output. The runner exits 0 or non-zero — that is the contract.
- Renaming any existing npm script.
- Touching production code under `src/`, `app/`, `prisma/`.
- Manual QA checklist body content (deferred to R13d).
- End-to-end smoke tests (deferred to R13c).
- Adding new architecture guard tests, new source-level invariants, or new projector parity tests.

## Implementation Direction

R13a is a documentation + wiring pass. It produces three artifacts and one script.

### 1. Inventory document — `context/reviews/r13-verification-inventory.md`

Enumerate every file under `tests/` once. For each file, record:

- **Path** (relative to repo root).
- **Category** (from the fixed list in the In Scope section).
- **Scope summary** — one sentence on what business behavior or invariant the file guards. Source the sentence from the file's top-level describe/test names; do not infer beyond what the file actually asserts.
- **Reachability today** — one of: `test:backend-invariants`, `test:financial-invariants`, `both`, `none`.
- **R13 wiring decision** — one of: `centralization-gate` (will be included in `test:centralization`), `existing-script` (already in `test:backend-invariants` or `test:financial-invariants` — no change), `out-of-scope-for-R13` (kept individually runnable, not part of the freeze gate).

The inventory is grouped by category, alphabetized within each category. It opens with a one-paragraph preamble naming `r13-freeze-gate-assessment.md` as the parent context and stating the inventory is a snapshot as of the R13a draft date.

If an inventory entry's reachability is `none` and its decision is `centralization-gate`, that file appears in the runner script's file list. There must be no entry where `decision = centralization-gate` and the file is not in the runner. The acceptance criteria assert this consistency.

### 2. Runner script — `scripts/run-centralization-tests.ts`

A literal file list passed to `node --test`. Shape:

```ts
import { spawnSync } from "node:child_process";

const files = [
  // architecture guards
  "tests/architecture/service-only-db-access.test.ts",
  "tests/architecture/financial-case-read-layer-cleanup.test.ts",
  // ...full list per inventory `centralization-gate` rows...
];

const result = spawnSync(
  "node",
  ["--import", "tsx", "--test", ...files],
  { stdio: "inherit" }
);

process.exit(result.status ?? 1);
```

The file list is derived from the inventory and committed verbatim — not globbed at runtime. The runner contains no other logic.

If the existing `tests/backend-invariants/run.ts` already follows a literal-list pattern, reuse its shape rather than introducing a new style.

### 3. npm script

Add to `package.json`:

```
"test:centralization": "NODE_ENV=development node --import tsx scripts/run-centralization-tests.ts"
```

No other script renamed or removed. Existing `test:backend-invariants` and `test:financial-invariants` remain as-is; the inventory documents the overlap (some files may legitimately be reachable both via an existing script and via `test:centralization` — that is acceptable, since the freeze gate runs all three).

### 4. Freeze checklist — `context/reviews/r13-freeze-checklist.md`

Single canonical R13 checklist. Sections:

- **Automated gates (must pass)** — explicit command per line:
  - `npm run build`
  - `npm run lint`
  - `npm run test:backend-invariants`
  - `npm run test:financial-invariants`
  - `npm run test:centralization`
  - `npm run financial:reconcile` (against the R13 fixture/dev target — exact target named here once chosen)
- **Architecture guards (must pass)** — list mirrored from `r13-freeze-gate-assessment.md` Recommended Acceptance Criteria, each tied to the inventory entry that asserts it.
- **Parity verification areas** — bullet list mirrored from the assessment's Recommended Parity-Verification Areas. Each bullet links to the inventory row that currently covers it, or is explicitly flagged "no automated assertion — R13b candidate" if uncovered.
- **Manual QA (R13d)** — headings only: POS visual/interaction parity, Order detail, Booking detail, Adjustment Workspace, Reconciliation secrets/monitor, Known acceptable behavior changes, Signoff. Body content is deferred to R13d; R13a only stakes the structure.
- **Completion blockers** — mirrored verbatim from the assessment's Completion Blockers section.
- **Pointer** — link to `context/reviews/r13-verification-inventory.md` as the source-of-truth matrix.

The checklist does not duplicate inventory content; it references it.

### 5. Inventory ↔ checklist consistency

Every automated gate command in the checklist must map to an existing npm script after this spec lands. Every parity area in the checklist must either link to an inventory row tagged `centralization-gate` or `existing-script`, or be explicitly tagged as an R13b candidate. The acceptance criteria assert both.

### 6. Roadmap pointer

Append a single line to the bottom of `context/reviews/centralization-roadmap.md`:

> R13 freeze gate: see `context/reviews/r13-freeze-gate-assessment.md`, `context/reviews/r13-verification-inventory.md`, `context/reviews/r13-freeze-checklist.md`.

No other edit to the roadmap.

### 7. Progress tracker

Update `context/progress-tracker.md` Now to record R13a in flight / completed. Do not re-summarize the assessment. Do not move R12 follow-ups.

## What R13a Must Not Touch

- Any file under `src/`, `app/`, `prisma/`.
- Any existing test file's contents.
- `.github/workflows/**`.
- `context/architecture-context.md`, `context/code-standards.md`, `context/ai-workflow-rules.md`, `context/project-overview.md`, `context/target-data-model.md`, `context/ui-context.md`, `context/development-utilities.md`, `context/git-conventions.md` — unchanged.
- The `centralization-roadmap.md` body (only the one-line pointer at the end is added).
- The `r13-freeze-gate-assessment.md` file — it remains the parent assessment; R13a references it, does not edit it.

## Observability Checklist

### Dashboards / Metrics

- No new metric. R13a does not introduce a production code path.
- The wired `test:centralization` command is the new local/CI signal; failing exit codes are the entirety of its observability surface.

### Rollback Plan

- Pure additive: revert the `package.json` script entry, delete `scripts/run-centralization-tests.ts`, delete the two new docs under `context/reviews/`, and remove the one-line pointer at the bottom of `centralization-roadmap.md`. No data, no schema, no runtime impact.

### Customer-Visible Surface

- Zero. Internal verification tooling only.

## Post-Implementation

- `context/progress-tracker.md` Now reflects R13a completion and names R13b as the next spec.
- `context/reviews/r13-verification-inventory.md` and `context/reviews/r13-freeze-checklist.md` exist and are referenced from the roadmap.
- Any parity areas the inventory flagged "no automated assertion — R13b candidate" are listed in Open Follow-Ups as inputs to the R13b spec.

## Acceptance Criteria

- `context/reviews/r13-verification-inventory.md` exists, enumerates every file under `tests/` once, and assigns each one a Category, Scope summary, Reachability, and R13 wiring decision per §1.
- `context/reviews/r13-freeze-checklist.md` exists and contains the six automated-gate commands, architecture guards list, parity verification areas (each linked to an inventory row or flagged R13b-candidate), manual QA headings (no body), and completion blockers per §4.
- `scripts/run-centralization-tests.ts` exists and contains a literal, committed file list — no glob expansion, no dynamic discovery.
- Every test file in the runner's list has an inventory entry with `decision = centralization-gate`. Every inventory entry with `decision = centralization-gate` appears in the runner's list. The two lists are byte-equivalent in membership.
- `package.json` includes a new `test:centralization` script that invokes the runner via `node --import tsx scripts/run-centralization-tests.ts`. No existing script is renamed, deleted, or otherwise altered.
- `npm run test:centralization` runs end-to-end on a clean checkout and exits 0 on the current `development` branch. (If any wired test currently fails on `development`, R13a is blocked — the failure is an R13 finding and must be triaged before R13a ships.)
- `npm run test:backend-invariants` and `npm run test:financial-invariants` still exit 0 and behave identically to pre-R13a.
- `context/reviews/centralization-roadmap.md` has exactly one new line appended pointing to the three R13 documents. The rest of the file is byte-identical to pre-R13a.
- `context/progress-tracker.md` Now reflects R13a status. No R0–R12 historical entry is rewritten.
- No file under `src/`, `app/`, `prisma/`, `tests/`, or `.github/workflows/` is modified by this spec.
- `npm run build` passes.
- `npm run lint` passes.
