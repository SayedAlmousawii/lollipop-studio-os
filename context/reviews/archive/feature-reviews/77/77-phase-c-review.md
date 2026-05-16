# 77 Phase C Review - Edge Case Expansion

Date: 2026-05-15

## Scope Completed

Phase C implemented Layer 4 edge-case coverage only:

- E1-E12 classifier and locked-invoice behavior coverage.
- EC-13 through EC-42 service/data edge cases.
- Hidden corruption characterization for direct DB writes, stale refund state, paid adjustment cause removal, missing row-level payment locks, and missing future voucher/commission primitives.

Primary files:

- `tests/financial-phase-c/fixtures.ts`
- `tests/financial-phase-c/edge-cases.ts`
- `tests/financial-phase-c/run.ts`
- `tests/backend-invariants/run.ts`

## Newly Discovered Edge Cases

- Paid ADJUSTMENT cause removal is not financially reversed. Removing an add-on that created a paid ADJUSTMENT leaves the ADJUSTMENT history intact but creates no CREDIT_NOTE and no REFUND invoice because the classifier compares the new order state to the locked FINAL snapshot, not to post-final ADJUSTMENT causes.
- Refund capacity currently uses inbound allocations minus prior refunds, not CREDIT_NOTE-created overpayment. That allows refund documents greater than the actual credit-note overpayment in characterized cases.
- Direct Prisma mutation can unlock a locked invoice because locked-invoice immutability has no DB trigger or constraint.
- Direct cancellation of an order with an open ADJUSTMENT leaves a phantom open receivable because cancellation disposition is not modeled at the service layer.
- Photographer reassignment after check-in can be directly written without order financial impact, but there is no audit/activity entry for the change.

## Classifier Weakness Findings

- The classifier is strong for direct additive/reductive/swap inputs: E1-E5 and E12 pure routing cases now assert equal-price net-zero, non-netted replacement, quantity decrease, mixed edits, blocked price edit attempts, and quantity increases.
- The classifier cannot reason about paid ADJUSTMENT reversal because it only sees FINAL-vs-current deltas. This is the highest-risk classifier gap found in Phase C.
- Valid classifier paths still emit Phase 2 dual-read discrepancy logs because the old path throws on locked edits; this remains observability noise rather than a data failure.

## Corruption-Risk Findings

- Locked invoice state is service-protected only; direct writes can mutate `isLocked`.
- Refund cap enforcement is document/payment based, not overpayment based.
- Payment race safety is not proven by row-level locking; `recordPayment` has no `SELECT ... FOR UPDATE` lock on invoice rows.
- Commission persistence is absent; upgrade hooks are no-ops until the commission unit lands.
- Voucher/GiftCardRedemption schema is absent; current deposit path works, but future voucher-backed booking cannot be represented yet.

## Recommendations

1. Add a DB trigger or audited immutable snapshot for locked invoice fields.
2. Change refund capacity to use actual overpayment/credit availability, not total inbound allocations.
3. Add an explicit paid-adjustment reversal workflow: CREDIT_NOTE against FINAL plus REFUND eligibility when the ADJUSTMENT is already paid.
4. Add row-level locking or optimistic version checks around payment balance reads.
5. Model order cancellation disposition for open ADJUSTMENT invoices.
