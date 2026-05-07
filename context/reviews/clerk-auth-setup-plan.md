# Clerk Authentication Setup Plan

**Date:** 2026-05-07  
**Project:** lollipop-studio-os  
**Next.js Version:** 16.2.4 (React 19)

---

## Overview

Studio OS currently has **no authentication**. All routes are publicly accessible. This plan adds Clerk as the identity and session management layer to protect all dashboard routes, expose the current user's identity/role within the application, and enforce role-based access control aligned with the existing `UserRole` enum in the Prisma schema.

This is an **internal tool** — there is no public sign-up flow. User accounts are created and managed by admins in the Clerk dashboard.

---

## Key Next.js 16 Breaking Change

> **`middleware.ts` is deprecated.** Next.js 16 renamed it to `proxy.ts` with a named export `proxy` (not a default export). All middleware must be migrated to this new convention.

Clerk's `clerkMiddleware` wraps as a named `proxy` export in `proxy.ts`.

---

## Architecture

```
Request
  └─► proxy.ts          ← Clerk session validation on every route
        ├─ Public route? → pass through
        └─ Protected?    → verify session or redirect to /sign-in

App
  └─► ClerkProvider      ← wraps root layout, makes session available
        └─► DAL (dal.ts) ← server-only session helper used by pages/actions
              └─► Prisma User ← role lookups tied to clerkId
```

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

This is the single place in the app where session data is read server-side. All pages, Server Actions, and Route Handlers should use this instead of calling `auth()` directly.

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
  const session = await requireAuth()
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
  return db.user.findUnique({ where: { clerkId } })
})
```

**Option B — Clerk Webhook Sync (for production)**

Create `app/api/webhooks/clerk/route.ts` to handle `user.created`, `user.updated`, and `user.deleted` events from Clerk. Use the `svix` package to verify the webhook signature. This keeps the Prisma `User` table in sync with Clerk's directory.

For initial setup, Option A is sufficient. Option B should be added before production.

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

**Store the role in Clerk `publicMetadata`** for edge-level checks:

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

---

## Clerk Dashboard Configuration

Before running the app, configure in the Clerk dashboard:

1. **Application type:** Set to "B2B / Internal Tool" (disables public sign-up)
2. **Allowed sign-in methods:** Email + password, or SSO (Google Workspace, etc.)
3. **Redirect URLs:** Add `http://localhost:3000` to allowed origins
4. **Sign-in URL:** Set to `/sign-in`
5. **After sign-in URL:** Set to `/`
6. **Webhooks (for Step 10B):** Add endpoint `https://yourdomain.com/api/webhooks/clerk`

---

## Verification Checklist

- [ ] Visiting any route while signed out redirects to `/sign-in`
- [ ] Signing in redirects back to the dashboard
- [ ] `<UserButton />` appears in topbar with correct user avatar
- [ ] Signing out via UserButton clears session and redirects to `/sign-in`
- [ ] `/sign-in` is accessible without authentication
- [ ] Clerk env vars are set and application starts without errors
- [ ] TypeScript has no errors (`npx tsc --noEmit`)
- [ ] `clerkId` migration runs cleanly (`npm run db:migrate`)
- [ ] Role can be read from `publicMetadata` in a Server Component

---

## Risks & Notes

- **proxy.ts vs middleware.ts:** Clerk's docs may still reference `middleware.ts`. Use `proxy.ts` with named export `proxy` for Next.js 16 compatibility.
- **Schema change is protected:** `prisma/schema.prisma` requires explicit approval before modification.
- **No public sign-up:** This is intentional for an internal tool. If users self-register is ever needed, it must be a deliberate product decision.
- **`auth()` is async:** In Next.js 16 with Clerk v6+, `auth()` returns a Promise. Always `await` it.
