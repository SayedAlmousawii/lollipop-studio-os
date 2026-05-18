# Studio OS Centralization Inventory

Generated: 2026-05-18

Scope: architecture inventory only. No code changes, refactors, DB changes, commits, or progress-tracker updates.

## Executive Summary

Studio OS has a solid service-layer foundation for financial documents, payments, locked invoice adjustments, session-configuration pricing, and workflow writes. The highest-risk gap is not missing services; it is that several page/component read models still calculate their own display totals, payment labels, package/extras summaries, and status affordances from different subsets of the same data.

The strongest centralization is in:

- `src/modules/invoices/invoice.service.ts` for invoice creation, recalculation, adjustment invoices, credit notes, deposit application, and invoice status.
- `src/modules/payments/payment.service.ts` plus `src/modules/invoices/invoice.calculation.ts` for payment allocation and effective paid math.
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts` for post-lock staged composition and adjustment issuance.
- `src/modules/session-configurations/session-configuration-pricing.ts` for session-configuration fee pricing.
- `src/modules/orders/order-settlement.ts` for FinancialCase-level order settlement summaries.

The weakest centralization is in:

- Order detail page tabs using separate loaders (`getOrderHubById`, `getOrderSelectionWorkflowById`, `getOrderEditingWorkflowById`, `getOrderProductionWorkflowById`, `getOrderDeliveryWorkflowById`, `getPOSWorkspace`, `getLinkedFinancialDocumentsForOrder`) with overlapping calculations.
- POS draft sidebar and POS package/photo components calculating display totals and preview math in React.
- Locked order financial summary duplicated between Sales View and Order Details.
- Workflow/status labels and transition rules mostly centralized, but guard rules and action availability spread across services and components.

## Findings

### 1. Invoice Totals, Remaining Balance, Deposits

Classification: PARTIAL / HIGH RISK

Current source of truth:

- `src/modules/invoices/invoice.service.ts`
  - `createInvoiceForOrderWithClient()`
  - `syncOrderInvoiceForFinancialEdit()`
  - `recalculateInvoiceStatus()`
  - `applyDepositToFinalIfPresent()`
  - `buildInvoiceLineItems()`
- `src/modules/invoices/invoice.calculation.ts`
  - `computeEffectivePaidFromAllocations()`
- `src/modules/payments/payment.service.ts`
  - `recordPaymentWithClient()`
  - `createPaymentWithAllocation()`

Duplicated/stale locations:

- `src/components/orders/financial-sidebar-draft.tsx` computes draft `totalAmount` from `packageLines + extraPhotoTotal + addOnTotal + sessionConfigurationTotal`.
- `src/modules/orders/order.service.ts` computes POS workspace totals independently in `getPOSWorkspace()` and `mapPOSPackageLines()`.
- `app/orders/[orderId]/actions.ts` parses `invoice.remainingAmount` from a formatted string in `recordUpgradePaymentAction()`.
- `src/components/orders/pos-record-payment-dialog.tsx` derives full/half payment shortcuts from client-side `invoice.remainingAmount`.
- `app/bookings/[bookingId]/page.tsx` shows `packageRemainingBalanceLabel` as package total minus deposit invoice total, outside final-invoice settlement.

Risk level: High. The service layer has correct allocation-aware remaining balance, but components/pages can show stale or differently composed totals when deposits, document applications, credit notes, adjustment invoices, or locked snapshots are involved.

Recommended next refactor target:

Create one service-layer `FinancialCaseSummary` / `OrderFinancialViewModel` that exposes invoice total, effective paid, deposit applied, remaining, overpaid/refund capacity, and linked documents. Make `FinancialSidebarDraft`, `FinancialSidebarLocked`, Order Details Financials tab, order header cards, and invoice/payment dialogs consume that DTO instead of recomputing.

### 2. Payment Summaries and Customer/Job Ledger-Style Calculations

Classification: PARTIAL / HIGH RISK

Current source of truth:

- `src/modules/orders/order-settlement.ts`
  - `computeOrderSettlementSummary()`
  - `derivePaymentSummary()`
  - `deriveLockedFinancialSidebarSummary()`
  - `deriveSettlementPaidAmount()`
- `src/modules/orders/order.service.ts`
  - `getLinkedFinancialDocumentsForOrder()`
  - `mapOrderRow()` and `mapOrderDetailRow()` call settlement helpers for list/detail summary.

Duplicated/stale locations:

- `src/modules/orders/order.service.ts` still has `summarizeInvoices()` and `mapPaymentStatus()` based on direct invoice rows and status labels.
- `src/components/orders/order-settlement-summary.tsx` formats summary independently.
- `src/components/financial/financial-payment-summary.tsx` and `src/components/financial/financial-total-source.tsx` are shared UI, but depend on summaries built separately in Sales View and Order Details.
- `app/orders/[orderId]/page.tsx` logs header-vs-tab discrepancy because header uses `order.settlementSummary` while the financial tab summary is derived from `workspace.invoice + linkedDocuments`.

Risk level: High. The code already acknowledges possible mismatch between order header/cards and the financial tab. FinancialCase is the right boundary, but there is not yet one canonical read model for all order financial surfaces.

Recommended next refactor target:

Move `deriveOrderDetailsFinancialSummary()` out of `app/orders/[orderId]/page.tsx` and the equivalent Sales View logic into `src/modules/orders/order-settlement.ts` or a new financial view service. Then replace `summarizeInvoices()` usage for order payment status with the same FinancialCase-aware summary.

### 3. Adjustment Invoices, Credit Notes, Refunds

Classification: CANONICAL / PARTIAL

Current source of truth:

- `src/modules/invoices/invoice.service.ts`
  - `createAdjustmentInvoice()`
  - `createCreditNote()`
  - `computeCreditNoteCapacityForFinal()`
  - `computeOverpaymentCapacity()`
  - `syncOrderInvoiceForFinancialEdit()`
- `src/modules/refunds/refund.service.ts`
  - `issueRefundWithPayment()`
- `src/modules/financial/edit-classifier.ts`
  - `classifyEditDelta()`
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts`
  - `finalizeWorkspace()`
  - `createWorkspaceAdjustmentInvoice()`

Duplicated/stale locations:

- `src/components/orders/financial-sidebar-adjustment.tsx` constructs approval payloads from `workspace.proposal.deltas` for display/submission.
- `src/components/orders/credit-note-approval-fields.tsx` has display-specific reduction totals and formatting.
- `src/components/orders/reductive-edit-approval-modal.tsx` drives legacy direct-POS approval for reductions, while the Adjustment Workspace uses separate finalize approval.

Risk level: Medium. Core accounting writes are centralized and guarded. The risk is user-flow divergence: legacy direct POS reduction approval and workspace approval can drift in copy, payload shape, or required fields.

Recommended next refactor target:

Centralize a small `ReductionApprovalViewModel` builder in `src/modules/financial/` or `src/modules/adjustment-workspace/` and feed both `CreditNoteApprovalForm` and `ReductiveEditApprovalModal`.

### 4. FinancialCase Usage

Classification: PARTIAL / HIGH RISK

Current source of truth:

- `src/modules/bookings/booking.service.ts` creates `FinancialCase` during `recordBookingDeposit()` and links it to the job during `checkInBooking()`.
- `src/modules/invoices/invoice.service.ts` requires FinancialCase for final invoices and all sibling documents.
- `src/modules/payments/payment.service.ts` requires payment FinancialCase alignment.
- `src/modules/orders/order.service.ts` uses booking FinancialCase for settlement and linked financial documents.

Duplicated/stale locations:

- Some read paths still fall back to order invoices if `booking.financialCase` is missing (`getOrderSettlementInvoices()`).
- Order detail and sales pages assemble linked documents separately from POS workspace data.
- Booking detail still exposes package remaining balance from booking package totals and deposit invoice rather than the future FinancialCase final settlement.

Risk level: High. FinancialCase is mostly established as the hub, but multiple readers still carry compatibility/fallback paths that can hide missing case links or produce different summaries.

Recommended next refactor target:

Add a FinancialCase read service that returns normalized documents and settlement by `orderId`, `bookingId`, or `financialCaseId`. Keep fallback logging, but make UI surfaces consume one shape.

### 5. POS / Order Composition Before Lock

Classification: PARTIAL

Current source of truth:

- `src/modules/orders/order.service.ts`
  - `getPOSWorkspace()`
  - `updateOrderPackage()`
  - `upgradeOrderPackageItem()`
  - `addOrderProductAddOn()`
  - `removeOrderAddOn()`
  - `updateOrderSelectedPhotoCount()`
- `src/modules/invoices/invoice.service.ts`
  - `syncOrderInvoiceForFinancialEdit()`
  - `calculateOrderPackageExtraPhotoTotal()`
  - `buildInvoiceLineItems()`
- `src/modules/session-configurations/session-configuration-selection.service.ts`
  - selection writes
- `src/modules/session-configurations/session-configuration-pricing.ts`
  - selection pricing

Duplicated/stale locations:

- `src/components/orders/pos-package-composition.tsx` owns client-side photo allocation logic (`buildPhotoLineDraft()`, `resolveBillingMode()`, `getPhotoLinePreview()`, `resolvePhotoPayload()`).
- `src/components/orders/pos-add-on-marketplace.tsx` owns add-on counts by product id and quick action category filtering.
- `src/components/orders/financial-sidebar-draft.tsx` recomputes preview totals from POS workspace fields.
- `src/modules/orders/order.service.ts` and `src/modules/adjustment-workspace/adjustment-workspace.service.ts` both derive package lines, extra photo totals, add-ons, item upgrades, package options, and `upgradeDelta`.

Risk level: Medium. Writes are service-owned, but UI preview behavior and derived display composition are scattered. User-visible preview can drift from invoice creation if formulas change.

Recommended next refactor target:

Extract a shared `OrderCompositionViewModel` from `getPOSWorkspace()` that can produce package lines, add-on rows, extra-photo previews, and totals for both draft POS and adjustment-derived POS.

### 6. Locked vs Unlocked Order Behavior

Classification: PARTIAL / HIGH RISK

Current source of truth:

- `src/modules/orders/order.service.ts`
  - `assertDirectPOSMutationAllowed()`
  - direct mutations reject locked final invoice.
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts`
  - open/stage/finalize locked invoice adjustments.
- `src/modules/session-configurations/session-configuration-selection.service.ts`
  - post-lock operational direct edit support and financial edit blocking.
- `app/orders/[orderId]/sales/page.tsx`
  - branches between draft and locked sales view.

Duplicated/stale locations:

- `src/components/orders/financial-sidebar-draft.tsx`, `src/components/orders/pos-package-composition.tsx`, and `src/components/orders/pos-add-on-marketplace.tsx` each render their own locked notices.
- `app/orders/[orderId]/actions.ts` resolves session-configuration locked routing with direct DB reads in `resolveConfigureSessionRoute()`.
- `app/orders/[orderId]/adjustment-workspace/actions.ts` has separate stage schemas for locked edits that overlap with draft POS schemas.

Risk level: High. The lock guard is service-backed, but routing, messages, and mode-specific forms are duplicated. A new composition operation would need updates in several places.

Recommended next refactor target:

Create a central `OrderEditModePolicy` / `CompositionMutationPolicy` that returns allowed action, route target, approval requirements, and user-facing message for draft, locked, and adjustment modes.

### 7. Effective Order Composition After Adjustments

Classification: CANONICAL / PARTIAL

Current source of truth:

- `src/modules/adjustment-workspace/adjustment-workspace.service.ts`
  - `getEffectiveCompositionForInvoice()`
  - `captureCurrentOrderComposition()`
  - `applySignedInvoiceLines()`
  - `computeWorkspaceProposal()`
  - `derivePOSWorkspaceFromAdjustmentWorkspace()`
- `src/modules/composition-view/composition-view.model.ts`
  - `buildCompositionView()`
- `src/components/orders/current-composition-card.tsx`
  - shared renderer for locked/adjustment composition view.

Duplicated/stale locations:

- `derivePOSWorkspaceFromAdjustmentWorkspace()` re-derives POS-style `packageLines`, `addOns`, `extraPhotoTotal`, `addOnTotal`, selected counts, and aggregate outstanding.
- `src/modules/composition-view/composition-view.model.ts` classifies swaps and extra-photo lines using labels/ref prefixes (`parseChangeLabel()`, `isExtraPhotoLine()`), not only stable line metadata.
- Order Details Overview still uses `order.packageLines` from `mapOrderDetailRow()`, which is not the effective post-adjustment composition.

Risk level: Medium. The adjustment architecture is intentionally centralized, but the bridge back to POS and order overview is still partly interpretive.

Recommended next refactor target:

Add explicit stable `displayKind`, `fromLabel`, `toLabel`, and composition metadata to adjustment lines or the view model so `buildCompositionView()` does not parse labels.

### 8. Order Details Page Mismatches

Classification: SCATTERED / HIGH RISK

Current source of truth:

- `app/orders/[orderId]/page.tsx` orchestrates many service loaders.
- `src/modules/orders/order.service.ts`
  - `getOrderHubById()`
  - `getOrderSelectionWorkflowById()`
  - `getOrderEditingWorkflowById()`
  - `getOrderProductionWorkflowById()`
  - `getOrderDeliveryWorkflowById()`
  - `getPOSWorkspace()`
  - `getLinkedFinancialDocumentsForOrder()`

Duplicated/stale locations:

- Header metrics use `OrderDetail` from `getOrderHubById()`.
- Overview/Selection tabs use `OrderDetail.packageLines` and `OrderSelectionWorkflow.packageLines`.
- Operational configurations use `deriveOperationalPackageLines(workspace)` in the page.
- Financials tab uses POS workspace invoice and linked documents.
- Production tab uses `OrderDetail.packageItems` plus paid add-ons for deliverables.
- The page explicitly logs `order_details.financials_tab.header_discrepancy`.

Risk level: High. The page can display a stale package/add-on/photo state in one tab while another tab uses the POS or FinancialCase read model.

Recommended next refactor target:

Replace the order details orchestration with one `getOrderDetailsView(orderId)` service that composes the section DTOs from canonical sub-services and includes discrepancy checks internally.

### 9. Workflow / Status Logic

Classification: PARTIAL

Current source of truth:

- `src/modules/orders/order.constants.ts`
  - labels, status values, `ORDER_WORKFLOW_TRANSITIONS`.
- `src/modules/orders/order.service.ts`
  - `updateOrderEditingWorkflow()`
  - `updateOrderProductionWorkflow()`
  - `updateOrderDeliveryWorkflow()`
  - `assertWorkflowTransition()`
  - `resolveProductionUpdate()`
  - `resolveDeliveryUpdate()`
  - `basePaymentSettled()`
  - `assertEditingReadyToStart()`
- `src/modules/bookings/booking.service.ts`
  - `ALLOWED_STATUS_TRANSITIONS`
  - `recordBookingDeposit()`
  - `updateBookingStatus()`
  - `checkInBooking()`

Duplicated/stale locations:

- `src/components/bookings/booking-status-actions.tsx` carries its own `STATUS_ACTIONS`.
- `src/components/orders/editing-workflow-form.tsx`, `production-workflow-form.tsx`, and `delivery-workflow-form.tsx` rely on DTO booleans, but still encode display/action flows separately.
- `mapOrderDeliveryWorkflow()` uses `summarizeInvoices()` payment status, not the FinancialCase settlement summary.
- `updateOrderWorkflowStatus()` is a broad generic updater alongside specific workflow actions, increasing bypass risk for guard rules.

Risk level: Medium-high. Status transitions are centralized, but guard rules and available actions are spread across mapper functions, service mutations, and UI components.

Recommended next refactor target:

Create workflow policy builders per area (`buildEditingWorkflowPolicy`, `buildProductionWorkflowPolicy`, `buildDeliveryWorkflowPolicy`, `buildBookingWorkflowPolicy`) that return transitions, blockers, booleans, and action labels. Keep mutations in services, but stop duplicating action availability in components.

### 10. Shared UI / Data Loaders / DTOs

Classification: PARTIAL / SCATTERED

Current source of truth:

- `src/components/financial/` provides shared read-only financial UI:
  - `FinancialPaymentSummary`
  - `FinancialTotalSource`
  - `FinancialLinkedDocuments`
  - `InvoiceLineItems`
- `src/components/orders/current-composition-card.tsx` provides shared locked/adjustment composition rendering.
- `src/modules/orders/order.types.ts` defines POS and order DTOs.

Duplicated/stale locations:

- Money formatting appears in many files: `financial-sidebar-primitives.tsx`, `financial-format.ts`, `order-settlement-summary.tsx`, `pos-record-payment-dialog.tsx`, `configuration-summary-chip.tsx`, `credit-note-approval-fields.tsx`, `current-composition-card.tsx`, service-layer `formatMoney()` helpers, and more.
- `db` is used directly in server actions/pages at `app/orders/[orderId]/actions.ts` and `app/bookings/new/page.tsx`, which bypasses the intended service-only DB rule for loaders.
- Several DTOs are shaped per page rather than shared: `OrderDetail`, `OrderSelectionWorkflow`, `POSWorkspace`, `LinkedFinancialDocument`, `AdjustmentWorkspaceView`.
- `src/components/orders/orders-table.tsx` parses formatted money strings to decide badge color.

Risk level: Medium. Formatting duplication is mostly display risk; direct DB reads in actions/pages are architectural drift and can become business logic drift.

Recommended next refactor target:

Introduce shared financial formatting in `src/components/financial/financial-format.ts` or `src/lib/formatting/money.ts`, and move direct DB reads in server actions into service helpers.

### 11. Session Configuration Pricing and Selection

Classification: CANONICAL

Current source of truth:

- `src/modules/session-configurations/session-configuration-pricing.ts`
  - `priceSelections()`
  - `formatSelectionDescription()`
- `src/modules/session-configurations/session-configuration-selection.service.ts`
  - `writeOrderPackageSelections()`
  - `applySessionConfigurationEditFromWorkspace()`
- `src/modules/session-configurations/session-configuration-resolver.ts`
  - `resolveOrderSessionConfigurations()`
- `src/modules/invoices/invoice.service.ts`
  - invoice totals and snapshots call the pricing pipeline.
- `src/modules/adjustment-workspace/adjustment-workspace.service.ts`
  - uses `priceSelections()` for staged financial session configuration edits.

Duplicated/stale locations:

- `src/components/session-configurations/configure-session-panel.tsx` computes display price labels via local helper functions.
- `app/orders/[orderId]/actions.ts` has route classification for locked operational vs financial configuration IDs.

Risk level: Low-medium. Pricing is correctly centralized; routing and display labels are partial duplicates.

Recommended next refactor target:

Expose a service-level route/read DTO for session-configuration edit mode so actions do not query configuration behavior directly.

### 12. Booking Deposit and Check-In Financial Flow

Classification: CANONICAL / PARTIAL

Current source of truth:

- `src/modules/bookings/booking.service.ts`
  - `recordBookingDeposit()` atomically creates FinancialCase, deposit invoice, payment, locks invoice, confirms booking.
  - `checkInBooking()` creates Job and Order, links FinancialCase, updates invoice/payment job references.
- `src/modules/payments/payment.service.ts`
  - payment recording and invoice auto-close.

Duplicated/stale locations:

- `src/components/bookings/booking-status-actions.tsx` includes dead/unused confirm gating logic even though confirmation now happens through deposit recording.
- `app/bookings/[bookingId]/page.tsx` calculates/showcases remaining package balance in booking context.
- `mapBookingDetail()` dedupes deposit invoices from both booking and FinancialCase, indicating historical mixed attachment paths.

Risk level: Medium. The write flow is strong; the display/read path carries compatibility logic and old wording (`base package payment`) in several places.

Recommended next refactor target:

Create a booking financial summary DTO sourced from FinancialCase and remove booking-page package balance arithmetic once final-invoice flow is fully represented.

## Top 10 Centralization / Refactor Priorities

1. Build a canonical FinancialCase / order financial summary read service.
2. Replace Order Details financial summary derivation in both `app/orders/[orderId]/page.tsx` and Sales View with one service helper.
3. Replace order header/payment status calculations with FinancialCase-aware settlement.
4. Consolidate `OrderDetail`, selection, production, delivery, POS, linked-documents loaders behind `getOrderDetailsView(orderId)`.
5. Extract draft/locked/adjustment composition read model generation from `order.service.ts` and `adjustment-workspace.service.ts`.
6. Centralize locked/unlocked/adjustment mutation policy and user-facing blocked messages.
7. Centralize workflow policy/action availability builders for booking, editing, production, and delivery.
8. Move direct DB reads out of `app/orders/[orderId]/actions.ts` and `app/bookings/new/page.tsx`.
9. Centralize money formatting and stop parsing formatted money strings in UI.
10. Replace label parsing in `composition-view.model.ts` with structured composition metadata.

## Safest Order To Fix Them

1. Add read-only FinancialCase summary service and tests. Do not change writes.
2. Swap Order Details Financials tab and Sales locked sidebar to the shared summary helper.
3. Swap order header/cards/table payment status to the same summary, keeping discrepancy logging temporarily.
4. Centralize money formatting and remove UI string parsing.
5. Move direct DB reads from server actions into small service helpers.
6. Extract composition view-model builder while keeping existing DTO shape.
7. Replace POS draft sidebar total preview with the shared composition/financial DTO.
8. Unify locked/edit-mode policy messages after the read models are stable.
9. Centralize workflow policy builders.
10. Remove historical compatibility/fallback paths only after fixtures/invariants confirm every live flow uses FinancialCase.

## What Should Not Be Touched Yet

- Do not rewrite invoice/payment/refund write services until read models are centralized; they are already the safest part of the architecture.
- Do not change Prisma schema for this cleanup unless a later unit proves a stable metadata field is required.
- Do not remove FinancialCase fallback reads until there is a migration/backfill verification step.
- Do not merge Adjustment Workspace and direct POS writes. Keep draft direct writes and locked staged writes separate until policy/read-model cleanup is complete.
- Do not alter credit note/refund capacity formulas without dedicated financial invariant tests.
- Do not redesign workflow statuses before centralizing their read policies; today’s status enums and transition maps are usable.

## Areas Already Good

- Deposit recording is atomic and service-owned in `src/modules/bookings/booking.service.ts`.
- Final invoice creation, deposit application, line snapshots, adjustment invoices, credit notes, and refund issuance are centralized in service modules.
- Payment allocation and effective paid math have a clear canonical helper in `src/modules/invoices/invoice.calculation.ts`.
- Session configuration pricing is centralized through `src/modules/session-configurations/session-configuration-pricing.ts`.
- Post-lock adjustment staging has a coherent service boundary in `src/modules/adjustment-workspace/adjustment-workspace.service.ts`.
- Shared locked financial UI in `src/components/financial/` is a good direction; it needs a canonical upstream DTO, not a UI rewrite.
- `CurrentCompositionCard` plus `buildCompositionView()` is a good shared rendering pattern for locked/adjustment composition, with the caveat that line classification should become metadata-driven.
