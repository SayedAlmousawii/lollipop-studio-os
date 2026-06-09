import type { InvoiceType } from "@prisma/client";

export type InvoiceStatusLabel = "Draft" | "Issued" | "Partial" | "Paid" | "Closed";
export type InvoiceAccountantStatusLabel =
  | "Draft"
  | "Issued"
  | "Paid"
  | "Void"
  | "Available"
  | "Partially used"
  | "Fully used";
export type FinancialDocumentClass = "charge" | "credit" | "cash";
export type FinancialDocumentMoneyTone = "neutral" | "success" | "danger" | "muted";

export type InvoiceLineType =
  | "PACKAGE_BASE"
  | "BUNDLE_ADJUSTMENT"
  | "PACKAGE_UPGRADE"
  | "ADD_ON"
  | "EXTRA_PHOTOS"
  | "MANUAL_DISCOUNT"
  | "MANUAL_SURCHARGE"
  | "SESSION_CONFIGURATION";

export interface InvoiceLineItem {
  id: string;
  lineType: InvoiceLineType;
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  sortOrder: number;
  createdAt: string;
}

export interface InvoiceListItem {
  id: string;
  jobNumber: string;
  invoiceNumber: string;
  invoiceType: InvoiceType | null;
  documentTypeLabel: string;
  documentClass: FinancialDocumentClass;
  customerPhone: string;
  orderId: string | null;
  bookingId: string | null;
  referenceLabel: string;
  totalAmount: string;
  signedAmount: string;
  signedAmountTone: FinancialDocumentMoneyTone;
  paidAmount: string;
  paidCash: string;
  settledAmount: string;
  creditApplied: string;
  remainingAmount: string;
  outstanding: string;
  outstandingLabel: string;
  outstandingTone: FinancialDocumentMoneyTone;
  status: InvoiceStatusLabel;
  accountantStatus: InvoiceAccountantStatusLabel;
  isLocked: boolean;
  applicationLinks: string[];
  createdAt: string;
}

export interface InvoiceRegisterSubtotals {
  invoicedGross: string;
  creditsIssued: string;
  invoicedNet: string;
  depositsPrepaid: string;
  cashReceived: string;
  receivable: string;
}

export interface InvoiceRegisterView {
  rows: InvoiceListItem[];
  subtotals: InvoiceRegisterSubtotals;
}

export interface InvoiceDetail extends InvoiceListItem {
  depositInvoiceNumber: string | null;
  depositPaidAmount: string | null;
  creditNoteHeadline: {
    totalCredit: string;
    appliedCredit: string;
    availableCredit: string;
  } | null;
  applicationBreakdown: Array<{
    label: string;
    documentNumber: string;
    amount: string;
    signed: string;
  }>;
  overpaymentCapacity: string | null;
  creditNoteCapacity: string | null;
  creditNoteRefundable: string | null;
  isOverpaid: boolean;
  overpaidAmount: string | null;
  lineItemsAreComputed: boolean;
  notes: string;
  parentInvoiceId: string | null;
  parentInvoiceNumber: string | null;
  payments: Array<{
    id: string;
    publicId: string;
    jobNumber: string;
    amount: string;
    method: string;
    paymentType: string;
    paidAt: string;
    reference: string;
    notes: string;
    direction: "IN" | "OUT";
    refundOfPaymentId: string | null;
  }>;
  adjustments: Array<{
    id: string;
    invoiceNumber: string;
    totalAmount: string;
    status: InvoiceStatusLabel;
  }>;
  lineItems: InvoiceLineItem[];
}
