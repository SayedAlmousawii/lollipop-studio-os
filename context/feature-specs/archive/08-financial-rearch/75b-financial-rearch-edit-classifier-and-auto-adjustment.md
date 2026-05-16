## Goal

Wire order edits on locked FINAL invoices into the auto-ADJUSTMENT flow. Replace the "Locked invoices cannot be recalculated from order edits" throw with a classifier that detects edit deltas, separates additive vs reductive changes, and auto-spawns ADJUSTMENT invoices for additions. Reductions still error out — they route to the explicit CREDIT_NOTE flow in Phase 3 (spec 76b).

Depends on 75a (createAdjustmentInvoice helper exists).

---

## Read First

- `context/Financial reviews/financial-rearchitecture-master-plan.md` — Phase 2 resolved decisions
- `~/.claude/projects/-Users-bo3li-Desktop-lollipop-studio-os/memory/project_financial_review_2026_05.md` — full E1–E12 edge case resolutions (this spec implements them)
- `src/modules/invoices/invoice.service.ts:217` — current `syncOrderInvoiceForFinancialEdit` entry point
- `src/modules/invoices/invoice.service.ts:287-288` — the throw being replaced
- `src/modules/orders/order.service.ts` — every code path that mutates an order's commercial state (add-on add/remove, upgrade add/remove, extra-photo add/remove, package tier change) and calls `syncOrderInvoiceForFinancialEdit`
- `src/modules/financial/dual-read.ts` — the dual-read helper from 73b (used for the verification window)

---

## Rules

- The classifier is the **only** code that decides ADJUSTMENT vs CREDIT_NOTE-required vs net-zero. No business logic about additive/reductive lives in `order.service.ts` — order code reports the edit; the classifier interprets it.
- Net-zero edits per E1 produce no Invoice and no DB write to the financial side. Activity log only.
- Mixed additive + reductive edits in one save per E4 are atomic: if the reductive side cannot be resolved (Phase 3 not yet built), the entire save fails — never produce a partial result.
- During the verification window, the classifier dual-reads against the current "throw on any locked edit" behavior. Discrepancies log; old behavior remains authoritative until cutover at the end of this spec.
- Manual surcharges (E7) and manual discounts (E6) do NOT flow through the classifier — they are explicit manager actions handled outside this code path (the classifier interprets *order-edit-triggered* changes only).

---

## Scope

### In Scope

**Edit-delta computation**

A new function `computeOrderEditDelta(orderId, tx)` in `src/modules/orders/order.delta.ts` (new file):

Given a current order state and the locked FINAL's snapshotted line items, produce a structured diff:

```ts
type EditDelta = {
  additions: AdditionEvent[];
  reductions: ReductionEvent[];
  swaps: SwapEvent[];           // E1, E2 — paired add/remove
};

type AdditionEvent =
  | { kind: 'NEW_ADDON'; orderAddOnId: string; nameSnapshot: string; priceSnapshot: Money; quantity: number }
  | { kind: 'NEW_UPGRADE'; orderPackageItemUpgradeId: string; nameSnapshot: string; priceSnapshot: Money; quantity: number }
  | { kind: 'ADDON_QUANTITY_INCREASE'; orderAddOnId: string; deltaQuantity: number; lineSnapshot: { name: string; unitPrice: Money } }
  | { kind: 'NEW_EXTRA_PHOTO'; /* ... */ }
  | { kind: 'PACKAGE_TIER_UPGRADE'; oldPriceSnapshot: Money; newPriceSnapshot: Money };

type ReductionEvent =
  | { kind: 'REMOVED_ADDON'; lineSnapshot: { name: string; totalValue: Money } }
  | { kind: 'REMOVED_UPGRADE'; lineSnapshot: { name: string; totalValue: Money } }
  | { kind: 'ADDON_QUANTITY_DECREASE'; deltaQuantity: number; lineSnapshot: { name: string; unitPrice: Money } }
  | { kind: 'REMOVED_EXTRA_PHOTO'; /* ... */ }
  | { kind: 'PACKAGE_TIER_DOWNGRADE'; oldPriceSnapshot: Money; newPriceSnapshot: Money }
  | { kind: 'PRICE_SNAPSHOT_EDIT_ATTEMPT'; /* E5 — flagged for explicit block */ };

type SwapEvent =
  | { kind: 'UPGRADE_REPLACEMENT'; removedPriceSnapshot: Money; addedPriceSnapshot: Money };
```

The delta is computed against the **invoice line items snapshotted at FINAL close**, NOT against the live order's previous-edit state. The locked FINAL's line items are the source of truth for "what the customer agreed to pay."

**Edit classifier**

A new function `classifyEditDelta(delta: EditDelta): ClassifierResult` in `src/modules/financial/edit-classifier.ts` (new file):

```ts
type ClassifierResult = {
  netZero: boolean;                 // E1 case — no records
  adjustmentLines: AdjustmentLineInput[];   // additive lines for createAdjustmentInvoice
  creditNoteRequired: CreditNoteRequirement[]; // reductive events that need Phase 3
  blocked: BlockedEditReason[];     // E5 attempts, etc.
};

type CreditNoteRequirement = {
  reason: 'REMOVED_ADDON' | 'REMOVED_UPGRADE' | 'ADDON_QUANTITY_DECREASE' | 'REMOVED_EXTRA_PHOTO' | 'PACKAGE_TIER_DOWNGRADE' | 'UPGRADE_REPLACEMENT_REDUCTION_SIDE';
  amount: Money;
  lineSnapshot: { name: string };
};
```

Classifier rules implementing E1–E12:

- **E1 (equal-price swap):** if a `SwapEvent` has `removedPriceSnapshot.eq(addedPriceSnapshot)`, emit nothing for that swap. The swap becomes an activity log entry only.
- **E2 (non-equal swap):** emit one `AdjustmentLineInput` for the added side's full price + one `CreditNoteRequirement` for the removed side's full price. Never net the two.
- **E3 (quantity decrease):** emit one `CreditNoteRequirement` with `amount = deltaQuantity * unitPrice`.
- **E4 (mixed edits in one save):** the classifier simply produces both `adjustmentLines` and `creditNoteRequired` arrays in the same result. The caller's transaction handling makes the save atomic.
- **E5 (priceSnapshot edit attempt):** any `PRICE_SNAPSHOT_EDIT_ATTEMPT` produces a `BlockedEditReason`. The save fails with a clear error.
- **E8 (no ADJ chaining):** the classifier is unaware of chaining — it always produces output relative to the original FINAL. The `createAdjustmentInvoice` helper enforces `parentInvoiceId = FINAL.id` per 75a.
- **E12 (quantity increase):** emit one `AdjustmentLineInput` with `quantity = deltaQuantity`.

**Replace the throw in `syncOrderInvoiceForFinancialEdit`**

Current behavior (line ~287-288): `if (existingInvoice?.isLocked) throw new Error("Locked invoices cannot be recalculated from order edits")`.

New behavior — wrap in the 73b `dualRead` helper:

```ts
await dualRead({
  phase: 'phase-2-classifier',
  path: 'invoice.syncOrderInvoiceForFinancialEdit',
  entityId: order.id,
  flagKey: 'FINANCIAL_REARCH_PHASE_2_AUTO_ADJUSTMENT',
  oldFn: async () => {
    if (existingInvoice?.isLocked) throw new Error("Locked invoices cannot be recalculated from order edits");
    return await /* existing recalc path */;
  },
  newFn: async () => {
    if (existingInvoice?.isLocked) {
      const delta = await computeOrderEditDelta(order.id, tx);
      const result = classifyEditDelta(delta);

      if (result.blocked.length > 0) {
        throw new BlockedEditError(result.blocked);   // E5, etc.
      }

      if (result.creditNoteRequired.length > 0) {
        // Phase 3 not built yet — every reduction is a hard block during Phase 2.
        // The error message is operational guidance for staff.
        throw new ReductionRequiresCreditNoteError(result.creditNoteRequired);
      }

      if (result.netZero && result.adjustmentLines.length === 0) {
        // E1 — pure net-zero swap. No records.
        await logActivityForNetZeroSwap(order.id, delta, tx);
        return /* same shape as old recalc result */;
      }

      if (result.adjustmentLines.length > 0) {
        await createAdjustmentInvoice({
          parentFinalInvoiceId: existingInvoice.id,
          lines: result.adjustmentLines,
          notes: `Auto-ADJUSTMENT from order edit on ${new Date().toISOString()}`,
        }, tx);
      }

      return /* same shape as old recalc result */;
    }
    return await /* existing unlocked recalc path */;
  },
  authoritative: 'old',     // verification window: old behavior wins; new path shadow-runs
});
```

**Feature flag declaration**

Add `FINANCIAL_REARCH_PHASE_2_AUTO_ADJUSTMENT` to the project flag system. Default ON (dual-read shadow-running). Cutover (flip authoritative to 'new', then remove the old throw and the flag) is a small follow-up release after a verification window with zero discrepancies.

**Activity log entries**

For every non-throwing path:
- Net-zero swap (E1): activity log "Upgrade swapped (equal price)" with old/new names.
- Auto-ADJUSTMENT issued: activity log "Auto-adjustment issued: ADJ-YYYY-NNNNN for X KD" with the line summary.
- Blocked reduction (Phase 2 hard block): activity log "Edit blocked — requires credit note (Phase 3 not yet available)."

**Invariant registration**

```ts
registerInvariant({
  name: 'no-adjustment-without-classifier-source',
  scope: 'global',
  run: /* every ADJUSTMENT either has a corresponding activity log entry referencing a classifier event, or has a 'createdByUserId' set (for future manual cases) */,
});
```

(This invariant becomes more useful once Phase 2 ADJUSTMENTs have been in production for a while; consider it best-effort.)

**Choke-point pattern**

Append to `scripts/check-financial-choke-points.sh`:
- Forbid direct construction of "additive vs reductive" classifications outside `src/modules/financial/edit-classifier.ts`. Pattern is harder to encode in shell — at minimum, document the rule.

**Fixtures**

Extend `makeAdjustedBookingFixture` (from 75a) with two variants:
- `makeAutoAdjustedBookingFixture` — uses the classifier path (post-cutover) to create the ADJUSTMENT instead of calling `createAdjustmentInvoice` directly. Verifies the end-to-end flow.

### Out of Scope

- CREDIT_NOTE issuance flow (Phase 3, spec 76b) — until that ships, every reductive edit on a locked FINAL is a hard block in production. This is acceptable: locked-invoice reductions are rare and currently impossible anyway.
- POS UI for displaying / paying ADJUSTMENT invoices (75c)
- Manual "issue surcharge" action (E7) — that's a manager-action UI, not auto-classifier territory. Lives in a small follow-up spec.
- Concurrent edit handling (E10) — pure UX; flagged in the spec but no implementation here. The existing optimistic-update behavior in `order.service.ts` already produces a reasonable error.

---

## Implementation Direction

**Phased rollout within this spec:**
1. Commit A: classifier + delta + new path wired behind `dualRead` flag (authoritative = old). Ship to prod. Observe the `financial.rearch.dual_read.discrepancy{phase=phase-2-classifier}` metric.
2. Verification window: zero discrepancies across one release cycle. Manually exercise locked-invoice edit paths in staging to populate the new-path code with traffic.
3. Commit B: flip flag to authoritative = new. Ship. Observe for 24h.
4. Commit C: remove the old throw, remove the dual-read wrapper, remove the flag. Done.

**Why dual-read here:** the current production behavior is "throw on every locked edit." The new behavior is "classify and route." Both can run side-by-side: when old throws and new returns successfully without error, that's "discrepancy in the user-friendly direction" — log but allow. When new throws and old would have thrown, no discrepancy. The verification value is small (the current behavior is trivial) but the dual-read pattern is consistent with Phase 1's cutover and gives a clean rollback if the classifier mishandles an unexpected edit shape.

**Risk:** Medium. The classifier is new behavior. Edge cases will appear in real usage that the E1–E12 enumeration didn't anticipate. The hard-block-on-reduction policy is the safety net: anything the classifier can't categorize as "obviously additive" routes to the reduction-requires-credit-note error, which staff resolves manually until Phase 3.

**Rollback:** Flip flag back to authoritative = old. Existing throw resumes; any ADJUSTMENT invoices already created by the new path remain valid but no new ones are created.

---

## Verification

- `tests/financial-invariants.test.ts` passes
- `makeAutoAdjustedBookingFixture` creates an ADJUSTMENT through the full classifier path
- Manual staging test: lock a FINAL invoice, add an OrderAddOn via the order edit flow, confirm ADJUSTMENT is created with the right line and total
- Manual staging test: lock a FINAL, remove an OrderAddOn, confirm clean `ReductionRequiresCreditNoteError` is returned (Phase 3 not yet built)
- Manual staging test: lock a FINAL, swap two equal-price upgrades, confirm no records created and activity log entry present
- Manual staging test: lock a FINAL, attempt to edit a line's `priceSnapshot`, confirm `BlockedEditError` for E5
- Zero `financial.rearch.dual_read.discrepancy{phase=phase-2-classifier}` WARN logs across the verification window
- After Commit C: `grep -n "Locked invoices cannot be recalculated"` in `src/` returns no results
