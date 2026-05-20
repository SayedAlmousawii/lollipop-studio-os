# R13 Freeze Checklist

This is the canonical R13 freeze gate checklist. The source-of-truth matrix is `context/reviews/r13-verification-inventory.md`.

## Automated Gates (Must Pass)

- `npm run build`
- `npm run lint`
- `npm run test:backend-invariants`
  - Includes R13c Workflow Smoke files: `tests/backend-invariants/booking-confirmation-checkin.smoke.ts`, `tests/backend-invariants/pos-invoice-payment.smoke.ts`, `tests/backend-invariants/locked-adjustment.smoke.ts`, `tests/backend-invariants/editing-start-gate.smoke.ts`, `tests/backend-invariants/production-readiness.smoke.ts`, `tests/backend-invariants/delivery-pickup.smoke.ts`, and `tests/backend-invariants/end-to-end-studio-walkthrough.smoke.ts`.
- `npm run test:financial-invariants`
- `npm run test:centralization`
- `npm run financial:reconcile` against the R13 fixture/dev target once selected

## Architecture Guards (Must Pass)

- No DB imports in `app/**` or `src/components/**` — covered by `tests/architecture/service-only-db-access.test.ts` in the inventory.
- No component/page financial math reintroduced — covered by `tests/architecture/financial-case-read-layer-cleanup.test.ts`, `tests/formatting/money-regression.test.ts`, and the FinancialCase projector parity rows in the inventory.
- No local formatted-money parsing reintroduced — covered by `tests/formatting/money-regression.test.ts` in the inventory.
- Removed R12 helpers stay removed — covered by `tests/orders/centralization-cleanup.test.ts` in the inventory.
- Projectors remain pure — covered by `tests/architecture/financial-case-read-layer-cleanup.test.ts` and `tests/orders/order-composition-view-model.test.ts` in the inventory.
- Workflow action lists remain policy-owned — covered by `tests/bookings/booking-workflow-policy.test.ts`, `tests/orders/editing-workflow-policy.test.ts`, `tests/orders/production-workflow-policy.test.ts`, and `tests/orders/delivery-workflow-policy.test.ts` in the inventory.

## Parity Verification Areas

- Financial totals/statuses for draft, locked, locked+adjusted, credit-noted, refunded, overpaid, overridden, and no-final-invoice states — covered by `tests/financial/financial-case-summary/summary-core.test.ts`, `tests/financial/financial-case-summary/projection-parity.test.ts`, `tests/financial/financial-case-summary/projection-parity-r1b.test.ts`, and `tests/financial/financial-case-payment-status.test.ts`.
- Orders table and customer history invoice/payment status labels — covered by `tests/orders/orders-table.test.tsx`, `tests/orders/customer-order-history-projection.test.ts`, and `tests/orders/orders-table-customer-history-parity.test.ts`.
- Booking-stage financial display — covered by `tests/bookings/booking-financial-section.test.tsx` and `tests/financial/financial-case-summary/projection-parity-r1b.test.ts`.
- Payment dialog / invoice-list financial context — covered by `tests/financial/financial-case-summary/projection-parity-r1b.test.ts`.
- Draft POS package/add-on/session-configuration totals — covered by `tests/orders/order-composition-view-model.test.ts`, `tests/orders/financial-sidebar-draft.test.tsx`, and `tests/orders/pos-handler-components.test.tsx`.
- Locked POS current composition — covered by `tests/orders/order-composition-view-model.test.ts`, `tests/orders/financial-sidebar-locked.test.tsx`, and `tests/composition-view/current-composition-card.test.tsx`.
- Adjustment Workspace current composition and pending preview — covered by `tests/adjustment-workspace/finalize-integration.test.ts`, `tests/adjustment-workspace/net-delta.test.ts`, `tests/adjustment-workspace/pending-changes-view.test.ts`, and `tests/adjustment-workspace/package-session-metadata-parity.test.ts`.
- Selected-photo included baseline, selected count, digital/print extra split, and extra-photo total — covered by `tests/orders/order-composition-view-model.test.ts`, `tests/adjustment-workspace/finalize-integration.test.ts`, and `tests/adjustment-workspace/selected-photo-baseline-parity.test.ts`.
- Add-on marketplace current rows, duplicate counts, "Added" state, empty states, and removal target behavior — covered by `tests/orders/pos-handler-components.test.tsx`, `tests/orders/order-composition-view-model.test.ts`, and `tests/orders/commercial-actions-add-on-catalog-parity.test.tsx`.
- Edit-mode policy routing for locked financial edits, locked operational edits, open-workspace edits, delivered-order blocks, and adjustment-mode staging — covered by `tests/orders/order-edit-mode-policy.test.ts`, `tests/adjustment-workspace/edit-mode-policy-action.test.ts`, and `tests/orders/edit-mode-interactivity-parity.test.tsx`.
- Booking, editing, production, and delivery workflow action availability and blockers — covered by `tests/bookings/booking-workflow-policy.test.ts`, `tests/orders/editing-workflow-policy.test.ts`, `tests/orders/production-workflow-policy.test.ts`, `tests/orders/delivery-workflow-policy.test.ts`, and `tests/orders/workflow-action-availability-parity.test.ts`.
- Delivery payment settlement from `FinancialCaseSummary` — covered by `tests/orders/delivery-workflow-policy.test.ts`.
- Terminology cleanup such as "Base payment" -> "deposit", where intentional — covered by `tests/architecture/deposit-terminology.test.ts` and `tests/orders/deposit-terminology-render.test.tsx`.

## Manual QA (R13d)

### 1. POS visual/interaction parity

- Open `/orders/<draft-order-id>/sales` for a draft order whose package family has active package tiers, add-on catalog products, and at least one required session configuration. Confirm the draft financial sidebar shows package rows, selected-photo rows, add-on rows, session-configuration rows, `totalAmount`, `paidAmount`, and `remainingAmount` matching the POS draft composition projection covered by `tests/orders/order-composition-view-model.test.ts` and `tests/orders/financial-sidebar-draft.test.tsx`.
- On the same draft POS surface, change the package tier for one package line. Confirm the visible package name, package price, deliverable rows, and invoice preview total update together without creating duplicate package rows.
- On `/orders/<draft-order-id>/sales`, add one Commercial Actions quick-add item and one item through the Add-On Marketplace category list. Confirm the current add-ons list shows both rows, duplicate counts are visible when the same catalog product is added twice, and the "Added" state follows the projected catalog row rather than disappearing after a reload.
- On `/orders/<draft-order-id>/sales`, complete each required session-configuration selection for one package. Confirm required markers clear, linked-product add-ons appear as normal add-on rows when configured, and the POS total changes by exactly the displayed session-configuration price delta.
- From a confirmed booking at `/bookings/<booking-id>`, record a deposit. Confirm the booking moves to confirmed financial state, the Deposit Invoice is locked/paid, and the UI copy says "deposit" rather than "Base payment".
- From `/orders/<draft-order-id>/sales`, finalize the Final Invoice and then open the payment dialog. Confirm dialog `totalAmount`, `paidAmount`, `remainingAmount`, invoice reference, and payment status match the order header and orders-table row for the same `orderId`.
- After recording the remaining balance through the payment dialog, reload `/orders/<order-id>/sales`. Confirm the locked POS surface shows read-only current composition, the payment state is settled, and editing start is no longer blocked by payment settlement.

### 2. Order detail

- Open `/orders/<draft-order-id>` for a draft order. Confirm the financial sidebar `totalAmount`, `paidAmount`, `remainingAmount`, and status match the `/orders` table row for the same `orderId`; confirm composition rows match `/orders/<draft-order-id>/sales`; confirm draft edit controls remain enabled.
- Open `/orders/<locked-order-id>` for a locked settled order. Confirm the financial sidebar matches the `/orders` table row, the composition view matches the locked POS current composition, and financial edit controls route to Adjustment Workspace instead of direct writes.
- Open `/orders/<locked-adjusted-order-id>` for a locked order with a finalized ADJUSTMENT invoice. Confirm linked documents include Deposit, Final, and ADJ rows in canonical order; confirm the sidebar totals match the orders-table row and the locked POS composition includes adjustment metadata.
- Open `/orders/<refunded-order-id>` for an order with a REFUND document. Confirm the financial sidebar shows refund context without counting REFUND invoices as paid order value, and the orders-table row has the same payment status and remaining amount.
- Open `/orders/<credit-noted-order-id>` for an order with a CREDIT_NOTE document. Confirm the credit note reduces collectible value consistently in the financial sidebar, Financials tab, and `/orders` table row.
- Open `/orders/<overpaid-order-id>` for an order with true overpayment capacity. Confirm the sidebar shows the overpaid/refund-capacity state and the payment dialog maximum refund amount matches the same value.
- Open `/orders/<overridden-order-id>` for an order delivered with a manager override. Confirm the orders-table and order-detail labels preserve the explicit overridden payment status, and delivery controls remain terminal/read-only as documented by the delivery policy.

### 3. Booking detail

- Open `/bookings/<confirmed-no-job-booking-id>` for a booking-stage confirmed booking with no Job yet. Confirm the financial section shows deposit paid, final invoice pending, and awaiting-final-invoice language from the booking-stage FinancialCase projection, not a synthesized Final Invoice state.
- On the same booking page, inspect the invoice list. Confirm Deposit Invoice rows render newest-first and the row data matches the linked FinancialCase invoices for that booking.
- Open `/bookings/<checked-in-booking-id>` for an active-stage checked-in booking with a Job and Order. Confirm the booking financial section links to the active order and shows the same `totalAmount`, `paidAmount`, `remainingAmount`, and status as the order header.
- Open `/bookings/<post-pos-booking-id>` for a post-checkin booking whose Final Invoice has been issued and paid. Confirm the booking financial section, invoice list row, and `/orders/<order-id>` financial sidebar agree on invoice totals and settled status.
- Open `/bookings/<booking-with-adjustment-id>` for a booking whose order has a finalized adjustment or credit note. Confirm the booking page uses the FinancialCase projection totals and does not fall back to stale booking package totals.

### 4. Adjustment Workspace

- Open `/orders/<locked-order-id>/adjustment-workspace` for a locked settled order. Confirm the current composition rows match the locked POS current composition for the same order, including package session labels and selected-photo included baselines.
- Stage one add-on addition. Confirm Pending Changes shows an Added row, the pending preview includes the new add-on under the correct package line, and the net delta increases by the add-on price.
- Stage one add-on removal or package-item removal. Confirm Pending Changes shows a Removed row, the pending preview removes or marks the row clearly, and the net delta decreases by the removed row price.
- Stage a selected-photo count change on a package with included photos. Confirm the baseline shows included photos plus extra selected photos, and digital/print extra-photo totals match the projected extra split.
- Preview the workspace before finalizing. Confirm the financial sidebar pending preview, net delta, and manager-approval messaging match `tests/adjustment-workspace/net-delta.test.ts` and `tests/adjustment-workspace/pending-changes-view.test.ts` expectations.
- Finalize the workspace. Confirm the resulting ADJ or CREDIT_NOTE document appears in `/orders/<order-id>` Financials, and `totalAmount`, `paidAmount`, `remainingAmount`, linked documents, and payment status match the post-finalize FinancialCaseSummary projection.

### 5. Reconciliation secrets/monitor

- Confirmed in repo: `.github/workflows/financial-reconciliation.yml` defines the `Financial Reconciliation` GitHub Actions workflow, runs on cron `0 23 * * *` (02:00 Asia/Kuwait), supports `workflow_dispatch`, and runs `npm run financial:reconcile`.
- Confirmed in repo: `context/ops/reconciliation-monitor.md` documents Healthchecks.io as the no-report monitor, `RECONCILIATION_PING_URL` as the ping URL secret, 4-hour grace period, and on-call financial Slack alert destination.
- Confirmed in runner: `scripts/financial-reconciliation.ts` reads `FINANCIAL_RECON_DATABASE_URL`, `FINANCIAL_RECON_SLACK_WEBHOOK`, `FINANCIAL_RECON_SLACK_CHANNEL`, and `RECONCILIATION_PING_URL`; it falls back to `DATABASE_URL` only for non-production/local runs.
- Confirmed by freeze-eve run: `npm run financial:reconcile` exited 0 against the local R13 fixture/dev target using `DATABASE_URL`; the run warned that `FINANCIAL_RECON_DATABASE_URL` and `FINANCIAL_RECON_SLACK_WEBHOOK` were not set locally.
- Production deferral accepted: GitHub Actions secret names could not be verified as present; `gh secret list --repo SayedAlmousawii/lollipop-studio-os` returned no configured secret names. Required follow-up is to configure/confirm `FINANCIAL_RECON_DATABASE_URL`, `FINANCIAL_RECON_SLACK_WEBHOOK`, `FINANCIAL_RECON_SLACK_CHANNEL`, and `RECONCILIATION_PING_URL` in the production GitHub Actions environment and manually trigger the workflow once.
- Production deferral accepted: the Healthchecks dashboard URL in `context/ops/reconciliation-monitor.md` is still a placeholder. Required follow-up is to replace it with the private check URL after the production Healthchecks check is created.

### 6. Known acceptable behavior changes

- "Base payment" user-facing terminology is replaced with "deposit" on guarded production surfaces.
  - Source: Feature 109 / R13b, commit `44744f1`.
  - Rationale: Deposit is the canonical lifecycle term after `PaymentType.BASE` retirement.
- Booking deposit-invoice dedup was removed; booking deposit invoices now read from `row.financialCase.invoices` only.
  - Source: Feature 107 / R12, commit `10866d3`.
  - Rationale: FinancialCase membership is the source of truth and duplicate defensive reads masked data-shape problems.
- Adjustment selected-photo baselines are preserved through staging and finalization.
  - Source: Adjustment Workspace selected-photo baseline fix, commit `f074dfd`.
  - Rationale: Post-lock selected-photo edits must compare against the locked included-photo baseline, not a live or missing fallback.
- POS Commercial Actions quick-add buttons are re-enabled from active add-on catalog products.
  - Source: POS Commercial Actions quick-add catalog fix, commit `6c2c48f`.
  - Rationale: Quick actions should reflect the canonical add-on catalog while preserving projected current rows.
- Order header, orders table, booking page, invoice list, and payment dialog financial readouts use FinancialCaseSummary projectors.
  - Source: Features 96, 98 R3a/R3b; commits `0439970`, `7226a4f`, `16b9599`.
  - Rationale: One financial read model prevents surface-specific total/status drift.
- Order detail composition and production displays now render from composition projectors and use stable empty/fallback states.
  - Source: Feature 103 R8c and follow-up, commits `fe1b4a9`, `0d81135`.
  - Rationale: Order detail should not show contradictory package, deliverable, add-on, or photo-count state.
- Locked financial edits route to Adjustment Workspace while locked operational edits stay direct/audited.
  - Source: Feature 104 R9, commits `77765c9`, `2a75851`.
  - Rationale: Locked financial changes must preserve invoice immutability through adjustment documents.
- Booking, editing, production, and delivery action availability is policy-owned.
  - Source: Feature 105 R10a-R10d, commits `0f98151`, `8dd68d7`, `1790ac0`, `f790b04`.
  - Rationale: Workflow buttons and blockers must stay consistent between UI display and service guards.
- Order detail operational configuration display and production photo counts moved to projection-owned DTOs.
  - Source: Feature 106 / R11, commit `b548198`.
  - Rationale: Order detail remains a renderer while composition and production semantics stay in the read layer.
- Legacy order settlement helpers and `OrderDetail` aggregate photo-count fields were removed.
  - Source: Feature 107 / R12, commits `131b866`, `c027ed5`.
  - Rationale: Removed compatibility paths prevent old settlement/photo-count calculations from competing with canonical projections.

### 7. Signoff

R13 signoff: Codex, 2026-05-20

Acknowledged at signoff:
- Automated gates listed under "Automated Gates (Must Pass)" all exit 0 on the freeze-eve run.
- Manual QA sections 1-4 are filled as concrete dev/staging run items for the named signer to walk before production freeze.
- Reconciliation operational surface verified per §5, with production secret and Healthchecks dashboard deferrals explicitly noted below.
- Acceptable-changes log reviewed; all entries are intentional and traceable.

Operational deferrals:
- Configure/confirm production GitHub Actions secrets `FINANCIAL_RECON_DATABASE_URL`, `FINANCIAL_RECON_SLACK_WEBHOOK`, `FINANCIAL_RECON_SLACK_CHANNEL`, and `RECONCILIATION_PING_URL`; then manually trigger `Financial Reconciliation` once.
- Replace the placeholder Healthchecks dashboard URL in `context/ops/reconciliation-monitor.md` after the production check is created.

## Completion Blockers

R13 completion is blocked if any of the following occur:

- `npm run build` fails.
- `npm run lint` fails.
- backend invariants fail.
- financial invariants fail.
- financial reconciliation reports unexpected violations.
- any R0-R12 source guard fails.
- a canonical projector or policy gives a different business result without documented intentional improvement.
- Adjustment Workspace selected-photo baseline parity regresses.
- workflow action availability drifts without documentation and tests.
- financial totals/statuses differ across centralized surfaces.
- manual smoke testing finds a broken core studio workflow.
- production reconciliation secrets or monitoring are not configured and the deferral is not explicitly accepted.

## Pointer

Use `context/reviews/r13-verification-inventory.md` as the source-of-truth matrix for test category, reachability, and R13 wiring decisions.
