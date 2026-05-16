# 77 Phase G Production Reconciliation Review

Date: 2026-05-15

Scope: Layer 10 - Production Reconciliation Architecture. This phase implemented safe detection and reporting only. No auto-repair behavior was added.

## Implemented Runner

- Added `src/modules/financial/reconciliation.service.ts` as the production reconciliation service.
- Updated `scripts/financial-reconciliation.ts` to use `FINANCIAL_RECON_DATABASE_URL` when present and to require it in production.
- The runner executes inside a PostgreSQL `READ ONLY` transaction before any invariant query runs.
- The script emits a structured JSON report to stdout and posts Slack-style alert payloads when configured.
- Missing Slack webhook configuration is non-fatal and logged, so the runner does not silently drop alert content during local or misconfigured runs.

## Violation Reporting Structure

Each violation reports:

- `invariantId`
- `severity` (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`)
- `affectedEntityType`
- `affectedEntityIds`
- `description`
- `detectedAt`
- `queryContext`

Each report includes:

- `runAt`
- `businessDateStart`
- `businessDateEnd`
- `invoicesChecked`
- `paymentsChecked`
- `allocationsChecked`
- `applicationsChecked`
- `violations`
- `durationMs`
- `status`

## Invariants Covered

- `INV-01`: every Payment has exactly one PaymentAllocation.
- `INV-08`: no ADJUSTMENT invoice chains to another ADJUSTMENT.
- `INV-09`: CREDIT_NOTE document applications target FINAL invoices.
- `INV-11`: REFUND invoice payments use OUT direction.
- `INV-15`: DEPOSIT invoices are closed and locked.
- `INV-16`: PaymentAllocation references resolve.
- `INV-17`: DocumentApplication source and target references resolve.
- `INV-18`: FinancialCase invoice revenue reconciles to current order package/add-on/upgrade/extra-photo totals.
- `INV-19`: FINAL invoices resolve to an order path.
- `INV-24`: open invoices cannot have effective paid amount above total.
- `INV-PREFIX`: invoice number prefix matches invoice type.
- `INV-REV`: completed-order inbound revenue reconciles for the nightly business-day window.

## Alerting Verification

- Phase G added `tests/financial-phase-g/reconciliation.ts`.
- The test runs the reconciliation service against the isolated backend invariant schema after the earlier financial phases have seeded real rows.
- The test inserts deliberate reconciliation-risk records at the end of the suite:
  - a Payment without a PaymentAllocation
  - an ADJUSTMENT chained to another ADJUSTMENT
  - an ADJUSTMENT with an invalid invoice number prefix
- The resulting report verifies severity classification:
  - missing allocation = `CRITICAL`
  - adjustment chaining = `HIGH`
  - prefix mismatch = `MEDIUM`
- Alert construction and posting are verified with an in-memory alert transport.

## Read-Only Verification

- The runner uses `SET TRANSACTION READ ONLY`.
- Phase G directly verifies the guard by attempting an invoice update inside the same read-only transaction and asserting PostgreSQL rejects it.
- The fixture confirms the invoice row remains unchanged after the rejected write.

## Monitoring Recommendations

- Configure production with a read-only replica URL in `FINANCIAL_RECON_DATABASE_URL`.
- Configure `FINANCIAL_RECON_SLACK_WEBHOOK` and `FINANCIAL_RECON_SLACK_CHANNEL`.
- Schedule the command nightly at 02:00 studio local time.
- Monitor runner exit codes:
  - `0`: passed
  - `1`: reconciliation completed and found violations
  - `2`: runner failed before producing a trustworthy report
- Capture stdout JSON as the durable run artifact until a future `reconciliation_runs` table is approved.
- Alert separately if no successful reconciliation report is captured for more than 24 hours.

## Reconciliation-Risk Findings

- No DB-backed `reconciliation_runs` table was added because this phase must remain read-only and the data rule did not authorize schema/backend persistence changes.
- Slack outage is non-fatal; alert payloads are still written to logs, but production should monitor missing Slack delivery separately.
- The business-day revenue window uses the studio UTC+03 assumption currently matching Kuwait. If studio timezone requirements change or DST becomes relevant, replace the fixed offset with an explicit timezone conversion utility.
- `INV-18` intentionally compares current order state to revenue documents. Existing known gaps around refund capacity, paid-adjustment reversal, and commission persistence may surface here as findings rather than being auto-repaired.
- The runner reports violations only. Repair remains manual, reviewed, and outside this phase.
- Local dev database smoke run on 2026-05-15 found one real `INV-18` `HIGH` violation: order `cmp6tm9n30007n7t3ramturmp` / financial case `cmp6tlvc70002n7t3yucyvf96` had current order total `230.000` KD and revenue-document total `225.000` KD. This was reported only; no repair was attempted.

## Validation

- `npm run test:backend-invariants` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `npm run financial:reconcile` executed against the local dev DB with an approved DB connection; it exited `1` because it correctly reported the `INV-18` violation above.
