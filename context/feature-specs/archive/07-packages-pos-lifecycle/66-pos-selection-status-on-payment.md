# Feature 66 — Selection Status on POS Payment Dialog

## Goal

Force employees to declare the customer's photo selection status every time a payment is recorded in the POS. A required three-option ToggleGroup (`Not Yet`, `In Progress`, `Selected`) is added to the record payment dialog and must be answered before the form can submit. The answer updates `Order.selectionStatus` and, when `Selected` is chosen, advances the order from `WAITING_SELECTION` to `SELECTION_COMPLETED` in the same transaction as the payment.

## Read First

- `context/feature-specs/57f-pos-embedded-record-payment-dialog.md` — existing payment dialog implementation
- `src/components/orders/pos-record-payment-dialog.tsx` — the dialog component to modify
- `src/modules/orders/order.constants.ts` — `OrderSelectionStatus`, `ORDER_SELECTION_STATUS_LABELS`, and the selection transition map
- `src/modules/orders/order.service.ts` — existing payment recording logic and selection status update patterns
- `app/orders/[orderId]/sales/page.tsx` — POS page, understand what order data is passed to the dialog

## Rules

- The selection status field is required — the dialog must not submit without a choice
- Do not pre-select any option — the employee must make a deliberate choice every time
- Selection status update and payment recording must happen in the same transaction — not two separate calls
- Only `Selected` advances the order status to `SELECTION_COMPLETED`; `In Progress` and `Not Yet` leave `OrderStatus` unchanged
- `Not Yet` maps to `OrderSelectionStatus.PENDING` — do not change existing status if already `IN_PROGRESS` or `COMPLETED`; check current status before writing to avoid regression (e.g. do not move a `COMPLETED` order back to `PENDING`)
- `In Progress` maps to `OrderSelectionStatus.IN_PROGRESS` — same guard: only advance, never regress
- `Selected` maps to `OrderSelectionStatus.COMPLETED` — always write, then advance `OrderStatus` to `SELECTION_COMPLETED`
- The ToggleGroup uses the shadcn `ToggleGroup` component — do not introduce a new UI primitive
- This field only appears when `OrderStatus` is `WAITING_SELECTION` or `SELECTION_COMPLETED` is not yet reached — if the order is already past selection, omit the field entirely from the dialog

## Scope

### In Scope

- `pos-record-payment-dialog.tsx`: add a `ToggleGroup` with three options (`Not Yet`, `In Progress`, `Selected`); wire selection value to a hidden input submitted with the form; block submit if no option chosen; show a validation message if the user attempts to submit without choosing
- Payment recording server action / service: accept the new `selectionStatus` input alongside existing payment fields; inside the transaction, apply the no-regression status update, then conditionally advance `OrderStatus` to `SELECTION_COMPLETED` if `COMPLETED` was chosen
- POS page: pass current `order.selectionStatus` and `order.status` to the dialog so it can decide whether to show the field and to enforce the no-regression guard on the server

### Out of Scope

- Selection tab on the order detail page — not modified
- Any other payment recording surface outside the POS dialog
- Changing the ToggleGroup options or labels beyond what is specified

## Implementation Direction

**Dialog.** In `pos-record-payment-dialog.tsx`, add the `ToggleGroup` below the payment method field and above the submit button. Three items: value `PENDING` / label `Not Yet`, value `IN_PROGRESS` / label `In Progress`, value `COMPLETED` / label `Selected`. Use a hidden `<input name="selectionStatus">` synced to the toggle value via `useState`. Treat an empty string as unset — show an inline validation message and prevent submit if the value is empty when the user attempts to submit. Only render this section when the order has not yet passed selection (check `orderStatus !== SELECTION_COMPLETED` and order is not in editing/production/delivery).

**Server action / service.** Extend the payment recording input schema to include `selectionStatus: z.enum([...ORDER_SELECTION_STATUS_VALUES])`. In the transaction, after writing the payment:

1. Read the current `order.selectionStatus` from the DB inside the transaction
2. Only write the new `selectionStatus` if it represents an advancement (PENDING → IN_PROGRESS → COMPLETED), never a regression
3. If the new status is `COMPLETED`, additionally update `Order.status` to `SELECTION_COMPLETED`

Follow the same guard pattern used in the existing selection workflow service functions in `order.service.ts`.

## Post-Implementation

- Update `context/progress-tracker.md` — Now section and Feature History

## Acceptance Criteria

- [ ] Payment dialog shows the three-option ToggleGroup when order is in `WAITING_SELECTION`
- [ ] No option is pre-selected — field starts empty
- [ ] Submit is blocked and a validation message appears if no option is chosen
- [ ] Choosing `Not Yet` records payment; `selectionStatus` only changes if current status is `PENDING` (no regression)
- [ ] Choosing `In Progress` records payment; `selectionStatus` advances to `IN_PROGRESS` if not already `COMPLETED`
- [ ] Choosing `Selected` records payment, `selectionStatus` → `COMPLETED`, `OrderStatus` → `SELECTION_COMPLETED`
- [ ] ToggleGroup is hidden when order has already passed selection stage
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
