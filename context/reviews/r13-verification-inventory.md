# R13 Verification Inventory

This inventory is the source-of-truth matrix for R13a, with `context/reviews/r13-freeze-gate-assessment.md` as the parent context. It is a snapshot as of the R13a draft date, 2026-05-20, and records every file currently under `tests/` exactly once.

Reachability values: `test:backend-invariants`, `test:financial-invariants`, `both`, `none`.

R13 wiring decisions: `centralization-gate`, `existing-script`, `out-of-scope-for-R13`.

## Architecture Guards

| Path | Category | Scope summary | Reachability today | R13 wiring decision |
|---|---|---|---|---|
| `tests/architecture/deposit-terminology.test.ts` | Architecture Guards | Guards production user-visible source strings against reintroducing "base payment" terminology after the deposit cleanup. | none | centralization-gate |
| `tests/architecture/financial-case-read-layer-cleanup.test.ts` | Architecture Guards | Guards against reintroducing temporary FinancialCase parity/discrepancy code, impure projectors, and the legacy order financial summary shim. | none | centralization-gate |
| `tests/architecture/service-only-db-access.test.ts` | Architecture Guards | Asserts app and component production files do not import the Prisma DB client. | none | centralization-gate |
| `tests/orders/centralization-cleanup.test.ts` | Architecture Guards | Asserts R12 legacy helper declarations and aggregate OrderDetail photo-count fields stay removed. | none | centralization-gate |

## Financial Invariants

| Path | Category | Scope summary | Reachability today | R13 wiring decision |
|---|---|---|---|---|
| `tests/backend-invariants/calendar-session-type-display.invariant.ts` | Financial Invariants | Backend invariant ensuring calendar session type display behavior remains stable. | test:backend-invariants | existing-script |
| `tests/backend-invariants/duplicate-booking-package.invariant.ts` | Financial Invariants | Backend invariant guarding against duplicate booking package state. | test:backend-invariants | existing-script |
| `tests/backend-invariants/harness.ts` | Financial Invariants | Harness for running backend invariants against an isolated schema. | test:backend-invariants | existing-script |
| `tests/backend-invariants/invoice-math.invariant.ts` | Financial Invariants | Backend invariant covering invoice math behavior. | test:backend-invariants | existing-script |
| `tests/backend-invariants/package-options.smoke.ts` | Financial Invariants | Backend smoke check for package option behavior. | test:backend-invariants | existing-script |
| `tests/backend-invariants/pos-pricing-display.invariant.ts` | Financial Invariants | Backend invariant guarding POS pricing display behavior. | test:backend-invariants | existing-script |
| `tests/backend-invariants/run.ts` | Financial Invariants | Literal backend invariant runner for Phase A-G checks and backend invariants. | test:backend-invariants | existing-script |
| `tests/backend-invariants/scoped-add-on-delete.invariant.ts` | Financial Invariants | Backend invariant guarding scoped add-on deletion rules. | test:backend-invariants | existing-script |
| `tests/backend-invariants/selected-photo-aggregate.invariant.ts` | Financial Invariants | Backend invariant guarding selected-photo aggregate behavior. | test:backend-invariants | existing-script |
| `tests/financial-invariants.test.ts` | Financial Invariants | Runs the financial invariant catalog against seeded fixtures. | test:financial-invariants | existing-script |
| `tests/financial-phase-a/assertions.ts` | Financial Invariants | Shared assertions for Phase A financial architecture verification. | test:backend-invariants | existing-script |
| `tests/financial-phase-a/financial-invariants.ts` | Financial Invariants | Phase A financial invariant checks. | test:backend-invariants | existing-script |
| `tests/financial-phase-a/fixtures.ts` | Financial Invariants | Phase A financial fixtures. | test:backend-invariants | existing-script |
| `tests/financial-phase-a/migration-backfill.ts` | Financial Invariants | Phase A migration backfill checks. | test:backend-invariants | existing-script |
| `tests/financial-phase-a/run.ts` | Financial Invariants | Runs Phase A schema, backfill, and financial architecture verification. | test:backend-invariants | existing-script |
| `tests/financial-phase-a/schema-integrity.ts` | Financial Invariants | Phase A schema integrity checks. | test:backend-invariants | existing-script |
| `tests/financial-phase-a/types.ts` | Financial Invariants | Phase A financial verification support types. | test:backend-invariants | existing-script |
| `tests/financial-phase-b/assertions.ts` | Financial Invariants | Shared assertions for Phase B workflow integration. | test:backend-invariants | existing-script |
| `tests/financial-phase-b/fixtures.ts` | Financial Invariants | Phase B workflow fixtures. | test:backend-invariants | existing-script |
| `tests/financial-phase-b/run.ts` | Financial Invariants | Runs Phase B financial workflow integration. | test:backend-invariants | existing-script |
| `tests/financial-phase-b/workflow-integration.ts` | Financial Invariants | Phase B financial workflow integration matrix. | test:backend-invariants | existing-script |
| `tests/financial-phase-c/edge-cases.ts` | Financial Invariants | Phase C financial edge-case expansion. | test:backend-invariants | existing-script |
| `tests/financial-phase-c/fixtures.ts` | Financial Invariants | Phase C financial edge-case fixtures. | test:backend-invariants | existing-script |
| `tests/financial-phase-c/run.ts` | Financial Invariants | Runs Phase C financial edge-case checks. | test:backend-invariants | existing-script |
| `tests/financial-phase-d/fixtures.ts` | Financial Invariants | Phase D financial regression fixtures. | test:backend-invariants | existing-script |
| `tests/financial-phase-d/regression.ts` | Financial Invariants | Phase D financial regression suite. | test:backend-invariants | existing-script |
| `tests/financial-phase-d/run.ts` | Financial Invariants | Runs Phase D financial regression checks. | test:backend-invariants | existing-script |
| `tests/financial-phase-f/failure-recovery.ts` | Financial Invariants | Phase F financial failure-recovery checks. | test:backend-invariants | existing-script |
| `tests/financial-phase-f/fixtures.ts` | Financial Invariants | Phase F financial concurrency/security/recovery fixtures. | test:backend-invariants | existing-script |
| `tests/financial-phase-f/run.ts` | Financial Invariants | Runs Phase F financial concurrency, security, and recovery checks. | test:backend-invariants | existing-script |
| `tests/financial-phase-f/security-permissions.ts` | Financial Invariants | Phase F security and permission checks. | test:backend-invariants | existing-script |
| `tests/financial-phase-f/transaction-concurrency.ts` | Financial Invariants | Phase F transaction concurrency checks. | test:backend-invariants | existing-script |
| `tests/financial-phase-g/reconciliation.ts` | Financial Invariants | Phase G financial reconciliation checks. | test:backend-invariants | existing-script |
| `tests/financial/adjustment-reversal.test.ts` | Financial Invariants | Guards adjustment reversal regressions A-E. | none | out-of-scope-for-R13 |
| `tests/financial/db-constraints.test.ts` | Financial Invariants | Asserts DB constraints reject payment over-collection and ADJUSTMENT chaining. | none | out-of-scope-for-R13 |
| `tests/financial/inv-18-regression.test.ts` | Financial Invariants | Guards INV-18 balance behavior when an adjustment cause is removed before a manual credit. | none | out-of-scope-for-R13 |
| `tests/financial/invariant-catalog.test.ts` | Financial Invariants | Asserts financial invariant catalog entries are unique and clean on a clean database. | none | out-of-scope-for-R13 |
| `tests/financial/locked-invoice-immutability.test.ts` | Financial Invariants | Guards locked invoice snapshots and DB immutability for frozen fields. | none | out-of-scope-for-R13 |
| `tests/invoices/overpayment-capacity.test.ts` | Financial Invariants | Guards refund capacity calculations against true overpayment. | none | out-of-scope-for-R13 |
| `tests/payments/settlement-transaction.test.ts` | Financial Invariants | Guards settlement row locking, final invoice auto-locking, and overpayment rejection. | none | out-of-scope-for-R13 |

## FinancialCase Summary / Projector Parity

| Path | Category | Scope summary | Reachability today | R13 wiring decision |
|---|---|---|---|---|
| `tests/financial/financial-case-payment-status.test.ts` | FinancialCase Summary / Projector Parity | Asserts FinancialCase payment status maps to order payment labels and preserves force-closed outstanding invoices. | none | centralization-gate |
| `tests/financial/financial-case-summary/projection-parity-r1b.test.ts` | FinancialCase Summary / Projector Parity | Covers FinancialCaseSummary booking and active-stage projectors including sidebars, orders table, booking page, payment dialog, and invoice list rows. | none | centralization-gate |
| `tests/financial/financial-case-summary/projection-parity.test.ts` | FinancialCase Summary / Projector Parity | Asserts financial tab and locked sales projectors expose canonical values for booking, active, adjusted, and credit-noted states. | none | centralization-gate |
| `tests/financial/financial-case-summary/summary-core.test.ts` | FinancialCase Summary / Projector Parity | Covers FinancialCaseSummary booking and active stages, adjusted, refunded, overpaid, credit-noted, and missing-case states. | none | centralization-gate |

## Orders / Projections

| Path | Category | Scope summary | Reachability today | R13 wiring decision |
|---|---|---|---|---|
| `tests/orders/canonical-balance-display.test.ts` | Orders / Projections | Asserts order POS and editing gates consume canonical invoice balances. | none | centralization-gate |
| `tests/orders/commercial-actions-add-on-catalog-parity.test.tsx` | Orders / Projections | Guards Commercial Actions and Add-On Marketplace rendering against the projected add-on catalog state, duplicate counts, and removal targets. | none | centralization-gate |
| `tests/orders/customer-order-history-projection.test.ts` | Orders / Projections | Asserts customer order history reads invoice and payment status from projections. | none | centralization-gate |
| `tests/orders/deposit-terminology-render.test.tsx` | Orders / Projections | Guards the editing workflow unpaid-start render path so it says "deposit" and never "base payment". | none | centralization-gate |
| `tests/orders/financial-sidebar-adjustment.test.tsx` | Orders / Projections | Guards Adjustment Workspace financial sidebar rendering and labels. | none | centralization-gate |
| `tests/orders/financial-sidebar-draft.test.tsx` | Orders / Projections | Guards draft financial sidebar rendering through projected financial data. | none | centralization-gate |
| `tests/orders/financial-sidebar-locked.test.tsx` | Orders / Projections | Guards locked financial sidebar sections, sanitized labels, and adjustment workspace action source. | none | centralization-gate |
| `tests/orders/invoice-line-items.test.tsx` | Orders / Projections | Guards invoice line item rendering. | none | centralization-gate |
| `tests/orders/operational-configurations-block.test.tsx` | Orders / Projections | Guards order operational configuration display. | none | centralization-gate |
| `tests/orders/order-composition-view-model.test.ts` | Orders / Projections | Covers OrderCompositionViewModel, POS/overview/production projectors, selected-photo baselines, and source guards. | none | centralization-gate |
| `tests/orders/order-details-financials-tab.test.tsx` | Orders / Projections | Guards order details Financials tab rendering from FinancialTabBlockProjection. | none | centralization-gate |
| `tests/orders/orders-table.test.tsx` | Orders / Projections | Guards orders table projection rendering and financial status display. | none | centralization-gate |
| `tests/orders/pos-handler-components.test.tsx` | Orders / Projections | Guards shared POS handler component behavior and source boundaries. | none | centralization-gate |
| `tests/orders/settlement-summary.test.ts` | Orders / Projections | Guards canonical settlement summary, payment summary, and locked sidebar display totals. | none | centralization-gate |

## Bookings

| Path | Category | Scope summary | Reachability today | R13 wiring decision |
|---|---|---|---|---|
| `tests/bookings/booking-financial-section.test.tsx` | Bookings | Guards booking financial section rendering for booking-stage deposit and active-stage projections. | none | centralization-gate |
| `tests/bookings/deposit-invoice-canonicalization.test.ts` | Bookings | Guards booking deposit invoice canonicalization membership and failure controls. | none | centralization-gate |

## Composition View

| Path | Category | Scope summary | Reachability today | R13 wiring decision |
|---|---|---|---|---|
| `tests/composition-view/composition-view.model.test.ts` | Composition View | Guards composition view normalization of swaps, upgrades, passthrough rows, and upstream totals. | none | centralization-gate |
| `tests/composition-view/current-composition-card.test.tsx` | Composition View | Guards CurrentCompositionCard rendering behavior. | none | centralization-gate |

## Adjustment Workspace

| Path | Category | Scope summary | Reachability today | R13 wiring decision |
|---|---|---|---|---|
| `tests/adjustment-workspace/finalize-integration.test.ts` | Adjustment Workspace | Guards workspace finalization, staged POS projection, selected-photo baselines, operational edits, and handler behavior. | none | centralization-gate |
| `tests/adjustment-workspace/net-delta.test.ts` | Adjustment Workspace | Guards pending-change parsing, session configuration deltas, approval rules, package/photo/add-on edit semantics, and no-op normalization. | none | centralization-gate |
| `tests/adjustment-workspace/pending-changes-view.test.ts` | Adjustment Workspace | Guards pending-change rows for package swaps and staged POS edit types. | none | centralization-gate |
| `tests/adjustment-workspace/selected-photo-baseline-parity.test.ts` | Adjustment Workspace | Guards selected-photo baseline parity between Adjustment Workspace staged/finalized snapshots and the composition POS projection. | none | centralization-gate |

## Edit-Mode / Workflow Policies

| Path | Category | Scope summary | Reachability today | R13 wiring decision |
|---|---|---|---|---|
| `tests/adjustment-workspace/edit-mode-policy-action.test.ts` | Edit-Mode / Workflow Policies | Guards staged workspace edits using the shared locked workspace guard message. | none | centralization-gate |
| `tests/bookings/booking-workflow-policy.test.ts` | Edit-Mode / Workflow Policies | Guards booking workflow policy actions, terminal states, transition guards, and policy-owned rendering. | none | centralization-gate |
| `tests/orders/delivery-workflow-policy.test.ts` | Edit-Mode / Workflow Policies | Guards delivery workflow actions, readiness blockers, canonical settlement, and policy ownership. | none | centralization-gate |
| `tests/orders/edit-mode-interactivity-parity.test.tsx` | Edit-Mode / Workflow Policies | Render-verifies locked vs Adjustment Workspace POS controls follow the centralized edit-mode interactivity policy. | none | centralization-gate |
| `tests/orders/editing-workflow-policy.test.ts` | Edit-Mode / Workflow Policies | Guards editing workflow action matrix, start blockers, guard messages, and policy-owned rendering. | none | centralization-gate |
| `tests/orders/order-edit-mode-policy.test.ts` | Edit-Mode / Workflow Policies | Guards draft, locked, adjustment, open-workspace, and delivered-order edit-mode routing. | none | centralization-gate |
| `tests/orders/production-workflow-policy.test.ts` | Edit-Mode / Workflow Policies | Guards production workflow actions, section labels, readiness blockers, and policy-owned rendering. | none | centralization-gate |

## Money Formatting

| Path | Category | Scope summary | Reachability today | R13 wiring decision |
|---|---|---|---|---|
| `tests/formatting/money-regression.test.ts` | Money Formatting | Guards app and component code from defining local KD formatters or parsing formatted money. | none | centralization-gate |
| `tests/formatting/money.test.ts` | Money Formatting | Covers `formatMoney`, `formatSignedMoney`, and `parseMoneyInput` behavior. | none | centralization-gate |

## Audit

| Path | Category | Scope summary | Reachability today | R13 wiring decision |
|---|---|---|---|---|
| `tests/audit/audit-log.test.ts` | Audit | Guards co-transactional audit log writes and rollback behavior for financial and booking actions. | none | out-of-scope-for-R13 |

## Auth

| Path | Category | Scope summary | Reachability today | R13 wiring decision |
|---|---|---|---|---|
| `tests/auth/payment-role-guard.test.ts` | Auth | Guards payment recording role enforcement and missing actorRole rejection. | none | out-of-scope-for-R13 |

## Other Backend Invariants

| Path | Category | Scope summary | Reachability today | R13 wiring decision |
|---|---|---|---|---|
| `tests/fixtures/actor.ts` | Other Backend Invariants | Shared actor fixture helpers. | none | out-of-scope-for-R13 |
| `tests/fixtures/financial.ts` | Other Backend Invariants | Shared financial fixture helpers. | none | out-of-scope-for-R13 |
| `tests/integration/pos-reductive-approval.test.ts` | Other Backend Invariants | Guards POS reductive manager-approval surfacing and credit-note approval line rendering; R13b fixed a stale service-stub harness mismatch and moved it into the gate. | none | centralization-gate |
| `tests/pricing/extra-photo-pricing-action.test.ts` | Other Backend Invariants | Guards extra-photo pricing action authorization and updates. | none | out-of-scope-for-R13 |
| `tests/pricing/extra-photo-pricing-service.test.ts` | Other Backend Invariants | Guards extra-photo pricing service listing, validation, authorization, persistence, and missing-row behavior. | none | out-of-scope-for-R13 |
| `tests/session-configurations/configure-session-action.test.ts` | Other Backend Invariants | Guards configure-session action JSON parsing and locked error mapping. | none | out-of-scope-for-R13 |
| `tests/session-configurations/session-configuration-action.test.ts` | Other Backend Invariants | Guards session configuration create action parsing and admin-page revalidation. | none | out-of-scope-for-R13 |
| `tests/session-configurations/session-configuration-code.test.ts` | Other Backend Invariants | Guards session configuration code generation against session type boundaries. | none | out-of-scope-for-R13 |
| `tests/session-configurations/session-configuration-pricing-integration.test.ts` | Other Backend Invariants | Guards session configuration resolver, invoice pricing, and POS workspace integration. | none | out-of-scope-for-R13 |
| `tests/session-configurations/session-configuration-pricing.test.ts` | Other Backend Invariants | Guards session configuration pricing totals and invoice drafts from snapshot selections. | none | out-of-scope-for-R13 |
| `tests/session-configurations/session-configuration-schema.test.ts` | Other Backend Invariants | Guards session configuration schema cross-field invariants. | none | out-of-scope-for-R13 |
| `tests/session-configurations/session-configuration-selection-service.test.ts` | Other Backend Invariants | Guards session configuration selection service full package writes and snapshots. | none | out-of-scope-for-R13 |
| `tests/session-configurations/session-configuration-service.test.ts` | Other Backend Invariants | Guards session configuration service create, update, archive, and identity preservation behavior. | none | out-of-scope-for-R13 |
| `tests/session-configurations/session-configurations-page.test.ts` | Other Backend Invariants | Guards session configurations page archived filtering and manager access. | none | out-of-scope-for-R13 |
| `tests/session-types/calendar-session-type-regression.test.ts` | Other Backend Invariants | Guards calendar seeded session labels and colors against previous hardcoded buckets. | none | out-of-scope-for-R13 |
| `tests/session-types/session-type-code.test.ts` | Other Backend Invariants | Guards session type code generation. | none | out-of-scope-for-R13 |
| `tests/session-types/session-type-service.test.ts` | Other Backend Invariants | Guards session type service create, collision, archive, and identity-field behavior. | none | out-of-scope-for-R13 |
| `tests/session-types/session-types-page.test.ts` | Other Backend Invariants | Guards session types page manager access and denial behavior. | none | out-of-scope-for-R13 |
