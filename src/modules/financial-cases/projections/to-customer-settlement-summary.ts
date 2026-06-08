import {
  deriveCustomerSettlementFromActiveSummary,
} from "../customer-settlement.calculation";
import type {
  FinancialCaseActiveSummary,
  FinancialCaseSummary,
} from "../financial-case-summary.types";

export type CustomerSettlementDraftOverlay = {
  previousTotal: number;
  pendingDelta: number;
  afterCommitTotal: number;
  amountDueAfterCommit: number;
};

export type CustomerSettlementSummaryProjection =
  | CustomerSettlementCleanProjection
  | CustomerSettlementDraftProjection;

export type CustomerSettlementCleanProjection = CustomerSettlementProjectionBase & {
  mode: "clean";
};

export type CustomerSettlementDraftProjection = CustomerSettlementProjectionBase &
  CustomerSettlementDraftOverlay & {
    mode: "draft";
  };

type CustomerSettlementProjectionBase = {
  financialCaseId: string;
  netCustomerTotal: number;
  cashPaid: number;
  remainingDue: number;
  availableCredit?: number;
  refundable?: number;
};

export function toCustomerSettlementSummary(
  summary: FinancialCaseSummary,
  draftOverlay?: CustomerSettlementDraftOverlay | null
): CustomerSettlementSummaryProjection | null {
  if (summary.stage !== "active") return null;

  const base = toCustomerSettlementBase(summary);
  if (!draftOverlay) {
    return {
      ...base,
      mode: "clean",
    };
  }

  return {
    ...base,
    mode: "draft",
    previousTotal: draftOverlay.previousTotal,
    pendingDelta: draftOverlay.pendingDelta,
    afterCommitTotal: draftOverlay.afterCommitTotal,
    amountDueAfterCommit: draftOverlay.amountDueAfterCommit,
  };
}

function toCustomerSettlementBase(
  summary: FinancialCaseActiveSummary
): CustomerSettlementProjectionBase {
  const settlement = deriveCustomerSettlementFromActiveSummary(summary);
  const creditFields =
    settlement.availableCredit > 0
      ? {
          availableCredit: settlement.availableCredit,
          refundable: settlement.availableCredit,
        }
      : {};

  return {
    financialCaseId: settlement.financialCaseId,
    netCustomerTotal: settlement.netCustomerTotal,
    cashPaid: settlement.cashPaid,
    remainingDue: settlement.remainingDue,
    ...creditFields,
  };
}
