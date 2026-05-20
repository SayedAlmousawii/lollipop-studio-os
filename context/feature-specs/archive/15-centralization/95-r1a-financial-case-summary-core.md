# Feature 95 — R1a: FinancialCaseSummary Core + R2-Needed Projectors

## Goal

Create the canonical `FinancialCaseSummary` read model in a new `src/modules/financial-cases/` module, along with the two surface projectors needed by R2 (`toFinancialTabBlock`, `toSalesSidebarLocked`), a discrepancy logger that compares projector output against the current legacy derivation, and a nightly reconciliation invariant that flags mismatches. No UI consumer is swapped in this spec — R2 does the first swap. This is the first-in-pattern spec for the centralization roadmap; the shapes it establishes (folder layout, summary fields, projector signatures, discrepancy log format, reconciliation invariant wiring, test fixture conventions) will be copied by R1b, R2, R3a/b, and onward.

## Read First

- `context/reviews/centralization-roadmap.md` — Spec R1 description, §8.5 Spec Drafting Notes, the seven approved architectural decisions.
- `context/architecture-context.md` §6 (Canonical Architecture Standards) and §7 (Canonical Read Layer).
- `src/modules/orders/order-settlement.ts` — existing settlement helpers (`computeOrderSettlementSummary`, `derivePaymentSummary`, `deriveLockedFinancialSidebarSummary`, `deriveSettlementPaidAmount`).
- `src/modules/invoices/invoice.calculation.ts` — `computeEffectivePaidFromAllocations`.
- `src/modules/invoices/invoice.service.ts` — `computeOverpaymentCapacity`, `computeCreditNoteCapacityForFinal`.
- `src/modules/orders/order.service.ts` — `getLinkedFinancialDocumentsForOrder` and `getPOSWorkspace` shapes (these are the data sources the projectors will replace one day).
- `app/orders/[orderId]/page.tsx` — current `deriveOrderDetailsFinancialSummary()` (the legacy derivation `toFinancialTabBlock` must match) and the existing `order_details.financials_tab.header_discrepancy` log pattern.
- `src/components/orders/financial-sidebar-locked.tsx` — current locked sidebar input shape (the projector `toSalesSidebarLocked` must produce a superset of these fields).
- `src/modules/financial/invariant-catalog.ts`, `src/modules/financial/reconciliation-invariants.ts`, `src/modules/financial/reconciliation.service.ts` — pattern for registering a new reconciliation invariant.

## Rules

- **Read-only.** This spec writes nothing to the database and changes no business behavior. It only adds new read-layer code, tests, and one reconciliation invariant.
- **No consumer swap.** Do not modify `app/orders/[orderId]/page.tsx`, `src/components/orders/financial-sidebar-locked.tsx`, or any UI file. R2 does the first swap.
- **Reuse, do not re-derive.** The new service composes existing helpers (`computeOrderSettlementSummary`, `derivePaymentSummary`, `deriveLockedFinancialSidebarSummary`, `computeEffectivePaidFromAllocations`, `computeOverpaymentCapacity`, `computeCreditNoteCapacityForFinal`, `getLinkedFinancialDocumentsForOrder`). It must not introduce new money math.
- **Booking-stage projection is explicit.** When the caller resolves to a FinancialCase that has no FINAL invoice yet (confirmed booking pre-check-in or check-in without POS settlement), the summary returns a booking-stage shape — never a synthetic final-invoice state.
- **DB access boundary.** Prisma access for this read model lives only in `financial-case-summary.service.ts`. Projectors (`projections/*.ts`), the type file, and the discrepancy logger are pure functions over the `FinancialCaseSummary` value — they import no Prisma client, no DB module, and no service that touches the DB. Wrappers around existing service loaders may be added to the service file when needed.
- **Discrepancy logger uses the existing pattern.** Log via `console.error` with `JSON.stringify({ metric: "centralization.financial_case_summary.discrepancy", ... })`, matching the structure of `order_details.financials_tab.header_discrepancy`.
- **Discrepancy helper is in scope; catalog registration is conditional.** Implement `compareSummaryWithLegacy` and a thin checker function that runs a projector against the legacy derivation for a given FinancialCase and emits the discrepancy log if values diverge beyond tolerance. Register the checker as a reconciliation entry in `INVARIANT_CATALOG` only if it fits cleanly into the existing reconciliation pattern (one entry following the shape of existing reconciliation invariants in `src/modules/financial/reconciliation-invariants.ts`, no broad changes to `reconciliation.service.ts`). If registration would require restructuring reconciliation, defer registration to R2 and leave the helper/checker callable from tests and (later) runtime call sites. Either path is acceptable; record the choice in the PR description.

## Scope

### In Scope

- New folder `src/modules/financial-cases/` with:
  - `financial-case-summary.service.ts` — `getFinancialCaseSummary({ financialCaseId?, orderId?, bookingId? })`.
  - `financial-case-summary.types.ts` — `FinancialCaseSummary` type and its `stage: "booking" | "active"` discriminator.
  - `projections/to-financial-tab-block.ts` — pure projector returning the shape `app/orders/[orderId]/page.tsx`'s Financials tab currently consumes.
  - `projections/to-sales-sidebar-locked.ts` — pure projector returning the shape `financial-sidebar-locked.tsx` currently consumes.
  - `projections/index.ts` — barrel export.
  - `discrepancy-logger.ts` — `compareWithLegacy(summary, legacyDerivation)` helper used by the reconciliation invariant and (eventually) by R2-era runtime call sites.
- New invariant in `src/modules/financial/reconciliation-invariants.ts` registered through `INVARIANT_CATALOG`, named e.g. `centralization.financial_case_summary.projector_parity`.
- New tests under `tests/financial/financial-case-summary/`:
  - `summary-core.test.ts` — unit tests for `getFinancialCaseSummary` covering every applicable stage: draft (no Final Invoice yet), pre-final / booking-like states, booking-stage (confirmed booking, no Job yet), active locked, locked+adjusted, refunded, overpaid, credit-noted, and missing-FinancialCase fallback. Booking-stage and pre-final assertions cover the stage discriminator and booking-stage fields rather than active-stage math.
  - `projection-parity.test.ts` — parity tests that compare each projector's output against the corresponding legacy derivation **only for the stages where the legacy surface actually exists**. `toFinancialTabBlock` parity covers the same orders `deriveOrderDetailsFinancialSummary()` renders for today (active stage with a workspace invoice); `toSalesSidebarLocked` parity covers locked-sales orders that today render `FinancialSidebarLocked`. Stages where the legacy surface returns `null` or does not render are excluded from parity assertions and are instead asserted to also project to `null`. Comparisons are value-equivalent on comparable numeric and enum fields, using the `0.0005` tolerance from the discrepancy logger.
- Update `context/reviews/invariant-catalog.md` via `npm run docs:generate` (this is a generated file; the change is mechanical).

### Out of Scope

- Swapping any UI consumer (R2 + R3a/b own those).
- The remaining six projectors: `toOrderHeaderFinancial`, `toSalesSidebarDraft`, `toPaymentDialogContext`, `toOrdersTableRow`, `toBookingPageFinancial`, `toInvoiceListRow` (R1b).
- Removing the legacy `deriveOrderDetailsFinancialSummary()` in `app/orders/[orderId]/page.tsx` (R2).
- Removing the existing `order_details.financials_tab.header_discrepancy` log (R6).
- Schema changes, write-service changes, formatter changes (R4), DB-import cleanup (R5).
- `OrderCompositionViewModel` and downstream specs.

## Implementation Direction

**`FinancialCaseSummary` shape.** Define a discriminated union over `stage`:

- `stage: "booking"` — FinancialCase exists but no FINAL invoice. Fields: `financialCaseId`, `bookingId`, `depositInvoice` (id, total, status, paidAmount), `depositPaid: boolean`, `awaitingFinalInvoiceAfterCheckIn: boolean`, `finalInvoicePending: boolean`, `linkedDocuments: []`.
- `stage: "active"` — FINAL invoice exists. Fields: `financialCaseId`, `orderId`, `bookingId`, `finalInvoice` (id, total, remaining, status, isLocked, depositPaidAmount), `finalizedAdjustments[]`, `creditNotes[]`, `refunds[]`, `customerTotal`, `effectivePaid`, `depositApplied`, `remaining`, `overpaymentCapacity`, `creditNoteCapacity`, `linkedDocuments[]`, `paymentStatusEnum` (one of `UNPAID | PARTIAL | PAID | OVERPAID | REFUNDED` — derive from the existing settlement helpers, do not invent a new enum here).

**`getFinancialCaseSummary` resolution order.** Accept any one of `financialCaseId`, `orderId`, `bookingId`. Resolve to the FinancialCase row first, then decide stage by presence of a FINAL invoice attached to that case. Use `getLinkedFinancialDocumentsForOrder` for the document list when an `orderId` is known; for booking-stage callers, fetch the deposit invoice directly off the FinancialCase row. Do not duplicate the loader logic — extend or wrap the existing one if needed.

**Projectors.**

- `toFinancialTabBlock(summary)` returns the same fields `deriveOrderDetailsFinancialSummary()` currently produces (currently equivalent to `deriveLockedFinancialSidebarSummary`'s output: `customerTotal`, `paidSoFar`, `includesDeposit`, `remaining`, `finalInvoiceTotal`, `totalAdjustments`, `finalTotal`). For booking-stage summaries, return `null` — the Financials tab today does not render for booking stage either.
- `toSalesSidebarLocked(summary)` returns the same locked sidebar fields used by `financial-sidebar-locked.tsx`. Inspect that component's props to derive the exact shape. Booking stage returns `null`.

**Discrepancy logger.** A small helper `compareSummaryWithLegacy(legacyDerivation, projectorOutput, { metric, context })` that returns the absolute difference for each comparable numeric field and emits `console.error(JSON.stringify({ metric, ... }))` if any difference exceeds `0.0005` (matching the existing tolerance in `app/orders/[orderId]/page.tsx`).

**Reconciliation invariant (conditional).** Implement a checker that, for every active FinancialCase with a FINAL invoice, derives the summary, projects it through both projectors, and compares against the legacy derivations using the discrepancy logger. Try to register the checker as a new reconciliation entry in `INVARIANT_CATALOG` following the existing pattern in `src/modules/financial/reconciliation-invariants.ts`. If clean registration requires broader changes to `reconciliation.service.ts` or the catalog scaffolding, leave the checker as an exported function from `financial-case-summary.service.ts` (or a sibling `financial-case-summary.checker.ts`) and defer catalog wiring to R2. The helper must be callable from tests either way.

**Tests.** Snapshot parity tests use fixtures from `tests/fixtures/`; if a needed fixture (e.g. credit-noted FinancialCase, overpaid FinancialCase) is missing, extend the fixtures rather than inlining test data. Keep the parity test framework consistent with `tests/financial-phase-d/` style — narrow assertions, named scenarios, no live DB unless the existing fixture pattern requires it.

## Observability Checklist

### Dashboards / Metrics

- `centralization.financial_case_summary.discrepancy` — emitted via `console.error` when projector output diverges from the legacy derivation by more than `0.0005` on any comparable numeric field, or differs on any compared enum field. Payload includes `metric`, `financialCaseId`, `orderId`, `projector` (`toFinancialTabBlock` | `toSalesSidebarLocked`), `field`, `legacyValue`, `projectorValue`, `delta` (numeric fields only).
- If the reconciliation entry is registered in this spec, it emits the same metric nightly. If deferred to R2, the helper is dormant in production until R2 wires it in.

### Rollback Plan

- No schema changes. No down-migration needed.
- The new module is unused by UI; deleting `src/modules/financial-cases/` fully reverts the change. If the reconciliation entry was registered, remove it from `INVARIANT_CATALOG` first to keep catalog tests passing.

### Customer-Visible Surface

- None. Staff and customers see no change.

## Post-Implementation

- `context/progress-tracker.md` — add a one-line entry under Now: "R1a complete: `FinancialCaseSummary` read model and two R2-target projectors live in `src/modules/financial-cases/`; discrepancy logger and reconciliation invariant in place. No consumer swap. Next: R1b (remaining projectors)."
- `context/reviews/invariant-catalog.md` — refresh via `npm run docs:generate`.
- No architecture-context or code-standards changes (the read-layer standards already cover this work).

## Acceptance Criteria

- New folder `src/modules/financial-cases/` exists and contains the service, types, projections, discrepancy logger, and barrel exports listed in Scope.
- `getFinancialCaseSummary` resolves correctly from `financialCaseId`, `orderId`, or `bookingId`, returning the `stage: "booking"` shape for confirmed bookings without a Final Invoice and the `stage: "active"` shape otherwise.
- The two projectors return outputs value-equivalent (numeric fields within `0.0005`, enum fields equal) to the current legacy derivations for the stages where the legacy surface actually exists; stages where the legacy surface returns `null` or does not render are asserted to also project to `null`.
- The discrepancy logger and its checker are implemented. The logger emits nothing on a clean fixture run.
- The reconciliation entry is registered in `INVARIANT_CATALOG` if registration fits cleanly into the existing pattern; otherwise registration is explicitly deferred to R2 and the checker remains exported for direct invocation. The PR description records the choice.
- DB access for this read model exists only in `financial-case-summary.service.ts`. Projectors, types, and the discrepancy logger are pure (no Prisma, no DB module).
- No UI file, server action, write-service file, schema file, or formatter file is modified.
- No `@/lib/db` import is added to `app/**` or `src/components/**`.
- New tests cover every applicable summary-core scenario listed in Scope and the parity scenarios where the legacy surface exists, and pass.
- `npm run test:backend-invariants` passes (with the new entry included if registered, otherwise unchanged).
- This spec consumes the canonical read model + projector pattern (it *creates* it). No re-derivation is added in pages or components.
- `npm run build` passes.
- `npm run lint` passes.
