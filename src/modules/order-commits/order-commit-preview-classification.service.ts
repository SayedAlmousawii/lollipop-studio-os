import {
  ORDER_COMMIT_PREVIEW_COMMIT_KIND,
} from "./order-commit-preview.constants";
import {
  orderCommitPreviewClassificationSchema,
  orderCommitSnapshotDiffSchema,
} from "./order-commit-preview.schema";
import type {
  OrderCommitPreviewClassification,
  OrderCommitPreviewOperationalFlags,
  OrderCommitSnapshotDiff,
} from "./order-commit-preview.types";

export type ClassifyOrderCommitPreviewInput = {
  diff: OrderCommitSnapshotDiff;
};

const EMPTY_OPERATIONAL_FLAGS: OrderCommitPreviewOperationalFlags = {
  isPackageChange: false,
  isPackageUpgrade: false,
  isPackageDowngrade: false,
  isPackageSwap: false,
  isAddOnChange: false,
  isPackageItemUpgradeChange: false,
  isPhotoChange: false,
  isSessionConfigurationChange: false,
  isLinkedProductChange: false,
  isFinanciallyRelevant: false,
  isOperationallyMeaningful: false,
};

export function classifyOrderCommitPreview(
  input: ClassifyOrderCommitPreviewInput
): OrderCommitPreviewClassification {
  const diff = orderCommitSnapshotDiffSchema.parse(input.diff);
  const operationalFlags = aggregateOperationalFlags(diff);

  return orderCommitPreviewClassificationSchema.parse({
    commitKind: commitKindForDiff(diff, operationalFlags),
    lineDiffs: diff.lineDiffs,
    netDelta: diff.netDelta,
    operationalFlags,
    zeroNetReason: diff.zeroNetReason,
  });
}

function commitKindForDiff(
  diff: OrderCommitSnapshotDiff,
  operationalFlags: OrderCommitPreviewOperationalFlags
): OrderCommitPreviewClassification["commitKind"] {
  if (!operationalFlags.isOperationallyMeaningful) {
    return ORDER_COMMIT_PREVIEW_COMMIT_KIND.NO_OP;
  }
  if (diff.netDelta === 0) {
    return ORDER_COMMIT_PREVIEW_COMMIT_KIND.ZERO_NET_AUDIT;
  }
  if (diff.netDelta > 0) {
    return ORDER_COMMIT_PREVIEW_COMMIT_KIND.ADJUSTMENT_INVOICE;
  }
  return ORDER_COMMIT_PREVIEW_COMMIT_KIND.CREDIT_NOTE;
}

function aggregateOperationalFlags(
  diff: OrderCommitSnapshotDiff
): OrderCommitPreviewOperationalFlags {
  return diff.lineDiffs.reduce<OrderCommitPreviewOperationalFlags>(
    (aggregate, lineDiff) => ({
      isPackageChange:
        aggregate.isPackageChange || lineDiff.operationalFlags.isPackageChange,
      isPackageUpgrade:
        aggregate.isPackageUpgrade || lineDiff.operationalFlags.isPackageUpgrade,
      isPackageDowngrade:
        aggregate.isPackageDowngrade ||
        lineDiff.operationalFlags.isPackageDowngrade,
      isPackageSwap:
        aggregate.isPackageSwap || lineDiff.operationalFlags.isPackageSwap,
      isAddOnChange:
        aggregate.isAddOnChange || lineDiff.operationalFlags.isAddOnChange,
      isPackageItemUpgradeChange:
        aggregate.isPackageItemUpgradeChange ||
        lineDiff.operationalFlags.isPackageItemUpgradeChange,
      isPhotoChange:
        aggregate.isPhotoChange || lineDiff.operationalFlags.isPhotoChange,
      isSessionConfigurationChange:
        aggregate.isSessionConfigurationChange ||
        lineDiff.operationalFlags.isSessionConfigurationChange,
      isLinkedProductChange:
        aggregate.isLinkedProductChange ||
        lineDiff.operationalFlags.isLinkedProductChange,
      isFinanciallyRelevant:
        aggregate.isFinanciallyRelevant ||
        lineDiff.operationalFlags.isFinanciallyRelevant,
      isOperationallyMeaningful:
        aggregate.isOperationallyMeaningful ||
        lineDiff.operationalFlags.isOperationallyMeaningful,
    }),
    EMPTY_OPERATIONAL_FLAGS
  );
}
