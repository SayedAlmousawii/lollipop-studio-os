## Goal

Close the remaining open gaps from the auth and permission foundation (Features 50–51) before moving to workflow guard hardening. This unit hardens the auth gate, fixes known failure modes, resolves a permission model honesty issue, and wires the two workflow permissions that were intentionally deferred.

---

## Read First

- `context/ai-workflow-summary.md`
- `context/code-standards-summary.md`
- `context/feature-specs/50-auth-and-staff-identity-foundation.md`
- `context/feature-specs/51-permission-and-audit-actor-foundation.md`
- `context/reviews/auth-review.md`
- `context/reviews/role-permissions-design.md`

---

## Rules

- Keep scope strictly to the five items listed below — do not expand into new permissions, UI changes, or workflow logic
- Do not change any existing guarded server actions — only add guards to currently unguarded ones
- Do not introduce role-specific navigation or page visibility
- All changes must pass TypeScript, lint, and build

---

## Scope

### In Scope

1. Create `app/unauthorized.tsx`
2. Add auth guard to `app/(dashboard)/layout.tsx`
3. Replace unlinked-user crash with a redirect in `src/lib/auth/current-user.ts`
4. Grant `invoice:create` to `RECEPTIONIST` in `src/lib/permissions/index.ts`
5. Add `workflow:editing-update` and `workflow:production-update` permission keys, assign roles per the role-permissions-design map, and replace the auth-only calls in the two currently unguarded order workflow actions

### Out of Scope

- Any other permission additions or role changes
- Page-level or navigation-level RBAC visibility
- Error boundary or global error UI changes
- Clerk webhook sync or user provisioning
- Dev role override switcher

---

## Implementation Direction

### 1. `app/unauthorized.tsx`

Next.js 16 renders this file automatically when `unauthorized()` is called from `next/navigation`. Create it at the app root. Match existing app styling. The page should communicate clearly that the user is authenticated but lacks access, and provide a link back to the dashboard.

---

### 2. Dashboard Layout Auth Guard

`app/(dashboard)/layout.tsx` wraps every dashboard page but currently has no auth check of its own. `proxy.ts` is the only protection.

Convert the layout to async and call `requireCurrentAppUser()` at the top before rendering. The resolved user does not need to be passed further down — this call is a gate only. The proxy remains the primary guard; this is defense-in-depth.

---

### 3. Unlinked-User Crash Fix

`requireCurrentAppUser()` in `src/lib/auth/current-user.ts` throws a generic `Error` when a signed-in Clerk user has no matching Prisma record. This is an unhandled 500 in production.

Replace the throw with a redirect to `/unauthorized`. An unlinked user is a known, expected state — it should be handled gracefully, not crash.

---

### 4. Grant `invoice:create` to `RECEPTIONIST`

The deposit and base-payment flows internally create invoices as a side effect. `RECEPTIONIST` triggers these flows but does not currently hold `invoice:create`. This is a permission model honesty issue documented in `context/reviews/role-permissions-design.md` under Design Principle 5.

Add `invoice:create` to the `RECEPTIONIST` entry in `ROLE_PERMISSIONS`. No action or service changes are needed — this is a role map correction only. The longer-term operation-scoped key redesign remains a future note in the design doc.

---

### 5. Editing and Production Workflow Permissions

Two server actions in `app/orders/[orderId]/actions.ts` — `updateEditingWorkflowAction` and `updateProductionWorkflowAction` — currently call `requireCurrentAppUser()` instead of `requireCurrentAppUserPermission()`. Every authenticated user can drive these workflows regardless of role.

- Add `workflow:editing-update` and `workflow:production-update` to the `PERMISSIONS` constant
- Add role assignments in `ROLE_PERMISSIONS` per the intended map in `context/reviews/role-permissions-design.md`
- Add permission labels for both new keys in `PERMISSION_LABELS`
- Replace the auth-only `requireCurrentAppUser()` calls in both actions with `requireCurrentAppUserPermission()` using the appropriate new key

Note: `workflow:production-update` is intentionally granted broadly (all roles except `ACCOUNTANT`) as a temporary stance while production workflow ownership is still undefined. This should be narrowed in a future unit once a responsible role is identified.

---

## Post-Implementation: Update Review Docs

After implementation is complete and verified, update the following:

**`context/reviews/auth-review.md`**
- Mark Gap #2 (editing/production workflow no permission check) as resolved
- Mark Gap #5 (`app/unauthorized.tsx` missing) as resolved
- Mark Gap #6 (unlinked user crashes) as resolved
- Add the dashboard layout guard to the "What's Already Done" checklist
- Update the rating if the fixes materially change the assessment

**`context/reviews/role-permissions-design.md`**
- Update Design Principle 5 to note that `invoice:create` is now granted to `RECEPTIONIST`
- Update the Role → Permission Map table to reflect all new assignments
- Update the Receptionist "Restricted from" description to remove `invoice:create`

---

## Acceptance Criteria

- `app/unauthorized.tsx` exists and renders a clear access-denied message
- Visiting any dashboard route while signed out redirects to `/sign-in`
- A signed-in Clerk user with no linked Prisma record is redirected to `/unauthorized` instead of throwing a 500
- `RECEPTIONIST` holds `invoice:create` in `ROLE_PERMISSIONS`
- `PERMISSIONS.WORKFLOW_EDITING_UPDATE` and `PERMISSIONS.WORKFLOW_PRODUCTION_UPDATE` exist in the permissions file with correct role assignments
- `EDITOR` can call `updateEditingWorkflowAction` without a permission error
- A role without `workflow:editing-update` (e.g. `ACCOUNTANT`) is blocked from `updateEditingWorkflowAction`
- `ACCOUNTANT` is blocked from `updateProductionWorkflowAction`
- `context/reviews/auth-review.md` is updated
- `context/reviews/role-permissions-design.md` is updated
- `context/progress-tracker.md` is updated
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
