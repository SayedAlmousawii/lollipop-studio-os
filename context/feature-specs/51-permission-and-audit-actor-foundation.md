## Goal

Establish the first shared permission and actor-attribution foundation so sensitive server actions can require a linked authenticated app user, enforce role checks through one reusable helper pattern, and pass a stable `userId` into workflow-critical and financial operations.

---

## Read First

- `agents.md`
- `context/ai-workflow-summary.md`
- `context/code-standards-summary.md`
- `context/project-overview-summary.md`
- `context/architecture-summary.md`
- `context/reviews/clerk-auth-setup-plan.md`
- `context/feature-specs/28-order-activity-audit-log-foundation.md`
- `context/feature-specs/48-delivery-actor-integrity.md`
- `context/feature-specs/50-auth-and-staff-identity-foundation.md`

---

## Rules

- Keep this unit focused on permission and actor foundation only
- Build on the linked app-user pattern from Feature 50; do not create a second auth path
- Use shared permission helpers instead of ad hoc inline role checks
- Enforce auth and permission checks before sensitive service calls
- Prefer stable actor IDs over free-text actor fields where the acting user is known
- Start with the highest-risk sensitive actions first; do not try to finish perfect RBAC coverage in one unit
- Do not build role-specific navigation or page visibility rules in this unit
- Do not create a giant cross-module audit system in this unit
- Update `context/reviews/current-database-er-diagram.md` if the implemented schema shape changes

---

## Scope

### In Scope

- Create shared permission definitions/helpers
- Create a reusable server-side pattern for requiring a linked authenticated app user
- Add permission enforcement to sensitive server actions and route handlers first
- Pass or resolve stable actor `userId` values for workflow-critical and financial service operations
- Tighten existing actor writes where a real linked user is available
- Reuse existing activity/audit-capable structures where they already exist

### Out of Scope

- Complete RBAC coverage across the whole app
- Full role-specific UI visibility
- Staff management screens
- Broad historical backfill of every legacy actor string
- Commissions redesign
- Full audit-reporting UI

---

## Required Permission Direction

Permissions should be defined through one shared helper layer, for example:

```text
src/lib/permissions/
```

Requirements:

- permission checks should operate on the linked Prisma app user, not raw Clerk identity alone
- role-to-permission mapping should be centralized
- server actions and route handlers should call a shared guard/helper before sensitive work
- service-layer code may still validate invariants, but permission policy should not be duplicated across every caller

Suggested helper pattern:

```text
requirePermission(appUser, "payment:update")
hasPermission(appUser, "invoice:lock")
```

Exact permission keys may vary, but they should be explicit and consistent.

---

## Sensitive Actions To Prioritize

Start with actions that can change money, workflow truth, or irreversible operational state.

Priority targets:

- payment creation/edit/delete flows
- invoice locking, unlocking, and manual adjustment creation
- package/final package changes
- deliverable/add-on changes that affect billing
- delivery completion
- manual workflow overrides

If the current codebase does not implement one of these flows yet, skip it rather than inventing new product behavior. Apply the foundation to the sensitive flows that already exist.

---

## Actor Attribution Direction

Where a sensitive action already records actor context or can reasonably do so now:

- store the acting Prisma `User.id`
- pass actor identity through the server action -> service boundary
- use the stable user reference for order activity, delivery attribution, and other audit-capable writes where supported

Do not rely on raw display names or free-text actor strings as the active source of truth when a linked app user is available.

This unit should align with the direction established in Feature 48: real user references are preferred for workflow-critical attribution.

---

## Server Action And Service Expectations

Expected pattern:

1. resolve/require the current linked app user
2. require permission for the specific action
3. call the service with actor context
4. persist business changes and actor-aware activity/audit writes together where appropriate

Requirements:

- do not let UI components call permission logic directly as the main enforcement layer
- keep business logic in services
- keep permission failure messages clear and explicit
- use transactions for multi-step financial or workflow-sensitive operations as already required elsewhere in the project

---

## Integration Direction

This unit should make current service boundaries capable of carrying actor context cleanly.

Examples of acceptable shapes:

```text
recordPayment(input, { actorUserId })
updateOrderPackage(input, { actorUserId, reason? })
completeDelivery(input, { actorUserId })
```

Exact signatures may vary, but sensitive operations should stop depending on implicit or missing actor identity.

When an existing activity log record is already written in the same flow, use the linked app user's `id` there as well when available.

---

## Deferred UX Note

This feature is the policy foundation only.

It should not yet decide:

- which nav items disappear per role
- which dashboards are role-specific
- how photographer/editor assigned-only views are presented

The main success condition is that sensitive operations become enforceable and attributable, not that every page looks role-aware yet.

---

## Acceptance Criteria

- a shared permission helper layer exists
- role-to-permission policy is centralized rather than scattered inline
- sensitive server actions/handlers use the shared auth + permission guard pattern
- the highest-risk existing sensitive actions enforce permissions before service execution
- sensitive service flows can receive or resolve a stable actor `userId`
- existing actor-aware writes use linked app-user IDs where available
- no broad role-specific UI visibility system is introduced yet
- `context/reviews/current-database-er-diagram.md` is updated if the implemented schema changes its described structure
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- migration deploy/status checks pass if schema changes are required
- Update `context/progress-tracker.md`

---

## Assumptions

- Feature 50 has already established working Clerk auth and app-user linking
- Admin and manager roles will initially hold the broadest sensitive permissions
- Some older flows may still have partial legacy actor context, but new sensitive writes should prefer stable linked user IDs from this point forward
