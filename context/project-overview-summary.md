# Project Overview Summary

## 1. Purpose
What Studio OS is, its end-to-end workflow, V1 feature scope, and what is out of scope.

---

## 2. Key Rules / Principles

**What it is:** Internal web-based system to manage the full lifecycle of a photography studio — from booking to delivery — replacing WhatsApp, Google Calendar, and manual tracking.

**Core user flow (phase → key status):**

| Phase | Key Actions | Status Transition |
|---|---|---|
| Booking | Customer selects package + date; deposit paid | PENDING → CONFIRMED |
| Session | Customer arrives; session conducted | — |
| Post-session | Base package payment made; photos uploaded | → WAITING_SELECTION |
| Selection | Customer selects photos; system evaluates vs package | — |
| Payment adj. | Keep package (pay add-ons) OR upgrade package (pay diff) | — |
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
- Invoice & payment system (deposit → base → upgrade/add-ons)
- Photo selection (track count vs package limit, suggest upgrade vs add-on)
- Editing workflow (assign, status, revision loop)
- Production tracking (print jobs + album jobs)
- Commission system (upgrade tracking, photographer calc, paid/pending)
- Basic reports (daily/monthly revenue, upgrade revenue, commissions, pending jobs)

**System principles:**
- State-driven workflow — no manual guessing of where a session stands
- Packages are templates; orders store snapshots (not live references)
- Orders are dynamic — they evolve after photo selection
- Payments are multi-stage (deposit → base → upgrade/add-on)
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
