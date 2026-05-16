# Studio OS — Booking / Job / Invoice Lifecycle Revision Notes

## Core Direction

The system should separate:

- tentative booking holds
- confirmed bookings
- operational jobs/orders
- financial invoice history

The previous assumption that:
- booking creation
- job creation
- invoice lifecycle

all happen together is no longer correct for the actual business workflow.

---

# 1. Pending Booking Lifecycle

## New Rule

Pending bookings should NOT consume:
- booking references
- job numbers
- invoice numbers

Pending bookings are only:
- temporary calendar reservations
- tentative customer holds

If canceled:
- they may be deleted entirely
- no operational reference should remain consumed

---

# 2. Confirmed Booking Stage

## Trigger

A booking becomes “confirmed” only after:
- deposit payment
OR
- official reservation confirmation

(depending on final business rules)

## At Confirmation

The system should:

- generate Booking Reference
- create Deposit Invoice
- record deposit payment

Example:

- Booking Ref: BKG-2026-0041
- Deposit Invoice: INV-2026-0001

---

# 3. Job / Order Creation Timing

## Important Change

Job creation should NOT happen during initial booking creation.

Instead:

text Pending Booking → Confirmed Booking → Job/Order Creation 

## Reason

The business wants:
- operational references only for real work
- fewer ghost job numbers
- cleaner operational reports

---

# 4. Separate Reference Types

## Booking Reference

Purpose:
- reservation lookup
- receptionist workflow
- customer communication before operational workflow begins

Example:
- BKG-2026-0041

Characteristics:
- lightweight
- temporary operational reference
- tied to confirmed booking only

---

## Studio Reference / Job Order Reference

Purpose:
- canonical operational workflow ID
- editing
- production
- delivery
- accounting linkage

Example:
- JOB-2026-0012

Created only when:
- Job/Order officially begins

---

# 5. Invoice Architecture Revision

## Important Discovery

The system should NOT assume:
- one order = one invoice

Instead:

text Order/Job → owns financial history 

That financial history may contain:
- deposit invoice
- final invoice
- adjustment invoice
- refund invoice
- credit note

---

# 6. Deposit Invoice vs Final Invoice

## Deposit Invoice

Created during:
- confirmed booking stage

Purpose:
- reservation/deposit collection

References shown:
- Invoice Number
- Booking Reference

Example:

text INV-001 Booking Ref: BKG-2026-0041 

No Job/Studio Reference yet because the Job does not exist yet.

---

## Final Invoice

Created during:
- POS / selection finalization

Purpose:
- actual deliverables purchased
- upgrades
- add-ons
- final accounting total

References shown:
- Invoice Number
- Booking Reference
- Studio Reference / Job Order Reference

Example:

text INV-002 Booking Ref: BKG-2026-0041 Studio Ref: JOB-2026-0012 

---

# 7. Deposit Application Model

## Key Concept

Deposit payments should remain historically attached to the Deposit Invoice.

The Final Invoice should DISPLAY:
- previously paid deposits
- remaining balance

without merging invoices together.

Example:

text Package Total: 120 KD Deposit Paid: -20 KD Remaining Balance: 100 KD 

Internally:

text Deposit Invoice INV-001 → payment: 20 KD  Final Invoice INV-002 → references applied deposit 

---

# 8. Recommended Financial Ownership Structure

text Booking └── Deposit Invoices  Job / Order └── Final Operational Invoices     └── Adjustment Invoices     └── Refunds     └── Credit Notes 

---

# 9. Lifecycle Flow (Recommended)

text Pending Booking → no references → no invoices  Confirmed Booking → Booking Reference → Deposit Invoice → Deposit Payment  Job/Order Created → Studio Reference / Job Order Reference  Selection / POS Finalization → Final Invoice → Deposit Applied → Remaining Balance Calculated  Payment Completed → Editing Allowed 

---

# 10. Important Operational Rules

## Rule: Editing Lock

Editing should NOT begin unless:
- payment requirements are satisfied

---

## Rule: Job Number Gaps

Gapless job numbering should NOT be a requirement.

If:
- confirmed Job/Order later gets canceled

the Studio Reference should remain consumed for audit integrity.

Only tentative/pending bookings should avoid consuming references.

---

# 11. Architectural Impact

This is NOT just:
- “move job number later”

This is a real:
- lifecycle architecture revision
- workflow state-machine change
- ownership separation change

between:
- Booking
- Job/Order
- Invoice lifecycle
- Financial history