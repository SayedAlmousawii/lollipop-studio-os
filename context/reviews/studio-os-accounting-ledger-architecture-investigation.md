# Studio OS Accounting / Ledger Architecture Investigation

## Purpose

This document captures the full architecture discussion around whether Studio OS should continue with its current financial-document model, add an accounting ledger later, or move toward a ledger-first financial system.

The intended use is to give this document to Codex or Claude Code as a second-pass investigation brief against the current repository.

The core question is:

> Would moving toward a real accounting system with general ledger, double-entry debit/credit postings, journal entries, and account-based reporting simplify Studio OS financial architecture, especially for vouchers, customer credit, deposits, refunds, and accountant-grade reporting?

This document is not a final implementation spec. It is an architectural investigation note and handoff prompt.

---

# 1. Current Context and Constraints

## 1.1 Business Context

Studio OS is a vertical business system for a photography/studio workflow. It has operational concepts such as:

- Orders
- Order commitments
- Composition snapshots
- Package/add-on/album/upgrade changes
- Deposit invoices
- Final invoices
- Adjustment invoices
- Credit notes
- Refunds
- Payments
- Allocations / settlement
- Planned customer credit
- Planned gift voucher support

The system is not just an accounting app. It is primarily an operational workflow system that also needs strong financial correctness.

## 1.2 Important Simplifications

The current project has several helpful conditions:

1. **No meaningful production data yet**
   - There is no large historical data set that must be backfilled.
   - This makes architecture changes less painful.
   - Ledger/journal entries could be added without a large reconciliation project.

2. **No taxes in Kuwait for this use case**
   - There is no VAT/GST/sales-tax layer to model right now.
   - This simplifies invoice posting, revenue reporting, credit note logic, and refunds.

3. **The system already leans toward financial discipline**
   - The project has been moving toward immutable financial documents.
   - Locked/finalized invoices should not be mutated.
   - Post-lock changes should flow through adjustment, credit note, refund, or future credit/voucher flows.
   - This is good groundwork for a future accounting ledger.

---

# 2. The Main Concern

The concern is that accounting correctness and reporting may be hard to achieve with the current setup if reports are built directly from operational tables and financial-document tables.

The user’s concern can be summarized as:

> Instead of building many separate engines around invoices, payments, deposits, vouchers, customer credit, refunds, allocations, and financial cases, would a real accounting ledger underneath everything simplify the system and make future features easier?

This is a valid concern.

The current document model is good for operational financial truth and customer/order balances, but by itself it can become weak for accountant-grade reporting if every report has to re-derive accounting meaning from custom business tables.

---

# 3. Three Possible Architectures

## Option A — Financial Document Model Only

In this model, the system has business financial documents such as:

```text
Invoice
Payment
Credit Note
Refund
Voucher
Customer Credit
Allocation
```

These documents drive customer balances and order financial state directly.

Conceptually:

```text
Financial Documents
    ↓
Settlement / Allocations
    ↓
Financial Case / Customer Balance
```

### Strengths

- Simple for operational users.
- Easy to reason about invoices and payments.
- Works well for customer/order views.
- Avoids exposing staff to accounting debit/credit terminology.
- Fits the way studio staff think: invoice, paid, remaining, refund, credit.

### Weaknesses

- Accountant-grade reporting becomes harder.
- Each report may need custom logic.
- Customer credit and vouchers may create separate balance engines.
- It may become difficult to answer accounting questions like:
  - What is AR as of a specific date?
  - What revenue was recognized this month?
  - What cash was collected by account?
  - What voucher/customer-credit liabilities exist?
  - Do debits equal credits?
  - Can an accounting period be closed?
- Without journal entries, every financial report risks becoming its own mini-engine.

### Risk

The biggest risk is scattered balance mutation logic, for example:

```text
customerBalance += x
customerBalance -= y
remaining -= z
```

If this style spreads through services, future accounting migration becomes difficult because balances become outcomes of scattered imperative mutations instead of derived facts from immutable documents/postings.

---

## Option B — Hybrid ERP-Style Model: Business Documents + Accounting Ledger

In this model, business documents remain the operational source of truth, but finalized financial documents post immutable accounting entries.

Conceptually:

```text
Order / OrderCommit
    ↓
Financial Documents
    ↓
Journal Entries
    ↓
General Ledger / Accounting Reports
```

Operational UI still reads from business documents and projections. Accountant-grade reports read from journal entries and journal lines.

This is the recommended direction.

### Why this is likely best for Studio OS

Studio OS users think in business terms:

```text
Invoice
Deposit
Payment
Credit Note
Refund
Voucher
Customer Credit
Remaining Balance
```

They do not naturally think in raw accounting terms:

```text
Account 1200
Debit AR
Credit Revenue
Journal Entry #847
```

The hybrid model preserves operational clarity while adding accounting correctness.

### Strengths

- Business workflows stay understandable.
- Existing invoice/payment/refund/credit flows remain meaningful.
- Journal entries become additive.
- Accounting reports can read from one canonical posting layer.
- Future GL reporting, trial balance, account activity, and liabilities become easier.
- This model avoids turning every operational workflow into raw accounting screens.

### Weaknesses

- Requires a posting layer.
- Requires a chart of accounts.
- Requires strict posting rules per document type.
- Requires accounting invariants and tests.
- Requires careful handling of voids/reversals/adjustments.

### Key Principle

Do not let the ledger replace operational documents.

Instead:

```text
Business documents are the source of operational truth.
Journal entries are the source of accounting truth.
Reports read from journal entries.
Operational UI reads from document/customer/order projections.
```

---

## Option C — Ledger-First Model

In this model, journal entries and journal lines are the primary source of truth. Everything else becomes a projection.

Conceptually:

```text
Journal Entries / Journal Lines / Accounts
    ↓
Invoices, Customer Balances, Order Financial Info, Reports
```

This resembles fintech/banking/Stripe Ledger-style systems more than traditional vertical SaaS workflows.

### Where Ledger-First Helps

Ledger-first can simplify certain stored-value and balance problems.

For example, customer credit can be represented as a liability account balance instead of a separate balance engine.

Customer credit granted:

```text
Dr Refund Expense / Contra Revenue / Clearing Account
Cr Customer Credit Liability
```

Customer credit redeemed:

```text
Dr Customer Credit Liability
Cr Accounts Receivable
```

Voucher sold:

```text
Dr Cash
Cr Voucher Liability
```

Voucher redeemed:

```text
Dr Voucher Liability
Cr Accounts Receivable
```

Balances are derived by summing account entries rather than updating stored balances.

This can reduce the need for custom balance logic for:

- Customer credit
- Gift vouchers
- Store credit
- Prepaid packages
- Membership balances
- Deposits
- Certain refund liabilities

### The Trap

A ledger does not replace business workflows.

Most Studio OS complexity is not pure accounting. It includes:

- Order pricing
- Album option changes
- Add-ons
- Package changes
- Order commits
- Composition snapshots
- Invoice generation
- Deposit requirements
- Workflow guards
- Staff-facing order state
- Customer-facing summaries

The accountant sees:

```text
Dr Accounts Receivable
Cr Revenue
```

But the business needs to know:

```text
Album size changed
Frame added
Customer picked 40 photos
Package upgraded
Deposit was required before confirmation
```

A ledger does not naturally encode those operational details in a user-friendly way.

### Risk

If Studio OS becomes ledger-first too early, the system may become over-abstracted and harder for staff workflows. Developers may still need to build the same business engines, plus a more complex accounting core.

The ledger can eliminate some balance engines, but it does not eliminate:

- Pricing engine
- Order commit engine
- Invoice generation engine
- Settlement/allocation rules
- Voucher business rules
- Workflow state rules
- Operational projections

---

# 4. Key Conclusion

The user’s instinct is correct:

> Accounting correctness/reporting is hard to achieve with a document-only system.

But the best answer is not necessarily ledger-first for the entire application.

The stronger architecture is:

```text
Order / OrderCommit
    ↓
Financial Documents
    ↓
Journal Entries
    ↓
Accounting Reports
```

In this design:

- Business documents remain the operational source of truth.
- Journal entries become the accounting source of truth.
- Reports read from journal lines.
- Operational views read from projections.
- The ledger is additive rather than a rewrite.

This gives Studio OS serious accounting correctness without forcing the entire business workflow to be modeled directly as accounting entries.

---

# 5. Why Adding a Ledger Later Can Be Additive

If the current financial-document architecture remains disciplined, adding a ledger later should be much simpler because it is mostly additive.

Current/future document flow:

```text
Order / OrderCommit
    ↓
Financial Documents
    ↓
Settlement / Allocations
```

Future accounting flow:

```text
Order / OrderCommit
    ↓
Financial Documents
    ↓
Settlement / Allocations
    ↓
Journal Entries / Journal Lines
    ↓
General Ledger Reports
```

The system would not need to rewrite:

- Order Commit
- Order pricing
- Invoice generation
- Deposits
- Credit notes
- Refunds
- Vouchers
- Customer credit
- Allocations
- Staff-facing operational UI

Instead, it adds:

```text
Account
JournalEntry
JournalEntryLine
Posting rules
Accounting reports
```

Example future service behavior:

```text
Invoice.finalize()
```

today:

```text
create invoice
lock invoice
```

future:

```text
create invoice
lock invoice
postJournalEntry(...)
```

Same business workflow. Additional accounting output.

---

# 6. Why the Lack of Existing Data Matters

Because there is no meaningful production data, Studio OS has a rare opportunity.

If journal entries are introduced later, there may be no need to backfill years of messy transactions.

If existing documents are few or test-only, then:

- Ledger tables can be added cleanly.
- Existing financial documents can be reposted or regenerated.
- No accountant reconciliation project is needed.
- No opening-balance import may be required.

This lowers the cost of adding a ledger significantly.

---

# 7. The Danger to Avoid Today

Even before a ledger exists, Studio OS should avoid building financial features as isolated balance engines.

Avoid:

```text
CustomerCreditBalance table updated by many services
VoucherBalance updated separately
Invoice.remaining updated separately
Customer.balance updated separately
```

Prefer immutable documents/events and derived balances:

```text
Credit document issued
Voucher issued/sold
Voucher redemption recorded
Payment recorded
Allocation recorded
Refund document issued
```

Then balances are derived from authoritative documents/postings.

The project should think in posting-event terms even before implementing a full GL.

---

# 8. Recommended Mental Model for Financial Events

Each finalized financial document should have a clear accounting meaning.

Do not think:

```text
Invoice modifies balance
Payment modifies balance
Credit modifies balance
```

Think:

```text
Invoice creates receivable
Payment settles receivable
Credit note reduces receivable
Refund returns value
Voucher sale creates liability
Voucher redemption consumes liability
Customer credit grant creates liability or reduces obligation
Customer credit redemption consumes liability
```

This makes later journal posting straightforward.

---

# 9. Example Posting Rules

These examples are simplified and assume no tax.

## 9.1 Final Invoice Issued

```text
Dr Accounts Receivable
Cr Revenue
```

## 9.2 Deposit Invoice Issued

Depending on business/accounting policy, deposit could be treated as either AR/revenue or deferred revenue. This should be investigated.

Possible simple treatment if invoice represents earned/recognized amount:

```text
Dr Accounts Receivable
Cr Revenue
```

Possible deferred treatment if deposit is prepayment before performance:

```text
Dr Accounts Receivable
Cr Deferred Revenue / Customer Deposits Liability
```

## 9.3 Payment Received

```text
Dr Cash / Bank / Payment Clearing
Cr Accounts Receivable
```

## 9.4 Credit Note Issued

```text
Dr Sales Returns / Contra Revenue
Cr Accounts Receivable
```

## 9.5 Refund Issued

If refund is against cash:

```text
Dr Refund Liability / Accounts Receivable / Customer Credit Liability
Cr Cash / Bank
```

Exact treatment depends on whether the refund is tied to overpayment, credit note, cancellation, or customer credit.

## 9.6 Customer Credit Granted

Possible treatment:

```text
Dr Sales Returns / Refund Expense / Contra Revenue / Clearing
Cr Customer Credit Liability
```

The debit side depends on why the credit was granted.

## 9.7 Customer Credit Redeemed

```text
Dr Customer Credit Liability
Cr Accounts Receivable
```

## 9.8 Gift Voucher Sold

```text
Dr Cash / Bank
Cr Voucher Liability
```

## 9.9 Gift Voucher Redeemed

```text
Dr Voucher Liability
Cr Accounts Receivable
```

or, depending on invoice timing:

```text
Dr Voucher Liability
Cr Revenue
```

if redemption and sale recognition happen at the same time.

## 9.10 Voucher Issued for Free / Promotional Voucher

This needs a separate policy.

Possibilities include:

```text
Dr Marketing Expense / Discount / Contra Revenue
Cr Promotional Voucher Liability
```

or no liability until redemption, depending on policy.

This should be investigated carefully.

---

# 10. Customer Credit and Voucher Design Implications

Customer credit and vouchers are the strongest reason to think about ledger compatibility now.

## 10.1 Customer Credit

Customer credit should probably not be built as an ad-hoc balance field.

It should be represented as an immutable financial instrument or document with applications/redemptions.

Important questions:

- Is customer credit refundable to cash?
- Can customer credit fund a new booking deposit?
- Can it be transferred between customers?
- Can it expire?
- Can it be partially redeemed?
- Is it created by refund flows, manual goodwill, cancellation, or overpayment?
- Does every credit issuance have a reason/source document?
- Does every redemption allocate to a target invoice/deposit/final balance?

## 10.2 Gift Vouchers

Prior discussion conclusions included:

- Vouchers are more like a settlement/payment instrument than general customer credit.
- A voucher may be assigned to a customer or left unassigned/null.
- It can be transferred if not yet redeemed/reserved for a booking.
- A voucher is for one order only.
- If a refund would otherwise go to the customer, and customer credit exists, it may go to customer credit instead of actual cash refund depending on policy.
- Voucher/customer-credit overlap should be discussed separately and carefully.

Important voucher questions:

- Is voucher value sold for cash or issued for free?
- Is it single-use only?
- Can it partially redeem?
- Can unused residual value remain?
- If one-order-only, what happens to leftover value?
- Can it pay a deposit at booking confirmation?
- Can it be reserved for an order before final redemption?
- Can it be transferred after reservation?
- Is it a liability before redemption?
- Does it expire?

## 10.3 Unified Stored Value Concept

A possible architecture is to avoid separate engines for customer credit, vouchers, promotional credit, refund credit, etc.

Instead introduce a unified concept such as:

```text
StoredValueInstrument
StoredValueApplication
StoredValueReservation
```

Types could include:

```text
CUSTOMER_CREDIT
GIFT_VOUCHER
PROMOTIONAL_CREDIT
REFUND_CREDIT
```

Each type has different rules, but shares a common value/application model.

This could later map naturally to liability accounts and journal entries.

However, this should not be overbuilt unless the repo investigation shows clear benefit.

---

# 11. Operational Views Should Be Projections

Even if accounting journals are added, staff/customer screens should remain readable.

Do not show raw journal lines by default.

Operational views should project ledger/document truth into readable summaries.

Example customer account view:

```text
Invoice issued: 160 KD
Payment received: 100 KD
Credit applied: 20 KD
Remaining: 40 KD
```

Order financial view:

```text
Deposit invoice: 20 KD, paid
Final invoice: 160 KD, partially paid
Adjustment: 100 KD
Credit note: 10 KD
Remaining: 90 KD
```

Accountant GL view:

```text
AR account activity
Revenue account activity
Cash account activity
Customer credit liability
Voucher liability
Trial balance
```

This separation matters:

- Operational truth answers “what happened to this order/customer?”
- Accounting truth answers “what was posted to each account?”

---

# 12. Reporting Implications

Without journal entries, reports may be built directly from invoices/payments/credits/refunds.

That can work for simple operational AR views, but accountant-grade reports become fragile.

Reports that should eventually read from journal lines:

- General ledger
- Trial balance
- Account activity by account
- AR control account
- Cash/bank movement
- Revenue reports
- Liability reports for vouchers/customer credit
- Period-close reports
- As-of-date balances

Reports that may remain document/projection based:

- Customer statement
- Order financial summary
- Staff payment status
- Invoice list
- Settlement/allocation history
- Customer account timeline

Important distinction:

```text
Accountant-facing financial truth should come from journal postings.
Staff-facing operational summaries should come from business-document projections.
```

---

# 13. Migration Difficulty Estimate

Because the system has no meaningful production data and no tax layer, migration is much easier than it would be later.

If the current document model remains disciplined, adding a basic internal double-entry layer later is likely a moderate task, not a rewrite.

Earlier rough estimate:

- Basic internal double-entry engine: approximately 2–6 focused engineering weeks.
- NetSuite/Oracle-style integration/accounting architecture: approximately 1–3 months depending on scope.
- Migration after years of ad-hoc financial shortcuts: potentially 6–12+ months.

These are rough architecture estimates, not commitments.

The main point: disciplined immutable documents now make future ledger addition largely additive.

---

# 14. Recommended Architecture Direction

Recommended path:

```text
Business documents are source of operational truth.
Journal entries are source of accounting truth.
Operational UI reads projections.
Accounting reports read journal lines.
```

Do not build a full GL as the first feature if it delays the core product too much.

But do design every financial feature so it has a clear future posting meaning.

The safe phased path:

## Phase 1 — Keep Financial Documents Disciplined

- Maintain immutable finalized invoices/credit notes/refunds/payments.
- Avoid mutable balance fields as source of truth.
- Centralize settlement/allocation rules.
- Ensure every financial document has type, status, posted/finalized date, financialCaseId/orderId/customerId, and audit metadata.

## Phase 2 — Design Vouchers and Customer Credit as Posting-Compatible Instruments

- Avoid isolated balance engines.
- Prefer immutable issuance/application/reservation records.
- Make rules explicit.
- Ensure every issuance/redemption can map to future accounting entries.

## Phase 3 — Add Journal Posting Layer

Add:

```text
Account
JournalEntry
JournalEntryLine
PostingRule / PostingService
```

Each finalized financial document posts exactly one or more balanced journal entries.

## Phase 4 — Build Accountant Reports from Journal Lines

- GL
- Trial balance
- Account activity
- AR control account
- Cash movement
- Liability reports

## Phase 5 — Optional External ERP Integration

Studio OS remains operational source of truth.

External accounting system receives exported/synced accounting documents or journal entries.

```text
Studio OS
    ↓
Accounting Export Layer
    ↓
NetSuite / Oracle / Dynamics / Xero / QuickBooks / etc.
```

---

# 15. Things Codex/Claude Should Investigate in Current Code

The repo investigation should answer these questions.

## 15.1 Current Financial Source of Truth

- What tables currently represent invoices, payments, credit notes, refunds, allocations, and financial cases?
- Which fields are canonical vs derived?
- Are balances stored, derived, or both?
- Is `remaining` calculated consistently from documents/allocations?
- Are there multiple competing balance calculations?

## 15.2 Immutability and Locking

- Are finalized invoices immutable?
- Are credit notes/refunds immutable once finalized?
- Can any service mutate historical finalized financial records?
- Are post-lock changes forced through adjustment/credit/refund flows?
- Are there guardrails preventing direct mutation after invoice lock?

## 15.3 Settlement and Allocation Logic

- Where is settlement logic centralized?
- Are allocations first-class records?
- Can payments, credit notes, vouchers, or future credits allocate to specific invoices?
- Is allocation logic duplicated in UI or services?
- Are there edge cases where invoice remaining is recomputed differently in different places?

## 15.4 Reporting Logic

- Which current pages/reports derive financial case summaries?
- Do accountant-facing pages read from operational projections or financial documents?
- Is there already an AR-document register style view?
- Are reports as-of-date capable?
- Are reports period-aware?
- Are reports reconstructible from immutable history?

## 15.5 Voucher and Customer Credit Readiness

- Are there existing concepts that could support stored value?
- Would planned voucher/customer-credit features require separate balance engines?
- Can current settlement logic support non-cash instruments?
- Can credit/voucher redemption fund a booking deposit at confirmation?
- Are deposit confirmation guards compatible with non-cash settlement?

## 15.6 Journal Layer Additivity

- Could a `JournalEntry` / `JournalEntryLine` layer be added without rewriting existing flows?
- Which existing finalize/lock/post services would be natural posting hooks?
- Are there clear document lifecycle events where journal entries should be emitted?
- Are financial documents stable enough to post from?
- What schema additions would be needed?

## 15.7 Hidden Coupling Risks

- Does UI recompute financial truth?
- Are there compatibility fallbacks that obscure canonical logic?
- Are financial calculations duplicated across modules?
- Is accountant-facing truth mixed with staff-facing operational summaries?
- Are financial document statuses explicit enough?

---

# 16. Recommended Codex Investigation Prompt

Recommended model: **Codex GPT-5.5 High**.

Why: This is financial architecture and invariant-sensitive repository analysis. It touches schema, service boundaries, reporting logic, and future migration risk. A lower-tier model may miss hidden coupling or duplicate financial calculations.

Prompt:

```text
You are investigating the Studio OS financial architecture for future accounting correctness and possible double-entry ledger support.

Read this document fully, then inspect the current repository against it. Do not implement changes yet. Produce a detailed architecture review and recommendation.

Primary question:
Can Studio OS add a real accounting layer later as an additive journal-posting layer on top of current financial documents, or does the current code contain architectural problems that would make that difficult?

Context / desired direction:
- Business documents should remain the source of operational truth.
- Journal entries should become the source of accounting truth if/when GL is added.
- Operational UI should read projections, not raw GL lines.
- Accountant-grade reports should eventually read journal lines.
- Financial records should be immutable once locked/finalized.
- Post-lock changes should use adjustment/credit/refund/customer-credit/voucher flows, not mutation of historical invoices.
- Avoid scattered balance mutation engines.
- Vouchers and customer credit should be designed so they map cleanly to future liability accounts and journal postings.

Investigate and report:

1. Current financial model
   - Identify relevant Prisma models/tables for invoices, payments, credit notes, refunds, allocations, financial cases, order commits, and any document register/reporting models.
   - Explain what is canonical vs derived.
   - Identify where remaining balances and financial case summaries are calculated.

2. Immutability and lifecycle
   - Determine whether finalized/locked invoices and other financial documents are truly immutable.
   - List services that can mutate financial records after lock/finalization.
   - Identify guardrails and gaps.

3. Settlement/allocation engine
   - Identify where settlement/allocation logic lives.
   - Check whether it is centralized or duplicated.
   - Determine whether it can support non-cash instruments like customer credit and vouchers.
   - Specifically check whether non-cash value could fund a booking deposit at confirmation without violating current deposit-paid guards.

4. Reporting/accounting correctness
   - Identify current accountant-facing reports/pages/services.
   - Determine whether they read from immutable financial documents or recompute from operational state.
   - Identify reports that would become fragile without journal entries.
   - Identify whether as-of-date reporting is currently possible.

5. Ledger additivity
   - Determine whether adding Account, JournalEntry, and JournalEntryLine models would be mostly additive.
   - Identify natural posting hooks, such as invoice finalization, payment receipt, credit note finalization, refund issue, voucher sale/redemption, and customer credit issue/redemption.
   - Identify places where current design would need refactoring before posting can be safe.

6. Voucher/customer credit design impact
   - Review current/planned architecture for vouchers and customer credit if present in docs/code.
   - Recommend whether they should be separate engines or a unified stored-value/instrument model.
   - Explain how each would map to future accounting liabilities.

7. Risks and recommendations
   - Give a clear GO / NO-GO / CONDITIONAL recommendation for continuing document-first with future additive ledger.
   - List blocking issues, if any.
   - List non-blocking cleanup tasks.
   - Propose a phased plan with small PRs.

Required output format:

# Executive Summary
# Current Architecture Findings
# Immutability / Locking Findings
# Settlement / Allocation Findings
# Reporting Findings
# Ledger Additivity Assessment
# Voucher / Customer Credit Implications
# Risks
# Recommended Phased Plan
# Acceptance Criteria for Future Ledger Readiness
# Open Questions

Do not implement. This is investigation only.
Cite exact files, functions, and line numbers wherever possible.
Be critical. Do not just agree with the proposed architecture.
```

---

# 17. Acceptance Criteria for Ledger Readiness

Studio OS is ledger-ready if these are true:

1. Every finalized financial document is immutable.
2. Every financial effect has a durable source document.
3. Balances can be derived from documents/allocations, not mutable counters.
4. Settlement logic is centralized in services, not UI.
5. Accountant-facing reports do not depend on operational state that can change after posting.
6. Documents have explicit lifecycle states.
7. Credit notes/refunds/adjustments are used instead of editing historical invoices.
8. Customer credit and vouchers have issuance/application records, not only balance fields.
9. There are clear lifecycle hooks where journal entries can be posted exactly once.
10. Posting can be made idempotent and auditable.
11. Future journal entries can be linked back to source documents.
12. Operational projections can be rebuilt from source documents/postings.

---

# 18. Open Questions

These need further discussion or repo investigation.

1. Should deposits post to revenue immediately or to deferred revenue/customer deposit liability?
2. Should vouchers be treated strictly as liabilities until redemption?
3. Should free/promotional vouchers create liability at issuance or only accounting impact at redemption?
4. Can customer credit pay booking deposits at confirmation?
5. Can vouchers pay booking deposits at confirmation?
6. Should customer credit and vouchers share a unified stored-value model?
7. How should one-order-only voucher residual value be handled?
8. Should customer credit be refundable to cash?
9. Should customer credit be transferable?
10. What is the exact accountant-facing document register layout?
11. Which reports must be document-based vs journal-based?
12. Should the first accounting feature be internal GL tables or just posting-compatible financial events?
13. Should Studio OS eventually export summarized journals or individual source documents to external accounting software?

---

# 19. Final Recommendation

The user is not overcomplicating things by worrying about accounting correctness.

Accounting correctness and reporting are genuinely hard to achieve with a document-only financial system if the system grows.

However, the safest architecture is not to make raw GL entries the only source of truth for the whole application.

The recommended architecture is:

```text
Business documents = operational truth
Journal entries = accounting truth
Operational projections = staff/customer readability
Accounting reports = journal-line based
```

This makes the future ledger additive if current financial documents remain disciplined.

The immediate priority is not necessarily to build the full ledger now. The immediate priority is to ensure every new feature, especially vouchers and customer credit, is designed as immutable, posting-compatible financial documents/instruments rather than isolated mutable balance engines.

If Codex finds that the current code already has centralized immutable documents and centralized settlement, then adding a GL later should be a relatively clean additive project.

If Codex finds scattered financial calculations, mutable balances, UI-side financial truth, or unclear document lifecycles, those should be cleaned up before vouchers/customer credit become deeply integrated.
