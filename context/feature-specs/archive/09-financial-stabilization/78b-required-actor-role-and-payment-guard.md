## Goal

Close two paired authorization gaps surfaced in Feature 77 review: (1) `assertActorPermission()` silently returns early when `actorRole` is missing, turning any internal caller without a role into an authorization bypass; and (2) `recordPayment()` has no in-service role check at all — its server-action wrapper is the only enforcement layer, so any direct service caller can create payments regardless of role.

Make `actorRole` a required field on `ActorContext` (type-level), throw on missing, and add an explicit `PAYMENT_CREATE` check inside `recordPaymentWithClient` so every code path that creates a payment is authorized at the service boundary.

Closes roadmap items **S1** and **S2**.

---

## Read First

- `context/reviews/77-post-verification-hardening-roadmap.md` — §5 S1, S2
- `src/lib/auth/actor-context.ts` — `ActorContext` type
- `src/modules/orders/order.service.ts:131` — current `assertActorPermission` body (note: it short-circuits on missing role)
- `src/modules/orders/order.service.ts:539` and other call sites — existing usage patterns
- `src/modules/payments/payment.service.ts:179` — `recordPayment` (no current guard)

---

## Rules

- `ActorContext.actorRole` becomes required (non-nullable) at the type level. All `actorContext = {}` defaults are removed.
- `assertActorPermission` no longer short-circuits — if it is called with a context missing `actorRole`, it throws `MissingActorRoleError`. Static typing ensures the error is unreachable from typed call sites; the runtime check protects against `any`-typed callers (e.g., test harness, raw fixtures).
- `recordPaymentWithClient` calls `assertActorPermission(actorContext, PERMISSIONS.PAYMENT_CREATE)` as its first non-lock statement (after the row lock from 78a, if 78a has merged).
- The `assertActorPermission` helper currently lives in `order.service.ts`. Move it to a shared location (`src/lib/auth/assert-actor-permission.ts`) so both order and payment services consume the same implementation.
- All existing call sites in `order.service.ts` continue to behave identically for callers with valid roles. The only behavioral change is: callers that previously passed `{}` or `{ actorRole: undefined }` now throw.

---

## Scope

### In Scope

**Type change**

```ts
// src/lib/auth/actor-context.ts
export type ActorContext = {
  actorUserId: string;
  actorRole: UserRole;
};
```

Both fields become required. Remove optional markers.

**Shared assert helper**

Create `src/lib/auth/assert-actor-permission.ts`:

```ts
export class MissingActorRoleError extends Error {
  constructor() {
    super('actorRole is required for permission checks');
    this.name = 'MissingActorRoleError';
  }
}

export function assertActorPermission(
  actorContext: ActorContext,
  permission: Permission
): void {
  if (!actorContext.actorRole) {
    throw new MissingActorRoleError();
  }
  if (!hasPermission({ role: actorContext.actorRole }, permission)) {
    throw new ForbiddenError(permission);
  }
}
```

Delete the copy in `order.service.ts:131` and import from the new module.

**Payment service guard**

In `recordPaymentWithClient`, after the row-lock acquisition (78a) and before reading the invoice:

```ts
assertActorPermission(actorContext, PERMISSIONS.PAYMENT_CREATE);
```

If 78a has not landed yet, place it as the first statement in the function body.

**Remove defaults**

Every `actorContext: ActorContext = {}` default parameter in the codebase is removed. Call sites must pass a real `ActorContext`. Compile errors are the audit mechanism — fix each one by routing the real actor through.

**Test fixtures**

`tests/fixtures/actor.ts` (new) exports `makeManagerActor()`, `makeStaffActor()`, `makePhotographerActor()`, `makeEditorActor()` — typed `ActorContext` builders for tests. Update existing tests that pass `{}` to use these.

**Regression test**

`tests/auth/payment-role-guard.test.ts`:

- Test A: `recordPayment` with a `PHOTOGRAPHER` actor → throws `ForbiddenError(PAYMENT_CREATE)`. No payment row created.
- Test B: `recordPayment` with a `MANAGER` actor → succeeds.
- Test C: `assertActorPermission` called with `actorRole: undefined` (via `any`-cast) → throws `MissingActorRoleError`.

### Out of Scope

- **S3** Browser role-negative tests for URL-level financial visibility — deferred per §12.
- **S4 / A1** `AuditLog` model for actor attribution — Sprint 3.
- Changes to the permission catalog (`PERMISSIONS.*`). Existing permissions are sufficient.
- Server-action wrapper changes — they already enforce role at the HTTP boundary; this spec adds defense in depth at the service boundary.

---

## Implementation Direction

**Risk:** Low-medium. The risk is breadth, not depth: removing the optional `actorRole` will cause compile errors at every untyped call site. Each fix is mechanical (pass the real actor) but there are many of them.

**Order of work:**

1. Move `assertActorPermission` to `src/lib/auth/`. Existing call sites in `order.service.ts` switch to the new import — behavior unchanged because `actorRole` is still optional at this step.
2. Add `assertActorPermission` call inside `recordPaymentWithClient`. Add regression test A and B.
3. Make `actorRole` required at the type level. Fix the resulting TypeScript errors site-by-site. Run `npm run build` after each cluster of fixes.
4. Add the `MissingActorRoleError` throw inside `assertActorPermission`. Add regression test C.
5. Remove `actorContext: ActorContext = {}` defaults throughout. Final `npm run build` pass.

**Rollback:** Each step is independently revertable. The risky moment is step 3 (type tightening) — if it surfaces unexpected callers, revert just that commit and address them iteratively.

**Why service-level guard in addition to server-action wrapper:** internal callers (background jobs, future modules, test fixtures) bypass the server-action wrapper entirely. The service is the single choke point that all callers traverse. This is the same defense-in-depth pattern Phase 77 invariant testing recommends for every financial entry point.

---

## Verification

- `tests/auth/payment-role-guard.test.ts` passes.
- All existing tests pass (with their fixtures updated to pass real actors).
- `npm run build` passes — no remaining `actorRole?:` markers; no remaining `actorContext: ActorContext = {}` defaults.
- `npm run lint` passes.
- Manual: attempt to call `recordPayment` from a server action invoked as a `PHOTOGRAPHER` user → server returns 403 (existing wrapper) AND the service throws if the wrapper is bypassed.
- Grep audit: `grep -rn "actorContext = {}" src` returns zero results.
- Grep audit: `grep -rn "actorRole?" src/lib/auth` returns zero results.

---

## Post-Implementation

- Update `context/reviews/77-post-verification-hardening-roadmap.md`: mark S1, S2 as completed.
- Update `progress-tracker.md`.
