## Goal

Add real authentication and staff identity so Studio OS routes require sign-in, the signed-in Clerk user can be linked to a Prisma `User`, and the application can resolve a stable app role for future permission checks and audit attribution.

---

## Read First

- `agents.md`
- `context/project-overview-summary.md`
- `context/architecture-summary.md`
- `context/reviews/clerk-auth-setup-plan.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`
- `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`

---

## Rules

- Keep this unit focused on auth and staff identity foundation only
- Clerk owns authentication and session state
- Prisma `User` remains the source of truth for app role and staff identity
- Use the Next.js 16 `proxy.ts` convention; do not introduce deprecated `middleware.ts`
- Centralize authenticated app-user lookup in server-only helpers; do not scatter raw Clerk lookups across pages and actions
- Keep public app surface minimal: sign-in only
- Do not build role-specific navigation, dashboards, or page hiding in this unit
- Do not build Clerk webhook sync or user provisioning UI in this unit
- Update `context/reviews/current-database-er-diagram.md` if the implemented schema shape changes

---

## Scope

### In Scope

- Install and configure `@clerk/nextjs`
- Add required Clerk environment variable documentation
- Wrap the app root with `ClerkProvider`
- Protect dashboard routes with `proxy.ts`
- Add a working `/sign-in` route using Clerk UI
- Replace the current topbar placeholder user button with a Clerk user menu/button
- Add nullable unique `clerkId` linkage on Prisma `User`
- Create server-only helpers for:
  - current Clerk session lookup
  - current linked app user lookup
  - requiring an authenticated linked app user where needed
- Link one local Clerk account to one Prisma admin user for development verification

### Out of Scope

- Full RBAC rollout across all pages and actions
- Role-specific dashboard variants
- Staff management UI
- Clerk webhooks
- Production provisioning workflow
- Broad refactors to unrelated pages or service modules

---

## Manual Setup Requirement

Implementation may assume the project owner has already completed the manual Clerk dashboard setup described in `context/reviews/clerk-auth-setup-plan.md`, including:

- Clerk application created
- public self-sign-up disabled if available
- local origin/redirects configured for `http://localhost:3000`
- first Clerk admin account created
- publishable and secret keys available

This feature should not attempt to automate Clerk dashboard setup.

---

## Required Auth Direction

- all dashboard routes require sign-in
- sign-in remains the only intended public application route
- the app should treat Clerk identity and Prisma staff identity as separate concerns:
  - Clerk user = authenticated identity/session
  - Prisma `User` = Studio OS role and internal staff record
- the auth foundation must support one Clerk user linking to one Prisma `User`
- email matching may be used for the first local linking step if that is the simplest current path, but the stable long-term app link must be `User.clerkId`

---

## Schema Direction

This unit should add a nullable unique Clerk link field on the `User` model:

```text
User.clerkId String? @unique
```

Requirements:

- keep existing `UserRole` usage unchanged
- do not redesign the staff model in this unit
- preserve existing seeded users
- backfill/link the first admin user without breaking current development data

If additional indexes or constraints are needed to support safe lookup, keep them tightly scoped to the auth link.

---

## Route Protection Requirements

Create `proxy.ts` at the project root using the Next.js 16 convention.

Expected behavior:

- `/sign-in` is public
- protected dashboard/application routes require authentication
- unauthenticated access redirects to Clerk sign-in
- Next static/internal assets remain excluded from the matcher

Do not add parallel auth protection patterns in individual pages when `proxy.ts` should own the route gate.

---

## App Requirements

### Root Layout

Update `app/layout.tsx` to wrap the application with `ClerkProvider`.

### Sign-In Route

Create the Clerk sign-in page at:

```text
app/sign-in/[[...sign-in]]/page.tsx
```

Requirements:

- use Clerk's built-in sign-in UI
- do not build a custom sign-in form in this unit
- successful sign-in should return the user to the main app route

### Topbar Identity UI

Update `src/components/layout/topbar.tsx` so the current placeholder user icon becomes a real authenticated user control, such as Clerk `UserButton`.

Requirements:

- preserve the current topbar layout and visual style as much as practical
- keep the notifications button behavior unchanged
- do not redesign the full chrome in this unit

---

## Auth Helper Requirements

Create server-only helpers under a shared auth location such as:

```text
src/lib/auth/
```

Expected responsibilities:

- resolve the current Clerk auth/session context
- resolve the current linked Prisma `User`
- expose a strict helper for flows that require a linked app user

Suggested helper shape:

```text
getCurrentClerkUser()
getCurrentAppUser()
requireCurrentAppUser()
```

Exact naming may vary, but the pattern must stay centralized and reusable.

Pages, server actions, and services should consume these helpers rather than each implementing their own Clerk-to-Prisma lookup logic.

---

## Linking Requirement

This unit must prove one working app-user link in local development.

Recommended local verification path:

1. sign in with the first Clerk admin account
2. link that Clerk user to the seeded Prisma admin user
3. verify the app can resolve the linked `User`
4. verify the resolved user role is `ADMIN`

The first link may be created by:

- updating the seeded Prisma admin email to `admin@lollipopstudioos.dev` so it can be used as the first Clerk admin identity
- updating the seeded admin email to match the Clerk admin email, then linking on first lookup
- or manually setting the `clerkId` for the seeded admin user

Choose the smallest workable approach already aligned with current local data flow.

---

## Service Layer Expectations

This unit does not need a broad business-logic rewrite, but it should establish these foundations:

- auth/app-user resolution is reusable from server actions and services
- future permission checks can receive a resolved app user with `id` and `role`
- current pages/components should not perform Prisma auth-link queries directly

If any current read path needs signed-in user context for verification, keep the change narrow and local to the auth foundation.

---

## Acceptance Criteria

- Clerk is installed and configured for the app
- `app/layout.tsx` is wrapped with `ClerkProvider`
- `proxy.ts` exists and uses the Next.js 16 proxy convention
- unauthenticated users are redirected to `/sign-in` when opening protected routes
- `/sign-in` renders a working Clerk sign-in flow
- the topbar shows a real authenticated user control instead of the placeholder user icon
- `User.clerkId` exists as a nullable unique Prisma field
- a centralized server-only auth helper layer exists
- one local Clerk user can be linked to one Prisma admin user
- the app can resolve the signed-in user's Prisma `UserRole`
- no role-specific UX expansion is introduced yet
- `context/reviews/current-database-er-diagram.md` is updated if the implemented schema changes its described structure
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- migration deploy/status checks pass
- Update `context/progress-tracker.md`

---

## Assumptions

- Studio OS is still an internal-only tool with no public self-sign-up flow
- One working linked admin account is sufficient for the first auth unit
- Existing seeded users should remain available for future role testing even if only one Clerk-linked account is active initially
