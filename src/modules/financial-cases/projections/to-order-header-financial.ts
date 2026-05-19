import type {
  FinancialCasePaymentStatus,
  FinancialCaseSummary,
} from "../financial-case-summary.types";

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

function getNetCustomerTotal(
  summary: Extract<FinancialCaseSummary, { stage: "active" }>
): number {
  return Math.max(
    summary.customerTotal -
      summary.creditNotes.reduce((sum, creditNote) => sum + creditNote.total, 0),
    0
  );
}
