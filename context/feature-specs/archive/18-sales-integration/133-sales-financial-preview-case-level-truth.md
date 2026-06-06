## Goal

Make the Sales `OrderCommitFinancialSidebar` (the "Financial Preview" card) tell one coherent FinancialCase-level story instead of mixing case-level and FINAL-invoice-level truth. After this spec the header leads with case payment status, the baseline lists every document that affects the case total/remaining (deposit, final, adjustments, credit notes, refunds), the "Fully Paid" / Collect Payment affordance is gated on case-level outstanding, and payment is routed to a chosen unsettled document rather than always the FINAL invoice. This is a correctness follow-up to Spec 131, which made this sidebar the canonical Sales financial surface for both locked and unlocked orders, and should land before Phase 6 Adjustment Workspace retirement.

## Read First

- `context/feature-specs/131-locked-invoice-sales-unification-and-parity.md` - unified Sales surface and the shared `OrderCommitFinancialSidebar` this spec corrects.
- `context/feature-specs/125-sales-page-view-model-and-projectors.md` - `SalesPageView` canonical-source boundary; surfaces consume read model + projector, never re-derive.
- `context/ui-context.md` - sidebar, card, badge, and money-formatting conventions.
- `src/components/orders/order-commit-financial-sidebar.tsx` - the card being corrected (header, `BaselineSummary`, settle section).
- `src/components/orders/pos-record-payment-dialog.tsx` - payment dialog to extend with a target picker.
- `src/modules/order-commits/projections/to-sales-page-financial-preview.ts` and `src/modules/order-commits/projections/sales-page-view.types.ts` - the `SalesPageFinancialPreview` projection/type to extend.
- `src/modules/financial-cases/financial-case-summary.types.ts` - `FinancialCaseActiveSummary` already carries `finalizedAdjustments`, `creditNotes`, `refunds`, `remaining`, `paymentStatusEnum`.
- `src/modules/financial-cases/financial-case-payment-status.ts` - canonical case payment-status derivation and the `0.0005` settlement epsilon to reuse.
- `app/orders/[orderId]/sales/actions.ts` - `recordPOSPaymentAction` and `findPOSPayableInvoice` (already accepts FINAL + open adjustments).
- `src/modules/orders/order.service.ts` - `getPOSWorkspace` (`adjustmentInvoices`, `paidAdjustmentInvoices`, `aggregateOutstanding`) and `recordPOSPaymentForOrder` (FINAL-only selection-status branch is already guarded).
- `src/lib/formatting/money.ts` - money formatting (`formatMoney`, `formatSignedMoney`).

## Rules

- Keep scope to the Sales Financial Preview sidebar display + its Collect Payment wiring. This is **projection + component + dialog-UI only**.
- Do not change `getFinancialCaseSummary`, `getPOSWorkspace`, the payment server action/service signatures, the OrderCommit snapshot/reducer/preview/emission, or any schema. No migrations.
- Components and pages must not recompute financial state. The settle/collect decision and all displayed amounts must come from projector-fed fields; money is read from raw projector numbers and formatted via `src/lib/formatting/money.ts`.
- No `@/lib/db` imports in `app/**` or `src/components/**`.
- The OrderCommit preview overlay (the `overlay` half of `SalesPageFinancialPreview`, `PreviewTotals`, `ImpactSummary`) stays separate and unchanged.
- Do not expose Adjustment Workspace naming in any new copy.

## Scope

### In Scope

- Extend `SalesPageFinancialPreview.baseline` (active stage) to carry, mapped straight from the active `FinancialCaseSummary`:
  - `finalizedAdjustments`, `creditNotes`, `refunds` (each a `FinancialCaseInvoiceSummary[]`).
  - `totalAdjustments: number`.
  - `outstandingAmount: number` = `financialCase.remaining` (case-level outstanding).
  - `isFullySettled: boolean`, derived **in the projector** from case state (settled `paymentStatusEnum` and `remaining <= 0.0005`).
  - `collectPaymentTargetInvoiceId: string | null` = the next unsettled charge document (FINAL if it still has remaining, else the oldest open ADJUSTMENT). Replaces the current hardcoded `collectPaymentInvoiceId: financialCase.finalInvoice.id`.
  - Booking-stage branch keeps the existing null/empty shape.
- Header (`OrderCommitFinancialSidebar`): lead with the case payment-status badge (already fed by `baseline.paymentStatusEnum`); render the FINAL invoice number as a secondary reference line; move the per-invoice status chip into the baseline document list.
- Baseline (`BaselineSummary`): in addition to deposit + final + the existing case totals, render a row per present document from `finalizedAdjustments`, `creditNotes`, and `refunds`. Render a document section only when its array is non-empty. Each row shows invoice number + amount (and remaining/status where useful), formatted via `formatMoney` / `formatSignedMoney`.
- Settle section: replace the `invoice.remainingAmount <= 0` gate with `baseline.isFullySettled`. Fully settled → disabled "Fully Paid" + "No outstanding balance remains." Otherwise → Collect Payment.
- Collect Payment: a single button opening `POSRecordPaymentDialog` with a **target picker** over the open charge documents from the workspace (`workspace.invoice` when it still has remaining, plus `workspace.adjustmentInvoices`), defaulting to the candidate whose `invoiceId === baseline.collectPaymentTargetInvoiceId`.
- `POSRecordPaymentDialog`: accept a `targets: POSInvoiceSummary[]` (plus a default selection), render a selector when more than one target exists, and submit `recordPOSPaymentAction(orderId, selectedTarget.invoiceId, …)` with the chosen target. The single-target case must behave exactly as today.
- Tests: projection unit test for the new fields; Sales-surface test proving the unpaid-adjustment case renders correctly and routes payment to the adjustment; wire any new test into `scripts/run-centralization-tests.ts`.

### Out of Scope

- No change to the OrderCommit preview overlay / `PreviewTotals` / `ImpactSummary`.
- No change to `getFinancialCaseSummary`, `getPOSWorkspace`, payment service/action signatures, schema, or Adjustment Workspace.
- `src/modules/financial-cases/projections/to-payment-dialog-context.ts` carries the same latent FINAL-id-vs-case-remaining mix but is **not** used by the Sales sidebar; do not change it here (flag only).
- No visual redesign beyond what the case-level content requires; Phase 7 owns polish.
- No new package, dependency, or design-system primitive.

## Implementation Direction

### Task 1 - Carry case documents + settlement through the projection

In `to-sales-page-financial-preview.ts` (active branch) map `finalizedAdjustments`, `creditNotes`, `refunds`, `totalAdjustments`, `outstandingAmount` (= `summary.remaining`), `isFullySettled`, and `collectPaymentTargetInvoiceId` onto `baseline`, updating `SalesPageFinancialPreview` in `sales-page-view.types.ts`. Derive `isFullySettled` and the target id in the projector using the case arrays and the `0.0005` epsilon from `financial-case-payment-status.ts`. Leave `overlay` untouched.

### Task 2 - Case-level header

In `OrderCommitFinancialSidebar`, keep the top-right `baseline.paymentStatusEnum` badge as the lead status. Demote the FINAL invoice number/status: show the FINAL number as a secondary reference line and surface per-invoice status inside the document list (Task 3). Keep the `editPolicies.invoiceLocked` banner.

### Task 3 - Baseline lists every contributing document

Extend `BaselineSummary` to render adjustment / credit-note / refund rows from the new projector arrays, only when present. Keep the existing Customer total / Deposit applied / Paid so far / Effective paid / Remaining rows so the now-visible document rows reconcile to Customer total and Remaining. No arithmetic in the component.

### Task 4 - Case-level settle gate + payment target picker

Replace the FINAL-invoice gate with `baseline.isFullySettled`. Wire Collect Payment to `POSRecordPaymentDialog` with the workspace's open charge documents as `targets` and the projector-designated default. Extend `POSRecordPaymentDialog` to take `targets` + default, show a selector for multiple targets, and submit against the selected target's `invoiceId`. The server side already supports this: `findPOSPayableInvoice` resolves FINAL + open adjustments, and `recordPOSPaymentForOrder` only runs the FINAL-specific selection-status branch for FINAL invoices.

### Task 5 - Keep the overlay unchanged

Do not touch `PreviewTotals`, `ImpactSummary`, or the `overlay` projection.

## Observability Checklist

### Dashboards / Metrics

- No new dashboards. If an existing Sales render metric is kept, do not add invoice-level payment-status fields that imply FINAL-only truth.

### Rollback Plan

- Schema: no changes.
- Code rollback: revert the projection, sidebar, and dialog changes; the prior FINAL-invoice-gated behavior returns.
- Test rollback: remove the new tests from `scripts/run-centralization-tests.ts`.
- Data rollback: none; no rows are written by this spec.

### Customer-Visible Surface

- Staff see the Financial Preview card lead with case payment status and list all case documents.
- A case with an unpaid adjustment no longer shows "Fully Paid" / "No outstanding balance remains"; the positive remaining and the adjustment are visible.
- Collect Payment defaults to the unsettled document and lets staff pick which open document to pay.

## Post-Implementation

- Update `context/progress-tracker.md` to record Spec 133 complete.
- Do not edit `context/reviews/unified-order-commit-live-pos-roadmap.md` unless implementation proves roadmap drift.

## Acceptance Criteria

- `SalesPageFinancialPreview.baseline` (active stage) exposes `finalizedAdjustments`, `creditNotes`, `refunds`, `totalAdjustments`, `outstandingAmount`, `isFullySettled`, and `collectPaymentTargetInvoiceId`, all mapped from `FinancialCaseSummary`.
- For a case with a closed/paid FINAL and one open ADJUSTMENT: `outstandingAmount > 0`, `isFullySettled === false`, `finalizedAdjustments` is populated, and `collectPaymentTargetInvoiceId` is the open adjustment's id.
- For a fully paid case: `isFullySettled === true`.
- The sidebar header leads with the case payment-status badge and shows the FINAL invoice number only as a secondary reference.
- The baseline renders deposit/final plus adjustment/credit-note/refund rows when present, and the visible document rows reconcile to Customer total and Remaining.
- The settle section is gated on `baseline.isFullySettled`; the unpaid-adjustment case does **not** render "Fully Paid" / "No outstanding balance remains."
- Collect Payment offers the open charge documents as targets, defaults to `collectPaymentTargetInvoiceId`, and records the payment against the selected target's invoice; the single-target case behaves as before.
- No component/page recomputes financial state; amounts come from projector fields formatted via `src/lib/formatting/money.ts`.
- No `@/lib/db` imports in `app/**` or `src/components/**`.
- The OrderCommit preview overlay (`PreviewTotals`, `ImpactSummary`, `overlay`) is unchanged.
- New tests are wired into `scripts/run-centralization-tests.ts`.
- `npm run test:centralization` passes.
- `npm run test:financial-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.
