## Goal

Fix three concrete bugs in the selection and delivery tabs, including simplifying the redundant delivery handoff actions uncovered during the bug pass.

---

## Rules

- No schema changes
- No new UI components
- Changes are isolated to the files listed per bug

---

## Bug 1 — Selection Count Displays 0 on First Load

**Location:** `src/modules/orders/order.service.ts` — `mapOrderSelectionWorkflow`

**Root cause:** `selectedPhotos` is derived as `order.selectedPhotoCount ?? includedPhotoCount` (using `??` which does not catch `0`). Orders are created with `selectedPhotoCount = 0`, so the display shows `0` until the first explicit save sets the correct count.

**Fix:** In `mapOrderSelectionWorkflow`, when computing `selectedPhotos`, treat `0` as not-yet-set:

```ts
const selectedPhotos = order.selectedPhotoCount || includedPhotoCount;
```

Verify this does not break cases where a user genuinely selects 0 photos (if that is a valid state, use a null check instead and ensure orders are initialized with `selectedPhotoCount = null`).

---

## Bug 2 — Re-Saving After Selection Complete Reverts Package Upgrade

**Location:** `src/modules/orders/order.service.ts` — `updateOrderSelectionWorkflow`; `src/components/orders/selection-workflow-form.tsx`

**Symptom:** Selecting an upgraded package → save → order updates correctly → clicking "Save Selection" again → order reverts to original package and financials reset to base amount.

**Likely cause:** `syncOrderInvoiceForFinancialEdit` reads `previousPackagePrice` from `order.finalPackage?.price ?? order.originalPackage?.price` inside a transaction. If the first `updateOrder` call does not flush before `syncOrderInvoiceForFinancialEdit` reads back, `finalPackage` may still reflect the pre-upgrade package. Alternatively, the form state may be submitting a stale `finalPackageId` on the second save.

**Diagnosis steps before fixing:**
1. Reproduce the bug — select an upgrade, save, then click "Save Selection" again
2. Add a server-side log to `updateOrderSelectionWorkflow`: log `data.finalPackageId` on entry and `order.finalPackageId` fetched inside the transaction — confirm whether the form is submitting the correct upgraded package ID on the second save
3. Log `previousPackagePrice` vs the newly selected package's price inside `syncOrderInvoiceForFinancialEdit` to confirm whether the invoice recalculation is using the correct base

**Fix direction:**
- If the form is sending the wrong `finalPackageId`: trace the `useState(selection.finalPackageId)` initialization — after revalidation the component re-mounts and `selection.finalPackageId` should reflect the server state; ensure `selection.finalPackageId` is correctly returned by `getOrderSelectionWorkflowById` after update
- If `syncOrderInvoiceForFinancialEdit` is using stale `previousPackagePrice`: re-read `order.finalPackage` inside the same transaction after the `order.update` call rather than before

---

## Bug 3 — Delivery Had Redundant Pickup Actions

**Location:**
- `src/components/orders/production-workflow-form.tsx` — "Ready for pickup" button controlled by `production.canMarkReadyForPickup`
- `src/components/orders/delivery-workflow-form.tsx` — delivery action buttons
- `src/modules/orders/order.service.ts` — delivery workflow mapping and update logic
- `src/modules/orders/order.schema.ts` / `src/modules/orders/order.types.ts` — delivery action contract

**Symptom:** Delivery exposed a separate "Prepare" action even though production already owns `READY_FOR_PICKUP`, and a separate "Complete" action even though `Picked up` is the meaningful terminal event.

**Fix:** Remove the redundant delivery-side `Prepare` and `Complete` actions. Production remains the source of truth for `READY_FOR_PICKUP`, delivery keeps `Notify`, and `Picked up` now records pickup and completes the order in one guarded action.

---

## Post-Implementation

**`context/progress-tracker.md`**
- Update Now section: Feature 55a complete; next is 55b
- Add to Feature History: "Feature 55a: Fixed selection count init (0 display), selection idempotency regression, and removed redundant delivery prepare/complete actions."

---

## Acceptance Criteria

1. Opening the selection tab on a new order shows the correct photo count (not 0)
2. Clicking "Save Selection" after selecting an upgraded package, then clicking it again, does not revert the package or financials
3. The delivery tab no longer shows a separate "Prepare" or "Complete" action
4. Recording `Picked up` also completes the order, while preserving the same completion/payment override guards
5. TypeScript passes
6. `npm run build` passes
7. `npm run lint` passes
8. Update `context/progress-tracker.md`
