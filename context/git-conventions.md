# Git Conventions

## Commit Message Format

Follow Conventional Commits strictly — every commit, no exceptions.

```
<type>: <short imperative summary>

<optional body — explain WHY, not what>
```

### Types
| Type | When to use |
|---|---|
| `feat` | New feature or behavior |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `perf` | Performance improvement |
| `refactor` | Code restructure with no behavior change |
| `test` | Adding or fixing tests |
| `chore` | Build, config, dependency changes |

### Rules
- Headline is **imperative, lowercase after the colon**: `feat: add booking edit page` not `feat: Added booking edit page`
- Headline max 72 characters
- If the commit needs a body, leave one blank line after the headline, then explain *why* — not what (the diff already shows what)
- Never use vague messages: `docs update`, `removed X`, `fixed stuff`, or raw branch names as titles

### Examples
```
feat: add customer soft-delete with active flag

Deactivated users are blocked from the app without losing
audit trail history.
```
```
fix: re-throw framework errors in payment action

Next.js redirect/unauthorized throws must not be caught —
swallowing them breaks the error boundary flow.
```
```
docs: update auth review to reflect resolved permission gaps
```

---

## Branching Strategy

Three-tier flow: `main` ← `development` ← `spec/*`.

### Branches

| Branch | Purpose | Who merges in |
|---|---|---|
| `main` | Stable production-ready milestones only. Tagged after each freeze gate. | User only, manually, after freeze verification |
| `development` | Integration branch for the active roadmap/phase. Receives completed spec branches. | User only, manually, after reviewing the spec branch |
| `spec/<NN>-<short-name>` | One branch per feature spec. `<NN>` matches the spec folder number (e.g. `spec/97-order-refunds`). | AI commits and pushes here freely |

### Rules

- **One spec per branch.** Avoid long-running multi-spec branches — they break rollback and debugging isolation. If a task touches multiple specs, split it.
- **AI never pushes to `main` or `development` directly.** Only `spec/*` branches.
- **Branch from `development`.** Always cut new spec branches from the current `development` tip.
- **Squash merge** spec → development. Spec branches may have messy WIP commits; the squash leaves one clean Conventional Commit per spec on `development`.
- **Delete spec branches after merge.** Keeps the branch list scannable.
- **Tag `main` after each freeze gate** (e.g. `v-phase-13`, `v-2026-05`) for rollback points.

### Workflow

1. User authorizes a spec → AI creates `spec/<NN>-<slug>` from `development`.
2. AI implements only that spec, commits and pushes to the spec branch.
3. AI runs verification (typecheck, tests, lint) before signaling ready.
4. User reviews and squash-merges `spec/*` → `development`, then deletes the spec branch.
5. After a roadmap/phase completes: user runs the freeze gate / full verification, merges `development` → `main`, and tags the milestone.

---

## What NOT to Commit

- Default boilerplate left unchanged (e.g. the Create Next App README — update it)
- Machine-local absolute paths in any tracked file
- Secrets, `.env` files, or credentials
