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

## Commit & Push Flow

- AI commits and pushes directly to the `development` branch — no feature branches, no PRs
- User periodically merges `development` → `main` on GitHub to mark stable milestones
- AI never pushes directly to `main`

---

## What NOT to Commit

- Default boilerplate left unchanged (e.g. the Create Next App README — update it)
- Machine-local absolute paths in any tracked file
- Secrets, `.env` files, or credentials
