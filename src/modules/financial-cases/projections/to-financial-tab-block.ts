import type { FinancialCaseSummary } from "../financial-case-summary.types";

export type FinancialTabBlockProjection = {
  customerTotal: number;
  paidSoFar: number;
  includesDeposit: number;
  remaining: number;
  finalInvoiceTotal: number;
  totalAdjustments: number;
  finalTotal: number;
};

export function toFinancialTabBlock(
  summary: FinancialCaseSummary
): FinancialTabBlockProjection | null {
  if (summary.stage !== "active") return null;

  return {
    customerTotal: summary.customerTotal,
    paidSoFar: summary.paidSoFar,
    includesDeposit: summary.finalInvoice.depositPaidAmount,
    remaining: summary.remaining,
    finalInvoiceTotal: summary.finalInvoice.total,
    totalAdjustments: summary.totalAdjustments,
    finalTotal: summary.finalTotal,
  };
}
