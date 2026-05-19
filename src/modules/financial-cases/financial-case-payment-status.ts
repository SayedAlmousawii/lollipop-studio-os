import { InvoiceStatus } from "@prisma/client";
import type { FinancialCasePaymentStatus } from "./financial-case-summary.types";

export function deriveFinancialCasePaymentStatus(input: {
  finalInvoiceStatus: InvoiceStatus;
  settlementSummary: {
    hasOverpayment: boolean;
    outstandingAmount: number;
  };
  effectivePaid: number;
  customerTotal: number;
  refunds: number;
}): FinancialCasePaymentStatus {
  if (
    input.finalInvoiceStatus === InvoiceStatus.CLOSED &&
    input.settlementSummary.outstandingAmount > 0.0005
  ) {
    return "OVERRIDDEN";
  }
  if (input.refunds > 0) return "REFUNDED";
  if (
    input.settlementSummary.hasOverpayment ||
    input.effectivePaid - input.customerTotal > 0.0005
  ) {
    return "OVERPAID";
  }
  if (input.customerTotal > 0 && input.settlementSummary.outstandingAmount <= 0.0005) {
    return "PAID";
  }
  if (input.effectivePaid <= 0.0005) return "UNPAID";
  return "PARTIAL";
}
