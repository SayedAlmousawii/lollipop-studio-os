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
- Booking cannot be confirmed until 20 KD deposit is recorded
- Editing cannot start until base package payment is recorded
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

## Recommended Usage
**Always read this summary** before starting any implementation unit.
