# 77 Operational Risk Analysis

## How to update this document

Append operational findings as manual and automated verification phases complete. Add each finding under the matching risk area, include whether it was observed, reproduced, or still pending verification, and retain `TBD - to be filled during Phase A/B/C/etc.` for sections that have not been assessed yet.

## A. Employee Misuse Risks

### Receptionist voiding a deposit invoice

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase E: Deposit invoice UX correctly showed `DEP-00001` as paid and locked on the booking detail, and no void control was visible in the tested admin flow. Browser role-specific receptionist void/permission UX was not separately exercised.

### Non-manager approving their own credit note

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase B: INT-10 verifies reductive locked-final edits require manager approval and roll back without it. INT-11 verifies credit-note issuance through a manager actor. Role-negative coverage for non-manager approval remains Layer 8 permission testing scope.
- 2026-05-15 Phase C: EC-18/EC-19 show manager refund actions can exceed true overpayment if the service only checks inbound allocation capacity. Operationally, staff need a visible overpayment cap until the service is corrected.
- 2026-05-15 Phase D: REG-76-01 verifies a receptionist user cannot issue a CREDIT_NOTE through the service and the rejected attempt leaves no CREDIT_NOTE record.
- 2026-05-15 Phase E: Locked add-on removal without manager approval was blocked server-side, but the POS UI did not show the required manager approval or credit-note prompt. It only displayed "Unable to remove order add-on", which leaves staff without a compliant next step.

### Photographer viewing financial data through a known URL

TBD - to be filled during Phase A/B/C/etc.

## B. UX Confusion Risks

### Overpayment flag clarity in POS

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase B: Service-level INT-11 verifies credit note issuance creates an overpayment/refund-available activity after a fully paid FINAL. UI clarity for the POS flag remains Layer 6 manual QA scope.
- 2026-05-15 Phase D: REG-76-01 verifies invoice detail reports `isOverpaid=true` and `overpaidAmount=50.000 KD` after a manager CREDIT_NOTE on a fully paid FINAL. Browser/UI clarity remains Layer 6.
- 2026-05-15 Phase E: POS did not clearly reconcile overpayment, paid adjustments, credit notes, and refunds. Invoice detail showed a 45.000 KD overpayment but defaulted refund amount to 210.000 KD; after issuing a 45.000 KD refund and 50.000 KD credit note, order activity reported refund available by 95.000 KD while the order header still showed `Paid 255.000 KD of 230.000 KD`.

### Mixed ADJUSTMENT and CREDIT_NOTE communication in one save

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase B: The Layer 3 matrix covers additive ADJUSTMENT and reductive CREDIT_NOTE paths separately. Mixed edit communication remains Layer 4 edge-case scope.
- 2026-05-15 Phase C: E4 verifies mixed classifier output. E11 exposes the more dangerous communication gap: removing the cause of a paid ADJUSTMENT gives no credit/refund prompt today.
- 2026-05-15 Phase D: REG-76-03 verifies a mixed edit creates one CREDIT_NOTE and one ADJUSTMENT with paired metadata entries, so operational history can connect the two documents.
- 2026-05-15 Phase E: Additive locked-invoice edits clearly created an ADJUSTMENT in POS, but reductive locked-invoice edits failed instead of opening the manager credit-note workflow. Mixed communication remains confusing at the UI layer.

### Locked invoice badge clarity

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase E: Locked badges appeared on the invoice list and POS settlement panel only after manually closing the Final Invoice. Before manual close, the POS showed "Fully Paid" but the invoice remained Draft/unlocked and mutable, which is likely to mislead staff.

## C. Workflow Bypass Risks

### Editing starting without full payment via direct API call

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: CI now includes INV-28 using the practical schema proxy `EditingJob.status != NOT_STARTED` and requires the order's primary FINAL invoice to be `CLOSED`. The exact spec wording `status != null` cannot be represented because `EditingJob.status` is non-null with a default.
- 2026-05-15 Phase B: INT-07 verifies a fully paid, locked FINAL invoice makes editing start possible through the service. INT-15 verifies production readiness is blocked when editing is incomplete. Negative direct editing-start with open FINAL remains covered by Phase A invariant shape, not expanded into a separate Layer 8 permission/security test.
- 2026-05-15 Phase D: REG-LEGACY-01 characterizes a bypass risk in the read/workflow readiness layer: when canonical Final Invoice `remainingAmount` is `20.000 KD`, editing readiness can still show no outstanding balance because Deposit paid amount is subtracted again. This should become a failure-expecting regression after the legacy path is fixed.
- 2026-05-15 Phase E: Editing assignment/start worked after full payment and manual invoice close. Open-Final negative browser testing was not separately executed in this run.

### Delivery marked complete without pickup recorded via direct API

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase B: INT-15 verifies delivery completion goes through `markPickedUp`, stamps `deliveryCompletedById`, sets `deliveryStatus=COMPLETED`, records `Order completed`, and blocks open-payment and production-not-ready attempts.
- 2026-05-15 Phase E: Pickup completion in browser stamped completion to Admin and disabled delivery actions after completion. However, delivery became available after production was marked ready even though production section checks were still open.

### Production ready before required production work is complete

- 2026-05-15 Phase E: Observed in browser. After editing approval, production could be marked Ready for pickup while Album Design, Printing, Album Assembly, Vendor, and Framed Prints were still Not started. The UI warned that section checks were open but still changed the order to Ready and unlocked delivery. This is a direct workflow bypass risk.

### Package upgrade bypassing commission creation

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase B: INT-13 verifies package upgrades create only the delta ADJUSTMENT and preserve the locked FINAL. Commission persistence is still a hook-only area (`syncUpgradeCommissionForOrder`) and requires later commission-specific verification.
- 2026-05-15 Phase C: EC-32/EC-33 confirm commission persistence is still absent; package upgrade workflows cannot yet prove photographer commission records.

## D. Reconciliation Risks

### Nightly reconciliation failure behavior when environment variables are missing

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: Not tested in this phase. Existing nightly workflow still performs explicit environment verification before running reconciliation.

### Maximum data loss window before next reconciliation run

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: Not changed. CI now catches invariant regressions before merge, but production reconciliation cadence remains the existing nightly schedule.
- 2026-05-15 Phase C: EC-36 verifies missing DEPOSIT-to-FINAL `DocumentApplication` rows are detected by invariants and not auto-repaired. The production data-loss window remains the interval before CI/reconciliation runs.
- 2026-05-15 Phase D: Regression coverage is CI-facing only. Production data-loss window remains unchanged until Layer 10 reconciliation runner work is completed.

## E. Production Failure Scenarios

### Slack webhook outage behavior

TBD - to be filled during Phase A/B/C/etc.

### Read-only replica outage behavior

TBD - to be filled during Phase A/B/C/etc.

### `identifier_sequences` collision handling

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase C: EC-42 verifies self-healing when the sequence row falls behind existing booking references. True concurrent sequence races remain Layer 7 scope.
