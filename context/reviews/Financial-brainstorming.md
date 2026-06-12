# Studio OS — Gift Voucher & Customer Credit Discussion Notes

**Status:** Working discussion document   2:59 am June 12, 2026
**Purpose:** Capture current decisions, architectural direction, and open questions before drafting voucher or customer-credit specifications.

---

# Guiding Principle

The system should be designed so future business-rule changes do not require architectural redesign.

Examples:

- Voucher leftover value currently forfeits.
- Future owner may want leftover value converted into customer credit.
- Deposit reuse rules may evolve.
- Voucher transfer rules may evolve.

Current business rules should be implemented, but the architecture should remain extensible.

---

# Core Architectural Direction

## Settlement Sources

The financial architecture should treat multiple value sources as independent settlement mechanisms.

Potential settlement sources:

- Cash Payment
- Credit Note
- Gift Voucher
- Customer Credit

All of these reduce what a customer owes.

However:

- They are not the same thing.
- They have different lifecycle rules.
- They should not be merged into a single domain object.

---

# Gift Voucher

## Current Direction

Gift vouchers are:

- purchased prepaid value instruments
- code-based
- transferable before reservation/redemption
- single-order / single-booking-lifecycle instruments
- not reusable across unrelated orders
- not customer-wallet balances

Gift vouchers are settlement sources, not customer credit.

---

## Voucher Lifecycle

### Purchase

Customer purchases voucher.

Expected flow:

SALE Invoice
→ Payment
→ Voucher Created

Voucher exists independently of bookings/orders.

---

### Ownership

Voucher may have:

- Purchaser Customer
- Optional Assigned Customer / Recipient

Voucher may be transferred before reservation or redemption.

Once reserved for a booking:

- ownership/redeemer becomes effectively locked

---

### Reservation

Current preferred direction:

Voucher reservation does NOT equal redemption.

When voucher secures a booking:

- Deposit Invoice is still created
- Deposit Invoice remains unpaid/open
- Voucher is marked RESERVED
- Booking is considered operationally secured

Reservation acts as collateral/security, not payment.

---

### Redemption

When customer attends and settles their order:

Voucher value may be applied to the order.

Current business rule:

- Voucher is intended for one booking/order lifecycle
- Full remaining voucher balance is consumed
- Voucher becomes REDEEMED

---

### No Show

If customer no-shows:

- Voucher incurs the normal penalty
- Voucher value decreases accordingly
- Voucher remains usable afterward if balance remains

Example:

Voucher = 100 KD

No-show:

Voucher = 80 KD

Later redemption uses remaining 80 KD.

---

### Expiry

Current direction:

- Expired vouchers cannot be redeemed
- Manager cannot bypass expiry directly
- Manager must EXTEND voucher first
- Extension is audited

---

### Refund of Voucher Purchase

Current direction:

If voucher has not been used:

- Voucher is VOIDED
- Refund flow uses existing refund architecture

Future possibility:

- Refund to Customer Credit instead of cash

---

# Voucher Reporting Requirements

Desired reporting includes:

- Active Vouchers
- Reserved Vouchers
- Redeemed Vouchers
- Expired Vouchers
- Voided Vouchers
- Outstanding Voucher Liability
- Voucher Revenue
- Voucher Forfeitures
- Voucher Redemptions

---

# Voucher Leftover Value

## Current Business Rule

If voucher value exceeds invoice value:

Example:

Voucher = 100 KD
Invoice = 70 KD

Current rule:

- Apply 70 KD to invoice
- Remaining 30 KD is forfeited

---

## Important Architectural Requirement

Architecture should NOT assume forfeiture is permanent policy.

Future possibility:

- Remaining value converts into customer credit

Implementation should remain extensible enough to support this later without redesign.

---

# Customer Credit

## Why Customer Credit Exists

Separate business requirement:

Customer pays deposit.

Customer cancels within allowed period.

Instead of losing the deposit:

- value can be reused on future bookings
- valid for up to one year

This creates a need for customer credit.

---

## Relationship To Vouchers

Current direction:

Gift Voucher ≠ Customer Credit

Gift Voucher:
- code-based
- single booking lifecycle
- transferable
- reservation-aware

Customer Credit:
- belongs to customer
- reusable
- can be used across future bookings/orders
- may have expiry

They should remain separate concepts.

---

# Future Settlement Example

Example invoice:

160 KD

Settled using:

- Customer Credit = 20 KD
- Gift Voucher = 100 KD
- Cash = 40 KD

Multiple settlement sources should be allowed.

---

# Customer Credit Architecture

## Open Question

Two possible directions remain under discussion.

---

## Option A — Credit Certificate Model (Simpler)

Each credit is its own object.

Example:

Credit A
- 20 KD
- Cancelled Deposit
- Expires 2027

Credit B
- 15 KD
- Goodwill
- Expires 2028

Applications consume specific credits.

Potential structure:

CustomerCredit
- customerId
- sourceType
- originalAmount
- remainingAmount
- expiresAt
- status

CustomerCreditApplication
- customerCreditId
- invoiceId
- amount

Pros:

- Simpler
- Easier expiry handling
- Easier auditing
- Matches current business requirements

Cons:

- Less flexible long-term

---

## Option B — Full Customer Credit Ledger

Customer owns a balance account.

Example:

+20 Cancelled Deposit
+15 Goodwill
-10 Booking

Balance derived from transactions.

Potential structure:

CustomerCreditAccount

CustomerCreditTransaction
- customerId
- amount
- type
- source

Pros:

- Most scalable
- Supports many future workflows

Cons:

- More complex
- Expiry handling becomes significantly harder
- More financial infrastructure required

---

## Current Status

OPEN QUESTION

No decision has been made between:

- Credit Certificate Model
- Full Customer Credit Ledger

---

# Future-Proofing Requirement

Regardless of which customer-credit model is selected:

The invoice-settlement architecture should remain stable.

Invoices should not care whether value came from:

- Cash
- Credit Note
- Gift Voucher
- Customer Credit

Each source should plug into settlement without requiring invoice redesign.

---

# Additional Future Discussion Topics

Still unresolved:

1. Exact voucher redemption schema
2. Voucher transaction history vs mutable balance
3. Customer credit model selection
4. Customer credit expiry rules
5. Refund-to-credit workflows
6. Voucher and customer-credit reporting requirements
7. Long-term interaction between vouchers and customer credit