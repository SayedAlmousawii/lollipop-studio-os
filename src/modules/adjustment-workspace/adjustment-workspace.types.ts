import type { InvoiceStatus } from "@prisma/client";

export type AdjustmentLineKind = "package" | "item" | "addon" | "session_configuration";

export type AdjustmentMoney = string;

export interface AdjustmentTaxBreakdown {
  code: string;
  amount: AdjustmentMoney;
}

export interface AdjustmentCompositionLine {
  lineId: string;
  kind: AdjustmentLineKind;
  refId: string;
  label: string;
  quantity: number;
  unitPrice: AdjustmentMoney;
  lineTotalGross: AdjustmentMoney;
  lineTotalNet: AdjustmentMoney;
  taxBreakdown: AdjustmentTaxBreakdown[];
}

export interface AdjustmentCompositionTotals {
  gross: AdjustmentMoney;
  discount: AdjustmentMoney;
  tax: AdjustmentMoney;
  netPayable: AdjustmentMoney;
}

export interface AdjustmentBaseSnapshot {
  capturedAt: string;
  lines: AdjustmentCompositionLine[];
  totals: AdjustmentCompositionTotals;
  sessionConfigurationSelections?: AdjustmentSessionConfigurationSelection[];
}

export type AdjustmentSessionConfigurationSelection = {
  id: string;
  orderPackageId: string;
  configurationId: string;
  optionId: string | null;
  numericValue: string | null;
  textValue: string | null;
  snapshotConfigurationCode: string;
  snapshotLabel: string;
  snapshotPriceDelta: AdjustmentMoney;
  snapshotFinancialBehavior: "OPERATIONAL" | "FINANCIAL";
  snapshotInputType: "TOGGLE" | "SELECT" | "NUMBER" | "TEXT" | "COUNTER";
  snapshotPricingMode: "NONE" | "FIXED" | "TIERED" | "LINKED_PRODUCT";
  snapshotLinkedProductId: string | null;
  snapshotLinkProductDisplay: "LINE_ITEM" | "MODIFIER_ONLY" | null;
};

export type AdjustmentWorkspaceEdit =
  | {
      id: string;
      op: "add_line";
      kind: "item" | "addon";
      refId: string;
      quantity: number;
    }
  | { id: string; op: "remove_line"; targetLineId: string }
  | { id: string; op: "modify_quantity"; targetLineId: string; newQuantity: number }
  | {
      id: string;
      op: "swap_package";
      fromPackageRefId: string;
      toPackageRefId: string;
    }
  | { id: string; op: "swap_addon"; targetLineId: string; toAddonRefId: string }
  | {
      id: string;
      op: "upgrade_package_item";
      orderPackageId: string;
      packageItemId: string;
      toProductId: string;
      quantity: number;
    }
  | {
      id: string;
      op: "change_selected_photo_count";
      orderPackageId: string;
      selectedPhotoCount: number;
      extraDigitalCount: number;
      extraPrintCount: number;
    }
  | {
      id: string;
      op: "change_package_tier";
      orderPackageId: string;
      toPackageRefId: string;
    }
  | {
      id: string;
      op: "change_session_configuration_selection";
      orderPackageId: string;
      configurationId: string;
      desired:
        | null
        | { kind: "toggle" }
        | { kind: "select"; optionId: string }
        | { kind: "number"; numericValue: number }
        | { kind: "text"; textValue: string }
        | { kind: "counter"; numericValue: number; optionId?: string };
    };

export interface AdjustmentPendingChanges {
  edits: AdjustmentWorkspaceEdit[];
}

export interface AdjustmentWorkspaceProposal {
  base: AdjustmentBaseSnapshot;
  proposed: AdjustmentBaseSnapshot;
  edits: AdjustmentWorkspaceEdit[];
  deltas: AdjustmentCompositionLine[];
  grossDelta: AdjustmentMoney;
  discountDelta: AdjustmentMoney;
  taxDelta: AdjustmentMoney;
  netPayableDelta: AdjustmentMoney;
  requiresManagerApproval: boolean;
  hasEdits: boolean;
  adjustmentKind: "positive" | "negative" | "zero_net" | "none";
}

export interface AdjustmentWorkspaceView {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  orderId: string;
  jobNumber: string;
  status: "open" | "finalized" | "cancelled";
  version: number;
  openedByUserId: string;
  openedByName: string;
  openedAt: string;
  currentOwnerUserId: string | null;
  currentOwnerName: string | null;
  baseSnapshot: AdjustmentBaseSnapshot;
  pendingChanges: AdjustmentPendingChanges;
  proposal: AdjustmentWorkspaceProposal;
}

export interface PendingAdjustmentPreview {
  baseLockedTotal: number;
  pendingAdditions: number;
  pendingReductions: number;
  pendingNet: number;
  approvalRequired: boolean;
  parentInvoice: {
    id: string;
    number: string;
    status: InvoiceStatus;
  };
}
