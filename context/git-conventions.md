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

## PR Title Format

PR titles follow the same `<type>: <summary>` format as commit headlines.

- **Never use a branch name as the PR title** (e.g. `51b-auth-hardening` is wrong)
- **Never use vague titles** (`updated docs`, `fixes`)
- Group commits by feature, not by arbitrary batches — avoid spanning more than 2-3 related features per PR

### Examples
```
feat: add permission and audit actor foundation (Feature 51)
fix: normalize seeded Clerk test emails
perf: skip Clerk API call on every page load for linked users
```

---

## Branch → PR → Merge Flow

- AI commits, pushes, and opens the PR with a proper title and description
- User reviews and merges manually on GitHub — AI never merges
- PRs target `development`
- User periodically merges `development` → `main` on GitHub to mark stable milestones
- AI never pushes directly to `main`

---

## What NOT to Commit

- Default boilerplate left unchanged (e.g. the Create Next App README — update it)
- Machine-local absolute paths in any tracked file
- Secrets, `.env` files, or credentials
