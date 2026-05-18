# AI Workflow Summary

## 1. Purpose
Rules for how the AI agent must behave during implementation — scoping, safety, and delivery discipline.

---

## 2. Key Rules / Principles

- Work on one feature unit at a time; stop when done, wait for confirmation
- Implement only what the current spec defines — nothing more
- Do not modify unrelated files, refactor unrelated code, or redesign existing logic
- Ask before implementing if requirements are missing for: payments, packages, commissions, permissions, DB schema, workflow statuses
- Small assumptions allowed only for: UI layout details, styling, non-critical labels — state them explicitly
- If a task spans UI + backend + DB + multiple modules: split it into smaller steps first
- Business logic must live in `modules/*/_.service.ts` — never in pages, components, or API handlers
- Use transactions for multi-step financial or workflow operations
- Do not silently fail; all errors must surface clearly

---

## 3. Required Patterns / Constraints

**After each unit:**
- Update `context/progress-tracker.md`
- Mark status: in-progress or completed
- List files created/modified
- Document decisions and assumptions made

**Pre-completion checklist:**
- [ ] TypeScript: no errors
- [ ] No console errors
- [ ] Forms validate correctly
- [ ] Permissions enforced
- [ ] Financial calculations verified
- [ ] Status transitions work
- [ ] No unrelated features broken
- [ ] UI renders correctly

**Core invariants (never violate):**
- Pending bookings consume no references — they are calendar holds only; hard-deleted on cancellation
- Booking confirmation is atomic: 20 KD deposit recorded + BK reference generated + FinancialCase created + Deposit Invoice issued and locked in one transaction
- Editing cannot start until the Final Invoice remaining balance is fully paid (`PaymentType.FINAL`); `PaymentType.BASE` is retired
- Package upgrade = replace final package (not add a second line)
- Upgrade charge = final package price − already paid package price
- Commission = based on upgrade difference only
- Every payment, package change, commission change, price override = audit logged
- Order cannot be marked delivered until all production jobs are complete
- Manual overrides must store: who, when, why

---

## 4. What to Avoid

- Do not install new packages unless listed in the spec or explicitly approved
- Do not introduce alternative libraries for: validation, DB, styling, auth
- Do not modify protected files without explicit instruction:
  - `prisma/schema.prisma`
  - `package.json`
  - `.env` files
  - `context/project-overview.md`, `context/architecture.md`, `context/code-standards.md`, `context/ai-workflow-rules.md`
  - Authentication configuration
  - Core financial logic files
  - Commission calculation files
- Do not continue to the next unit automatically after completion
- Do not guess on ambiguous requirements — stop and ask

---

## 5. When to Read Full Document

Read `ai-workflow-rules.md` when:
- Encountering a conflict between spec and invariant
- Unclear whether a task crosses a module boundary
- Needing exact wording of a workflow or scoping rule

---

## Feature Spec Writing Rules

When writing a new feature spec file, follow this structure and omit redundant content:

**Required sections (in order):**
1. `## Goal` — one short paragraph, what this unit achieves
2. `## Read First` — spec-specific context only (prior specs, review docs, specific source files relevant to this unit). Do NOT list `ai-workflow-summary.md` or `code-standards-summary.md` — they are default reads
3. `## Rules` — unit-specific constraints and guardrails
4. `## Scope` — `### In Scope` and `### Out of Scope` lists
5. `## Implementation Direction` — describe the desired behavior and point to where in the codebase to look; do not write code or prescribe exact implementations
6. `## Post-Implementation` — explicit list of docs to update after completion
7. `## Acceptance Criteria` — specific, checkable conditions. Include `npm run build passes` and `npm run lint passes` as explicit checks

**Do not include in specs:**
- `agents.md` in Read First — always loaded as system context
- `context/ai-workflow-summary.md` or `context/code-standards-summary.md` in Read First — already default reads

**Implementation Direction guidelines:**
- Describe *what behavior to produce* and *which functions or areas to read first* — not what code to write
- Do not include code snippets — the agent must read the actual file and fit the fix into the existing patterns it finds there
- Do not use line numbers as primary navigation — functions and logical areas are more stable than line numbers
- Point to existing patterns in the codebase the agent should follow (e.g. "follow the same guard pattern used in X") — this keeps the fix consistent with what is already there
- Explain the *why* behind constraints so the agent can make judgment calls in edge cases

---

## Recommended Usage
**Always read this summary** before starting any implementation unit.
