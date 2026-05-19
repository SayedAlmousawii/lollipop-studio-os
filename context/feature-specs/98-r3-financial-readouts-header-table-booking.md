# Feature 98 - R3: Swap Header, Orders Table, Booking Page Financial Readouts

## Goal

Move the remaining read-only financial readouts in the order header, orders table, and booking detail page onto `FinancialCaseSummary` projectors. This is one shared R3 feature spec because the roadmap item is operationally split, but it must be implemented as two independently mergeable PRs: R3a for the order header and orders table, then R3b for the booking page.

## Read First

- `context/reviews/centralization-roadmap.md` - Spec R3, section 5 do-not-touch boundaries, section 8.5 spec drafting notes, and the R3 test row.
- `context/feature-specs/96-r1b-financial-case-projectors-remaining.md` - `toOrderHeaderFinancial`, `toOrdersTableRow`, `toBookingPageFinancial`, and the recorded booking-page drift.
- `context/feature-specs/97-r2-swap-financials-tab-sales-locked-sidebar.md` - current consumer-swap pattern and observability expectations.
- `src/modules/financial-cases/financial-case-summary.service.ts` - `getFinancialCaseSummary`, `checkFinancialCaseSummaryProjectorParity`, and current summary build path.
- `src/modules/financial-cases/projections/to-order-header-financial.ts` - order header projection shape.
- `src/modules/financial-cases/projections/to-orders-table-row.ts` - orders table row projection shape with raw number fields.
- `src/modules/financial-cases/projections/to-booking-page-financial.ts` - booking-stage and active-stage booking projection shape.
- `app/orders/[orderId]/page.tsx` - current header wiring; the Financials tab is already swapped in R2.
- `src/components/orders/order-settlement-summary.tsx` - current header summary renderer and local money formatting.
- `app/orders/page.tsx`, `src/components/orders/orders-table.tsx`, `src/modules/orders/order.service.ts`, `src/modules/orders/order.types.ts` - current orders table loader, row type, formatted string amount fields, and `parseFloat(order.remainingAmount...)` drift.
- `app/bookings/[bookingId]/page.tsx`, `src/modules/bookings/booking.service.ts` - current deposit invoice section and `packageRemainingBalanceLabel` arithmetic.
- `tests/financial/financial-case-summary/`, `tests/orders/order-details-financials-tab.test.tsx`, `tests/orders/settlement-summary.test.ts` - established projector parity and header render test patterns.

## Rules

- **Two PRs, one spec.** Implement R3a and R3b separately. R3a must be mergeable without R3b. R3b must build on R3a without revisiting R3a behavior.
- **Consumer swap only.** Do not change invoice, payment, refund, credit-note, booking confirmation, booking check-in, POS write, or adjustment-workspace write behavior.
- **Use canonical read flow.** R3a surfaces use `getFinancialCaseSummary` plus `toOrderHeaderFinancial` / `toOrdersTableRow`. R3b uses `getFinancialCaseSummary({ bookingId })` plus `toBookingPageFinancial`.
- **No UI financial derivation.** Pages and components must not compute total paid, remaining balance, net customer total, overpayment state, deposit settlement, or booking-stage financial state.
- **Raw numbers into UI, formatting at the edge.** Projectors provide raw numbers. Components format only for display.
- **Money formatter drift is in scope only where R3 needs it.** The roadmap schedules full formatter centralization for R4, but the current repo does not have `src/lib/formatting/money.ts` and the feature-spec template requires it for changed financial surfaces. R3a may create a minimal additive `src/lib/formatting/money.ts` with `formatMoney(...)` only, and use it for the R3-touched surfaces. R4 still owns repository-wide formatter migration and `parseMoneyInput(raw)`.
- **Status display uses the canonical financial status enum.** R3-touched payment labels/badges should read from `FinancialCasePaymentStatus` via a shared label map in the financial-cases module. Do not keep using order-service-local `mapPaymentStatus` for the swapped header/table/booking financial readouts.
- **Do not over-clean.** Legacy fields such as `OrderDetail.settlementSummary`, `Order.totalAmount`, `Order.paidAmount`, or `Order.remainingAmount` may remain if removing them causes unrelated churn. The acceptance condition is that R3-touched render paths no longer consume them.
- **Known R3 drift to handle.** `summarizeInvoices()` and `mapPaymentStatus()` are still used by non-R3 paths such as customer history and delivery workflow. R3a must remove or bypass them only for order header/table financial readouts; broader removal belongs to R10/R12 unless it is already trivially unused after the swap.
- **Booking-stage projection stays visible.** R3b keeps a booking-page financial section for confirmed bookings with no Final Invoice. It must not hide booking financials and must not synthesize a final-invoice state.

## Scope

### In Scope

#### PR R3a - Order Header + Orders Table

- `app/orders/[orderId]/page.tsx`
  - Reuse the already-loaded `financialCaseSummary` from R2.
  - Project it through `toOrderHeaderFinancial`.
  - Feed the header financial card from the projection instead of `order.settlementSummary`.
- `src/components/orders/order-settlement-summary.tsx`
  - Rename or retarget the component as needed so it renders `OrderHeaderFinancialProjection`.
  - Keep it display-only.
- `app/orders/page.tsx`, `src/modules/orders/order.service.ts`, `src/modules/orders/order.types.ts`
  - Add canonical financial projection data to each order table row through the service layer.
  - Prefer a narrow batched summary helper in `src/modules/financial-cases/financial-case-summary.service.ts` if using `getFinancialCaseSummary({ orderId })` per row would create an avoidable N+1 query.
  - Keep non-financial table data from the current `getOrders(filters)` flow.
- `src/components/orders/orders-table.tsx`
  - Render `toOrdersTableRow` output for total, settled, remaining, and payment status.
  - Remove formatted-string parsing from the remaining amount styling path.
- `src/modules/financial-cases/financial-case-summary.constants.ts` or equivalent
  - Add a shared label map for `FinancialCasePaymentStatus` if one does not already exist by implementation time.
- `src/lib/formatting/money.ts`
  - Add only the minimal `formatMoney` helper required by the R3a touched displays if the file still does not exist.
- Tests for header and orders table rendering from projector-shaped data.

#### PR R3b - Booking Page

- `app/bookings/[bookingId]/page.tsx`
  - Load `getFinancialCaseSummary({ bookingId })` alongside the existing booking detail loader.
  - Project through `toBookingPageFinancial`.
  - Feed the deposit/final financial section from the projection instead of `booking.depositInvoice` and `booking.packageRemainingBalanceLabel`.
- `src/modules/bookings/booking.service.ts`
  - Remove `packageRemainingBalanceLabel` and its package-total-minus-deposit arithmetic from `BookingDetail` if no remaining caller exists.
  - Keep non-financial booking detail fields unchanged.
- Booking page render tests or service-level tests that cover booking-stage and active-stage projection rendering.

### Out of Scope

- Any Prisma schema or migration change.
- Any invoice, payment, refund, credit-note, adjustment-workspace, POS, booking confirmation, or booking check-in write change.
- Changing projector formulas in `toOrderHeaderFinancial`, `toOrdersTableRow`, or `toBookingPageFinancial` except to fix a proven R1b bug discovered by parity tests.
- Swapping draft Sales sidebar, payment dialog, invoice list row, composition surfaces, edit-mode policy, or workflow policy surfaces.
- Full money formatter centralization across the repo (R4).
- Moving direct DB reads out of unrelated app/server-action files (R5).
- Removing the financial discrepancy logger or parity checker (R6).
- Removing FinancialCase fallback paths such as `getOrderSettlementInvoices()` or booking/case deposit dedup fallbacks (R12).

## Implementation Direction

### Shared Direction

Treat R3 as a consumer swap. The projectors already define the desired data shapes:

- `toOrderHeaderFinancial(summary)` returns `totalOrderValue`, `paidAmount`, `outstandingAmount`, `refundedAmount`, `hasOverpayment`, and `paymentStatusEnum`.
- `toOrdersTableRow(summary)` returns raw `totalAmount`, `paidAmount`, `remainingAmount`, and `paymentStatusEnum`.
- `toBookingPageFinancial(summary)` returns either booking-stage deposit/final-pending fields or active-stage deposit/final invoice fields.

Do not add page-local fallback math if a projector returns `null`. A missing active projection for an active order is a data/parity issue, not a reason to reintroduce `computeOrderSettlementSummary` in the page or component.

### PR R3a - Order Header + Orders Table

For the order detail header, `app/orders/[orderId]/page.tsx` already loads `financialCaseSummary` for the Financials tab. Project the same summary through `toOrderHeaderFinancial` and pass that projection into the header financial card. If the projection is `null`, render the current empty/placeholder header financial state rather than falling back to `order.settlementSummary`.

Update `OrderSettlementSummary` so its prop type is the projector type or a local view type that is structurally identical to the projector. The component should format numbers and render labels only. It must not import order settlement helpers, inspect invoices, or calculate paid/outstanding amounts.

For the orders table, keep `getOrders(filters)` as the page-facing loader, but enrich each returned row with a canonical financial table projection. The service layer should call into `src/modules/financial-cases/` for this projection. Avoid deriving the table amounts from `row.invoices`, `summarizeInvoices()`, or formatted strings in `mapOrderRow`.

Update the `Order` type conservatively. A low-risk path is to add a nullable `financialProjection` or `financial` field for the table projector while leaving legacy formatted amount fields in place until cleanup. The table should render the new projection when present and should not parse `order.remainingAmount`. Pending/no-financial-case rows should render an explicit non-financial state, not silently fallback to legacy settlement derivation.

If `src/lib/formatting/money.ts` does not exist at implementation time, add a minimal helper that formats raw numeric KD amounts consistently for R3-touched surfaces. Do not migrate the existing `formatKD` helpers elsewhere in this PR. R4 will do the broad replacement.

`summarizeInvoices()` and `mapPaymentStatus()` may remain in `order.service.ts` for non-R3 paths that still use them. The important R3a cutover is that the order header and orders table no longer consume those helpers for payment totals or payment status.

### PR R3b - Booking Page

The booking page currently renders a deposit invoice section from `BookingDetail.depositInvoice` and adds a composition-derived `packageRemainingBalanceLabel` from `booking.service.ts`. Replace only the financial inputs for that section with `toBookingPageFinancial`.

For booking-stage summaries, render deposit invoice number, deposit amount, deposit paid state, locked state, and final-invoice-pending/awaiting-final-invoice messaging from the projection. For active-stage summaries, render deposit invoice context plus the final invoice number, final invoice total, remaining amount, and payment status from the projection.

Remove the "Remaining at session" row that uses `packageRemainingBalanceLabel`. That value is package composition preview math, not FinancialCase truth. Do not replace it with package-total-minus-deposit arithmetic in the page or projector.

After the page stops rendering `booking.packageRemainingBalanceLabel`, remove that field and the `totalPackagePrice.minus(depositInvoice.totalAmount)` calculation from `BookingDetail` if no other caller remains. Keep package names, durations, photographer details, booking actions, check-in controls, and pending-delete controls unchanged.

## Observability Checklist

### Dashboards / Metrics

- `centralization.financial_case_summary.projector_parity` remains registered and must continue to pass for `toOrderHeaderFinancial` and `toOrdersTableRow`.
- `centralization.financial_case_summary.discrepancy` remains the discrepancy metric emitted by the parity checker. R3a should not add a new page-local discrepancy metric.
- R3b does not need a runtime discrepancy logger because the booking page intentionally drops `packageRemainingBalanceLabel`; cover the booking-stage drift in tests instead.

### Rollback Plan

- No schema changes. No down-migration needed.
- R3a rollback: revert the order detail header/table component changes and the service row-enrichment changes. Leave the R1/R2 financial-cases module and parity checker in place.
- If R3a added `src/lib/formatting/money.ts`, it can remain as unused additive infrastructure for R4, or be reverted with the R3a display changes if no other file imports it.
- R3b rollback: revert the booking page to `booking.depositInvoice` rendering and restore `packageRemainingBalanceLabel` only if the rollback also restores its page use.

### Customer-Visible Surface

- Staff should see the same order header financial totals, orders table totals, settled amount, remaining amount, and booking deposit information except for the intentional removal of the booking page's composition-derived "Remaining at session" row.
- Orders table remaining styling should still highlight positive balances, but it must be based on raw numeric projection data.
- Booking pages for confirmed but not checked-in bookings should clearly show deposit paid/locked/final-invoice-pending state.

## Post-Implementation

- After R3a: update `context/progress-tracker.md` Now to say R3a is complete and R3b is next.
- After R3b: update `context/progress-tracker.md` Now to say R3 is complete and R4 is next.
- Do not update architecture-context or code-standards unless implementation discovers a documented rule conflict.
- Do not refresh `context/reviews/invariant-catalog.md` unless the reconciliation invariant metadata changes, which this spec should not require.

## Acceptance Criteria

### PR R3a - Order Header + Orders Table

- `app/orders/[orderId]/page.tsx` renders the header financial card from `toOrderHeaderFinancial(financialCaseSummary)`, not `order.settlementSummary`.
- The header financial component receives projector-shaped data and remains display-only.
- The order detail header does not call `computeOrderSettlementSummary`, `derivePaymentSummary`, `deriveLockedFinancialSidebarSummary`, `summarizeInvoices`, or any invoice filtering logic.
- `getOrders(filters)` enriches order rows with `toOrdersTableRow` projection data through the service layer.
- `src/components/orders/orders-table.tsx` renders total, settled, remaining, and payment status from the canonical table projection.
- `src/components/orders/orders-table.tsx` contains no `parseFloat(order.remainingAmount...)`, formatted-money parsing, or payment-status derivation.
- R3a-touched money displays read raw projector fields and format via `src/lib/formatting/money.ts`.
- R3a-touched payment labels/badges are driven by `FinancialCasePaymentStatus`, not order-service-local `mapPaymentStatus`.
- Existing non-financial order list filters, links, adjustment-workspace badge, order status badge, and invoice link behavior remain intact.
- `checkFinancialCaseSummaryProjectorParity` runs cleanly for header and table projector scenarios.
- Tests cover active draft, active locked, locked+adjusted, credit-noted, refunded, overpaid, and missing-FinancialCase/fallback display behavior for the header/table paths.
- `npm run test:backend-invariants` passes.
- `npm run build` passes.
- `npm run lint` passes.

### PR R3b - Booking Page

- `app/bookings/[bookingId]/page.tsx` loads `getFinancialCaseSummary({ bookingId })` and renders booking financials through `toBookingPageFinancial`.
- The booking page no longer renders `booking.packageRemainingBalanceLabel` or any package-total-minus-deposit arithmetic.
- `src/modules/bookings/booking.service.ts` no longer computes `packageRemainingBalanceLabel` if no caller remains.
- Booking-stage projection rendering covers deposit invoice number, deposit amount, deposit paid state, locked state, and final-invoice-pending/awaiting-final-invoice state.
- Active-stage projection rendering covers deposit invoice context, final invoice number, final invoice total, remaining amount, and payment status.
- Pending bookings without a FinancialCase still render the existing pending/deposit-recording UI without synthetic financial values.
- Booking check-in, edit, record-deposit, delete-pending, package list, notes, and themes behavior remain unchanged.
- R3b-touched money displays read raw projector fields and format via `src/lib/formatting/money.ts`.
- Tests cover confirmed booking-stage, checked-in active-stage, and pending/no-FinancialCase booking behavior.
- `npm run build` passes.
- `npm run lint` passes.

### Overall R3

- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- No UI file or page computes money totals, payment status, deposit-applied state, remaining balance, overpayment state, or booking-stage final-invoice state for the R3 surfaces.
- No schema, migration, invoice/payment/refund/credit-note/write-service behavior changes are included.
