## Goal

Close the paid-ADJUSTMENT reversal gap surfaced by Feature 77 review and confirmed by the [F6 investigation](../reviews/77-f6-investigation-finding.md): when an addition is made to a locked order, an ADJUSTMENT invoice line is issued and (often) paid; but when the *same* addition is later reduced or removed, the edit classifier today treats it as a generic reduction and produces a CREDIT_NOTE that applies to the **FINAL** invoice rather than reversing the **ADJUSTMENT** invoice that actually carried the charge. Once the FINAL is over-credited and the ADJUSTMENT remains untouched, order composition and revenue documents diverge.

This spec adds a causal link from each ADJUSTMENT invoice line back to the order entity that caused it (addon row, upgrade row, extra-photo row, package-tier-upgrade marker), and teaches the classifier to route a reduction's reversal at the *causing ADJUSTMENT*, issuing a paired CREDIT_NOTE applied via `DocumentApplication` to that ADJUSTMENT invoice. If the ADJUSTMENT was already paid, a paired REFUND invoice + outbound payment is issued via the existing refund path (76a).

Closes roadmap item **F4**.

---

## Read First

- `context/reviews/77-post-verification-hardening-roadmap.md` — §2 F4
- `context/reviews/77-f6-investigation-finding.md` — root-cause walkthrough of the active dev bug
- `src/modules/financial/edit-classifier.ts` — current classifier
- `src/modules/orders/order.delta.ts` — `EditDelta`, `AdditionEvent`, `ReductionEvent` shapes
- `src/modules/invoices/invoice.service.ts` — `snapshotInvoiceLineItemsWithClient`, ADJUSTMENT issuance path
- `src/modules/invoices/invoice.schema.ts` — `AdjustmentLineInput`
- `prisma/schema.prisma` — `InvoiceLine`, `Invoice`, `DocumentApplication`
- Feature 76a — refund-invoice + outbound-payment primitives (reused here)

---

## Rules

- Every ADJUSTMENT `InvoiceLine` that is issued from a classifier addition must carry a non-null causal link: `(causeOrderEntityKind, causeOrderEntityId)`. ADJUSTMENT lines that are not classifier-sourced (manual adjustments) leave the columns null and are unaffected by this spec.
- A classifier reduction whose cause matches a previously-issued ADJUSTMENT line (same `causeOrderEntityKind` + `causeOrderEntityId`) is a *reversal*, not a generic reduction. Reversals must:
  - Issue a CREDIT_NOTE invoice whose lines reference the ADJUSTMENT lines being reversed.
  - Materialize a `DocumentApplication` from CREDIT_NOTE → ADJUSTMENT (not → FINAL).
  - If the ADJUSTMENT invoice is paid (allocated payments > 0) at reversal time, additionally issue a REFUND invoice via the 76a path with the matching outbound payment.
- A reduction whose cause does **not** match any prior ADJUSTMENT line continues to flow through the current FINAL-credit path. (Removing something that was part of the original FINAL composition still credits the FINAL.)
- The classifier remains pure: it returns the routing decision. Materialization (creating the CREDIT_NOTE/REFUND, allocating the application) stays in the invoice service.
- This spec adds no new permission. Reversal authorization rides on the same locked-edit permission the existing classifier-driven flow already enforces.

---

## Scope

### In Scope

**Schema migration**

Add two nullable columns to `InvoiceLineItem`:

```prisma
model InvoiceLineItem {
  // existing fields …
  causeOrderEntityKind  OrderEntityKind?
  causeOrderEntityId    String?

  @@index([causeOrderEntityKind, causeOrderEntityId])
}

enum OrderEntityKind {
  ADDON
  UPGRADE
  EXTRA_PHOTO
  PACKAGE_TIER_UPGRADE
}
```

Migration is additive — no backfill required for the dev divergence (handled by F6 in Sprint 4). Pre-existing ADJUSTMENT lines remain null-linked and continue under the legacy FINAL-credit path.

**Classifier additions — record the cause**

In `toAdjustmentLine` (edit-classifier.ts:116), include the cause in the output:

```ts
type AdjustmentLineWithCause = AdjustmentLineInput & {
  causeOrderEntityKind: OrderEntityKind;
  causeOrderEntityId: string;
};
```

Each `AdditionEvent` variant already carries the entity id (addon id, upgrade id, extra-photo id, package-tier marker). Plumb that through.

Update `AdjustmentLineInput` in `invoice.schema.ts` to accept the optional cause pair. The ADJUSTMENT materialization path writes both columns when present.

**Classifier reductions — detect reversal**

Extend `classifyEditDelta` to take an additional input: the open (non-zero-remaining) ADJUSTMENT lines for the order, keyed by cause. Today the function receives only `EditDelta`. New signature:

```ts
export function classifyEditDelta(
  delta: EditDelta,
  openAdjustmentLines: ReadonlyMap<string, OpenAdjustmentLine>
): ClassifierResult;

type OpenAdjustmentLine = {
  invoiceLineId: string;
  invoiceId: string;
  causeOrderEntityKind: OrderEntityKind;
  causeOrderEntityId: string;
  remainingAmount: Prisma.Decimal;     // line amount minus already-applied credits
  isPaid: boolean;                      // payments allocated to the parent ADJUSTMENT invoice cover this line
};
```

Key for the map: `` `${kind}:${id}` ``.

`ClassifierResult` gains a new array:

```ts
export type AdjustmentReversal = {
  causingInvoiceLineId: string;
  causingInvoiceId: string;
  amount: Prisma.Decimal;
  requiresRefund: boolean;
  lineSnapshot: { name: string };
};

export type ClassifierResult = {
  netZero: boolean;
  adjustmentLines: AdjustmentLineInput[];
  creditNoteRequired: CreditNoteRequirement[];
  adjustmentReversals: AdjustmentReversal[];   // ← new
  blocked: BlockedEditReason[];
};
```

Inside the reduction loop: before producing a generic `CreditNoteRequirement`, look up the reduction's cause in `openAdjustmentLines`. If found and `remainingAmount >= reduction amount`, emit an `AdjustmentReversal` instead. If the open ADJUSTMENT line only partially covers the reduction, emit a partial reversal + a residual `CreditNoteRequirement` for the remainder.

**Caller — fetch open ADJUSTMENT lines**

The caller of `classifyEditDelta` (in `order.service.ts`'s locked-edit path — search for existing `classifyEditDelta(` call sites) becomes responsible for fetching `openAdjustmentLines` before invoking the classifier. Query shape:

```ts
const openAdjustmentLines = await client.invoiceLine.findMany({
  where: {
    invoice: {
      orderId: order.id,
      invoiceType: InvoiceType.ADJUSTMENT,
    },
    causeOrderEntityId: { not: null },
  },
  select: { /* fields needed to build OpenAdjustmentLine */ },
});
```

`remainingAmount` per line = line amount − sum of `DocumentApplication.amountApplied` against this line's parent ADJUSTMENT invoice that target this line (via existing or new linkage — see *DocumentApplication shape* below).

`isPaid` per line = the parent ADJUSTMENT invoice has any payment allocations (already true → trace via `PaymentAllocation.invoiceId === invoiceLine.invoiceId`).

**DocumentApplication shape**

`DocumentApplication` currently records `(sourceInvoiceId, targetInvoiceId, amountApplied)`. For reversal accounting to be line-precise, add nullable `targetInvoiceLineId`:

```prisma
model DocumentApplication {
  // existing fields …
  targetInvoiceLineId  String?
  @@index([targetInvoiceLineId])
}
```

When materializing a CREDIT_NOTE reversal, the application row carries `targetInvoiceLineId = causingInvoiceLineId`. Existing applications (FINAL-credits, deposit-to-final transfers) leave it null. The "remaining per-line" calculation above uses this column.

**Materialization in invoice service**

Add `applyAdjustmentReversalsWithClient(client, order, reversals)` in `invoice.service.ts`:

1. For each reversal: if there is no open CREDIT_NOTE invoice for this order, create one (existing 76b path).
2. Append a CREDIT_NOTE invoice line for the reversal amount, carrying `causeOrderEntityKind`/`causeOrderEntityId` mirrored from the causing ADJUSTMENT line.
3. Create a `DocumentApplication` row: `source = CREDIT_NOTE.id`, `target = causingInvoiceId`, `targetInvoiceLineId = causingInvoiceLineId`, `amountApplied = reversal.amount`.
4. If `reversal.requiresRefund`: invoke the 76a refund path with the causing ADJUSTMENT as the parent invoice and the reversal amount.
5. Recalculate status for both the ADJUSTMENT and the CREDIT_NOTE via the existing `recalculateInvoiceStatus`.

**Invariant**

Register a new invariant in `src/modules/financial/invariants.ts`:

```ts
{
  name: 'paid-adjustment-line-removal-must-have-reversal',
  scope: 'order',
  description: 'For every ADJUSTMENT line with a non-null cause whose causing order entity no longer exists, there must be a CREDIT_NOTE DocumentApplication targeting that line for the line amount.',
}
```

This invariant runs in the nightly reconciliation pass. After F4 lands, dev order `cmp6tm9n30007n7t3ramturmp` will surface here for Sprint-4 backfill.

**Regression tests**

Canonical focused suite: `tests/financial/adjustment-reversal.test.ts`
(`adjustment reversal regressions A-E`). Existing financial-audit anchors also
exercise the paid reversal path in `tests/financial-invariants.test.ts`
(`financial invariants all pass against seeded fixtures`, auto-adjusted fixture
block) and `tests/financial-phase-c/edge-cases.ts` (`E11`).

- Test A: locked FINAL → add addon (ADJUSTMENT issued, paid in full) → remove addon → expect one CREDIT_NOTE line targeting the ADJUSTMENT line, one REFUND invoice, one outbound payment. FINAL balance unchanged. Covered by `adjustment reversal regressions A-E` scenario A, `financial invariants all pass against seeded fixtures` auto-adjusted fixture block, and Phase C `E11`.
- Test B: locked FINAL → add addon (ADJUSTMENT issued, **unpaid**) → remove addon → expect CREDIT_NOTE targeting ADJUSTMENT, no REFUND. Covered by `adjustment reversal regressions A-E` scenario B.
- Test C: locked FINAL → add upgrade (ADJUSTMENT, paid) → reduce upgrade quantity by 1 of 3 → expect partial reversal (1/3 amount) targeting the ADJUSTMENT, residual nothing (since this is full per-unit cause). Covered by `adjustment reversal regressions A-E` scenario C.
- Test D: locked FINAL with addon present from original composition (NOT in any ADJUSTMENT) → remove addon → expect CREDIT_NOTE targeting FINAL (unchanged legacy behavior). Covered by `adjustment reversal regressions A-E` scenario D.
- Test E: locked FINAL → add addon (ADJUSTMENT, paid, closed) → add second addon (second ADJUSTMENT, paid) → remove the first addon only → expect reversal targets only the first ADJUSTMENT line. Covered by `adjustment reversal regressions A-E` scenario E, including the same-cause overwrite regression extension.

### Out of Scope

- **F6** Backfill of dev order `cmp6tm9n30007n7t3ramturmp` — Sprint 4. The new invariant surfaces it; the fix backfills it.
- **F6** Distinguishing order-composition reductions from goodwill/manual credits in INV-18 reconciliation — Sprint 4. Manual CREDIT_NOTEs (no classifier origin) remain possible and continue to apply to FINAL.
- **The failing `tests/financial/inv-18-regression.test.ts` does NOT flip in this spec.** Its scenario also exercises a separate divergence (manual CREDIT_NOTE on FINAL without order-composition change) that Sprint 4 owns. Confirm: this test continues to fail after F4 lands; do not modify it.
- Legacy deposit-deduction formulas (`calculateFinalBalanceDue`, `mapPOSInvoiceSummary`, `hasBasePayment`) — that is **79b** (F5/D1-D3/A2).
- Overpayment capacity guard (F2) — **79c**.
- Manager-prompt UX on locked-edit reductions (W2/O4) — **79d**.
- Schema-level enforcement that CREDIT_NOTE.targetInvoiceLineId, when set, points to a same-order ADJUSTMENT line — code-level enforcement only this spec; DB constraint is Sprint 3 territory.

---

## Implementation Direction

**Risk:** Medium-high. The classifier is the choke point for every locked-order edit. A bug in the cause-matching logic mis-routes reversals — silently. The invariant + Test A–E coverage is the safety net.

**Order of work:**

1. Migration: add `causeOrderEntityKind`, `causeOrderEntityId` to `InvoiceLine`; add `targetInvoiceLineId` to `DocumentApplication`. Run `npx prisma migrate dev`.
2. Plumb cause through classifier additions and ADJUSTMENT issuance. Existing tests still pass — added columns are null in every legacy path.
3. Extend `classifyEditDelta` signature to take `openAdjustmentLines`. Update the single caller in `order.service.ts` to fetch the map. With the map empty, behavior is identical to today. Land this as a separate commit so behavior change isolates from signature change.
4. Add reversal detection + `AdjustmentReversal` emission. Behavior is now driven by the new column population from step 2.
5. Add `applyAdjustmentReversalsWithClient` and wire it into the locked-edit save path immediately after the existing `creditNoteRequired` materialization.
6. Add Test A first (happy path), then B, C, D, E.
7. Register invariant; run nightly reconciliation locally — confirm dev order `cmp6tm9n30007n7t3ramturmp` surfaces (this is the expected handoff to Sprint 4).

**Why a separate classifier input rather than fetching inside the classifier:** the classifier today is pure (no DB access). Keeping it pure preserves its unit-testability and the existing test suite. The caller is the right place for the DB read.

**Why partial reversal support (Test C):** `ADDON_QUANTITY_DECREASE` is a real path. Without partial support, reducing 3 to 2 would either fully reverse the whole ADJUSTMENT (wrong) or fall through to FINAL-credit (also wrong).

**Rollback:** Each step is independently revertable. The risky moment is step 4 (reversal detection going live) — if it mis-routes, revert just that commit; columns remain populated harmlessly. Migration rollback drops the three new columns; existing rows are unaffected.

---

## Verification

- All five regression tests pass.
- The pre-existing `tests/financial/inv-18-regression.test.ts` still fails with the same `expected=500.000, actual=495.000` shape. (Confirms F4 scope is correct — F6 in Sprint 4 owns the flip.)
- All existing tests pass.
- `npm run build` passes.
- `npm run lint` passes.
- Manual: in dev, take a fresh order, lock the FINAL, add an addon, pay the ADJUSTMENT in full, remove the addon. Confirm a CREDIT_NOTE invoice line exists with `causeOrderEntityKind = ADDON`, a `DocumentApplication` exists with `targetInvoiceLineId` set to the ADJUSTMENT line's id, and a REFUND invoice + outbound payment exist.
- Nightly reconciliation locally surfaces dev order `cmp6tm9n30007n7t3ramturmp` under the new `paid-adjustment-line-removal-must-have-reversal` invariant (expected, awaiting Sprint 4 backfill).
- Grep audit: `grep -rn "classifyEditDelta(" src` returns exactly the same number of call sites as before this spec (signature change is propagated, not duplicated).

---

## Post-Implementation

- Update `context/reviews/77-post-verification-hardening-roadmap.md`: mark F4 as completed; note that F6 test-flip remains Sprint-4 scope.
- Update `progress-tracker.md`.
- Cross-reference: when Sprint 4's F6 spec is drafted, it should reference this spec's invariant as the detection mechanism for the backfill list.
