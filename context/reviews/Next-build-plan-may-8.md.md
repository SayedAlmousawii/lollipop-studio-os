# Studio OS - Suggested Next Build Phases & Feature Roadmap
Date: 2026-05-08
Revised: 2026-05-09

---

# Purpose

This document defines the recommended next development phases for Studio OS after Feature 49.

The system is no longer in an early CRUD/scaffold stage. The core workflow architecture exists, and the next goal should be a complete, usable internal studio system before investing heavily in rare accounting edge cases.

The guiding principle for the next build sequence is:

> Complete working software beats perfect edge-case machinery.

The roadmap should now prioritize:

- auth and staff identity
- role/permission enforcement
- audit actor accountability
- workflow integrity
- core operational completeness
- cleanup of transitional compatibility architecture
- reporting and commission foundations
- later financial edge cases only when the business model is clear

This roadmap is intended as a planning reference for future feature specs and implementation order.

---

# Current Architectural State

The current system already includes:

- canonical Job ownership
- immutable shared jobNumber
- downstream jobId relations
- booking -> order -> invoice -> payment workflow
- structured OrderAddOn rows
- extracted EditingJob and ProductionJob
- workflow activity tracking
- invoice locking
- manual adjustment invoice creation
- operational order hub tabs
- customer profile hub
- delivery completion safeguards
- workflow sub-status architecture

The remaining work is now primarily:

1. auth, staff identity, permissions, and audit accountability
2. workflow hardening and core operational completeness
3. cleanup of transitional compatibility architecture
4. reporting and commission systems
5. later financial edge-case automation

---

# Important Reclassification

The previous roadmap placed automatic locked-invoice adjustment detection, refund architecture, and credit-note architecture at the front of the queue.

That is no longer recommended.

Manual adjustment invoice creation already provides an operational escape hatch when a locked invoice needs a later change. Automatic detection of new billable deliverables after lock is useful, but it is workflow polish rather than a foundation requirement.

Refunds, negative adjustments, credit notes, and customer credit ledgers should be delayed until the business has a clear accounting policy for those scenarios.

## Preserve These Foundations

Automatic adjustment detection can safely wait as long as these foundations remain true:

- invoices can be locked
- adjustment invoices can exist manually
- adjustment invoices are linked to the original invoice/job/order
- deliverable add-ons are stored as structured rows, not only JSON
- payments stay attached to the correct invoice
- invoice recalculation logic is centralized in the invoice service
- financial actions are audit logged or designed to be audit-loggable

Future automatic adjustment behavior can then be added by routing locked-invoice deliverable/add-on changes through the existing adjustment invoice creation service.

---

# Phase 1 - Auth, Identity, Permissions, And Audit Foundation ✅ Complete

Features 50, 51, 51b, 51c are fully implemented. Clerk owns auth/session; Prisma `User` owns role and staff identity. Dashboard routes are gated via `proxy.ts`. Permission checks are centralized in `src/lib/permissions`. High-risk actions pass `actorUserId` into service-layer operations. `User.active` soft-delete is live; inactive users are redirected to `/unauthorized`. One open deferral: `actorUserId` is still optional on some audit-critical service signatures (tracked in auth-review.md Gap #8).

---

# Phase 2 - Workflow Guard Hardening

## Goal

Prevent invalid operational transitions and make workflow behavior predictable.

This phase should focus on practical guardrails that protect day-to-day operations.

---

## Feature 52 - Workflow Guard Review

### Summary
Audit all workflow transitions and identify missing service-layer enforcement.

### Purpose
Make sure the system prevents obviously invalid state changes before adding more reporting or commission logic.

### Examples
- cannot complete delivery before production completion
- cannot bypass required payment steps
- cannot reopen finalized workflow incorrectly
- cannot create duplicate workflow records
- cannot perform sensitive workflow changes without permission

### Important Note
This should start as a review/inventory if the scope is large. Implement guard fixes as small follow-up units.

---

## Feature 53 - Workflow Guard Enforcement

### Summary
Implement the highest-value missing guards found in the review.

### Purpose
Keep the app operationally trustworthy without trying to solve every rare edge case at once.

### Core Rules
- business rules live in service modules
- multi-step workflow/financial changes use transactions
- errors surface clearly to the UI
- manual overrides require actor identity and reason where applicable

---

# Phase 3 - Core Operational Completeness

## Goal

Make the main studio workflows usable end-to-end before deep cleanup or rare financial automation.

This phase should prioritize what staff actually needs every day.

---

## Feature 54 - Operational Page Completion Review

### Summary
Review the main app areas and identify remaining gaps that stop the software from feeling complete.

### Areas To Check
- bookings
- orders
- invoices
- payments
- editing
- production
- delivery
- customer profile hub

### Purpose
Create small feature specs for missing high-value operational pieces instead of drifting into edge-case accounting work too early.

---

## Feature 55 - UX And Workflow Polish Pass

### Summary
Resolve practical usability issues that slow down staff.

### Current Known Items
- selection count initialization bug
- estimated editing date default
- financial summary clarity
- invoice context visibility
- payment workflow messaging
- deliverables visibility across order workflow
- editing queue visibility
- production queue visibility

### Purpose
Improve day-to-day confidence and speed.

---

# Phase 4 - Transitional Architecture Cleanup

## Goal

Reduce long-term technical debt and remove compatibility architecture that is no longer needed.

The system has transitioned to canonical Job ownership and jobNumber workflow identity. Remaining cleanup should simplify future development and reduce AI-agent confusion.

---

## Feature 56 - Transitional Field Cleanup Review

### Summary
Create a safe removal plan for deprecated or compatibility-only fields.

### Fields To Review
- Booking.publicId
- Order.publicId
- Invoice.publicId
- deprecated Order.addOns JSON
- legacy Order.deliveryCompletedBy
- duplicated propagated jobNumber fields

### Purpose
Determine:
- what should stay
- what should be removed later
- what is still required for migration compatibility
- what should never appear in UI again

---

## Feature 57 - Remove Deprecated Compatibility Paths

### Summary
Remove deprecated read/write paths after transition safety is confirmed.

### Examples
- remove JSON add-on writes completely
- remove legacy delivery-completed fallback when no longer needed
- remove old public-id generation if fully retired
- simplify invoice/order lookup logic

### Purpose
Reduce architectural noise and make future development safer.

---

## Feature 58 - Route And Identifier Cleanup

### Summary
Review remaining route and lookup behavior that still depends on internal IDs.

### Possible Directions
- continue using cuid routes internally
- optionally move staff operational routing toward jobNumber
- reduce staff exposure to raw database IDs

### Important Note
This is mainly a UX/architecture consistency review, not a required migration.

---

# Phase 5 - Financial History, Reporting, And Commission Foundation

## Goal

Build stable financial history and operational reporting on top of trustworthy workflow data.

This phase should begin after auth, audit actors, workflow guards, and core operational workflows are stable.

---

## Feature 59 - UpgradeRecord Foundation

### Summary
Create explicit upgrade-event history records.

### Purpose
Currently, upgrades are derived indirectly from original vs final package comparison.

### Benefits
- better auditability
- upgrade history tracking
- commission calculation support
- future reporting support

---

## Feature 60 - Commission Foundation

### Summary
Implement photographer commission tracking tied to upgrade activity.

### Purpose
Support commission calculations based on:
- upgrade value
- assigned photographer
- workflow completion
- payment state

### Important Note
Commission logic should depend on finalized and trustworthy financial/workflow data.

---

## Feature 61 - Basic Reporting Dashboard

### Summary
Create operational and financial reporting views.

### Suggested Reports
- daily revenue
- unpaid invoices
- completed sessions
- editing queue
- production queue
- photographer performance
- upgrade totals
- delivery completion metrics

### Purpose
Transform workflow data into operational visibility.

---

# Phase 6 - Later Financial Edge Cases

## Goal

Add rare accounting automation only after the normal operating system is complete and the business model is clear.

This phase should not block core app completion.

---

## Feature 62 - Locked Invoice Adjustment Automation

### Summary
Automatically create adjustment invoices when financial changes occur against locked invoices.

### Purpose
Manual adjustment invoices already cover the operational need. Automation can be added later when the pattern becomes common enough to justify it.

### Future Behavior
- unlocked invoice -> recalculate existing invoice
- locked invoice -> create linked adjustment invoice
- original invoice remains immutable
- payments remain untouched
- adjustment invoice inherits workflow context

---

## Feature 63 - Refund And Credit-Note Architecture

### Summary
Design the official refund, negative-adjustment, and customer-credit strategy.

### Purpose
The business needs to decide how refunds and credits should work before the software encodes them.

### Decisions Needed Later
- refund model vs signed payments
- negative adjustment invoice structure
- customer credit ledger strategy
- credit-note workflow
- future store-credit rules

### Important Note
Do not implement this until the business policy is clear.

---

## Feature 64 - Delivery-Time Invoice Closure

### Summary
Automatically close or lock invoices when an order is completed/delivered.

### Purpose
Delivered jobs may eventually finalize financial records and prevent accidental retroactive modification.

### Important Note
This should wait until the studio is confident that delivery should be a hard financial finalization point. Until then, manual invoice locking plus manual adjustment invoices are sufficient.

---

# Phase 7 - Production Hardening And Staff Management

## Goal

Prepare the system for real multi-user production use. This phase adds the staff management infrastructure that was not needed during development but becomes essential before handing the system to a full team.

This phase should begin after the core operating system is complete and stable.

---

## Feature 65 - Staff Deactivation UI

### Summary
Add an admin interface for deactivating and reactivating staff accounts.

### Purpose
Feature 51c adds the schema foundation. This feature surfaces it — admins can deactivate a departed staff member from within the app without going to Prisma Studio or the Clerk dashboard.

### Core Rules
- deactivation removes app access immediately (active check in `requireCurrentAppUser()`)
- deactivated users remain in the database with all historical records intact
- reactivation restores access without needing to re-link Clerk

---

## Feature 66 - Admin Invite And User Management UI

### Summary
Add an admin page where staff accounts can be created via invitation and assigned a role.

### Purpose
Currently adding a staff member requires manually creating a Clerk user and a Prisma `User` record separately and hoping the emails match for auto-link. This replaces that process with a single admin action.

### Intended Flow
- admin enters name, email, and role
- system sends a Clerk invitation email (user sets their own password via the link)
- system creates the Prisma `User` record with `clerkId` already set at invite time
- on first sign-in the user is fully linked with no auto-link dance needed

### Core Rules
- use Clerk's invitation API, not `createUser` — staff should set their own credentials
- Prisma `User` record is created at invite time, not on first sign-in
- role is assigned at creation, editable by admin later
- do not allow self-registration — invite-only is intentional for an internal tool

---

## Feature 67 - Clerk Webhook Sync

### Summary
Handle Clerk lifecycle events (`user.deleted`, `user.updated`) to keep the Prisma `User` table in sync with the Clerk directory.

### Purpose
If a staff member's Clerk account is deleted directly from the Clerk dashboard (outside the admin UI), the Prisma record remains active and could appear in assignment lists or audit queries. Webhooks close this gap.

### Core Rules
- use the `svix` package to verify webhook signatures before processing
- `user.deleted` → deactivate the matching Prisma `User` (`active = false`)
- `user.updated` → sync email changes if the email field changes in Clerk
- do not hard-delete Prisma records from webhook events — deactivate only
- webhook endpoint: `app/api/webhooks/clerk/route.ts`

---

# Recommended Priority Order

## Highest Priority
1. Auth and staff identity
2. Permission and audit actor foundation
3. Workflow guard review and enforcement
4. Core operational completeness

## Medium Priority
5. UX/workflow polish
6. Transitional cleanup review
7. Deprecated compatibility cleanup
8. Upgrade history foundation

## Lower Priority
9. Commission foundation
10. Reporting dashboards
11. Route/identifier cleanup where it improves UX

## Later / Not Urgent
12. Automatic locked-invoice adjustment detection
13. Refund and credit-note architecture
14. Customer credit ledger
15. Advanced negative adjustment logic
16. Delivery-time automatic invoice closure
17. Staff deactivation UI
18. Admin invite and user management UI
19. Clerk webhook sync

---

# Final Recommendation

The software is now entering the transition from:

> "feature building"

to:

> "complete internal operating system."

The current architecture already has the correct backbone:

- canonical workflow ownership
- immutable workflow identifiers
- structured operational records
- service-layer business logic
- extracted workflow entities
- invoice/payment separation
- manual adjustment invoice escape hatch
- operational workflow tracking

The next phase should prioritize:

1. auth and staff identity
2. permission and audit accountability
3. workflow integrity
4. completing everyday operational flows
5. cleanup of transitional architecture
6. reporting and commission foundation

Rare accounting edge cases should be postponed until they are either common in the business or the business has a clear policy for them.
