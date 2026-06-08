import type {
  FinancialCasePaymentStatus,
  FinancialCaseSummary,
} from "../financial-case-summary.types";
import { getNetCustomerTotal } from "../customer-settlement.calculation";

export type OrderHeaderFinancialProjection = {
  totalOrderValue: number;
  paidAmount: number;
  outstandingAmount: number;
  refundedAmount: number;
  hasOverpayment: boolean;
  paymentStatusEnum: FinancialCasePaymentStatus;
};

export function toOrderHeaderFinancial(
  summary: FinancialCaseSummary
): OrderHeaderFinancialProjection | null {
  if (summary.stage !== "active") return null;
  const totalOrderValue = getNetCustomerTotal(summary);
  const outstandingAmount = summary.remaining;

  return {
    totalOrderValue,
    paidAmount: Math.max(totalOrderValue - outstandingAmount, 0),
    outstandingAmount,
    refundedAmount: summary.refunds.reduce((sum, refund) => sum + refund.total, 0),
    hasOverpayment: summary.overpaymentCapacity > 0,
    paymentStatusEnum: summary.paymentStatusEnum,
  };
}
