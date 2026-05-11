# Studio OS — Financial Integrity & Anti-Manipulation Architecture

## Context

The business owner raised a critical operational concern:

Employees may manipulate invoices after customer payment.

Example:
- Customer originally pays 100 KD
- Employee later removes a 60 KD add-on
- Invoice total becomes 40 KD
- Employee keeps 60 KD cash
- Activity log exists, but accountant may never notice

This exposed a major architectural issue:

> Mutable financial totals destroy accounting trust.

---

# Core Architectural Principle

After money is involved:

> Never rewrite financial history.

Instead:
- append
- adjust
- compensate
- approve
- audit

This is how real accounting systems operate.

---

# The Real Problem

Dangerous workflow:

1. Customer pays 100 KD
2. Invoice total = 100 KD
3. Employee edits order later
4. Invoice total becomes 40 KD
5. System now says customer only owed 40 KD
6. Employee pockets 60 KD

Even if:
- activity logs exist
- audit history exists
- workflow tracking exists

The accountant may never detect the manipulation unless manually auditing logs.

This means:
- logs alone are NOT sufficient
- mutable invoice totals are the real issue

---

# Important Distinction

## Orders SHOULD remain editable

Operational workflows naturally change:
- customer upgrades package
- removes add-ons
- adds albums
- requests extra prints
- returns later for additional products

Operational flexibility is normal.

---

## Financial records SHOULD become immutable

The following should become protected financial history:
- finalized invoice totals
- issued invoice line items
- payment records
- accounting totals

These should never silently mutate.

---

# Correct Architectural Direction

## Orders = Editable Operational State

Orders represent:
- workflow
- deliverables
- package selections
- production operations

Orders can evolve.

---

## Invoices = Immutable Financial Snapshots

Invoices represent:
- accounting history
- customer financial obligations
- finalized financial records

Invoices should not silently change after financial finalization.

---

# Safe Financial Workflow Example

## Original Sale

Invoice #1001
- Package Total = 100 KD
- Customer pays 100 KD

Invoice becomes:
- issued
- paid
- financially finalized

---

## Later Customer Change

Customer removes cake:
- value = -60 KD

---

## BAD SYSTEM

Rewrite original invoice:
- Invoice #1001 total changes from 100 KD → 40 KD

Problems:
- original financial history destroyed
- accountant loses visibility
- fraud becomes difficult to detect

---

## GOOD SYSTEM

Keep original invoice unchanged.

Create:
- Adjustment Invoice
- Credit Note
- Refund Record

Example:

Invoice #1001
- Original total remains 100 KD

Adjustment Invoice #1001-A
- Delta = -60 KD
- Reason required
- Manager approval required
- Accountant visibility enabled

Now the system preserves:
- original sale
- adjustment history
- approval chain
- timestamps
- responsible employee

Nothing disappears from financial history.

---

# Recommended System Model

## Zone 1 — Operational Editing (Flexible)

Before financial finalization:
- packages can change
- add-ons can change
- deliverables can change
- pricing can evolve

Low-risk operational flexibility.

---

## Zone 2 — Financially Locked

After:
- invoice issued
- payment recorded
- invoice locked
- delivery completed

Then:
- no silent financial mutations allowed

Changes require:
- adjustment workflows
- approval workflows
- financial audit records

---

# Recommended Architecture Rules

## Rule 1 — Keep Orders Editable

Do NOT freeze operational workflows unnecessarily.

Orders should continue supporting:
- upgrades
- revisions
- post-session additions
- production changes

---

## Rule 2 — Freeze Financial Snapshots

Once financially finalized:
- invoices become immutable
- payment records remain permanent
- totals cannot silently recalculate

Possible lock triggers:
- full payment
- delivery completion
- accountant close
- manual financial finalization

---

## Rule 3 — Never Mutate Locked Invoice Totals

Instead:
- create adjustment invoices
- create credit notes
- create refund records
- create compensation records

Use append-only accounting behavior.

---

## Rule 4 — Require Approval for Negative Financial Deltas

Especially for:
- discounts
- package downgrades
- item removals
- refunds
- voids
- credit creation

Recommended flow:
1. Employee submits adjustment request
2. System calculates delta
3. Manager/accountant approves
4. Adjustment document created
5. Accountant visibility maintained

---

## Rule 5 — Add Financial Visibility Tools Later

Recommended future reporting:
- adjusted invoices today
- refunds this week
- negative deltas by employee
- approval queue
- suspicious adjustment patterns

This helps detect:
- fraud
- mistakes
- abnormal employee behavior

---

# Permission Architecture Recommendation

| Action | Receptionist | Manager | Accountant |
|---|---|---|---|
| Add add-ons before payment | Yes | Yes | Yes |
| Increase invoice total | Limited | Yes | Yes |
| Reduce invoice total | No | Approval Required | Yes |
| Refund customer | No | Limited | Yes |
| Void invoice | No | No | Yes |
| Unlock invoice | No | Rarely | Yes |

---

# Important UX Insight

The business owner is also requesting:

> Friction for dangerous financial actions.

This is GOOD UX for operational systems.

Dangerous actions should feel dangerous.

Recommended UX:
- warning modal
- reason required
- approval request
- manager PIN/authorization
- accountant visibility
- irreversible confirmation messaging

The goal is:
- prevent accidental changes
- discourage malicious behavior
- increase operational accountability

---

# What Should Be Avoided

Avoid:
- fully mutable invoices
- silent recalculation of paid invoices
- deleting invoice history
- relying only on logs
- unrestricted employee financial edits
- hidden retroactive total changes

These patterns eventually create:
- accounting inconsistency
- audit problems
- fraud risk
- loss of business trust

---

# Final Architectural Direction

Studio OS should evolve toward:

- editable operational workflows
- immutable financial history
- append-only accounting behavior
- approval-driven financial corrections
- adjustment-document architecture
- audit-friendly financial records
- operational fraud protection

This moves the platform from:
- a simple internal workflow tool

toward:
- a real operational ERP/POS architecture suitable for long-term business use.