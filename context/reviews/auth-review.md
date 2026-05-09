# Authentication & Authorization Review

**Date:** 2026-05-09
**Scope:** Clerk auth setup, app-user linking, RBAC permission system
**Replaces:** `clerk-auth-setup-plan.md` (implementation complete — see checklist below)

---

## What's Already Done

- [x] `@clerk/nextjs` installed and configured
- [x] Clerk env vars documented in `.env.example` (`PUBLISHABLE_KEY`, `SECRET_KEY`, sign-in/after-sign-in URLs)
- [x] `ClerkProvider` wraps root layout in `app/layout.tsx`
- [x] `proxy.ts` at project root with named `proxy` export and `createRouteMatcher` guarding all non-public routes
- [x] `/sign-in/[[...sign-in]]/page.tsx` with Clerk `<SignIn>` component and correct catch-all routing
- [x] `<UserButton>` rendered in topbar, replacing the placeholder icon
- [x] `clerkId String? @unique` added to Prisma `User` model and migrated
- [x] `src/lib/auth/current-user.ts` — single server-only module for `getCurrentClerkSession`, `getCurrentClerkUser`, `getCurrentAppUser`, `requireCurrentAppUser`, all wrapped in `cache()`
- [x] Auto-link on first sign-in: looks up Prisma user by primary email, writes `clerkId` automatically — no manual linking needed
- [x] Race condition guard on the link write (catches Prisma P2002 unique constraint and re-queries)
- [x] `src/lib/auth/actor-context.ts` — `ActorContext` interface exported and used across all service calls
- [x] `src/lib/permissions/index.ts` — named `PERMISSIONS` constants, `ROLE_PERMISSIONS` map for all 7 roles, `hasPermission`, `requirePermission`, `requireCurrentAppUserPermission`
- [x] Permission checks wired into all sensitive server actions: booking status, payments, invoice issue/close/adjustment, order financial updates, delivery workflow, editing workflow, production workflow
- [x] `app/(dashboard)/layout.tsx` calls `requireCurrentAppUser()` as defense-in-depth behind `proxy.ts`
- [x] `app/unauthorized.tsx` created — renders when an unlinked Clerk user hits the auth gate

---

## Current Auth & Authorization Flow

### Request-Level Gate (every HTTP request)

```
Incoming Request
       │
       ▼
  proxy.ts  ──── is /sign-in? ──YES──► Pass through (public)
       │
       NO
       │
       ▼
  auth.protect()
       │
  ┌────┴────────────────┐
  │ No Clerk session?   │
  │ → redirect /sign-in │
  └────┬────────────────┘
       │ Valid session
       ▼
  Route renders normally
```

### First Sign-In: Auto-Link Flow

```
Clerk session exists, userId known
       │
       ▼
  db.user.findUnique({ clerkId })
       │
  ┌────┴──────────────────────────┐
  │ Found → return linked user    │  (fast path, no Clerk API call)
  └────┬──────────────────────────┘
       │ Not found
       ▼
  currentUser()  ← Clerk API call (first sign-in only)
       │
  primaryEmailAddress
       │
       ▼
  db.user.findUnique({ email })
       │
  ┌────┴──────────────────────────────────────────┐
  │ Found & unlinked → db.user.update(clerkId)    │
  │ P2002 race? → re-query by clerkId             │
  │ Already linked / not found → return null      │
  └────┬──────────────────────────────────────────┘
       │
       ▼
  CurrentAppUser { id, clerkId, name, email, role }
```

### Server Action: Auth + Authorization Flow

```
Server Action called (e.g. issueInvoiceAction)
       │
       ▼
  requireCurrentAppUserPermission(PERMISSIONS.INVOICE_ISSUE)
       │
       ▼
  requireCurrentAppUser()
       │
       ├─ getCurrentClerkSession()
       │       │
       │  No session? → redirect("/sign-in")
       │       │
       │  Valid session → { userId, sessionId }
       │
       ▼
  getCurrentAppUser()   [cache() — one DB call per request]
       │
       ├─ clerkId lookup in Prisma
       │
       │  Not linked? → throw Error (unlinked user)
       │
       ▼
  CurrentAppUser resolved
       │
       ▼
  requirePermission(appUser, permission)
       │
  ROLE_PERMISSIONS[appUser.role].includes(permission)?
       │
  ┌────┴──────────────────────┐
  │ NO → throw Error          │  ← surfaces as action error to UI
  │      (permission denied)  │
  └────┬──────────────────────┘
       │ YES
       ▼
  service(data, { actorUserId: appUser.id })
       │
       ▼
  DB write + audit actor recorded
```

### Role → Permission Map (current)

| Role          | Permissions |
|---------------|-------------|
| `ADMIN`       | All |
| `MANAGER`     | All |
| `RECEPTIONIST`| `booking:status-update`, `payment:create`, `invoice:create`, `delivery:update`, `delivery:complete`, `workflow:production-update` |
| `RESERVATION` | `booking:status-update`, `workflow:production-update` |
| `PHOTOGRAPHER`| `workflow:production-update` |
| `EDITOR`      | `workflow:editing-update`, `workflow:production-update` |
| `ACCOUNTANT`  | `payment:create`, `invoice:create`, `invoice:issue`, `invoice:close`, `invoice:adjustment-create` |

---

## Gaps & Recommendations

### 1. ~~No defense-in-depth at the page level~~ — RESOLVED

`app/(dashboard)/layout.tsx` is now async and calls `requireCurrentAppUser()` before rendering. The proxy remains the coarse gate; the layout is the fine gate.

---

### 2. ~~Editing and production workflow actions have no permission check~~ — RESOLVED

`workflow:editing-update` and `workflow:production-update` added to `PERMISSIONS`. Both actions now call `requireCurrentAppUserPermission` with the appropriate key. `EDITOR` holds `workflow:editing-update`; all roles except `ACCOUNTANT` hold `workflow:production-update` (broad temporary stance pending production ownership definition).

---

### 3. Inconsistent error propagation in server actions

`issueInvoiceAction` and `closeInvoiceAction` in [invoices/actions.ts](../../app/invoices/actions.ts) call `requireCurrentAppUserPermission` outside a try/catch. An unauthorized user causes an unhandled throw — a 500 in production, not a graceful action error.

Compare to `recordPaymentAction` in the same file, which wraps everything in try/catch and returns `{ errors: { _global: [message] } }`.

**Fix:** Wrap the permission call in the same try/catch pattern used by other actions in that file, or establish a consistent convention (e.g. all actions that return void throw unguarded, all actions that return state wrap in try/catch).

---

### 4. Permission system throws `new Error()` instead of `unauthorized()`

[permissions/index.ts:73](../../src/lib/permissions/index.ts#L73) throws a generic `Error`. Next.js 16 has `unauthorized()` from `next/navigation` that triggers the `unauthorized.tsx` special file and returns a proper 401 response.

Once `app/unauthorized.tsx` is created (see below), update `requirePermission` to call `unauthorized()` instead of throwing, so the framework handles the response correctly.

```ts
import { unauthorized } from 'next/navigation'

export function requirePermission(appUser, permission) {
  if (!hasPermission(appUser, permission)) {
    unauthorized()
  }
}
```

---

### 5. ~~`app/unauthorized.tsx` is missing~~ — RESOLVED

`app/unauthorized.tsx` created. Renders an access-denied message with a link back to the dashboard when an unlinked Clerk user hits `requireCurrentAppUser()`.

---

### 6. ~~Unlinked Clerk user crashes instead of redirecting~~ — RESOLVED

`requireCurrentAppUser()` now redirects to `/unauthorized` instead of throwing a generic `Error` when the Clerk user has no linked Prisma record.

---

### 7. `ClerkProvider` is inside `<body>` instead of wrapping `<html>`

[layout.tsx:22-24](../../app/layout.tsx#L22) — `ClerkProvider` wraps only the body content. The recommended placement wraps `<html>` to avoid potential hydration edge cases with Clerk's context propagation.

```tsx
export default function RootLayout({ children }) {
  return (
    <ClerkProvider dynamic>
      <html lang="en" className={`${inter.variable} h-full`}>
        <body className="h-full antialiased">{children}</body>
      </html>
    </ClerkProvider>
  )
}
```

---

### 8. `ActorContext.actorUserId` is optional after auth is verified

[actor-context.ts:2](../../src/lib/auth/actor-context.ts#L2) — `actorUserId?: string | null`. Services that require an actor for audit accept an optional field, which means TypeScript won't catch calls where actor is accidentally omitted.

For services where audit attribution is required (payments, status changes), tighten the type:

```ts
// Two distinct contexts:
export interface ActorContext {
  actorUserId?: string | null  // for fire-and-forget / optional attribution
}

export interface RequiredActorContext {
  actorUserId: string          // for audit-critical operations
}
```

Then type-check at the service signature: `recordPayment(data: ..., actor: RequiredActorContext)`.

---

## Deferred (Intentionally Not Yet Built)

These items from the original plan are explicitly out of scope until later:

- **Clerk webhook sync** — `app/api/webhooks/clerk/route.ts` for `user.created/updated/deleted` events. Not needed until multi-user provisioning or production user management is required.
- **Role-specific navigation and dashboards** — sidebar filtering, page-level information hiding per role. Deferred until permission foundation is stable.
- **Dev role override switcher** — a `NODE_ENV === "development"` override that flows through the same permission helper for easier role testing. Useful once more roles need coverage.
- **Clerk metadata mirroring** — writing `publicMetadata.role` to Clerk for edge-level route checks in `proxy.ts`. Prisma role lookup is the source of truth for now.
- **Production user provisioning UI** — admin interface for creating/linking users. Currently done manually or via Prisma Studio.

---

## Rating: 8.5 / 10

The architecture is correct and the patterns are sound. Identity and authorization are cleanly separated. Named permission constants, composable auth helpers, actor threading, the auto-link mechanism, defense-in-depth layout guard, and graceful unlinked-user handling are all solid.

Remaining open gaps:

- Error propagation is inconsistent across server actions (Gap #3 — `issueInvoiceAction`/`closeInvoiceAction` still throw unguarded)
- `requirePermission` still throws `new Error()` rather than calling `unauthorized()` (Gap #4)
- `ActorContext.actorUserId` is still optional on audit-critical service signatures (Gap #8)
