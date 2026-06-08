import type { FinancialCaseSummary } from "@/modules/financial-cases/financial-case-summary.types";
import { toCustomerSettlementSummary } from "@/modules/financial-cases/projections";
import type { OrderCommitPreview } from "../order-commit-preview.types";
import type { SalesPageFinancialPreview } from "./sales-page-view.types";

const SETTLEMENT_EPSILON = 0.0005;

export type ToSalesPageFinancialPreviewInput = {
  preview: OrderCommitPreview | null;
  financialCase: FinancialCaseSummary;
};

export function toSalesPageFinancialPreview({
  preview,
  financialCase,
}: ToSalesPageFinancialPreviewInput): SalesPageFinancialPreview {
  return {
    stage: financialCase.stage,
    financialCaseId: financialCase.financialCaseId,
    settlement: toCustomerSettlementSummary(
      financialCase,
      preview
        ? {
            previousTotal: preview.totals.baselineTotal,
            pendingDelta: preview.totals.netDelta,
            afterCommitTotal: preview.totals.pendingTotal,
            amountDueAfterCommit: preview.paymentImpact.amountDue,
          }
        : null
    ),
    isFullySettled:
      financialCase.stage === "active" &&
      financialCase.paymentStatusEnum === "PAID" &&
      financialCase.remaining <= SETTLEMENT_EPSILON,
    paymentStatusEnum:
      financialCase.stage === "active" ? financialCase.paymentStatusEnum : null,
    collectPaymentTargetInvoiceId:
      financialCase.stage === "active"
        ? findNextUnsettledChargeInvoiceId(financialCase)
        : null,
  };
}

function findNextUnsettledChargeInvoiceId(
  financialCase: Extract<FinancialCaseSummary, { stage: "active" }>
): string | null {
  if (financialCase.finalInvoice.remaining > SETTLEMENT_EPSILON) {
    return financialCase.finalInvoice.id;
  }

  const openAdjustment = financialCase.finalizedAdjustments.find(
    (invoice) => invoice.remaining > SETTLEMENT_EPSILON
  );
  return openAdjustment?.id ?? null;
}
