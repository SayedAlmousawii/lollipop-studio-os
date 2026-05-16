## Goal

Lift the `ReductionRequiresCreditNoteError` hard-block that Phase 2 (75b) introduced on reductive edits of locked FINAL invoices. Wire the classifier's `creditNoteRequired` events into the `createCreditNote` flow so reductions become first-class edit operations — staff confirms intent, the CREDIT_NOTE is issued, FINAL's effective receivable updates automatically. Atomic mixed edits (additions + removals in one save) produce both an ADJUSTMENT and a CREDIT_NOTE in the same transaction.

Depends on 76a (REFUND mechanics — referenced for the overpayment prompt) and 76b (CREDIT_NOTE primitives). Closes out Phase 3.

---

## Read First

- 75b's classifier and `ReductionRequiresCreditNoteError` — the entry point being wired here
- 76b's `createCreditNote` helper — the destination
- 76a's REFUND flow — surfaced when the CREDIT_NOTE creates an overpayment
- `src/modules/invoices/invoice.service.ts:217` — `syncOrderInvoiceForFinancialEdit` (where 75b put the dual-read)
- `~/.claude/projects/-Users-bo3li-Desktop-lollipop-studio-os/memory/project_financial_review_2026_05.md` — E2, E3, E4, E9, E11 (all relevant here)

---

## Rules

- Reductive order edits no longer hard-block — they require manager confirmation, then issue a CREDIT_NOTE.
- Atomic mixed edits per E4: if a single save contains both additions and reductions, both an ADJUSTMENT (per 75a) and a CREDIT_NOTE (per 76b) are issued in the same DB transaction. Either both succeed or both fail.
- The CREDIT_NOTE issued in response to a classifier reduction event uses the source line's snapshot for description + amount — staff does not re-type line data.
- Manager confirmation is required at the UI layer before any reductive edit completes. Without confirmation, the save is held in a "pending manager approval" state — the order edit is not silently rolled back, but no CREDIT_NOTE is issued until manager approves.
- All CREDIT_NOTEs from this flow target FINAL (per E9) regardless of which classifier event triggered them.
- After CREDIT_NOTE issuance, if FINAL becomes overpaid (per 76b), POS surfaces the "issue refund?" prompt (76a). Refund is the staff's separate explicit action.

---

## Scope

### In Scope

**Lift the `ReductionRequiresCreditNoteError` block**

In 75b's `syncOrderInvoiceForFinancialEdit` new path:

Before this spec:
```ts
if (result.creditNoteRequired.length > 0) {
  throw new ReductionRequiresCreditNoteError(result.creditNoteRequired);
}
```

After this spec — wire the reduction events through to `createCreditNote`, but gated on manager confirmation:

```ts
if (result.creditNoteRequired.length > 0) {
  if (!input.managerApprovedReductionByUserId) {
    // First-pass call: surface the pending reduction back to the UI for confirmation.
    return {
      kind: 'PENDING_MANAGER_APPROVAL',
      reductions: result.creditNoteRequired,
      adjustmentLines: result.adjustmentLines,  // for atomic-mixed display per E4
    };
  }
  // Manager-approved second-pass call:
  await createCreditNote({
    targetFinalInvoiceId: finalInvoice.id,
    lines: result.creditNoteRequired.map(req => ({
      description: `Reduction: ${req.lineSnapshot.name}`,
      quantity: 1,
      unitPrice: req.amount,
    })),
    reason: input.managerApprovedReason ?? 'Reduction from order edit',
    createdByUserId: input.managerApprovedReductionByUserId,
  }, tx);
}

// Continue with additions (75a's createAdjustmentInvoice) — both run in same tx for E4.
if (result.adjustmentLines.length > 0) {
  await createAdjustmentInvoice({ ... }, tx);
}
```

**Order-edit save flow updates**

The order-edit endpoint (`src/modules/orders/order.service.ts` — the save handler) accepts new input fields:
- `managerApprovedReductionByUserId?: string` — the manager who confirmed the reduction
- `managerApprovedReason?: string` — the reason captured at confirmation time

When the first save call returns `PENDING_MANAGER_APPROVAL`, the UI prompts the manager for approval + reason and re-submits with the new fields set.

**Atomic mixed edits (E4)**

Both `createCreditNote` and `createAdjustmentInvoice` execute in the same transaction. If either fails, both roll back. The classifier's `result.adjustmentLines` and `result.creditNoteRequired` are co-issued in one save.

Activity log entries for mixed edits reference each other:
- "Auto-adjustment issued: ADJ-... (paired with CN-...)"
- "Credit note issued: CN-... (paired with ADJ-...)"

**Overpayment surfacing (link to 76a)**

After the transaction commits, if the FINAL's recomputed `effectivePaid > totalAmount`:
- Set the `isOverpaid` derived flag (76b)
- POS settlement view surfaces an "Overpaid by X KD — issue refund" banner (data plumbing only — actual refund UI was built in 76a)

**UI flow**

1. Staff opens order edit, performs reductive change (e.g., removes an add-on), saves.
2. Save returns `PENDING_MANAGER_APPROVAL` with the reduction summary.
3. UI shows a confirmation dialog: "This reduces the invoice by X KD via credit note. Manager confirmation required. Reason:"
4. Manager confirms (their userId is captured separately from the editing staff member's).
5. Save re-submits with manager approval fields.
6. Server issues CREDIT_NOTE (+ optional ADJUSTMENT for E4 mixed cases) in one transaction.
7. UI refreshes the POS view; if FINAL is now overpaid, the refund banner appears.

If the editing staff member is themselves a manager, the dialog still appears (deliberate friction — reductions require explicit intent, not just role) but they can confirm in-place.

**Remove the `BlockedEditError` paths that should now flow through**

Audit 75b's `BlockedEditError` cases (E5 — direct priceSnapshot edit). E5 remains blocked — direct priceSnapshot edits are still forbidden. Staff who want to correct a priceSnapshot must delete + re-add (which routes through this CREDIT_NOTE + ADJUSTMENT flow naturally).

**Cutover**

This spec does NOT introduce a feature flag. The classifier path is already controlled by 75b's `FINANCIAL_REARCH_PHASE_2_AUTO_ADJUSTMENT` flag — if 75b has been fully cut over (Commit C of 75b complete), this spec lights up immediately on merge. If 75b is mid-window, this spec waits for 75b's cutover before merging.

**Invariant registrations**

```ts
registerInvariant({
  name: 'classifier-reductions-have-matching-credit-note',
  scope: 'global',
  run: /* if activity log records a classifier reduction event for an order, a CREDIT_NOTE issued at the same timestamp against that order's FINAL must exist. (Best-effort — uses activity log + timestamps.) */,
});
```

**ADR**

Add `src/modules/financial/decisions/002-mixed-edits-are-atomic.md`:
> Edits that produce both additions and reductions in one save are atomic — one ADJUSTMENT + one CREDIT_NOTE in the same transaction. Failure of either rolls back both. Reason: order-edit save flows must not produce partial states.

**Shared fixtures**

Append `makeMixedEditBookingFixture` to `tests/fixtures/financial.ts`. Builds a settled booking, performs a mixed edit (add one upgrade + remove another), confirms ADJUSTMENT + CREDIT_NOTE both exist with matched timestamps.

### Out of Scope

- Customer-facing display of credit notes / refunds — internal POS only in this spec
- Refund UX integration into the post-CREDIT_NOTE overpayment scenario — banner only; the refund action itself lives in 76a's UI
- DEPOSIT reductions — deposits are non-refundable per current policy
- "Undo edit" feature — if staff issues a CREDIT_NOTE in error, the recovery path is to issue an ADJUSTMENT for the same amount (not a reverse-CREDIT_NOTE)
- Bulk reductions across multiple invoices

---

## Implementation Direction

**Risk:** Medium-high. This is where the classifier's blocked state opens up to real financial reductions, and where atomic mixed-edit semantics matter most. The transaction wrapping is critical — if the createCreditNote succeeds but createAdjustmentInvoice fails, the FinancialCase would be in a corrupt state where a reduction was applied but the offsetting addition was not.

**Rollback:** Revert this spec's changes; `ReductionRequiresCreditNoteError` reinstates as a hard block. Existing CREDIT_NOTEs issued via this flow remain valid in the DB. No data corruption — the worst case is staff temporarily losing the ability to do reductive edits, falling back to manual `createCreditNote` invocations.

**Why no dual-read here:** the change is "an error path becomes a working flow." There's no calculation to compare. The invariant suite + integration tests with `makeMixedEditBookingFixture` are the verification mechanism.

---

## Verification

- `tests/financial-invariants.test.ts` passes
- `makeMixedEditBookingFixture` produces a settled booking with an ADJUSTMENT and a CREDIT_NOTE both attached to FINAL via correct mechanisms (PaymentAllocation for ADJ, DocumentApplication for CN)
- Manual test: locked FINAL exists; staff removes an OrderAddOn via order edit → save returns PENDING_MANAGER_APPROVAL with the reduction summary → manager confirms with reason → CREDIT_NOTE is issued, FINAL's effective receivable reduces accordingly
- Manual test: mixed edit (add upgrade + remove upgrade in one save) → both ADJUSTMENT and CREDIT_NOTE created in one transaction with matching activity log entries
- Manual test: failed mixed edit (e.g., simulate createAdjustmentInvoice failure) → no CREDIT_NOTE created either; transaction rolled back cleanly
- Manual test: removing an add-on from a fully-paid FINAL → CREDIT_NOTE issued; FINAL flagged as overpaid; POS shows the "issue refund" banner; staff then triggers 76a's refund flow
- Nightly reconciliation reports zero violations
