# Project Overview Summary

## 1. Purpose
What Studio OS is, its end-to-end workflow, V1 feature scope, and what is out of scope.

---

## 2. Key Rules / Principles

**What it is:** Internal web-based system to manage the full lifecycle of a photography studio — from booking to delivery — replacing WhatsApp, Google Calendar, and manual tracking.

**Core user flow (phase → key status):**

| Phase | Key Actions | Status Transition |
|---|---|---|
| Pending Booking | Customer selects package + date; calendar hold only; no references consumed | PENDING (hard-deleted on cancel) |
| Confirmation | Deposit paid → BK reference generated + FinancialCase created + Deposit Invoice issued atomically | PENDING → CONFIRMED |
| Check-In | Customer arrives → JOB reference generated + Job/Order created + FinancialCase stamped | CONFIRMED → CHECKED_IN |
| Post-session | Photos uploaded; selection begins | → WAITING_SELECTION |
| Selection / POS | Customer selects photos; Final Invoice created; upgrade or add-ons finalized | — |
| Payment adj. | Pay remaining balance (FINAL payment type) OR upgrade package (UPGRADE payment type) | — |
| Editing | Assigned to editor; revisions loop; customer approves | → EDITING → APPROVED |
| Production | Prints in-house; albums via vendor | → PRODUCTION → READY |
| Delivery | Customer notified; pickup completed | → DELIVERED |

**Primary users:**
- Receptionist — bookings, reminders, customer handling
- Reservation Employee — scheduling, coordination
- Photographer — session execution (view-only)
- Editor — editing workflow and revisions
- Manager — full control, assignments, approvals
- Accountant (optional) — financial tracking and reports

---

## 3. Required Patterns / Constraints

**V1 features in scope:**
- Customer management (parent + children + session history)
- Booking system (calendar, deposit, session type, themes)
- Package system (predefined packages, upgrade/replacement, deliverables)
- Invoice & payment system (deposit invoice at confirmation → final invoice at POS → upgrade/add-on payments)
- Photo selection (track count vs package limit, suggest upgrade vs add-on)
- Editing workflow (assign, status, revision loop)
- Production tracking (print jobs + album jobs)
- Commission system (upgrade tracking, photographer calc, paid/pending)
- Basic reports (daily/monthly revenue, upgrade revenue, commissions, pending jobs)

**System principles:**
- State-driven workflow — no manual guessing of where a session stands
- Packages are templates; orders store snapshots (not live references)
- Orders are dynamic — they evolve after photo selection
- Payments are multi-stage (deposit → final balance → upgrade/add-on); `BASE` payment type is retired, replaced by `FINAL`
- Each department updates only its own status
- All actions must be traceable (who + when)

---

## 4. What to Avoid

- Do not build anything outside V1 scope without explicit instruction

**Out of scope for V1:**
- Customer mobile app
- Online booking portal
- WhatsApp/reminder automation
- Synology auto-integration
- Inventory management
- Advanced analytics dashboards

---

## 5. When to Read Full Document

Read `project-overview.md` when:
- Unsure whether a feature is in or out of V1 scope
- Needing exact workflow step order for a specific phase
- Explaining the system to a new context or stakeholder

---

## Recommended Usage
**Read when scope is in question.** Optional for routine implementation tasks where scope is already clear.
