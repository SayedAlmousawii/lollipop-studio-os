## Goal

Introduce the ADJUSTMENT invoice as a first-class primitive on the financial side. Lands the `createAdjustmentInvoice` service helper as the single sanctioned path for creating ADJUSTMENT-type invoices. No order-edit hook wires into it yet — that's spec 75b. This spec is the pure invoice-side groundwork.

Depends on 73, 73b, 73c, 74a–e (Phase 0 + Phase 1 complete).

---

## Read First

- `context/Financial reviews/financial-rearchitecture-master-plan.md` — "Phase 2" outline + Phase 2 resolved decisions
- `~/.claude/projects/-Users-bo3li-Desktop-lollipop-studio-os/memory/project_financial_review_2026_05.md` — Fork S resolution and E1–E12 classifier rules
- `src/modules/invoices/invoice.service.ts` — current invoice creation paths, particularly:
  - `syncOrderInvoiceForFinancialEdit` (line ~217) — the entry point that currently throws on locked-invoice edits
  - The locked-invoice throw at lines 287–288
  - `recalculateInvoiceStatus` (line ~643) — already migrated in 74d to use allocations + applications
- `src/modules/financial/invariants.ts` — invariant registry (73b)
- `src/modules/financial/types.ts` — `Money` and `PaymentDirection` aliases (73b)
- 74c's `createPaymentWithAllocation` — the choke-point pattern this spec mirrors

---

## Rules

- ADJUSTMENT invoices are settled by `PaymentAllocation` only — never by `DocumentApplication` (per Fork S). ADJUSTMENT is a *new receivable*, not a credit transfer.
- `Invoice.parentInvoiceId` on an ADJUSTMENT points to the FINAL it adjusts. Per E8, ADJUSTMENTs are ALWAYS siblings of FINAL — never of another ADJUSTMENT.
- `createAdjustmentInvoice` is the ONLY sanctioned path for creating ADJUSTMENT-type invoices after this spec ships. Direct `prisma.invoice.create` for type=ADJUSTMENT is added to the choke-point checker's forbidden list.
- ADJUSTMENT invoices follow the same lock-on-close semantics as FINAL — once paid and closed, they are immutable.
- No order-edit hook is wired in this spec — `syncOrderInvoiceForFinancialEdit` continues to throw on locked-invoice edits. That changes in 75b.

---

## Scope

### In Scope

**Invoice numbering for ADJUSTMENT type**

Per Fork K (resolved earlier), invoice numbering uses one shared sequence with prefixed display. Ensure the display prefix `ADJ-` is wired in for `invoiceType = ADJUSTMENT`. The shared `invoice_number_seq` from existing schema continues to be the underlying counter.

If the prefix-display logic was deferred from Spec 73 (it was marked out of scope there), this spec lands it as a small sub-task — confirm it's in place before ADJUSTMENT invoices can be issued meaningfully.

**`createAdjustmentInvoice` service helper**

Lives in `src/modules/invoices/invoice.service.ts` (or `invoice.adjustment.ts` if file structure warrants — match existing module convention).

Signature:
```ts
type AdjustmentLineInput = {
  lineType: InvoiceLineType;        // matches existing enum
  description: string;
  quantity: number;
  unitPrice: Money;
};

type CreateAdjustmentInvoiceInput = {
  parentFinalInvoiceId: string;     // the FINAL being adjusted
  lines: AdjustmentLineInput[];     // commercial lines for the adjustment (non-empty)
  notes?: string;
  createdByUserId?: string;
};

async function createAdjustmentInvoice(
  input: CreateAdjustmentInvoiceInput,
  tx: PrismaClient | TransactionClient,
): Promise<Invoice>;
```

Behavior:
1. Validate `lines` is non-empty and every `unitPrice * quantity` is `> 0` (CHECK constraints on Invoice still apply: `totalAmount > 0`)
2. Load the parent FINAL invoice; assert `invoiceType = FINAL` and `isLocked = true` (ADJUSTMENT only exists for locked FINALs — if FINAL is still mutable, the edit should update FINAL directly, not spawn an ADJUSTMENT)
3. Resolve the FinancialCase from the parent FINAL — ADJUSTMENT inherits the same `financialCaseId`, `customerId`, `orderId`, `bookingId`, `jobId`
4. Compute `totalAmount = SUM(line.unitPrice * line.quantity)`
5. Create the Invoice row with:
   - `invoiceType = 'ADJUSTMENT'`
   - `parentInvoiceId = parentFinalInvoiceId`
   - `status = 'OPEN'` (or whatever the existing 'open and ready for payment' status is — match current FINAL invoice creation patterns)
   - `isLocked = false`
   - `issuedAt = now()`
6. Create the `InvoiceLineItem` rows from `lines`
7. Run `assertFinancialCaseInvariants(financialCaseId, tx)` before returning
8. Return the created Invoice

All within the supplied transaction. If no transaction is supplied, the helper opens its own.

**Choke-point pattern registration**

Append to `scripts/check-financial-choke-points.sh` (from 73b):
- Forbid `prisma.invoice.create` and `prisma.invoice.createMany` outside `src/modules/invoices/`
- Inside `src/modules/invoices/`, allow them only in the canonical creation functions (e.g., the deposit-creation path in 74c's flow, the FINAL-creation flow, and this new `createAdjustmentInvoice`)
- The check enforces "every new ADJUSTMENT invoice goes through `createAdjustmentInvoice`"

**Invariant registrations**

Register new invariants into the 73b registry:

```ts
registerInvariant({
  name: 'adjustment-parent-is-final',
  scope: 'global',
  run: /* every ADJUSTMENT invoice has parentInvoiceId set, and that parent has invoiceType='FINAL' */,
});

registerInvariant({
  name: 'adjustment-same-financial-case-as-parent',
  scope: 'global',
  run: /* every ADJUSTMENT.financialCaseId === parent FINAL.financialCaseId */,
});

registerInvariant({
  name: 'adjustment-never-chains',
  scope: 'global',
  run: /* no ADJUSTMENT invoice has a parent whose invoiceType='ADJUSTMENT' — enforces E8 */,
});

registerInvariant({
  name: 'adjustment-has-no-document-application',
  scope: 'global',
  run: /* no DocumentApplication has sourceInvoice or targetInvoice with invoiceType='ADJUSTMENT' — enforces Fork S */,
});
```

These flow into the CI invariant test (74d's file) and the nightly reconciliation job (74e's harness) automatically.

**ADR**

Add `src/modules/invoices/decisions/002-adjustment-is-sibling-not-credit-movement.md` capturing Fork S:
> ADJUSTMENT invoices are receivables, not credit movements. They are settled via `PaymentAllocation`, never via `DocumentApplication`. `parentInvoiceId` records the relationship to the parent FINAL for audit; the financial math does not depend on the parent pointer.

**Shared fixtures**

Append `makeAdjustedBookingFixture` to `tests/fixtures/financial.ts` (from 73b). This factory builds a cash-deposit booking through POS settlement, then issues one ADJUSTMENT via `createAdjustmentInvoice`. Used by Phase 2+ tests.

### Out of Scope

- Order-edit hook that auto-spawns ADJUSTMENT (75b)
- POS surfacing of unpaid adjustments (75c)
- CREDIT_NOTE invoice creation (Phase 3, spec 76b)
- REFUND mechanics (Phase 3, spec 76a)
- Editing the locked FINAL invoice itself (still throws — unchanged from current behavior)
- UI for "manually issue ADJUSTMENT" by staff (the helper is service-only in this spec; UI lands in 75b or 75c if needed)

---

## Implementation Direction

**Order:**
1. Wire ADJ- display prefix into invoice-number rendering (if not already done — confirm)
2. Add `createAdjustmentInvoice` service helper
3. Register the four new invariants
4. Append to choke-point checker forbidden list and allowlist
5. Add the ADR
6. Add `makeAdjustedBookingFixture` to shared fixtures
7. Verify all flows still pass — no behavior change is visible to users yet (no caller invokes `createAdjustmentInvoice` yet)

**Risk:** Low. This spec creates a new code path that no one calls yet. The risk surface is the choke-point rule potentially flagging legitimate existing FINAL-invoice creation paths — audit the allowlist carefully.

**Rollback:** Remove the new function, registry entries, fixture, ADR, and choke-point patterns. No data was created.

---

## Verification

- `createAdjustmentInvoice` exists, exported, and creates an Invoice row with `invoiceType='ADJUSTMENT'`, `parentInvoiceId=<FINAL.id>`, correct `financialCaseId`, and matching line items
- `tests/financial-invariants.test.ts` passes including the four new invariants
- Choke-point checker flags any `prisma.invoice.create` for ADJUSTMENT outside the helper
- `makeAdjustedBookingFixture` produces a working fixture seeded with a paid FINAL and one open ADJUSTMENT
- No user-facing flow has changed; locked-invoice edits still throw via `syncOrderInvoiceForFinancialEdit`
