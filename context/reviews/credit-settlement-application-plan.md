# Credit Settlement Application — Plan & Investigation

> Status: **B1 removing-side settlement implemented. B2 adding-side available-credit
> consumption implemented.** B3 canonical settlement projection remains pending.
> This is a **prerequisite for Phase 7** (the Sales redesign's financial summary
> cannot be honest without it). Does **not** reopen the OrderCommit financial math.

---

## 1. Origin — the bug that started this

Scenario that exposed the gap:

1. Order: `Basic 150 + Extra Photos 10 = 160`. Customer pays 160. FINAL invoice
   settled + locked.
2. Later OrderCommit: `Upgrade Basic→Standard +100`, `Remove Extra Photos −10`.
   Net `+90`. Preview correctly shows **Amount Due 90**.
3. After commit the engine emits:
   - `ADJUSTMENT +100`
   - `CREDIT_NOTE 10` (for the removed photos)
4. The Sales sidebar then shows **Remaining 100**, not 90.

The customer should owe `250 − 160 = 90`. The screen says 100. The missing 10 is
the credit note that has nowhere useful to go.

---

## 2. What we found (current behavior — verified in code)

This is **not** a math bug, a document-emission bug, or a credit-note-targeting
bug. Every document is individually correct. The gap is a missing **settlement
link** between documents.

### 2.1 The primitive already exists — `DocumentApplication`

`prisma/schema.prisma` → `model DocumentApplication`:
`sourceInvoiceId → targetInvoiceId`, optional `targetInvoiceLineId`,
`amountApplied`, `notes`. It is fully wired:

- **Written** at credit-note emission (`invoice.service.ts`), deposit→final, etc.
- **Read in the canonical balance math** — `computeEffectivePaidFromAllocations`
  (`invoice.calculation.ts`) adds `sum(documentApplications where targetInvoiceId =
  X)` into invoice X's effective-paid. So a credit applied to an ADJUSTMENT really
  does reduce that adjustment's remaining.
- **Guarded by invariants** (`src/modules/financial/invariants.ts`).

### 2.2 Credit notes are immutable, fully-applied at birth

`createCreditNoteWithClient` (`invoice.service.ts`) creates the credit note with
`status: CLOSED`, `isLocked: true`, `remainingAmount: 0`, and **immediately**
writes a `DocumentApplication` for its full amount. A credit note is **not** a
drainable wallet — it is a permanent receipt: "this much credit was created, and
here is exactly where it went." It is never updated afterward.

### 2.3 Emission already routes credit two ways — but only by matching *cause*

`routeCreditNoteCandidate` (`order-commit-financial-emission.service.ts`) sends each
negative (credit) line to one of:

- **`adjustmentReversals`** → a line-targeted `DocumentApplication` against an open
  **ADJUSTMENT** line that shares the **same** `causeOrderEntityKind:causeOrderEntityId`.
- **`creditNoteFinalLines`** → residual credit note parented to **FINAL**.

`buildOpenAdjustmentLineMap` (`invoice.service.ts`) only returns lines from
`invoiceType: ADJUSTMENT`, keyed by cause. **Original FINAL lines are never reversal
targets.**

### 2.4 Why the 10 strands

- Removed photos → cause `EXTRA_PHOTO:*`. Those photos lived on **FINAL**, so there
  is no open ADJUSTMENT line with that cause → no reversal → residual → credit note
  on FINAL.
- The `+100` upgrade is a **different** cause (`PACKAGE_TIER_UPGRADE:*`), so the
  routing correctly **refuses** to net the photo credit into it.

That refusal is **correct** — netting unrelated causes would falsely claim "the
upgrade receivable shrank," which is an audit lie. Cause-scoping protects document
truth.

### 2.5 Leftover credit = overpayment on FINAL (not a stored balance)

When residual credit lands on FINAL, it pushes FINAL into an *overpaid* state.
`computeOverpaymentCapacity` (`invoice.service.ts`) =
`effectivePaid − totalAmount − priorRefunds`. That number is the refundable credit.
There is **no stored "available credit" field** — it is computed from documents.

### 2.6 The same gap repeats across commits

`positiveDeltaPreview` (`order-commit-approval-document-preview.service.ts`) computes
`amountDue = netDelta` and **ignores `overpaymentCapacity` entirely**. So if a
customer already has leftover credit and a *later* commit adds cost, the system asks
for full payment and leaves the old credit sitting separately. Today you'd have to
**refund, then collect again** — or leave the customer simultaneously *owed* and
*owing*. Same root cause as §2.4, stretched across commits.

---

## 3. Root cause (one sentence)

> Credit sitting on one document (FINAL) has no mechanism to flow over and settle an
> open receivable elsewhere in the same case — within one commit **or** across
> commits — except when the credit shares the exact same *cause* as the receivable.

The storage primitive (`DocumentApplication`) and the balance math already support
it. What is missing is a **second kind of application** (settlement, not
cause-reversal), the **invariant** that permits it, and the **canonical projection**
that surfaces the result.

---

## 4. The design — "settlement application"

A new *kind* of `DocumentApplication`, distinct from the existing cause-reversal:

| | cause-reversal (exists) | settlement application (new) |
|---|---|---|
| target | ADJUSTMENT **line** | ADJUSTMENT **invoice** (not a line) |
| meaning | the receivable was amended (line truly shrank) | the receivable **stands**; pre-existing credit settled it |
| audit reads | "upgrade line reduced by 10" | "upgrade still 100; 10 of credit applied toward it" |

This dissolves the auditability dilemma: the receivable keeps its full value, and a
separate explicit row records that credit was used to settle it. Both facts visible.

### Application order at commit (greedy, deterministic)

```
credit produced / available
  → cause-matched reversal     (same-cause ADJUSTMENT lines)        [exists]
  → settlement application     (other open receivables, same case)  [NEW]
  → leftover = overpayment     (sits available on FINAL)            [exists]
```

Reuse the existing oldest-`invoiceSeq`-first ordering when consuming multiple open
receivables.

### The adding side must consult existing credit too

`positiveDeltaPreview` / emission must, **before** asking for cash, soak up existing
available credit (overpayment) and only request the difference. This is what makes
the across-commit case (§2.6) work with the same mechanism.

---

## 5. Locked behavioral decisions

1. **Auto-apply, no button.** Settlement happens automatically at commit time, in
   the same transaction that emits the adjustment + credit note. (UI never assembles
   financial meaning; it renders a fully-settled graph.)
2. **Forward-only.** No migration of existing data (current data is dev/testing).
3. **Document-backed, not a wallet.** "Available credit" is always *computed* from
   real documents + explicit application rows. Never a stored mutable balance.
4. **Order/case-scoped.** Credit applies within the same order/FinancialCase. It is
   **not** a customer-wide store-credit wallet that travels across unrelated orders.
   (That would be a separate, larger design.)
5. **Both directions.** Settlement runs on the removing side (credit cancels open
   receivables; **implemented in Spec 154 B1**) **and** the adding side (existing credit
   reduces new amount due; **implemented in Spec 155 B2**).
6. **Leftover sits available.** Credit with nothing to cancel against does **not**
   auto-refund. It sits as visible, flagged available credit (overpayment), and can
   be consumed by a future commit.
7. **Refund is the manual exit door.** Staff issue a refund when they judge the order
   is settled. That is the only way credit leaves the order. (Revises an earlier
   "leftover = refund immediately" lean — "let it sit" is the chosen default.)
8. **Immutable + offsetting records.** A settlement application is permanent once
   written — never edited or deleted. If a later commit invalidates it, the system
   writes a **new offsetting record**, leaving both visible. History reads forward,
   never rewritten. (Same rule as locked credit notes / invoices.)
   - **Case the spec must handle:** a later commit that *cancels the very receivable*
     a settlement was applied to. Expected resolution: cancelling the receivable emits
     its own full-value credit, and the previously-applied amount returns to "available"
     via a new offsetting record (not by touching the original). Net customer position
     stays correct; every step on paper.
9. **Leftover credit = a drawable credit-note pool** (chosen representation). A credit
   note's **amount is immutable and dated at issue**, but it carries an **unapplied
   balance** (`Remaining`) drawn down by append-only applications until fully applied or
   refunded. `Available credit` = **sum of unapplied credit-note balances**. Chosen over
   parking leftover as FINAL overpayment because it (a) keeps credit distinct from cash,
   (b) surfaces the liability instead of burying it in a closed invoice, and (c) makes
   across-commit reuse a single append — no "move the credit" gymnastics. Validated as
   the cleaner **month-end / accountant** model (immutable dated documents + immutable
   dated applications; cross-period activity is always new events, never edits to closed
   periods).
   - **Guardrails:** (a) **lock the *amount*, not the application set** — "amount final"
     ≠ "fully applied". (b) applications immutable / dated / append-only. (c) an open
     credit note **reports as an outstanding credit liability**. (d) **available balance
     is DERIVED** (`total − Σ applications`), not a stored/mutated field — the credit-note
     row is **write-once** after issue, mirroring how invoices derive effective-paid; an
     optional `remainingAmount` cache may exist for read speed but the derived value is the
     truth. (Architecture review confirmed. Owner confirmed they want to **carry** credit,
     not auto-refund leftover — so the drawable pool stays; the simpler "always refund"
     model is rejected.)
   - **Cost (engineering, not accounting):** changes credit-note lifecycle + the
     invariants that currently assert "fully applied at birth" (`invariants.ts`,
     `createCreditNoteWithClient`). No financial *math* changes.
10. **Spendable credit is overpayment-backed (refines #6/#9).** The unapplied
    credit-note pool (`Σ total − Σ applications`, decision #9) is the *document
    representation* of reductions — it is **not**, by itself, spendable credit. Credit
    becomes **spendable / refundable only to the extent the customer has paid more cash
    than the net order is worth**:
    `availableCredit = max(cashPaid − netCustomerTotal, 0)`
    (equivalently `max(effectivePaid + unappliedPool − grossCharges, 0)`).
    A removal on an **unpaid** order reduces the bill (lowers `netCustomerTotal`); it does
    **not** mint phantom credit that can zero-out a later addition. Letting the raw pool
    offset a future add (as Spec 155 B2 shipped) double-counts the same reduction and
    under-collects. **B1 removing-side settlement is unchanged** — netting additions
    against removals via the sweep is correct; this rule governs only the **adding-side**
    consumption of *prior* credit. (Locked 2026-06-09; corrects the B2 adding-side basis,
    see Spec 157 · B2C.)
11. **Two financial-owned summaries; Sales renders, never assembles (refines #1).** The
    financial module owns *all* balance meaning and exposes it as **two** read contracts,
    both under `src/modules/financial-cases/`:
    - **Customer-facing settlement summary** (receipt-style) — single-meaning, net,
      customer-readable: `netCustomerTotal`, `cashPaid`, `remainingDue`,
      `availableCredit`/`refundable` (overpayment, decision #10), plus draft fields.
      Uses **net presentation (model A)**: a credit note reduces `netCustomerTotal`
      (`grossCharges − creditsIssued`); the order itself became smaller — the customer
      does **not** hold the gross amount plus a separate credit.
    - **Accounting / document summary** — the document-level detail (FINAL / ADJUSTMENT /
      CREDIT_NOTE / DocumentApplication / effective-paid / open per-invoice balances).
      This is the financial-documents **register** plan (separate), not the receipt card.
    `FinancialCaseSummary` stays the low-level/accounting base. Neither the Sales nor the
    OrderCommit projector may derive financial meaning from raw fields — they **render**
    the financial-owned summary verbatim. (Locked 2026-06-09; see Spec 156 · B3.)

### 5.1 B1/B2 implementation status

Spec 154 B1 implemented the removing side: residual OrderCommit credits create a
FINAL-parented credit note without a new `CREDIT_TO_FINAL` application, then append
invoice-targeted `SETTLEMENT` applications to same-order open ADJUSTMENT receivables
oldest-first. If no receivable is open, or credit exceeds receivables, the unapplied
remainder stays available by the derived credit-note pool (`total − Σ applications`).

Spec 155 B2 implemented the adding side: `FinancialCaseSummary.availableCaseCredit`
derives the same-case CREDIT_NOTE pool total, positive-delta OrderCommit previews consume
that credit before cash, and locked document-emitting commits run one shared end-of-commit
available-credit sweep so pure additions and B1 residual credits settle through the same
`SETTLEMENT` path.

**Implemented (Spec 157 · B2C):** B2 shipped consuming the *raw unapplied pool*
(`availableCaseCredit`) as spendable credit in `positiveDeltaPreview`. Per locked decision
#10 that was wrong — spendable credit must be **overpayment-backed**. B2C repointed the
adding-side preview onto the financial-owned customer-settlement figures (overpayment-based
`availableCredit` + model-A `remainingDue`), so phantom removal-credit on an unpaid order no
longer offsets a later addition. The shared sweep (document-level) is unchanged.

**Order of remaining work:** 156 · B3 (receipt-style customer summary contract + Sales
repoint) is next, because its draft `amountDueAfterCommit` consumes B2C's corrected preview.

### Customer-facing effect

Behaves like store credit *within an order* — convenient, automatic — but backed by
a paper trail instead of a trust-me balance.

---

## 6. Open questions (still to discuss)

- ~~**Reversibility / immutability.**~~ **RESOLVED** → locked decision #8 (immutable +
  offsetting records).
- ~~**Canonical settlement projection.**~~ **RESOLVED** → see §6.1.
- **Owner policy confirmations** — none outstanding for the behavior above, but the
  customer-wide store-credit question (decision #4) should be confirmed as out of scope.

### 6.1 Canonical settlement projection (Sales-facing) — RESOLVED

One canonical set of numbers, each with exactly one meaning, that always reconcile.
This is the **customer-facing settlement summary** of decision #11 — a financial-owned
read contract (`src/modules/financial-cases/`). Sales **renders** these; it never
assembles them. Two display modes (consistent with the rest of the editable POS surface —
live preview while a draft exists, last committed snapshot when clean).

**Definitions (model A — net; decision #10/#11):**
- `netCustomerTotal = grossCharges − creditsIssued` — value of everything currently owned
  (a removal shrinks this; the customer does not hold gross + a separate credit).
- `cashPaid` — net cash actually received (payments − refunds); **excludes** credit
  applied to documents.
- `remainingDue = max(netCustomerTotal − cashPaid, 0)` — what's still to collect. Computed
  from net and cash, **not** from raw document open-balances (which overstate by any
  unapplied credit that can't land on FINAL).
- `availableCredit` / `refundable = max(cashPaid − netCustomerTotal, 0)` — overpayment-
  backed; one figure, two affordances (spend on a later add, or refund). **Only present
  when `> 0`.**

**Clean state (no draft):** `netCustomerTotal`, `cashPaid`, `remainingDue`,
`availableCredit`/`refundable` (only when overpaid).

**Draft state (pending change):** `previousTotal`, `pendingDelta`, `afterCommitTotal`,
`amountDueAfterCommit` (the B2C-corrected figure: `max(pendingDelta − availableCredit, 0)`
with overpayment-backed `availableCredit`).

**Reconciliation identity:** `netCustomerTotal − cashPaid = remainingDue − availableCredit`
(positive → owe, negative → owed-back). Never both, never a negative remaining.

**Customer-in-credit presentation — decision (A): split, positive numbers.**
When the shop owes the customer, show `remainingDue: 0` **+** a separate, clearly labelled
`availableCredit`/refundable line. Money owed *to* the customer is its own line and its own
action (refund) — never shown as a negative remaining. Rejected (B): a single signed
balance that goes negative; rejected: showing gross total + a standing credit line.

**Out of this contract (accounting/document detail — decision #11, register plan):**
FINAL / ADJUSTMENT / CREDIT_NOTE rows, `DocumentApplication`s, `effectivePaid` / `paidSoFar`,
per-invoice open balances, gross `customerTotal`, raw `overpaymentCapacity` /
`creditNoteCapacity` / `availableCaseCredit` pool. The financial module uses these to
*derive* the receipt fields; the receipt card never shows them.

---

## 7. Code hook points (for the eventual spec)

- `prisma/schema.prisma` → `DocumentApplication` (add a kind/flag to distinguish
  settlement from cause-reversal; settlement targets invoice, not line).
- `src/modules/order-commits/order-commit-financial-emission.service.ts` →
  `routeCreditNoteCandidate` (add settlement step after reversal, before residual).
- `src/modules/order-commits/order-commit-approval-document-preview.service.ts` →
  `positiveDeltaPreview` (consult `overpaymentCapacity` before `amountDue`).
- `src/modules/invoices/invoice.service.ts` → `buildOpenAdjustmentLineMap`,
  `computeOverpaymentCapacity` (source of available credit + open receivables).
- `src/modules/invoices/invoice.calculation.ts` →
  `computeEffectivePaidFromAllocations` (already nets `DocumentApplication`; settlement
  rows flow through unchanged).
- `src/modules/financial/invariants.ts` → permit the new settlement-application shape;
  add invariant that total settlement applications never exceed available case credit.
- Canonical projection feeding the Sales right column (new) — consumed by Phase 7.

---

## 7.1 F1 foundation — verified investigation findings

Code-read pass to nail down the drawable-pool foundation before drafting F1.

**DB layer already permits it.** The locked-invoice trigger
(`reject_frozen_field_mutation_on_locked_invoice`,
`20260516020000_invoice_lock_snapshot_and_immutability`) freezes only identity/amount
fields (`totalAmount, invoiceType, parentInvoiceId, financialCaseId, jobId, orderId,
invoiceNumber, publicId`). It does **not** freeze `remainingAmount`, `status`, or
`isLocked`. → A credit note can stay `isLocked:true` (amount frozen) while
`remainingAmount`/`status` draw down. **No trigger migration; no new column for the
balance.**

**Credit-note creation today** (`createCreditNoteWithClient`): born `CLOSED /
isLocked:true / remainingAmount:0`, full-amount `DocumentApplication` written
immediately. F1 change: `remainingAmount = total − sum(applications at creation)`;
`status = CLOSED` only if fully applied else `ISSUED`; keep `isLocked:true`; later
draw-downs update `remainingAmount` and close at zero.

**Foundational data change — add a `kind` discriminator to `DocumentApplication`**
(e.g. `CAUSE_REVERSAL / SETTLEMENT / DEPOSIT / ORIGIN`). Invariants today distinguish
application types *by shape* (line-targeted = reversal, single-to-parent = residual);
settlement (invoice-targeted to an ADJUSTMENT) breaks shape-based detection, so an
explicit kind is required. **F1 owns this** (lifecycle + discriminator + invariant
rework); F2/B1 emit using it.

**Invariant impact (all 24 read):**
- *Pass unchanged:* `credit-note-is-locked-on-issuance`, `credit-note-targets-final`
  (parent stays FINAL = origin), `credit-note-amount-not-over-final`,
  `document-application-not-over-source` (per-row), `paid-adjustment-line-removal-
  must-have-reversal`.
- *HARD BLOCKER — must widen:* **`adjustment-has-no-document-application` (l.487)** —
  rejects any application touching an ADJUSTMENT except the line-targeted CREDIT_NOTE
  reversal. Invoice-targeted settlement (`source=CREDIT_NOTE, target=ADJUSTMENT,
  line=NULL`) is currently **forbidden**; widen the exception to the new SETTLEMENT kind.
- *Must generalize:* **`credit-note-has-document-application` (l.752)** — drop "exactly
  fully applied, parent-or-line" shape; allow partial application + invoice-targeted
  settlement. **`classifier-reductions-have-matching-credit-note` (l.990)** — requires a
  FINAL application; a settlement credit applies to an ADJ instead → require "≥1 valid
  application + source activity."
- *Must add:* **pool integrity** `sum(applications from a credit note) ≤ its total` (the
  l.190 guard is per-row only); **derived-field integrity** `remainingAmount = total −
  sum(applications)`.

**Carry-forward to B1 (not F1):** `computeCreditNoteCapacityForFinal` caps new credit
notes by summing CN→FINAL applications; once settlement routes credits to ADJ, that
cap's meaning loosens — revisit in B1.

**F1 verdict: drafting-ready.** Bounded, DB-safe, invariant surface fully mapped.

## 8. Relationship to Phase 7

Hard prerequisite for the redesigned financial summary (right column:
paid / remaining / deposits / total / pending diff). That column must render a
canonical balance, not net unrelated documents in the read layer. Sequence: land this
settlement foundation **before** Phase 7's financial-summary pieces. The rest of
Phase 7 (Albums, Notes, shell, composition rows) is independent.
