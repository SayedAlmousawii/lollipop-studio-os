# Feature 99 - R4: Centralize Money Formatting + Input Parsing

## Goal

Harden the additive money formatter introduced during R3 into the single repository-wide money display and money-input parsing path. This unit removes local KD formatter helpers and formatted-money parsing from UI/action code without changing financial math, read-model ownership, service write behavior, or DTO shapes beyond what is necessary to consume the shared formatter.

## Read First

- `context/reviews/centralization-roadmap.md` - Spec R4, section 5 do-not-touch boundaries, section 8.5 spec drafting notes, and the R4 test row.
- `context/feature-specs/98-r3-financial-readouts-header-table-booking.md` - current R3 formatter compromise and the surfaces already importing `src/lib/formatting/money.ts`.
- `src/lib/formatting/money.ts` - current minimal `formatMoney(amount: number)` helper created during R3.
- `src/components/orders/financial-sidebar-primitives.tsx`, `src/components/financial/financial-format.ts`, and `src/components/financial/index.ts` - current shared-but-component-owned `formatKD` / signed money exports.
- `src/components/orders/pos-record-payment-dialog.tsx`, `src/components/orders/financial-sidebar-draft.tsx`, `src/components/orders/financial-sidebar-adjustment-blocks.tsx`, `src/components/orders/financial-sidebar-adjustment.tsx`, `src/components/orders/pos-package-composition.tsx`, `src/components/orders/current-composition-card.tsx`, `src/components/orders/credit-note-approval-fields.tsx`, and `src/components/session-configurations/configuration-summary-chip.tsx` - current local KD display helpers in order/POS surfaces.
- `src/components/financial/financial-total-source.tsx`, `src/components/orders/order-settlement-summary.tsx`, `src/components/orders/orders-table.tsx`, and `src/components/bookings/booking-financial-section.tsx` - surfaces already partly aligned with the R3 formatter path.
- `src/components/session-configurations/configure-session-panel.tsx`, `src/components/packages/package-form.tsx`, `src/components/invoices/refund-invoice-form.tsx`, `app/invoices/[id]/page.tsx`, `app/orders/[orderId]/actions.ts`, `app/orders/[orderId]/adjustment-workspace/page.tsx`, and `app/(dashboard)/page.tsx` - UI/action money input or formatted-money parsing paths directly touched by this unit.
- `src/lib/invoices/refund-utils.ts` - current `moneyInputValue` duplicate parser to fold into `parseMoneyInput`.
- `src/modules/invoices/invoice.service.ts`, `src/modules/orders/order.service.ts`, `src/modules/adjustment-workspace/adjustment-workspace.service.ts`, `src/modules/bookings/booking.service.ts`, `src/modules/packages/package.service.ts`, `src/modules/products/product.service.ts`, and `src/modules/pricing/extra-photo-pricing.service.ts` - service-layer display-string formatter helpers to migrate without changing business formulas.
- `tests/financial/`, `tests/orders/`, `tests/adjustment-workspace/`, and any existing formatter or invoice form tests - established test locations for financial display and parsing regression coverage.

## Rules

- **Formatting-only unit.** Do not change invoice, payment, refund, credit-note, adjustment-workspace, POS, booking, package, pricing, or commission formulas.
- **No schema or migration change.** This unit must not touch Prisma schema, generated migrations, or persisted data shape.
- **Keep DTO shape churn minimal.** Service methods that currently return formatted strings may continue returning formatted strings in this unit, but those strings must be produced by `src/lib/formatting/money.ts`. Later read-model specs own raw-field DTO redesigns.
- **No UI formatted-money parsing.** UI components, pages, and server actions must not parse labels such as `"12.000 KD"` by regex, `replace(/[^\d.-]/g, "")`, or `parseFloat(...)`. Use `parseMoneyInput(raw)` for form/input normalization only.
- **Do not consume future R7 scope.** Internal numeric normalization in composition read helpers such as `buildCompositionView(...)` and `buildPendingChangesView(...)` is not the formatted-money UI parsing targeted by R4. Do not rewrite composition label parsing or composition view-model behavior in this unit.
- **Preserve signed display semantics.** Existing `+1.000 KD`, `-1.000 KD`, and `0.000 KD` displays should stay visually equivalent after moving to the shared formatter.
- **Do not move DB access.** `app/orders/[orderId]/actions.ts` still has broader R5 service-boundary cleanup pending. In R4, only replace formatted amount parsing with the shared input parser or a raw service value if one already exists without broad loader/action refactoring.
- **No new dependency.** Use TypeScript and existing Prisma Decimal objects; do not add formatting libraries.
- **Current implementation drift to account for.** `src/lib/formatting/money.ts` already exists but only supports `formatMoney(amount: number)`. R4 must expand it instead of creating another formatter. Formatter duplication is broader than the roadmap examples, including dashboard/package/pricing/session-configuration surfaces; cover the current duplicates found in the targeted files above.

## Scope

### In Scope

- `src/lib/formatting/money.ts`
  - Expand `formatMoney(amount, { currency, density })` as the canonical display helper.
  - Add a signed formatting option or companion helper for existing signed KD displays.
  - Add `parseMoneyInput(raw)` for form/action input normalization.
  - Accept the current value shapes used in the repo without forcing callers to pre-format or parse: plain numbers, numeric strings, and Decimal-like objects with `toFixed(dp)`.
- Shared financial component exports
  - Stop exporting `formatKD` from `src/components/orders/financial-sidebar-primitives.tsx` and `src/components/financial/index.ts` as the canonical formatter.
  - Move signed/document amount formatting in `src/components/financial/financial-format.ts` to delegate to `src/lib/formatting/money.ts`.
  - Keep `MoneyRow` as a display primitive that receives an already formatted string.
- Order/POS/financial UI surfaces
  - Replace local `formatKD` / `formatSignedKD` helpers in the order/POS components listed in Read First with shared formatter imports.
  - Keep the components display-only; do not add service calls or financial derivation.
- Form/input parsing
  - Replace `moneyInputValue(...)` in `app/invoices/[id]/page.tsx` and `src/lib/invoices/refund-utils.ts` with `parseMoneyInput(...)`.
  - Replace formatted `invoice.remainingAmount` parsing in `app/orders/[orderId]/actions.ts` with the shared parser or an existing raw remaining amount source if available without R5 refactoring.
  - Update `src/components/packages/package-form.tsx` to use `parseMoneyInput(...)` for price input arithmetic while preserving the existing bundle-adjustment behavior.
- Service-layer display strings
  - Replace local `formatMoney` / `formatPrice` / `formatSignedPrice` helpers in the listed service files with imports from `src/lib/formatting/money.ts`.
  - Preserve each service method's current public return shape unless a narrow type update is necessary for formatter compatibility.
- Tests
  - Add focused unit tests for `formatMoney` and `parseMoneyInput`.
  - Add a grep-style regression test or lint-like test that fails on new local KD formatter definitions and UI formatted-money parsing patterns.
  - Update existing render tests only where imports or display strings need fixture alignment.

### Out of Scope

- Changing any financial formula, payment allocation, refund capacity, credit-note capacity, invoice lock, or adjustment finalization behavior.
- Converting all service DTO money fields from formatted strings to raw numbers.
- Swapping invoice list rows to `toInvoiceListRow` or changing invoice table ownership; that remains a consumer-swap/cleanup concern outside R4.
- Moving direct DB reads out of pages/server actions beyond the one formatted-string parse targeted here; R5 owns the DB boundary cleanup.
- Removing the FinancialCase discrepancy logger or parity checker; R6 owns that.
- Rewriting `buildCompositionView(...)`, `buildPendingChangesView(...)`, adjustment composition label parsing, or R7/R8 composition projectors.
- Reworking status labels, date formatting, dashboard query logic, package pricing logic, or session-configuration pricing logic.
- Any broad visual redesign or layout change.

## Implementation Direction

Start at `src/lib/formatting/money.ts`. Treat the current helper as the compatibility entrypoint and extend it in place so existing R3 imports keep working. The default output should remain `12.000 KD` for current callers. The helper should support the roadmap shape `formatMoney(amount, { currency, density })`, with `currency` defaulting to `"KD"` and `density` defaulting to the current compact display. The formatter should round consistently to three decimals because KD is the existing app-wide convention.

Add a shared signed-money path in the same module. It may be a `formatMoney(..., { signDisplay })` option or a named helper, but callers should no longer implement local `formatSignedKD`, `formatSignedMoney`, or `formatSignedPrice` functions. Preserve current signs exactly: positive values include `+` only where the old UI did, negative values include `-`, and zero renders without a sign unless a caller explicitly requests one.

Add `parseMoneyInput(raw)` for user/form input and legacy formatted-string normalization. It should accept raw values such as `12`, `12.5`, `12.500`, `KD 12.500`, `12.500 KD`, and comma-grouped values, then return a stable numeric value or normalized fixed string according to the implementation's chosen API. Pick one return shape and use it consistently; form `max` / `defaultValue` cases need a three-decimal string, while arithmetic comparisons need a number. If both forms are necessary, expose two clearly named helpers from the same module rather than duplicating parsing elsewhere.

Migrate shared component formatting first. `financial-sidebar-primitives.tsx` should continue to own layout primitives such as `MoneyRow`, `InvoiceLineRow`, and `AdjustmentInvoiceSummary`, but its money output should come from the shared formatter. `components/financial/financial-format.ts` may keep financial-document-specific helpers, but those helpers should delegate to `src/lib/formatting/money.ts` for the actual KD rendering.

Then migrate local UI helpers in small surface clusters: POS dialog/sidebar components, current composition card, session-configuration chips/panel, credit-note approval fields, package form, adjustment-workspace summary cards, and dashboard cards. Keep each surface's existing copy and conditional rendering. The behavior change should be limited to using the shared formatter and parser.

For service-layer helpers, replace local display-string helper bodies with imports from `src/lib/formatting/money.ts`. Do not change the meaning of fields such as `totalAmount`, `paidAmount`, `remainingAmount`, `priceLabel`, `bundleAdjustment`, or audit descriptions. If a service formats a Prisma Decimal, pass the Decimal-like object directly if the formatter supports it; otherwise convert at the call boundary without reintroducing a local helper.

For `app/orders/[orderId]/actions.ts`, keep the R4 change intentionally small. The current code parses `invoice.remainingAmount` by stripping non-numeric characters. Replace that with the shared parser or with an existing raw service value if it is already available from `getInvoiceById(...)`. Do not move `getInvoiceById` or rewrite the action around a new service helper in this unit.

Do not chase every `toFixed(3)` in the repository. Some occurrences are Decimal persistence, audit text, test fixtures, or internal math normalization. The regression check should target money-display helper definitions and formatted-money parsing patterns in app/component/service display code, not numeric rounding used to create Decimal values.

## Observability Checklist

### Dashboards / Metrics

- No new runtime metrics are required.
- Existing financial reconciliation and `centralization.financial_case_summary.projector_parity` observability remains unchanged.
- The useful signal for this unit is test/lint coverage: formatter unit tests plus a grep-style regression guard for local KD formatters and UI formatted-money parsing.

### Rollback Plan

- No schema changes. No down-migration needed.
- Revert the formatter expansion and import migrations to restore prior local helpers.
- If a rollback is partial, keep `src/lib/formatting/money.ts` backward-compatible with R3 callers (`formatMoney(number)`) so order header, orders table, and booking financial readouts do not break.

### Customer-Visible Surface

- Staff should see the same monetary values and signs as before across financial summaries, POS dialogs, invoices, session configuration previews, package forms, dashboard revenue cards, and adjustment views.
- The only intended visible change is consistency: identical KD precision/order/sign conventions across surfaces.
- Form behavior should remain the same or become stricter only for malformed money input that previously parsed ambiguously.

## Post-Implementation

- Update `context/progress-tracker.md` Now to say R4 is complete and R5 is next.
- If implementation discovers a money-display helper that is intentionally exempt from centralization, document the exemption in this spec or in the progress tracker before completing the unit.
- Do not update architecture-context or code-standards unless implementation discovers a documented rule conflict; those docs already require a single money formatter.

## Acceptance Criteria

- `src/lib/formatting/money.ts` exposes the canonical money display helper and money-input parser for the repository.
- `formatMoney(amount)` remains backward-compatible with R3 callers and still renders three-decimal KD values by default.
- `formatMoney(amount, { currency, density })` is supported, with defaults matching current KD display.
- Signed money display is centralized in `src/lib/formatting/money.ts`; no component or service defines its own `formatSignedKD`, `formatSignedMoney`, or `formatSignedPrice` helper.
- `src/components/orders/financial-sidebar-primitives.tsx` no longer exports a local `formatKD` formatter as the canonical money path.
- `src/components/financial/financial-format.ts` delegates KD rendering to `src/lib/formatting/money.ts`.
- R4-touched components and pages no longer contain local helpers that return strings like ``${value.toFixed(3)} KD`` or `"KD " + value`.
- R4-touched service display helpers in invoices, orders, adjustment workspace, bookings, packages, products, and extra-photo pricing use `src/lib/formatting/money.ts` instead of local formatter definitions.
- `app/invoices/[id]/page.tsx`, `src/lib/invoices/refund-utils.ts`, `src/components/packages/package-form.tsx`, and `app/orders/[orderId]/actions.ts` use `parseMoneyInput(...)` or an existing raw amount field instead of ad hoc regex/replace/`parseFloat` formatted-money parsing.
- `src/components/orders/orders-table.tsx` remains free of formatted-money parsing after the R3a swap.
- Internal composition normalization functions are not rewritten unless they directly call the new parser for numeric string normalization without changing behavior.
- Existing financial readouts still consume canonical read models/projectors where already swapped; this unit does not reintroduce page/component financial derivation.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- Unit tests cover KD formatting, zero, negative values, explicit signed display, numeric strings, Decimal-like inputs, comma-grouped input, malformed input, and parse behavior needed by invoice/refund forms.
- A regression test or lint-like check fails if new local KD formatter helpers or UI formatted-money parsing patterns are introduced in `app/**` or `src/components/**`.
- Existing relevant render tests for order financial summaries, POS payment dialog/sidebar, current composition card, booking financial section, and invoice/refund forms pass after import migration.
- `npm run build` passes.
- `npm run lint` passes.
