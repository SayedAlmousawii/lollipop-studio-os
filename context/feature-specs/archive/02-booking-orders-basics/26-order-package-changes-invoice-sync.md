## Goal

Make financially meaningful order edits update the invoice/payment layer correctly so order data and balance-due data cannot drift apart.

---

## Read First

- `agents.md`
- `context/feature-specs/18-add-edit-order-page.md`
- `context/feature-specs/22-booking-model-and-flow-alignment.md`
- `context/feature-specs/24-public-ids-and-job-number.md`

---

## Rules

- Keep this unit focused on financial sync caused by order package and add-on changes
- Do NOT build the tabbed order hub UI in this unit
- Do NOT redesign payment recording flows outside what is required for correct recalculation
- Preserve payment history; never overwrite historical payments
- Invoice/payment modules remain the financial source of truth
- All sensitive changes must be traceable for future audit/activity work

---

## Scope

### In Scope

- Align order package edits with invoice adjustment logic
- Align order add-on edits with invoice adjustment logic
- Recalculate invoice totals and balance due after qualifying order edits
- Preserve previously recorded payments while updating invoice math
- Update the order edit flow to show the financial consequence of the change
- Add a clear create/open invoice path if the current order page still blocks that workflow

### Out of Scope

- Full order activity timeline implementation
- Workflow sub-status schema changes
- Editing, production, or delivery workflow controls
- Commission payout workflows beyond keeping upgrade math compatible
- Full invoice editing UI redesign inside the order page

---

## Business Rules

### 1. Package Change Behavior

When the final package changes:

- keep `originalPackage` unchanged
- replace `finalPackage`
- calculate the adjustment from the financially relevant package baseline
- sync the invoice adjustment lines
- update invoice total and balance due

### 2. Upgrade / Downgrade Math

Upgrade math must be based on the difference between:

- the package already financially recognized for the order
- the final package after edit

Do not assume the correct baseline is always the originally selected package price shown in UI.

### 3. Add-on Change Behavior

When add-ons are added, removed, or edited:

- recalculate the add-on total
- sync invoice adjustment lines
- update invoice total and balance due

### 4. Upgrade Finalization + Commission Hook

When a package upgrade is finalized and produces a real upgrade difference:

- complete the invoice adjustment sync
- trigger the commission-creation/update hook for the upgrade difference
- keep the commission calculation responsibility outside the UI

Even if the Commission module is still incomplete, this unit must define and call the service-layer hook so the upgrade workflow does not bypass invariant-required downstream behavior.

### 5. Payment Preservation

- Existing payments remain append-only history
- Paid amount must not be reset or overwritten
- Invoice status should be recalculated from updated totals and existing payments

### 6. Missing Invoice Handling

If an order can exist without an invoice after earlier lifecycle units:

- provide a safe path to create or attach the invoice record needed for adjustment tracking

---

## Service Layer

Primary ownership remains in service-layer code:

- orders module owns order field changes
- invoice module owns invoice adjustments, totals, and balance recomputation
- payment module remains the source of truth for recorded money movement

Expected service behavior:

- validate package/add-on edits
- calculate financial delta once in service code
- sync invoice adjustments transactionally with the order update
- call the commission hook when an upgrade difference is finalized
- return updated order + invoice summary for UI feedback

Use a transaction for multi-step order + invoice adjustment updates.

---

## UI Requirements

### Edit Order Page

Keep the existing edit order flow, but add read-only financial consequence messaging such as:

- package upgraded/downgraded
- adjustment amount
- updated invoice balance

### Order Details Page

If invoice access is missing or blocked:

- provide a usable action to create the needed invoice context
- or route staff clearly to the existing invoice record

Do not turn the order page into a full invoice editor.

---

## Acceptance Criteria

- Changing final package updates the invoice adjustment layer correctly
- Changing add-ons updates the invoice adjustment layer correctly
- Invoice total and balance due stay in sync with the order
- Existing payments remain intact
- Upgrade math uses the financially correct baseline
- Order UI shows the financial consequence of the change
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes
- Update `context/progress-tracker.md`

---

## Assumptions

- A simple adjustment-line approach is acceptable for V1 as long as invoice history remains understandable
- If the existing invoice model already has a suitable adjustment structure, reuse it instead of inventing a second pricing ledger
