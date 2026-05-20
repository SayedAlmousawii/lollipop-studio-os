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

- POS visual/interaction parity
- Order detail
- Booking detail
- Adjustment Workspace
- Reconciliation secrets/monitor
- Known acceptable behavior changes
- Signoff

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
