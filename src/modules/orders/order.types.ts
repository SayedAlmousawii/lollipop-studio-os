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
}

export interface Order {
  id: string;
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
  primaryInvoiceNumber: string | null;
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
  orderStatus: OrderStatusLabel;
  finalPackageId: string;
  originalPackageName: string;
  finalPackageName: string;
  packageDescription: string | null;
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
  invoiceNumber: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: InvoiceStatusLabel;
  isLocked: boolean;
  recognizedPackageBaseline: number;
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
  payments: OrderPaymentStage[];
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
