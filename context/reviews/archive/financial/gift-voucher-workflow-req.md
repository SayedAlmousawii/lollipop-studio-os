# Studio OS — Gift Voucher Workflow Requirements

**Date:** 2026-05-13

---

# Purpose

The studio wants to support prepaid gift vouchers that customers can purchase and give to another customer/friend to redeem toward a photography session.

This document defines the business workflow requirements and operational rules discussed so far.

This is NOT yet an implementation or schema design document.

---

# Core Business Model

A gift voucher behaves like:

- prepaid studio credit
- one-time-use voucher
- redeemable using a unique voucher code
- valid for one year
- usable toward session bookings/orders

The voucher is intended to function as both:

1. a payment instrument
2. a booking security mechanism

---

# Core Voucher Rules

## Voucher Properties

Each voucher should include:

- unique voucher code
- original purchased amount
- current remaining balance
- purchase date
- expiry date (1 year from purchase)
- status
- purchaser/customer reference
- optional redeemer/customer reference
- audit history

---

# Voucher Validity

## Expiration

- vouchers expire after one year
- expired vouchers cannot be redeemed
- expired vouchers should remain historically visible/auditable

---

# One-Time Use Requirement

The studio wants vouchers to behave as:

> “single-use gift vouchers”

Meaning:

- the voucher should only be redeemed once
- the full remaining balance should be applied during redemption
- vouchers should not behave like reusable wallets

However:

A no-show penalty may reduce the voucher balance before redemption occurs.

This creates a special workflow exception described below.

---

# Booking Workflow Rules

## Booking Without Deposit

Normally:

- bookings require a 20 KD deposit

However:

If the customer has a valid unused gift voucher:

- the booking does NOT require the normal deposit payment
- staff must validate the voucher code before confirming the booking
- the voucher effectively acts as booking security

---

# Voucher Reservation / Hold Behavior

The studio knows the voucher code before creating the booking.

Once a voucher is used to secure a booking:

- the voucher should become reserved/held
- the voucher must not be usable for another booking simultaneously
- staff should be able to see which booking currently holds the voucher

Potential states may include:
- ACTIVE
- RESERVED
- REDEEMED
- EXPIRED
- VOIDED

(Exact naming TBD during architecture design.)

---

# No-Show Penalty Rule

If the voucher-backed booking becomes a no-show:

- the studio deducts the normal 20 KD booking penalty from the voucher value

Example:
- voucher original value = 100 KD
- customer no-shows
- voucher balance becomes 80 KD

The remaining reduced balance can still later be redeemed.

---

# Important Business Clarification

Although vouchers are intended to be “single-use”:

The no-show penalty creates a workflow where:
- the voucher balance may change before redemption
- the voucher still remains redeemable afterward

Meaning the intended rule is more accurately:

> “single redemption voucher with possible pre-redemption penalties”

NOT:
> “strictly immutable single-use amount”

---

# Redemption Workflow

When the customer later attends and pays using the voucher:

- the voucher is redeemed against the invoice/order
- the FULL remaining voucher balance must be applied at once
- voucher becomes fully consumed/redeemed afterward

Example:
- remaining voucher balance = 80 KD
- invoice total = 120 KD
- voucher applies 80 KD
- customer pays remaining 40 KD

---

# Remaining Balance Decision (Open Question)

If:
- voucher remaining balance > invoice total

Example:
- voucher balance = 100 KD
- invoice total = 70 KD

The business must decide:

## Option A — Forfeit Remaining Balance
- voucher fully consumed
- leftover value lost

## Option B — Convert Remaining To Store Credit
- leftover becomes customer credit/store balance
- introduces reusable credit ledger behavior

This decision is still open.

---

# Financial / Reporting Considerations

Gift vouchers should NOT behave like standard immediate revenue.

The system should eventually support distinguishing between:

- voucher sales
- voucher liabilities
- redeemed voucher value
- expired unused vouchers
- no-show deductions
- refunded/voided vouchers

---

# Operational Requirements

Staff should be able to:

- validate voucher codes
- see voucher balance
- see voucher expiry
- see voucher reservation status
- see linked booking/order
- redeem voucher
- apply no-show penalty
- void voucher (with permissions)
- manually adjust/extend voucher (manager only)

All important actions should be auditable.

---

# Important Architecture Direction

Gift vouchers should likely integrate with the future:

- customer credit ledger
- refund/store-credit system
- adjustment invoice system
- payment architecture

rather than becoming an isolated standalone feature.

This is especially important because:
- vouchers behave partially like payments
- partially like credits
- partially like booking guarantees

---

# Current Open Questions

## 1. Leftover Balance Behavior
Should leftover value:
- be forfeited
- or converted to reusable customer credit?

---

## 2. Cancellation Policy
If customer cancels early enough:
- should voucher reservation simply release?
- should penalty still apply?

---

## 3. Voucher Transferability
Can voucher ownership/redeemer change freely?

Example:
- purchased by one customer
- redeemed by another

(Current assumption: yes.)

---

## 4. Expiry Handling
Should expired vouchers:
- fully lock permanently
- or allow manager override?

---

## 5. Reporting Treatment
How should accounting/reporting treat:
- sold but unused vouchers
- expired vouchers
- partially penalized vouchers?

(Requires later financial architecture review.)

---