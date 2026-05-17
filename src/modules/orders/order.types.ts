import type {
  InvoiceStatus,
  InvoiceType,
  OrderSelectionStatus,
  OrderStatus,
} from "@prisma/client";

export type OrderStatusLabel =
  | "Active"
  | "Waiting Selection"
  | "Selection Completed"
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
  | "SELECTION_COMPLETED"
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
  sessionDateFrom?: string;
  sessionDateTo?: string;
  editorId?: string;
  hasOpenWorkspace?: boolean;
}

export interface Order {
  id: string;
  jobNumber: string;
  customerPhone: string;
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
  primaryInvoiceNumber: string | null;
  hasOpenAdjustmentWorkspace: boolean;
}

export interface CustomerOrderHistoryItem {
  id: string;
  jobNumber: string;
  sessionDate: string;
  packageName: string;
  orderStatus: OrderStatusLabel;
  invoiceStatus: InvoiceStatusLabel;
  paymentStatus: OrderPaymentStatusLabel;
}

export interface OrderDetail extends Order {
  customerId: string;
  bookingId: string;
  packageLinePackageId: string | null;
  packageId: string | null;
  sessionDateTime: string;
  sessionType: string;
  selectedPhotoCount: string;
  includedPhotoCount: string;
  extraPhotoCount: string;
  addonsSummary: string;
  packageItems: PackageItemDisplay[];
  packageLines: OrderPackageLineDisplay[];
  bundleAdjustment: string;
  paidAddOns: OrderAddOnDisplay[];
  selectionStatus: string;
  editingStatus: string;
  productionStatus: string;
  deliveryStatus: string;
  nextAction: string;
  workflowSteps: OrderWorkflowStep[];
  recentActivity: OrderActivityPreviewItem[];
  notes: string;
  settlementSummary: OrderSettlementSummary;
}

export type OrderSettlementSummary = {
  totalOrderValue: number;
  paidAmount: number;
  outstandingAmount: number;
  refundedAmount: number;
  hasOverpayment: boolean;
};

export interface OrderPackageLineDisplay {
  id: string;
  packageName: string;
  sessionTypeName: string;
  includedPhotoCount: number;
  selectedPhotoCount: number;
  extraDigitalCount: number;
  extraPrintCount: number;
  extraPhotoCount: number;
  upgradeStatus: string;
  bundleAdjustment: string;
  packageItems: PackageItemDisplay[];
}

export interface OrderSelectionWorkflow {
  orderId: string;
  orderStatus: OrderStatusLabel;
  packageLines: OrderPackageLineDisplay[];
  selectedPhotos: number;
  includedPhotoCount: number;
  extraPhotoCount: number;
  addOns: OrderAddOn[];
  notes: string;
  selectionStatus: string;
  completedAt: string | null;
  manualAddOnTotal: string;
  extraPhotoCharge: string;
  selectionAddOnTotal: string;
  nextRecommendedFinancialAction: string;
  invoiceLocked: boolean;
}

export interface OrderEditingWorkflow {
  orderId: string;
  invoiceId: string | null;
  assignedEditorId: string | null;
  assignedEditorName: string;
  assignedAt: string | null;
  editingStatus: string;
  productionStatus: string;
  progressPercent: number;
  editedPhotoCount: number;
  targetPhotoCount: number;
  revisionCount: number;
  revisionState: string;
  approvalState: string;
  estimatedCompletionDate: string | null;
  estimatedCompletionDateInput: string;
  startedAt: string | null;
  completedAt: string | null;
  customerApprovedAt: string | null;
  sentToProductionAt: string | null;
  basePaymentVerified: boolean;
  outstandingBalanceAmount: number | null;
  outstandingBalanceLabel: string | null;
  canAssignEditor: boolean;
  canMarkStarted: boolean;
  canRequestRevision: boolean;
  canMarkComplete: boolean;
  canMarkApproved: boolean;
  canSendToProduction: boolean;
  editorOptions: OrderEditorOption[];
}

export interface OrderProductionWorkflow {
  orderId: string;
  productionStatus: string;
  deliveryStatus: string;
  editingStatus: string;
  readyAt: string | null;
  readinessWarning: string | null;
  canUpdateProduction: boolean;
  canMarkReadyForPickup: boolean;
  sections: OrderProductionSection[];
}

export interface OrderDeliveryWorkflow {
  orderId: string;
  deliveryStatus: string;
  productionStatus: string;
  paymentStatus: OrderPaymentStatusLabel;
  readyAt: string | null;
  preparedAt: string | null;
  customerNotifiedAt: string | null;
  pickedUpAt: string | null;
  completedAt: string | null;
  completedById: string | null;
  completedBy: string;
  pickupNotes: string;
  overrideReason: string;
  completionBlockers: string[];
  requiresPaymentOverride: boolean;
  canRecordNotification: boolean;
  canMarkPickedUp: boolean;
}

export interface OrderProductionSection {
  key:
    | "albumDesign"
    | "printing"
    | "assembly"
    | "vendor"
    | "framedPrints"
    | "finalReadiness";
  title: string;
  description: string;
  status: string;
  action: OrderProductionAction | null;
  actionLabel: string | null;
}

export type OrderProductionAction =
  | "markAlbumDesignStarted"
  | "markAlbumDesignCompleted"
  | "markSentToPrint"
  | "markAssemblyStarted"
  | "markAssemblyCompleted"
  | "markVendorInProgress"
  | "markVendorCompleted"
  | "markPrintsReady"
  | "markProductionReadyForPickup";

export type OrderDeliveryAction =
  | "recordCustomerNotification"
  | "markPickedUp";

export interface OrderEditorOption {
  id: string;
  name: string;
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

// True add-ons only. Package-item upgrade rows live in OrderPackageItemUpgrade.
export interface OrderAddOn {
  productId?: string;
  name: string;
  price: number;
}

export interface OrderPackageItemUpgrade {
  id: string;
  orderId: string;
  orderPackageId: string;
  packageItemId: string;
  nameSnapshot: string;
  priceSnapshot: number;
  quantity: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderAddOnDisplay {
  productId: string | null;
  name: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface PackageItemDisplay {
  id: string;
  productId: string;
  productName: string;
  productCategory: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface OrderPaymentStage {
  id: string;
  publicId: string;
  amount: string;
  method: string;
  paymentType: string;
  paidAt: string;
  reference: string;
  notes: string;
}

export interface OrderFinancialLineItem {
  id: string;
  lineType: string;
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface OrderFinancialSummary {
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: InvoiceStatusLabel;
  paymentStatus: OrderPaymentStatusLabel;
  basePackageName: string;
  basePackagePrice: string;
  upgradePackageName: string | null;
  upgradeAmount: string | null;
  addOnTotal: string;
  extraPhotoTotal: string;
  invoiceTotal: string;
  paidAmount: string;
  balanceDue: string;
  lineItems: OrderFinancialLineItem[];
  payments: OrderPaymentStage[];
}

export interface POSWorkspace {
  orderId: string;
  jobNumber: string;
  orderStatusRaw: OrderStatus;
  orderStatus: OrderStatusLabel;
  selectionStatus: OrderSelectionStatus;
  sessionDate: string;
  customerName: string;
  customerPhone: string;
  packageLines: POSPackageLine[];
  packageItems: POSPackageItem[];
  rawDeliverableTotal: number;
  includedPhotoCount: number;
  selectedPhotoCount: number;
  extraPhotoCount: number;
  extraPhotoTotal: number;
  addOns: POSAddOn[];
  addOnTotal: number;
  productOptions: POSProductOption[];
  addOnCatalog: POSAddOnCatalogItem[];
  invoice: POSInvoiceSummary | null;
  adjustmentInvoices: POSInvoiceSummary[];
  paidAdjustmentInvoices: POSInvoiceSummary[];
  aggregateOutstanding: number;
}

export interface LinkedFinancialDocument {
  invoiceId: string;
  invoiceNumber: string;
  invoiceType: Extract<
    InvoiceType,
    "DEPOSIT" | "FINAL" | "ADJUSTMENT" | "REFUND" | "CREDIT_NOTE"
  >;
  invoiceStatus: InvoiceStatus;
  invoiceTotal: number;
  paidAmount: number;
  remainingAmount: number;
  issuedAt: Date | null;
  createdAt: Date;
}

export interface POSPackageLine {
  id: string;
  sortOrder: number;
  sessionTypeId: string;
  sessionTypeName: string;
  originalPackage: POSPackage;
  currentPackage: POSPackage;
  packageItems: POSPackageItem[];
  includedPhotoCount: number;
  selectedPhotoCount: number;
  extraDigitalCount: number;
  extraPrintCount: number;
  extraPhotoCount: number;
  extraDigitalUnitPrice: number;
  extraPrintUnitPrice: number;
  extraPhotoTotal: number;
  packageSubtotal: number;
  upgradeDelta: number;
  upgradeDeltaLabel: string;
  packageOptions: POSPackageOption[];
}

export interface POSPackage {
  id: string;
  name: string;
  price: number;
  priceLabel: string;
  photoCount: number;
  bundleAdjustment: number;
}

export interface POSPackageItem {
  id: string;
  productId: string;
  productName: string;
  category: string;
  quantity: number;
  priceSnapshot: number;
  priceSnapshotLabel: string;
}

export interface POSAddOn {
  id: string;
  addOnRowId: string;
  productId: string | null;
  name: string;
  price: number;
  priceLabel: string;
}

export interface POSPackageOption {
  id: string;
  name: string;
  price: number;
  priceLabel: string;
  isCurrentPackage: boolean;
  upgradeDelta: number;
  upgradeDeltaLabel: string;
}

export interface POSProductOption {
  id: string;
  name: string;
  category: string;
  canonicalPrice: number;
  canonicalPriceLabel: string;
}

export interface POSAddOnCatalogItem {
  id: string;
  name: string;
  category: string;
  price: number;
  priceLabel: string;
}

export interface POSInvoiceSummary {
  invoiceId: string;
  financialCaseId: string;
  invoiceNumber: string;
  invoiceType: Extract<InvoiceType, "FINAL" | "ADJUSTMENT">;
  invoiceStatus: InvoiceStatusLabel;
  isLocked: boolean;
  renderMode: "SNAPSHOT" | "COMPUTED";
  packageBaseTotal: number;
  bundleAdjustment: number;
  addOnTotal: number;
  extraPhotoTotal: number;
  invoiceTotal: number;
  paidAmount: number;
  depositInvoiceNumber: string | null;
  depositPaidAmount: number;
  remainingAmount: number;
  lineItems: POSInvoiceLineItem[];
}

export interface POSInvoiceLineItem {
  id: string;
  lineType: string;
  description: string;
  quantity: number;
  unitPriceLabel: string;
  lineTotalLabel: string;
}

export interface EditingQueueItem {
  id: string;
  jobNumber: string;
  customerName: string;
  sessionDate: string;
  editingStatus: string;
  assignedEditorName: string;
}

export interface ProductionQueueItem {
  id: string;
  jobNumber: string;
  customerName: string;
  sessionDate: string;
  productionStatus: string;
  sectionSummary: string;
}
