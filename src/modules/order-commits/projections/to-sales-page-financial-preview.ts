import type { FinancialCaseSummary } from "@/modules/financial-cases/financial-case-summary.types";
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
  const baseline =
    financialCase.stage === "active"
      ? {
          stage: financialCase.stage,
          financialCaseId: financialCase.financialCaseId,
          depositInvoice: financialCase.depositInvoice,
          finalInvoice: financialCase.finalInvoice,
          finalizedAdjustments: financialCase.finalizedAdjustments,
          creditNotes: financialCase.creditNotes,
          refunds: financialCase.refunds,
          customerTotal: financialCase.customerTotal,
          finalTotal: financialCase.finalTotal,
          depositApplied: financialCase.depositApplied,
          paidSoFar: financialCase.paidSoFar,
          effectivePaid: financialCase.effectivePaid,
          remaining: financialCase.remaining,
          totalAdjustments: financialCase.totalAdjustments,
          outstandingAmount: financialCase.remaining,
          isFullySettled:
            financialCase.paymentStatusEnum === "PAID" &&
            financialCase.remaining <= SETTLEMENT_EPSILON,
          paymentStatusEnum: financialCase.paymentStatusEnum,
          collectPaymentTargetInvoiceId:
            findNextUnsettledChargeInvoiceId(financialCase),
        }
      : {
          stage: financialCase.stage,
          financialCaseId: financialCase.financialCaseId,
          depositInvoice: financialCase.depositInvoice,
          finalInvoice: null,
          finalizedAdjustments: [],
          creditNotes: [],
          refunds: [],
          customerTotal: null,
          finalTotal: null,
          depositApplied: null,
          paidSoFar: null,
          effectivePaid: null,
          remaining: null,
          totalAdjustments: null,
          outstandingAmount: null,
          isFullySettled: false,
          paymentStatusEnum: null,
          collectPaymentTargetInvoiceId: null,
        };

  return {
    baseline,
    overlay: {
      previousTotal: preview?.totals.baselineTotal ?? null,
      pendingDelta: preview?.totals.netDelta ?? null,
      pendingTotal: preview?.totals.pendingTotal ?? null,
      requiresApproval: preview?.requiresApproval ?? null,
      approvalReasons: preview?.approvalReasons ?? null,
      documentPlan: preview?.documentPlan ?? null,
      paymentImpact: preview?.paymentImpact ?? null,
      refundImpact: preview?.refundImpact ?? null,
    },
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
