import type { InvoiceStatus } from "@prisma/client";
import type {
  FinancialCasePaymentStatus,
  FinancialCaseSummary,
} from "../financial-case-summary.types";
import { getNetCustomerTotal } from "../customer-settlement.calculation";

export type OrdersTableRowProjection = {
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  invoiceStatus: InvoiceStatus;
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
    invoiceStatus: summary.finalInvoice.status,
    paymentStatusEnum: summary.paymentStatusEnum,
  };
}
