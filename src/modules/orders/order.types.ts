export type OrderStatus =
  | "Active"
  | "Awaiting Selection"
  | "Editing"
  | "In Production"
  | "Ready"
  | "Delivered"
  | "Cancelled";

export type InvoiceStatus = "Unpaid" | "Partial" | "Paid" | "Refunded";

export interface Order {
  id: string;
  customerName: string;
  packageName: string;
  orderStatus: OrderStatus;
  invoiceTotal: string;
  paidAmount: string;
  remainingAmount: string;
  invoiceStatus: InvoiceStatus;
  paymentMethod: string;
  createdAt: string;
}
