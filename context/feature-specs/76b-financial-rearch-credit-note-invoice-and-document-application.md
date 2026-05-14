## Goal

Introduce CREDIT_NOTE invoices as the explicit mechanism for reducing a customer's receivable on a locked FINAL. Lands `createCreditNote` as the sanctioned creation path; each CREDIT_NOTE binds to its target FINAL via a `DocumentApplication` row (source=CREDIT_NOTE, target=FINAL) so the FINAL's effective receivable decreases automatically through the Phase 1 recalculation logic.

Depends on 73, 73b, 74a–e. Independent of 76a — can ship in parallel. 76c (wiring 75b's reductions to this flow) depends on 76b.

---

## Read First

- `context/Financial reviews/financial-rearchitecture-master-plan.md` — "Phase 3" outline + Phase 2 resolved decisions (esp. E9: CREDIT_NOTEs always target FINAL)
- `~/.claude/projects/-Users-bo3li-Desktop-lollipop-studio-os/memory/project_financial_review_2026_05.md` — E9 (target FINAL), E11 (refund-shaped scenario)
- `src/modules/invoices/invoice.service.ts` — invoice creation patterns; especially 75a's `createAdjustmentInvoice` (closest analogue)
- 74a's `DocumentApplication` model + unique constraint `(sourceInvoiceId, targetInvoiceId)`
- 74d's `computeEffectivePaidFromAllocations` — already accounts for DocumentApplications targeting an invoice; CREDIT_NOTE flows in automatically

---

## Rules

- A CREDIT_NOTE invoice has positive `totalAmount`. The reduction is expressed by binding it via `DocumentApplication` (source=CREDIT_NOTE, target=FINAL, amountApplied=CREDIT_NOTE.totalAmount). The Phase 1 recalc logic does the math.
- Per E9, **all CREDIT_NOTEs target FINAL** — never an ADJUSTMENT, never a DEPOSIT. If a customer wants to reverse what was added by an ADJUSTMENT, the CREDIT_NOTE still targets FINAL; the ADJUSTMENT stays as-paid in history.
- `createCreditNote` is the ONLY sanctioned path for creating CREDIT_NOTE-type invoices.
- Manager-level permission required. Reason required.
- CREDIT_NOTE issuance is a non-monetary event — no Payment is created by issuing one. Issuing a CREDIT_NOTE reduces what the customer *owes*. If the customer had already paid that money, the staff must then issue a REFUND (76a) — this is a deliberate two-step pattern.
- CREDIT_NOTE total is capped: `<= FINAL.totalAmount - SUM(prior CREDIT_NOTE.amountApplied against same FINAL)` — cannot credit more than is owed.
- CREDIT_NOTEs are locked immediately on issuance (they are non-monetary; nothing changes after issuance).

---

## Scope

### In Scope

**`InvoiceType.CREDIT_NOTE` already exists** (from prior lifecycle work) — verify and use as-is.

**`createCreditNote` service helper**

Lives in `src/modules/invoices/invoice.service.ts` (or `invoice.credit-note.ts`).

Signature:
```ts
type CreditNoteLineInput = {
  description: string;             // describes what is being credited
  quantity: number;
  unitPrice: Money;
};

type CreateCreditNoteInput = {
  targetFinalInvoiceId: string;    // the FINAL whose receivable is reduced
  lines: CreditNoteLineInput[];    // non-empty; sum = credit amount
  reason: string;                  // required
  createdByUserId: string;         // required — manager
  notes?: string;
};

async function createCreditNote(
  input: CreateCreditNoteInput,
  tx: PrismaClient | TransactionClient,
): Promise<Invoice>;
```

Behavior:
1. Validate `lines` is non-empty; compute `total = SUM(line.unitPrice * line.quantity)`; assert `total > 0`
2. Load target invoice; assert `invoiceType = 'FINAL'` and `isLocked = true`
3. Compute credit cap: `FINAL.totalAmount - SUM(existing CREDIT_NOTE DocumentApplications targeting this FINAL)`. Reject if `total > cap`.
4. Verify caller is a manager
5. Create CREDIT_NOTE invoice with:
   - `invoiceType = 'CREDIT_NOTE'`
   - `totalAmount = total`
   - `parentInvoiceId = targetFinalInvoiceId` (audit pointer; the binding for math is the DocumentApplication)
   - `financialCaseId`, `customerId`, etc. inherited from target FINAL
   - `status = 'CLOSED'` (CREDIT_NOTEs are non-monetary; they have no pending payment)
   - `isLocked = true` (immediately immutable)
   - `issuedAt = now()`, `closedAt = now()`
6. Create the InvoiceLineItem rows
7. Create the binding `DocumentApplication`:
   ```ts
   {
     sourceInvoiceId: creditNote.id,
     targetInvoiceId: targetFinalInvoiceId,
     amountApplied: total,
     appliedAt: now(),
     appliedByUserId: input.createdByUserId,
     notes: `Credit note for reason: ${input.reason}`,
   }
   ```
   The 74a unique constraint `(sourceInvoiceId, targetInvoiceId)` is the safety net against double-binding (which shouldn't happen since each CREDIT_NOTE has a unique id).
8. Trigger `recalculateInvoiceStatus(targetFinalInvoiceId, tx)` — Phase 1's logic picks up the new DocumentApplication and reduces FINAL's effective receivable; if FINAL was already fully paid, the new effectivePaid > totalAmount may flag as overpayment (handled below).
9. Run `assertFinancialCaseInvariants(financialCaseId, tx)`
10. Return the CREDIT_NOTE invoice

**Overpayment after credit-note issuance**

When a CREDIT_NOTE is issued against a fully-paid FINAL, the FINAL becomes "overpaid" — the customer paid more than now-owed. POS surfaces this as "credit available — issue refund" prompt. The REFUND (76a) is the staff's next step. The CREDIT_NOTE invoice itself does not auto-trigger a refund — the two-step pattern keeps money movements explicit.

Add `Invoice.isOverpaid` derived flag (computed, not stored): `effectivePaid > totalAmount` after recalc. POS and reporting consume this for UI.

**Invariant registrations**

```ts
registerInvariant({
  name: 'credit-note-targets-final',
  scope: 'global',
  run: /* every CREDIT_NOTE has parentInvoiceId pointing to a FINAL invoice */,
});

registerInvariant({
  name: 'credit-note-has-document-application',
  scope: 'global',
  run: /* every CREDIT_NOTE has exactly one DocumentApplication where it is the source, targeting its parentInvoiceId */,
});

registerInvariant({
  name: 'credit-note-amount-not-over-final',
  scope: 'global',
  run: /* for each FINAL, SUM(CREDIT_NOTE DocumentApplications targeting it) <= FINAL.totalAmount */,
});

registerInvariant({
  name: 'credit-note-is-locked-on-issuance',
  scope: 'global',
  run: /* every CREDIT_NOTE has isLocked=true and status=CLOSED */,
});
```

**Choke-point**

Append to `scripts/check-financial-choke-points.sh`:
- Forbid `prisma.invoice.create` for `invoiceType='CREDIT_NOTE'` outside `createCreditNote`
- Forbid direct `prisma.documentApplication.create` where `sourceInvoice.invoiceType='CREDIT_NOTE'` outside `createCreditNote`

**Manager-action UI**

"Issue credit note" action on the FINAL detail view (POS or financial admin). Manager-only. Dialog:
- Line items (description, quantity, unit price) — staff types each line. Pre-fill suggestions if the credit note is being issued in response to a 75b classifier reduction (76c wires this).
- Reason (required)
- Preview: shows updated FINAL receivable after the credit note is applied
- Submit calls `createCreditNote`

**ADR**

Add `src/modules/invoices/decisions/003-credit-note-target-and-math.md`:
> CREDIT_NOTEs always target FINAL. The math reduction is expressed via `DocumentApplication(source=CREDIT_NOTE, target=FINAL, amountApplied=total)`. The CREDIT_NOTE invoice itself has positive totalAmount; the reduction direction is encoded in the application semantics. Phase 1's `computeEffectivePaidFromAllocations` consumes DocumentApplications targeting an invoice — credit notes flow in automatically.

**Activity log**

- "Credit note CN-YYYY-NNNNN issued against INV-YYYY-NNNNN: X KD for reason '{reason}'"
- "FINAL INV-YYYY-NNNNN is now overpaid by X KD — refund available" (when applicable)

**Shared fixture**

Append `makeCreditNotedBookingFixture` to `tests/fixtures/financial.ts`. Builds a cash-deposit booking, settles FINAL fully, then issues a CREDIT_NOTE for a partial amount. Used by Phase 3+ tests.

### Out of Scope

- Wiring 75b's `ReductionRequiresCreditNoteError` to this flow (76c)
- Auto-suggesting refund after overpayment — surfaced as a prompt, but the actual REFUND is a separate manager action (76a)
- CREDIT_NOTE of an ADJUSTMENT — by design, all CREDIT_NOTEs target FINAL even when "logically" reducing what an ADJUSTMENT added (per E9). The ADJUSTMENT stays paid; FINAL receivable is reduced
- DEPOSIT credit notes (deposit forfeits are Phase 4 voucher mechanics, not Phase 3)

---

## Implementation Direction

**Risk:** Medium. CREDIT_NOTE issuance flows through the Phase 1 math directly — bugs in the cap calculation or the DocumentApplication creation could overstate or understate effectivePaid. The four invariants cover most failure modes; the recalc-after-issuance step is the proof point that the math integrates correctly.

**Rollback:** Service rollback removes `createCreditNote`. Issued CREDIT_NOTEs and their DocumentApplications stay in the DB and continue to affect FINAL receivables correctly; no new ones can be issued.

**Interaction with 76a:** If staff issues a CREDIT_NOTE, the customer's FINAL becomes "overpaid" (when previously fully paid). The natural next action is to issue a REFUND (76a). These are two separate manager actions deliberately — keeps money movements explicit.

---

## Verification

- `tests/financial-invariants.test.ts` passes with the four new invariants
- `makeCreditNotedBookingFixture` produces a fully-settled FINAL with a CREDIT_NOTE applied, showing reduced effective receivable
- Manual test: issue a 20 KD CREDIT_NOTE against a 100 KD FINAL paid in full → FINAL's effectivePaid recalculates to "100 paid vs 80 owed = overpaid by 20"; POS shows "credit available, refund?"
- Manual test: attempt to issue a CREDIT_NOTE exceeding the FINAL's remaining capacity → rejected with clear error, no records created
- Manual test: attempt to issue a CREDIT_NOTE against an ADJUSTMENT → rejected (CREDIT_NOTEs target FINAL only)
- Choke-point checker blocks unauthorized creation paths
- Nightly reconciliation reports zero violations
