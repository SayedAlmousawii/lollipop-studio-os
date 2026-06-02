import type { z } from "zod";
import type {
  ORDER_COMMIT_PREVIEW_BASELINE_SOURCE,
  ORDER_COMMIT_PREVIEW_COMMIT_KIND,
  ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND,
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND,
  ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND,
} from "./order-commit-preview.constants";
import type {
  orderCommitApprovalAndDocumentPreviewSchema,
  orderCommitApprovalReasonSchema,
  orderCommitDocumentPlanPreviewSchema,
  orderCommitPaymentImpactSchema,
  orderCommitPreviewBaselineSchema,
  orderCommitPreviewClassificationSchema,
  orderCommitPreviewLineDiffSchema,
  orderCommitPreviewLineSummarySchema,
  orderCommitPreviewOperationalFlagsSchema,
  orderCommitPreviewSchema,
  orderCommitRefundImpactSchema,
  orderCommitSnapshotDiffSchema,
} from "./order-commit-preview.schema";

export type OrderCommitPreviewBaselineSource =
  (typeof ORDER_COMMIT_PREVIEW_BASELINE_SOURCE)[keyof typeof ORDER_COMMIT_PREVIEW_BASELINE_SOURCE];

export type OrderCommitPreviewLineChangeKind =
  (typeof ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND)[keyof typeof ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND];

export type OrderCommitPreviewCommitKind =
  (typeof ORDER_COMMIT_PREVIEW_COMMIT_KIND)[keyof typeof ORDER_COMMIT_PREVIEW_COMMIT_KIND];

export type OrderCommitPreviewDocumentPlanKind =
  (typeof ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND)[keyof typeof ORDER_COMMIT_PREVIEW_DOCUMENT_PLAN_KIND];

export type OrderCommitPreviewPaymentImpactKind =
  (typeof ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND)[keyof typeof ORDER_COMMIT_PREVIEW_PAYMENT_IMPACT_KIND];

export type OrderCommitPreviewBaseline = z.infer<
  typeof orderCommitPreviewBaselineSchema
>;

export type OrderCommitPreviewLineSummary = z.infer<
  typeof orderCommitPreviewLineSummarySchema
>;

export type OrderCommitPreviewOperationalFlags = z.infer<
  typeof orderCommitPreviewOperationalFlagsSchema
>;

export type OrderCommitPreviewLineDiff = z.infer<
  typeof orderCommitPreviewLineDiffSchema
>;

export type OrderCommitSnapshotDiff = z.infer<
  typeof orderCommitSnapshotDiffSchema
>;

export type OrderCommitPreviewClassification = z.infer<
  typeof orderCommitPreviewClassificationSchema
>;

export type OrderCommitApprovalReason = z.infer<
  typeof orderCommitApprovalReasonSchema
>;

export type OrderCommitDocumentPlanPreview = z.infer<
  typeof orderCommitDocumentPlanPreviewSchema
>;

export type OrderCommitPaymentImpact = z.infer<
  typeof orderCommitPaymentImpactSchema
>;

export type OrderCommitRefundImpact = z.infer<
  typeof orderCommitRefundImpactSchema
>;

export type OrderCommitApprovalAndDocumentPreview = z.infer<
  typeof orderCommitApprovalAndDocumentPreviewSchema
>;

export type OrderCommitPreview = z.infer<typeof orderCommitPreviewSchema>;
