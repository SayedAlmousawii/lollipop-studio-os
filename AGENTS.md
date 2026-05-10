<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Communication Efficiency
- Minimize working chatter.
- Update only on blockers, completion of a concrete step, or a change in direction.
- Keep each update to one short sentence unless clarification is needed.

## Application Building Context — Rule 1: Minimal Context
Do NOT read all project docs.
Only read what is needed for the current task.

## Default Reads
- context/ai-workflow-summary.md
- context/code-standards-summary.md

## Read If Needed
- context/ui-context-summary.md → UI work
- context/architecture-summary.md → data / structure
- context/project-overview-summary.md → feature intent

## Task Rules
- Follow the unit spec strictly
- Keep scope small
- Prefer simple solutions

## Data Rule
- Do NOT modify database or backend unless specified.
- Use mock data only for UI exploration. Real data integration requires explicit instruction.

## Progress
- update progress-tracker automatically only during code implementation, if writing docs, skip update.

## Git
- Read context/git-conventions.md before any commit or PR.
- Follow it for all commits, PR titles, and branch rules.