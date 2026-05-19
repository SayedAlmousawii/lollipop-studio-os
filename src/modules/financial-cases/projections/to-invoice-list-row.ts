import type { InvoiceStatus, InvoiceType } from "@prisma/client";
import type { FinancialCaseSummary } from "../financial-case-summary.types";

export type InvoiceListRowProjection = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceType: Extract<
    InvoiceType,
    "DEPOSIT" | "FINAL" | "ADJUSTMENT" | "REFUND" | "CREDIT_NOTE"
  >;
  total: number;
  paidAmount: number;
  remainingAmount: number;
  status: InvoiceStatus;
  issuedAt: Date | null;
  createdAt: Date;
};

export function toInvoiceListRow(
  summary: FinancialCaseSummary
): InvoiceListRowProjection[] {
  if (summary.stage !== "active") return [];

  return summary.linkedDocuments.map((document) => ({
    invoiceId: document.invoiceId,
    invoiceNumber: document.invoiceNumber,
    invoiceType: document.invoiceType,
    total: document.invoiceTotal,
    paidAmount: document.paidAmount,
    remainingAmount: document.remainingAmount,
    status: document.invoiceStatus,
    issuedAt: document.issuedAt,
    createdAt: document.createdAt,
  }));
}
