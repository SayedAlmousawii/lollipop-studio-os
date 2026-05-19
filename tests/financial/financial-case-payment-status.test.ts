import assert from "node:assert/strict";
import test from "node:test";
import { InvoiceStatus } from "@prisma/client";
import {
  mapFinancialCasePaymentStatusToLabel,
} from "@/modules/financial-cases/financial-case-summary.constants";
import { deriveFinancialCasePaymentStatus } from "@/modules/financial-cases/financial-case-payment-status";

test("FinancialCase payment status maps to order payment labels", () => {
  assert.equal(mapFinancialCasePaymentStatusToLabel("UNPAID"), "Pending");
  assert.equal(
    mapFinancialCasePaymentStatusToLabel("PARTIAL"),
    "Partially paid"
  );
  assert.equal(mapFinancialCasePaymentStatusToLabel("PAID"), "Paid");
  assert.equal(mapFinancialCasePaymentStatusToLabel("OVERPAID"), "Paid");
  assert.equal(mapFinancialCasePaymentStatusToLabel("REFUNDED"), "Paid");
  assert.equal(
    mapFinancialCasePaymentStatusToLabel("OVERRIDDEN"),
    "Overridden"
  );
});

test("FinancialCase payment status preserves force-closed outstanding invoices", () => {
  const status = deriveFinancialCasePaymentStatus({
    finalInvoiceStatus: InvoiceStatus.CLOSED,
    settlementSummary: {
      hasOverpayment: false,
      outstandingAmount: 25,
    },
    effectivePaid: 75,
    customerTotal: 100,
    refunds: 0,
  });

  assert.equal(status, "OVERRIDDEN");
  assert.equal(mapFinancialCasePaymentStatusToLabel(status), "Overridden");
});
