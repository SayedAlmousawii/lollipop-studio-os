# R0 — Context Reconciliation & Cleanup Gate

Generated: 2026-05-19
Status: Plan only. No code, no schema, no behavior changes.
Sources: all `context/*.md` (main + summary), `AGENTS.md`, `progress-tracker.md`, `centralization-roadmap.md`, spot-checks of `src/modules/` and `app/`.

This document is the gating prep work before any centralization implementation (R1+). Its job is to make the context layer agree with the codebase and with the approved centralization architecture, so future agents do not drift onto the old rules.

---

## 1. Finalized Answers to the 7 Open Questions (recap, binding)

These are now permanent decisions, not suggestions. They feed into R0's doc updates.

1. **Folder:** projectors live in `src/modules/financial-cases/` (entity-scoped). `src/modules/financial/` stays for cross-entity rules (classifier, reconciliation, invariants).
2. **Confirmed-but-not-checked-in booking:** the projection returns booking-stage fields — `depositPaid`, `awaitingFinalInvoiceAfterCheckIn`, `finalInvoicePending` — and does not synthesize a final-invoice state.
3. **Discrepancy logger:** wired into nightly reconciliation during R1–R6 migration window; removed in R6.
4. **R11 orchestrator:** not forced. Reassess after R10; may become a janitorial commit.
5. **Composition metadata:** computed at read time, no schema changes during this phase.
6. **Booking page financials:** keep a booking-stage projection; do not hide.
7. **DB import lint rule:** disallow `@/lib/db` in `app/**` AND `components/**`. Allowed only in `modules/**`, `lib/**`, `tests/**`, `scripts/**`.

---

## 2. Code-vs-Context Mismatches Discovered

These are concrete drifts the R0 update must fix. They are why agents could not be trusted to read the main docs today.

### 2.1 `context/architecture-context.md` is materially stale

- **Wrong stack rows:** "Backend: Node.js API / NestJS recommended" — actual stack is Next.js server actions + service modules; no NestJS. "Auth: Auth.js / Clerk / custom JWT" — actual is Clerk only.
- **Wrong file references:** Section 11/elsewhere refers to `context/architecture.md`, `context/code-standards.md` as protected files; the actual filenames are `architecture-context.md`, `code-standards.md` (already correct). But `ai-workflow-rules.md` Section 8 lists `prisma/schema.prisma`, `context/project-overview.md`, `context/architecture.md`, `context/code-standards.md`, `context/ai-workflow-rules.md` — the `architecture.md` name does not exist.
- **Module list is outdated:** Section 4 ("Module Responsibilities") lists Customers, Bookings, Packages, Orders, Invoice/Payment, Editing, Production, Commission, Reports only. The actual `src/modules/` directory contains: `adjustment-workspace`, `audit`, `bookings`, `calendar`, `commissions`, `composition-view`, `customers`, `dashboard`, `departments`, `development`, `financial`, `identifiers`, `invoices`, `jobs`, `orders`, `packages`, `payments`, `pricing`, `products`, `refunds`, `session-configurations`, `session-types`. Missing from doc: FinancialCase boundary, AdjustmentWorkspace, Session Configurations, Session Types, Pricing, Refunds, Audit, Composition View, Identifiers, Jobs.
- **Stale invariants:** Section 9 still has "A session cannot move to editing until the base package payment is recorded" — `PaymentType.BASE` was retired in Feature 59; current rule is FINAL invoice remaining balance fully paid. Also "A booking cannot become confirmed until the 20 KD deposit is recorded" is correct in spirit but the atomic confirmation contract (BK + FinancialCase + locked Deposit Invoice) is missing.
- **No FinancialCase mention** anywhere in the file. FinancialCase is the canonical financial boundary now.

### 2.2 `context/code-standards.md` has stale status example

- Section 11 example uses `DEPOSIT_PAID` in `BOOKING_STATUS`. That state was retired (deposit recording atomically flips PENDING → CONFIRMED).
- Section 3 example: "base package payment" wording.

### 2.3 `context/ai-workflow-rules.md` has stale invariants

- Section 10: "Editing must not start before base payment is recorded" — should be "before Final Invoice remaining balance is settled".
- Section 8: protected file `context/architecture.md` does not exist (should be `architecture-context.md`).

### 2.4 `context/project-overview.md` shows old payment flow

- "Customer pays full package price" before WAITING_SELECTION — the actual flow now is post-selection POS settlement via Final Invoice, not pre-selection full payment.

### 2.5 The summary docs are the most up-to-date

The five `*-summary.md` files (architecture, code-standards, ai-workflow, ui-context, project-overview) reflect: lifecycle revision, FinancialCase, AdjustmentWorkspace, session configurations, retired BASE payment, retired DEPOSIT_PAID, shared financial UI components, current page patterns.

**Conclusion:** the "main" docs are stale and the "summary" docs are canonical. The naming is misleading. R0's job is to invert this: make the main docs canonical, retire the summary docs.

### 2.6 No `src/modules/financial-cases/` exists yet

This is expected — it's R1's job to create it. R0 must not create it; R0 only declares the convention in docs.

### 2.7 DB-import drift is small and fixable

- `app/bookings/new/page.tsx` and `app/orders/[orderId]/actions.ts` are the only two `app/**` files importing `@/lib/db`.
- Zero `components/**` files import `@/lib/db`.
- The lint rule from R5 will catch only these two; both are already on the R5 cleanup list.

### 2.8 AGENTS.md default reads are too narrow

Today AGENTS.md says default reads are `context/ai-workflow-summary.md` and `context/code-standards-summary.md`. After R0 those filenames go away (merged into main docs). AGENTS.md must point at the canonical merged set.

### 2.9 Conflicting / duplicated rules across docs

- "Business logic in services" appears in: architecture-context.md §4, architecture-summary.md §3, code-standards.md §7/§9/§24, code-standards-summary.md §3, ai-workflow-rules.md §9, ai-workflow-summary.md §2. Six locations, slightly different wording each. R0 should keep one authoritative phrasing per concept and have other docs link/refer.
- Status patterns duplicated between architecture-context.md and code-standards.md.
- "Pending bookings consume no references" appears in 3 places with slightly different phrasing.

### 2.10 `context/Financial reviews/` directory naming

Folder name has a space (`Financial reviews`). The other folders are kebab-case. R0 should rename to `context/financial-reviews/` or move its single file into `context/reviews/archive/financial/`.

---

## 3. Permanent Architecture Rules (R0 declares these as standing law)

These are not phase rules. They become the foundation that every future feature spec must satisfy. They go into `architecture-context.md` (new "Canonical Architecture Standards" section) and are summarized in `code-standards.md`.

### 3.1 Write/Read Separation

- **Canonical write services own all mutations.** Every database mutation must go through a `modules/<domain>/<domain>.service.ts` function. UI, pages, server actions, and API routes never mutate the DB directly.
- **Canonical read models own all display truth.** Business semantics (totals, status badges, payment state, composition state, available actions, blocked reasons, formatted money) are produced by service-layer read models, not by pages or components.
- **No mixed roles.** A function either mutates or it derives display. A function that mutates does not return display strings; a function that derives display does not write.

### 3.2 One Truth, Many Projections

- **One canonical read model per business concept**, exposing raw structured fields (numbers, enums, references).
- **Surface-specific projector functions** consume the canonical model and produce typed DTOs shaped for one surface (header, table row, sidebar, dialog, page section).
- Projectors **may** reshape, filter, group, and re-label. Projectors **may not** recompute business semantics independently.
- A new financial/composition/workflow surface = new projector, never a new derivation.

### 3.3 Dumb UI

- UI components and pages render. They do not compute money, derive status, decide allowed actions, or assemble totals from partial rows.
- No formatted-string parsing in UI. Read raw numbers/enums from projector output.
- No business strings hardcoded in UI when a policy/projector can supply them (blocked reasons, action labels, badge copy).

### 3.4 Service-only DB Access

- `@/lib/db` (or equivalent Prisma client) is imported **only** from `src/modules/**`, `src/lib/**`, `tests/**`, `scripts/**`.
- `app/**` and `src/components/**` never import the DB client. Server actions call service functions; pages call service loaders.

### 3.5 Centralized Policies

- Edit-mode rules (draft / locked / adjustment) live in one policy module; every UI consumer reads the policy. Service-layer write guards remain authoritative; the policy must read the same predicates the guards use.
- Workflow availability rules (booking / editing / production / delivery) live in policy builders; UI components never hardcode action lists.

### 3.6 Centralized Formatting

- One money formatter (`src/lib/formatting/money.ts`). No surface defines its own.
- One status-label source per status enum (the enum's `constants` file). No component redefines labels.

### 3.7 Module-scope Discipline

- New financial concepts that bind to a FinancialCase live in `modules/financial-cases/`.
- Cross-entity financial rules (classifier, invariants, reconciliation) live in `modules/financial/`.
- Operational composition lives in `modules/orders/composition/`.
- Each module owns its DB writes, its policies, its read model, and its projectors.

These seven rules supersede any older phrasing in any doc. R0 makes that explicit.

---

## 4. R0 Doc Update Plan — File-by-File

R0 is a single docs-only PR. It rewrites the stale main docs to be the canonical source, then archives the summaries.

### 4.1 Files to UPDATE (rewrite content; keep filename)

#### `context/architecture-context.md` — major rewrite
- Replace stack table to match real stack: Next.js server actions; Clerk; Prisma/Postgres; Tailwind; no NestJS.
- Replace Section 3 (folder structure) with the actual `src/modules/*` layout including all current modules.
- Replace Section 4 (Module Responsibilities) with the up-to-date table from `architecture-summary.md`, plus add: FinancialCase, AdjustmentWorkspace, Session Configurations, Session Types, Pricing, Refunds, Audit, Composition View, Identifiers, Jobs.
- Replace Section 9 invariants with the current set from `architecture-summary.md` (FinancialCase contract, atomic confirmation, FINAL not BASE, locked-invoice immutability, locked operational edits via `writeOrderPackageSelections({allowPostLock})`, AdjustmentWorkspace contracts).
- Add new section: **"Canonical Architecture Standards"** = the seven permanent rules from §3 above.
- Add new section: **"Canonical Read Layer"** — explains FinancialCaseSummary + projector pattern; says `modules/financial-cases/` is the projector home; says future composition view model goes in `modules/orders/composition/`; says the same pattern applies to workflow and edit-mode policies.
- Remove protected-file references to `context/architecture.md` (wrong name).
- Result target size: ~250–300 lines (down from 391, removing speculative future sections about NestJS, BullMQ, etc.).

#### `context/code-standards.md` — targeted update
- Fix Section 11 `BOOKING_STATUS` example: remove `DEPOSIT_PAID`, add `CHECKED_IN`.
- Fix Section 13 financial example wording: "FINAL invoice remaining balance" not "base package payment".
- Add new section: **"Read-Layer Rules"** — short, references the permanent rules in architecture-context.md:
  - Do not compute business semantics in components or pages.
  - Do not parse formatted money strings.
  - New display surfaces require a projector in the relevant module; do not re-derive.
  - One money formatter; one status-label source per enum.
- Add to Section 10 (DB Access): explicit rule "Do not import `@/lib/db` from `app/**` or `src/components/**`."
- Remove redundant scaffolding that duplicates ai-workflow-rules.md (the "AI Coding Agent Rules" section in §23 — keep it in ai-workflow-rules.md only, link from here).

#### `context/ai-workflow-rules.md` — targeted update
- Section 10 invariant: replace "base payment" with "Final Invoice remaining balance fully paid".
- Section 8 protected files: fix `context/architecture.md` → `context/architecture-context.md`.
- Add new rule: when implementing a new financial/composition/workflow display, use the canonical read model + projector pattern; do not re-derive in the page/component.
- Reduce duplication with code-standards.md: this file owns *how the agent behaves*; code-standards.md owns *how the code looks*. Move any code-shape rules out.

#### `context/project-overview.md` — targeted update
- Fix the Post-Session phase: clarify Final Invoice settlement happens at POS after selection, not "full payment before WAITING_SELECTION".
- Add a paragraph on FinancialCase as the financial grouping boundary.
- Otherwise minimal — this doc is for scope, not engineering.

#### `context/ui-context.md` — minimal additions
- Add to "Page Patterns" the canonical references already in ui-context-summary.md (Order Detail Financials, Locked Sales View, Shared Financial UI, Adjustment Workspace, Session Types, Pricing).
- Otherwise leave as-is; UI tokens have not drifted.

#### `AGENTS.md` (root) — rewrite default reads
- Replace "Default Reads" section:
  - `context/architecture-context.md` (canonical architecture + read-layer standards)
  - `context/code-standards.md` (canonical coding + read-layer rules)
  - `context/ai-workflow-rules.md` (agent behavior)
  - `context/progress-tracker.md` (current state)
- Replace "Read If Needed":
  - `context/ui-context.md` → UI work
  - `context/target-data-model.md` → data / schema work
  - `context/project-overview.md` → scope questions
  - `context/reviews/centralization-roadmap.md` → any centralization work
- Add a one-line principle: **"Clearer context beats more context. Main docs are canonical; summaries are archived."**
- Remove references to `*-summary.md` files (they are archived in step 4.3).

#### `context/progress-tracker.md` — add "Now" entry
- "R0 context reconciliation complete: main docs are now canonical, summary docs archived, centralization-roadmap is the active implementation plan. Active spec: R1 (FinancialCaseSummary read model + projectors)."

#### `context/feature-specs/SPEC_TEMPLATE.md` — add checklist line
- Under Acceptance Criteria template, add: "If this spec adds or changes a financial / composition / workflow display surface, it consumes the canonical read model + projector pattern (no re-derivation in pages/components)."

### 4.2 Files to ARCHIVE (move to `context/reviews/archive/15-centralization/` or `context/_archive/summaries/`)

After their useful content has been merged into the canonical main docs.

| File | Destination | Reason |
|---|---|---|
| `context/architecture-summary.md` | `context/_archive/summaries/` | Content merged into `architecture-context.md` |
| `context/code-standards-summary.md` | `context/_archive/summaries/` | Content merged into `code-standards.md` |
| `context/ai-workflow-summary.md` | `context/_archive/summaries/` | Content merged into `ai-workflow-rules.md` |
| `context/ui-context-summary.md` | `context/_archive/summaries/` | Content merged into `ui-context.md` |
| `context/project-overview-summary.md` | `context/_archive/summaries/` | Content merged into `project-overview.md` |
| `context/reviews/centralization-inventory.md` | `context/reviews/archive/15-centralization/` | Background analysis; superseded by roadmap |
| `context/reviews/centralization-visual-plan.md` | `context/reviews/archive/15-centralization/` | Contains misleading "one-DTO" diagram; superseded by roadmap |

### 4.3 Files to RENAME / REORGANIZE

| Current | New | Reason |
|---|---|---|
| `context/Financial reviews/` (folder) | `context/reviews/archive/financial/financial-rearchitecture-master-plan.md` | Kebab-case convention; consolidate under reviews/archive |

### 4.4 New file to CREATE

| File | Purpose |
|---|---|
| `context/_archive/README.md` | One paragraph: "These docs were archived in R0 on 2026-05-19 after their content was merged into the canonical main docs. Do not read; they will diverge." |

---

## 5. Final Context Reading Order (post-R0)

This is what AGENTS.md will declare. The order is intentional: scope → standards → workflow → state.

**Always loaded (default reads):**
1. `AGENTS.md` (system context)
2. `context/architecture-context.md` — canonical architecture, module ownership, read-layer standards
3. `context/code-standards.md` — canonical code shape, read-layer rules
4. `context/ai-workflow-rules.md` — agent behavior, scoping, completion gates
5. `context/progress-tracker.md` — current Now / Key State

**Read if relevant to the task:**
- `context/ui-context.md` — any UI work
- `context/target-data-model.md` — schema, data shape, migration
- `context/project-overview.md` — scope questions
- `context/reviews/centralization-roadmap.md` — any centralization-adjacent work (financial / composition / policy / read-layer)
- `context/git-conventions.md` — before commits/PRs
- `context/development-utilities.md` — dev resets, scripts, tooling

**Never automatically loaded (archived):**
- `context/_archive/summaries/*`
- `context/reviews/archive/**`

**Total default-read line budget:** target under 1200 lines combined. Current main docs total ~1289 lines pre-R0; after R0 rewrite the target is ~1100–1200 (removing speculative future sections and duplication).

---

## 6. Recommendation: Archive vs Delete

**Recommendation: Archive, do not delete.**

Reasons:
- Archival preserves the git-blame trail and the design history without polluting default reads.
- An `_archive/` prefix and a `README.md` warning prevent agents from treating archives as current.
- Future audits ("what did the summary say in May 2026?") remain answerable without `git log` archaeology.
- Cost is near zero — a few stale files in a clearly marked folder.

Delete only if a future cleanup proves the archive directory itself causes confusion (e.g., agents reading it anyway). If that happens, delete and rely on git history.

---

## 7. R0 Acceptance Criteria

- [ ] Stale rules (BASE payment, DEPOSIT_PAID, NestJS, Auth.js, missing FinancialCase) removed from all main docs.
- [ ] Canonical Architecture Standards section (the seven permanent rules) lives in `architecture-context.md`.
- [ ] Canonical Read Layer section (FinancialCaseSummary + projector pattern + module locations) lives in `architecture-context.md`.
- [ ] Read-Layer Rules section in `code-standards.md` declares: no business math in UI, no formatted-string parsing, no `@/lib/db` in `app/` or `components/`, projector pattern required for new surfaces.
- [ ] `AGENTS.md` default reads point only at main docs; principle "clearer context beats more context" is stated.
- [ ] All five `*-summary.md` files moved to `context/_archive/summaries/` with a README warning.
- [ ] `centralization-inventory.md` and `centralization-visual-plan.md` moved to `context/reviews/archive/15-centralization/`.
- [ ] `context/Financial reviews/` folder relocated/renamed.
- [ ] `SPEC_TEMPLATE.md` includes the projector-pattern checklist line.
- [ ] `progress-tracker.md` Now entry records R0 completion and R1 as next.
- [ ] An agent reading only the new default-read set can answer: "Where do I add a new financial badge?" → "Add a projector in `modules/financial-cases/projections/`; do not compute in the component."
- [ ] An agent reading only the new default-read set can answer: "Can I import `@/lib/db` from a page?" → "No, only from `modules/`, `lib/`, `tests/`, `scripts/`."
- [ ] No code changes in this PR. No schema changes. No business behavior changes.

---

## 8. What R0 Explicitly Does NOT Do

- Does not create `src/modules/financial-cases/` (that's R1).
- Does not move any DB imports out of `app/` (that's R5).
- Does not add the eslint/lint rule for DB imports (that's R5 — R0 only declares the standard in docs).
- Does not change any service, component, page, schema, or test.
- Does not delete summary files — only archives them.
- Does not rewrite the roadmap; the roadmap stays as-is.

---

## 9. Execution Order Inside R0

A single PR, in this commit order so review is mechanical:

1. Create `context/_archive/summaries/` directory + README warning.
2. Merge each summary's content into its main doc (architecture, code-standards, ai-workflow, ui-context, project-overview), one commit per pair.
3. Add the Canonical Architecture Standards + Canonical Read Layer sections to `architecture-context.md`.
4. Add the Read-Layer Rules section to `code-standards.md`.
5. Archive the five summary files.
6. Archive the two superseded centralization analysis docs.
7. Rename `context/Financial reviews/` folder.
8. Update `AGENTS.md` default reads + principle.
9. Update `SPEC_TEMPLATE.md` checklist line.
10. Update `progress-tracker.md` Now entry.

Reviewer can verify each commit independently. The last commit (progress-tracker) is the green light for R1 to begin.
