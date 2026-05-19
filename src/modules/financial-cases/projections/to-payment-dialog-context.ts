import type { InvoiceStatus } from "@prisma/client";
import type {
  FinancialCasePaymentStatus,
  FinancialCaseSummary,
} from "../financial-case-summary.types";

export type PaymentDialogContextProjection = {
  finalInvoiceId: string;
  finalInvoiceNumber: string;
  isLocked: boolean;
  invoiceStatus: InvoiceStatus;
  invoiceTotal: number;
  paidAmount: number;
  remainingAmount: number;
  overpaymentCapacity: number;
  creditNoteCapacity: number;
  paymentStatusEnum: FinancialCasePaymentStatus;
};

export function toPaymentDialogContext(
  summary: FinancialCaseSummary
): PaymentDialogContextProjection | null {
  if (summary.stage !== "active") return null;

  return {
    finalInvoiceId: summary.finalInvoice.id,
    finalInvoiceNumber: summary.finalInvoice.invoiceNumber,
    isLocked: summary.finalInvoice.isLocked,
    invoiceStatus: summary.finalInvoice.status,
    invoiceTotal: summary.customerTotal,
    paidAmount: summary.paidSoFar,
    remainingAmount: summary.remaining,
    overpaymentCapacity: summary.overpaymentCapacity,
    creditNoteCapacity: summary.creditNoteCapacity,
    paymentStatusEnum: summary.paymentStatusEnum,
  };
}
