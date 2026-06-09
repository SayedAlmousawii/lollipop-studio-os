# 165 · Financial Documents Register — Presentation (register reframe + generalized breakdown)

> Presentation/read-layer spec, accountant-facing. **No `Invoice` model, type, numbering, or
> financial-engine change** — labeling, grouping, signing, column split, subtotals, and a
> generalized per-invoice application breakdown only. Implements
> `context/reviews/financial-documents-register-presentation.md` (incl. its §8 deferred "B5").
> Owner decisions (locked 2026-06-09): footer = **gross + credits subtotal lines**; **both** the
> register-list reframe and the invoice-detail breakdown ship in this one spec.

## Goal

Make the global invoices list read correctly as an **accountant's register**, and make the
settlement work from the reversal-credit arc **visible** on every charge invoice. Today the list
forces unlike instruments (deposit, final, adjustment, credit note, refund) under one "Invoice"
label with a single ambiguous "Settled" column, inviting nonsense sums; and the invoice-detail
"Financial Breakdown" card exists only for FINAL and only itemizes the deposit, so an ADJUSTMENT
settled by a credit note shows correct totals with **no line explaining where the credit came from**.

## Read First

- `context/reviews/financial-documents-register-presentation.md` — the full plan: §3 (the 8
  conventions), §4 (before→after table), §5 (drawable-pool interaction — a credit note's
  "outstanding" is its *unapplied credit*, never customer-owed), §8 (the generalized breakdown).
- `context/ui-context.md` — tokens (danger `#B42318` for negatives, success for cash, badges,
  surface/border), table/card/badge patterns. **Light-mode luxury admin; calm and readable.**
- `app/invoices/page.tsx` + `src/components/invoices/invoices-table.tsx` — the register surface
  (current columns: Total · Settled · Remaining · Status · Locked).
- `src/modules/invoices/invoice.service.ts` `getInvoices` (l.~835) → `InvoiceListItem`
  (invoice.types.ts l.26); `getInvoiceWithLineItems` → `InvoiceDetail`.
- `app/invoices/[id]/page.tsx` — the FINAL-only "Financial Breakdown" card (l.~140) to generalize.
- `src/modules/invoices/invoice.calculation.ts` `computeEffectivePaidFromAllocations` — the
  cash-vs-credit primitive the read split mirrors (IN/OUT payment allocations vs document
  applications). `computeCreditNoteAvailable` — a credit note's drawable/unapplied balance.

## Rules

- **Presentation + read-layer only.** No change to the `Invoice` model, enums, numbering, the
  financial engine, or any money math. Numbers are already correct post-B4/R0–R4; this spec only
  *labels and groups* them.
- **Read layer computes financial meaning; components render it.** No `@/lib/db` under `app/**` or
  `src/components/**`. The cash/credit split, signing, and subtotals are derived in the service read
  layer and passed as formatted strings; the table never derives money.
- **Golden rule (plan §3):** never total across document classes. Subtotal *within* a class;
  credit notes net within billing, refunds net within cash, the two ledgers never cross-add.
- **A credit note's "outstanding" is its unapplied drawable credit, not customer-owed.** Label so
  `Outstanding 50` on a credit note never reads as "customer owes 50."

## Scope

### In Scope — A. Register list reframe (`/invoices`)

- **Rename + relabel.** Page title → **"Financial Documents"**; ID column → **"Document No."**;
  add a first-class **Type** column, badged (`Deposit / Final / Adjustment / Credit note / Refund`).
- **Sign by direction.** Charges (Deposit/Final/Adjustment) positive; **Credit notes and Refunds
  negative**, rendered in parentheses `(10.000)` and `danger` color. Signing is a presentation
  concern driven by a read-layer `documentClass` / `signedAmount`, not stored.
- **Split the "Settled" column** into **Amount · Paid (cash) · Credit applied · Outstanding**:
  - *Paid (cash)* = Σ IN payment allocations on the invoice (cash only).
  - *Credit applied* = Σ `DocumentApplication.amountApplied` targeting the invoice (deposit +
    settlement credit), with the applied-from document referenced (convention #6).
  - *Outstanding* = charge `remainingAmount`; for a **credit note**, its unapplied drawable balance
    (`computeCreditNoteAvailable`), labeled as credit, not owed.
- **Status vocabulary** (plan #8): map to accountant terms — **Draft / Issued / Paid / Void**
  (drop the "Locked Yes/No" column). `isLocked` stays available internally but is not a register column.
- **Footer subtotals by class — gross + credits form (locked decision):**
  ```
  Invoiced (gross)   = Σ FINAL + ADJUSTMENT totals
  Credits issued     = (Σ CREDIT_NOTE totals)        ← shown negative
  Invoiced (net)     = gross − credits
  Deposits (prepaid) = Σ DEPOSIT totals              ← excluded from invoiced/revenue
  Cash received      = Σ IN payments                 (refunds = cash out, shown in the cash line, never cross-added to credits)
  Receivable         = Σ outstanding on open charges
  ```
  No grand total across classes.
- **Applied/consuming links** (convention #6): a credit/deposit shows what it applied to; a refund
  shows the credit note it drew down. Use the document graph already in the read layer.

### In Scope — B. Generalized invoice-detail breakdown (the deferred "B5")

- Replace the FINAL-only, deposit-only "Financial Breakdown" card with **one read-layer breakdown
  that lists every `DocumentApplication` on any charge invoice** (FINAL or ADJUSTMENT) as labeled,
  signed lines sourced from the document graph:
  - `Deposit credited (DEP-xxxxx) −20.000`
  - `Settlement credit applied (CN-xxxxx) −10.000`
  - (and any future kind, by label) — so an ADJUSTMENT settled by a credit note shows the line
    explaining the credit, not just a reduced remaining.
- Add the breakdown to the `InvoiceDetail` read model (list of `{label, documentNumber, amount,
  signed}`), derived from the applications targeting the invoice. Card renders it; no derivation in
  the page.

### Out of Scope

- Any engine/model/numbering change; any new money math.
- Period rollups / AR aging / revenue reports (separate future reporting project, per plan §7).
- The per-order customer balance (that's the Sales settlement summary — a different surface).
- Pagination redesign (see Considerations).

## Implementation Direction

1. **Read layer (service):** extend `InvoiceListItem` with `documentClass`/`signedAmount`,
   `paidCash`, `creditApplied`, `outstanding` (credit-note-aware), accountant `status`, and
   applied-to references. Compute the cash/credit split via **batched aggregation** over the result
   set (group payment allocations by direction and document applications by target invoice) — avoid
   an N+1 per row.
2. **Footer subtotals:** compute class subtotals over the **full filtered set** (a dedicated
   aggregate), not just the current page, so the footer can't mislead under pagination.
3. **Register table component:** Type badge column, Document No., signed/parenthesized negatives in
   `danger`, the four split columns, accountant status, footer subtotal block, applied links. Pure
   presentation over read-layer strings.
4. **Invoice-detail breakdown:** add the generalized application breakdown to `InvoiceDetail`;
   render the card for FINAL and ADJUSTMENT.
5. Use existing tokens/components (`Table`, `Badge`, `Card`); no new design system.

## Observability Checklist

### Rollback Plan
- Pure presentation/read-layer revert; no schema or engine change, no data migration.

### Customer-Visible Surface
- Internal accountant-facing register only; no customer-facing receipt change (B3 stays canonical).

## Considerations / Risks

- **Pagination vs subtotals:** footer subtotals must reflect the full filtered set, not one page —
  otherwise they mislead. Either aggregate the whole filtered set for the footer, or gate subtotals
  behind an unpaginated/period-scoped view. (Spec chooses full-filtered aggregate.)
- **Read cost:** the cash/credit split adds aggregation; keep it batched (grouped queries), not
  per-row, to preserve list performance.
- **Credit-note "outstanding" mislabel** is the single highest-risk misread — it is *available
  credit*, never customer debt. Distinct label + sign.

## Acceptance Criteria

- The register reads as **Financial Documents**: Type is a badged first-class column; credit notes
  and refunds render negative `(x.xxx)`; "Settled" is replaced by **Amount · Paid (cash) · Credit
  applied · Outstanding**; status shows Draft/Issued/Paid/Void; the Locked column is gone.
- The plan's §4 four-document example reproduces: `DEP 20 / INV 160 (140 cash + 20 deposit) / ADJ 100
  (10 credit from CN-xxxx, 90 outstanding) / CN (10.000)`, and the **footer reads gross 260 ·
  credits (10) · net 250 · deposits 20 · cash 160 · receivable 90** — no grand total across classes.
- A **credit note's Outstanding shows its unapplied drawable credit**, labeled as credit (never as
  customer-owed).
- The invoice-detail breakdown lists **every** `DocumentApplication` on FINAL **and** ADJUSTMENT as
  labeled signed lines (deposit + settlement credit, sourced from the document graph) — an
  ADJUSTMENT settled by a credit note shows `Settlement credit applied (CN-xxxxx) −10.000`.
- No `@/lib/db` under `app/**` or `src/components/**`; no engine/model/money-math change; subtotals
  computed over the full filtered set.
- `npm run build` and `npm run lint` pass; existing invoice read/list tests updated for the new shape.
