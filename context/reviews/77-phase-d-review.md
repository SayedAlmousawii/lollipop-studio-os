# 77 Phase D Review — Layer 5 Regression Testing

Date: 2026-05-15

## Scope

Implemented Layer 5 regression coverage for Feature 74, Feature 75, Feature 76, and multi-package regressions. The suite is wired into `npm run test:backend-invariants` through `tests/financial-phase-d/`.

## Regression Suite

- `REG-74-01` verifies invoice detail/effective paid math uses `PaymentAllocation` + `DocumentApplication`, with Deposit application reducing the Final Invoice balance without virtual credit.
- `REG-74-02` verifies service-created legacy-shape bookings still have one `PaymentAllocation` for Deposit payment plus one Deposit-to-Final `DocumentApplication`.
- `REG-74-03` verifies pure invoice reads do not emit `financial.rearch.dual_read.discrepancy`.
- `REG-75-01` verifies ADJUSTMENT invoice creation, payment through the allocation choke point, and settlement lock.
- `REG-75-02` verifies Final Invoice detail exposes outstanding ADJUSTMENT invoices for settlement visibility.
- `REG-76-01` verifies non-manager CREDIT_NOTE rejection, manager CREDIT_NOTE creation, DocumentApplication binding, and overpayment flag display.
- `REG-76-02` verifies REFUND invoice settlement creates an OUT payment with a matching allocation.
- `REG-76-03` verifies a mixed reductive/additive edit creates exactly one CREDIT_NOTE and one ADJUSTMENT with paired activity metadata in one transaction.
- `REG-70-01` verifies multi-package Final Invoice math uses all OrderPackage lines plus session-type extra-photo pricing.
- `REG-70-02` verifies cross-session package replacement is blocked at the service layer.
- `REG-70-03` verifies `OrderAddOn.orderPackageId` cascade removes only scoped add-ons for the deleted package line.
- `REG-LEGACY-01` characterizes a remaining retired deposit-deduction path in editing workflow readiness.

## Regression Findings Summary

- PASS: Feature 74 canonical invoice balance reads remain intact for invoice detail, Deposit-to-Final applications, and effective-paid math.
- PASS: Feature 75 ADJUSTMENT creation and settlement still work after Feature 76 additions; ADJUSTMENT payments use `PaymentAllocation`.
- PASS: Feature 76 CREDIT_NOTE and REFUND core invariants hold; CREDIT_NOTE role guard rejects receptionist users.
- PASS: Multi-package invoice totals include all package lines and session extra-photo pricing, and package-scoped add-on cascade behaves correctly.
- CHARACTERIZED GAP: Editing workflow readiness can still subtract Deposit paid amount from an already canonical Final Invoice remaining balance.

## Legacy-Path Findings

- No active `PaymentType.BASE` production references were found. Static search found no `PaymentType.BASE` or `paymentType: "BASE"` usage in `src` or `app`.
- No direct production `Payment.create` or `PaymentAllocation.create` paths were found outside `src/modules/payments/payment.service.ts`.
- `DocumentApplication.create` is centralized in `src/modules/invoices/invoice.service.ts` for Deposit-to-Final and CREDIT_NOTE-to-Final application paths.
- Retired virtual deposit-deduction logic remains in `src/modules/orders/order.service.ts`:
  - `calculateFinalBalanceDue(...)` subtracts Deposit paid amount from Final Invoice `remainingAmount`.
  - `mapPOSInvoiceSummary(...)` derives display remaining as `invoice.totalAmount - depositPaidAmount - paidAmount`.
  - `hasBasePayment(...)` treats Deposit payment as satisfying the base payment readiness gate.
- `REG-LEGACY-01` proves this path can report no editing outstanding balance when the canonical Final Invoice still has `20.000 KD` remaining.

## Architecture Consistency Findings

- Canonical balance calculation remains centralized in `src/modules/invoices/invoice.calculation.ts` via `computeEffectivePaidFromAllocations(...)`, and invoice recalculation calls it.
- Adjustment and credit-note documents remain sibling/child records of the locked FINAL invoice; mixed edits create paired records without mutating the locked FINAL total.
- Static search found duplicated balance-display logic in `src/modules/orders/order.service.ts` that should move to a shared canonical summary helper or consume invoice `remainingAmount` directly.
- Existing locked-edit dual-read discrepancy warnings still appear in prior Phase B/C workflows and in mixed locked-edit paths. Phase D confirms pure reads do not emit the warning, but log-based release gates should not treat all current test-suite warnings as new corruption.

## Validation

- `npm run build` — passed.
- `npm run test:backend-invariants` — passed with Phase D included.
