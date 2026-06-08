import type { UserRole } from "@prisma/client";
import type { FinancialCaseSummary } from "@/modules/financial-cases/financial-case-summary.types";
import type { CustomerSettlementSummaryProjection } from "@/modules/financial-cases/projections";
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

export type SalesPageDraftOwnershipMode =
  | "none"
  | "owner"
  | "blocked_non_owner"
  | "manager_override";

export type SalesPageDraftOwnership = {
  mode: SalesPageDraftOwnershipMode;
  hasDraft: boolean;
  isOwner: boolean;
  isManagerOverride: boolean;
  canStage: boolean;
  canDiscard: boolean;
  canCommit: boolean;
  ownerUserId: string | null;
  openedByUserId: string | null;
  lastTouchedByUserId: string | null;
  updatedAt: Date | null;
  banner: {
    tone: "neutral" | "warning" | "info";
    title: string;
    description: string;
  } | null;
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
  stage: FinancialCaseSummary["stage"];
  financialCaseId: string;
  settlement: CustomerSettlementSummaryProjection | null;
  isFullySettled: boolean;
  paymentStatusEnum:
    | Extract<FinancialCaseSummary, { stage: "active" }>["paymentStatusEnum"]
    | null;
  collectPaymentTargetInvoiceId: string | null;
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
  ownership: SalesPageDraftOwnership;
  isLocked: boolean;
};
