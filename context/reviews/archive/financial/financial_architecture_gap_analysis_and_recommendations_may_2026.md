# Studio OS — Financial Architecture Gap Analysis & Recommended Direction

**Date:** 2026-05-13

---

# Purpose

This document summarizes:

- the current financial architecture
- the major architectural gaps
- findings from external accounting / invoicing research
- future operational requirements
- recommended solution directions
- migration and implementation guidance

This document is intended for:

1. reviewing against the current codebase
2. discussing architectural decisions
3. identifying risks and tradeoffs
4. producing implementation plans
5. producing future unit feature specs

This is NOT a final implementation spec.

It is an architecture review + recommendation document.

---

# Current Financial Architecture (Current Code)

The current financial system is centered around:

```text
FinancialCase
  → Invoice
    → Payment
```

## Current Core Concepts

### FinancialCase

- Created when a booking deposit is recorded.
- Acts as the financial container for a booking/session.
- Links booking → invoices → payments.
- Later linked to Job during check-in.
- All money for a booking belongs to exactly one FinancialCase.

### Deposit Flow

Current behavior:

1. Booking created as PENDING.
2. Deposit payment recorded.
3. FinancialCase created.
4. Deposit invoice created.
5. Deposit payment recorded.
6. Deposit invoice immediately closed + locked.
7. Booking transitions to CONFIRMED.

Current deposit characteristics:

- hardcoded 20 KD
- always fully paid
- immediately locked
- no refund path
- no transfer path
- no partial application

### Final Invoice

Current final invoice:

- created later during order/selection workflow
- recalculated during financial edits
- line items snapshotted on close
- supports adjustment invoices conceptually
- locked invoices reject recalculation

### Current Deposit Application Logic

IMPORTANT:

The deposit is NOT explicitly applied to the final invoice.

Instead:

```text
effectivePaid =
  direct final invoice payments
  + deposit paid amount from FinancialCase
```

Meaning:

- Deposit invoice and final invoice remain separate.
- No explicit application relationship exists.
- Final invoice paidAmount only stores direct payments.
- Deposit credit is virtual/computed.

This is one of the largest architectural weaknesses.

---

# Major Current Gaps

## 1. Deposit Credit Is Virtual Instead of Explicit

Current issue:

```text
Deposit is inferred through FinancialCase lookup.
```

Instead of:

```text
Deposit invoice → applied to → Final invoice
```

Problems caused:

- stale balance calculations
- inconsistent paidAmount semantics
- reporting confusion
- accounting ambiguity
- harder future refund handling
- harder gift card support
- harder split payment support
- harder multi-invoice workflows

Research strongly recommends explicit application records.

---

## 2. No Refund Path

Current code:

- Payment.amount is positive-only
- no refund payment type
- no negative payment support
- no outbound payment support
- no refund workflow

Current result:

Customer refunds cannot be modeled correctly.

---

## 3. No Credit Note / Negative Adjustment Path

Enums exist:

```text
CREDIT_NOTE
REFUND
MANUAL_DISCOUNT
MANUAL_SURCHARGE
```

But:

- no service path creates them
- no negative adjustment invoices
- no invoice reduction mechanism exists

Current result:

Locked invoice reductions cannot be modeled correctly.

---

## 4. Locked Invoice Adjustment Automation Missing

Current behavior:

```text
Locked invoice financial edit → throw error
```

Desired behavior:

```text
Locked invoice financial edit
  → auto-create adjustment invoice
```

This was already identified in earlier roadmap planning.

---

## 5. Payment Model Is Too Rigid

Current model:

```text
Payment → Invoice
```

This limits:

- split payments
- one payment covering multiple invoices
- refunds tied to original payments
- future credit application
- gift card + cash combinations
- multi-adjustment settlement

---

## 6. No Customer Credit / Ledger System

Current architecture lacks:

- customer credits
- store credit
- future credit carryover
- refund-to-credit flows
- gift card ledgering
- no-show penalty credit tracking

This becomes important for:

- gift cards
- refunds
- future vouchers
- booking transfer policies
- no-show penalties
- operational accounting visibility

---

## 7. Multi-Package Architecture Not Yet Reflected

Current architecture is structurally:

```text
1 Booking
  → 1 Order
    → 1 Package
      → 1 Final Invoice
```

Planned future:

```text
1 Booking
  → 1 Order
    → multiple packages
```

This affects:

- invoice structure
- package adjustments
- deliverable rendering
- financial recalculation
- payment distribution

---

## 8. OrderAddOn Currently Overloads Two Concepts

Current table handles both:

1. true add-ons
2. package-item upgrades

This creates conceptual overlap.

Not necessarily urgent, but important to review.

---

# Deep Research Findings

External research reviewed systems including:

- Stripe
- Square
- Xero
- QuickBooks
- FreshBooks
- Zoho Invoice
- Wave

Key finding:

There is NO single universal invoice/deposit model.

Three major patterns exist:

| Pattern | Description |
|---|---|
| Single invoice + payment schedule | One invoice contains deposit + remaining balance |
| Separate deposit/prepayment documents | Deposit exists separately and is later applied |
| Estimate/project → multiple invoices | One commercial case spawns multiple invoices |

The research conclusion:

The safest architecture supports ALL of these patterns.

---

# Most Important Research Recommendation

Separate these concerns:

| Concern | Purpose |
|---|---|
| Grouping | Which records belong together |
| Semantic relationship | Which document adjusts/refunds/derives from another |
| Money application | Which money/credit settles which invoice |

This is extremely important.

---

# Recommended Long-Term Architecture Direction

## Keep FinancialCase

Do NOT rename FinancialCase right now.

FinancialCase already behaves similarly to the research model's:

```text
FinancialGroup
```

It is already a strong architectural anchor.

---

# Recommended New Core Concepts

## 1. DocumentApplication

### Purpose

Explicitly apply:

- deposits
- credits
- credit notes
- adjustments
- future credits

against invoices.

### Proposed Structure

```text
DocumentApplication
  sourceDocumentId
  targetDocumentId
  amountApplied
  appliedAt
```

### Example

```text
Deposit invoice → Final invoice = 20 KD
```

### Why This Matters

This replaces:

```text
virtual deposit credit lookup
```

with:

```text
explicit financial relationship
```

Benefits:

- cleaner accounting
- cleaner reporting
- cleaner balances
- future gift card support
- future refunds
- future credits
- multi-invoice support
- reduced stale calculations

---

## 2. PaymentAllocation

### Current Model

```text
Payment → Invoice
```

### Recommended Model

```text
Payment
  → PaymentAllocation
      → Invoice
```

### Example

```text
One KNET payment:
  60 KD → Final invoice
  40 KD → Adjustment invoice
```

### Benefits

- split payments
- partial settlement
- refund references
- future accounting support
- gift card + cash combinations
- multi-invoice settlement

### Recommendation

This is important, but should likely come AFTER DocumentApplication.

---

# Gift Card Architecture Direction

## Important Decision

Gift cards should NOT behave like discounts.

They should behave like:

```text
stored customer credit
```

---

# Recommended Direction

Use:

## Full Customer Credit Ledger

### Proposed Models

```text
CustomerCreditAccount
```

```text
CreditTransaction
```

```text
CreditApplication
```

### CreditTransaction Examples

```text
GIFT_CARD_ISSUED
GIFT_CARD_REDEEMED
REFUND_TO_CREDIT
CREDIT_EXPIRED
NO_SHOW_PENALTY
MANUAL_ADJUSTMENT
```

---

# Gift Card Model

```text
GiftCard
  code
  originalAmount
  expiresAt
  status
  purchaserCustomerId?
  recipientCustomerId?
  creditAccountId?
```

---

# Planned Business Rules

Current intended rules:

- one-time use gift voucher
- full amount must be used at once
- can book without normal deposit
- no-show consumes/debits deposit-equivalent value
- studio validates voucher before booking

IMPORTANT:

These rules should be enforced through:

```text
GiftCardRedemption / CreditTransaction logic
```

NOT by weakening the ledger structure.

---

# Important Accounting Concepts

Research strongly emphasized:

## Deposits Are NOT Revenue

Receiving money ≠ earning revenue.

Recommended accounting direction:

```text
Deposit received
  → liability until service delivered
```

Full enterprise accounting is NOT required immediately.

However:

The architecture should avoid blocking future accounting correctness.

---

# Recommended Invoice UI Direction

Research strongly recommended:

## Separate:

### Commercial Lines

```text
Package
Add-ons
Albums
Prints
Extra photos
```

from:

### Settlement / Credit Section

```text
Deposit applied
Gift card applied
Refunds
Credits
Remaining due
```

This aligns strongly with the new POS direction.

---

# Recommended Migration / Implementation Order

## Phase 1 — Financial Stabilization

### Goals

- eliminate virtual deposit logic
- improve balance correctness
- preserve existing architecture

### Recommended Work

1. Add `DocumentApplication`
2. Backfill deposit application rows:

```text
Deposit invoice → Final invoice
```

3. Recalculate invoice balances from applications instead of virtual FinancialCase lookup.
4. Keep temporary fallback compatibility logic during migration.

---

## Phase 2 — Locked Invoice Adjustment Automation

### Goals

- preserve immutable financial history
- stop recalculating locked invoices

### Recommended Work

1. Locked invoice financial edit:

```text
→ auto-create adjustment invoice
```

2. Support positive adjustments first.
3. Later support negative adjustments / credit notes.

---

## Phase 3 — Refund & Credit Note Architecture

### Goals

Properly model:

- refunds
- invoice reductions
- store credit
- negative adjustments

### Important Distinction

These are NOT the same thing:

| Concept | Meaning |
|---|---|
| Credit note | Reduces what customer owes |
| Refund payment | Money sent back to customer |
| Store credit | Future reusable value |

These should remain separate.

---

## Phase 4 — Gift Card / Customer Credit Ledger

### Goals

Support:

- gift vouchers
- future store credit
- refund-to-credit
- no-show penalties
- future transferable value

### Recommended Work

1. Add `CustomerCreditAccount`
2. Add `CreditTransaction`
3. Add `CreditApplication`
4. Add `GiftCard`
5. Add `GiftCardRedemption`

Initial scope should remain intentionally limited.

Do NOT initially implement:

- reloadable wallets
- customer-to-customer transfer
- partial redemption
- advanced accounting reports

---

## Phase 5 — Payment Allocation

### Goals

Allow:

- split payments
- multi-invoice settlement
- cleaner refund references
- future accounting expansion

### Recommended Work

1. Add `PaymentAllocation`
2. Migrate old payments to one allocation each.
3. Later support multi-allocation payments.

---

# Important Non-Recommendations

## Do NOT Rewrite Everything

The current architecture is already strong.

Recommended strategy:

```text
Keep FinancialCase
Keep Invoice
Keep Payment
Gradually add missing layers
```

NOT:

```text
complete financial rewrite
```

---

# Current Architecture Assessment

## Strong Areas

- FinancialCase abstraction
- deposit separation
- invoice locking
- snapshot line items
- operational workflow integration
- invoice/payment separation
- activity logging
- immutable deposit invoices
- delivery closure behavior

## Weak Areas

- virtual deposit crediting
- no refund path
- no credit-note path
- no explicit applications
- rigid payment model
- no customer credit ledger
- no payment allocation layer
- multi-package not yet integrated

---

# Final Recommendation

The current architecture is already evolving toward a mature financial-document model.

The safest next direction is:

```text
1. Add DocumentApplication
2. Remove virtual deposit logic
3. Add adjustment automation
4. Add refund / credit-note support
5. Add customer credit ledger
6. Add gift card support
7. Add payment allocation layer
```

This preserves:

- current workflow architecture
- current operational flow
- current invoice concepts

while gradually evolving toward:

- cleaner accounting
- safer financial history
- future gift cards
- future credits
- future refunds
- future multi-package support
- future payment flexibility
- enterprise-style financial correctness

