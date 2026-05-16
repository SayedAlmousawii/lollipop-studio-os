## Goal

Resolve the active `INV-18` divergence in dev order `cmp6tm9n30007n7t3ramturmp`: the same shape that motivated 79a's adjustment-cause ledger and 80a's audit trail is still present in the database from before those fixes landed. Backfill the row by reconciling `ADJ-00003` and `CN-00005` to their causes (not by editing totals), distinguish order-composition reductions from goodwill/manual credits in the INV-18 invariant, and flip `tests/financial/inv-18-regression.test.ts` from failing to passing.

Closes roadmap item **F6**.

---

## Read First

- `context/reviews/77-post-verification-hardening-roadmap.md` — §2 F6
- `context/reviews/77-f6-investigation-finding.md` — the original investigation and Sprint-4 fix shape
- `context/reviews/77-f6-investigation-data.md` — raw composition dump
- `tests/financial/inv-18-regression.test.ts` — the failing repro
- `context/feature-specs/79a-adjustment-cause-ledger-and-paid-reversal.md` — the structural fix that landed
- `context/feature-specs/80a-audit-log-model-and-service.md` — the audit trail that records the backfill

---

## Rules

- The dev row backfill is **causal**, not numerical. Adjust the row so that `ADJ-00003`'s ledger linkage and `CN-00005`'s `targetInvoiceLineId` (added by 79a) point at the correct causing entities. Do not edit `Invoice.totalAmount` or any frozen field.
- Every backfill mutation writes an `AuditLog` entry (80a) describing what was changed and why. The audit row's `actorUserId` is the operator running the backfill; `context.reason = 'F6 backfill: pre-79a divergence'`.
- The INV-18 invariant is updated to distinguish: order-composition-driven reversals (paired with an `AdjustmentReversal` `DocumentApplication`) vs. manual goodwill credits (CREDIT_NOTE rows without a `targetInvoiceLineId`). Order composition must equal `revenue-document net` *after* discounting goodwill credits from the comparison.
- After backfill, `tests/financial/inv-18-regression.test.ts` passes. The test is *not* modified to make it pass — only the underlying paths and the dev row.

---

## Scope

### In Scope

**Update INV-18 invariant**

In `tests/financial-phase-f/invariants.ts` (or wherever INV-18 lives), update the invariant body. Pseudocode:

```ts
// Old: orderComposition === sum(revenue documents)
// New: orderComposition === sum(revenue documents) - sum(goodwill CREDIT_NOTE applications)
//   where goodwill = CREDIT_NOTE application with targetInvoiceLineId IS NULL
```

This makes manual CREDIT_NOTEs (which legitimately reduce revenue without changing order composition) invisible to INV-18.

**Backfill script**

`scripts/f6-backfill-inv-18.ts`:

1. Read `cmp6tm9n30007n7t3ramturmp`'s state into a typed snapshot.
2. Determine which `ADJ-00003` line corresponds to which historical addon. From the finding doc: Album 20x20 caused `ADJ-00003`. Find the order-line history (via `OrderActivity` and/or recent timestamps); identify the `addOnId` of the (now-removed) Album 20x20 entry.
3. Populate `ADJ-00003`'s `InvoiceLineItem.causeOrderEntityKind = 'ADDON'`, `causeOrderEntityId = <the historical addon id, if recoverable; else null with a recorded reason>`.
4. For `CN-00005`: determine whether it was a goodwill credit (no order-composition removal at issuance time) or a reversal that should target `ADJ-00003`. Per the finding, it was a *manual* CREDIT_NOTE issued without a corresponding order-line reduction. Leave `targetInvoiceLineId = NULL`. Add a `notes` annotation: `'Pre-79a manual CREDIT_NOTE; classified as goodwill by F6 backfill.'`
5. Each write writes an `AuditLog` entry (80a path) tied to the affected invoice line / document application, with `actor = <backfill operator>` and `context.reason = 'F6 backfill: pre-79a divergence'`.
6. Run the script inside a single transaction. Rollback on any failure.
7. The script is **idempotent**: a second run produces no changes.

**Verify the repro test flips**

After the script runs against the dev DB:

- `npm run test -- tests/financial/inv-18-regression.test.ts` passes.
- The test setup constructs the same shape against the test DB; it now expects the post-fix outcome.

If the test still fails because the structural fix only handles *new* edits going forward (not the historical dev row), update the test setup to use the canonical post-79a path (`recordPayment` + paid-ADJUSTMENT reversal triggers automatic CREDIT_NOTE), removing any manual CREDIT_NOTE step that was simulating the broken pre-79a behavior.

**Reconciliation verification**

After backfill, run the nightly reconciliation. Confirm:
- `INV-18` reports zero violations.
- `paid-adjustment-line-removal-must-have-reversal` (79a's invariant) reports zero violations.
- `locked-invoice-frozen-fields-match-snapshot` (80b's invariant) reports zero violations.

### Out of Scope

- Backfilling other historical orders. None are currently known to violate INV-18; the invariant catches any future cases. If new violations surface after this spec, treat them as separate one-shot operator tasks reusing this script's pattern.
- Changing the structural fix from 79a — already shipped.
- New `AuditLog` shape — already shipped in 80a.
- The S3 browser role-negative test suite — still deferred per §12.

---

## Implementation Direction

**Risk:** Medium. The structural code paths are all in place from 79a/80a/80b. The risk is the backfill itself: editing financial data, even with audit, requires care. Idempotency + co-transactional audit + the existing 80b trigger together limit the blast radius. The script is dev-only initially; if a similar shape is found in production, the same script runs there with the same audit guarantees.

**Order of work:**

1. Update INV-18 invariant first. Confirm dev still reports the violation (the manual CREDIT_NOTE filter doesn't yet apply because `CN-00005`'s targetInvoiceLineId is currently null *and* the order composition is still mismatched). This step alone may flip the invariant if `CN-00005`'s targetInvoiceLineId really is null — verify.
2. Write the backfill script. Dry-run mode first (print intended changes, no writes).
3. Run dry-run; review printed diff with the owner; only then run with writes enabled.
4. After successful run, re-run reconciliation. All three invariants green.
5. Flip the regression test setup as needed; confirm it passes.
6. Commit the script + test changes together.

**Why a script not a migration:** the operation is a one-shot data fix on an identified row, not a schema change. Migrations are for schema; scripts are for data backfills. The audit log records the change either way.

**Rollback:** the audit log records exactly what was changed. If a backfill decision is later determined wrong, a counter-script reverses the specific writes (also audited). The dev DB is non-production; in the worst case, restore from snapshot.

---

## Verification

- `tests/financial/inv-18-regression.test.ts` passes.
- INV-18 invariant reports zero violations on dev.
- `paid-adjustment-line-removal-must-have-reversal` invariant reports zero violations on dev.
- `locked-invoice-frozen-fields-match-snapshot` invariant reports zero violations on dev.
- Running the backfill script a second time produces no DB changes (idempotency).
- Audit log shows the backfill writes with the expected `context.reason`.
- `npm run build` passes.
- `npm run lint` passes.

---

## Post-Implementation

- Update `context/reviews/77-post-verification-hardening-roadmap.md`: mark F6 as completed.
- Update `progress-tracker.md`.
- **Sprint 4 milestone: financial architecture is now frozen.** Run the full invariant + reconciliation suite against production-shape data per §10's freeze condition. After green, Phase 4 (vouchers) is unblocked.
