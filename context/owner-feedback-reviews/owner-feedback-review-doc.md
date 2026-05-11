# Studio OS — Business Owner Feedback Review Summary

## 1. Terminology Confusion (“Job Number” Naming)

### Feedback
The term “Job Number” is confusing operationally. The business owner prefers terminology like “Job Order.”

### Analysis
This is primarily a UI/UX and terminology issue, not necessarily a database or architecture problem.

Employees likely do not clearly distinguish between:
- Booking
- Order
- Job
- Editing Job
- Production Job

### Recommended Direction
Keep the internal architecture unchanged for now:
- `Job`
- `jobNumber`
- `EditingJob`
- `ProductionJob`

But simplify UI terminology:
- “Job Number” → “Studio Reference” or “Order Reference”
- “Order” → “Job Order”
- “Editing Job” → “Editing Task”
- “Production Job” → “Production Task”

### Important Note
Do NOT rename database models yet. Start with UI terminology only.

---

## 2. Job Number Creation Timing

### Feedback
If a booking is canceled before an order exists, the job number should not be consumed or permanently used.

### Analysis
This is a real workflow architecture concern.

Currently:
- booking creation generates job number

Business expectation:
- operational reference numbers should only exist for confirmed/active work

### Recommended Direction
Move canonical job creation later in the workflow.

Suggested flow:
- Booking created
- Booking gets lightweight booking reference only
- No permanent job number yet
- When order is officially created / confirmed:
  - create canonical Job
  - generate job number
  - activate downstream workflow

### Important Note
This is an actual lifecycle architecture change and affects workflow sequencing.

---

## 3. Package Upgrade Pricing Problem

### Feedback
Package totals do not equal the sum of included products. Example:
- package includes album + canvas + photos
- package total may be lower or higher than individual standalone prices

Question:
How should pricing work if a customer upgrades the included album?

### Analysis
This exposed a major pricing architecture assumption.

Current likely assumption:
- totals are calculated from summed products

Actual business model:
- packages are commercial bundles with arbitrary pricing

### Recommended Direction
Do NOT calculate upgrades using:
- old item price subtraction
- standalone product price differences

Instead:
implement:
- package-defined upgrade delta pricing

Example:
- Standard album included
- Premium album upgrade = +25 KD
- Luxury album upgrade = +40 KD

### Important Note
Packages should behave as commercial bundles, not additive carts.

---

## 4. POS Page / Sales Interface

### Feedback
The business owner wants a dedicated POS-style page for:
- adding/removing packages
- add-ons
- album upgrades
- pricing modifications
- invoice visibility
- payment handling

The current “selection tab” does not feel operationally correct.

### Analysis
This is more than a UI change.

This becomes:
- a sales workflow surface
- financial control surface
- transactional operations page

Potentially one of the most important operational screens in the system.

### Recommended Direction
Create a dedicated:
- “Sales”
- “POS”
- or “Order Checkout”

module/page.

This page should handle:
- package modifications
- upgrade flows
- add-ons
- invoice summary
- payment status
- adjustment requests
- permissions
- audit tracking

### Important Note
This likely becomes separate from the current order selection workflow.

---

## 5. Move Base Payment After Selection

### Feedback
Current workflow feels incorrect.

Business owner prefers:
- order creation first
- customer selection
- upgrades/add-ons
- payment afterward
- editing cannot start until payment is completed

### Analysis
Current system assumption:
- payment creates order

Operational reality:
- final payable amount often does not exist until selections/upgrades are finalized

### Recommended Direction
New workflow proposal:

Booking
→ Create Order
→ Selection Phase
→ POS / Sales Finalization
→ Invoice Finalization
→ Payment Collection
→ Editing Starts

Additional workflow guard:
- editing cannot begin unless payment requirement is satisfied

### Important Note
This changes workflow timing but is operationally more realistic.

---

## 6. Employee Manipulation / Theft Risk

### Feedback
Employees may manipulate orders after payment.

Example:
- customer originally pays 100 KD
- employee later removes a 60 KD add-on
- invoice total becomes 40 KD
- employee keeps 60 KD cash
- activity log exists but accountant never notices

### Analysis
This is the most critical feedback.

Problem:
- mutable invoice totals destroy accounting trust

Activity logs alone are NOT sufficient financial protection.

### Recommended Direction

Introduce:
- financial authorization architecture
- immutable financial history
- approval workflows

Core rules:
- issued invoices cannot silently mutate
- reductions require:
  - reason
  - approval
  - accountant visibility
- major reductions become approval requests

Example:
Employee removes cake:
- creates financial adjustment request
- shows delta (-60 KD)
- requires manager approval
- becomes visible to accountant

### Important Note
The business owner is asking for:
- accounting integrity
- anti-fraud controls
- visible financial adjustments

NOT just better logs.

This is a major operational maturity milestone for the software.