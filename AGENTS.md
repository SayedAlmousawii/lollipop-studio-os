<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Principle
**Clearer context beats more context.** Main docs are canonical. Archived summaries (`context/_archive/`) are inactive and will diverge — do not read them.

## Communication Efficiency
- Minimize working chatter.
- Update only on blockers, completion of a concrete step, or a change in direction.
- Keep each update to one short sentence unless clarification is needed.

## Minimal Context
Do NOT read all project docs. Only read what is needed for the current task.

## Default Reads (always load before implementation)
- `context/architecture-context.md` — canonical architecture, module ownership, invariants, read-layer standards
- `context/code-standards.md` — canonical code shape, naming, read-layer rules, DB access rules
- `context/ai-workflow-rules.md` — agent behavior, scoping, completion gates
- `context/project-overview.md` — product scope, user flow, in/out of V1
- `context/progress-tracker.md` — current Now / Key State

## Read If Needed
- `context/ui-context.md` → any UI work (tokens, page patterns)
- `context/target-data-model.md` → schema / data shape / migration work
- `context/reviews/centralization-roadmap.md` → any centralization-adjacent work (financial / composition / policy / read-layer)
- `context/git-conventions.md` → before commits or PRs
- `context/development-utilities.md` → dev resets, scripts, tooling

## Never Auto-Load
- `context/_archive/**` — historical only
- `context/reviews/archive/**` — historical only

## Task Rules
- Follow the unit spec strictly
- Keep scope small
- Prefer simple solutions

## Data Rule
- Do NOT modify database or backend unless specified.
- Use mock data only for UI exploration. Real data integration requires explicit instruction.

## Progress
- Update `progress-tracker.md` automatically during code implementation. For docs-only work, update it only if the task explicitly asks for a state/progress update.

## Git
- Read `context/git-conventions.md` before any commit or PR.
- Follow it for all commits, PR titles, and branch rules.
