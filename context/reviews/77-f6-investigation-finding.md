# 77 F6 INV-18 Investigation Finding

## Commands Used

Reproduced the mismatch with:

```sh
npm run financial:reconcile
```

Inspected the scoped order with a read-only Prisma transaction (`SET TRANSACTION READ ONLY`) against `DATABASE_URL`, selecting the order, financial case, invoices, payment allocations, document applications, activities, packages, add-ons, and upgrades for `cmp6tm9n30007n7t3ramturmp`.

Raw composition dump: `context/reviews/77-f6-investigation-data.md`.

Cutover comparison point: commit `ea7da6e67f9261db43987630820cb9e63fdc2d1c` (`feat : 74e`), committed `2026-05-14 18:46:22 +0300` (`2026-05-14T15:46:22Z`).

## 5 KD Breakdown

Current order total is `230.000 KD`:

- Basic Package: `150.000`
- Extra print photos: `5 x 3.000 = 15.000`
- Current add-on: Album 30x30: `65.000`
- Package item upgrades: `0.000`

Revenue-document total is `225.000 KD`:

- FINAL `INV-00002`: `+230.000`
- ADJUSTMENT `ADJ-00003`: `+45.000`
- CREDIT_NOTE `CN-00005`: `-50.000`
- REFUND `REF-00004`: ignored by INV-18 revenue-document formula

So `230.000 + 45.000 - 50.000 = 225.000`, leaving `expected 230.000 - actual 225.000 = 5.000 KD`.

## Root Cause

This is an active divergence, not historical drift.

Every involved row was created after the 74e cutover timestamp:

- FINAL `INV-00002`: `2026-05-15T11:15:44.040Z`
- ADJUSTMENT `ADJ-00003`: `2026-05-15T11:17:44.446Z`
- REFUND `REF-00004`: `2026-05-15T11:19:08.380Z`
- CREDIT_NOTE `CN-00005`: `2026-05-15T11:19:21.971Z`
- Current surviving add-on row: `2026-05-15T11:16:30.566Z`

The shape is reachable through current service paths:

1. A locked FINAL exists at `230.000 KD`.
2. Adding Album 20x20 after lock creates ADJUSTMENT `ADJ-00003` for `45.000 KD`.
3. The ADJUSTMENT is paid and closed.
4. Removing that same add-on removes the order line, but the paid ADJUSTMENT remains in revenue documents with no paired CREDIT_NOTE/REFUND reversal from the classifier.
5. A later manual CREDIT_NOTE for `50.000 KD` applies to the FINAL without a corresponding order-line reduction. That over-corrects the stale `+45.000 KD` adjustment by `5.000 KD`.

The immediate scoped mismatch is therefore the net of two currently reachable behaviors: paid-ADJUSTMENT cause removal is not reversed, and manual CREDIT_NOTE issuance can reduce revenue without changing order composition.

## Repro Test

Added `tests/financial/inv-18-regression.test.ts`.

The test builds the same active shape in an isolated test schema: locked FINAL, paid add-on ADJUSTMENT, removal of the adjustment cause, then a manual CREDIT_NOTE sized to leave an exact `5.000 KD` INV-18 gap. It intentionally asserts the desired invariant outcome, so it fails under current code until Sprint 4 fixes the underlying paths.

## Sprint 4 Fix Shape

Sprint 4 should make revenue reductions causally traceable to order composition. The minimum fix is to add an adjustment-cause ledger or equivalent linkage so removing a paid ADJUSTMENT cause issues the correct CREDIT_NOTE/REFUND reversal against that adjustment, and to distinguish order-composition reductions from goodwill/manual credits in INV-18. After the service path is corrected, backfill the dev row by reconciling `ADJ-00003` and `CN-00005` to their causes rather than directly editing totals.

Classification: **Active bug — root cause identified, repro test added.**
