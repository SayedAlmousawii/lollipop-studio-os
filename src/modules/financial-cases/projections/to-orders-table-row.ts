import type {
  FinancialCasePaymentStatus,
  FinancialCaseSummary,
} from "../financial-case-summary.types";

export type OrdersTableRowProjection = {
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentStatusEnum: FinancialCasePaymentStatus;
};

export function toOrdersTableRow(
  summary: FinancialCaseSummary
): OrdersTableRowProjection | null {
  if (summary.stage !== "active") return null;
  const totalAmount = getNetCustomerTotal(summary);
  const remainingAmount = summary.remaining;

  return {
    totalAmount,
    paidAmount: Math.max(totalAmount - remainingAmount, 0),
    remainingAmount,
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
