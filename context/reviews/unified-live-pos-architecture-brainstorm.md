
# Unified Live POS + Financial Commit Architecture Brainstorm

## Background / Current Problem

Photography studio sales are very different from restaurant or supermarket POS systems.

In a restaurant:
- customer orders
- customer pays
- invoice closes
- transaction is finished

In a photography studio:
- the order stays alive for days or weeks
- customers upgrade later
- customers add products later
- selected photos can change
- package upgrades happen later
- editing/production notes are added later

The order continuously evolves.

This creates a conflict between:
- fluid operational POS experience
- accounting/reporting stability

---

## Current Pain Points

Current issues include:
- invoice lock also locks POS workflow
- adjustment workspace feels separate from normal sales flow
- staged changes and preview composition drift apart
- projections are rebuilt differently in different places
- package swap and selected photo bugs
- UI logic reconstructing business meaning
- employees forced to think about accounting concepts

The current system became too focused on:
- invoice rows
- deltas
- replay logic
- projections
- normalization layers

instead of:
- the current live order state

---

## Main Business Mental Model

Employees and owners do NOT think in invoices.

They think in:
- jobs/orders
- what the customer currently owns
- how much the customer owes
- what stage the order is in

The Order Details page is the main operational page.

The Sales/POS page is:
- customer interaction workspace
- selling/configuration workspace
- live package customization system

Employees should NOT need to understand:
- adjustment invoices
- credit notes
- payment allocations
- accounting chains

Those should exist behind the scenes only.

---

## New Core Concept

### One Live POS

The POS should always feel like one continuous live workspace.

Employees should:
- add/remove products
- upgrade packages
- swap items
- add selected photos
- configure albums
- record payments

without feeling:
- POS locked
- adjustment mode
- financial document mode

The POS remains fluid even after invoices are committed.

---

## Important Clarification

This does NOT mean invoices become editable.

Instead:
- operational order stays live
- financial documents stay immutable

This is the key separation.

---

## New Architecture Direction

### Orders Stay Mutable

The order/job itself remains operationally editable.

The customer's current ownership can evolve over time.

### Financial Documents Become Immutable Checkpoints

Invoices become:
- historical financial checkpoints
- accounting records
- reporting-safe snapshots

Once committed:
- invoices cannot mutate
- reporting remains stable
- accounting remains auditable

---

## Always-Draft POS Concept

The POS is always editing a live working draft of the order.

Flow:
Live Order State
→ Financial Commit
→ Continue Editing
→ Another Financial Commit
→ Continue Editing

The UI always behaves like a live editable sales workspace.

---

## First Commit vs Later Commits

### First Commit

If no base/final invoice exists:
- system commits FULL sale
- creates parent/base invoice
- establishes main financial baseline

### Later Commits

If a base invoice already exists:
- system compares current live draft against effective committed baseline
- commits ONLY the difference

This may create:
- adjustment invoice
- credit note
- refund requirement
- zero-net operational audit change

---

## Example: Package Upgrade

Committed baseline:
- Basic Package = 200 KD

Customer upgraded to:
- Standard Package = 300 KD

Employee-facing POS:
- Upgrade Basic → Standard
- Customer pays +100 KD

Accounting document:
-200 Basic Package
+300 Standard Package

Net adjustment:
+100 KD

This preserves proper accounting history.

---

## Effective Financial Baseline

The system must NOT compare only against the latest adjustment invoice.

Example:

Initial invoice:
150 KD

Adjustment #1:
+50 KD

Adjustment #2:
+50 KD

Effective committed baseline:
250 KD

NOT:
50 KD

This is important for:
- downgrade detection
- refund rules
- manager approval
- accurate financial comparisons

---

## Manager Approval Rules

System compares:
Current Live Draft
VS
Effective Committed Baseline

### Additive Change

Committed:
200 KD

Live Draft:
250 KD

Result:
- allowed immediately
- create adjustment invoice
- customer pays difference

### Downgrade / Reduction

Committed:
250 KD

Live Draft:
200 KD

Result:
- manager approval required
- possible credit/refund flow

### Equal Value Swap

Committed:
250 KD

Live Draft:
250 KD

Result:
- no additional payment
- still create audit trail

---

## Biggest Architectural Realization

The problem is NOT projections themselves.

The real problem is:
- too many projections
- projections rebuilding meaning differently
- UI layers reconstructing business rules
- unstable identity between layers

---

## What We Actually Need

### One Shared Projection Service

A single canonical service should derive:
- effective committed composition
- live staged composition
- financial summary
- pending changes
- approval requirements
- downgrade detection
- operational ownership
- totals

Every UI surface should consume the SAME derived view model.

Examples:
- POS page
- Order Details page
- Preview cards
- Financial summary
- Adjustment preview

No UI should independently rebuild business meaning.

---

## UI Normalization Clarification

Safe UI normalization:
- labels
- badges
- grouping
- sorting
- display formatting

Dangerous UI normalization:
- rebuilding operational ownership
- replaying financial deltas
- recalculating baselines
- replacing package identity
- reconstructing current truth

Business logic should stay in centralized services.

---

## Adjustment Workspace Future Direction

Adjustment functionality should probably remain internally.

But it should stop being a separate employee mental model.

Instead:
- employee sees one live POS
- system internally stages changes
- financial engine decides:
  - adjustment invoice
  - credit note
  - refund
  - approval requirements

The complexity becomes hidden behind the scenes.

---

## Final Mental Model

Employees edit:
- the live order

The system manages:
- immutable accounting history

The UI shows:
- simple operational summaries

The backend handles:
- financial correctness
- invoice immutability
- audit trails
- reporting stability

---

## Why This Direction Is Better

This architecture allows:
- fluid modern POS UX
- stable accounting
- immutable invoices
- accurate reporting
- live operational ownership
- safer adjustment workflows
- cleaner mental model for employees
- less projection drift
- less UI business logic
- centralized system behavior

Most importantly:

It separates:
- operational workflow
from
- accounting history

which is the architectural boundary the system was missing.
