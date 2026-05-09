## Goal

Add an `active` boolean field to the Prisma `User` model so deactivated staff are blocked from the app without losing their historical audit records. This is schema and auth-helper foundation only — no admin UI.

---

## Read First

- `context/ai-workflow-summary.md`
- `context/code-standards-summary.md`
- `context/feature-specs/50-auth-and-staff-identity-foundation.md`
- `context/feature-specs/51b-auth-hardening-and-permission-completion.md`
- `context/reviews/role-permissions-design.md`

---

## Rules

- Schema change only — do not build any staff management UI in this unit
- Do not hard-delete any `User` records — deactivation is always soft
- The `active` check must happen inside `requireCurrentAppUser()`, not scattered across individual actions or pages
- Migration must be safe to run against existing data — all current users default to `active = true`
- Update `context/reviews/current-database-er-diagram.md` to reflect the schema change

---

## Scope

### In Scope

1. Add `active Boolean @default(true)` to the Prisma `User` model
2. Run and verify the migration
3. Add the `active` check inside `requireCurrentAppUser()` in `src/lib/auth/current-user.ts`

### Out of Scope

- Admin UI for deactivating or reactivating users
- Clerk webhook handling
- Staff management screens
- Any changes to existing server actions or permission logic

---

## Implementation Direction

### 1. Schema Change

Add `active Boolean @default(true)` to the `User` model in `prisma/schema.prisma`. The field defaults to `true` so all existing records remain active after migration with no backfill needed.

### 2. Migration

Run the migration. Verify all existing `User` records have `active = true` after it applies. Regenerate the Prisma client.

### 3. Active Check in `requireCurrentAppUser()`

After resolving the linked Prisma user, check the `active` field before returning. If `active` is `false`, redirect to `/unauthorized` — the same destination used for unlinked users.

The check should sit after the user is resolved but before it is returned, so every caller of `requireCurrentAppUser()` gets the gate automatically. No individual action or page needs to know about the `active` field.

Also include `active` in the `appUserSelect` projection in `src/lib/auth/current-user.ts` so the field is available for the check without an extra query.

---

## Post-Implementation: Update Review Docs

**`context/reviews/auth-review.md`**
- Add to the "What's Already Done" checklist: `User.active` field exists — deactivated staff are blocked at `requireCurrentAppUser()` without losing audit history

**`context/reviews/role-permissions-design.md`**
- Update the Clerk webhook sync deferred note to reference that soft-delete foundation is now in place
- Update the soft-delete deferred note to mark the schema foundation as done and clarify that the UI remains deferred to Feature 65

**`context/reviews/current-database-er-diagram.md`**
- Add `active` field to the `User` entity

---

## Acceptance Criteria

- `User` model has `active Boolean @default(true)` in `prisma/schema.prisma`
- Migration runs cleanly and all existing users are `active = true`
- Prisma client is regenerated
- A user with `active = false` is redirected to `/unauthorized` when attempting to access any dashboard route
- A user with `active = true` is unaffected — normal auth flow continues
- `appUserSelect` includes the `active` field
- `context/reviews/auth-review.md` is updated
- `context/reviews/role-permissions-design.md` is updated
- `context/reviews/current-database-er-diagram.md` is updated
- `context/progress-tracker.md` is updated
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Migration deploy/status checks pass
