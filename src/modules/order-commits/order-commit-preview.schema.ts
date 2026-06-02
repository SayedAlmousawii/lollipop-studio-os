import { z } from "zod";
import {
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE,
  ORDER_COMMIT_PREVIEW_COMMIT_KIND,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND,
  ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND,
} from "./order-commit-preview.constants";
import {
  orderCommitOrderEntityKindSchema,
  orderCommitPriceSourceSchema,
  orderCommitSnapshotLineKindSchema,
  orderCommitSnapshotV1Schema,
} from "./order-commit.schema";

const rawMoneySchema = z.number().finite();
const nonnegativeMoneySchema = rawMoneySchema.nonnegative();

export const orderCommitPreviewBaselineSourceSchema = z.enum([
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.LATEST_ORDER_COMMIT,
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.ORIGINAL_ORDER_COMPOSITION,
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE.EMPTY,
]);

export const orderCommitPreviewLineChangeKindSchema = z.enum([
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED,
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.REMOVED,
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.QUANTITY_CHANGED,
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.PRICE_CHANGED,
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.PACKAGE_CHANGED,
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.METADATA_CHANGED,
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.UNCHANGED,
]);

export const orderCommitPreviewCommitKindSchema = z.enum([
  ORDER_COMMIT_PREVIEW_COMMIT_KIND.BASE_INVOICE,
  ORDER_COMMIT_PREVIEW_COMMIT_KIND.ADJUSTMENT_INVOICE,
  ORDER_COMMIT_PREVIEW_COMMIT_KIND.CREDIT_NOTE,
  ORDER_COMMIT_PREVIEW_COMMIT_KIND.REFUND_NEEDED,
  ORDER_COMMIT_PREVIEW_COMMIT_KIND.ZERO_NET_AUDIT,
  ORDER_COMMIT_PREVIEW_COMMIT_KIND.NO_OP,
]);

export const orderCommitPreviewDocumentPlanKindSchema = z.enum([
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.BASE_INVOICE,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ADJUSTMENT_INVOICE,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.CREDIT_NOTE,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.REFUND_NEEDED,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.ZERO_NET_AUDIT_COMMIT,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND.NO_OP,
]);

export const orderCommitPreviewPaymentImpactKindSchema = z.enum([
  ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.NONE,
  ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.PAYMENT_DUE,
  ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.CREDIT_AVAILABLE,
  ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND.REFUND_REVIEW_NEEDED,
]);

export const orderCommitPreviewBaselineSchema = z
  .object({
    baselineSource: orderCommitPreviewBaselineSourceSchema,
    baselineCommitId: z.string().min(1).nullable(),
    baselineSequence: z.number().int().nonnegative().nullable(),
    snapshot: orderCommitSnapshotV1Schema,
  })
  .strict();

export const orderCommitPreviewLineSummarySchema = z
  .object({
    stableKey: z.string().min(1),
    lineId: z.string().min(1),
    lineKind: orderCommitSnapshotLineKindSchema,
    orderEntityKind: orderCommitOrderEntityKindSchema,
    orderEntityId: z.string().min(1),
    parentOrderPackageId: z.string().min(1).nullable(),
    catalogEntityId: z.string().min(1).nullable(),
    label: z.string().min(1),
    quantity: z.number().int().nonnegative(),
    unitPrice: rawMoneySchema,
    lineTotal: rawMoneySchema,
    priceSource: orderCommitPriceSourceSchema,
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

export const orderCommitPreviewOperationalFlagsSchema = z
  .object({
    isPackageChange: z.boolean(),
    isPackageUpgrade: z.boolean(),
    isPackageDowngrade: z.boolean(),
    isPackageSwap: z.boolean(),
    isAddOnChange: z.boolean(),
    isPackageItemUpgradeChange: z.boolean(),
    isPhotoChange: z.boolean(),
    isSessionConfigurationChange: z.boolean(),
    isLinkedProductChange: z.boolean(),
    isFinanciallyRelevant: z.boolean(),
    isOperationallyMeaningful: z.boolean(),
  })
  .strict();

export const orderCommitPreviewLineDiffSchema = z
  .object({
    stableKey: z.string().min(1),
    lineId: z.string().min(1).nullable(),
    lineKind: orderCommitSnapshotLineKindSchema,
    changeKind: orderCommitPreviewLineChangeKindSchema,
    baselineLine: orderCommitPreviewLineSummarySchema.nullable(),
    pendingLine: orderCommitPreviewLineSummarySchema.nullable(),
    quantityDelta: z.number().int(),
    moneyDelta: rawMoneySchema,
    operationalFlags: orderCommitPreviewOperationalFlagsSchema,
  })
  .strict();

export const orderCommitSnapshotDiffSchema = z
  .object({
    orderId: z.string().min(1),
    financialCaseId: z.string().min(1),
    currency: z.literal("KWD"),
    lineDiffs: z.array(orderCommitPreviewLineDiffSchema),
    netDelta: rawMoneySchema,
    zeroNetReason: z.string().min(1).nullable(),
  })
  .strict();

export const orderCommitPreviewClassificationSchema = z
  .object({
    commitKind: orderCommitPreviewCommitKindSchema,
    lineDiffs: z.array(orderCommitPreviewLineDiffSchema),
    netDelta: rawMoneySchema,
    operationalFlags: orderCommitPreviewOperationalFlagsSchema,
    zeroNetReason: z.string().min(1).nullable(),
  })
  .strict();

export const orderCommitApprovalReasonSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export const orderCommitDocumentPlanPreviewSchema = z
  .object({
    kind: orderCommitPreviewDocumentPlanKindSchema,
    amount: nonnegativeMoneySchema,
    requiresPaymentCollection: z.boolean(),
    requiresRefundReview: z.boolean(),
    reason: z.string().min(1).nullable(),
  })
  .strict();

export const orderCommitPaymentImpactSchema = z
  .object({
    kind: orderCommitPreviewPaymentImpactKindSchema,
    amountDue: nonnegativeMoneySchema,
    creditAmount: nonnegativeMoneySchema,
    alreadyPaidAmount: nonnegativeMoneySchema,
    remainingAfterCommit: rawMoneySchema,
  })
  .strict();

export const orderCommitRefundImpactSchema = z
  .object({
    refundRequired: z.boolean(),
    refundableAmount: nonnegativeMoneySchema,
    creditNoteAmount: nonnegativeMoneySchema,
    reason: z.string().min(1).nullable(),
  })
  .strict();

export const orderCommitApprovalAndDocumentPreviewSchema = z
  .object({
    requiresApproval: z.boolean(),
    approvalReasons: z.array(orderCommitApprovalReasonSchema),
    documentPlan: orderCommitDocumentPlanPreviewSchema,
    paymentImpact: orderCommitPaymentImpactSchema,
    refundImpact: orderCommitRefundImpactSchema,
  })
  .strict();

export const orderCommitPreviewSchema = z
  .object({
    baselineSource: orderCommitPreviewBaselineSourceSchema,
    baselineCommitId: z.string().min(1).nullable(),
    baselineSequence: z.number().int().nonnegative().nullable(),
    draftId: z.string().min(1),
    draftVersion: z.number().int().nonnegative(),
    commitKind: orderCommitPreviewCommitKindSchema,
    lineDiffs: z.array(orderCommitPreviewLineDiffSchema),
    netDelta: rawMoneySchema,
    requiresApproval: z.boolean(),
    approvalReasons: z.array(orderCommitApprovalReasonSchema),
    documentPlan: orderCommitDocumentPlanPreviewSchema,
    paymentImpact: orderCommitPaymentImpactSchema,
    refundImpact: orderCommitRefundImpactSchema,
    zeroNetReason: z.string().min(1).nullable(),
  })
  .strict();
