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
    availableCredit: nonnegativeMoneySchema,
  })
  .strict();

export type OrderCommitPreviewPaymentState = z.infer<
  typeof orderCommitPreviewPaymentStateSchema
>;

export type BuildOrderCommitApprovalAndDocumentPreviewInput = {
  classification: OrderCommitPreviewClassification;
  baselineSource: OrderCommitPreviewBaselineSource;
  finalInvoiceMode?: OrderCommitPreviewFinalInvoiceMode;
  paymentState: OrderCommitPreviewPaymentState;
};

export type OrderCommitPreviewFinalInvoiceMode =
  | "CREATE_BASE"
  | "REBUILD_UNLOCKED"
  | "EMIT_ADJUSTMENT";

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
  const finalInvoiceMode =
    input.finalInvoiceMode ?? defaultFinalInvoiceMode(baselineSource);

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
    return positiveDeltaPreview({
      finalInvoiceMode,
      classification,
      paymentState,
    });
  }

  if (classification.netDelta < 0) {
    return reductionPreview({ finalInvoiceMode, classification, paymentState });
  }

  return noFinancialDocumentPreview(paymentState, "NO_FINANCIAL_DELTA");
}

function positiveDeltaPreview(input: {
  finalInvoiceMode: OrderCommitPreviewFinalInvoiceMode;
  classification: OrderCommitPreviewClassification;
  paymentState: OrderCommitPreviewPaymentState;
}): OrderCommitApprovalAndDocumentPreview {
  const amount = roundMoney(input.classification.netDelta);
  const availableCreditForCommit =
    input.finalInvoiceMode === "EMIT_ADJUSTMENT"
      ? input.paymentState.availableCredit
      : 0;
  const consumedCredit = roundMoney(
    Math.min(amount, availableCreditForCommit)
  );
  const amountDue = roundMoney(amount - consumedCredit);
  const documentKind = documentPlanKindForPositiveDelta(input.finalInvoiceMode);
  const remainingAfterCommit = roundMoney(
    input.paymentState.currentRemainingAmount + amount - consumedCredit
  );

  return orderCommitApprovalAndDocumentPreviewSchema.parse({
    requiresApproval: false,
    approvalReasons: [],
    documentPlan: {
      kind: documentKind,
      amount,
      requiresPaymentCollection: amountDue > 0,
      requiresRefundReview: false,
      reason: null,
    },
    paymentImpact: {
      kind:
        amountDue > 0
          ? ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.PAYMENT_DUE
          : ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.NONE,
      amountDue,
      creditAmount: consumedCredit,
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
  finalInvoiceMode: OrderCommitPreviewFinalInvoiceMode;
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
      kind: documentPlanKindForReduction({
        finalInvoiceMode: input.finalInvoiceMode,
        needsRefundReview,
      }),
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

function defaultFinalInvoiceMode(
  baselineSource: OrderCommitPreviewBaselineSource
): OrderCommitPreviewFinalInvoiceMode {
  return baselineSource === ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT
    ? "EMIT_ADJUSTMENT"
    : "CREATE_BASE";
}

function documentPlanKindForPositiveDelta(
  mode: OrderCommitPreviewFinalInvoiceMode
) {
  if (mode === "CREATE_BASE") {
    return ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.BASE_INVOICE;
  }
  if (mode === "REBUILD_UNLOCKED") {
    return ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.FINAL_INVOICE_REBUILD;
  }
  return ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ADJUSTMENT_INVOICE;
}

function documentPlanKindForReduction(input: {
  finalInvoiceMode: OrderCommitPreviewFinalInvoiceMode;
  needsRefundReview: boolean;
}) {
  if (input.finalInvoiceMode === "REBUILD_UNLOCKED") {
    return ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.FINAL_INVOICE_REBUILD;
  }
  return input.needsRefundReview
    ? ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.REFUND_NEEDED
    : ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.CREDIT_NOTE;
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
