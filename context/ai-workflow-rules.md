# Studio OS — AI Workflow Rules

How implementation agents behave: scoping, splitting, completion, and conflict handling. This is a **main doc** (always loaded by default). Older `ai-workflow-summary.md` content has been merged here; the summary is archived in `context/_archive/summaries/`.

For code shape, see `context/code-standards.md`. For architecture, see `context/architecture-context.md`.

---

## 1. Overall Approach

- Spec-driven, incremental development.
- Work on one feature unit at a time.
- Implement only what the current spec defines.
- Do not combine multiple features into one implementation.
- Do not move ahead to future units unless explicitly instructed.

---

## 2. Scoping Rules

- Work strictly within the current unit scope.
- Do not modify unrelated files.
- Do not refactor unrelated code.
- Do not "improve" or redesign existing logic without instruction.
- Small assumptions allowed only for UI layout details, styling, and non-critical labels — and must be stated explicitly.

If a task crosses concerns, split it.

---

## 3. When to Split Work

Split if:
- It involves UI + backend + database changes together.
- It spans multiple modules.
- It introduces new dependencies and logic at the same time.
- It cannot be verified in one step.

Each unit must produce one visible or verifiable result and be testable independently.

---

## 4. Handling Missing or Ambiguous Requirements

Do not guess. Ask for clarification before implementing if the missing information affects:
- payments
- package logic
- commissions
- permissions
- database structure / schema
- workflow statuses
- financial read-layer projections

---

## 5. Architecture Protection

Do not modify the architecture unless explicitly instructed. This includes:
- folder structure
- module boundaries
- database schema design
- service layer patterns
- auth model
- permission model
- package / payment / commission logic

If a change appears necessary: stop, explain the issue, request approval.

---

## 6. Canonical Read-Layer Rule

When implementing a new financial, composition, workflow, or status display surface:

- Consume the relevant canonical read model (`FinancialCaseSummary`, future `OrderCompositionViewModel`, edit-mode policy, workflow policy builders).
- Add a surface-specific projector if one does not exist; do not re-derive in the page or component.
- Never compute money, payment status, composition, or available actions in UI.

See `context/architecture-context.md` §6 (Canonical Architecture Standards) and §7 (Canonical Read Layer).

---

## 7. Dependency Rules

- Do not install new packages unless listed in the spec or explicitly approved.
- Do not introduce alternative libraries for validation, DB, styling, or auth.
- Stay on TypeScript, Prisma, Zod, Tailwind, shadcn/ui, Next.js, Clerk.

---

## 8. Protected Files

Do not modify these unless explicitly instructed:

- `prisma/schema.prisma`
- `package.json`
- `.env` files
- `context/project-overview.md`
- `context/architecture-context.md`
- `context/code-standards.md`
- `context/ai-workflow-rules.md`
- authentication configuration
- core financial logic files
- commission calculation files

---

## 9. Business Logic Rules

- All business logic in module service files.
- No business logic in UI components, server actions, route handlers, or pages.
- Financial calculations centralized — no duplication.
- Package upgrade logic centralized — no duplication.
- Commission logic centralized — no duplication.

---

## 10. Invariant Enforcement

Always respect system invariants (see `context/architecture-context.md` §8). Examples:

- Editing cannot start before the Final Invoice remaining balance is fully paid (`PaymentType.FINAL`; `BASE` is retired).
- Package upgrades replace the final package — never duplicate it.
- Commission is based on the upgrade difference.
- Orders are not marked delivered before production is complete.
- Locked invoices are content-immutable below the service layer.

If a spec contradicts an invariant: follow the invariant; report the conflict.

---

## 11. Error Handling

- Do not ignore errors or silently fail.
- Provide clear error messages.
- Log technical errors internally.
- Multi-step operations must fail safely (transactions).

---

## 12. Documentation Sync

After each meaningful implementation (code change), update `context/progress-tracker.md`:

- mark unit status: in-progress or completed
- list files created / modified (concisely)
- document decisions and assumptions

Do not modify architecture / standards / overview docs unless explicitly instructed.

For docs-only work (no code changes), update `progress-tracker.md` only if the task explicitly asks for a state or progress update.

---

## 13. Pre-Completion Checklist

- [ ] TypeScript: no errors
- [ ] No console errors
- [ ] Forms validate correctly
- [ ] Permissions enforced
- [ ] Financial calculations verified
- [ ] Audit logs created for sensitive actions
- [ ] Status transitions work
- [ ] No unrelated features broken
- [ ] UI renders correctly
- [ ] `npm run build` passes
- [ ] `npm run lint` passes

---

## 14. Completion

When a unit is complete:
- Mark it complete in `progress-tracker.md`.
- Do not continue to the next unit automatically.
- Wait for confirmation before proceeding.

---

## 15. Behavior

You are an implementation agent.

- Do not redesign the system.
- Do not make architectural decisions.
- Do not add features beyond the spec.
- Do not assume missing requirements.
- Do not perform broad refactors.

Role: read the spec → implement exactly → verify → stop.

---

## 16. Conflict Handling

If you encounter an unclear requirement, conflicting rules, a missing dependency, or unexpected behavior:

- stop implementation
- describe the issue clearly
- propose options if possible
- wait for instruction

---

## 17. Feature Spec Writing Rules

When writing a new feature spec file, follow `context/feature-specs/SPEC_TEMPLATE.md` and:

**Required sections (in order):**
1. `## Goal` — one short paragraph.
2. `## Read First` — spec-specific context only. Do **not** list always-loaded docs (`architecture-context.md`, `code-standards.md`, `ai-workflow-rules.md`, `progress-tracker.md`).
3. `## Rules` — unit-specific constraints.
4. `## Scope` — `### In Scope` and `### Out of Scope`.
5. `## Implementation Direction` — describe desired behavior and point to existing functions / patterns; do not write code.
6. `## Post-Implementation` — docs to update after completion.
7. `## Acceptance Criteria` — checkable conditions, including `npm run build` and `npm run lint` passing, and the read-layer projector check from SPEC_TEMPLATE.

**Implementation Direction guidelines:**
- Describe *what behavior to produce* and *which functions / areas to read first* — not what code to write.
- No code snippets.
- No line numbers as primary navigation; use function and area names.
- Point to existing patterns the agent should follow.
- Explain *why* behind constraints so the agent can handle edge cases.

---

## 18. Core Rule

```text
Do not think beyond the current unit.
Do not implement beyond the spec.
Do not modify beyond the scope.
```
