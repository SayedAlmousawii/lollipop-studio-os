# Feature 57f — POS Embedded Record Payment Dialog

## Goal

Implement a polished embedded `Record Payment` dialog inside the sales workspace at `/orders/[orderId]/sales` so staff can record invoice payments without leaving the POS surface. Reuse the existing invoice/payment domain flow wherever possible, keep all business logic server-side, and preserve invoice content immutability.

---

## Read First

- `context/feature-specs/57-pos-commercial-workspace.md` — POS route, workspace intent, current financial sidebar direction
- `context/owner-feedback-reviews/POS-review.md` — payment timing, financial safety, immutable invoice expectations
- `context/reviews/open-issues-review.md` — useful background only; treat current code as the source of truth if this doc is outdated
- `app/orders/[orderId]/sales/page.tsx` — current sidebar button behavior and POS summary rendering
- `app/orders/[orderId]/sales/actions.ts` — existing POS server action patterns and revalidation helper
- `app/invoices/actions.ts` — current payment action implementation
- `src/components/invoices/record-payment-form.tsx` — existing invoice-page payment form fields and action-state pattern
- `src/components/ui/date-picker.tsx` — existing date input pattern
- `src/components/ui/time-picker.tsx` — existing time input pattern
- `src/components/ui/sonner.tsx` — current toast system wrapper
- `src/modules/orders/order.service.ts` — POS read model source
- `src/modules/orders/order.types.ts` — POS invoice/read-model types
- `src/modules/payments/payment.schema.ts` — payment validation contract
- `src/modules/payments/payment.service.ts` — payment creation flow and current locked-invoice behavior
- `src/modules/invoices/invoice.service.ts` — invoice balance/status recalculation behavior

---

## Rules

- Keep this unit scoped to embedded payment recording only. Do not redesign the broader sales workspace, invoice detail page, or financial composition rules.
- All payment writes must remain server-side through server actions and service functions. No direct DB access from pages or components.
- Reuse the existing payment creation flow where possible. If invoice-page and POS-page actions diverge, extract shared server-side logic instead of cloning business rules.
- Do not introduce schema changes unless implementation proves the current model cannot support the modal fields. The current model already supports amount, method, `paidAt`, reference, and notes.
- Do not mutate invoice line items, invoice totals, or order composition from this dialog.
- Overpayment is unsupported in this unit. The client may hint and prefill, but the server must enforce `amount <= remaining balance`.
- The POS dialog should stay cashier-friendly. Do not expose the generic invoice-page payment-type picker in this unit.
- Submit `paymentType = BASE` as a hidden POS default for this flow. If implementation uncovers a conflicting business rule, stop and ask before widening the scope.
- If locked invoices are allowed to accept payments in this unit, that behavior must be enforced explicitly in the service layer. A client-only exception is not acceptable.

---

## Scope

### In Scope

- Replace the sales workspace sidebar payment navigation with an embedded dialog/modal
- Keep the user on `/orders/[orderId]/sales` while recording payment
- Show invoice summary context inside the dialog
- Prefill amount/date/time intelligently for fast cashier use
- Add quick amount actions (`Full balance`, `Half`, `Custom`) if they can be done cleanly within the existing component patterns
- Large, obvious payment method selection UI for `KNET`, `Cash`, and `Link`
- Sales-specific server action handling, validation, and route revalidation
- Fully-paid and no-invoice disabled states in the sales workspace
- Locked-invoice payment behavior as defined below
- Success toast and clear inline error handling

### Out of Scope

- Editing invoice line items or invoice totals
- Adjustment invoice UI or approval workflow UI
- Payment refunds, voids, edits, or deletes
- Save-draft payments
- New payment schema/entities/statuses
- Redesigning the invoice detail page beyond shared helper extraction if needed
- Expanding the POS into a full invoice editor

---

## Implementation Direction

### Current Behavior

- The sales workspace financial sidebar in `app/orders/[orderId]/sales/page.tsx` currently links `Record Payment` to `/invoices/[id]`, so staff leave the POS surface to collect payment.
- The invoice detail page uses `src/components/invoices/record-payment-form.tsx`, which asks for amount, method, payment type, paid date, reference, and notes.
- `app/invoices/actions.ts` currently revalidates invoice routes but does not refresh `/orders/[orderId]/sales`.
- `src/modules/payments/payment.service.ts` currently blocks payments on locked invoices with `Cannot record payments against a locked invoice`.
- `src/modules/invoices/invoice.service.ts` currently short-circuits `recalculateInvoiceStatus()` when an invoice is locked, so payment-derived fields do not update for locked invoices.
- The current POS sidebar has no embedded modal, no success toast behavior, and no cashier-focused payment method UI.

### Desired Behavior

- Clicking `Record Payment` from the sales workspace opens a dialog/modal in place instead of navigating away.
- The dialog keeps invoice context visible while the user enters payment details.
- If no invoice exists, keep the current sales workspace invoice creation behavior and do not open the payment dialog.
- If the invoice is fully paid, the sales workspace should show a disabled `Fully Paid` state or equivalent disabled payment action.
- On success, the dialog closes, the sales workspace revalidates, a success toast appears, and invoice paid/remaining/status values reflect the service-layer result.
- On failure, the dialog stays open, field/global errors are visible, and duplicate submissions are prevented.

### UX Requirements

- Use existing shadcn/ui dialog patterns and Studio OS design tokens. The result should feel like a fast POS cashier modal, not a generic admin form.
- Header:
  - payment icon
  - title: `Record Payment`
  - subtitle: `Record a payment for this invoice`
  - close button in the dialog corner
- Invoice summary section at the top:
  - invoice number
  - invoice status
  - customer name and/or job number if helpful from the existing POS read model
  - total, paid, remaining using existing money formatting
  - if line items are already available in the POS invoice snapshot, a compact summary is allowed; do not turn this unit into a full invoice review screen
- Locked invoice notice:
  - show a clear informational block: `Invoice is locked. Payments can still be recorded.`
  - this notice is informational, not an error state, when remaining balance still exists
- Payment date/time:
  - date defaults to today
  - time defaults to current local time
  - use `DatePicker` plus existing `TimePicker`
  - submit a single combined timestamp to the server action
- Payment amount:
  - required
  - defaults to current remaining balance
  - keep KD/KWD formatting aligned with existing app conventions
  - provide quick-fill actions for `Full balance`, `Half`, and `Custom` only if they fit cleanly into the existing component vocabulary
- Payment method selection:
  - required
  - large visible card/button choices for `KNET`, `Cash`, and `Link`
  - selected state must be visually obvious
  - if the enum contains more methods, do not surface them here unless they are already active in real app behavior
- Reference number:
  - optional
  - useful for transaction IDs
- Notes:
  - optional
  - internal-only note field
- Footer:
  - `Cancel`
  - primary `Record Payment`
  - no `Save Draft` in this unit because the current payment architecture does not support draft records
- Pending state:
  - submit button shows a loading label
  - submit is disabled while pending
  - the form should not allow obvious duplicate clicks

### Data / Read-Model Requirements

- Reuse `getPOSWorkspace(orderId)` and `POSWorkspace.invoice` as the main source of invoice context.
- Extend the POS read model only if the dialog needs missing display fields that are not already present, such as a compact disabled/payment-state reason.
- Prefer adding minimal read-model helpers like `canRecordPayment` or `recordPaymentDisabledReason` if they reduce duplicated client rules. Do not add display-only fields that can already be read from existing workspace data.
- Do not recalculate totals on the client. The client may display `invoiceTotal`, `paidAmount`, and `remainingAmount` from the read model and perform basic form-state hints only.
- Reuse existing order/customer labels already present on `POSWorkspace` for the dialog summary instead of creating a second fetch.

### Server / Action / Service Requirements

- Add a POS-specific payment action to `app/orders/[orderId]/sales/actions.ts` or extract a shared helper that both invoice-page and sales-page flows can call.
- The POS action should:
  - require `PAYMENT_CREATE`
  - validate the form payload with Zod at the action boundary
  - combine UI date + time into one `paidAt` timestamp
  - submit `paymentType: BASE`
  - call the existing `recordPayment()` service instead of duplicating DB logic
  - revalidate `/orders`, `/orders/[orderId]`, `/orders/[orderId]/sales`, `/invoices`, and `/invoices/[invoiceId]`
- Reuse the invoice-page action logic where reasonable, but do not keep sales workspace dependent on invoice-page-only revalidation.
- Tighten server-side rules for this flow:
  - reject payments when no remaining balance exists
  - reject `amount > remainingAmount`
  - reject invalid/empty payment method
  - keep reference and notes within existing schema limits
- Locked invoices:
  - this unit intentionally changes current behavior if the invoice is locked but still unpaid
  - payment rows remain append-only
  - invoice content stays immutable
  - service logic must allow recording payment against a locked invoice when `remainingAmount > 0`
  - payment-derived fields (`paidAmount`, `remainingAmount`, `status`) must still update after the append
- Do not reopen, recalculate, or unsnapshot invoice line items to record a payment.
- If needed, extract invoice-balance update logic from `recalculateInvoiceStatus()` so locked invoices can refresh payment-derived status without mutating invoice content.

### Validation Rules

- `amount` is required
- `amount` must be greater than `0`
- `amount` must not exceed the current remaining balance
- `method` is required
- `paidAt` must resolve to a valid timestamp after combining date + time
- `reference` remains optional and must respect the existing length limit
- `notes` remain optional and must respect the existing length limit
- `paymentType` is hidden and fixed to `BASE`
- if the invoice is fully paid, the action must refuse new payment creation
- if no invoice exists, the modal must not submit
- client validation should mirror the main constraints for speed, but the server is authoritative

### Locked Invoice Behavior

- Current code treats locked invoices as entirely non-payable. This unit explicitly changes that payment behavior for the POS flow.
- Locked means invoice content is immutable:
  - no line item edits
  - no total recalculation
  - no commercial composition edits from this dialog
- Locked does not mean payment collection is forbidden if balance remains.
- If `invoice.isLocked === true` and `remainingAmount > 0`:
  - the dialog opens
  - the notice explains that payments can still be recorded
  - a valid payment may be submitted
- If `invoice.isLocked === true` and `remainingAmount <= 0`:
  - treat the invoice as effectively fully paid for this dialog
  - disable recording another payment
- Do not create adjustment invoices from this dialog. That remains separate future work.

### Success / Error Behavior

- Success:
  - record payment through the existing server-side flow
  - close the dialog
  - refresh the sales workspace data
  - show a success toast using the project’s existing toast system
  - reflect updated paid/remaining/status values in the sidebar without manual page navigation
- Error:
  - keep the dialog open
  - show a clear global or field-specific error
  - preserve the user’s entered values where possible
  - do not create duplicate payments
- If no invoice exists yet:
  - keep the current `Create Invoice` path as the main action
  - do not show a misleading live payment form
- If fully paid:
  - disable the payment trigger or replace it with a clear `Fully Paid` state

### Accessibility and Keyboard Interaction Expectations

- Dialog must trap focus correctly
- `Escape` closes the dialog when not pending
- close button is keyboard reachable and has an accessible label
- initial focus should land on the amount field when payment can be recorded
- payment method cards must be keyboard navigable and expose an obvious selected state
- all fields need visible labels
- error text must be associated with the relevant fields
- closing the dialog should return focus to the trigger button
- the locked notice and any global error should be announced clearly by assistive tech-friendly markup patterns already used in the app

### Testing Checklist

- Dialog opens from the sales workspace instead of navigating to invoice detail
- Invoice summary inside the dialog renders the correct invoice number, totals, and balance state
- Amount defaults to the current remaining balance
- `Full balance`, `Half`, and `Custom` amount behavior works if implemented
- Payment method selection is visible and works for keyboard and pointer interaction
- Validation blocks missing amount
- Validation blocks zero/negative amount
- Validation blocks overpayment
- Locked invoice notice appears when expected
- Locked invoice with remaining balance still allows a valid payment
- Fully paid invoice prevents recording another payment
- Successful payment calls the existing payment creation service with the correct normalized payload
- Successful payment revalidates and updates the sales workspace sidebar
- Failed payment keeps the dialog open and surfaces the error
- Pending submit prevents obvious duplicate submission
- `npm run lint` passes
- `npm run build` passes

### Files Likely to Change

- `app/orders/[orderId]/sales/page.tsx`
- `app/orders/[orderId]/sales/actions.ts`
- `src/components/orders/` new POS payment dialog component file(s)
- `src/components/invoices/record-payment-form.tsx` only if extracting shared field/pattern logic is cleaner than duplicating the form shell
- `src/modules/orders/order.service.ts`
- `src/modules/orders/order.types.ts`
- `src/modules/payments/payment.service.ts`
- `src/modules/payments/payment.schema.ts` only if shared validation needs a remaining-balance-aware wrapper
- `src/modules/invoices/invoice.service.ts`

### Verification Commands

- `npm run lint`
- `npm run build`

---

## Post-Implementation

- Update `context/progress-tracker.md`
- Record Feature `57f` as complete once the embedded POS payment dialog is shipped

---

## Acceptance Criteria

1. Clicking the sales workspace payment action opens an embedded dialog/modal instead of navigating to `/invoices/[id]`.
2. The dialog shows invoice summary context and keeps staff inside `/orders/[orderId]/sales` throughout payment recording.
3. The dialog defaults the payment amount to the current remaining balance.
4. The dialog defaults the payment date and time to the current local values and submits a single valid `paidAt` timestamp.
5. Payment method selection is required and presented with prominent POS-style controls for `KNET`, `Cash`, and `Link`.
6. The POS flow submits through the existing payment service layer and does not bypass server-side validation or transactions.
7. Overpayment is blocked server-side and surfaced clearly in the UI.
8. If no invoice exists, the payment dialog is unavailable and current invoice-creation behavior remains clear.
9. If the invoice is fully paid, the sales workspace prevents recording another payment.
10. If the invoice is locked but still has remaining balance, the dialog shows the locked notice and still permits append-only payment recording.
11. Recording a payment from the POS does not edit invoice line items, invoice totals, or order composition.
12. Successful payment closes the dialog, refreshes the sales workspace invoice summary, and shows a success toast.
13. Failed payment keeps the dialog open, shows the error, and prevents duplicate submission.
14. `npm run lint` passes.
15. `npm run build` passes.
