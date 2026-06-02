import { z } from "zod";
import {
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE,
  ORDER_COMMIT_PREVIEW_COMMIT_KIND,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
  ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND,
} from "./order-commit-preview.constants";
import {
  orderCommitApprovalAndDocumentPreviewSchema,
  orderCommitPreviewBaselineSourceSchema,
  orderCommitPreviewClassificationSchema,
} from "./order-commit-preview.schema";
import type {
  OrderCommitApprovalAndDocumentPreview,
  OrderCommitPreviewBaselineSource,
  OrderCommitPreviewClassification,
} from "./order-commit-preview.types";

const rawMoneySchema = z.number().finite();
const nonnegativeMoneySchema = rawMoneySchema.nonnegative();

const orderCommitPreviewPaymentStateSchema = z
  .object({
    alreadyPaidAmount: nonnegativeMoneySchema,
    currentRemainingAmount: rawMoneySchema,
    creditNoteCapacity: nonnegativeMoneySchema,
    overpaymentCapacity: nonnegativeMoneySchema,
  })
  .strict();

export type OrderCommitPreviewPaymentState = z.infer<
  typeof orderCommitPreviewPaymentStateSchema
>;

export type BuildOrderCommitApprovalAndDocumentPreviewInput = {
  classification: OrderCommitPreviewClassification;
  baselineSource: OrderCommitPreviewBaselineSource;
  paymentState: OrderCommitPreviewPaymentState;
};

const REDUCTION_APPROVAL_REASON = {
  code: "ORDER_COMMIT_REDUCTION_REQUIRES_APPROVAL",
  message: "Manager approval is required for order commit reductions.",
} as const;

export function buildOrderCommitApprovalAndDocumentPreview(
  input: BuildOrderCommitApprovalAndDocumentPreviewInput
): OrderCommitApprovalAndDocumentPreview {
  const classification = orderCommitPreviewClassificationSchema.parse(
    input.classification
  );
  const baselineSource = orderCommitPreviewBaselineSourceSchema.parse(
    input.baselineSource
  );
  const paymentState = orderCommitPreviewPaymentStateSchema.parse(
    input.paymentState
  );

  if (classification.commitKind === ORDER_COMMIT_PREVIEW_COMMIT_KIND.NO_OP) {
    return noFinancialDocumentPreview(paymentState, "NO_OPERATIONAL_CHANGE");
  }

  if (
    classification.commitKind === ORDER_COMMIT_PREVIEW_COMMIT_KIND.ZERO_NET_AUDIT
  ) {
    return noFinancialDocumentPreview(
      paymentState,
      classification.zeroNetReason ?? "MEANINGFUL_ZERO_NET_OPERATIONAL_CHANGE",
      ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ZERO_NET_AUDIT_COMMIT
    );
  }

  if (classification.netDelta > 0) {
    return positiveDeltaPreview({ baselineSource, classification, paymentState });
  }

  if (classification.netDelta < 0) {
    return reductionPreview({ classification, paymentState });
  }

  return noFinancialDocumentPreview(paymentState, "NO_FINANCIAL_DELTA");
}

function positiveDeltaPreview(input: {
  baselineSource: OrderCommitPreviewBaselineSource;
  classification: OrderCommitPreviewClassification;
  paymentState: OrderCommitPreviewPaymentState;
}): OrderCommitApprovalAndDocumentPreview {
  const amount = roundMoney(input.classification.netDelta);
  const documentKind =
    input.baselineSource ===
    ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT
      ? ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ADJUSTMENT_INVOICE
      : ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.BASE_INVOICE;
  const remainingAfterCommit = roundMoney(
    input.paymentState.currentRemainingAmount + amount
  );

  return orderCommitApprovalAndDocumentPreviewSchema.parse({
    requiresApproval: false,
    approvalReasons: [],
    documentPlan: {
      kind: documentKind,
      amount,
      requiresPaymentCollection: amount > 0,
      requiresRefundReview: false,
      reason: null,
    },
    paymentImpact: {
      kind: ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.PAYMENT_DUE,
      amountDue: amount,
      creditAmount: 0,
      alreadyPaidAmount: input.paymentState.alreadyPaidAmount,
      remainingAfterCommit,
    },
    refundImpact: {
      refundRequired: false,
      refundableAmount: 0,
      creditNoteAmount: 0,
      reason: null,
    },
  });
}

function reductionPreview(input: {
  classification: OrderCommitPreviewClassification;
  paymentState: OrderCommitPreviewPaymentState;
}): OrderCommitApprovalAndDocumentPreview {
  const reductionAmount = roundMoney(Math.abs(input.classification.netDelta));
  const remainingAfterCommit = roundMoney(
    input.paymentState.currentRemainingAmount - reductionAmount
  );
  const refundAmount = roundMoney(Math.max(-remainingAfterCommit, 0));
  const needsRefundReview = refundAmount > 0;

  return orderCommitApprovalAndDocumentPreviewSchema.parse({
    requiresApproval: true,
    approvalReasons: [REDUCTION_APPROVAL_REASON],
    documentPlan: {
      kind: needsRefundReview
        ? ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.REFUND_NEEDED
        : ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.CREDIT_NOTE,
      amount: reductionAmount,
      requiresPaymentCollection: false,
      requiresRefundReview: needsRefundReview,
      reason: needsRefundReview
        ? "REDUCTION_EXCEEDS_CURRENT_REMAINING_BALANCE"
        : null,
    },
    paymentImpact: {
      kind: needsRefundReview
        ? ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.REFUND_REVIEW_NEEDED
        : ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.CREDIT_AVAILABLE,
      amountDue: 0,
      creditAmount: reductionAmount,
      alreadyPaidAmount: input.paymentState.alreadyPaidAmount,
      remainingAfterCommit,
    },
    refundImpact: {
      refundRequired: needsRefundReview,
      refundableAmount: refundAmount,
      creditNoteAmount: reductionAmount,
      reason: needsRefundReview
        ? "ORDER_COMMIT_REDUCTION_CREATES_REFUND_REVIEW"
        : null,
    },
  });
}

function noFinancialDocumentPreview(
  paymentState: OrderCommitPreviewPaymentState,
  reason: string,
  kind:
    | typeof ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.NO_OP
    | typeof ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ZERO_NET_AUDIT_COMMIT = ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.NO_OP
): OrderCommitApprovalAndDocumentPreview {
  return orderCommitApprovalAndDocumentPreviewSchema.parse({
    requiresApproval: false,
    approvalReasons: [],
    documentPlan: {
      kind,
      amount: 0,
      requiresPaymentCollection: false,
      requiresRefundReview: false,
      reason,
    },
    paymentImpact: {
      kind: ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.NONE,
      amountDue: 0,
      creditAmount: 0,
      alreadyPaidAmount: paymentState.alreadyPaidAmount,
      remainingAfterCommit: paymentState.currentRemainingAmount,
    },
    refundImpact: {
      refundRequired: false,
      refundableAmount: 0,
      creditNoteAmount: 0,
      reason: null,
    },
  });
}

function roundMoney(value: number): number {
  return z.number().finite().parse(Number(value.toFixed(3)));
}
