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
  customerId: string;
  bookingId: string;
  originalPackageId: string | null;
  finalPackageId: string | null;
  sessionDateTime: string;
  sessionType: string;
  selectedPhotoCount: string;
  includedPhotoCount: string;
  extraPhotoCount: string;
  addonsSummary: string;
  selectionStatus: string;
  editingStatus: string;
  productionStatus: string;
  deliveryStatus: string;
  nextAction: string;
  workflowSteps: OrderWorkflowStep[];
  recentActivity: OrderActivityPreviewItem[];
  notes: string;
}

export interface OrderSelectionWorkflow {
  orderId: string;
  finalPackageId: string;
  originalPackageName: string;
  finalPackageName: string;
  selectedPhotos: number;
  includedPhotoCount: number;
  extraPhotoCount: number;
  addOns: OrderAddOn[];
  notes: string;
  selectionStatus: string;
  completedAt: string | null;
  manualAddOnTotal: string;
  extraPhotoUnitPriceAmount: number;
  extraPhotoUnitPrice: string;
  extraPhotoCharge: string;
  selectionAddOnTotal: string;
  packageUpgradeDifference: string;
  nextRecommendedFinancialAction: string;
  keepCurrentPackageLabel: string;
  upgradePackageLabel: string;
  recommendedPackage: OrderSelectionPackageOption | null;
  invoiceLocked: boolean;
  packageOptions: OrderSelectionPackageOption[];
  addOnOptions: OrderAddOnOption[];
}

export interface OrderSelectionPackageOption extends OrderEditPackage {
  upgradeDifference: number;
  upgradeDifferenceLabel: string;
  isCurrent: boolean;
  isRecommended: boolean;
}

export interface OrderWorkflowStep {
  label: string;
  status: string;
  tone: "pending" | "active" | "complete";
}

export interface OrderActivityPreviewItem {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
}

export interface OrderAddOn {
  optionId?: string;
  name: string;
  price: number;
}

export interface OrderAddOnOption {
  id: string;
  name: string;
  category: string;
  price: number;
  priceLabel: string;
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
