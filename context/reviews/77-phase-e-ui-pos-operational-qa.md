# 77 Phase E - UI / POS Manual Operational QA

Date: 2026-05-15

Scope executed: Layer 6 UI / POS Manual Operational QA from `77-financial-architecture-verification-and-testing-master-plan.md`. This was a live browser walk-through on local dev with the admin Clerk account, using real UI actions and dev workflow fixtures.

## Test Scenario

- Signed in as `admin+clerk_test@lollipopstudioos.dev`.
- Reset workflow test data from the UI.
- Created a pending booking via the development quick action.
- Confirmed the booking by recording the 20 KD deposit.
- Checked in the booking and created job/order `JOB-NB-2026-00001`.
- Exercised POS selection, final invoice creation, partial payment, full payment, locked invoice edits, adjustment payment, refund, credit note, editing, production, and delivery.

## Checklist Results

### 9.1 Reception Staff - Booking Workflow

- Pass: Pending booking showed no BK reference. Detail page showed `BK reference: Pending`.
- Partial: Existing-customer booking was exercised through the dev quick action. New customer phone-first creation was not separately executed because the Phase E run focused on POS/financial operational flows and used seeded records.
- Pass: Recording 20 KD deposit generated `BK-NB-2026-00001`, showed a locked `DEP-00001`, changed booking status to Confirmed, and showed remaining session balance.
- Fail/UX: Attempting to record deposit below 20 KD did not show a visible validation error in the dialog. The dialog remained open at `19`, but staff received no clear field-level or global explanation.
- Pass: Confirmed booking made the deposit invoice read-only and displayed `Locked: Yes`.
- Not run in browser: Pending cancellation, confirmed cancellation, and no-show were not executed in this POS-focused pass.

### 9.2 Reception Staff - Check-In Workflow

- Pass: Check-in dialog required photographer plus explicit social media consent toggle before enabling submit.
- Pass: Submitting check-in generated `JOB-NB-2026-00001`, created an order in selection flow, and redirected directly to the Sales Workspace.
- Pass: The button was disabled until consent was toggled.
- Not directly repeated: Same-booking double check-in was not attempted after redirect. The original booking no longer presented a completed check-in path in normal navigation.

### 9.3 POS Workflow - Selection & Invoice

- Pass: POS showed package line, included photo count, selected photo input, billing mode choices, and extra-photo pricing.
- Fail/UX: Changing selected photos from 20 to 25 appeared to autosave on blur, but a reload reverted to 20 unless the billing mode was also interacted with. Staff could believe the selection was saved when it was not.
- Fail/UX: Clicking the Digital billing radio after setting 25 photos left Print selected. The UI did not clearly indicate whether the click failed, was ignored, or was waiting for blur/autosave.
- Pass: Adding a standalone add-on created/finalized `INV-00002` and recalculated totals. The settlement sidebar showed package, deposit deduction, extra photos, add-on, total, paid, and remaining.
- Pass: Partial payment left the invoice open/draft with remaining balance.
- Fail/Operational: The final invoice did not automatically close/lock after full payment. It showed `Draft`, `Fully Paid`, `isLocked=false` until the separate Invoices page action `Close Invoice` was used. This is a settlement bypass risk because staff can continue mutating the invoice after payment.
- Fail/Financial display: After the final invoice was fully paid and then edited before manual close, POS allowed adding another add-on directly into the same draft invoice, increasing `INV-00002` instead of creating an ADJUSTMENT.

### 9.4 POS Workflow - Adjustment & Upgrade

- Pass after manual close: Once `INV-00002` was manually closed from the invoice list, POS displayed a Locked badge and locked-invoice messaging.
- Pass: Adding a new add-on after lock created `ADJ-00003`; the adjustment appeared in the POS settlement panel as open with 45 KD due.
- Pass: Paying `ADJ-00003` closed it and POS showed `Paid adjustments (1)`.
- Fail/UX: The settlement panel simultaneously showed the locked final invoice as overpaid (`Paid 255.000 KD of 230.000 KD`) and still labeled the page "Fully Paid" without surfacing credit/refund consequences in POS.
- Partial/not fully executed: Package upgrade/downgrade flows were visually present (`Upgrade Package`) but not fully executed because the available package-item upgrade/replace controls were disabled for the seeded package line. Commission creation remains unverified in browser.
- Pass/guard with poor UX: Attempting to remove a locked add-on without manager credit-note context was rejected server-side with "Manager confirmation is required before issuing a credit note", but the UI only showed "Unable to remove order add-on" near the row. It did not present the manager approval/credit-note prompt required by the checklist.

### 9.5 POS Workflow - Credit Notes & Refunds

- Pass: Manager/admin issued a 45 KD refund from the invoice detail. It created `REF-00004`, locked it, and payment history showed `PAY-00006` with direction `OUT`.
- Pass: Manager/admin issued a 50 KD credit note from the invoice detail. It created locked `CN-00005`.
- Fail/UX and capacity risk: The refund amount defaulted to 210 KD while the visible overpayment was 45 KD. This directly supports the Phase C refund-capacity risk and can lead managers to over-refund.
- Fail/UX: The credit note and refund actions exist on the invoice detail page, not in the POS settlement flow. POS did not clearly show `CN-00005` or `REF-00004` after issuance.
- Not run: Non-manager credit-note/refund browser attempts were not executed because only the admin Clerk session was available during the manual run. Prior Phase D service regression covers receptionist denial, but Layer 6 browser UX remains unverified.

### 9.6 Editing Workflow

- Pass: After full payment and manual invoice closure, assigning and starting editing worked from the order detail.
- Pass: Completing editing and approving moved editing to Approved/Completed states and enabled send-to-production.
- Not run in browser: Editing-start block with an open Final Invoice was not separately exercised in this Phase E run.
- UX friction: After clicking Assign, every editing action button displayed "Saving..." until reload. The server action completed, but the visible state looked hung.

### 9.7 Production & Delivery Workflow

- Pass/guard: Attempting to mark production ready while editing was still In progress was blocked by the server with a clear inline message.
- Fail/UX bypass surface: The Production tab displayed two "Ready for pickup" buttons. One was disabled, but another remained enabled even when editing was incomplete. The enabled button did not bypass the server, but it invites misuse and creates noisy failed attempts.
- Fail/workflow bypass: After editing approval, production could be marked Ready for pickup while album design, printing, assembly, vendor, and framed-print sections were still Not started. The page even warned that section checks were still open, but the status changed to Ready for pickup and delivery became available.
- Pass: Notify and pickup moved the order to Delivered/Completed and attributed completion to Admin.
- Fail/risk: Delivery was allowed after production was marked ready despite open production section checks. This violates the operational invariant that delivery should wait until required production jobs are complete.

### 9.8 Reports & Financial View

- Pass: Invoice list showed `DEP-00001`, `INV-00002`, `ADJ-00003`, `REF-00004`, and `CN-00005` with expected prefixes.
- Pass: Invoice detail showed payment history with payment direction and method, including refund `OUT`.
- Partial: Order activity exposed financial actions chronologically, but a first-class AuditLog view still does not exist.
- Fail/UX: Order header financials after credit/refund remained confusing: it showed `Paid 255.000 KD of 230.000 KD` and activity reported refund available by 95 KD after a 45 KD refund plus 50 KD credit note. POS did not reconcile this into an obvious "customer credit/refund remaining" state.

## Manual QA Findings

1. Full final payment does not automatically close and lock the Final Invoice in POS. Staff must leave POS and manually close from the Invoices page.
2. POS allows additional invoice mutation after full payment while the invoice remains Draft.
3. Locked-invoice addition correctly creates an ADJUSTMENT only after manual invoice closure.
4. Adjustment payment closes the adjustment and is visible as paid in the settlement panel.
5. Refund invoice and OUT payment are operationally created, but refund amount defaults are unsafe.
6. Credit-note issuance works from invoice detail, but POS does not surface the resulting document clearly.
7. Production readiness can be set with required production sections still incomplete.
8. Delivery can complete after that premature production-ready state.

## UX Confusion Findings

- "Draft" plus "Fully Paid" is confusing and operationally dangerous. Staff expect full payment to mean locked/settled.
- Deposit amount validation below 20 KD fails silently from a staff perspective.
- Extra photo autosave is ambiguous and can lose changes on reload.
- Billing mode radio behavior appears unresponsive.
- Locked invoice messaging says additions issue adjustments, but the same panel says "future adjustment flow", which undercuts confidence because adjustment creation actually works.
- Credit-note required paths are not presented as guided manager workflows. Failed removal only says unable to remove.
- POS financial summary does not reconcile final invoice overpayment, paid adjustments, credit notes, and refunds into one staff-readable settlement state.
- Duplicate production "Ready for pickup" buttons create an avoidable misuse path.
- Editing assignment leaves buttons stuck on "Saving..." until reload.

## Operational Workflow Risks

- Reception can take under-minimum deposit attempts without seeing why the action failed.
- Sales staff can treat a fully paid Draft invoice as settled while it remains mutable.
- Staff can accidentally alter a paid invoice before manual close, bypassing the intended locked-adjustment model.
- Managers can issue refunds above the visible overpayment because refund capacity/defaults are not aligned with POS-visible credit.
- Production staff can mark orders ready without completing production sections.
- Delivery staff can complete orders whose production sub-work has not actually been completed.
- Non-manager browser UX for credit-note/refund denial is still unverified.

## Suggested UX Improvements

- In POS, auto-close and lock the Final Invoice when remaining reaches 0.000 KD, or present a mandatory "Settle and lock invoice" step before staff can continue.
- Replace silent deposit validation with inline text: "Deposit must be at least 20.000 KD."
- Add explicit save state for selected photo count: "Saved", "Saving", "Not saved", and block navigation/reload while dirty.
- Make locked-edit additions open a clear confirmation sheet: "This will create ADJ-xxxxx for X KD."
- For reductions/removals on locked invoices, open a manager approval plus credit-note dialog instead of attempting and failing.
- Add a POS settlement ledger showing Final, Adjustments, Credit Notes, Refunds, Customer Credit, and Net Outstanding as separate rows.
- Default refund amount to visible overpayment/refundable credit only, not raw inbound payment capacity.
- Remove duplicate production readiness buttons and disable all production-ready actions until required sections are complete.
- Add section-completion prerequisites directly beside the readiness button.

## Suggested Workflow Simplifications

- Collapse Final Invoice creation, final payment, and close/lock into a single POS settlement workflow.
- Keep credit notes/refunds accessible from POS when POS is where the staff discovers the issue.
- Use one manager flow for every reductive locked-invoice action: reason, manager confirmation, credit note preview, submit.
- Make production readiness a checklist gate rather than a separate global button.
- Put "customer credit/refund remaining" in the order header and POS sidebar whenever overpayment or credit notes exist.

