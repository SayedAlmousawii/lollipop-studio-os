# Open Issues Review
**Date:** 2026-05-07

---

## Bugs

### Selection Status Starts at 0
**Issue:** When entering the selection workflow, the selected photo count displays `0` initially, then updates to the correct number only after "Save Selection" is clicked.  
**Expected:** Should initialize with the package's default photo limit (`selectedPackage.photoCount ?? selection.includedPhotoCount`).  
**File:** `src/components/orders/selection-workflow-form.tsx`

---

## UX Improvements

### Estimated Collection Date — Default to 2 Weeks
**Issue:** When an editor is assigned, the estimated collection date field has no default — it's left blank.  
**Fix:** Auto-populate with `today + 14 days` unless manually changed.  
**File:** `src/components/orders/editing-workflow-form.tsx` — `estimatedEditingCompletionAt` field has no default value.

### Editing Tab UX
**Issue:** General UX of the editing tab needs improvement.  
**Status:** Needs design review before spec.

### Delivery Page — Simplify Statuses
**Current statuses (5):** Not Ready → Ready for Pickup → Customer Notified → Picked Up → Completed  
**Question:** Are all 5 needed or can they be collapsed? Decision needed before any change.

---

## Feature Gaps

### Package Deliverables Missing from Order Tab
**Issue:** Albums and canvases (add-ons) only appear in the Production tab summary (`order.addonsSummary`). They do not appear as a dedicated deliverables section in the order tab.  
**Fix:** Surface package add-ons in the order tab and ensure they are included in deliverables tracking.

### Increase Public IDs to 6 Digits
**Current:** 5 digits — e.g., `ORD-00001`, `BKG-00001`, `INV-PUB-00001`  
**Fix:** Increase to 6 digits for scalability.  
**File:** `src/modules/identifiers/identifier.service.ts`

---

## Design Decisions Needed

### Invoice Scope — What Should It Show?
**Question:** Should the invoice page include package info, deliverables, and order context — or only payment history, method, and type?  
**Current state:** Invoice page shows only payment records. Package/deliverable data lives on the order page.  
**Decision needed:** Keep them separated (recommended for clean module ownership) or add an order summary section to the invoice.

### Upgrade Payment — Where to Record?
**Question:** Should upgrade payments be recorded on the job/order page or the invoice page?  
**Current state:** Upgrade is a `PaymentType` option (`DEPOSIT | BASE | UPGRADE | ADDON | OTHER`) recorded on the invoice page via `RecordPaymentForm`. The order financials tab shows payment history but does not allow direct recording.  
**Recommendation:** Keep on invoice page. Surface the calculated upgrade amount clearly after selection is completed so staff knows what to collect.

---

## Answered: Invoice Locking

**When does an invoice get locked?**  
An invoice is locked when it is **closed** — staff clicks "Close Invoice" on the invoice detail page. This sets `status = CLOSED` and `isLocked = true` permanently.

**Locked invoice effects:**
- No new payments can be recorded
- No status recalculation
- No invoice re-issuance

**Files:** `src/modules/invoices/invoice.service.ts` (`closeInvoice`), `app/invoices/[id]/page.tsx`

**When should upgrade payment be collected?**  
No current rule enforces this. Upgrade amount is calculated during selection. It should be collected before or at invoice close — but this is a business policy decision, not enforced by the system today.

---

bookings/new bookings should include time/time pick

pending booking cancel vs confirmed??