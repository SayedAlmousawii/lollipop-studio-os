export type OrderStatusLabel =
  | "Active"
  | "Waiting Selection"
  | "Editing"
  | "Production"
  | "Ready"
  | "Delivered"
  | "Cancelled";

export type InvoiceStatusLabel = "Draft" | "Issued" | "Partial" | "Paid" | "Closed" | "No Invoice";
export type OrderPaymentStatusLabel = "Pending" | "Partially paid" | "Paid" | "Overridden";

export type OrderStatusFilter =
  | "ACTIVE"
  | "WAITING_SELECTION"
  | "EDITING"
  | "PRODUCTION"
  | "READY"
  | "DELIVERED"
  | "CANCELLED";

export type InvoiceStatusFilter = "DRAFT" | "ISSUED" | "PARTIAL" | "PAID" | "CLOSED";

export interface OrderFilters {
  search?: string;
  orderStatus?: OrderStatusFilter;
  invoiceStatus?: InvoiceStatusFilter;
}

export interface Order {
  id: string;
  publicId: string;
  jobNumber: string;
  customerName: string;
  bookingDate: string;
  originalPackageName: string;
  finalPackageName: string;
  orderStatus: OrderStatusLabel;
  invoiceStatus: InvoiceStatusLabel;
  paymentStatus: OrderPaymentStatusLabel;
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  createdAt: string;
  primaryInvoiceId: string | null;
  primaryInvoicePublicId: string | null;
}

export interface OrderDetail extends Order {
  sessionType: string;
  selectedPhotoCount: string;
  includedPhotoCount: string;
  extraPhotoCount: string;
  addonsSummary: string;
  selectionStatus: string;
  editingStatus: string;
  productionStatus: string;
  deliveryStatus: string;
  notes: string;
}

export interface OrderAddOn {
  name: string;
  price: number;
}

export interface OrderEditPackage {
  id: string;
  name: string;
  price: number;
  priceLabel: string;
  photoCount: number;
}

export interface EditableOrder {
  id: string;
  customerName: string;
  bookingDate: string;
  originalPackage: OrderEditPackage | null;
  finalPackage: OrderEditPackage | null;
  selectedPhotos: number;
  addOns: OrderAddOn[];
  orderStatus: OrderStatusLabel;
  notes: string;
  invoiceSummary: EditableOrderInvoiceSummary | null;
}

export interface EditableOrderInvoiceSummary {
  id: string;
  publicId: string;
  invoiceNumber: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: InvoiceStatusLabel;
  isLocked: boolean;
  recognizedPackageBaseline: number;
}
