# Studio OS — Project Overview

What Studio OS is, who uses it, the end-to-end workflow, and what is in / out of V1 scope.

This is a **main doc** (always loaded by default). Older `project-overview-summary.md` content has been merged here; the summary is archived in `context/_archive/summaries/`.

For architecture, see `context/architecture-context.md`. For implementation rules, see `context/code-standards.md`.

---

## 1. What It Is

Internal web-based operations system for a photography studio. Manages the full session lifecycle — bookings, packages, payments, photo selection, editing, production, delivery — replacing fragmented tools (WhatsApp, Google Calendar, manual tracking) with one state-driven system.

The database is the source of truth. Integrations (Synology, Google Calendar, WhatsApp) are optional and never authoritative.

---

## 2. Goals

1. Centralize all studio operations.
2. Track every session from booking → delivery.
3. Handle dynamic pricing (packages, upgrades, add-ons, session configurations).
4. Coordinate staff across departments.
5. Track revenue, payments, refunds, and commissions clearly.
6. Reduce manual errors and missed steps.
7. Provide real-time visibility into all jobs and statuses.

---

## 3. Primary Users

- **Receptionist** — bookings, reminders, customer handling.
- **Reservation Employee** — calendar, scheduling.
- **Photographer** — assigned sessions (view-only, no financial access).
- **Editor** — assigned editing jobs and revisions.
- **Manager** — full control, assignments, approvals, overrides.
- **Accountant** (optional) — invoices, payments, reports.

---

## 4. Core User Flow

| Phase | Key Actions | Status Transition |
|---|---|---|
| Pending Booking | Customer picks date + package; calendar hold only; no references consumed | `PENDING` (hard-deleted on cancel) |
| Confirmation | Deposit recorded → atomic: generate BK reference + create **FinancialCase** + issue locked Deposit Invoice + record deposit payment | `PENDING → CONFIRMED` |
| Check-In | Customer arrives → atomic: generate JOB reference + create Job + create initial Order + stamp `FinancialCase.jobId`; payment-free | `CONFIRMED → CHECKED_IN` |
| Post-Session | Photos uploaded to Synology; selection begins | `→ WAITING_SELECTION` |
| Selection / POS | Customer selects photos; Final Invoice created at POS; package upgrades and add-ons finalized | — |
| Payment Settlement | Customer pays Final Invoice remaining balance via `PaymentType.FINAL` (or upgrade via `PaymentType.UPGRADE`). Editing cannot start until remaining balance = 0 | — |
| Editing | Assigned editor → revisions loop → customer approval | `→ EDITING → APPROVED` |
| Production | In-house prints + vendor albums | `→ PRODUCTION → READY` |
| Delivery | Customer notified; pickup recorded | `→ DELIVERED` |

The FinancialCase is the financial grouping boundary that bridges Booking → Job. All Invoices and Payments belong to a FinancialCase; this is what makes mixed deposit / final / adjustment / credit-note / refund accounting coherent.

---

## 5. V1 Features (In Scope)

- **Customer management** — parent (phone-based) + children + session history.
- **Bookings** — calendar, deposit, session type, themes, atomic confirmation.
- **Packages** — predefined templates, upgrade-replacement, deliverables.
- **Session Configurations** — per-session-type operational and financial modifiers attached to order packages.
- **Invoices & Payments** — Deposit Invoice (locked at confirmation) → Final Invoice (created at POS) → upgrade / add-on / adjustment / credit-note / refund documents, all scoped to a FinancialCase.
- **Photo selection** — track count vs package limit, suggest upgrade vs add-on.
- **Editing** — assignment, status, revision loop.
- **Production** — print jobs (in-house) + album jobs (vendor).
- **Commissions** — track upgrades, calculate photographer commissions, paid/pending status.
- **Adjustment Workspace** — post-lock staged edits with manager approval, finalizing as ADJ / CN invoices.
- **Reports** — daily/monthly revenue, upgrade revenue, commissions, pending jobs.

---

## 6. System Principles

- State-driven workflow — no manual guessing.
- Packages are templates; orders store snapshots and never change retroactively when templates are edited.
- Orders are dynamic — they evolve after selection.
- Payments are multi-stage: `DEPOSIT` → `FINAL` (remaining balance) → `UPGRADE` / `ADJUSTMENT` / `REFUND`. `PaymentType.BASE` is retired.
- Locked invoices are content-immutable below the service layer; further changes flow through Adjustment / Credit Note / Refund invoices.
- Each department updates only its own status.
- All actions are traceable (who + when) via `AuditLog`.

---

## 7. Out of Scope (V1)

- Customer mobile app
- Online booking portal
- WhatsApp / reminder automation
- Synology auto-integration
- Inventory management
- Advanced analytics dashboards

---

## 8. Success Criteria

- Staff can manage full lifecycle without external tools.
- All bookings, payments, jobs tracked in one place.
- Upgrades and add-ons priced automatically.
- No workflow step is missed.
- Managers see real-time status of all sessions.
- Reports accurately reflect business performance.
