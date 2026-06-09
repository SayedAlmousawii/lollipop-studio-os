# 159 · R0 — Credit Origin Foundation (schema + classification)

> Plan label **R0** (reversal-credit model phase); repo number **159** is provisional.
> First spec of the phase defined in
> `context/reviews/reversal-credit-and-refund-model-decision.md` (model **C′ + Option 1**).
> **Behavior no-op** — this spec only adds the place where a credit note's *origin* lives, so
> later specs can stop encoding it in the application. Mirrors **153 · F1** (forward-enabling
> foundation, no behavior change).
> Depends on the settlement arc (F1–B4) being merged.

## Goal

Give every credit note an explicit **origin** and **reversal provenance** as first-class
fields on the invoice row, instead of inferring "why this credit exists" from *how* it was
applied (`CAUSE_REVERSAL` line-targeting / `CREDIT_TO_FINAL`). Nothing reads the new fields
for behavior yet; this is the schema + classification base the rest of the phase builds on.

## Read First

- `context/reviews/reversal-credit-and-refund-model-decision.md` — §3 (the chosen model + the
  `origin` / `reversesInvoiceLineId` fields), §7 (phase plan, locked decision #1: reset &
  regenerate — no historical backfill).
- `prisma/schema.prisma` — `model Invoice` (line ~903; credit notes are `Invoice` rows with
  `invoiceType = CREDIT_NOTE`), `model InvoiceLineItem` (line ~985), `enum InvoiceType`,
  `enum DocumentApplicationKind`.
- `src/modules/invoices/invoice.service.ts` — `createCreditNoteWithClient` (the issuance path
  that will *set* the new fields), `computeCreditNoteAvailable` (drawable pool — unchanged).
- `src/modules/financial/invariants.ts` — the four taxonomy invariants
  (`credit-note-targets-final`, `isValidCreditNoteApplication`,
  `adjustment-has-no-document-application`, `classifier-reductions-have-matching-credit-note`)
  — **left intact in R0**, reworked in R1.

## Rules

- **Behavior no-op.** No change to emission routing, the sweep, refunds, application kinds,
  or any money math. R0 only *populates* the new fields alongside the existing
  `CAUSE_REVERSAL` / `CREDIT_TO_FINAL` applications, which still happen exactly as today.
- **Fields live on the credit-note invoice row.** `origin` and `reversesInvoiceLineId` are
  nullable columns on `Invoice`, set **only** when `invoiceType = CREDIT_NOTE`. Non-credit-note
  invoices keep them null.
- **Reset & regenerate, not backfill** (locked decision #1). Do **not** write an in-place
  migration that rewrites historical applications. Dev data is disposable; a reset regenerates
  credit notes with the new fields populated by the issuance path. The migration is
  schema-only (add columns + enum); existing rows get `origin = null`, which the R1 invariant
  will treat as *legacy/unclassified* and tolerate (see R1).
- **Provenance is a property, not yet a behavior.** `reversesInvoiceLineId` records which line
  a `REVERSAL` credit note undoes; in R0 it is set **in addition to** the existing
  line-targeted `CAUSE_REVERSAL` application (which R2 will later stop creating).
- No `@/lib/db` in `app/**` or `src/components/**` (no UI surface in R0).

## Scope

### In Scope

- **Schema:** add
  - `enum CreditOrigin { REVERSAL, REMOVAL, GOODWILL }` (extensible later),
  - `Invoice.creditOrigin CreditOrigin?` (nullable),
  - `Invoice.reversesInvoiceLineId String?` + relation to `InvoiceLineItem` (nullable,
    `onDelete: SetNull` or restrict per existing FK convention).
- **Migration:** additive, schema-only (new enum + two nullable columns + FK). No data backfill.
- **Issuance sets the fields.** In `createCreditNoteWithClient`, when issuing a credit note,
  set `creditOrigin` from the issuing path's intent and `reversesInvoiceLineId` for the
  reversal/line-targeted case:
  - line-targeted downgrade/reversal → `creditOrigin = REVERSAL`, `reversesInvoiceLineId = <line>`,
  - removal credit against a FINAL (today `CREDIT_TO_FINAL`) → `creditOrigin = REMOVAL`,
  - manual/goodwill credit note → `creditOrigin = GOODWILL`.
  The existing applications (`CAUSE_REVERSAL` / `CREDIT_TO_FINAL` / direct) are **still created
  unchanged** — R0 only *also* stamps the origin.
- **Classification helper** (pure): a small function mapping the issuance inputs (line-targeted?
  parent FINAL vs ADJUSTMENT? manual?) → `CreditOrigin`, so R2/R3 can reuse one source of truth.

### Out of Scope

- Reworking the four taxonomy invariants (**R1**).
- Stopping immediate `CAUSE_REVERSAL` consumption / routing reversal value through the sweep
  (**R2**).
- The credit-note-balance refund channel (**R3**).
- Retiring `CAUSE_REVERSAL` / `CREDIT_TO_FINAL` enum kinds (**R4**).
- Any historical data backfill (locked decision #1).
- Any read-layer / receipt / register change.

## Implementation Direction

1. Add the enum + columns + FK to `prisma/schema.prisma`; generate the additive migration.
2. Add a pure `classifyCreditOrigin(input)` helper near `createCreditNoteWithClient` returning
   `CreditOrigin` from the issuance shape (line-targeted reversal vs FINAL removal vs manual).
3. In `createCreditNoteWithClient`, after creating the credit-note invoice, set `creditOrigin`
   (always) and `reversesInvoiceLineId` (REVERSAL only). Keep every existing application write
   (`createMany` CAUSE_REVERSAL, `create` CREDIT_TO_FINAL) exactly as-is.
4. Leave `invariants.ts` untouched — the existing taxonomy still passes because applications are
   unchanged.

## Observability Checklist

### Dashboards / Metrics
- None new. (Optional dev assertion: every newly issued `CREDIT_NOTE` has a non-null
  `creditOrigin` — useful as a temporary log, not a runtime invariant until R1.)

### Rollback Plan
- Down-migration drops the two columns + enum (additive, safe). No data depends on them in R0.
- No flag; revert = revert the migration + the issuance stamping.
- Non-recoverable data: none (fields are additive, null for pre-existing rows).

### Customer-Visible Surface
- None.

## Post-Implementation
- Update `context/reviews/reversal-credit-and-refund-model-decision.md` §7: mark R0 implemented
  (origin foundation in place).
- Update `context/progress-tracker.md` Key State + Feature History: credit notes now carry
  `creditOrigin` + reversal provenance; behavior unchanged; foundation for R1–R4.

## Acceptance Criteria

- `Invoice.creditOrigin` + `Invoice.reversesInvoiceLineId` exist (nullable); additive migration
  applies and reverses cleanly.
- Every **newly issued** credit note has a non-null `creditOrigin`; `REVERSAL` credit notes also
  set `reversesInvoiceLineId` to the undone line; non-credit-note invoices keep both null.
- All existing applications and money math are **byte-unchanged**; the four taxonomy invariants
  still pass on regenerated data; the full financial + OrderCommit regression suite is green.
- No read-layer/receipt/register change; no `@/lib/db` in `app/**` or `src/components/**`.
- `npm run build` and `npm run lint` pass.
