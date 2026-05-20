# Feature 96 — R1b: Remaining Financial Case Surface Projectors

## Goal

Add the remaining six surface projectors to `src/modules/financial-cases/projections/`, completing the R1 deliverable defined in `context/reviews/centralization-roadmap.md`. The two R2-target projectors (`toFinancialTabBlock`, `toSalesSidebarLocked`) already exist from R1a (Feature 95). This spec adds: `toOrderHeaderFinancial`, `toDraftSidebarFinancial`, `toPaymentDialogContext`, `toOrdersTableRow`, `toBookingPageFinancial`, and `toInvoiceListRow`. No UI consumer is swapped here — R3a (header + orders table), R3b (booking page), and R8a (draft sidebar, payment dialog) own those swaps.

## Read First

- `context/reviews/centralization-roadmap.md` — Spec R1 description (R1a/R1b split), R3a/b scope, R8a scope, §8.5 Spec Drafting Notes.
- `src/modules/financial-cases/` — every file in the module: service, types, discrepancy logger, barrel exports, and the two R1a projectors. These are the patterns to copy exactly.
- `src/modules/orders/order.types.ts` — `OrderSettlementSummary` type (fields: `totalOrderValue`, `paidAmount`, `outstandingAmount`, `refundedAmount`, `hasOverpayment`) — the legacy shape `toOrderHeaderFinancial` must match.
- `src/components/orders/order-settlement-summary.tsx` — how the order header currently renders `OrderSettlementSummary`.
- `src/components/orders/orders-table.tsx` — how the orders table currently reads `order.totalAmount`, `order.paidAmount`, `order.remainingAmount` (currently formatted strings). Note: the table even does `parseFloat(order.remainingAmount.replace(...))` — the new projector returns raw numbers, ending this pattern.
- `src/components/orders/financial-sidebar-draft.tsx` — the financial fields the draft sidebar needs from its data source (invoice totals, remaining, deposit amount, payment status). Note: the projector is named `toDraftSidebarFinancial` (not `toSalesSidebarDraft`) to make explicit that it owns only the financial subsection of the draft sidebar, not the composition preview state.
- `src/components/orders/pos-record-payment-dialog.tsx` — the financial context the payment dialog needs (`invoiceNumber`, `invoiceTotal`, `paidAmount`, `remainingAmount`, `isLocked`, and capacity fields).
- `app/bookings/[bookingId]/page.tsx` — the `depositInvoice` shape rendered and the `packageRemainingBalanceLabel` field (read the note below about intentional drift).
- `src/components/invoices/invoices-table.tsx` — the `InvoiceListItem` fields each row renders (`invoiceNumber`, `totalAmount`, `paidAmount`, `remainingAmount`, `status`, `isLocked`, `createdAt`).
- `src/modules/orders/order-settlement.ts` — `computeOrderSettlementSummary` (the legacy source for the header parity check).
- `tests/financial/financial-case-summary/` — both existing test files to understand fixture conventions, harness imports, and assertion style.

## Rules

- **Read-only.** No schema changes, no UI changes, no write-service changes.
- **No consumer swap.** Do not modify any `app/**` page, server action, or `src/components/**` file. The projectors are added unused; swap specs activate them.
- **Reuse, do not re-derive.** Projectors take `FinancialCaseSummary` as input and return a typed DTO. They call no DB, import no Prisma client, and perform no money math. They reshape from the already-computed canonical summary fields.
- **Extend `FinancialCaseDepositInvoiceSummary` to add `isLocked`.** The booking page needs `depositInvoice.isLocked`. The service already fetches this field (`fetchFinancialCaseRow` selects `isLocked` on all invoices). Add `isLocked: boolean` to `FinancialCaseDepositInvoiceSummary` in `financial-case-summary.types.ts` and thread it through the service. This is an additive, non-breaking types change.
- **Parity is value-level, not format-level for `toOrdersTableRow`.** The orders table currently stores formatted string amounts (`"KD 120.000"`) and even parses them back with `parseFloat`. `toOrdersTableRow` returns raw `number` fields. The R3a swap spec updates the table to consume raw numbers and format via `src/lib/formatting/money.ts`. Parity tests for `toOrdersTableRow` compare raw numeric values against fixture-known amounts, not against legacy formatted strings.
- **`toBookingPageFinancial` does not include `packageRemainingBalanceLabel`.** This field is composition-derived (`packagePrice − depositPaid`) and does not belong in `FinancialCaseSummary`. R3b will update the booking page to drop this arithmetic and render the financial summary without it. The spec calls this out as intentional drift; see the Observability Checklist.
- **Barrel exports.** Add all new projectors and their DTO types to both `projections/index.ts` and `src/modules/financial-cases/index.ts`, following the exact pattern from R1a.
- **Parity checker extension.** Extend `checkFinancialCaseSummaryProjectorParity` in `financial-case-summary.service.ts` to also cover `toOrderHeaderFinancial` and `toOrdersTableRow`, since R3a will swap those surfaces. The checker compares projector output against `computeOrderSettlementSummary` output (for header) and against direct summary field values (for the table row). Follow the existing loop pattern — add the two projectors to the checked set alongside `toFinancialTabBlock` and `toSalesSidebarLocked`.

## Scope

### In Scope

- `src/modules/financial-cases/financial-case-summary.types.ts` — add `isLocked: boolean` to `FinancialCaseDepositInvoiceSummary`.
- Six new projector files, each exporting one projector function and one DTO type:
  - `src/modules/financial-cases/projections/to-order-header-financial.ts`
  - `src/modules/financial-cases/projections/to-draft-sidebar-financial.ts`
  - `src/modules/financial-cases/projections/to-payment-dialog-context.ts`
  - `src/modules/financial-cases/projections/to-orders-table-row.ts`
  - `src/modules/financial-cases/projections/to-booking-page-financial.ts`
  - `src/modules/financial-cases/projections/to-invoice-list-row.ts`
- `src/modules/financial-cases/projections/index.ts` — barrel-export all six new projectors and their types.
- `src/modules/financial-cases/index.ts` — re-export all six new projectors and their types.
- `src/modules/financial-cases/financial-case-summary.service.ts` — extend `checkFinancialCaseSummaryProjectorParity` to include `toOrderHeaderFinancial` and `toOrdersTableRow`.
- New test file `tests/financial/financial-case-summary/projection-parity-r1b.test.ts` covering all six projectors across every applicable stage (see Tests below).

### Out of Scope

- Swapping any UI consumer (R3a, R3b, R8a own those).
- Changes to `discrepancy-logger.ts` — R1a's shape is sufficient for all R1b projectors.
- Changes to any `app/**` page, server action, or `src/components/**` component.
- Removing or replacing any legacy derivation (the legacy paths stay until each swap spec).
- `OrderCompositionViewModel` and downstream specs (R7+).
- Money formatter centralization (R4).
- DB-import cleanup (R5).
- Schema changes of any kind.

## Implementation Direction

### Projector shapes

**`toOrderHeaderFinancial(summary) → OrderHeaderFinancialProjection | null`**

Booking stage: return `null` (no Final Invoice means no order header card).

Active stage: return a shape that covers every field `OrderSettlementSummary` exposes, plus `paymentStatusEnum`:

```
totalOrderValue   = summary.customerTotal
paidAmount        = summary.paidSoFar
outstandingAmount = summary.remaining
refundedAmount    = summary.refunds.reduce((acc, r) => acc + r.total, 0)
hasOverpayment    = summary.overpaymentCapacity > 0
paymentStatusEnum = summary.paymentStatusEnum
```

The legacy `computeOrderSettlementSummary` aggregates invoice totals and remaining amounts differently (it reads from raw invoice rows). The parity check in `checkFinancialCaseSummaryProjectorParity` compares `outstandingAmount` and `totalOrderValue` within the `0.0005` tolerance already used by the discrepancy logger.

---

**`toDraftSidebarFinancial(summary) → DraftSidebarFinancialProjection | null`**

The draft sidebar is only rendered when an order exists (post check-in, POS open), so it is always an active-stage FinancialCase. Booking stage: return `null`.

Active stage: return a shape covering the invoice-financial portion the draft sidebar needs — excluding the composition breakdown (package lines, add-ons, extra photos), which is produced by R7/R8's composition projectors. The name `toDraftSidebarFinancial` (rather than `toSalesSidebarDraft`) signals this boundary: this projector owns the financial subsection only. Composition preview state is not its concern and must never be added here.

```
finalInvoiceId     = summary.finalInvoice.id
finalInvoiceNumber = summary.finalInvoice.invoiceNumber
isLocked           = summary.finalInvoice.isLocked
invoiceStatus      = summary.finalInvoice.status
invoiceTotal       = summary.customerTotal
paidSoFar          = summary.paidSoFar
depositApplied     = summary.depositApplied
remaining          = summary.remaining
paymentStatusEnum  = summary.paymentStatusEnum
```

---

**`toPaymentDialogContext(summary) → PaymentDialogContextProjection | null`**

Booking stage: return `null` (no payment dialog without a Final Invoice).

Active stage: the payment dialog pre-fills the remaining amount and enforces the overpayment cap. Return:

```
finalInvoiceId     = summary.finalInvoice.id
finalInvoiceNumber = summary.finalInvoice.invoiceNumber
isLocked           = summary.finalInvoice.isLocked
invoiceStatus      = summary.finalInvoice.status
invoiceTotal       = summary.customerTotal
paidAmount         = summary.paidSoFar
remainingAmount    = summary.remaining
overpaymentCapacity = summary.overpaymentCapacity
creditNoteCapacity  = summary.creditNoteCapacity
paymentStatusEnum  = summary.paymentStatusEnum
```

---

**`toOrdersTableRow(summary) → OrdersTableRowProjection | null`**

Booking stage: return `null` (the orders table does not list booking-stage records).

Active stage: return raw numbers — not formatted strings. The orders table currently stores and renders `order.totalAmount`, `order.paidAmount`, and `order.remainingAmount` as formatted strings, even parsing them back with `parseFloat(...)`. This projector ends that pattern. R3a will update the table to format via `src/lib/formatting/money.ts`.

```
totalAmount       = summary.customerTotal
paidAmount        = summary.paidSoFar
remainingAmount   = summary.remaining
paymentStatusEnum = summary.paymentStatusEnum
```

---

**`toBookingPageFinancial(summary) → BookingPageFinancialProjection`**

This projector handles both stages (unlike most others) because the booking page renders financial info even before check-in.

Booking stage:
```
stage                          = "booking"
depositInvoice                 = summary.depositInvoice  (or null if absent)
depositPaid                    = summary.depositPaid
awaitingFinalInvoiceAfterCheckIn = summary.awaitingFinalInvoiceAfterCheckIn
finalInvoicePending            = summary.finalInvoicePending
```

Active stage:
```
stage             = "active"
depositInvoice    = { id, invoiceNumber, total, paidAmount, status, isLocked }
                   (reconstruct from summary.finalInvoice.depositPaidAmount + the
                    deposit invoice info — see note below)
finalInvoice      = { id, invoiceNumber, total, remaining, status, isLocked }
remaining         = summary.remaining
paymentStatusEnum = summary.paymentStatusEnum
```

**Note on active-stage deposit invoice:** `FinancialCaseActiveSummary` carries `finalInvoice.depositPaidAmount` (the deposit credited toward the final invoice) but does not carry the full deposit invoice row. The deposit invoice's `id`, `invoiceNumber`, `status`, and `isLocked` are not in the active-stage summary as typed today. Two options: (a) reconstruct the deposit invoice shape from `FinancialCaseBookingSummary`-like data by fetching it again — which violates the "pure projector" rule; or (b) extend `FinancialCaseActiveSummary` to carry a `depositInvoice` field mirroring the booking-stage shape. Option (b) is correct and in scope for R1b. Add `depositInvoice: FinancialCaseDepositInvoiceSummary | null` to `FinancialCaseActiveSummary` in `financial-case-summary.types.ts` and populate it in `financial-case-summary.service.ts` (the service already fetches the deposit invoice for the active-stage build path).

**Architectural note:** The additive `depositInvoice` field on `FinancialCaseActiveSummary` is a transitional convenience for booking-page financial projection and should not be treated as precedent that all surface-specific data belongs directly on `FinancialCaseSummary`. The canonical summary carries data that is financial-case-scoped and reused across multiple surfaces. Fields that exist solely because one surface needs them are a smell; this field is justified only because the deposit invoice is genuinely part of the financial case and is already fetched by the service. Do not add further surface-specific fields to the summary type.

**Important drift:** The legacy booking page renders `packageRemainingBalanceLabel` — a formatted string derived from `packageTotal − depositPaid` composition math. `toBookingPageFinancial` does not include this field. The booking-stage projection returns financial truth; composition-based preview totals are out of scope for `FinancialCaseSummary`. R3b will update the booking page to render the deposit invoice + status without the composition-derived label. See Observability Checklist.

---

**`toInvoiceListRow(summary) → InvoiceListRowProjection[]`**

Returns an array of rows — one per linked document. Never returns `null`; returns `[]` for booking stage (empty linked documents).

Active stage: map `summary.linkedDocuments[]` into rows:
```
invoiceId      = doc.invoiceId
invoiceNumber  = doc.invoiceNumber
invoiceType    = doc.invoiceType
total          = doc.invoiceTotal
paidAmount     = doc.paidAmount
remainingAmount = doc.remainingAmount
status         = doc.invoiceStatus
issuedAt       = doc.issuedAt
createdAt      = doc.createdAt
```

The `LinkedFinancialDocument` shape (from `src/modules/orders/order.types.ts`) already has these fields. Inspect it to derive the exact DTO type. Note: `isLocked` is not in `LinkedFinancialDocument` today. If the invoice list table renders a "Locked" column, either add `isLocked` to `LinkedFinancialDocument` (a service-layer change in `getLinkedFinancialDocumentsForOrderWithClient`) or omit `isLocked` from `InvoiceListRowProjection` and note this as a gap for R3/R6 to resolve. The decision must be recorded in the PR description.

### Extending `checkFinancialCaseSummaryProjectorParity`

The existing checker in `financial-case-summary.service.ts` iterates all active FinancialCases and compares `toFinancialTabBlock` + `toSalesSidebarLocked` against the legacy locked sidebar derivation. Extend the same loop to also check:

- `toOrderHeaderFinancial` — compare `outstandingAmount` against `computeOrderSettlementSummary(financialCase.invoices).outstandingAmount` and `totalOrderValue` against the settlement `totalOrderValue`. Import `computeOrderSettlementSummary` from `@/modules/orders/order-settlement`. Comparison uses the same `compareSummaryWithLegacy` helper and `0.0005` tolerance.
- `toOrdersTableRow` — compare `remainingAmount` and `totalAmount` against the same settlement summary fields (these are the same values; the table row projector is a subset of the header projector). Adding this checker ensures the nightly invariant will catch drift once R3a wires these projectors into the table.

Do not extend the checker for `toDraftSidebarFinancial`, `toPaymentDialogContext`, `toBookingPageFinancial`, or `toInvoiceListRow` in this spec — their legacy comparisons are either composition-entangled (draft sidebar) or stage-dependent (booking page), making clean nightly comparison impractical until the R8a/R3b swap specs establish parity test fixtures.

### Test coverage

Tests go in `tests/financial/financial-case-summary/projection-parity-r1b.test.ts`. Follow the `withIsolatedBackendInvariantSchema` + Node.js `test` runner pattern from the existing test files in the same directory. Reuse fixtures from `tests/fixtures/financial` (e.g. `makeFinancialCaseSummaryOrderFixture`, `makeAutoAdjustedBookingFixture`, `makeRefundedBookingFixture`, `makeMixedEditBookingFixture`). Extend the fixtures file if a needed scenario is missing rather than inlining test data.

Scenarios to cover for each projector:

| Projector | Booking stage | Active draft | Active locked | Locked+adjusted | Refunded | Overpaid |
|---|---|---|---|---|---|---|
| `toOrderHeaderFinancial` | returns null | ✓ | ✓ | ✓ | ✓ | ✓ |
| `toDraftSidebarFinancial` | returns null | ✓ | ✓ | ✓ | ✓ | ✓ |
| `toPaymentDialogContext` | returns null | ✓ | ✓ | ✓ | ✓ | ✓ |
| `toOrdersTableRow` | returns null | ✓ | ✓ | ✓ | ✓ | ✓ |
| `toBookingPageFinancial` | ✓ (depositPaid, flags) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `toInvoiceListRow` | returns [] | ✓ (n rows) | ✓ | ✓ (adj row) | ✓ (refund row) | ✓ |

For active-stage projectors, assert field values match the fixture's known financial amounts (e.g. for `toOrderHeaderFinancial`, `totalOrderValue` equals the package price used in the fixture, `outstandingAmount` equals remaining balance, etc.).

For `toBookingPageFinancial` booking-stage: assert `stage === "booking"`, `depositPaid === true`, `finalInvoicePending === true`, `awaitingFinalInvoiceAfterCheckIn` reflects whether a Job exists.

For `toInvoiceListRow` active-locked: assert the returned array contains a row for each document type present in the fixture (DEPOSIT, FINAL, and any ADJ/CN/REFUND rows).

## Observability Checklist

### Dashboards / Metrics

- `checkFinancialCaseSummaryProjectorParity` is extended; the nightly reconciliation invariant (registered in R1a) will now also compare `toOrderHeaderFinancial` and `toOrdersTableRow` output against settlement summary values. No new metric key is needed — discrepancies continue to emit under `centralization.financial_case_summary.discrepancy` with the `projector` field distinguishing which projector fired.
- The four projectors NOT added to the nightly checker (`toDraftSidebarFinancial`, `toPaymentDialogContext`, `toBookingPageFinancial`, `toInvoiceListRow`) have no production-facing observability until their swap specs (R3b, R8a) wire them in.

### Rollback Plan

- No schema changes. No down-migration needed.
- The six new projectors are unused by any UI consumer. Removing the six new files, reverting `projections/index.ts`, `financial-cases/index.ts`, and the parity checker extension fully reverts this spec.
- The additive type changes (`isLocked` on `FinancialCaseDepositInvoiceSummary`, `depositInvoice` on `FinancialCaseActiveSummary`) are backward-compatible; removing them and their service threading is the only additional revert step.

### Customer-Visible Surface

- None. Staff and customers see no change. All projectors are dead code until R3a/b and R8a.

## Post-Implementation

- `context/progress-tracker.md` — update Now: "R1b complete: all six remaining projectors in `src/modules/financial-cases/projections/`; parity checker extended for header + orders-table-row projectors. Next: R2 (swap Financials tab + Sales locked sidebar)."
- No architecture-context or code-standards changes needed; the read-layer standards already cover this work.
- `context/reviews/invariant-catalog.md` — refresh via `npm run docs:generate` if the checker extension registers a new catalog entry (it likely does not — it extends an existing checker rather than registering a new invariant name).

## Acceptance Criteria

- Six new projector files exist in `src/modules/financial-cases/projections/`, each exporting one projector function and one DTO type.
- `projections/index.ts` barrel-exports all six new projectors and their types.
- `src/modules/financial-cases/index.ts` re-exports all six new projectors and their types.
- `FinancialCaseDepositInvoiceSummary` has `isLocked: boolean`; the service populates it.
- `FinancialCaseActiveSummary` has `depositInvoice: FinancialCaseDepositInvoiceSummary | null`; the service populates it from the deposit invoice fetched during the active-stage build path.
- `toOrderHeaderFinancial` returns `null` for booking-stage summaries and a correctly populated `OrderHeaderFinancialProjection` for active-stage summaries, with `outstandingAmount` and `totalOrderValue` within `0.0005` of the corresponding `computeOrderSettlementSummary` output on fixture orders.
- `toDraftSidebarFinancial` returns `null` for booking-stage summaries and a correctly populated `DraftSidebarFinancialProjection` for active-stage summaries.
- `toPaymentDialogContext` returns `null` for booking-stage summaries and a correctly populated `PaymentDialogContextProjection` for active-stage summaries, with `overpaymentCapacity` and `creditNoteCapacity` matching `FinancialCaseSummary` active-stage values.
- `toOrdersTableRow` returns `null` for booking-stage summaries and a correctly populated `OrdersTableRowProjection` (with raw `number` fields) for active-stage summaries.
- `toBookingPageFinancial` returns a `BookingPageFinancialProjection` for both stages: booking-stage shape has correct `depositPaid`, `awaitingFinalInvoiceAfterCheckIn`, and `finalInvoicePending` flags; active-stage shape has correct `remaining` and `paymentStatusEnum`.
- `toInvoiceListRow` returns `[]` for booking-stage summaries and a non-empty array for active-stage summaries, with each element's `invoiceNumber`, `total`, `remainingAmount`, and `status` matching the corresponding `linkedDocuments` entry.
- `checkFinancialCaseSummaryProjectorParity` is extended to check `toOrderHeaderFinancial` and `toOrdersTableRow`; the checker runs cleanly (zero violations) on the fixture database used by parity tests.
- All six projectors are pure: they import no Prisma client, no DB module, and no service that touches the DB.
- No UI file, server action, write-service file, schema file, or formatter file is modified.
- No `@/lib/db` import is added to `app/**` or `src/components/**`.
- `projection-parity-r1b.test.ts` covers every scenario in the scenario table above and passes.
- `npm run build` passes.
- `npm run lint` passes.
