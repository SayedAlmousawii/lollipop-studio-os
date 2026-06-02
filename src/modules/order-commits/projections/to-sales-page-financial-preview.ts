import type { FinancialCaseSummary } from "@/modules/financial-cases/financial-case-summary.types";
import type { OrderCommitPreview } from "../order-commit-preview.types";
import type { SalesPageFinancialPreview } from "./sales-page-view.types";

export type ToSalesPageFinancialPreviewInput = {
  preview: OrderCommitPreview | null;
  financialCase: FinancialCaseSummary;
};

export function toSalesPageFinancialPreview({
  preview,
  financialCase,
}: ToSalesPageFinancialPreviewInput): SalesPageFinancialPreview {
  return {
    baseline:
      financialCase.stage === "active"
        ? {
            stage: financialCase.stage,
            financialCaseId: financialCase.financialCaseId,
            depositInvoice: financialCase.depositInvoice,
            finalInvoice: financialCase.finalInvoice,
            customerTotal: financialCase.customerTotal,
            finalTotal: financialCase.finalTotal,
            depositApplied: financialCase.depositApplied,
            paidSoFar: financialCase.paidSoFar,
            effectivePaid: financialCase.effectivePaid,
            remaining: financialCase.remaining,
            paymentStatusEnum: financialCase.paymentStatusEnum,
            collectPaymentInvoiceId: financialCase.finalInvoice.id,
          }
        : {
            stage: financialCase.stage,
            financialCaseId: financialCase.financialCaseId,
            depositInvoice: financialCase.depositInvoice,
            finalInvoice: null,
            customerTotal: null,
            finalTotal: null,
            depositApplied: null,
            paidSoFar: null,
            effectivePaid: null,
            remaining: null,
            paymentStatusEnum: null,
            collectPaymentInvoiceId: null,
          },
    overlay: {
      previousTotal: null,
      pendingDelta: preview?.netDelta ?? null,
      pendingTotal: null,
      requiresApproval: preview?.requiresApproval ?? null,
      approvalReasons: preview?.approvalReasons ?? null,
      documentPlan: preview?.documentPlan ?? null,
      paymentImpact: preview?.paymentImpact ?? null,
      refundImpact: preview?.refundImpact ?? null,
    },
  };
}
