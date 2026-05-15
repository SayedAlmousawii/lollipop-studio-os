## Goal

When a user reduces or removes an item from a locked order in the POS reductive path (e.g., the "remove addon" button on the order detail page), the backend correctly throws `PendingCreditNoteApprovalError` to demand manager approval — but the POS UI swallows this as a generic *"Unable to remove order add-on"* error toast. The manager-approval prompt (already implemented for the explicit "edit invoice" flow via `credit-note-approval-fields.tsx`) is never surfaced from the reductive button path. Phase E QA flagged this as the highest-friction locked-edit hazard: staff can't tell the system *wants* manager approval; they just see an unexplained failure and either retry, escalate, or work around.

This spec catches `PendingCreditNoteApprovalError` in the POS reductive action, surfaces the manager-approval modal, collects manager userId + reason, and re-invokes the same backend path with `managerApprovedReductionByUserId` populated.

Closes roadmap items **W2** and **O4**.

---

## Read First

- `context/reviews/77-post-verification-hardening-roadmap.md` — §3 W2, §8 O4
- `src/modules/financial/edit-classifier.ts:53` — `PendingCreditNoteApprovalError` (the error to catch)
- `src/modules/invoices/invoice.service.ts:362` — where the error is thrown
- `src/components/orders/credit-note-approval-fields.tsx` — existing manager-approval form, the UX template to reuse
- `app/orders/[orderId]/sales/actions.ts` — the POS server actions (where the reductive button calls in)
- The POS detail page that renders the "remove addon" / quantity-decrement / removal controls (search for the action callers in `app/orders/[orderId]/`)

---

## Rules

- The reductive POS action must catch `PendingCreditNoteApprovalError` and serialize the prompt payload (reductions list, adjustment lines, formatted amounts) to the client.
- The client must render a manager-approval modal blocking the reduction until either:
  - A manager userId is captured + optional reason text entered, after which the original reductive action is re-invoked with `managerApprovedReductionByUserId` and `managerApprovedReason` populated, OR
  - The user cancels, in which case the order returns to its pre-reduction state (no DB change occurred — the error path didn't write).
- The modal copy must explicitly state: *what is being removed, the credit-note amount that will be issued, and that a manager must authorize it.* Generic "approval required" copy is not sufficient — staff need to see the dollar amount.
- The existing explicit edit-invoice flow that uses `credit-note-approval-fields.tsx` is the visual reference. Reuse the component verbatim if it accepts the right props; otherwise extract its inner form into a shared component used by both surfaces.
- Authorization: the manager userId captured by the modal must be a user with manager role. Server-side: validate the approval actor on every path that issues a credit note or adjustment from locked-order edits. `createCreditNoteWithClient` and `applyAdjustmentReversalsWithClient` already enforce this; the adjustment-invoice path must receive the same manager-role validation before proceeding.

---

## Scope

### In Scope

**Server action update**

In the POS reductive action in `app/orders/[orderId]/sales/actions.ts` (specifically the action that handles "remove addon", "decrement quantity", "remove upgrade", "remove extra photo"):

1. Wrap the existing service call in a try/catch.
2. On `PendingCreditNoteApprovalError`, return a structured result `{ kind: 'approval-required', payload: { reductions, adjustmentLines } }` rather than throwing. Serialize all `Prisma.Decimal` amounts in `reductions` and `adjustmentLines` to strings before returning them to the client.
3. Add a parallel action `confirmReductiveEditWithApproval` that accepts the same input as the reductive edit action plus `managerApprovedReductionByUserId` and `managerApprovedReason`, then invokes the same service path with those approval fields populated. Do not extend the first action into a mixed "maybe approved" action.

**Client modal**

A new client component `<ReductiveEditApprovalModal>`:

- Opens when the reductive action returns `kind: 'approval-required'`.
- Renders the reductions and totals (reuse `credit-note-approval-fields.tsx` inner form if structurally compatible; otherwise extract its form fields into `<CreditNoteApprovalForm>` and use from both surfaces).
- Submits to `confirmReductiveEditWithApproval` with the manager userId + reason.
- On success: closes, refreshes the order detail.
- On cancel: closes without action, surfaces a transient toast *"Reduction cancelled. The order was not changed."*
- Accessibility is part of the component contract: trap focus while the modal is open, Escape must call the same cancel flow, return focus to the triggering element on close, use `role="dialog"` or `role="alertdialog"` with `aria-modal="true"`, expose a meaningful title through `aria-labelledby` or `aria-label`, and ensure assistive technology announces the modal content. Apply the same behavior whether the form surface uses `credit-note-approval-fields.tsx` directly or an extracted `<CreditNoteApprovalForm>`.

**Toast copy**

The legacy generic toast `Unable to remove order add-on` is removed from the catch-all error path. Replace with a switch on the error shape:

- `kind: 'approval-required'` → open the modal (not a toast).
- Any other error → show the error message verbatim from the server (fall through to existing error handling).

The app does not currently have an i18n resource layer, so this feature is not subject to localization. Keep new strings co-located with the component/action surface for now, but do not invent replacement copy for server errors - surface what the server returns.

**Post-approval error handling**

When the manager submits approval through the modal and `confirmReductiveEditWithApproval` fails (for example because of concurrent modification or validation), keep the modal open, show the backend error inline inside the modal, allow retry or cancel, and log the failure. Do not dismiss the modal and do not replace the inline error with a generic toast.

**Reusability**

If `credit-note-approval-fields.tsx` is currently form-only and not modal-wrapped, extract its inner form into `<CreditNoteApprovalForm>` (the field layout, label copy, manager-select widget, reason textarea). Both the legacy explicit-edit surface and the new POS-reductive modal compose this shared form. This is the A2-style "single source of truth" pattern at the UI layer.

**E2E / integration test**

`tests/integration/pos-reductive-approval.test.ts` (or extend the existing locked-edit test suite):

- Test A: as a STAFF user, trigger the "remove addon" action on a locked-order addon and assert only the server-action return shape: `{ kind: 'approval-required', payload: { reductions, adjustmentLines } }`, including the required payload fields. A separate component test may additionally mount the relevant React UI to assert `<ReductiveEditApprovalModal>` renders when the action returns that shape, but Test A's required scope is the server-action contract.
- Test B: complete the modal with a valid manager userId → second action call succeeds → addon removed, CREDIT_NOTE issued.
- Test C: complete the modal with a non-manager userId → second action fails with a permission error (existing service-level guard catches this; assert the error surfaces to the modal).
- Test D: cancel the modal → no DB change (assert addon still present, no CREDIT_NOTE created).
- Test E: post-approval service failure keeps the modal open with the backend error visible, and retrying after correcting the condition succeeds.

For the UI side, a snapshot/component test verifies the modal renders the reduction line items and amounts.

### Out of Scope

- F4 adjustment-cause reversal — **79a**. If 79a has landed, verify current behavior before changing it: if `result.adjustmentReversals` still participates in the `PendingCreditNoteApprovalError` condition, document and test that F4 reversals require manager approval; otherwise exclude adjustment reversals from the approval condition and add unit coverage for `managerApprovedReductionByUserId` behavior.
- F5/D1-D3 legacy formula deletion — **79b**.
- F2 overpayment capacity — **79c**.
- Adding a new manager-role permission or changing role semantics — **78b** already handled actor-role rigor.
- Audit log of who approved which reduction — **A1** in Sprint 3 (`AuditLog` model). The existing classifier already records `managerApprovedReductionByUserId` on the CREDIT_NOTE; that linkage is sufficient until A1 lands.

---

## Implementation Direction

**Risk:** Low-medium. Pure UX surfacing of an already-working backend flow. The risk is forgetting one reductive entry point — if the POS has multiple buttons that trigger a reduction (remove addon, decrement quantity, remove upgrade, remove extra photo), every one must wire the try/catch + modal. Grep for the action callers exhaustively.

**Order of work:**

1. Identify every POS reductive action call site. Build the list before writing any code.
2. Extract `<CreditNoteApprovalForm>` from the existing `credit-note-approval-fields.tsx` if needed.
3. Wire the catch + modal on one call site (e.g., "remove addon"). Confirm the round-trip works end-to-end on dev.
4. Apply the same pattern to the other call sites.
5. Replace the legacy toast.
6. Add tests A–E.

**Why a modal rather than a stacked banner:** the reductive flow is destructive (removes an item, issues a credit note). A blocking modal is the appropriate friction — staff cannot accidentally proceed past it. The existing explicit edit-invoice surface already uses an inline form, which works there because the user already chose to enter "edit" mode; in the reductive POS surface, the user clicked "remove" without choosing approval, so the modal interrupts to ask.

**Rollback:** revert the PR. Reductive actions revert to the generic toast — no data risk, just the prior UX hazard returns.

---

## Verification

- Tests A–E pass.
- All existing tests pass.
- `npm run build` passes.
- `npm run lint` passes.
- Manual (staff role, dev): on a locked-FINAL order, click "remove addon" → modal opens with the addon name and credit-note amount visible → confirm with a manager userId → addon removed, CREDIT_NOTE invoice created. UI refreshes to show the updated order.
- Manual: same flow but click cancel on the modal → no DB change; toast *"Reduction cancelled"* visible.
- Manual: trigger the approval prompt from every reductive entry point (remove addon, decrement quantity, remove upgrade, remove extra photo, downgrade package tier). All show the modal.
- Grep audit: `grep -rn "Unable to remove order add-on" .` returns zero matches outside of test/regression fixture files that may reference the old copy historically.

---

## Post-Implementation

- Update `context/reviews/77-post-verification-hardening-roadmap.md`: mark W2 and O4 as completed.
- Update `progress-tracker.md`.
