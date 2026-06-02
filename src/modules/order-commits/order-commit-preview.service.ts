import type { FinancialCaseSummary } from "@/modules/financial-cases/financial-case-summary.types";
import {
  buildOrderCommitApprovalAndDocumentPreview,
  type OrderCommitPreviewPaymentState,
} from "./order-commit-approval-document-preview.service";
import {
  resolveOrderCommitPreviewBaseline,
  type OrderCommitPreviewBaselineClient,
} from "./order-commit-preview-baseline.service";
import { classifyOrderCommitPreview } from "./order-commit-preview-classification.service";
import { diffOrderCommitSnapshots } from "./order-commit-preview-diff.service";
import { orderCommitPreviewSchema } from "./order-commit-preview.schema";
import {
  getOrderCommitDraft,
  type GetOrderCommitDraftInput,
} from "./order-commit.service";
import type { OrderCommitPreview } from "./order-commit-preview.types";

export type OrderCommitPreviewClient = OrderCommitPreviewBaselineClient &
  NonNullable<GetOrderCommitDraftInput["client"]>;

export type OrderCommitFinancialSummaryLoader = (input: {
  orderId: string;
}) => Promise<FinancialCaseSummary | null>;

export type GetOrderCommitPreviewInput = {
  orderId: string;
  client?: OrderCommitPreviewClient;
  financialSummaryLoader?: OrderCommitFinancialSummaryLoader;
};

export async function getOrderCommitPreview(
  input: GetOrderCommitPreviewInput
): Promise<OrderCommitPreview> {
  const draftState = await getOrderCommitDraft({
    orderId: input.orderId,
    client: input.client,
  });
  if (!draftState) {
    throw new Error(
      `OrderCommit preview failed: active draft for order ${input.orderId} was not found.`
    );
  }

  const baseline = await resolveOrderCommitPreviewBaseline({
    orderId: input.orderId,
    client: input.client,
  });
  const diff = diffOrderCommitSnapshots({
    baseSnapshot: baseline.snapshot,
    pendingSnapshot: draftState.pendingSnapshot,
  });
  const classification = classifyOrderCommitPreview({ diff });
  const paymentState = await loadOrderCommitPreviewPaymentState({
    orderId: input.orderId,
    financialSummaryLoader: input.financialSummaryLoader,
  });
  const approvalAndDocumentPreview = buildOrderCommitApprovalAndDocumentPreview({
    baselineSource: baseline.baselineSource,
    classification,
    paymentState,
  });

  return orderCommitPreviewSchema.parse({
    baselineSource: baseline.baselineSource,
    baselineCommitId: baseline.baselineCommitId,
    baselineSequence: baseline.baselineSequence,
    draftId: draftState.draft.id,
    draftVersion: draftState.draft.version,
    commitKind: classification.commitKind,
    lineDiffs: classification.lineDiffs,
    netDelta: classification.netDelta,
    requiresApproval: approvalAndDocumentPreview.requiresApproval,
    approvalReasons: approvalAndDocumentPreview.approvalReasons,
    documentPlan: approvalAndDocumentPreview.documentPlan,
    paymentImpact: approvalAndDocumentPreview.paymentImpact,
    refundImpact: approvalAndDocumentPreview.refundImpact,
    zeroNetReason: classification.zeroNetReason,
  });
}

async function loadOrderCommitPreviewPaymentState(input: {
  orderId: string;
  financialSummaryLoader?: OrderCommitFinancialSummaryLoader;
}): Promise<OrderCommitPreviewPaymentState> {
  const summary = await (input.financialSummaryLoader ??
    loadFinancialCaseSummary)({ orderId: input.orderId });
  if (!summary) {
    throw new Error(
      `OrderCommit preview failed: FinancialCase summary for order ${input.orderId} was not found.`
    );
  }

  if (summary.stage === "booking") {
    return {
      alreadyPaidAmount: summary.depositInvoice?.paidAmount ?? 0,
      currentRemainingAmount: 0,
      creditNoteCapacity: 0,
      overpaymentCapacity: 0,
    };
  }

  return {
    alreadyPaidAmount: summary.effectivePaid,
    currentRemainingAmount: summary.remaining,
    creditNoteCapacity: summary.creditNoteCapacity,
    overpaymentCapacity: summary.overpaymentCapacity,
  };
}

async function loadFinancialCaseSummary(input: {
  orderId: string;
}): Promise<FinancialCaseSummary | null> {
  const { getFinancialCaseSummary } = await import("@/modules/financial-cases");
  return getFinancialCaseSummary({ orderId: input.orderId });
}
