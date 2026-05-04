# ai-workflow-rules.md

# Studio OS – AI Workflow Rules

## 1. Overall Approach

- Follow a spec-driven, incremental development process.
- Work on one feature unit at a time.
- Implement only what is defined in the current spec.
- Do not combine multiple features into one implementation.
- Do not move ahead to future units unless explicitly instructed.

---

## 2. Scoping Rules

- Work strictly within the current unit scope.
- Do not modify unrelated files.
- Do not refactor unrelated code.
- Do not introduce new features not defined in the spec.
- Do not “improve” or redesign existing logic without instruction.

If a task includes multiple concerns:
- Split it into smaller steps.
- Complete each step independently.

---

## 3. When to Split Work

Split the task if:

- It involves UI + backend + database changes together
- It spans multiple modules
- It introduces new dependencies and logic at the same time
- It cannot be verified in one step

Each unit must:
- produce one visible or verifiable result
- be testable independently

---

## 4. Handling Missing or Ambiguous Requirements

- Do not guess when requirements are unclear.
- Ask for clarification before implementing if the missing information affects:
  - payments
  - package logic
  - commissions
  - permissions
  - database structure
  - workflow statuses

- You may make small assumptions only for:
  - UI layout details
  - styling
  - non-critical labels

- If assumptions are made:
  - explicitly state them
  - do not hardcode them into critical logic

---

## 5. Architecture Protection Rules

Do not modify the architecture unless explicitly instructed.

This includes:

- folder structure
- module boundaries
- database schema design
- service layer patterns
- auth model
- permission model
- package logic
- payment logic
- commission logic

If a change appears necessary:
- stop
- explain the issue
- request approval

---

## 6. Dependency Rules

- Do not install new packages unless:
  - they are listed in the spec
  - or explicitly approved

- Do not introduce alternative libraries for:
  - validation
  - database
  - styling
  - authentication

Stay consistent with:
- TypeScript
- Prisma
- Zod
- Tailwind
- Next.js

---

## 7. Code Modification Rules

- Only modify files relevant to the current unit.
- Use minimal changes to fix bugs.
- Do not rewrite working code unnecessarily.
- Do not change function signatures unless required by the spec.

---

## 8. Protected Files

Do not modify these files unless explicitly instructed:

- prisma/schema.prisma
- context/project-overview.md
- context/architecture.md
- context/code-standards.md
- context/ai-workflow-rules.md
- package.json
- .env files
- authentication configuration
- core financial logic files
- commission calculation files

---

## 9. Business Logic Rules

- All business logic must live in module service files.
- Do not place business logic in:
  - UI components
  - API route handlers
  - pages

- Financial calculations must be centralized.
- Package upgrade logic must not be duplicated.
- Commission logic must not be duplicated.

---

## 10. Invariant Enforcement

Always respect system invariants.

Examples:

- Editing must not start before base payment is recorded
- Package upgrades must replace the package, not duplicate it
- Commission must be based on upgrade difference
- Orders must not be marked delivered before production is complete

If a spec contradicts an invariant:
- follow the invariant
- report the conflict

---

## 11. Error Handling Rules

- Do not ignore errors.
- Do not silently fail.
- Provide clear error messages.
- Log technical errors internally.
- Ensure multi-step operations fail safely (use transactions where required).

---

## 12. Documentation Sync Rules

After each meaningful implementation:

- Update context/progress-tracker.md
- Mark unit status:
  - in progress
  - completed
- List:
  - files created
  - files modified
- Document:
  - decisions made
  - assumptions

Do not modify:
- architecture
- standards
- overview

unless explicitly instructed.

---

## 13. Verification Before Completion

Before marking a unit complete:

- Ensure TypeScript has no errors
- Ensure no console errors
- Validate all forms
- Confirm permissions are enforced
- Verify financial calculations
- Confirm status transitions work
- Ensure no unrelated features were affected
- Confirm UI renders correctly

---

## 14. Completion Rules

When a unit is complete:

- Mark it complete in progress-tracker.md
- Do not continue to the next unit automatically
- Wait for confirmation before proceeding

---

## 15. Behavior Rules

You are an implementation agent.

- Do not redesign the system
- Do not make architectural decisions
- Do not add features beyond the spec
- Do not assume missing requirements
- Do not perform broad refactors

Your role is:

text id="agent-role" Read the spec → implement exactly → verify → stop 

---

## 16. Conflict Handling

If you encounter:

- unclear requirement
- conflicting rules
- missing dependency
- unexpected behavior

You must:

- stop implementation
- describe the issue clearly
- propose options if possible
- wait for instruction

---

## 17. Core Rule

text id="core-rule" Do not think beyond the current unit. Do not implement beyond the spec. Do not modify beyond the scope. 

---