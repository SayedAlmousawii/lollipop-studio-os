# Feature 100 - R5: Move Direct DB Reads Out Of App Layer

## Goal

Restore the service-only database boundary for the current app-layer drift: order detail server actions and the new-booking page must stop importing `@/lib/db`, while preserving the existing session-configuration routing, missing-configuration messaging, booking form defaults, and upgrade-payment behavior.

## Read First

- `AGENTS.md` - required repository rules, especially the Next.js docs warning and service-only DB boundary.
- `context/reviews/centralization-roadmap.md` - Spec R5 and the do-not-touch boundaries for read models, write services, and policy work.
- `context/feature-specs/99-r4-money-formatting-centralization.md` - current R4 outcome: `parseMoneyInput(...)` exists, but R5 still owns moving server-action business parsing/validation out of the action.
- `context/code-standards.md` - sections 1, 8, 10, and 11: UI -> server action/page loader -> service module -> database, plus the explicit ban on `@/lib/db` in `app/**` and `src/components/**`.
- `context/architecture-context.md` - sections 2, 4, 6.1, 6.2, and 6.4 for module ownership and service-only DB access.
- `app/orders/[orderId]/actions.ts` - current direct DB helpers: `resolveConfigureSessionRoute(...)` and `missingSessionConfigurationMessage(...)`; also review `recordUpgradePaymentAction(...)` because it still validates against formatted invoice remaining amount.
- `app/bookings/new/page.tsx` - current `getInitialCustomerPhone(...)` direct DB read.
- `src/modules/session-configurations/session-configuration-selection.service.ts` - existing selection write entry point, locked/post-lock errors, and order-package/session-configuration validation pattern.
- `src/modules/session-configurations/session-configuration-resolver.ts` - `SessionConfigurationRequiredSelectionMissingError` shape and missing-required details.
- `src/modules/customers/customer.service.ts` - existing `getCustomerPhoneLookupById(...)` service helper that already returns formatted phone data for customer IDs.
- `src/modules/bookings/booking.service.ts`, `src/modules/packages/package.service.ts`, and `src/modules/departments/studio-department.service.ts` - current new-booking form option loaders and service conventions.
- `src/modules/invoices/invoice.service.ts`, `src/modules/payments/payment.service.ts`, and `app/orders/[orderId]/actions.ts` - current upgrade-payment invoice lookup, remaining amount display shape, and payment recording path.
- `tests/session-configurations/configure-session-action.test.ts` and any booking page/action tests added by implementation - existing server-action mocking pattern that must stop stubbing `@/lib/db` for this action.

## Rules

- **Boundary cleanup only.** This unit moves DB reads and action-local business validation into service modules. It must not change schemas, migrations, persisted data shape, invoice formulas, payment allocation behavior, package pricing, booking creation, or session-configuration write semantics.
- **No policy centralization yet.** Do not implement `OrderEditModePolicy` or workflow policy builders. Locked vs adjustment-workspace routing stays behaviorally equivalent; R9 owns the later policy abstraction.
- **No read-model expansion.** Do not introduce a new order-details orchestrator, composition view model, or financial projector. R11/R7 own those.
- **Server actions stay thin.** Actions validate submitted shape, check permissions, call service helpers, catch known service errors, revalidate, and redirect. They must not run Prisma queries or derive database-backed business state.
- **Pages use service loaders.** `app/bookings/new/page.tsx` should call a booking/new-booking loader service and render props. It should not contain Prisma queries or customer lookup fallback logic.
- **Do not move DB access into components.** The grep target is zero `@/lib/db` imports in `app/**` and `src/components/**`.
- **Preserve user-facing copy unless intentionally centralized.** Missing session configuration and locked configuration messages should stay the same text where staff already see them.
- **Keep error contracts stable.** Existing session-configuration error classes remain the action's catch surface. If new service errors are needed, define them in the owning module and map them in the action without exposing raw database errors.
- **Current implementation drift to account for.** The roadmap calls out `recordUpgradePaymentAction` parsing remaining amount. R4 already replaced ad hoc regex parsing with `parseMoneyInput(...)`, and the action no longer directly reads the DB for this path. R5 should finish the boundary cleanup by moving invoice ownership/outstanding-balance validation to a service helper that uses raw invoice amounts, instead of parsing `InvoiceDetail.remainingAmount` display text in the action.
- **Current direct DB grep.** Before this spec, `rg 'from "@/lib/db"' app src/components` returns only `app/orders/[orderId]/actions.ts` and `app/bookings/new/page.tsx`. R5 must make that grep clean.

## Scope

### In Scope

- `app/orders/[orderId]/actions.ts`
  - Remove the `@/lib/db` import.
  - Replace local `resolveConfigureSessionRoute(...)` with a service-layer helper owned by the session-configuration module.
  - Replace local `missingSessionConfigurationMessage(...)` DB lookups with a service-layer helper that accepts `SessionConfigurationRequiredSelectionMissingError` details or the error itself and returns the same user-facing message.
  - Move upgrade-payment invoice ownership and outstanding-balance validation out of the action. The action should not parse `invoice.remainingAmount` display text to decide the payable server amount.
- `src/modules/session-configurations/`
  - Add a read helper for configure-session routing that returns the current shape needed by the action: locked state, financial configuration IDs, operational configuration IDs, and configuration names by ID.
  - Add or expose a helper that formats missing required session-configuration selections from live configuration/package names.
  - Reuse existing error classes such as `SessionConfigurationSelectionConfigurationNotFoundError` where the current action does.
- `src/modules/invoices/` and/or `src/modules/payments/`
  - Add the narrow helper needed by `recordUpgradePaymentAction(...)` so order ownership, invoice existence, raw outstanding amount, amount-change detection, and payment recording happen behind the service boundary.
  - Preserve the current `recordPayment(...)` allocation path and actor context requirements.
- `app/bookings/new/page.tsx`
  - Remove the `@/lib/db` import and local `getInitialCustomerPhone(...)` helper.
  - Call a service loader for all server data needed by `NewBookingForm`: active package options in the existing form shape, photographers, departments, optional initial customer phone, and optional recommended photographer.
- `src/modules/bookings/`
  - Add a narrow new-booking page loader, for example `getNewBookingPageData({ customerId })`, or an equivalently named service helper.
  - Reuse `getCustomerPhoneLookupById(...)`, `getPackages({ activeTaxonomyOnly: true })`, `getAssignablePhotographers()`, `getActiveStudioDepartments()`, and `getRecommendedPhotographer(...)` rather than duplicating their Prisma queries.
- Tests and regression checks
  - Update server-action tests so they stub the new service helpers instead of stubbing `@/lib/db` through the action import.
  - Add a grep-style regression test or backend invariant that fails when production files under `app/**` or `src/components/**` import `@/lib/db`.

### Out of Scope

- Any Prisma schema, migration, seed, or DB trigger change.
- Any invoice, payment, refund, credit-note, adjustment-workspace, booking confirmation, booking check-in, POS, or session-configuration selection write behavior change.
- Replacing `writeOrderPackageSelections(...)`, `applyEdit(...)`, `recordPayment(...)`, or `createInvoiceForOrder(...)` as canonical write services.
- Implementing R6 discrepancy-logger removal.
- Implementing R7/R8 composition centralization, R9 edit-mode policy, R10 workflow policies, R11 order-details orchestrator, or R12 cleanup.
- Refactoring all invoice DTOs to expose raw money fields. This unit may add one narrow raw-amount helper for upgrade-payment validation, but broad invoice DTO redesign is not part of R5.
- Moving allowed DB imports from `src/modules/**`, `src/lib/**`, `tests/**`, or `scripts/**`.
- Changing booking form UI, package filtering semantics, recommended-photographer algorithm, or development quick-action behavior.

## Implementation Direction

Start with the boundary grep:

```bash
rg 'from "@/lib/db"' app src/components
```

At drafting time it returns exactly two production files: `app/orders/[orderId]/actions.ts` and `app/bookings/new/page.tsx`. Keep the implementation focused on making that grep return zero.

For `configureSessionAction(...)`, move the local `resolveConfigureSessionRoute(...)` helper into the session-configuration module. The existing helper already describes the needed service contract: it validates that the `orderPackageId` belongs to the submitted `orderId`, reads the order package's `sessionTypeId`, checks whether the first final parent invoice is locked, and classifies submitted configuration IDs by `financialBehavior`. Preserve the returned sets/maps or return arrays/records if that is more testable, but keep the action's behavior the same:

- locked + financial selections: return the Adjustment Workspace error and href
- locked + operational selections: write only operational selections with `allowPostLock`
- unlocked: write all submitted selections normally

The helper should live near the existing writer because it reads the same aggregate and uses the same error language. `src/modules/session-configurations/session-configuration-selection.service.ts` is acceptable, or a small sibling service file is acceptable if it avoids making the writer file harder to scan.

Move `missingSessionConfigurationMessage(...)` out of the action as well. The service helper should accept `SessionConfigurationRequiredSelectionMissingError` or its `details`, query configuration names by missing code, query package names by order package ID, and return the same sentence currently assembled by the action. Keep this lookup in the session-configuration module because it explains a session-configuration resolver failure; do not leave package/configuration DB reads in the action.

For `recordUpgradePaymentAction(...)`, avoid a broad payment redesign. The current action already validates the form with `recordPaymentSchema` and checks permission; those can stay. Move the remaining server-owned checks into a service helper:

- invoice exists
- invoice belongs to the submitted order
- raw remaining amount is finite and positive
- submitted amount still equals the current outstanding amount
- payment is recorded via the existing `recordPayment(...)` path with the server amount and actor context

The helper may be placed in `payment.service.ts` if it records the payment, or in `invoice.service.ts` if it returns a raw payment target consumed by the action. Prefer the smallest API that leaves the action free of formatted-money parsing. If the helper records the payment directly, the action should pass `orderId`, `invoiceId`, parsed payment input, and actor context, then handle known service errors for "Invoice not found", "Invoice does not belong to this order", "No outstanding balance", and "Outstanding balance changed" with the existing user-facing messages.

For `app/bookings/new/page.tsx`, replace the local page data assembly with a new booking service loader. Keep the rendered component tree and `NewBookingForm` props stable. The loader should normalize the optional `customerId`, fetch the existing package/photographer/department options, and resolve `initialCustomerPhone` through `getCustomerPhoneLookupById(...)`. If an initial customer exists, reuse `getRecommendedPhotographer(initialCustomer.id)` exactly as the page does today.

The service loader may continue composing other service functions. That is preferable to duplicating package, customer, department, or photographer queries. Keep the active-package filter and mapping in one place so the page only renders the returned props.

Finally, add the regression check after the imports are removed. A lightweight Node test under the existing test style is enough: scan production `app/**` and `src/components/**` files for `from "@/lib/db"` or `from '@/lib/db'` and fail on any match. Do not ban DB imports in service modules, tests, scripts, or `src/lib/**`.

## Observability Checklist

### Dashboards / Metrics

- No new runtime dashboard metric is required.
- No FinancialCase discrepancy metric changes are expected; R6 owns removing temporary financial loggers.
- The operational signal for this unit is test coverage plus a boundary grep/regression test proving `app/**` and `src/components/**` do not import `@/lib/db`.

### Rollback Plan

- No schema changes. No down-migration needed.
- Roll back by reverting the action/page import changes and the new service helpers.
- If only the booking loader needs rollback, it can be reverted independently from the order action helper moves because there is no shared state or schema change.
- If the upgrade-payment helper introduces an issue, revert that helper and action wiring while keeping the session-configuration and booking DB-boundary cleanup if those remain green.

### Customer-Visible Surface

- Staff should see no intentional UI or workflow change.
- Configure-session locked/operational behavior, Adjustment Workspace routing copy, missing-required-session-settings copy, new-booking initial phone prefill, recommended photographer selection, and upgrade-payment amount-change errors should remain equivalent.

## Post-Implementation

- Update `context/progress-tracker.md` Now to say R5 is complete and R6 is next.
- Do not update `architecture-context.md` or `code-standards.md`; they already document the service-only DB boundary.
- If implementation finds another production `@/lib/db` import under `app/**` or `src/components/**`, include it in this R5 cleanup only if it is the same service-boundary class of issue and can be moved without broad subsystem refactoring. Otherwise stop and record the drift before expanding scope.

## Acceptance Criteria

- `app/orders/[orderId]/actions.ts` no longer imports `@/lib/db`.
- `app/bookings/new/page.tsx` no longer imports `@/lib/db`.
- `rg "from ['\"]@/lib/db['\"]" app src/components` returns zero production matches.
- `configureSessionAction(...)` obtains locked state, financial configuration IDs, operational configuration IDs, and configuration names from a session-configuration service helper, not from action-local Prisma queries.
- Locked configure-session behavior remains unchanged: financial changes return the Adjustment Workspace message/href, operational changes are written with post-lock audit, and unlocked changes write normally.
- Missing required session-configuration messages are built by a service-layer helper and preserve the existing package/configuration name output.
- `recordUpgradePaymentAction(...)` no longer parses `invoice.remainingAmount` display text or owns raw outstanding-balance validation.
- Upgrade-payment invoice existence, order ownership, positive outstanding balance, amount-change detection, and payment recording happen behind `src/modules/invoices/**` or `src/modules/payments/**`.
- `recordUpgradePaymentAction(...)` still uses `recordPaymentSchema`, checks `PERMISSIONS.PAYMENT_CREATE`, preserves current error copy, revalidates the same paths, and redirects back to the order on success.
- `app/bookings/new/page.tsx` receives new-booking form props from a booking service loader and keeps the same rendered UI/component props.
- The new booking loader reuses existing service helpers for customer lookup, packages, photographers, departments, and recommended photographer instead of duplicating Prisma queries.
- No schema, migration, invoice/payment formulas, session-configuration write semantics, booking creation behavior, or UI layout changes are included.
- Server-action tests are updated to mock service helpers rather than `@/lib/db` for the moved order-action reads.
- A regression test or backend invariant fails if future production files under `app/**` or `src/components/**` import `@/lib/db`.
- If this spec adds or changes a financial / composition / workflow / status display surface: it consumes the canonical read model + a projector (`modules/financial-cases/projections/` for FinancialCase-bound surfaces) instead of re-deriving in pages or components. Money is read from raw projector fields and formatted via `src/lib/formatting/money.ts`. No `@/lib/db` imports in `app/**` or `src/components/**`.
- `npm run build` passes.
- `npm run lint` passes.
