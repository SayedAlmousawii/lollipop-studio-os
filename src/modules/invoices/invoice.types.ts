import type { InvoiceType } from "@prisma/client";

export type InvoiceStatusLabel = "Draft" | "Issued" | "Partial" | "Paid" | "Closed";

export type InvoiceLineType =
  | "PACKAGE_BASE"
  | "BUNDLE_ADJUSTMENT"
  | "PACKAGE_UPGRADE"
  | "ADD_ON"
  | "EXTRA_PHOTOS"
  | "MANUAL_DISCOUNT"
  | "MANUAL_SURCHARGE";

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
  customerPhone: string;
  orderId: string | null;
  bookingId: string | null;
  referenceLabel: string;
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  status: InvoiceStatusLabel;
  isLocked: boolean;
  createdAt: string;
}

export interface InvoiceDetail extends InvoiceListItem {
  depositInvoiceNumber: string | null;
  depositPaidAmount: string | null;
  refundableAmount: string | null;
  creditNoteCapacity: string | null;
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
