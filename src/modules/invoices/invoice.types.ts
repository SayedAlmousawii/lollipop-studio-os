export type InvoiceStatusLabel = "Draft" | "Issued" | "Partial" | "Paid" | "Closed";

export interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  customerName: string;
  orderId: string;
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  status: InvoiceStatusLabel;
  isLocked: boolean;
  createdAt: string;
}

export interface InvoiceDetail extends InvoiceListItem {
  notes: string;
  parentInvoiceId: string | null;
  parentInvoiceNumber: string | null;
  payments: Array<{
    id: string;
    amount: string;
    method: string;
    paymentType: string;
    paidAt: string;
    reference: string;
    notes: string;
  }>;
  adjustments: Array<{
    id: string;
    invoiceNumber: string;
    totalAmount: string;
    status: InvoiceStatusLabel;
  }>;
}
