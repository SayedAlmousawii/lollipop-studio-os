# Reversal Credit & Refund Model — Architecture Decision (A / B / C′)

> **Status: DECISION RECORD — architecture, not an implementation spec.**
> Selects target model **C′** (origin-partitioned hybrid) with **Option 1**
> (unified drawable-credit instrument + origin tag; collapse the application taxonomy).
> Follows the completed settlement arc (`credit-settlement-application-plan.md`, F1–B4).
> Implementation spec(s) to be written separately against this record.

---

## 1. Problem this decides

The settlement arc (F1 #232, B1 #233, B2 #234, B2C `5fdcb3e`, B3 #236, B4 #237) fixed
credit-note settlement and stored-cache sync. A residual **class** of bug remains:
**reversing an already-paid charge strands value.**

Observed (real data): order net **210**, cash paid **250** → customer-facing receipt
correctly shows *overpaid 40*, but the register shows `ADJ-00005` **open 60**. The numbers
are right at the case level and scattered at the document level.

### Root cause (from code investigation)

- **Reversal value is consumed immediately.** A downgrade issues a credit note whose value
  is applied at once as a line-targeted `CAUSE_REVERSAL` onto the **already-paid** adjustment
  line. That pushes the paid invoice's `effectivePaid` above its total — it **manufactures
  overpayment** on that invoice.
- **Refunds are invoice-anchored.** `refund.service.ts` requires the source to be a `FINAL`
  or `ADJUSTMENT` (credit notes are explicitly rejected) and draws
  `computeOverpaymentCapacity = max(effectivePaid − total − priorRefunds, 0)`. So reversal
  value is *deliberately* turned into invoice overpayment to make it refundable.
- **The sweep only draws the credit-note pool.** `settleAvailableCreditAgainstOpenReceivables`
  iterates `CREDIT_NOTE` rows and draws `computeCreditNoteAvailable`. Manufactured
  *overpayment* is invisible to it. So once reversal value becomes overpayment, **no later
  receivable can settle from it** → stranding.

### Why immediate consumption exists

Not an accounting law — three jobs are **fused into one application**:

1. **Provenance** — there is no field for "which line was undone"; the `CAUSE_REVERSAL`
   application (`targetInvoiceLineId`) *is* the only record.
2. **Refund enablement** — applying the full credit onto the paid invoice is *how*
   overpayment capacity gets manufactured for the invoice-anchored refund path.
3. **An invariant forces it** — `credit-note-targets-final` requires a reversal credit note
   (parent = ADJUSTMENT) to carry a line-targeted `CAUSE_REVERSAL`, or it is a violation.

Decouple provenance from application and remove the overpayment-manufacture requirement, and
there is no reason to consume the credit at all.

---

## 2. The three models

- **A — Current.** Both reversal value and cash overpayment are invoice-anchored. Reversal
  manufactures overpayment on the originating charge invoice; refunds draw from it.
- **B — Full credit-note.** *All* returnable value (reversal **and** cash overpayment) is
  modeled as drawable credit; refunds source from credit-note balances.
- **C′ — Origin-partitioned hybrid (chosen).** Cash overpayment stays invoice-anchored;
  reversal/removal value is ordinary **settlement-capable credit** that flows through the
  normal lifecycle and is refundable from the credit-note balance. The two refund channels
  are partitioned by **origin** and never overlap.

> Note: an earlier variant "C" (settle receivables first, convert the *residual* to
> overpayment on the originating invoice) was rejected — it only **relocates** the freeze.
> See §5, worked case 2: a new charge after a downgrade re-strands because the residual is
> already locked into the refund channel. C′ keeps the leftover in the **drawable pool**, so
> future receivables settle from it.

### Comparison

| Dimension | **A — Current** | **B — Full credit-note** | **C′ — Hybrid (chosen)** |
|---|---|---|---|
| **Accounting** | Reversal manufactures overpayment on the paid invoice; refund from it. Conserves money but **strands** when a downstream receivable exists; fixing it needs a *new* sweep-from-overpayment step. | Uniform drawable credit — but **pure cash overpayment has no credit note**, so you must mint a synthetic overpayment credit note or special-case it. Over-unifies. | Overpayment stays invoice-anchored (intuitive). Reversal value settles receivables over time; leftover refundable **from the credit note**; **never** manufactures overpayment → no stranding by construction. |
| **Audit / provenance** | Strongest/most literal: `CAUSE_REVERSAL` line-targeted; four invariants enforce the taxonomy. "Which line undone" is first-class *on the application*. | Provenance → metadata; refund traceability (decision 003) **re-anchors** off the source invoice onto credit-note lineage. | Provenance becomes a **credit-note property** (reverses line L), decoupled from value routing. Preserved and provable; refund-003 re-anchored only for the reversal species. |
| **Interaction with settlement arc** | B4 exposed the stranding (sweep draws only the credit-note pool). Closing it inside A = the redistribution mechanism we want to avoid. | Fits the sweep, but re-opens the refund layer the arc never touched — bigger reframe. | **Best fit** — it *is* the arc's principle ("settle open receivables, carry/return the leftover") extended to reversal value. Reuses the sweep and B4's cache invariant. |
| **Implementation scope** | Smallest delta, but adds the redistribution complexity you dislike and keeps "manufacture-then-redistribute." | Largest: re-architect refund source, mint/handle overpayment credit notes, rewrite invariants **and** decisions 002/003. | Medium: stop immediate consumption, add origin + provenance fields, route refund by origin, collapse the taxonomy. **No synthetic credit notes; overpayment refund path unchanged.** |
| **OrderCommit op/fin alignment** | Weakest — fuses operational "which line" with financial "overpayment must land there." | Good on provenance-as-metadata, but forces pure overpayment into a credit instrument it doesn't fit. | **Best** — cleanly splits operational "what was undone" from financial "where value flowed." |

---

## 3. Decision: C′ + Option 1

### C′ — the model

Two refund channels, **partitioned by origin**, never overlapping:

| Value origin | Lives as | Settles receivables? | Refund source |
|---|---|---|---|
| **Reversal / removal** (downgrade, remove line) | drawable **credit-note** balance | **Yes** — over time, now and future | the credit note's **unapplied balance** |
| **True cash overpayment** (pay 120 on a 100 invoice) | **invoice overpayment** | No | `computeOverpaymentCapacity` on the FINAL/ADJ (**unchanged**) |

Invariants of the model:
- **Reversal value NEVER manufactures invoice overpayment.** (Removes the double-count and
  the premature freeze.)
- **Provenance is preserved** as a property of the credit note, not as the act of applying it.
- **Open receivables settle before any reversal value becomes refundable** — but "becomes
  refundable" means "remains unapplied on the credit note," not "converted to overpayment."

### Option 1 — taxonomy collapse

The application no longer encodes *why* a credit exists (only *where value went*), so the
"why" moves onto the credit note:

```
CreditNote.origin               = REVERSAL | REMOVAL | GOODWILL | ...
CreditNote.reversesInvoiceLineId = <line>     // REVERSAL only — provenance
```

- `DocumentApplicationKind` collapses toward **`{ DEPOSIT, SETTLEMENT }`**.
  `CAUSE_REVERSAL` and `CREDIT_TO_FINAL` are retired as distinct *application kinds* — they
  only ever encoded "why," which now lives on the note.
- **Refund routing reads the origin tag.** Pure cash overpayment is not a credit note at all,
  so it never enters this path.

---

## 4. Invariants — before → after

| Today (enforces immediate line-targeted consumption) | After (C′ + Option 1) |
|---|---|
| `credit-note-targets-final` — CN parent FINAL, or parent ADJUSTMENT **with** a line-targeted `CAUSE_REVERSAL`. | **valid-credit-origin** — every CN has a valid `origin`; if `REVERSAL`, `reversesInvoiceLineId` is set and points at a real line. (No application-shape requirement.) |
| `isValidCreditNoteApplication` (in `credit-note-has-document-application`) — per-kind target/line rules (`CAUSE_REVERSAL` ⇒ ADJUSTMENT+line; `SETTLEMENT` ⇒ ADJUSTMENT+no-line; `CREDIT_TO_FINAL` ⇒ FINAL+no-line). | **credit-applications-conserve** — a CN's applications (now all `SETTLEMENT`) sum to ≤ its total; unapplied remainder = drawable/refundable balance. |
| `adjustment-has-no-document-application` — only `CAUSE_REVERSAL`(line) / `SETTLEMENT`(no-line) may touch an ADJUSTMENT. | Folded into **credit-applications-conserve** — a CN may settle any open ADJUSTMENT receivable regardless of which line it reverses. |
| `classifier-reductions-have-matching-credit-note` — auto-reduction CN must have a line-targeted reversal **or** a settlement. | **classifier-reductions-have-origin** — auto-reduction CN carries `origin = REVERSAL/REMOVAL` + matching activity; application is ordinary settlement. |

Retained unchanged: B4's `charge-invoice-remaining-matches-derived` (stored vs derived cache),
`computeEffectivePaidFromAllocations` (derived truth), `computeCreditNoteAvailable` (drawable
pool), the deposit/payment paths, decisions **002** (direction OUT requires a REFUND invoice)
and **003** (refund traceability — *re-anchored* to credit-note lineage for the reversal
species only).

---

## 5. Worked cases (proof the model holds)

**1. Original bug — removal credit (still correct).**
FINAL 160 paid; upgrade +100 (`ADJ-00003`); remove extra photos → 10 credit. Credit settles
the open `ADJ-00003` → remaining **90 / PARTIAL**. (Already fixed by B1/B4; unchanged here.)

**2. The re-stranding that kills variant C, absorbed by C′.**
Downgrade −100 settles open `ADJ-00005` (60); **40 remains drawable.**
- *Variant C* (residual → overpayment on `ADJ-00003`): a later upgrade **+40** (`ADJ-00007`)
  cannot settle from that overpayment (sweep can't see it) → `ADJ-00007` stranded open 40 **and**
  40 frozen as overpayment. Bug relocated.
- *C′* (40 stays in the drawable pool): the next sweep applies the **40 remaining credit** to
  `ADJ-00007` → settled to 0. No refund, no stranding. ✓

**3. Pure cash overpayment (unchanged).**
Invoice 100, customer pays 120 → `computeOverpaymentCapacity = 20` on that invoice →
refund 20 from the invoice. Never a credit note. ✓

**4. Downgrade with nothing new added (channel difference, same money).**
Full payment, then downgrade −100, no further charges → 100 stays as the credit note's
unapplied balance → refund **100 from the credit note**. (Model A would have refunded the same
100 via manufactured overpayment; C′ returns the same amount through the origin-correct
channel, with no phantom overpayment on a closed invoice.) ✓

---

## 6. Scope shape (for the eventual spec — not a spec)

- **Schema:** add `CreditNote.origin` + `reversesInvoiceLineId`; plan retirement/migration of
  `CAUSE_REVERSAL` / `CREDIT_TO_FINAL` application rows → `SETTLEMENT` + note origin
  (idempotent, fail-loud on unclassifiable rows; forward-only on dev data per arc convention).
- **Emission:** stop immediately consuming reversal credit; issue the credit note with origin
  + provenance and let the sweep apply it.
- **Sweep:** largely unchanged — it already settles open receivables from the credit-note pool;
  remove the immediate-consumption special case so reversal credit *stays* in the pool.
- **Refund:** add a credit-note-balance refund path for `origin ∈ {REVERSAL, REMOVAL}`; keep
  `computeOverpaymentCapacity` for genuine cash overpayment; re-anchor decision 003 traceability
  for the reversal species.
- **Invariants:** collapse the four taxonomy invariants into `valid-credit-origin` +
  `credit-applications-conserve` (see §4); regenerate the catalog.
- **Read layer:** receipt (B3) already correct; the register now reconciles because reversal
  credit never leaves the settlement pool. The generalized invoice-detail breakdown stays the
  **register** plan's job (deferred "B5").

### Risks / open items
- Historical-data migration correctness (idempotent, fail-loud, behavior-preserving on existing
  closed orders).
- Refund-003 re-anchoring: `refundOfPaymentId` semantics for credit-note-sourced refunds.
- Ordering guarantee: the sweep must run on **every** commit that opens a receivable so drawable
  reversal credit is consumed before anything looks open.
- Confirm no path other than reversal/removal mints credit notes that should *not* route to the
  credit-note refund channel.

### Out of scope
- Implementation spec(s) (separate, against this record).
- The financial-documents **register** presentation plan.
- Any change to the customer-facing receipt (B3) — it is already the case-level truth.

---

## 7. Phase plan & locked decisions (2026-06-09)

Target locked: **C′ + Option 1.** This is a focused phase — **~5 sequenced specs, one PR
each, strict order** (same discipline as the F1–B4 arc). Smaller than that arc because the
sweep, derived-truth (`computeEffectivePaidFromAllocations`), drawable pool
(`computeCreditNoteAvailable`), and B4 cache invariant already exist — this phase mostly
*removes* the immediate-consumption special case and *moves* provenance onto the note.

| # | Spec | What it does | No-op? |
|---|---|---|---|
| **R0** | Foundation / schema | Add `CreditNote.origin` + `reversesInvoiceLineId`; classify origins. | Behavior no-op |
| **R1** | Invariant rework | Collapse the 4 taxonomy invariants → `valid-credit-origin` + `credit-applications-conserve`; regenerate catalog (allows the new shape before anything emits it). | Behavior no-op |
| **R2** | Emission change (core) | Stop consuming **reversal** credit as `CAUSE_REVERSAL`; issue with origin + provenance; route value through the sweep. **Bug dies here.** | Behavioral |
| **R3** | Refund channel | Credit-note-balance refund for `origin ∈ {REVERSAL, REMOVAL}`; keep `computeOverpaymentCapacity` for true cash overpayment. | Behavioral |
| **R4** | Taxonomy retirement | Retire `CAUSE_REVERSAL` / `CREDIT_TO_FINAL` enum kinds once nothing depends on them. | Cleanup |

R1 lands **before** R2 (new emission would fail old invariants) — the same F1-before-B1
ordering already run once.

### Locked decisions

1. **Migration = reset & regenerate.** Dev data is disposable (arc convention). R0 classifies
   origins for forward correctness; **no historical backfill** of application rows — a dev reset
   regenerates clean. No in-place CAUSE_REVERSAL/CREDIT_TO_FINAL row rewrite.
2. **Refund-003 = goodwill-style (null link).** Reversal-origin refunds draw from the
   credit-note balance, not a specific prior payment, so `refundOfPaymentId` is **null**
   (decision 003 already permits this for goodwill). The credit — not a payment — is the source.
3. **Collapse scope = reversal first, FINAL credit later.** Collapse `CAUSE_REVERSAL` (the bug
   path) in R2; keep `CREDIT_TO_FINAL` working as-is and retire it in **R4**. De-risks by landing
   the correctness fix before the FINAL-target cleanup. **Consequence:** `SETTLEMENT` must be
   allowed onto `FINAL` as well as `ADJUSTMENT` (the sweep stays ADJUSTMENT-only; removal credit
   on a FINAL applies as a direct settlement at issuance, not via the sweep).

### Concentrated risk
Refund-003 re-anchoring (R3) and the sweep-ordering guarantee (R2 — drawable reversal credit
must be consumed on every commit that opens a receivable, before anything looks open).
