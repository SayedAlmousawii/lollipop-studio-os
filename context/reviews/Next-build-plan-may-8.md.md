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

# Phase 1 - Auth, Identity, Permissions, And Audit Foundation

## Goal

Add real staff identity and authorization before continuing deeper workflow and financial hardening.

This phase should make the app safe for internal use without making development testing painful.

---

## Feature 50 - Auth And Staff Identity Foundation

### Summary
Add Clerk authentication and connect authenticated Clerk users to existing Studio OS `User` records.

### Purpose
All operational and financial actions need a real actor. The app already has user roles, but currently lacks real authentication.

### Core Rules
- all dashboard routes require sign-in
- sign-in remains the only public app route
- Clerk owns identity/session
- Prisma `User` owns app role and staff assignment identity
- authenticated user lookup is centralized in a server-only DAL/helper
- use the Next.js 16 `proxy.ts` convention, not deprecated `middleware.ts`

### Dev Testing Requirement
Auth should not make local development annoying.

Recommended dev approach:
- one local Clerk account linked to an `ADMIN` Prisma user
- seeded local users for all roles remain available
- optional dev-only role override/switcher may be added later for testing permissions without signing in/out repeatedly

---

## Feature 51 - Permission And Audit Actor Foundation

### Summary
Create the basic role/permission enforcement pattern and make sensitive actions capable of receiving a real app `userId`.

### Purpose
Workflow guards, financial changes, delivery completion, manual overrides, and future commissions all depend on knowing who performed the action.

### Core Rules
- use a shared permission helper rather than ad hoc role checks
- server actions/API routes validate auth before calling services
- services receive or resolve the current app user for sensitive operations
- financial/workflow actions should be audit-loggable with a stable `userId`
- do not attempt perfect RBAC coverage in one unit; start with sensitive actions first
- keep navigation and permission decisions centralized enough that role-specific page/info visibility can be added later without a major refactor

### Deferred Role-Specific UX
Different roles will eventually see different pages, navigation items, data, and action controls.

That full role-specific experience is intentionally deferred. This phase should only build the foundation needed to support it later.

Future examples:
- accountants see financial pages and reports
- editors see editing queues and assigned editing work
- photographers see assigned sessions/jobs
- receptionists see customers, bookings, and basic order workflow
- managers/admins see broader operations and overrides

### Sensitive Actions To Prioritize
- payments
- invoice locking/unlocking/manual adjustment creation
- package/final package changes
- deliverable/add-on changes that affect money
- delivery completion
- manual workflow overrides
- commission changes later

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
