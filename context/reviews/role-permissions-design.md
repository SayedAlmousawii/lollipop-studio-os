# Role Permissions Design

**Date:** 2026-05-09
**Purpose:** Canonical record of permission design intent — who can do what and why.
This document records rationale and decisions. The code is the source of truth for what is currently implemented.
**Code reference:** `src/lib/permissions/index.ts`

---

## Design Principles

**1. Permissions describe operations, not roles.**
A permission key like `payment:create` says what capability is being granted. Role assignments then map roles to capabilities. This keeps the permission check in the code readable and the role map easy to audit.

**2. Roles own their workflow area — nothing more.**
Architecture invariant: *"Staff members can only update the workflow area they are responsible for unless they are manager/admin."* Permissions enforce this. A receptionist does not touch editing. An editor does not touch invoices.

**3. Every financial change must be attributable.**
Payments, invoice mutations, package changes, commission changes, and financial overrides all require an `actorUserId`. Permission checks produce this actor — there is no financial write path that bypasses auth.

**4. Fail closed.**
An unrecognized role, an unlinked Clerk user, or a missing permission always results in denial — never a default grant.

**5. Implicit invoice creation — resolved by explicit grant.**
The deposit and base-payment flows create an invoice internally as a side effect. `RECEPTIONIST` now holds `invoice:create` explicitly, resolving the permission boundary leak. The longer-term solution — operation-scoped keys like `booking:deposit-record` that honestly name the full scope of what each flow does — remains a future note (see Future Implementation Notes below).

---

## Roles: Intent & Access Rationale

### Admin
**Who:** System owner or technical administrator.
**Intent:** Unrestricted access to every operation in the system.
**Restricted from:** Nothing.
**Rationale:** Admin is the break-glass role. All permissions are granted.

---

### Manager
**Who:** Operations manager responsible for the full studio workflow.
**Intent:** Full operational control — assignments, approvals, financial decisions, overrides, commission management, and reports.
**Restricted from:** Nothing operationally significant.
**Rationale:** Manager is the day-to-day authority role. The distinction from Admin is organizational, not functional — in V1 they hold the same permissions.

---

### Receptionist
**Who:** Front desk staff handling customer intake, bookings, and delivery handoff.
**Intent:** Can create and manage bookings, record customer payments (deposits and base payments), and handle the physical delivery workflow. Cannot make structural financial decisions (issuing invoices, closing invoices, package overrides).
**Restricted from:** Invoice issuance, invoice closure, adjustment invoices, order financial edits, commission management, editing workflow.
**Rationale:** Receptionist's job ends at the front desk. They collect money and hand off the order — they do not own the financial lifecycle or the post-production workflow. `invoice:create` is now explicitly granted because the deposit and base-payment flows internally create invoices as a side effect.

---

### Reservation
**Who:** Scheduling and coordination staff.
**Intent:** Manages the booking calendar, confirms availability, assigns photographers to sessions.
**Restricted from:** All financial operations, editing, delivery. Temporarily holds `workflow:production-update` (see note below).
**Rationale:** Reservation's job is scheduling only. They have no financial or workflow responsibility beyond getting the right photographer to the right session.

---

### Photographer
**Who:** Session photographer.
**Intent:** Executes the shoot. In the system, they are primarily a data subject (assigned to sessions, linked to commissions) rather than a data actor. Their workflow-update permissions are still being defined.
**Restricted from:** All financial operations, invoice management, editing, commission management. Temporarily holds `workflow:production-update` (see note below).
**Rationale:** Photographers do not own any system workflow in V1 — their access is limited to their assigned session context.
**Open decision:** Whether photographers need any write access (e.g. marking a session complete, adding notes) is not yet decided. Defer until photographer-specific views are built.

---

### Editor
**Who:** Photo editing staff.
**Intent:** Drives the editing workflow — assigns themselves or is assigned to a job, updates edit status, manages the revision loop through to customer approval.
**Restricted from:** All financial operations, booking management, commission management, delivery. Temporarily holds `workflow:production-update` (see note below).
**Rationale:** Editors own editing. They do not touch money or delivery. Production access is a temporary broad grant pending ownership definition.

---

### Accountant
**Who:** Financial staff responsible for invoices, payment verification, and reports.
**Intent:** Manages the full financial lifecycle — creates invoices, issues them, closes them, records payments, creates adjustment invoices, updates commissions.
**Restricted from:** Booking status changes, editing workflow, production workflow, delivery operations.
**Rationale:** Accountant owns the financial layer but has no operational workflow responsibility. They see and manage money; they do not run the studio floor.

---

## Permission Keys

Each key describes the operation it guards. Granularity is at the action level, not the resource level.

| Key | Guards |
|-----|--------|
| `booking:status-update` | Moving a booking through its status states (confirm, cancel, etc.) |
| `payment:create` | Recording any payment against a booking or invoice |
| `invoice:create` | Creating a standalone invoice for an order |
| `invoice:issue` | Issuing a draft invoice to make it active |
| `invoice:close` | Locking or closing a final invoice |
| `invoice:adjustment-create` | Creating an adjustment invoice against a parent invoice |
| `order:financial-update` | Editing package, photo count, or add-ons when it affects invoice math |
| `delivery:update` | Preparing for pickup, recording customer notification, marking picked up |
| `delivery:complete` | Completing an order and marking it delivered |
| `delivery:payment-override` | Completing delivery when payment is not fully settled (override) |
| `workflow:editing-update` | Assigning an editor, updating edit status, managing revision loop |
| `workflow:production-update` | Updating print job status, album status, vendor tracking |
| `photographer:assign` | Assigning a photographer to a booking or session |
| `commission:update` | Recording or modifying a photographer commission |

---

## Role → Permission Map

This is the **intended design**. Verify current implementation in `src/lib/permissions/index.ts`.

| Permission | ADMIN | MANAGER | RECEPTIONIST | RESERVATION | PHOTOGRAPHER | EDITOR | ACCOUNTANT |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `booking:status-update` | ✓ | ✓ | ✓ | ✓ | | | |
| `payment:create` | ✓ | ✓ | ✓ | | | | ✓ |
| `invoice:create` | ✓ | ✓ | ✓ | | | | ✓ |
| `invoice:issue` | ✓ | ✓ | | | | | ✓ |
| `invoice:close` | ✓ | ✓ | | | | | ✓ |
| `invoice:adjustment-create` | ✓ | ✓ | | | | | ✓ |
| `order:financial-update` | ✓ | ✓ | | | | | |
| `delivery:update` | ✓ | ✓ | ✓ | | | | |
| `delivery:complete` | ✓ | ✓ | ✓ | | | | |
| `delivery:payment-override` | ✓ | ✓ | | | | | |
| `workflow:editing-update` | ✓ | ✓ | | | | ✓ | |
| `workflow:production-update` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `photographer:assign` | ✓ | ✓ | | ✓ | | | |
| `commission:update` | ✓ | ✓ | | | | | ✓ |

> `workflow:production-update` is granted broadly (all roles except accountant) as a temporary stance while production workflow ownership is still undefined. This should be narrowed once a responsible role is identified.

---

## Deferred & Open Decisions

**Photographer write access**
Whether photographers need any write permissions (session notes, status markers) is not yet decided. Defer until photographer-specific views are scoped.

**Photographer commission visibility**
Whether photographers should have read-only access to their own commission totals is not yet decided. This would be a view-level permission, not an action permission.

**Page-level and navigation-level RBAC**
Sidebar filtering, page-level information hiding, and assigned-only views (photographer sees only their sessions, editor sees only their jobs) are explicitly deferred until the permission foundation is stable.

**Dev role override switcher**
A `NODE_ENV === "development"` role switcher flowing through the same permission helper. Useful once role testing becomes repetitive. Must not be UI-only — it must override at the helper level to be meaningful.

**Clerk webhook sync**
Handles deletion and external changes made directly in the Clerk dashboard. When a staff member is removed from Clerk, a `user.deleted` webhook fires and the system should set `User.active = false` on the matching Prisma record. Also covers `user.updated` for email changes. Not needed until admin user management is built, but required before production to avoid stale records for departed staff. The soft-delete schema foundation (`User.active`) is now in place.

**Admin user management UI**
An admin page to invite and manage staff accounts. The flow: admin enters name, email, and role → system sends a Clerk invitation (not a created password — the user sets their own via email link) → on first sign-in the Prisma `User` record is already created with `clerkId` set. This replaces the current manual two-system setup (Clerk dashboard + Prisma Studio). Not currently scheduled in the build plan — belongs in a late phase after core operations are stable.

**Soft-delete on `User` records** — schema foundation done
`User.active Boolean @default(true)` is in the schema and migrated. Deactivated staff are blocked at `requireCurrentAppUser()` with a redirect to `/unauthorized`. Historical audit trail (actorUserId on payments, invoices, workflow changes) is preserved. Admin UI for deactivating/reactivating users is deferred to Feature 65.

---

## Future Implementation Notes

**Operation-scoped permission keys**
The current permission model is resource-scoped (`payment:create`, `invoice:create`). A cleaner long-term design is operation-scoped keys where each permission is named after the user-facing operation it covers rather than the resource it touches.

Example: `booking:deposit-record` replaces `payment:create` for the receptionist deposit flow. The permission name honestly describes the full scope of what the operation does — including any internal side effects like invoice creation — without implicit grants or documentation notes to explain the gap.

How it resolves the current debt: receptionist holds `booking:deposit-record`. The deposit service creates an invoice internally with no separate permission check. No conflict, no asterisk, no note needed. `invoice:create` continues to exist as a standalone permission for the accountant's explicit invoice creation action — a different operation, a different actor, a different intent.

The rule: one permission key per distinct user-facing operation. If two roles do fundamentally different things that happen to touch the same resource, they get different keys.

**When to do this:** not as standalone refactoring. Introduce operation-scoped keys naturally when adding new permissions — at that point rename the affected existing keys as part of the same unit of work rather than touching working code for purity alone.
