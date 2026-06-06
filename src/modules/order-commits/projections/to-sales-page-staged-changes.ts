import {
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND,
} from "../order-commit-preview.constants";
import { ORDER_COMMIT_SNAPSHOT_LINE_KIND } from "../order-commit.constants";
import type {
  OrderCommitPreview,
  OrderCommitPreviewLineDiff,
} from "../order-commit-preview.types";
import type { SalesPageStagedChangesRow } from "./sales-page-view.types";

export type ToSalesPageStagedChangesInput = {
  preview: OrderCommitPreview | null;
};

export function toSalesPageStagedChanges({
  preview,
}: ToSalesPageStagedChangesInput): SalesPageStagedChangesRow[] {
  if (!preview) return [];

  const packageLabelsByOrderPackageId = packageLabelsById(preview.lineDiffs);

  return preview.lineDiffs
    .filter(
      (diff) =>
        diff.changeKind !== ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.UNCHANGED
    )
    .map((diff) => ({
      id: diff.stableKey,
      changeKind: diff.changeKind,
      label: stagedChangeLabel(diff),
      netDelta: diff.moneyDelta,
      parentLabel: parentLabel(diff, packageLabelsByOrderPackageId),
    }))
    .sort(compareStagedRows);
}

function stagedChangeLabel(diff: OrderCommitPreviewLineDiff): string {
  const previousLabel = diff.baselineLine?.label ?? null;
  const nextLabel = diff.pendingLine?.label ?? null;

  if (previousLabel && nextLabel && previousLabel !== nextLabel) {
    return `${previousLabel} -> ${nextLabel}`;
  }

  return nextLabel ?? previousLabel ?? diff.stableKey;
}

function parentLabel(
  diff: OrderCommitPreviewLineDiff,
  packageLabelsByOrderPackageId: Map<string, string>
): string | null {
  const metadata = diff.pendingLine?.metadata ?? diff.baselineLine?.metadata ?? {};
  const label =
    metadata.parentLabel ??
    metadata.packageLabel ??
    metadata.packageName ??
    metadata.currentPackageNameSnapshot ??
    metadata.originalPackageNameSnapshot;
  if (typeof label === "string" && label.length > 0) return label;

  const parentOrderPackageId =
    diff.pendingLine?.parentOrderPackageId ??
    diff.baselineLine?.parentOrderPackageId ??
    null;
  if (!parentOrderPackageId) return null;

  return (
    packageLabelsByOrderPackageId.get(parentOrderPackageId) ??
    parentOrderPackageId
  );
}

function compareStagedRows(
  left: SalesPageStagedChangesRow,
  right: SalesPageStagedChangesRow
): number {
  const categoryDelta =
    changeCategoryOrder(left.changeKind) - changeCategoryOrder(right.changeKind);
  if (categoryDelta !== 0) return categoryDelta;

  const parentDelta = (left.parentLabel ?? "").localeCompare(
    right.parentLabel ?? ""
  );
  if (parentDelta !== 0) return parentDelta;

  return left.id.localeCompare(right.id);
}

function changeCategoryOrder(
  changeKind: OrderCommitPreviewLineDiff["changeKind"]
): number {
  if (changeKind === ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED) return 0;
  if (changeKind === ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.REMOVED) return 2;
  return 1;
}

function packageLabelsById(
  diffs: OrderCommitPreviewLineDiff[]
): Map<string, string> {
  const labels = new Map<string, string>();

  for (const diff of diffs) {
    for (const line of [diff.baselineLine, diff.pendingLine]) {
      if (
        !line ||
        line.lineKind !== ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE ||
        line.orderEntityId.length === 0 ||
        line.label.length === 0
      ) {
        continue;
      }
      labels.set(line.orderEntityId, line.label);
    }
  }

  return labels;
}
