import type { UserRole } from "@prisma/client";
import type { FinancialCaseSummary } from "@/modules/financial-cases/financial-case-summary.types";
import type { DraftPOSCompositionProjection } from "@/modules/orders/composition/projections/to-draft-pos-composition";
import type { OrderSelectionStatus, OrderStatus } from "@prisma/client";
import type { OrderCommitPreview } from "../order-commit-preview.types";

export type SalesPageCompositionSource = "current" | "projected";

export type SalesPageComposition = DraftPOSCompositionProjection & {
  source: SalesPageCompositionSource;
};

export type SalesPageOrderHeader = {
  orderId: string;
  jobNumber: string;
  orderStatusRaw: OrderStatus;
  selectionStatus: OrderSelectionStatus;
  sessionDate: string;
  customerName: string;
  customerPhone: string;
  photographerName: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
};

export type SalesPageDraftState = {
  id: string;
  version: number;
  ownerUserId: string;
  openedByUserId: string;
  lastTouchedByUserId: string;
  updatedAt: Date;
  baseCommitId: string | null;
};

export type SalesPagePreviewState = OrderCommitPreview;

export type SalesPageStagedChangesRow = {
  id: string;
  changeKind: OrderCommitPreview["lineDiffs"][number]["changeKind"];
  label: string;
  netDelta: number;
  parentLabel: string | null;
};

export type SalesPageFinancialPreview = {
  baseline: {
    stage: FinancialCaseSummary["stage"];
    financialCaseId: string;
    depositInvoice: FinancialCaseSummary["depositInvoice"];
    finalInvoice: Extract<FinancialCaseSummary, { stage: "active" }>["finalInvoice"] | null;
    customerTotal: number | null;
    finalTotal: number | null;
    depositApplied: number | null;
    paidSoFar: number | null;
    effectivePaid: number | null;
    remaining: number | null;
    paymentStatusEnum:
      | Extract<FinancialCaseSummary, { stage: "active" }>["paymentStatusEnum"]
      | null;
    collectPaymentInvoiceId: string | null;
  };
  overlay: {
    previousTotal: number | null;
    pendingDelta: number | null;
    pendingTotal: number | null;
    requiresApproval: boolean | null;
    approvalReasons: OrderCommitPreview["approvalReasons"] | null;
    documentPlan: OrderCommitPreview["documentPlan"] | null;
    paymentImpact: OrderCommitPreview["paymentImpact"] | null;
    refundImpact: OrderCommitPreview["refundImpact"] | null;
  };
};

export type SalesPagePermissionFlags = {
  actorRole: UserRole;
  canReadOrder: boolean;
  canUpdateOrderFinancial: boolean;
  canCreatePayment: boolean;
  canCreateInvoice: boolean;
  canIssueCreditNote: boolean;
  canIssueRefund: boolean;
};

export type SalesPageView = {
  order: SalesPageOrderHeader;
  composition: SalesPageComposition;
  draft: SalesPageDraftState | null;
  preview: SalesPagePreviewState | null;
  stagedChanges: SalesPageStagedChangesRow[];
  financialPreview: SalesPageFinancialPreview;
  financialCase: FinancialCaseSummary;
  permissions: SalesPagePermissionFlags;
  isLocked: boolean;
};
