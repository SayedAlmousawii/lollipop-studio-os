# 77 Operational Risk Analysis

## How to update this document

Append operational findings as manual and automated verification phases complete. Add each finding under the matching risk area, include whether it was observed, reproduced, or still pending verification, and retain `TBD - to be filled during Phase A/B/C/etc.` for sections that have not been assessed yet.

## A. Employee Misuse Risks

### Receptionist voiding a deposit invoice

TBD - to be filled during Phase A/B/C/etc.

### Non-manager approving their own credit note

TBD - to be filled during Phase A/B/C/etc.

### Photographer viewing financial data through a known URL

TBD - to be filled during Phase A/B/C/etc.

## B. UX Confusion Risks

### Overpayment flag clarity in POS

TBD - to be filled during Phase A/B/C/etc.

### Mixed ADJUSTMENT and CREDIT_NOTE communication in one save

TBD - to be filled during Phase A/B/C/etc.

### Locked invoice badge clarity

TBD - to be filled during Phase A/B/C/etc.

## C. Workflow Bypass Risks

### Editing starting without full payment via direct API call

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: CI now includes INV-28 using the practical schema proxy `EditingJob.status != NOT_STARTED` and requires the order's primary FINAL invoice to be `CLOSED`. The exact spec wording `status != null` cannot be represented because `EditingJob.status` is non-null with a default.

### Delivery marked complete without pickup recorded via direct API

TBD - to be filled during Phase A/B/C/etc.

### Package upgrade bypassing commission creation

TBD - to be filled during Phase A/B/C/etc.

## D. Reconciliation Risks

### Nightly reconciliation failure behavior when environment variables are missing

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: Not tested in this phase. Existing nightly workflow still performs explicit environment verification before running reconciliation.

### Maximum data loss window before next reconciliation run

TBD - to be filled during Phase A/B/C/etc.

- 2026-05-15 Phase A: Not changed. CI now catches invariant regressions before merge, but production reconciliation cadence remains the existing nightly schedule.

## E. Production Failure Scenarios

### Slack webhook outage behavior

TBD - to be filled during Phase A/B/C/etc.

### Read-only replica outage behavior

TBD - to be filled during Phase A/B/C/etc.

### `identifier_sequences` collision handling

TBD - to be filled during Phase A/B/C/etc.
