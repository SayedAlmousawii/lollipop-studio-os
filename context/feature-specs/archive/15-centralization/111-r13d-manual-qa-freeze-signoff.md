# Feature 111 - R13d: Manual Operational QA + Freeze Signoff

## Goal

Close the R13 freeze gate. R13d fills in the manual QA bodies the freeze checklist has been stubbing since R13a, verifies the production reconciliation operational surface (secrets, Slack, Healthchecks) is configured, captures the structured list of intentional behavior changes accumulated across R0–R12, and records the explicit freeze signoff. After R13d ships, the centralization roadmap is marked complete and trusted.

R13d is documentation, verification, and signoff. It is not a code phase. The only file touches outside `context/reviews/` are progress-tracker bookkeeping and one closing line in the roadmap.

## Read First

- `AGENTS.md` — narrow context rule, docs-only progress behavior.
- `context/reviews/r13-freeze-gate-assessment.md` — R13d section (manual QA, signoff criteria, completion blockers, Definition Of "Centralization Roadmap Complete And Trusted").
- `context/reviews/r13-freeze-checklist.md` — the canonical checklist whose Manual QA section R13d fills in, and whose Automated Gates section R13d re-confirms.
- `context/reviews/r13-verification-inventory.md` — source of truth for which automated assertions back each parity area.
- `context/progress-tracker.md` Feature History — source for the acceptable-changes log (R12 deposit-dedup removal, R13b "Base payment" → "deposit", any other R0–R12 intentional improvements).
- `context/feature-specs/108-r13a-verification-inventory.md`, `109-r13b-automated-regression-gate.md`, `110-r13c-workflow-smoke-and-parity.md` — three prior R13 specs; R13d closes the loop they opened.
- `context/reviews/centralization-roadmap.md` — receives the one closing-status line at the end of R13d.

## Rules

- **Documentation + verification + signoff only.** No production code change. No test file change. No fixture change. No new npm script. No CI workflow change.
- **Dev runs the manual QA once before freeze.** R13d is not staff-facing. The checklist is dev-runnable on dev/staging in one pass. If a staff pass is later deemed necessary, that is a separate spec.
- **Reconciliation is verify-only.** R13d confirms the operational reconciliation surface is configured. If anything is unconfigured, R13d records the gap as a discrete deferral with explicit signoff acknowledgement — R13d does not perform setup, does not edit secrets, does not write infra.
- **Signoff is explicit.** The spec ends with a named "R13 signoff: `<name>`, `<date>`" line in the freeze checklist, plus the acceptable-changes log acknowledged at signoff. The PR merge alone is not the signoff — the named line is.
- **Acceptable-changes log is structured.** Each entry: one line description, the spec / commit that introduced it, and a one-line rationale. Sourced from `context/progress-tracker.md` Feature History and recent commits; not invented.
- **No new files outside `context/reviews/`** except the progress-tracker edit. The freeze checklist absorbs the manual QA body content; a new sibling doc is not created.
- **Manual QA bodies are concrete.** Each item is a specific action the dev performs on dev/staging, with a specific observable outcome to confirm. "Verify the order detail looks right" is not acceptable; "Open `/orders/<id>` for a locked+adjusted order, confirm the financial sidebar shows the same `totalAmount`/`paidAmount`/`remainingAmount` as the orders-table row for the same order" is.
- **No retroactive rule changes.** R13d does not edit R0–R12 specs, does not edit `context/architecture-context.md`, does not edit `context/code-standards.md`. If R13d finds a documentation gap in those files, it records a follow-up.
- **Freeze blockers are the assessment's list, verbatim.** R13d does not add or relax blockers.

## Scope

### In Scope

#### A. Fill the freeze checklist's Manual QA section

The current Manual QA section in `context/reviews/r13-freeze-checklist.md` has seven heading stubs (POS visual/interaction parity, Order detail, Booking detail, Adjustment Workspace, Reconciliation secrets/monitor, Known acceptable behavior changes, Signoff). R13d replaces each heading's empty body with a concrete dev-runnable checklist. Each item is a specific action + observable outcome.

The seven sections cover, at minimum:

1. **POS visual / interaction parity** — POS draft composition for a representative session type; package/add-on selection; session-configuration totals; deposit recording; invoice finalization; payment dialog. Each item names the surface to open, the action to perform, and the expected projector-backed value to confirm visually.
2. **Order detail** — Open one order per representative state (draft, locked, locked+adjusted, refunded, credit-noted, overpaid, overridden). For each, confirm the financial sidebar totals match the orders-table row, the composition view matches the locked POS surface, and the edit-mode policy enables/disables controls as documented.
3. **Booking detail** — Open one booking for each lifecycle position (booking-stage, active-stage, post-checkin). Confirm financial section values match the FinancialCase projection and the deposit-invoice list renders newest-first.
4. **Adjustment Workspace** — Open Adjustment Workspace on a locked order; stage one add and one remove; confirm pending preview, net delta, and selected-photo baseline display match the projector. Finalize; confirm the post-finalize financial state matches `FinancialCaseSummary`.
5. **Reconciliation secrets / monitor** — Verify-only. Confirm `DATABASE_URL`, any Slack webhook env var the reconciliation script reads, and any Healthchecks ping URL are present in the production environment configuration. Confirm `npm run financial:reconcile` is documented as scheduled (cron / CI / external scheduler — whichever is current). If anything is missing, R13d records the gap in this section and in the progress tracker as a discrete operational follow-up, and the signoff line explicitly acknowledges the deferral. R13d does not configure or rotate secrets.
6. **Known acceptable behavior changes** — see §B below; populated structurally, not as free text.
7. **Signoff** — see §D below.

For sections 1–4, prefer concrete item phrasing: "Open `/orders/<id>` for a locked+adjusted order. Confirm financial sidebar `totalAmount` matches the orders-table row's `totalAmount` for the same `orderId`." Avoid vague phrasing.

Each item should be runnable end-to-end on dev or staging without production data access.

#### B. Acceptable-changes log

Add a "Known acceptable behavior changes" subsection to the freeze checklist (heading already exists). Each entry uses this shape:

```
- <one-line description>
  - Source: <spec ID and/or commit short hash>
  - Rationale: <one line>
```

Populate from `context/progress-tracker.md` Feature History and recent commits. At minimum:

- "Base payment" → "deposit" terminology cleanup (Feature 109 / R13b; commit on file).
- Booking deposit-invoice dedup removed; deposit invoices now read from `row.financialCase.invoices` only (Feature 107 / R12; commit `10866d3`).
- Adjustment selected-photo baselines now preserved through staging/finalize (Feature, commit `f074dfd`).
- POS commercial quick actions re-enabled (commit `6c2c48f`).
- Any additional intentional improvement called out in `context/progress-tracker.md` Feature History for R0–R12 that has user-visible or staff-visible effect.

Each entry must point to a source — spec ID, commit, or both. Items without a traceable source are not added.

This subsection is the canonical record of what changed intentionally. Reviewers and future maintainers consult it before treating any R0–R12-era behavior as a bug.

#### C. Re-confirm automated gates

R13d does not re-implement automated tests. It re-runs the existing gates one more time as the freeze-eve verification:

- `npm run build`
- `npm run lint`
- `npm run test:backend-invariants`
- `npm run test:financial-invariants`
- `npm run test:centralization`
- `npm run financial:reconcile` against the R13 fixture/dev target

Each must exit 0. Results are captured in the R13d PR description (or commit body) — not in a tracked file. If any gate fails on the freeze-eve run, R13d does not ship; the failure becomes a discrete R13 finding and the relevant prior R13 spec (or a new fix-spec) is reopened.

#### D. Signoff

Add a final "Signoff" block at the bottom of the freeze checklist:

```
## Signoff

R13 signoff: <name>, <YYYY-MM-DD>

Acknowledged at signoff:
- Automated gates listed under "Automated Gates (Must Pass)" all exit 0 on the freeze-eve run.
- Manual QA sections 1–4 walked once on dev/staging by the named signer.
- Reconciliation operational surface verified per §5 (or deferral explicitly noted below).
- Acceptable-changes log reviewed; all entries are intentional and traceable.

Operational deferrals (if any):
- <one-line per deferral, or "None">
```

The PR that lands R13d fills in the name and date in the same commit. An empty name/date is a blocker.

#### E. Centralization roadmap closure

Append one closing-status line to the end of `context/reviews/centralization-roadmap.md`:

> R0–R13 centralization roadmap is complete and trusted as of `<YYYY-MM-DD>`. See `context/reviews/r13-freeze-checklist.md` for the signed freeze record.

No other edit to the roadmap.

#### F. Progress tracker

Update `context/progress-tracker.md`:

- Now: reflects R13d completion and the roadmap closure date.
- Feature History: one line for R13d.
- Open Follow-Ups: remove any items that R13d's acceptable-changes log absorbed as intentional. Add any new operational deferrals surfaced during §5 verification. Add any new findings from the freeze-eve gate runs.

#### G. Validation

- `npm run build` exits 0.
- `npm run lint` exits 0.
- `npm run test:backend-invariants` exits 0.
- `npm run test:financial-invariants` exits 0.
- `npm run test:centralization` exits 0.
- `npm run financial:reconcile` exits 0 against the R13 fixture/dev target.
- The named signoff line in the checklist is filled in.

### Out of Scope

- Any production code change.
- Any test file change. Including triage of any test failure surfaced during the freeze-eve runs — that becomes a separate fix-spec, not an R13d edit.
- Staff-facing QA passes on real hardware. If later deemed necessary, that is a separate spec.
- Reconciliation infra setup (creating secrets, configuring Slack webhooks, registering Healthchecks pings, wiring schedulers). R13d only verifies presence and documents deferrals.
- Editing R0–R12 specs.
- Editing `context/architecture-context.md`, `context/code-standards.md`, `context/ai-workflow-rules.md`, `context/project-overview.md`, `context/target-data-model.md`, `context/ui-context.md`, `context/development-utilities.md`, `context/git-conventions.md`.
- New files outside `context/reviews/` and `context/feature-specs/`.
- New npm scripts. New CI workflow files.
- Re-running the inventory or rewriting the freeze checklist's existing sections beyond filling the Manual QA bodies and adding the Acceptable-Changes log + Signoff block.
- Adding new automated assertions. Any gap discovered during manual QA is recorded as a follow-up for a future spec, not implemented here.

## Implementation Direction

R13d is the freeze-eve checklist run, the acceptable-changes log, and the signoff. In order:

### 1. Fill the seven Manual QA bodies

Open `context/reviews/r13-freeze-checklist.md`. Under each of the seven Manual QA headings, replace the empty body with concrete dev-runnable items per §A. Each item names the surface, the action, and the observable outcome. Cross-reference the inventory entries that automated the same parity area where applicable — manual QA confirms what the automated gates assert.

### 2. Build the acceptable-changes log

Walk `context/progress-tracker.md` Feature History from R0 forward. For each entry that introduced an intentional user-visible or staff-visible change, add a structured entry to the Acceptable-changes log per §B. Items without a traceable source (spec or commit) are skipped. The list is short and concrete — not a narrative.

### 3. Verify reconciliation operational surface

Inspect the environment configuration documented in the repo for the production reconciliation flow:

- Confirm `DATABASE_URL` is the production target in the production env.
- Confirm any Slack webhook env var the reconciliation script reads is present.
- Confirm any Healthchecks ping URL is present.
- Confirm the schedule (cron / CI / external scheduler) is documented and active.

If anything is missing, record it under §5 of the checklist as a deferral and add a discrete Open Follow-Up to the progress tracker. R13d does not perform setup.

### 4. Run the freeze-eve gates (§C)

Run all six commands. Capture exit codes in the PR / commit body. If any fails, stop. R13d does not ship over a failing gate.

### 5. Sign

Fill in the Signoff block at the bottom of the checklist with the named signer and ISO date. Acknowledge the four items in the block. If any operational deferral exists, list it in the deferrals subsection.

### 6. Close the roadmap (§E)

Append the one closing-status line to `context/reviews/centralization-roadmap.md`.

### 7. Update the progress tracker (§F)

Now, Feature History, Open Follow-Ups per §F.

## What R13d Must Not Touch

- `prisma/`, `app/`, `src/`, `tests/`, `scripts/` — read-only for R13d.
- `.github/workflows/**`.
- `context/architecture-context.md`, `context/code-standards.md`, `context/ai-workflow-rules.md`, `context/project-overview.md`, `context/target-data-model.md`, `context/ui-context.md`, `context/development-utilities.md`, `context/git-conventions.md`.
- `context/reviews/r13-freeze-gate-assessment.md` (assessment is closed; R13d implements its recommendations, does not edit it).
- `context/reviews/r13-verification-inventory.md` (closed by R13c).
- R0–R12 feature specs.
- `package.json`, `tsconfig.json`, `next.config.*`, any environment file.

## Observability Checklist

### Dashboards / Metrics

- No new metric. R13d is documentation + verification.
- Production reconciliation monitoring is verified, not introduced.

### Rollback Plan

- Revert the checklist edits, the roadmap closing line, and the progress-tracker edits. No code, schema, or data impact.

### Customer-Visible Surface

- Zero. Internal verification and signoff only.

## Post-Implementation

- `context/reviews/r13-freeze-checklist.md` Manual QA bodies are filled, Acceptable-changes log is populated, Signoff block is named and dated.
- `context/reviews/centralization-roadmap.md` has the one closing-status line appended.
- `context/progress-tracker.md` reflects R13d completion and the roadmap closure date.
- Any operational deferral surfaced during §5 verification is logged as an Open Follow-Up with explicit signoff acknowledgement.
- The centralization roadmap is considered complete and trusted per the assessment's Definition section.

## Acceptance Criteria

- `context/reviews/r13-freeze-checklist.md` Manual QA section 1 (POS visual/interaction parity) has concrete dev-runnable items covering POS draft composition, package/add-on selection, session-configuration totals, deposit recording, invoice finalization, and payment dialog. Each item names a surface, an action, and an observable outcome.
- Manual QA section 2 (Order detail) has concrete items covering one order per representative state (draft, locked, locked+adjusted, refunded, credit-noted, overpaid, overridden) confirming financial sidebar parity with the orders-table row, composition view parity with locked POS, and edit-mode policy interactivity.
- Manual QA section 3 (Booking detail) has concrete items covering booking-stage, active-stage, and post-checkin bookings, confirming financial section ↔ FinancialCase projection parity and deposit-invoice newest-first ordering.
- Manual QA section 4 (Adjustment Workspace) has concrete items covering staged add + remove, pending preview, net delta, selected-photo baseline display, and post-finalize FinancialCaseSummary parity.
- Manual QA section 5 (Reconciliation secrets/monitor) verifies presence of `DATABASE_URL`, Slack webhook env var, Healthchecks ping URL, and a documented schedule. Any missing item is recorded in this section and as a discrete Open Follow-Up in `context/progress-tracker.md`. R13d does not perform setup.
- Manual QA section 6 (Known acceptable behavior changes) is populated using the §B structure (description / source / rationale). At minimum it includes the "Base payment" → "deposit" cleanup (R13b), the booking deposit-invoice dedup removal (R12, commit `10866d3`), the adjustment selected-photo baseline preservation fix (commit `f074dfd`), and the POS commercial quick actions re-enablement (commit `6c2c48f`). Any additional intentional R0–R12 change with traceable source is also included. No entry lacks a source.
- Manual QA section 7 (Signoff) contains a filled-in `R13 signoff: <name>, <YYYY-MM-DD>` line, the four acknowledgement bullets, and the operational deferrals subsection (with explicit "None" if no deferral). Empty name or date is a blocker.
- `npm run build` exits 0 on the freeze-eve run.
- `npm run lint` exits 0 on the freeze-eve run (pre-existing warning in `tests/financial-phase-c/edge-cases.ts` may remain).
- `npm run test:backend-invariants` exits 0 on the freeze-eve run.
- `npm run test:financial-invariants` exits 0 on the freeze-eve run.
- `npm run test:centralization` exits 0 on the freeze-eve run.
- `npm run financial:reconcile` exits 0 against the R13 fixture/dev target on the freeze-eve run.
- `context/reviews/centralization-roadmap.md` has one new closing-status line at the end naming the roadmap complete and trusted as of the signoff date and pointing to the freeze checklist. No other change to the roadmap file.
- `context/progress-tracker.md` Now reflects R13d completion and the roadmap closure date. Feature History has one line for R13d. Any operational deferral or freeze-eve finding is logged in Open Follow-Ups.
- No file under `prisma/`, `app/`, `src/`, `tests/`, `scripts/`, `.github/workflows/`, or any environment / config file is modified.
- `context/architecture-context.md`, `context/code-standards.md`, `context/reviews/r13-freeze-gate-assessment.md`, `context/reviews/r13-verification-inventory.md`, and R0–R12 feature specs are unchanged.
- No new npm script, no new CI workflow file, no new test, no new fixture is added.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector instead of re-deriving in pages or components. (R13d adds no such surface; it documents and verifies.)
