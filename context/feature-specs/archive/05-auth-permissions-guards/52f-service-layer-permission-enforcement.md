## Goal

Move permission checks from the caller layer into the service functions themselves, so that any caller — server actions, background jobs, scripts, future API routes — cannot bypass authorization by calling the service directly.

---

## Read First

- `context/reviews/workflow-guard-audit.md`
- `src/lib/permissions/index.ts` — read the full file: `PERMISSIONS` constants, `ROLE_PERMISSIONS` map, and the existing `hasPermission` / `requirePermission` / `requireCurrentAppUserPermission` functions
- `src/lib/auth/actor-context.ts` — the current `ActorContext` type
- `src/lib/auth/current-user.ts` — understand what `CurrentAppUser` carries, specifically the `role` field

---

## Rules

- No schema changes
- No UI component changes
- Permission violations throw — they do not silently no-op
- Service functions must not call `unauthorized()` from `next/navigation` — that is a Next.js navigation primitive and makes the service depend on the framework
- Only exported service functions for high-risk operations need guards — internal helpers do not
- The `ActorContext` extension must be backward compatible: new fields are optional so existing callers without a role are still accepted

---

## Background

P3 from the guard audit: "Permission checks are only enforced at the server action level. Service functions called directly — from scripts, background jobs, tests, or future API routes — bypass permission entirely."

Example: `PHOTOGRAPHER` lacks `DELIVERY_COMPLETE`. A server action enforces this. But `updateOrderDeliveryWorkflow()` called directly bypasses the check entirely. This is a single-layer defense.

Currently `ActorContext` only carries `actorUserId`. There is no role information in the service context, so permission checks cannot be made without extending it.

The key design constraint: callers that do not supply a role must still be accepted — scripts and tests use the service directly without going through the auth layer, and breaking them would be harmful. Role-based enforcement only applies when a role is explicitly provided.

---

## Scope

### In Scope

1. Extend `ActorContext` with an optional role field
2. Add a permission assertion helper inside `order.service.ts` — uses `hasPermission`, not `requirePermission`, to stay framework-agnostic
3. Add permission checks to these three exported service functions:
   - `updateOrderEditingWorkflow` — requires the editing update permission
   - `updateOrderProductionWorkflow` — requires the production update permission
   - `updateOrderDeliveryWorkflow` — requires the delivery update permission for all actions; the `completeOrder` action additionally requires the delivery complete permission; the payment override path additionally requires the payment override permission
4. Update all callers that construct `ActorContext` to pass the actor's role where the current app user is available

### Out of Scope

- Booking or invoice service permission checks — different module, different review
- Adding new permissions to `PERMISSIONS` or changing `ROLE_PERMISSIONS` mappings
- UI changes

---

## Implementation Direction

Read `src/lib/permissions/index.ts` and `src/lib/auth/actor-context.ts` fully before writing anything. Understand what `hasPermission` takes and returns, and how `ActorContext` is currently used across the service.

**Extending `ActorContext`**
Add an optional role field to `ActorContext`. The type for the role value already exists in the codebase — look at how `UserRole` is used elsewhere. Make the field optional and nullable so callers that omit it continue to work without changes.

**Permission assertion helper in `order.service.ts`**
Define a private helper (not exported) that takes an `ActorContext` and a permission string. The logic: if no role is present in the context, return without checking — the caller is trusted. If a role is present, call `hasPermission` from `src/lib/permissions/index.ts`. If permission is denied, throw with a clear message. Do not call `requirePermission` — that function calls `unauthorized()` which is a Next.js navigation primitive and should not be called from a service.

**Adding checks to the three service functions**
Read each function's structure before deciding where to place the check. The general pattern: call the permission helper near the top of the function, before the transaction begins, so a permission failure is fast and leaves no partial state. For `updateOrderDeliveryWorkflow`, the `completeOrder` action check and the payment override check happen at different points in the flow — read how the action is resolved and place each check at the appropriate point.

**Updating callers**
Search the codebase for every call to the three service functions. For each, check whether the calling context has access to the current app user. If it does, include the role in the `ActorContext` passed to the service. Read `src/lib/auth/current-user.ts` to understand what `requireCurrentAppUser` returns and which field carries the role.

---

## Post-Implementation

**`context/progress-tracker.md`**
- Update Now section: Feature 52 guard series complete (52a–52f); Feature 53 (deliverable-driven sections) pending schema review
- Add to Feature History: "Feature 52f: Service-layer permission enforcement — ActorContext extended with role; editing, production, and delivery workflow service functions now assert permissions independently of the call site."

---

## Acceptance Criteria

1. `ActorContext` has an optional role field
2. A private permission assertion helper exists in `order.service.ts` and uses `hasPermission`, not `requirePermission`
3. `updateOrderEditingWorkflow` rejects callers with a role that lacks the editing update permission
4. `updateOrderProductionWorkflow` rejects callers with a role that lacks the production update permission
5. `updateOrderDeliveryWorkflow` rejects callers with a role that lacks the delivery update permission
6. The `completeOrder` action additionally rejects callers that lack the delivery complete permission
7. The payment override path additionally rejects callers that lack the payment override permission
8. Callers that omit the role from `ActorContext` are still accepted — backward compatible
9. All existing callers updated to pass the actor's role where the current app user is available
10. TypeScript passes
11. `npm run build` passes
12. `npm run lint` passes
13. Update `context/progress-tracker.md`
