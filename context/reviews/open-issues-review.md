# Open Issues Review
**Date:** 2026-05-07

---

## Bugs

### Selection Completed Resets Package Upgrade
**Issue:** Clicking "Save / Complete Selection" a second time reverts the order back to the base package. The flow is: select upgraded package → save (order updates correctly) → click save/complete again → order reverts to original package and financials reset to base amount.  
**Expected:** Completing selection should be idempotent; re-saving must not overwrite a previously set package upgrade.  
**File:** `src/components/orders/selection-workflow-form.tsx` — likely re-derives package from initial state rather than persisting the upgraded value.

### Two "Ready for Pickup" Buttons
**Issue:** The delivery tab renders two "Ready for Pickup" buttons simultaneously.  
**Fix:** Audit the delivery status action buttons — guard rendering so only the contextually valid action is shown at each status.

### Editing Queue Page — Slow Render
**Issue:** `/editing` (the editing queue page) sometimes takes a long time to render.  
**Expected:** Acceptable load time regardless of queue size.  
**Next step:** Profile whether the bottleneck is a slow DB query, missing pagination, or a heavy client-side render pass.

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

### Booking Form — Missing Time Picker
**Issue:** The new booking form has no time input — only a date. Bookings without a time are ambiguous for scheduling.  
**Fix:** Add a time picker (or datetime field) to the booking creation form so session time is captured upfront.  
**File:** Booking creation form component.

### Order Overview Tab — Replace Redundant Workflow Info with Deliverables
**Issue:** The order overview tab duplicates workflow progress that is already visible elsewhere. It does not surface deliverables.  
**Fix:** Remove the redundant workflow block; replace it with a deliverables section showing selected photo count, add-ons, albums, and canvases.

### Customer Lookup — Prioritize Phone Number
**Issue:** Customers are currently searched and referenced primarily by name. Phone numbers are not enforced as real/valid.  
**Fix:** Make phone number the primary lookup key. Enforce a valid phone number format on customer creation/edit so the field is reliable.

### Calendar Page — Needs Overhaul
**Issue:** The calendar page needs significant UX and functional improvement.  
**Status:** Requires a dedicated design pass before any implementation work begins.

### Editing Tab UX
**Issue:** General UX of the editing tab needs improvement.  
**Status:** Needs design review before spec.

### Delivery Page — Simplify Statuses
**Current statuses (5):** Not Ready → Ready for Pickup → Customer Notified → Picked Up → Completed  
**Question:** Are all 5 needed or can they be collapsed? Decision needed before any change.

---

## Design Decisions Needed

### Booking Cancellation — Pending vs. Confirmed Flow
**Question:** Should cancelling a pending booking and cancelling a confirmed booking follow the same flow, or trigger different behaviour (e.g., different notifications, refund rules, status transitions)?  
**Decision needed:** Define the cancellation rules for each booking state before implementing any cancel action.

### Delivery Tab — Clarify Button Intent
**Question:** The delivery tab currently shows "Prepare," "Ready for Pickup," and "Complete" actions. What is the intended distinction between each state?  
**Current confusion:** "Prepare" vs. "Ready for Pickup" overlap in meaning; "Pick Up" and "Complete" may also be redundant.  
**Decision needed:** Map out the intended delivery state machine (what each status means and who triggers it) before touching the UI.

### Frontend/Backend Separation Audit
**Question:** Do we have a consistent API/router layer, or is business logic leaking into page components?  
**Action:** Conduct a structural audit — confirm that all data mutations go through server actions or API routes, and that page/component files contain no direct DB calls.

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

