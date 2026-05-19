import type { InvoiceStatus } from "@prisma/client";
import type {
  FinancialCasePaymentStatus,
  FinancialCaseSummary,
} from "../financial-case-summary.types";

export type DraftSidebarFinancialProjection = {
  finalInvoiceId: string;
  finalInvoiceNumber: string;
  isLocked: boolean;
  invoiceStatus: InvoiceStatus;
  invoiceTotal: number;
  paidSoFar: number;
  depositApplied: number;
  remaining: number;
  paymentStatusEnum: FinancialCasePaymentStatus;
};

export function toDraftSidebarFinancial(
  summary: FinancialCaseSummary
): DraftSidebarFinancialProjection | null {
  if (summary.stage !== "active") return null;

  return {
    finalInvoiceId: summary.finalInvoice.id,
    finalInvoiceNumber: summary.finalInvoice.invoiceNumber,
    isLocked: summary.finalInvoice.isLocked,
    invoiceStatus: summary.finalInvoice.status,
    invoiceTotal: summary.customerTotal,
    paidSoFar: summary.paidSoFar,
    depositApplied: summary.depositApplied,
    remaining: summary.remaining,
    paymentStatusEnum: summary.paymentStatusEnum,
  };
}
