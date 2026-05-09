# Clerk Authentication Setup Plan

**Date:** 2026-05-07  
**Revised:** 2026-05-09  
**Project:** lollipop-studio-os  
**Next.js Version:** 16.2.4 (React 19)

---

## Overview

Studio OS currently has **no authentication**. All routes are publicly accessible. This plan adds Clerk as the identity and session management layer to protect all dashboard routes, expose the current user's identity/role within the application, and enforce role-based access control aligned with the existing `UserRole` enum in the Prisma schema.

This is an **internal tool** — there is no public sign-up flow. User accounts are created and managed by admins in the Clerk dashboard.

This plan should be treated as the first foundation step from the revised build roadmap:

1. add auth and staff identity
2. connect authenticated users to Prisma `User` records
3. establish the permission/audit actor foundation
4. defer role-specific page visibility and custom role dashboards until later

---

## Key Next.js 16 Breaking Change

> **`middleware.ts` is deprecated.** Next.js 16 renamed it to `proxy.ts` with a named export `proxy` (not a default export). All middleware must be migrated to this new convention.

Clerk's `clerkMiddleware` wraps as a named `proxy` export in `proxy.ts`.

---

## What Must Be Done Manually First

Before implementation, the project owner should do these outside the codebase:

1. **Create a Clerk application**
   - Use an internal/B2B-style app setup.
   - Disable public self-sign-up if Clerk exposes that option in the dashboard.
   - Choose the desired sign-in method, usually email/password or Google Workspace.

2. **Create the first admin Clerk user**
   - This should be the main local/dev account used during development.
   - Use an email that can be linked to the seeded Prisma admin user, or update the seeded admin user later to match the Clerk email.

3. **Copy Clerk keys**
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`

4. **Confirm local redirect/origin settings**
   - Add `http://localhost:3000`.
   - Set sign-in URL to `/sign-in`.
   - Set after-sign-in URL to `/`.

5. **Decide the first admin link**
   - Recommended: link the first Clerk user to `admin+clerk_test@lollipopstudioos.dev` in local seed/dev data, or change the local seeded admin email to the real Clerk admin email before linking.

Do not start with multiple role accounts. One working admin account is enough for the first implementation unit.

---

## Architecture

```
Request
  └─► proxy.ts          ← Clerk session validation on every route
        ├─ Public route? → pass through
        └─ Protected?    → verify session or redirect to /sign-in

App
  └─► ClerkProvider      ← wraps root layout, makes session available
        └─► Auth DAL     ← server-only session/app-user helpers
              └─► Prisma User ← app role and staff identity tied to clerkId
```

---

## Recommended Implementation Units

Keep the first auth rollout small and easy to verify.

### Unit A — Basic Clerk Auth Gate
- install `@clerk/nextjs`
- add env vars
- wrap root layout in `ClerkProvider`
- add `proxy.ts`
- add `/sign-in`
- replace the topbar placeholder user icon with Clerk `UserButton`
- verify signed-out users redirect to `/sign-in`

### Unit B — App User Link
- add nullable unique `User.clerkId`
- migrate/generate Prisma client
- create server-only helpers for Clerk session and current app user lookup
- link one Clerk user to one Prisma admin user
- verify the app can read the signed-in app user's `UserRole`

### Unit C — Permission/Audit Foundation
- add a shared permission helper
- protect sensitive server actions first
- pass/resolve the current app user for audit-sensitive operations
- keep full role-specific page visibility deferred

### Deferred Units
- role-specific navigation and dashboards
- assigned-only photographer/editor views
- Clerk webhook sync
- production-grade user provisioning UI

---

## Step-by-Step Implementation

### Step 1 — Install the Clerk SDK

```bash
npm install @clerk/nextjs
```

No other auth packages are needed. Clerk handles session management, JWT validation, and UI components.

---

### Step 2 — Configure Environment Variables

Add to `.env`:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
```

Use development keys locally. Do not commit real secret values.

Add the same keys (without values) to `.env.example` for documentation:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
```

---

### Step 3 — Wrap Root Layout with ClerkProvider

**File:** `app/layout.tsx`

```tsx
import { ClerkProvider } from '@clerk/nextjs'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Studio OS',
  description: 'Photography studio operations system',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${inter.variable} h-full`}>
        <body className="h-full antialiased">{children}</body>
      </html>
    </ClerkProvider>
  )
}
```

---

### Step 4 — Create proxy.ts for Route Protection

**File:** `proxy.ts` (project root, same level as `app/`)

> This replaces the deprecated `middleware.ts`. The export must be named `proxy`.

```ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
])

export const proxy = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    // Skip Next.js static assets and internal files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
```

**How it works:**
- Every request passes through `proxy`
- `/sign-in` and its sub-paths are public
- All other routes call `auth.protect()` — Clerk redirects unauthenticated users to `/sign-in` automatically

---

### Step 5 — Create Sign-In Page

**File:** `app/sign-in/[[...sign-in]]/page.tsx`

```tsx
import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <SignIn />
    </div>
  )
}
```

The `[[...sign-in]]` catch-all route is required by Clerk for its multi-step sign-in flow (email, MFA, SSO callbacks, etc.).

---

### Step 6 — Create a Data Access Layer (DAL)

**File:** `src/lib/auth/dal.ts`

This is the single place in the app where Clerk session data is read server-side. Pages, Server Actions, and Route Handlers should use this instead of calling `auth()` directly.

```ts
import 'server-only'
import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { cache } from 'react'

export const getSession = cache(async () => {
  const { userId } = await auth()
  return userId ? { userId } : null
})

export const requireAuth = cache(async () => {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  return { userId }
})

export const getCurrentClerkUser = cache(async () => {
  await requireAuth()
  return currentUser()
})
```

Usage in a Server Component:
```ts
import { requireAuth } from '@/lib/auth/dal'

export default async function DashboardPage() {
  await requireAuth() // redirects if not signed in
  // ...
}
```

---

### Step 7 — Add User Button to Topbar

**File:** `src/components/layout/topbar.tsx`

Import and render Clerk's `<UserButton />` component. It renders the user's avatar and provides a built-in dropdown with sign-out, profile management, etc.

The current topbar has a placeholder lucide `User` icon button. Replace that placeholder with `UserButton`; keep the notification button and development reset button unchanged.

```tsx
import { UserButton } from '@clerk/nextjs'

// Inside the topbar JSX, replace or augment the right side:
<UserButton afterSignOutUrl="/sign-in" />
```

---

### Step 8 — Add unauthorized.tsx Special File

**File:** `app/unauthorized.tsx`

Next.js 16 supports this special file — it renders automatically when `unauthorized()` is called from `next/navigation`.

```tsx
import Link from 'next/link'

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">Access Denied</h1>
      <p className="text-gray-500">You don't have permission to view this page.</p>
      <Link href="/" className="text-blue-600 underline">Return to Dashboard</Link>
    </div>
  )
}
```

---

### Step 9 — Prisma Schema: Link Clerk Identity to User Record

> **Requires explicit approval before implementation.** The `prisma/schema.prisma` file is protected.

Add a `clerkId` field to the `User` model to link Clerk's identity to the app's role/permission data:

```prisma
model User {
  id        String   @id @default(cuid())
  clerkId   String?  @unique   // ← add this
  name      String
  email     String   @unique
  role      UserRole
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Then run:
```bash
npm run db:migrate
```

After migration, link the local admin user to the Clerk user by setting `User.clerkId` to Clerk's user ID. This may be done through a small one-off script, Prisma Studio, or a controlled admin-link helper during implementation.

---

### Step 10 — User Sync Strategy

Since Clerk owns the identity and Prisma owns the role, they must be kept in sync. Two approaches:

**Option A — On-Demand Lookup (simpler, recommended to start)**

On every authenticated request that needs the user's role, look up by `clerkId`:

```ts
// src/lib/auth/get-user.ts
import 'server-only'
import { cache } from 'react'
import { db } from '@/lib/db'
import { requireAuth } from './dal'

export const getAppUser = cache(async () => {
  const { userId: clerkId } = await requireAuth()
  const user = await db.user.findUnique({ where: { clerkId } })
  if (!user) {
    throw new Error('Authenticated Clerk user is not linked to a Studio OS user')
  }
  return user
})
```

For this app, Prisma `User.role` should be the source of truth for application permissions in the first implementation. Clerk identifies the person; Prisma decides what that person can do inside Studio OS.

**Option B — Clerk Webhook Sync (for production)**

Create `app/api/webhooks/clerk/route.ts` to handle `user.created`, `user.updated`, and `user.deleted` events from Clerk. Use the `svix` package to verify the webhook signature. This keeps the Prisma `User` table in sync with Clerk's directory.

For initial setup, Option A is sufficient. Option B should be added before production only if automatic user provisioning/sync is needed.

---

## Role-Based Access Control (RBAC)

The existing `UserRole` enum defines 7 roles:

| Role | Description |
|------|-------------|
| `ADMIN` | Full access |
| `MANAGER` | Operations management |
| `RECEPTIONIST` | Front desk, bookings |
| `RESERVATION` | Booking management |
| `PHOTOGRAPHER` | Session management |
| `EDITOR` | Photo editing workflow |
| `ACCOUNTANT` | Financial data |

### Recommended V1 RBAC Scope

Do not build the full role-specific app experience in the first auth unit.

For V1 auth foundation:
- protect all dashboard routes from unauthenticated access
- resolve the current Prisma `User`
- add shared permission helpers
- apply permission checks to sensitive server actions first
- keep navigation centralized enough to support future filtering

Role-specific navigation, dashboards, page-level information hiding, and assigned-only views should be added later.

### Permission Helper Direction

Add a small shared helper in `src/lib/permissions/` or `src/lib/auth/permissions.ts`.

Suggested shape:

```ts
requirePermission(user, "payment:update")
```

Start with coarse permissions for sensitive actions:
- `payment:create`
- `invoice:update`
- `invoice:lock`
- `order:deliver`
- `workflow:override`
- `commission:update`

Do not spread raw role checks across pages and components.

### Clerk Metadata

Clerk `publicMetadata` can optionally mirror the role later for edge-level route checks, but it should not be the first source of truth.

If added later:

```ts
// When assigning/changing a role (admin action only):
await clerkClient.users.updateUser(clerkId, {
  publicMetadata: { role: 'MANAGER' }
})
```

**Read it in proxy.ts for route-level RBAC** (future enhancement):
```ts
const { sessionClaims } = await auth()
const role = sessionClaims?.publicMetadata?.role
```

Until that later enhancement, use Prisma role lookup after authentication.

---

## Development Testing Strategy

Auth should not make development painful.

Recommended local approach:

1. Use one Clerk account linked to a Prisma `ADMIN` user for normal development.
2. Keep seeded Prisma users for role/assignment data.
3. Add missing seed users for `ACCOUNTANT` and `RESERVATION` when role testing begins.
4. Add a dev-only role override/switcher later if permission testing becomes repetitive.

The dev role override must be guarded by `NODE_ENV === "development"` or an explicit env flag like `ENABLE_DEV_ROLE_SWITCHER=true`.

The override should flow through the same app-user/permission helper used by server actions. It should not be UI-only, or permission tests will be misleading.

---

## Files to Create/Modify

| File | Action | Notes |
|------|--------|-------|
| `proxy.ts` | Create | Route protection, replaces `middleware.ts` |
| `app/layout.tsx` | Modify | Add `<ClerkProvider>` |
| `app/sign-in/[[...sign-in]]/page.tsx` | Create | Clerk sign-in UI |
| `app/unauthorized.tsx` | Create | 401 error page |
| `src/lib/auth/dal.ts` | Create | Server-only session helpers |
| `src/components/layout/topbar.tsx` | Modify | Add `<UserButton />` |
| `.env` | Modify | Add Clerk env vars |
| `.env.example` | Modify | Document Clerk env vars |
| `prisma/schema.prisma` | Modify (**needs approval**) | Add `clerkId` to `User` |
| `src/lib/auth/get-app-user.ts` or equivalent | Create | Prisma app-user lookup by Clerk ID |
| `src/lib/permissions/*` | Create later | Shared permission helpers for Unit C |
| `prisma/seed.ts` | Modify later | Add/link dev users for missing roles if needed |

---

## Clerk Dashboard Configuration

Before running the app, configure in the Clerk dashboard:

1. **Application type:** Set to "B2B / Internal Tool" (disables public sign-up)
2. **Allowed sign-in methods:** Email + password, or SSO (Google Workspace, etc.)
3. **Redirect URLs:** Add `http://localhost:3000` to allowed origins
4. **Sign-in URL:** Set to `/sign-in`
5. **After sign-in URL:** Set to `/`
6. **Webhooks (for Step 10B):** Add endpoint `https://yourdomain.com/api/webhooks/clerk`

For the first local implementation, webhooks can be skipped.

---

## Verification Checklist

### Unit A
- [ ] Visiting any route while signed out redirects to `/sign-in`
- [ ] Signing in redirects back to the dashboard
- [ ] `<UserButton />` appears in topbar with correct user avatar
- [ ] Signing out via UserButton clears session and redirects to `/sign-in`
- [ ] `/sign-in` is accessible without authentication
- [ ] Clerk env vars are set and application starts without errors
- [ ] TypeScript has no errors (`npx tsc --noEmit`)

### Unit B
- [ ] `clerkId` migration runs cleanly (`npm run db:migrate`)
- [ ] Prisma client is regenerated after migration
- [ ] One Clerk user is linked to one Prisma `ADMIN` user
- [ ] Current Prisma app user can be read server-side
- [ ] Current Prisma app user's `role` can be read server-side

### Unit C
- [ ] Shared permission helper exists
- [ ] At least one sensitive action uses the permission helper
- [ ] Unauthorized app users receive a clear error or unauthorized page
- [ ] Permission behavior is verified with an admin user and one non-admin role

---

## Risks & Notes

- **proxy.ts vs middleware.ts:** Clerk's docs may still reference `middleware.ts`. Use `proxy.ts` with named export `proxy` for Next.js 16 compatibility.
- **Schema change is protected:** `prisma/schema.prisma` requires explicit approval before modification.
- **No public sign-up:** This is intentional for an internal tool. If users self-register is ever needed, it must be a deliberate product decision.
- **`auth()` is async:** In Next.js 16 with Clerk v6+, `auth()` returns a Promise. Always `await` it.
- **Do not overbuild role UX now:** Role-specific navigation/pages/info visibility should be implemented later after the shared auth and permission helpers exist.
- **Unlinked Clerk user behavior:** If a signed-in Clerk user has no matching Prisma user, fail closed with a clear error instead of silently treating them as a default role.
- **Production user sync:** Clerk webhooks or admin provisioning should be revisited before production, but they are not required for the first local auth unit.
