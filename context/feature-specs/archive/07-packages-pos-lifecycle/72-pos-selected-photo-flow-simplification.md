# Feature 72 - POS Selected Photo Flow Simplification

## Goal

Simplify the POS Selected Photos card so staff edits one meaningful count per package line instead of manually keeping three numbers in sync. The selected photo count remains the only source-of-truth quantity, extra photos are derived from the package limit overage, and staff allocates that derived count as Digital, Print, or Split without using a separate Update button. This is a reversible UI simplification trial, not a backend capability removal: the data model must continue supporting package lines that carry both digital and print extras together.

## Read First

- `context/feature-specs/69-session-type-extra-photo-pricing.md`
- `context/feature-specs/70e-stabilization-specs-67-70d.md`
- `context/feature-specs/71-70e-closure-cleanup.md`
- `context/reviews/legacy-edit-selection-vs-pos-audit.md`
- `src/components/orders/pos-package-composition.tsx`
- `app/orders/[orderId]/sales/actions.ts`
- `src/modules/orders/order.schema.ts`
- `src/modules/orders/order.service.ts`
- `src/modules/orders/order.types.ts`

## Rules

- Keep POS as the only writable surface for selected photos and extra-photo billing decisions.
- Do not change database schema for this unit.
- Do not remove backend or persistence support for package lines that contain both digital and print extras.
- Do not change extra-photo pricing rules, invoice math, commission logic, or add-on behavior.
- Preserve invoice lock behavior: locked invoices still block photo-selection changes.
- Preserve package-line financial storage shape unless a small service-layer cleanup is required; this unit is about interaction simplification, not a data-model rewrite.
- Do not reintroduce a separate manual "extra photo count" concept that competes with selected photo count.
- POS may expose mixed digital+print extras only as an allocation of the derived extra count, never as independent manual totals.
- If a package line currently contains both digital and print extras at the same time, handle that state explicitly instead of silently losing information.

## Scope

### In Scope

- Replace the current three-input Selected Photos line editor with a simplified interaction model.
- Make selected photo count the only numeric quantity the user edits directly for each package line.
- Derive extra-photo quantity from `selectedPhotoCount - includedPhotoCount`, clamped at zero.
- Add a package-line billing mode that allocates derived extras as Digital, Print, or Split.
- Remove the explicit Update button and save changes automatically after the user commits an edit.
- Refresh POS totals and invoice preview automatically after a successful save.
- Define how existing mixed digital+print extra states should appear in the new UI without removing backend support for them.

### Out of Scope

- Database migrations or retirement of `extraDigitalCount` / `extraPrintCount` fields.
- New pricing concepts, blended extra-photo pricing, or per-photo mixed media selection.
- Reworking package upgrade, add-on, payment, editing, production, or delivery flows.
- Broad POS layout redesign outside the Selected Photos card.

## Implementation Direction

Desired behavior per package line in this trial UI:

- Staff edits `Selected` as the single numeric field.
- The UI derives `extraCount = max(selected - included, 0)` locally.
- When `extraCount` is `0`, the line stores zero digital extras and zero print extras.
- When `extraCount` is greater than `0`, staff chooses a billing mode for that line: `Digital`, `Print`, or `Split`.
- The chosen mode determines how the persisted counts are allocated:
  - `Digital` => `extraDigitalCount = extraCount`, `extraPrintCount = 0`
  - `Print` => `extraPrintCount = extraCount`, `extraDigitalCount = 0`
  - `Split` => staff enters digital and print allocation counts, and the UI validates `extraDigitalCount + extraPrintCount = extraCount` before save

Use the current POS package-line model and financial sync flow as the behavioral baseline. The service already recalculates invoice impact from digital and print counts, so the main change should be to the input contract and UI interaction rather than invoice math. Keep the underlying service/data contract capable of accepting mixed digital+print counts because the new editor should support them through derived allocation rather than independent manual totals.

Read `POSPhotoCountCard` / `POSPhotoLineForm` in `src/components/orders/pos-package-composition.tsx` first. That component currently exposes three manual numeric fields plus an Update button. Replace that with a derived-count UI that clearly shows:

- included photo count
- selected photo count input
- derived extra count
- billing mode choice when extras exist
- split allocation inputs only when Split mode is selected
- live line summary for pricing impact

Read `updateOrderSelectedPhotoCountAction` and `updateOrderSelectedPhotoCountSchema` next. The implementation may continue to submit `extraDigitalCount` and `extraPrintCount` to the service, but those values should now be derived from selected-photo allocation state instead of being treated as three unrelated manual fields. If a smaller server-action/service contract is cleaner, keep the change scoped to this flow only and preserve existing service-layer financial recalculation behavior.

Remove the explicit submit button from this card. Prefer automatic save on committed user changes rather than on every keystroke. A good fit for this unit is:

- save on number-input commit such as blur or stepper completion
- save on radio change
- show a lightweight saving state and inline error state
- avoid duplicate rapid submissions for the same unchanged payload

Allocation validation needs to be explicit:

- Split allocations must equal the derived extra count before saving.
- Extra counts are never treated as independent from selected photo count.
- If selected photo count changes, preserve the current allocation when possible.
- If the new derived extra count makes the current split invalid, require staff to adjust the split before saving instead of silently guessing.

Existing mixed extra states need an explicit rule. Follow the smallest safe behavior that does not silently rewrite data on initial render and does not remove backend support for those states. Acceptable approaches:

- map the persisted counts naturally into Split mode when `extraDigitalCount + extraPrintCount` already equals the derived extra count, or
- preserve the existing persisted split until the user edits the line, then require the line to satisfy the derived allocation rules on save

Do not silently rewrite persisted counts on load. This trial should make it easy to evolve the UI later without reopening the backend model.

Ensure downstream consumers remain consistent:

- POS financial totals should continue updating from persisted digital/print counts.
- Order-level selected photo aggregates should still sync from package lines.
- Editing workflow target photo count should still reflect package-line selected totals.

## Post-Implementation

- Update `context/progress-tracker.md` with the implementation status, files changed, and verification commands.
- Update `context/reviews/legacy-edit-selection-vs-pos-audit.md` only if this unit changes the documented POS coverage story.
- If mixed legacy digital+print extras require deferral instead of implementation, document that decision in the relevant review or follow-up spec before closing the unit.

## Acceptance Criteria

- [ ] Each POS package line exposes one editable selected photo count field as the source-of-truth quantity instead of three independent photo-count inputs.
- [ ] Extra-photo quantity is derived from selected photos above the package included count and is never edited as a separate manual number.
- [ ] When derived extras exist, the UI provides Digital, Print, and Split billing modes for that package line.
- [ ] Split mode only allows digital/print allocations whose sum equals the derived extra count.
- [ ] Saving a package-line photo-selection change persists digital/print counts that match the selected derived allocation.
- [ ] When selected photos equal the package included count, both persisted extra counts become zero.
- [ ] The Selected Photos card no longer shows an explicit Update button.
- [ ] The line saves automatically after committed changes and shows saving/error feedback without requiring a manual submit click.
- [ ] POS financial summary and invoice preview update correctly after selected-photo or extra-type changes.
- [ ] Locked invoices still block selected-photo changes.
- [ ] Existing mixed digital+print extra data maps naturally into Split mode when its stored allocation matches the derived extra count and is not silently rewritten on initial render.
- [ ] Backend and persistence support for mixed digital+print extras remains intact.
- [ ] Editing workflow target photo count still matches the aggregated package-line selected photo total after this change.
- [ ] `npm run build` passes.
- [ ] `npm run lint` passes.
