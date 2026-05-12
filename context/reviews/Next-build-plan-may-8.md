# Studio OS - Suggested Next Build Phases & Feature Roadmap
Date: 2026-05-08
Revised: 2026-05-12 — Phases 3–4 marked complete; Phase 5 replaced with Lifecycle Architecture Revision (Features 59–63); old Phase 5 specs renumbered to Phase 6 (Features 64–66); subsequent phases renumbered accordingly.

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
- lifecycle architecture revision (booking → confirmation → check-in separation)
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
- Clerk auth + Prisma staff identity + role-based permissions
- product catalog + structured package deliverables
- POS commercial workspace (route, package composition, marketplace, payment dialog, financial sidebar)
- dashboard phone lookup with suggestion dropdown
- **FinancialCase model** — financial grouping entity replacing Job as financial hub
- **Lifecycle schema foundation** — nullable lifecycle references, InvoiceType enum, CHECKED_IN status, FINAL payment type, identifier sequence kind discriminator, order package price snapshots

The remaining work is now:

1. lifecycle confirmation and check-in flows (Phase 5 — in progress)
2. financial reporting and commission systems (Phase 6)
3. later financial edge-case automation (Phase 7)
4. production hardening and staff management (Phase 8)

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

# Phase 2 - Workflow Guard Hardening ✅ Complete

## Goal

Prevent invalid operational transitions and make workflow behavior predictable.

This phase should focus on practical guardrails that protect day-to-day operations.

---

## Guard Review ✅ Complete (review step — not a numbered feature spec)

Audit completed 2026-05-10. Full inventory and gap analysis in `context/reviews/workflow-guard-audit.md`.

Seven gaps identified (P1–P7). Implementation units below.

---

## Feature 52 - Workflow Guard Enforcement ✅ Complete

### Summary
Implement the highest-value missing guards found in the review.

### Purpose
Keep the app operationally trustworthy without trying to solve every rare edge case at once.

### Units
- **52a** ✅ — Add `editingStatus` check to delivery completion guard
- **52b** ✅ — Per-section production state machine validation
- **52c** ✅ — `WorkflowGuardError` typed error class
- **52d** — Reusable error UI component *(style/design discussion required — still deferred)*
- **52e** ✅ — Audit-log failed guard blocks on high-risk transitions
- **52f** ✅ — Service-layer permission enforcement

> **Feature 53 deferred.** Planned guard work was scoped into 52 units or deferred pending further workflow review. Not blocking Phase 3.

### Core Rules
- business rules live in service modules
- multi-step workflow/financial changes use transactions
- errors surface clearly to the UI
- manual overrides require actor identity and reason where applicable

---

# Phase 3 - Core Operational Completeness ✅ Complete

## Goal

Make the main studio workflows usable end-to-end before deep cleanup or rare financial automation.

This phase should prioritize what staff actually needs every day.

---

## Feature 54 - Operational Page Completion Review ✅ Complete

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

## Feature 55 - UX And Workflow Polish Pass ✅ Complete

### Summary
Resolve practical usability issues that slow down staff.

### Units

- **55a** ✅ — Bug fixes: selection count init (shows 0), selection completed idempotency (upgrade reverts), two simultaneous "ready for pickup" buttons
- **55b** ✅ — UX defaults: estimated editing date defaults to today+14; booking form adds session time field
- **55c** ✅ — Deliverables visibility: overview tab gets a deliverables card; package description surfaced in selection tab
- **55d** ✅ — Full payment gate: block editing assignment until invoice balance is zero; surface outstanding amount
- **55e** ✅ — Customer phone enforcement: required field, valid format, phone-first search
- **55f** ✅ — Editing queue investigation: profile slow render, document findings, fix is a follow-up unit
- **55g** ✅ — Date picker migration: replace all `<Input type="date">` fields with the existing `DatePicker` calendar component

### Deferred (needs design/decision first)
- Financial summary clarity, invoice context visibility, payment workflow messaging — deferred to a later phase
- Calendar page overhaul — deferred, needs design pass
- Editing tab UX — deferred, needs design pass
- Delivery status simplification — deferred, needs state machine decision

### Purpose
Improve day-to-day confidence and speed.

---

# Phase 4 - Product, POS, And Transitional Cleanup ✅ Complete

## Goal

Reduce long-term technical debt, remove compatibility architecture that is no longer needed, and build the POS commercial workspace.

---

## Feature 56 - Product Catalog + Package Management ✅ Complete

### What Was Built
Unified product catalog (`Product` / `ProductCategory`), structured `PackageItem` deliverables with price snapshots, `bundleAdjustment` on Package, package management UI at `/packages` with dedicated create/edit pages, safe archive/delete, and invoice line item snapshots at delivery/close.

### Original Intent (from plan)
Transitional field cleanup review — determine which deprecated fields to remove. The actual implementation went further and replaced the package system entirely, making the field cleanup question moot for most items reviewed.

---

## Feature 57 - POS Commercial Workspace ✅ Complete

### What Was Built
Standalone `/orders/[orderId]/sales` route, package composition area, add-on marketplace, embedded payment dialog, POS financial sidebar with line item snapshots, and dashboard phone lookup with suggestion dropdown (57a–57g).

### Original Intent (from plan)
Remove deprecated compatibility paths. The POS workspace was prioritised instead; deprecated path removal was absorbed where safe to do.

---

## Feature 58 - Route And Identifier Cleanup ⚠️ Superseded

### Original Summary
Review remaining route and lookup behavior that still depends on internal IDs.

### Status
**This spec was superseded by the Lifecycle Architecture Revision.** The identifier question (one `jobNumber` vs two references) was resolved differently: the architecture now uses separate `BK-` and `JOB-` references at distinct lifecycle stages, with `Booking.publicId` repurposed as the BK reference rather than retired. The route cleanup work remains valid but is lower priority — defer until after Feature 63 when the lifecycle is stable.

---

# Phase 5 - Lifecycle Architecture Revision 🔄 In Progress

## Goal

Implement the booking/confirmation/check-in separation decided in the May 2026 lifecycle review. This is a real architectural revision — not just "move job number later." It changes the state machine, ownership boundaries, and financial hub for the entire workflow.

Reference: `context/reviews/lifecycle-review.md`, `context/reviews/pos-and-invoice-design-review-may-2026.md`

---

## Feature 59 - Schema Foundation ✅ Complete

### Summary
All schema changes required before the lifecycle flows can be built.

### What Was Done
- Added `FinancialCase` model (`id`, `bookingId`, `jobOrderId?`, `customerId`, `createdAt`)
- `BookingStatus.CHECKED_IN` replaces `COMPLETED`
- `PaymentType.FINAL` replaces `BASE`
- `InvoiceType` enum added (`DEPOSIT`, `FINAL`, `ADJUSTMENT`, `REFUND`, `CREDIT_NOTE`)
- `Booking.publicId`, `Booking.jobId`, `Booking.jobNumber` → nullable
- `Invoice.financialCaseId`, `Invoice.invoiceType` added; `Invoice.jobId`, `Invoice.jobNumber` → nullable
- `Payment.financialCaseId` added; `Payment.jobId`, `Payment.jobNumber` → nullable
- `identifier_sequences` — `kind` discriminator added (BK vs JOB sequences)
- `Order.originalPackagePriceSnapshot`, `Order.finalPackagePriceSnapshot` added
- Job-scoped composite ownership constraints removed (replaced by FinancialCase)

---

## Feature 60 - Booking Confirmation Rewrite

### Summary
Rewrite the booking confirmation flow to generate the BK reference, create a FinancialCase, issue a Deposit Invoice, and record the deposit payment as one atomic step.

### Key Behavior
- Pending bookings remain reference-free calendar holds
- Confirmation: generates `BK-DEPT-YEAR-XXXXX` → stored in `Booking.publicId`, creates `FinancialCase`, creates Deposit Invoice (type `DEPOSIT`, totalAmount 20 KD, immediately PAID + CLOSED), records deposit payment (type `FINAL` is wrong here — this is type `DEPOSIT`)
- On confirmed booking cancellation: FinancialCase remains with settled Deposit Invoice; no jobOrderId

---

## Feature 61 - Check-In Rewrite

### Summary
Rewrite the check-in flow to generate the JOB reference, create the Job/Order, and stamp the FinancialCase.

### Key Behavior
- Check-in: generates `JOB-DEPT-YEAR-XXXXX`, creates Job + Order, stamps `FinancialCase.jobOrderId`
- Booking status transitions to `CHECKED_IN`

---

## Feature 62 - Deposit Invoice Display

### Summary
Surface the Deposit Invoice correctly in the UI, showing BK reference and package context (read live from booking, not stored on invoice).

---

## Feature 63 - Final Invoice / POS Integration

### Summary
Create the Final Invoice at POS/selection finalization. Show BK reference + JOB reference. Display deposit applied and remaining balance calculated from the linked Deposit Invoice.

### Multi-Package Decision (open)
One booking, two packages — one job with two orders, or two separate jobs? Confirm with owner before building this phase. Current assumption: 1:1:1 (Booking → Job → Order).

---

# Phase 6 - Financial History, Reporting, And Commission Foundation

## Goal

Build stable financial history and operational reporting on top of trustworthy workflow data.

This phase should begin after the lifecycle revision (Phase 5) is complete and the FinancialCase/invoice split is stable.

_(Previously Phase 5. Features renumbered from 59–61 → 64–66.)_

---

## Feature 64 - UpgradeRecord Foundation

_(Previously Feature 59)_

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

## Feature 65 - Commission Foundation

_(Previously Feature 60)_

### Summary
Implement photographer commission tracking tied to upgrade activity.

### Purpose
Support commission calculations based on:
- upgrade value
- assigned photographer
- workflow completion
- payment state

### Important Note
Commission logic should depend on finalized and trustworthy financial/workflow data. Commission formula uses `Order.finalPackagePriceSnapshot − Order.originalPackagePriceSnapshot` (snapshots added in Feature 59 schema).

---

## Feature 66 - Basic Reporting Dashboard

_(Previously Feature 61)_

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

# Phase 7 - Later Financial Edge Cases

## Goal

Add rare accounting automation only after the normal operating system is complete and the business model is clear.

This phase should not block core app completion.

_(Previously Phase 6. Features renumbered from 62–64 → 67–69.)_

---

## Feature 67 - Locked Invoice Adjustment Automation

_(Previously Feature 62)_

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

## Feature 68 - Refund And Credit-Note Architecture

_(Previously Feature 63)_

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

## Feature 69 - Delivery-Time Invoice Closure

_(Previously Feature 64)_

### Summary
Automatically close or lock invoices when an order is completed/delivered.

### Purpose
Delivered jobs may eventually finalize financial records and prevent accidental retroactive modification.

### Important Note
This should wait until the studio is confident that delivery should be a hard financial finalization point. Until then, manual invoice locking plus manual adjustment invoices are sufficient.

---

# Phase 8 - Production Hardening And Staff Management

## Goal

Prepare the system for real multi-user production use. This phase adds the staff management infrastructure that was not needed during development but becomes essential before handing the system to a full team.

This phase should begin after the core operating system is complete and stable.

_(Previously Phase 7. Features renumbered from 65–67 → 70–72.)_

---

## Feature 70 - Staff Deactivation UI

_(Previously Feature 65)_

### Summary
Add an admin interface for deactivating and reactivating staff accounts.

### Purpose
Feature 51c adds the schema foundation. This feature surfaces it — admins can deactivate a departed staff member from within the app without going to Prisma Studio or the Clerk dashboard.

### Core Rules
- deactivation removes app access immediately (active check in `requireCurrentAppUser()`)
- deactivated users remain in the database with all historical records intact
- reactivation restores access without needing to re-link Clerk

---

## Feature 71 - Admin Invite And User Management UI

_(Previously Feature 66)_

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

## Feature 72 - Clerk Webhook Sync

_(Previously Feature 67)_

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

## Complete ✅
1. Auth and staff identity (Phase 1)
2. Permission and audit actor foundation (Phase 1)
3. Workflow guard review and enforcement (Phase 2)
4. Core operational completeness (Phase 3)
5. UX/workflow polish (Phase 3)
6. Product catalog + package management (Phase 4)
7. POS commercial workspace (Phase 4)

## In Progress 🔄
8. Lifecycle architecture revision — schema foundation complete; confirmation, check-in, invoice display, final invoice still to build (Phase 5, Features 60–63)

## Next
9. UpgradeRecord foundation (Feature 64)
10. Commission foundation (Feature 65)
11. Reporting dashboards (Feature 66)
12. Route/identifier cleanup where it improves UX (deferred from Feature 58)

## Later / Not Urgent
13. Automatic locked-invoice adjustment detection (Feature 67)
14. Refund and credit-note architecture (Feature 68)
15. Delivery-time automatic invoice closure (Feature 69)
16. Staff deactivation UI (Feature 70)
17. Admin invite and user management UI (Feature 71)
18. Clerk webhook sync (Feature 72)

---

# Final Recommendation

The software has completed the core operational phase and is now mid-way through a significant lifecycle architecture revision (Phase 5).

The revision separates:
- tentative booking holds (no references, no invoices)
- confirmed bookings (BK reference + Deposit Invoice)
- operational jobs (JOB reference + Final Invoice)

Once Phase 5 is complete, the system will have a clean, auditable financial lifecycle and the schema will be stable enough to build reporting and commission systems on top.

The architecture already has the correct backbone:

- canonical workflow ownership
- dual workflow identifiers (BK + JOB) at the correct lifecycle stages
- FinancialCase as financial grouping hub
- Deposit Invoice / Final Invoice split
- structured operational records
- service-layer business logic
- extracted workflow entities
- invoice/payment separation
- manual adjustment invoice escape hatch
- operational workflow tracking

Rare accounting edge cases (Phases 7–8) should be postponed until they are either common in the business or the business has a clear policy for them.
