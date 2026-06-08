# Financial Documents Register — Presentation Spec (Accountant-facing)

> Status: **PLANNING — presentation/UX spec.** Covers the existing global
> invoices-list page (all orders + all customers), intended for accountants.
> **Non-goal:** re-architecting storage. Documents stay one `Invoice` table + `type`;
> this spec changes **labeling, grouping, signing, and subtotals only.**
> Separate from `credit-settlement-application-plan.md` (different surface).
> A real **reporting page** (period rollups, AR aging, revenue) is a **later, separate
> project** — this spec only makes the raw register *visually correct*.

---

## 1. The core problem

The page lists deposits, invoices, adjustments, credit notes, and refunds as
homogeneous rows under one label ("Invoice", "Invoice Number"). The eye treats them as
the same thing and tries to **sum the column** — which always produces nonsense:

- `Deposit 20 + Final 160` reads like **180** billed. Wrong — a deposit is a
  prepayment, not extra revenue. Customer was billed **160**.
- `Credit note +10` reads as a charge. It's a **credit**; it should subtract.
- `Credit note −10 + Refund −10` reads like **−20** owed to the customer. Wrong — that's
  **one 10** of value seen at two stages (credit issued, then refunded as cash). They
  *consume* each other; they don't add.
- "Settled" blends **cash** and **applied credit** into one ambiguous column.

Root cause: **these are different financial instruments forced under one "invoice"
name, on one undifferentiated list.**

---

## 2. The reframe — financial documents, not invoices

These are **five different document types on two different ledgers**:

| Document | What it really is | Ledger |
|---|---|---|
| Deposit | Prepayment request (liability) | Billing / AR |
| Final, Adjustment | Charge — money owed to you | Billing / AR |
| Credit note | Reduction of a charge (non-cash) | Billing / AR |
| **Refund** | **Cash going out** | **Cash journal** |
| Payment | Cash coming in | Cash journal |

- **A refund is not an invoice.** It's a cash disbursement. Listing it as a negative
  "invoice" is a category error and the reason it reads wrong next to a credit note.
- Accountants keep the **billing/sales register** and the **cash journal** as separate
  books precisely so credits (billing) and refunds (cash) never cross-add.

**Implication:** rename the surface to **"Financial Documents"**, label the ID column
**"Document No."** (IDs already encode type: `DEP / INV / ADJ / CN / REF`), and split —
or at least section — **billing documents** from **cash movements**.

---

## 3. The 8 conventions for a correct register

1. **Sign by direction.** Charges positive; **credit notes and refunds negative**, shown
   in parentheses `(10.000)` or red.
2. **Type is a first-class column** (badged), and **never total across unlike types**.
3. **Split cash from credit from outstanding.** Replace the single "Settled" with:
   *Amount* | *Paid (cash)* | *Credit applied* | *Outstanding*.
4. **Deposits classed as prepayments**, excluded from the invoiced/revenue subtotal
   (fixes the 180 misread).
5. **Subtotals by class in a footer — the system nets, the eye never does.** No grand
   total across types.
6. **Show consuming/applied links** — what a credit/deposit was applied to; what a refund
   draws down. Documents reference each other; make it visible.
7. **Tabular alignment** — right-aligned, consistent decimals, negatives visually
   distinct. Accountants read down a column by alignment.
8. **Status vocabulary they use** (Draft / Issued / Paid / Void). "Locked Yes/No" is
   internal engineering jargon — accountants think "posted/final", not "locked".

### The golden rule

> **Never sum across document classes — they reference and consume each other.**
> Subtotal *within* a class; credit notes net within billing, refunds net within cash,
> and the two ledgers never cross-add.

---

## 4. Before → after (same four documents)

**Before (invites 180; credit reads +; cash/credit blended):**

| Invoice | Total | Settled | Remaining | Status | Locked |
|---|---|---|---|---|---|
| DEP-00001 | 20 | 20 | 0 | Closed | Yes |
| INV-00002 | 160 | 160 | 0 | Closed | Yes |
| ADJ-00003 | 100 | 10 | 90 | Issued | No |
| CN-00004 | 10 | 10 | 0 | Closed | Yes |

**After (signed, typed, cash/credit split, subtotaled):**

| Document | Type | Amount | Paid (cash) | Credit applied | Outstanding | Status |
|---|---|---|---|---|---|---|
| DEP-00001 | Deposit | 20.000 | 20.000 | — | 0.000 | Paid |
| INV-00002 | Final | 160.000 | 140.000 | 20.000 *(deposit)* | 0.000 | Paid |
| ADJ-00003 | Adjustment | 100.000 | — | 10.000 *(CN-00004)* | 90.000 | Issued |
| CN-00004 | Credit note | **(10.000)** | — | applied → ADJ-00003 | — | Closed |
| **Subtotals** | | **Invoices 250.000** · **Deposits 20.000** | **Cash 160.000** | **Credit 10.000** | **Receivable 90.000** | |

---

## 5. Interaction with the drawable-pool model

(From `credit-settlement-application-plan.md` decision #9.) A credit note carries an
**unapplied balance** = available credit. In this register that means:

- A credit note's **Outstanding column = its unapplied credit** (the drawable remainder),
  **not** an amount owed *by* the customer. Label carefully so `Remaining 50` on a credit
  note never reads as "customer owes 50."
- An **open credit note** (unapplied balance > 0) appears as an **outstanding credit
  liability** — visible, not buried.
- A **refund draws down** a specific credit note's pool — show that link (convention #6).

---

## 6. Open question for the accountant

Footer netting: show **net invoiced (250 = 160 + 100 − 10)**, or **gross invoiced (260)
with credits (−10) as a separate subtotal line**? Both are valid; it's a reading
preference. Confirm which the business's accountant reads more naturally.

---

## 7. Scope guardrails

- **Presentation only.** No change to the `Invoice` model, types, numbering, or the
  financial engine.
- **This page = raw register** (audit/journal). It is **not** the per-order customer
  balance (that's the Sales settlement summary) and **not** the month-end reports
  (separate future project).

---

## 8. Deferred in from the settlement arc (2026-06-09)

**Generalized invoice-detail application breakdown** (floated as "B5", explicitly deferred
here to keep settlement Spec 158 · B4 a pure service-layer correctness fix).

Today `app/invoices/[id]/page.tsx` renders a "Financial Breakdown" card **only for FINAL**
(`invoiceType === "FINAL"`), and it only itemizes the **deposit** (`Deposit credited
(DEP-xxxxx) −20`). So an ADJUSTMENT settled by credit shows correct totals (after B4:
`Settled 10 / Remaining 90`) but **no line explaining the 10 came from `CN-xxxxx` via a
`SETTLEMENT`**.

Register work should generalize this: one read-layer breakdown component that lists **every**
`DocumentApplication` on **any** charge invoice — deposit, settlement, cause-reversal — as
labelled lines (`Settlement credit applied (CN-xxxxx) −10`, etc.), sourced from the document
graph. Presentation only; no engine/model change. Numbers are already correct post-B4 — this
adds the *why*.
