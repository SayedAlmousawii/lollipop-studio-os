# Feature 71 - 70e Closure Cleanup

## Goal

Close the remaining 70e follow-up findings by removing retired-but-dangerous order write paths and correcting first-line-only read models that can mislead staff on multi-package orders. This is a small stabilization unit after 70e: make the POS-canonical architecture obvious in code, and make read-only order/POS displays line-aware.

## Read First

- `context/feature-specs/70e-stabilization-specs-67-70d.md`
- `context/reviews/legacy-edit-selection-vs-pos-audit.md`
- `context/reviews/specs-67-70d-implementation-review.md`
- `src/modules/orders/order.service.ts`
- `src/modules/orders/order.schema.ts`
- `src/modules/orders/order.types.ts`
- `app/orders/[orderId]/page.tsx`
- `src/components/orders/pos-package-composition.tsx`
- `src/components/orders/pos-financial-sidebar.tsx`

## Rules

- Keep this as a cleanup and correctness unit; do not add new order workflows.
- POS remains the only writable order selection and financial workspace.
- Do not reintroduce a writable order edit page or writable selection workflow tab.
- Remove retired single-package write paths instead of preserving them with stronger comments.
- Do not modify database schema or backend persistence behavior unless explicitly approved.
- Do not change invoice math, package pricing, commission logic, or payment behavior in this unit.
- Read-only displays must not present first package-line data as if it represents the whole order.
- If an apparently dead field is still consumed by a UI component, switch the consumer to per-line data or remove the display; do not preserve misleading order-level summaries.

## Scope

### In Scope

- Delete the retired order service write/read functions that can mutate or model orders through old single-package assumptions.
- Delete unused Zod schemas and exported types that only exist for the retired order edit or selection workflow write paths.
- Fix the read-only Selection tab so multi-package orders are represented accurately.
- Audit POS workspace top-level first-line package scalars and remove or replace consumers.
- Keep existing 70e invariant tests passing.
- Add focused coverage only if the cleanup leaves a meaningful regression risk that existing tests do not cover.

### Out of Scope

- New POS capabilities.
- Rebuilding the Selection tab as a second editor.
- Reopening the legacy order edit page.
- Database schema cleanup for `Order.addOns Json`.
- New package catalog, package override, refund, credit, or commission persistence features.
- Broad order hub redesign.
- Changes to booking confirmation, check-in, production, or delivery lifecycle behavior.

## Implementation Direction

Suggested execution order: complete 71.3, then 71.2, then 71.1. This confirms POS consumers and the Selection tab read model before deleting retired service entry points and their schemas.

### 71.1 - Delete Retired Single-Package Write Paths

Desired behavior: the old order edit and selection workflow write surfaces should no longer have service-layer entry points that future work can accidentally call. The codebase should make the intended architecture clear: package changes, selected photos, extras, add-ons, invoice preview, and final payment are handled through POS.

Read the retired service flow around `updateOrder`, `updateOrderSelectionWorkflow`, `getEditableOrderById`, and their helper/guard code. Confirm there are no active call sites in `app/` or `src/components/` before deleting them. Remove the associated schemas and TypeScript exports from `order.schema.ts` when they only support those retired paths.

Do not replace these functions with wrappers or deprecation comments. The goal is absence, because a future agent or developer should not discover them as plausible order mutation APIs.

### 71.2 - Fix Read-Only Selection Tab Representation

Desired behavior: the order detail Selection tab may remain read-only, but it must not show the first package line as the whole order. For multi-package orders, staff should see either a line-aware package summary or a compact aggregate summary with a clear POS navigation path.

Read the current `getOrderSelectionWorkflowById` read model and the Selection tab rendering in `app/orders/[orderId]/page.tsx`. Prefer the smallest UI that is accurate and consistent with POS canonicalization. A per-package read-only summary is acceptable. A compact summary table plus POS CTA is also acceptable if it avoids pretending that one package is the entire order.

Do not introduce write controls. Any package, selected-photo, extra-photo, or add-on changes must route staff to POS.

### 71.3 - Audit POS Top-Level First-Line Package Scalars

Desired behavior: POS workspace data should not expose or consume top-level package fields that are actually copied from `packageLines[0]` and therefore wrong for mixed package orders.

Audit reads of top-level `workspace.originalPackage`, `workspace.currentPackage`, and `workspace.bundleAdjustment` or equivalent first-line scalars. If they are unused, remove them from the service return type and types. If they are used, change the UI to read per-line data from each POS package line, or replace the display with an accurate aggregate.

Keep line-specific fields on `POSPackageLine`; this unit is about removing misleading order-level shortcuts, not reducing per-line detail.

## Post-Implementation

- Update `context/progress-tracker.md` with Feature 71 files changed, verification commands, and decisions made.
- Update the relevant review document to mark the 70e closure findings as fixed, deferred, or intentionally out of scope.
- If any retired function or schema cannot be deleted because an active consumer remains, document the consumer and split that work into the smallest follow-up before completing Feature 71.

## Acceptance Criteria

- [ ] `updateOrder`, `updateOrderSelectionWorkflow`, and `getEditableOrderById` no longer exist as callable service exports.
- [ ] The guard/helper code used only by the retired selection workflow write path is deleted.
- [ ] `updateOrderSchema`, `updateOrderSelectionWorkflowSchema`, and related retired input types are deleted if they have no active consumers.
- [ ] No active server action or UI component imports the retired order edit or selection workflow write schemas/types.
- [ ] The read-only Selection tab no longer displays first package-line package name, included count, selected-photo count, extra-photo count, or package items as if they describe the whole order.
- [ ] Multi-package orders have an accurate read-only Selection tab representation or an intentionally aggregate summary with POS navigation.
- [ ] POS workspace no longer exposes unused top-level first-line `originalPackage`, `currentPackage`, or `bundleAdjustment` fields.
- [ ] Any remaining POS display of package choice, package price, or bundle adjustment is line-aware.
- [ ] Existing backend invariant tests still pass.
- [ ] `npm run build` passes.
- [ ] `npm run lint` passes.
