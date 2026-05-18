import type { InvoiceStatus, InvoiceType } from "@prisma/client";
import type { LinkedFinancialDocument } from "@/modules/orders/order.types";

export type FinancialCasePaymentStatus =
  | "UNPAID"
  | "PARTIAL"
  | "PAID"
  | "OVERPAID"
  | "REFUNDED";

export type FinancialCaseInvoiceSummary = {
  id: string;
  invoiceNumber: string;
  invoiceType: InvoiceType;
  total: number;
  remaining: number;
  status: InvoiceStatus;
  isLocked: boolean;
};

export type FinancialCaseDepositInvoiceSummary = {
  id: string;
  invoiceNumber: string;
  total: number;
  status: InvoiceStatus;
  paidAmount: number;
};

export type FinancialCaseFinalInvoiceSummary = FinancialCaseInvoiceSummary & {
  depositPaidAmount: number;
};

export type FinancialCaseBookingSummary = {
  stage: "booking";
  financialCaseId: string;
  bookingId: string;
  depositInvoice: FinancialCaseDepositInvoiceSummary | null;
  depositPaid: boolean;
  awaitingFinalInvoiceAfterCheckIn: boolean;
  finalInvoicePending: boolean;
  linkedDocuments: [];
};

export type FinancialCaseActiveSummary = {
  stage: "active";
  financialCaseId: string;
  orderId: string | null;
  bookingId: string;
  finalInvoice: FinancialCaseFinalInvoiceSummary;
  finalizedAdjustments: FinancialCaseInvoiceSummary[];
  creditNotes: FinancialCaseInvoiceSummary[];
  refunds: FinancialCaseInvoiceSummary[];
  customerTotal: number;
  effectivePaid: number;
  paidSoFar: number;
  depositApplied: number;
  remaining: number;
  totalAdjustments: number;
  finalTotal: number;
  overpaymentCapacity: number;
  creditNoteCapacity: number;
  linkedDocuments: LinkedFinancialDocument[];
  paymentStatusEnum: FinancialCasePaymentStatus;
};

export type FinancialCaseSummary =
  | FinancialCaseBookingSummary
  | FinancialCaseActiveSummary;

export type FinancialCaseSummaryInput = {
  financialCaseId?: string;
  orderId?: string;
  bookingId?: string;
};
