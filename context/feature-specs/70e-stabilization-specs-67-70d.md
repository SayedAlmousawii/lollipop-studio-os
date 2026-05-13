# Feature 70e - Stabilization for Specs 67-70d

## Goal

Stabilize the Specs 67-70d package taxonomy, multi-package booking/order, extra-photo pricing, and singular-field retirement work by fixing the confirmed implementation issues in small, ordered units. This is a correctness and simplification pass: POS becomes the canonical order selection and financial workspace, Final Invoice math becomes internally consistent, and legacy single-package write paths are retired instead of expanded.

Ship one sub-unit at a time. Do not continue to the next unit until the current unit has passed its acceptance criteria and the owner has confirmed the next scope.

## Read First

- `context/reviews/specs-67-70d-implementation-review.md` - original implementation review
- `context/reviews/Next-build-plan-may-8.md` - roadmap context
- `context/feature-specs/67-package-taxonomy-foundation.md`
- `context/feature-specs/68-package-model-upgrade.md`
- `context/feature-specs/69-session-type-extra-photo-pricing.md`
- `context/feature-specs/70a-multi-package-schema-foundation.md`
- `context/feature-specs/70b-booking-multi-package-flow.md`
- `context/feature-specs/70c-order-multi-package-flow.md`
- `context/feature-specs/70d-singular-field-retirement.md`
- `prisma/schema.prisma`
- `src/modules/orders/order.service.ts`
- `src/modules/invoices/invoice.service.ts`
- `src/modules/pricing/pricing.service.ts`
- `src/modules/bookings/booking.service.ts`
- `src/modules/calendar/calendar.service.ts`
- `src/components/orders/pos-package-composition.tsx`
- `src/components/orders/pos-financial-sidebar.tsx`
- `src/components/orders/selection-workflow-form.tsx`
- `src/components/orders/edit-order-form.tsx`

## Rules

- Work on only one 70e sub-unit at a time.
- POS is the canonical order selection and financial workspace after this stabilization.
- Retire duplicate order financial write surfaces instead of maintaining multiple competing workflows.
- Preserve existing lifecycle invariants: Deposit Invoice remains locked after confirmation; Final Invoice is the POS invoice; `PaymentType.BASE` remains retired.
- Financial calculations must be service-layer only and transaction-safe.
- Invoice totals and invoice line items must be reconciled by construction, not by UI formatting.
- Final customer-facing invoice lines may show the final package value only, but the original package price baseline must remain stored for commissions and reporting.
- `OrderPackage` rows are the source of truth for package-line package choice, selected-photo counts, extra-photo counts, and package price snapshots.
- Do not add new package/session-type concepts unless a sub-unit explicitly asks for them.
- Do not modify unrelated UI, permissions, auth, customer, production, or delivery behavior.
- Do not add broad refactors while fixing a narrow invariant.
- Any destructive schema change must include a migration and a backfill/cleanup decision in the sub-unit that owns it.
- If a sub-unit discovers that current production-like data cannot be migrated safely, stop and document the blocker before continuing.

## Scope

### In Scope

- Add or formalize the backend test harness needed for Prisma-backed service invariant tests.
- Fix Final Invoice package line math so computed/snapshotted line items equal `Invoice.totalAmount`.
- Preserve original package price snapshots as the commission baseline while showing final package pricing on customer-facing invoices.
- Retire the legacy edit order page if audit confirms POS covers its remaining functionality.
- Retire the writable selection workflow tab inside order details because POS now owns package decisions, selected photos, extra-photo counts, add-ons, and invoice impact.
- Establish one source-of-truth rule for selected photo totals.
- Add backend invariant tests around invoice totals, selected-photo aggregation, extra-photo charges, scoped add-ons, and package-line snapshots.
- Remove first-line-only POS summary fields that are misleading for mixed package lines.
- Consolidate extra-photo unit-price lookup logic.
- Address smaller schema/display correctness gaps identified in the implementation review or explicitly defer them.

### Out of Scope

- New package catalog admin CRUD beyond what already exists.
- New accounting concepts such as refunds, credit notes, customer credit ledgers, or automatic adjustment invoices.
- Commission persistence beyond preserving the existing upgrade-commission hook and its upgrade baseline input.
- Major redesign of the order hub UI beyond removing or routing duplicate write surfaces.
- Reworking booking confirmation or check-in lifecycle architecture.
- Changing business pricing values in seed data.
- Rebuilding the selection workflow tab as a second POS-like editor.

## Implementation Direction

### Unit 70e.0 - Backend Invariant Test Harness

Create or formalize the minimal backend test harness before touching financial behavior.

Desired behavior: 70e financial/data-integrity fixes have fast service-level tests that can exercise Prisma-backed code without browser/UI setup.

Read first:

- Existing project test configuration and scripts
- `package.json`
- `prisma/schema.prisma`
- `prisma/seed.ts`
- Existing service modules that already use transactions and seed data

Implementation direction:

- Prefer the smallest test setup that can create isolated Prisma-backed fixtures and call service-layer functions directly.
- Do not install new packages unless the existing project has no viable test runner and the owner approves the package choice.
- Tests must be repeatable and isolated enough to run locally without corrupting development data.
- If the app already has a service test harness, extend it instead of inventing a parallel one.
- Add only a smoke/invariant placeholder here if a later unit owns the full scenario data.

Acceptance criteria:

- [ ] A documented command exists for running backend invariant tests
- [ ] The test harness can create/read Prisma-backed fixtures without UI involvement
- [ ] Test data is isolated, reset, or transaction-scoped enough for repeated local runs
- [ ] At least one trivial service-level invariant test passes through the harness
- [ ] `npm run build` passes
- [ ] `npm run lint` passes

### Unit 70e.1 - Invoice Math Correctness

Fix C2 before any other financial work.

Desired behavior: for every Final Invoice, the sum of visible/computed/snapshotted line-item totals must equal `Invoice.totalAmount`. Package upgrades must not be counted twice. Customer-facing invoice lines should show the final package value, while base/original package price snapshots remain stored for commission calculations.

Read first:

- `src/modules/invoices/invoice.service.ts` - `createInvoiceForOrderWithClient`, `syncOrderInvoiceForFinancialEdit`, `buildInvoiceLineItems`, `snapshotInvoiceLineItemsWithClient`
- `src/modules/orders/order.service.ts` - `updateOrderPackage`, package snapshot writes, `syncUpgradeCommissionForOrder` call sites
- `src/modules/commissions/commission.service.ts`
- `src/components/orders/pos-financial-sidebar.tsx` if invoice line display needs verification

Implementation direction:

- Customer-facing invoice shape decision: show final package pricing directly, e.g. `Gold 90`, not `Silver 60 + Upgrade 30`.
- Do not emit a separate `PACKAGE_UPGRADE` line when the package base line already reflects the final package value.
- Preserve `OrderPackage.originalPackagePriceSnapshot` as immutable baseline data for later commission logic.
- Preserve `OrderPackage.finalPackagePriceSnapshot` as final package value when a package changes.
- Keep upgrade delta available to activity metadata and `syncUpgradeCommissionForOrder` as `finalPackagePriceSnapshot - originalPackagePriceSnapshot`.
- Ensure computed invoice views and locked snapshots use the same line-building logic.
- Add invariant tests that build or snapshot upgraded and non-upgraded Final Invoices and assert line sum equals invoice total.

Acceptance criteria:

- [ ] Upgraded package invoice line items sum exactly to `Invoice.totalAmount`
- [ ] Non-upgraded package invoice line items sum exactly to `Invoice.totalAmount`
- [ ] Multi-package invoices with mixed upgraded and non-upgraded lines sum exactly to `Invoice.totalAmount`
- [ ] Locked invoice snapshots use the same corrected math as computed invoice previews
- [ ] Customer-facing invoice lines show final package value without double-counting upgrade delta
- [ ] `OrderPackage.originalPackagePriceSnapshot` remains populated and unchanged during package upgrades
- [ ] Upgrade commission input still receives the upgrade delta from final minus original package price snapshots
- [ ] Backend invariant tests cover invoice reconciliation and upgrade math
- [ ] `npm run build` passes
- [ ] `npm run lint` passes

### Unit 70e.2 - POS Canonicalization and Duplicate Surface Retirement

Fix C1, C4, C5, C6, and M1 by removing the duplicate write surfaces instead of making every old surface multi-package aware.

Desired behavior: POS is the only writable order financial/selection workspace. The legacy edit order page is retired if audit confirms it has no unique capability. The order detail selection workflow tab is retired as a write surface because POS already owns package decisions, selected photos, digital/print extras, add-ons, and invoice impact.

Read first:

- `app/orders/[orderId]/edit/*`
- `app/orders/[orderId]/actions.ts` - `updateSelectionWorkflowAction`
- Order detail page/tab composition for the selection workflow
- `src/modules/orders/order.service.ts` - `getOrderSelectionWorkflowById`, `updateOrderSelectionWorkflow`, `updateOrder`, `getEditableOrderById`, `mapEditableOrderRow`, `getPOSWorkspace`
- `src/components/orders/selection-workflow-form.tsx`
- `src/components/orders/edit-order-form.tsx`
- `src/components/orders/pos-package-composition.tsx`
- `src/components/orders/pos-financial-sidebar.tsx`

Implementation direction:

- Audit the legacy edit order page against POS. If POS covers all remaining capabilities, retire the route/page/action instead of guarding it long-term.
- Audit the selection workflow tab against POS. If POS covers all selection and financial fields, retire the writable tab/form/action instead of rebuilding it as a second POS.
- Produce a short audit note at `context/reviews/legacy-edit-selection-vs-pos-audit.md` before deleting anything. It must list each field/action from the legacy edit page and selection workflow tab, map it to the POS equivalent, or mark it as missing/non-financial/read-only.
- If the audit reveals POS-uncovered functionality that is not a small move, split that work into a separate 70e.2-prep unit before retiring the legacy surface.
- Replace entry points to retired write surfaces with clear navigation to POS or read-only status where useful.
- Remove or disable server actions that can still call first-line-only destructive write paths.
- If any unique non-financial information remains on the selection tab, preserve it as read-only or move it to an existing order detail surface.
- Ensure no user can submit the old single-number selection extras form, since it cannot represent digital/print split or multi-line pricing correctly.
- Ensure no user can submit the old legacy edit form, since it can delete scoped add-ons and misrepresent original/final package state.
- Leave detailed POS pricing cleanup to Unit 70e.4; this unit only verifies that POS remains functional after retiring duplicate write surfaces.

Acceptance criteria:

- [ ] POS remains the canonical route for package changes, selected photos, digital extras, print extras, add-ons, invoice preview, and final payment
- [ ] `context/reviews/legacy-edit-selection-vs-pos-audit.md` documents legacy edit and selection workflow coverage before retirement
- [ ] Any POS-uncovered functionality is either moved to POS/read-only order detail or split into a separate prep unit before deletion
- [ ] Legacy edit order page/action is deleted or inaccessible after audit confirms POS has equivalent coverage
- [ ] Writable selection workflow tab/form/action is deleted, inaccessible, or converted to read-only status with POS navigation
- [ ] No active server action routes selection extra photos through `updateOrder` or any first-line-only write path
- [ ] No active server action can delete all `OrderAddOn` rows by `orderId` from the legacy edit flow
- [ ] Existing POS per-line digital/print extra-photo editing still works
- [ ] Existing POS add-on add/remove behavior still works
- [ ] POS package-line editing still renders after legacy edit and selection write surfaces are retired
- [ ] `npm run build` passes
- [ ] `npm run lint` passes

### Unit 70e.3 - Selected Photo Count Source of Truth

Fix C3 after duplicate write surfaces are removed.

Desired behavior: selected-photo totals are derived from `OrderPackage` rows. If `Order.selectedPhotoCount` remains temporarily, it is a cached aggregate maintained by one helper and never a competing read source.

After 70e.2 retires the legacy edit and selection workflow write paths, the remaining selected-photo writers should be limited to POS/package-line services, making this cleanup intentionally smaller.

Read first:

- `prisma/schema.prisma` - `Order.selectedPhotoCount`, `OrderPackage.selectedPhotoCount`
- `src/modules/orders/order.service.ts` - all selected-photo reads/writes and aggregation helpers
- `src/modules/orders/order.types.ts`
- `src/components/orders/pos-package-composition.tsx`

Implementation direction:

- Add or formalize a service helper that computes total selected photos from package lines.
- Convert read sites to use package-line aggregation without falling back to stale order-level values.
- If the order-level field remains in schema, update it only through one synchronization helper called from every package-line selected-photo write path.
- Prefer a follow-up schema retirement if the field is no longer needed after all read sites are converted.
- Add tests that would fail if order-level selected-photo count drifts from package-line totals.

Acceptance criteria:

- [ ] Order detail selected-photo total is derived from package lines
- [ ] POS selected-photo total is derived from package lines
- [ ] Editing workflow target-photo count is derived from package lines
- [ ] No read path prefers stale `Order.selectedPhotoCount` over package-line totals
- [ ] Every write path that changes `OrderPackage.selectedPhotoCount` keeps any remaining order-level aggregate synchronized
- [ ] Backend invariant test covers selected-photo aggregate consistency
- [ ] `npm run build` passes
- [ ] `npm run lint` passes

### Unit 70e.4 - POS Pricing Display Cleanup

Finish C6 and related POS display cleanup after POS is canonical.

Desired behavior: POS pricing displays are line-aware. Mixed-session-type orders never show first-line-only unit prices or summary fields as if they apply to the whole order.

Read first:

- `src/modules/orders/order.service.ts` - `getPOSWorkspace`, `mapPOSPackageLines`
- `src/modules/orders/order.types.ts` - `POSWorkspace`, `POSPackageLine`
- `src/components/orders/pos-package-composition.tsx`
- `src/components/orders/pos-financial-sidebar.tsx`

Implementation direction:

- Remove top-level POS fields that imply one extra-photo unit price for the whole order.
- Keep per-line digital and print unit prices on `POSPackageLine`.
- Ensure any total extra-photo display is clearly a summed total, not a unit price.
- Verify no component reads `workspace.extraPhotoUnitPrice` or equivalent first-line-only scalar.
- Add a mixed-session-type POS test or service invariant that confirms per-line pricing is retained separately.

Acceptance criteria:

- [ ] POS workspace no longer exposes a top-level first-line-only `extraPhotoUnitPrice`
- [ ] POS components do not read a first-line-only extra-photo unit price
- [ ] Each package line displays its own digital and print extra-photo unit prices
- [ ] Mixed-session-type POS total equals the sum of per-line extra-photo totals
- [ ] Backend invariant test covers session-type pricing on mixed-session-type orders
- [ ] `npm run build` passes
- [ ] `npm run lint` passes

### Unit 70e.5 - Medium Stabilization Cleanup

Address medium findings as independently shippable cleanup PRs after the critical financial/data-loss units are complete.

Desired behavior: remove duplicate pricing logic, avoid display-name business logic, document or implement package session-type override policy, clean scoped add-on delete behavior, and close DB-level uniqueness gaps.

Read first:

- `src/modules/pricing/pricing.service.ts`
- `src/modules/invoices/invoice.service.ts`
- `src/modules/calendar/calendar.service.ts`
- `src/modules/orders/order.service.ts`
- `src/modules/bookings/booking.service.ts`
- `prisma/schema.prisma`

Implementation direction:

- Treat each cleanup below as a separate PR unless the owner explicitly groups them.
- 70e.5a: Export a transaction-client-compatible extra-photo pricing lookup from `pricing.service.ts`; invoice service should call that instead of defining a duplicate lookup.
- 70e.5b: Calendar session-type display should use stable codes or department codes, not display-name allowlists.
- 70e.5c: Decide the package session-type override policy. If override is allowed, add a permissioned, audited path with clear pricing consequences. If override is not allowed, update the relevant spec notes/decisions so implementation and spec agree.
- 70e.5d: Change `OrderAddOn.orderPackageId` delete behavior only after deciding whether scoped add-ons should cascade with a removed line or block line deletion.
- 70e.5e: Add a DB uniqueness constraint or service invariant for duplicate `BookingPackage` rows. Preferred rule: the persisted model should not allow duplicate `(bookingId, packageId)` rows because quantity already represents multiples.

Acceptance criteria:

- [ ] Extra-photo pricing lookup has one source of business logic
- [ ] Invoice service no longer owns a duplicate extra-photo unit-price query
- [ ] Calendar bucketing does not depend on fragile display-name lists
- [ ] Session-type package override behavior is either implemented with audit/permission or documented as intentionally blocked
- [ ] Scoped add-on deletion behavior is explicit and tested
- [ ] Duplicate booking package lines are blocked at DB or service boundary
- [ ] `npx prisma validate` passes if schema changes are made
- [ ] `npm run build` passes
- [ ] `npm run lint` passes

## Backend Invariant Tests

Add focused backend tests as part of the sub-unit that introduces each invariant. Unit 70e.0 owns the shared harness; later units own their scenario coverage.

Required invariants:

- **Invoice reconciliation:** for every generated or snapshotted Final Invoice in test scenarios, `sum(lineItems.lineTotal) === invoice.totalAmount`.
- **Upgrade math:** upgrading a package changes invoice total by the final package price while preserving original package price snapshot as the commission baseline.
- **Commission baseline preservation:** `OrderPackage.originalPackagePriceSnapshot` remains populated and unchanged after package upgrade; upgrade amount is derived from final minus original snapshots.
- **POS extras:** POS extra photos persist to `OrderPackage.extraDigitalCount` / `OrderPackage.extraPrintCount` and generate an invoice charge.
- **Session-type pricing:** extra-photo charges use each package line's own `sessionTypeId`, including mixed-session-type orders.
- **Selected-photo aggregate:** total selected photos equals the sum of package-line selected-photo counts, using included photo count only when a line selected count is intentionally null.
- **Scoped add-on preservation:** active order write paths never delete add-ons scoped to another `OrderPackage`.
- **Package-line snapshot:** every `OrderPackage` created from check-in has `originalPackagePriceSnapshot` populated.
- **Duplicate booking package protection:** duplicate persisted `(bookingId, packageId)` rows are blocked or normalized before persistence.

Preferred test placement:

- Use existing service-level test patterns if present.
- If no service-level test harness exists, create the smallest backend test harness in Unit 70e.0.
- Tests should use transactions or isolated seed data so they can run repeatedly.

## Deferred Findings

These review findings are not lost, but they are not blocking the critical 70e stabilization units unless explicitly pulled into a sub-unit:

- **Mn1:** `OrderActivity.metadata` money formatting remains inconsistent.
- **Mn2:** Commission service persistence remains a future commission feature; 70e only preserves correct upgrade baseline input.
- **Mn3:** Booking detail/edit legacy singular header fields may still show first package only; defer unless they confuse active workflows after POS canonicalization.
- **Mn5:** POS top-level `extraPhotoUnitPrice` is handled by Unit 70e.4.
- **Mn6:** `Order.addOns Json` remains a schema cleanup candidate after structured `OrderAddOn` usage is fully stable.
- **Mn7:** Read-only package family/pricing catalog UI remains a future owner-visibility feature.
- **M5/M6:** Package duration default and confirmed booking package edits after locked deposit invoice are deferred policy decisions unless they block 70e testing.

## Post-Implementation

After each sub-unit:

- Update `context/progress-tracker.md` with the completed sub-unit, files changed, verification commands, and any decisions made.
- Update the relevant review document if the fix changes the status of a finding.
- If a sub-unit makes a policy decision that differs from Specs 67-70d, add a short Decisions note to this spec or the owning earlier spec.

After all 70e units:

- Add a short completion note to `context/reviews/specs-67-70d-implementation-review.md` summarizing which findings were fixed, intentionally deferred, or converted into documented decisions.

## Acceptance Criteria

- [ ] 70e.0 backend invariant test harness passes all acceptance criteria
- [ ] 70e.1 invoice math correctness passes all acceptance criteria
- [ ] 70e.2 POS canonicalization and duplicate surface retirement passes all acceptance criteria
- [ ] 70e.3 selected photo source-of-truth passes all acceptance criteria
- [ ] 70e.4 POS pricing display cleanup passes all acceptance criteria
- [ ] 70e.5 medium stabilization cleanup passes all acceptance criteria, with each cleanup shipped independently unless explicitly grouped
- [ ] Backend invariant tests cover invoice reconciliation, upgrade math, commission baseline preservation, POS extras, session-type pricing, selected-photo aggregation, scoped add-on preservation, package-line snapshots, and duplicate booking package protection
- [ ] POS is the only writable order selection/financial workspace
- [ ] No retired single-package write path can mutate multi-package orders
- [ ] No invoice display can show line items whose sum differs from `Invoice.totalAmount`
- [ ] No active selection workflow display can show extra-photo charges that are not invoiceable
- [ ] `npx prisma validate` passes
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] `context/progress-tracker.md` is updated for every implemented sub-unit

## Decisions

- **Stabilize financial correctness first.** Invoice total/line mismatch is the highest-risk issue because it affects customer-facing totals and accounting reconciliation.
- **Show final package value on invoices.** Owner confirmed customer-facing Final Invoices may show the final selected package value directly. Upgrade transparency stays in activity/commission metadata unless the owner later asks for original-plus-delta invoice presentation.
- **Preserve base package snapshots for commissions.** `OrderPackage.originalPackagePriceSnapshot` remains the immutable baseline for commission and upgrade-delta logic.
- **Make POS canonical.** POS already owns package changes, selected photos, digital/print extras, add-ons, invoice preview, and final payment. Duplicating that workflow in order detail tabs creates drift and first-line-only bugs.
- **Retire before rebuilding.** The legacy edit page and writable selection workflow tab should be deleted or made inaccessible if audit confirms POS has equivalent capability. Do not rebuild them as parallel POS surfaces.
- **Use `OrderPackage` as the package-line truth.** The multi-package architecture only works if line-specific fields live on line rows and aggregate reads are derived from those rows.
- **Defer full cleanup until critical invariants are protected.** Duplicate helper removal, calendar color mapping, and schema uniqueness gaps matter, but they should not delay fixing invoice and data-loss bugs.
- **Backend invariant tests are mandatory.** These bugs are mostly service-layer consistency bugs; UI tests alone would not catch them reliably.

## Assumptions

- The current POS workspace covers all needed order selection and financial edit capabilities.
- If an audit finds unique functionality on the legacy edit page or selection workflow tab, that functionality will be moved to POS or an order detail read-only surface before retirement.
- Existing development data can be adjusted by migration or seed cleanup if Unit 70e.5 adds DB constraints.
- Commission persistence remains outside 70e, but upgrade delta inputs to the commission hook must continue to be correct.
