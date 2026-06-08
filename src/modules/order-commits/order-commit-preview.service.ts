import type { FinancialCaseSummary } from "@/modules/financial-cases/financial-case-summary.types";
import {
  deriveCustomerSettlementFromFinancialCaseSummary,
} from "@/modules/financial-cases/customer-settlement.calculation";
import {
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE,
} from "./order-commit-preview.constants";
import {
  buildOrderCommitApprovalAndDocumentPreview,
  type OrderCommitPreviewFinalInvoiceMode,
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
  const totals = buildOrderCommitPreviewTotals({
    baseline,
    pendingSnapshotNetTotal: draftState.pendingSnapshot.totals.netTotal,
  });
  if (totals.netDelta !== classification.netDelta) {
    throw new Error(
      `OrderCommit preview failed: totals netDelta ${totals.netDelta.toFixed(
        3
      )} does not match classification netDelta ${classification.netDelta.toFixed(
        3
      )} for order ${input.orderId}.`
    );
  }
  const financialState = await loadOrderCommitPreviewFinancialState({
    orderId: input.orderId,
    financialSummaryLoader: input.financialSummaryLoader,
  });
  const approvalAndDocumentPreview = buildOrderCommitApprovalAndDocumentPreview({
    baselineSource: baseline.baselineSource,
    classification,
    finalInvoiceMode: financialState.finalInvoiceMode,
    paymentState: financialState.paymentState,
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
    totals,
    requiresApproval: approvalAndDocumentPreview.requiresApproval,
    approvalReasons: approvalAndDocumentPreview.approvalReasons,
    documentPlan: approvalAndDocumentPreview.documentPlan,
    paymentImpact: approvalAndDocumentPreview.paymentImpact,
    refundImpact: approvalAndDocumentPreview.refundImpact,
    zeroNetReason: classification.zeroNetReason,
  });
}

function buildOrderCommitPreviewTotals(input: {
  baseline: Awaited<ReturnType<typeof resolveOrderCommitPreviewBaseline>>;
  pendingSnapshotNetTotal: number;
}): OrderCommitPreview["totals"] {
  const baselineTotal =
    input.baseline.baselineSource === ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.EMPTY
      ? 0
      : input.baseline.snapshot.totals.netTotal;
  const pendingTotal = input.pendingSnapshotNetTotal;
  return {
    baselineTotal,
    netDelta: roundMoney(pendingTotal - baselineTotal),
    pendingTotal,
  };
}

async function loadOrderCommitPreviewFinancialState(input: {
  orderId: string;
  financialSummaryLoader?: OrderCommitFinancialSummaryLoader;
}): Promise<{
  finalInvoiceMode: OrderCommitPreviewFinalInvoiceMode;
  paymentState: OrderCommitPreviewPaymentState;
}> {
  const summary = await (input.financialSummaryLoader ??
    loadFinancialCaseSummary)({ orderId: input.orderId });
  if (!summary) {
    throw new Error(
      `OrderCommit preview failed: FinancialCase summary for order ${input.orderId} was not found.`
    );
  }

  if (summary.stage === "booking") {
    return {
      finalInvoiceMode: "CREATE_BASE",
      paymentState: {
        alreadyPaidAmount: summary.depositInvoice?.paidAmount ?? 0,
        currentRemainingAmount: 0,
        creditNoteCapacity: 0,
        overpaymentCapacity: 0,
        availableCredit: 0,
      },
    };
  }
  const settlement = deriveCustomerSettlementFromFinancialCaseSummary(summary);

  return {
    finalInvoiceMode: summary.finalInvoice.isLocked
      ? "EMIT_ADJUSTMENT"
      : "REBUILD_UNLOCKED",
    paymentState: {
      alreadyPaidAmount: summary.effectivePaid,
      currentRemainingAmount: settlement.remainingDue,
      creditNoteCapacity: summary.creditNoteCapacity,
      overpaymentCapacity: summary.overpaymentCapacity,
      availableCredit: settlement.availableCredit,
    },
  };
}

async function loadFinancialCaseSummary(input: {
  orderId: string;
}): Promise<FinancialCaseSummary | null> {
  const { getFinancialCaseSummary } = await import("@/modules/financial-cases");
  return getFinancialCaseSummary({ orderId: input.orderId });
}

function roundMoney(value: number): number {
  return Number(value.toFixed(3));
}
