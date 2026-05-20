# Feature 107 - R12: Compatibility Cleanup

## Goal

Remove the financial/booking compatibility paths kept alive for the duration of R1–R11 — `summarizeInvoices()`, `getOrderSettlementInvoices()` fallback, `mapBookingDetail()` deposit-invoice dedup, and the unused `OrderDetail.includedPhotoCount` / `OrderDetail.extraPhotoCount` aggregate fields — and prove with source-level invariants that they cannot return. No schema changes, no write-service changes, no new read-model surface.

## Read First

- `AGENTS.md` — narrow context rule, docs-only progress behavior, service-only DB access.
- `context/reviews/centralization-roadmap.md` — Spec R12 deliverables and §3 risk controls (R12 is the only spec allowed to remove compatibility paths).
- `context/feature-specs/106-r11-order-detail-page-thinning.md` — established the page-thinning baseline R12 inherits; the OrderDetail photo-count compat fields it deferred are removed here.
- `context/feature-specs/101-r6-financial-swap-cleanup.md` — prior cleanup pass; pattern for source-level invariant tests asserting legacy symbols cannot reappear.
- `src/modules/orders/order.service.ts` — `mapOrderRow`, `mapCustomerOrderHistoryRow`, `summarizeInvoices`, `mapPaymentStatus`, `getOrderSettlementInvoices`, `fetchOrdersByCustomerId`, `mapOrderDetail`.
- `src/modules/orders/order.types.ts` — `OrderDetail` photo-count aggregate fields slated for removal.
- `src/modules/bookings/booking.service.ts` — `mapBookingDetail`, `dedupeAndSortDepositInvoices`, `fetchEditableBookingById`.
- `src/modules/financial-cases/orders-table-projections.service.ts` and `src/modules/financial-cases/projections/to-orders-table-row.ts` — current canonical orders-table projection; R12 may extend its output but must not change its batching behavior.
- `tests/orders/delivery-workflow-policy.test.ts` — pattern for source-level "function name does not reappear" assertions.

## Rules

- **One narrow cleanup PR.** Removals only. No new read models, no new projector surface area beyond extending `OrdersTableRowProjection` with the existing-but-derived `invoiceStatus` field, no API/DTO refactors beyond the four deletions.
- **No schema, migration, enum, seed, or Prisma model change.**
- **No write-service behavior change.** `invoice.service`, `payment.service`, `refund.service`, `adjustment-workspace.service`, `booking.service` write paths, and order write actions are untouched.
- **No `orders-table-projections.service.ts` refactor.** The `computeOrderSettlementSummary` / `deriveLockedFinancialSidebarSummary` / `deriveSettlementPaidAmount` inline construction stays as-is. Folding it into `getFinancialCaseSummary` is a separate performance follow-up and remains open in `context/progress-tracker.md`.
- **Booking deposit dedup may only be removed after the audit gate passes.** A one-time data audit must prove that for all bookings, every deposit invoice attached to `row.invoices` also appears in `row.financialCase.invoices`. If the audit finds drift, this sub-change is dropped from R12 and the dedup stays; the rest of the spec still ships.
- **`booking-status-actions.tsx` confirm gating is not touched.** The `confirmationMessage` path is live for `no-show` and `cancel` actions; the roadmap text was inaccurate. Out of scope.
- **No `@/lib/db` imports added to `app/**` or `src/components/**`.**
- **No new pages, components, or tabs.**

## Scope

### In Scope

- Delete `summarizeInvoices()` and `mapPaymentStatus()` from `src/modules/orders/order.service.ts`.
- Delete `getOrderSettlementInvoices()` from `src/modules/orders/order.service.ts`. `mapOrderRow` reads `row.booking.financialCase.invoices` directly; if missing on an order row, return a stable empty-settlement DTO (no fallback to `row.invoices`).
- Extend `OrdersTableRowProjection` with `invoiceStatus: InvoiceStatus` carrying the **raw Prisma `InvoiceStatus` enum value** of the FinancialCase's final invoice. The projection does not carry display labels — the projection owns canonical/raw status; `mapOrderRow` and `mapCustomerOrderHistoryRow` own label formatting via the existing `mapInvoiceStatus(...)` in `order.service.ts`. This keeps `src/modules/financial-cases/` independent of `src/modules/orders/` label types.
- When the projection is null (no final invoice yet), the row mapper falls back to the typed `"No Invoice"` `InvoiceStatusLabel` literal — no derivation from `row.invoices`.
- `mapOrderRow` consumes `paymentStatusEnum`, `totalAmount`, `paidAmount`, `remainingAmount`, and raw `invoiceStatus` from `OrdersTableRowProjection`, then applies `mapInvoiceStatus` for the display label and the new payment-status label helper (see below) for the payment chip. Final invoice ID / number for `primaryInvoiceId` / `primaryInvoiceNumber` continue to read from `row.invoices[0]` since that is identity data, not derivation.
- `mapCustomerOrderHistoryRow` consumes the orders-table projection (`getOrdersTableFinancialProjections({ orderIds })`) for raw `invoiceStatus` and `paymentStatusEnum`, and applies the same `mapInvoiceStatus` + payment-status label helper used by `mapOrderRow`. `getCustomerOrderHistory` (or its caller in `order.service.ts`) batches the projection lookup for all rows in one call. No N+1.
- Add a single small typed payment-status label helper (e.g. `mapFinancialCasePaymentStatusToLabel(status: FinancialCasePaymentStatus): OrderPaymentStatusLabel`) **only if no equivalent shared helper already exists**. Place it adjacent to the FinancialCase payment-status constants in `src/modules/financial-cases/` and import it from `order.service.ts` for both row mappers. This helper is the sole replacement for the deleted `mapPaymentStatus(...)` — no new workflow/status system, no broader enum table.
- Delete `dedupeAndSortDepositInvoices` from `src/modules/bookings/booking.service.ts`. `mapBookingDetail` reads `row.financialCase?.invoices ?? []` for deposit-invoice display; `row.invoices` is no longer merged. Gate this sub-change on the data audit below.
- Delete `OrderDetail.includedPhotoCount` and `OrderDetail.extraPhotoCount` from `src/modules/orders/order.types.ts` and from `mapOrderDetail` in `src/modules/orders/order.service.ts`. Aggregate photo counts already flow through `ProductionDeliverablesProjection` (R11) and `OrderCompositionViewModel.summary`; the order-level aggregates have no remaining consumers.
- Pre-removal data audit script/test for the booking deposit dedup: a one-time test (or scripted invariant) that asserts no booking row has a deposit invoice present on `booking.invoices` that is not also present on `booking.financialCase.invoices`. Acceptable form: a `tests/bookings/deposit-invoice-canonicalization.test.ts` that runs against the reconciliation fixture set and fails fast if drift exists; or an equivalent invariant test attached to the nightly reconciliation suite.
- Source-level invariant test that reads `src/modules/orders/order.service.ts` and asserts the identifiers `summarizeInvoices`, `mapPaymentStatus`, and `getOrderSettlementInvoices` are not declared. A second assertion against `src/modules/bookings/booking.service.ts` asserts `dedupeAndSortDepositInvoices` is not declared.
- Parity snapshot extension on the existing orders-table / customer-order-history test fixtures covering: draft order (no FinancialCase), locked active order, locked + finalized adjustment, refunded, credit-noted, overpaid. The fixtures already exist for R3/R6 — extend assertions to cover `invoiceStatus` coming from the projection.
- Update `context/progress-tracker.md` Now to reflect R12 completion and the centralization roadmap as fully shipped (minus the deferred orders-table-projections performance follow-up, which remains in Open Follow-Ups).

### Out of Scope

- Any refactor of `src/modules/financial-cases/orders-table-projections.service.ts`. Its independent active-summary construction stays. The performance follow-up listed in `context/progress-tracker.md` is untouched.
- `booking-status-actions.tsx` confirmation flow. `confirmationMessage` remains live for `no-show` and `cancel`.
- Replacing `window.confirm` with a styled dialog. Separate UX concern.
- Any new orchestrator service (`getOrderDetailsView`, etc.). R11 reassessment closed the orchestrator question.
- Removal of `OrderPackageLineDisplay.includedPhotoCount` / `extraPhotoCount` or `OrderSelectionWorkflow.includedPhotoCount` / `extraPhotoCount`. Per-line and per-selection photo counts have live consumers and are not aggregates.
- Removal of `Order.invoiceStatus` / `Order.paymentStatus` from the row type. Their values are now sourced from the projection — the fields themselves stay because UI consumers (`InvoiceStatusBadge`, `phone-sales-search`, orders-table) depend on them.
- Removal of `Order.totalAmount` / `Order.paidAmount` / `Order.remainingAmount` formatted strings. Money formatting is centralized at R4; row-level formatted fields stay until a separate spec replaces them with raw numbers + format-at-render.
- Removal of any `FINAL_PARENT_INVOICE_WHERE`-filtered `row.invoices` selection on the order rows themselves; that select still feeds `primaryInvoiceId` / `primaryInvoiceNumber` and the `hasOpenAdjustmentWorkspace` ancillary check.
- Backfill scripts, schema migrations, enum changes, or Prisma model updates.
- Invoice/payment/refund/adjustment/credit-note/composition write behavior.
- Workflow status mapping or policy changes.
- Any change to `context/architecture-context.md` or `context/code-standards.md` unless removal exposes a stale rule that explicitly references one of the deleted symbols.

## Implementation Direction

Treat this strictly as a deletion pass with one supporting projection extension and one audit gate.

### 1. Orders-table projection: extend with raw `invoiceStatus`

Add `invoiceStatus: InvoiceStatus` (the **raw Prisma enum**, not a label) to `OrdersTableRowProjection`. Populate it inside `buildOrdersTableProjection` (`src/modules/financial-cases/orders-table-projections.service.ts`) by reading `finalInvoice.status` directly. The projection module must not import any label types or label mappers from `src/modules/orders/`.

If no shared typed payment-status label helper currently exists for `FinancialCasePaymentStatus` → `OrderPaymentStatusLabel`, add one — single function, adjacent to the FinancialCase payment-status constants under `src/modules/financial-cases/` — and use it from both row mappers. Keep this strictly scoped as the replacement for the deleted `mapPaymentStatus(...)`. Do not generalize.

This is the only additive change in R12. The projection owns canonical/raw status; `mapOrderRow` / `mapCustomerOrderHistoryRow` own label formatting via `mapInvoiceStatus` and the new payment-status label helper.

### 2. `mapOrderRow` — read from projection only

Replace the `summarizeInvoices(row.invoices)` and `getOrderSettlementInvoices(row)` calls in `mapOrderRow` with reads from the already-passed `financial: OrdersTableRowProjection | null` argument:

- `invoiceStatus` ← `financial ? mapInvoiceStatus(financial.invoiceStatus) : "No Invoice"`
- `paymentStatus` ← `financial ? mapFinancialCasePaymentStatusToLabel(financial.paymentStatusEnum) : "Pending"` (using the helper from §1)
- `totalAmount` / `paidAmount` / `remainingAmount` ← formatted from the projection's numeric fields via `formatMoney(new Prisma.Decimal(...))`

The `"Overridden"` payment-status state that `mapPaymentStatus()` previously produced (`invoice.status === CLOSED && remainingAmount > 0`) is already represented in `FinancialCasePaymentStatus` via `deriveFinancialCasePaymentStatus(...)`. The new payment-status label helper **must** map that enum value to the existing `"Overridden"` `OrderPaymentStatusLabel`. R12 preserves the externally visible "Overridden" state; it does not retire it. If `FinancialCasePaymentStatus` lacks an "overridden" enum value, this is a blocker — fix the gap in the helper input rather than dropping the label.

Do not reintroduce a row-level fallback that aggregates `row.invoices`. A null projection means "no final invoice yet" and the row displays the typed "no invoice" / "Pending" placeholders.

### 3. `mapCustomerOrderHistoryRow` — adopt the projection

`getCustomerOrderHistory` (or whichever exported function wraps `fetchOrdersByCustomerId` → `mapCustomerOrderHistoryRow`) calls `getOrdersTableFinancialProjections({ orderIds })` once for the full set of rows. The mapper consumes the projection the same way `mapOrderRow` does for `invoiceStatus` and `paymentStatus`. No per-row DB call.

Drop `summarizeInvoices(row.invoices)` from `mapCustomerOrderHistoryRow`.

### 4. Delete `summarizeInvoices`, `mapPaymentStatus`, `getOrderSettlementInvoices`

After (2) and (3), confirm via grep that no other caller references these three functions, then remove their declarations, the `InvoiceSummaryRow` type alias, and any imports of `mapInvoiceStatus`/`mapPaymentStatus` that become dead. If `mapInvoiceStatus` is still needed (it is — orders-table-projections will import it per §1), keep it; if it ends up only used in the projection module, relocate it there.

### 5. Booking deposit dedup — audit then remove

Write the audit test first. It must verify **both membership and ordering parity**:

- Iterate all booking rows that have both `invoices` and `financialCase.invoices`.
- Membership assertion: every invoice ID present on `booking.invoices` of type DEPOSIT is also present on `booking.financialCase.invoices`.
- Ordering assertion: for each such booking, the ordered list produced by reading `row.financialCase.invoices` directly equals the ordered list produced by the existing `dedupeAndSortDepositInvoices([...row.invoices, ...row.financialCase.invoices])`. The current behavior is newest-first by `createdAt` — the post-removal source must produce the same sequence. If `row.financialCase.invoices` is not already ordered newest-first, the spec's removal step adds an inline `.slice().sort(...)` to `mapBookingDetail` to preserve the order; the audit asserts the final consumed sequence is byte-equivalent.
- Run against the existing reconciliation fixture set / dev seed; not against production.

If the audit passes both membership and ordering locally and in CI (or against the nightly reconciliation invariant if it is wired in), remove `dedupeAndSortDepositInvoices` and change `mapBookingDetail` to read deposit invoices from `row.financialCase?.invoices ?? []`, preserving newest-first `createdAt` ordering via an inline sort if and only if the Prisma select does not already guarantee it. The `hasDepositPayment` helper continues to receive an invoice array; its signature does not change.

If the audit fails on membership or ordering for any fixture or live data the team has access to, **leave the dedup in place** and ship R12 without sub-change 5. Note the deferral in `context/progress-tracker.md` Open Follow-Ups.

### 6. Remove `OrderDetail.includedPhotoCount` / `OrderDetail.extraPhotoCount`

Delete both fields from `OrderDetail` in `src/modules/orders/order.types.ts`. Delete the corresponding lines in `mapOrderDetail` (`src/modules/orders/order.service.ts` around the existing `formatCount(...)` block for these two aggregates). No UI consumer remains after R11; verify with grep before deletion. The per-line `OrderPackageLineDisplay.includedPhotoCount` / `extraPhotoCount` and `OrderSelectionWorkflow.includedPhotoCount` / `extraPhotoCount` fields are unaffected.

### 7. Source-level invariant test

Add `tests/orders/centralization-cleanup.test.ts` (or extend an existing R6-style invariant file) that:

- Reads `src/modules/orders/order.service.ts` source and asserts none of `summarizeInvoices`, `mapPaymentStatus`, `getOrderSettlementInvoices` appear as **function declarations** — match must be declaration-scoped, not a substring scan. Use a per-name regex of the form `/^(?:export\s+)?(?:async\s+)?function\s+<name>\b/m` (or the equivalent multiline anchored pattern). This avoids false positives from comments, strings, JSDoc, or unrelated identifier substrings.
- Reads `src/modules/bookings/booking.service.ts` source and asserts `dedupeAndSortDepositInvoices` is not declared with the same declaration-scoped regex shape (skip this assertion if sub-change 5 was deferred — gate it on a single `R12_DEPOSIT_DEDUP_REMOVED` constant inside the test).
- Reads `src/modules/orders/order.types.ts` source and asserts `includedPhotoCount` and `extraPhotoCount` do not appear inside the `OrderDetail` interface block. Scope the match to the `interface OrderDetail { ... }` block (slice the source between the `interface OrderDetail` opening brace and the matching close), then run a property-style regex (e.g. `/^\s*includedPhotoCount\s*[:?]/m`) over the slice — not the whole file. This prevents a match on `OrderPackageLineDisplay.includedPhotoCount` from causing a false positive.

These guards exist so future edits cannot silently reintroduce the legacy aggregation paths.

### 8. Parity fixtures

Re-run the existing orders-table and customer-order-history parity snapshots covering draft / locked / locked+adjusted / refunded / credit-noted / overpaid orders. Update only the assertions that need to verify raw `invoiceStatus` now flows through the projection and is label-mapped at the row mapper.

The parity set **must include an "Overridden" case** — a row whose final invoice was force-closed while a remaining balance is non-zero. Asserting this state continues to render the `"Overridden"` payment-status label is required; without it, R12 risks silently retiring a live state. If no fixture currently produces this state, add one minimal fixture; do not skip the case.

No other new fixtures unless an edge case (e.g. `"No Invoice"` for a draft order) is missing.

## What R12 Must Not Touch

- `src/modules/financial-cases/orders-table-projections.service.ts` internals beyond adding `invoiceStatus` to the projection output.
- `src/components/bookings/booking-status-actions.tsx` and its `confirmationMessage` plumbing.
- Any write service, write action, or transaction body.
- Prisma schema, migrations, seeds, enums.
- `getFinancialCaseSummary`, projector internals, view-model internals — these are read-only by R12.
- Workflow policy code in `src/modules/orders/policies/` and `src/modules/bookings/booking-workflow-policy.ts`.
- `OrderDetail` fields other than `includedPhotoCount` / `extraPhotoCount`.

## Observability Checklist

### Dashboards / Metrics

- No new production metric.
- Existing nightly reconciliation invariants (financial case canonicalization, payment-status enum coherence) are the live safety net for the deposit-dedup removal. If the dedup is removed in this spec, the deposit-canonicalization invariant must be the gating check used in the audit and continue to run nightly afterward.

### Rollback Plan

- No schema changes. No down-migration needed.
- Each sub-change is independently revertable: (a) re-add `summarizeInvoices` + `mapPaymentStatus` and route `mapOrderRow` / `mapCustomerOrderHistoryRow` back through them; (b) re-add `getOrderSettlementInvoices` with the original fallback; (c) re-add `dedupeAndSortDepositInvoices` and the merge in `mapBookingDetail`; (d) re-add `OrderDetail.includedPhotoCount` / `extraPhotoCount`.
- The `OrdersTableRowProjection.invoiceStatus` addition is purely additive; even if the rest of R12 is rolled back, the projection field can stay.

### Customer-Visible Surface

- Zero visible change expected. `InvoiceStatusBadge` and `paymentStatus` chips render identical labels for all six fixture states.
- The booking deposit-invoice row in the booking detail panel renders identical content; the dedup was a defensive merge, not a display selector.

## Post-Implementation

- Update `context/progress-tracker.md` Now: R12 compatibility cleanup is complete; centralization roadmap R0–R12 is closed except the deferred orders-table-projections performance follow-up.
- Leave the existing orders-table-projections performance entry in Open Follow-Ups.
- If sub-change 5 (deposit dedup removal) was deferred, add a new Open Follow-Up: "Verify booking deposit invoice canonicalization in production data, then drop `dedupeAndSortDepositInvoices`."
- Do not update `context/architecture-context.md` or `context/code-standards.md` unless removal exposes a stale rule.
- Do not refresh `context/reviews/invariant-catalog.md`; R12 does not change financial invariants — it removes redundant pre-canonical derivations.

## Acceptance Criteria

- `summarizeInvoices`, `mapPaymentStatus`, and `getOrderSettlementInvoices` are no longer declared in `src/modules/orders/order.service.ts`.
- `mapOrderRow` derives `invoiceStatus`, `paymentStatus`, `totalAmount`, `paidAmount`, and `remainingAmount` from the `OrdersTableRowProjection` argument. When the projection is null, it renders typed `"No Invoice"` / `"Pending"` literals — no fallback to `row.invoices`.
- `mapCustomerOrderHistoryRow` derives `invoiceStatus` and `paymentStatus` from `OrdersTableRowProjection`. The wrapping query path calls `getOrdersTableFinancialProjections({ orderIds })` once for the full row set; no per-row DB call is introduced.
- `OrdersTableRowProjection` includes `invoiceStatus: InvoiceStatus` (the **raw Prisma enum**) sourced from the FinancialCase's final invoice. `buildOrdersTableProjection` populates it. The projection module does not import label types from `src/modules/orders/`; label formatting happens in the row mappers via `mapInvoiceStatus`.
- The replacement payment-status label helper (mapping `FinancialCasePaymentStatus` → `OrderPaymentStatusLabel`) lives adjacent to the FinancialCase payment-status constants in `src/modules/financial-cases/` and is used by both `mapOrderRow` and `mapCustomerOrderHistoryRow`. The `"Overridden"` `OrderPaymentStatusLabel` is preserved end-to-end.
- Parity snapshots include an "Overridden" case (final invoice force-closed with non-zero remaining) asserting the row continues to render the `"Overridden"` payment-status label.
- The deposit-canonicalization audit verifies **both membership and ordering parity** (newest-first by `createdAt`). The dedup is removed only if both pass; otherwise sub-change 5 is deferred.
- `OrderDetail.includedPhotoCount` and `OrderDetail.extraPhotoCount` are removed from `OrderDetail` and from `mapOrderDetail`. Per-line and per-selection photo counts are unchanged.
- If the deposit-canonicalization audit passes: `dedupeAndSortDepositInvoices` is removed from `src/modules/bookings/booking.service.ts`, and `mapBookingDetail` reads deposit invoices from `row.financialCase?.invoices ?? []` only. If the audit fails: the dedup stays and R12 ships without this sub-change.
- The deposit-canonicalization audit test exists in `tests/bookings/` (or equivalent) and runs in CI. It fails fast if any booking has a deposit invoice on `booking.invoices` that is missing from `booking.financialCase.invoices`.
- A source-level invariant test asserts `summarizeInvoices`, `mapPaymentStatus`, `getOrderSettlementInvoices`, and (when sub-change 5 ships) `dedupeAndSortDepositInvoices` are not declared in their respective service files. Assertions use a declaration-scoped regex (`^(?:export\s+)?(?:async\s+)?function\s+<name>\b`, multiline) — not substring scans — so comments, strings, and unrelated identifiers cannot trigger false positives. The `OrderDetail` photo-count assertion scopes its regex to the `interface OrderDetail { ... }` slice so unrelated interfaces are not matched.
- `src/modules/financial-cases/orders-table-projections.service.ts` internals — apart from the additive `invoiceStatus` field — are unchanged. No `getFinancialCaseSummary` delegation. No batching change.
- `src/components/bookings/booking-status-actions.tsx` is unchanged.
- No `@/lib/db` import is added to `app/**` or `src/components/**`.
- No Prisma schema, migration, enum, seed, invoice/payment/refund/adjustment/credit-note/composition write, or workflow transaction behavior change.
- Existing R2/R3/R6/R8/R10/R11 financial, composition, workflow, and page-thinning tests remain green.
- Orders-table and customer-order-history parity snapshots cover draft, locked, locked+adjusted, refunded, credit-noted, and overpaid states and assert `invoiceStatus` flows through the projection.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
