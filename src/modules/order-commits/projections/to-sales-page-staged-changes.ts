import {
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND,
} from "../order-commit-preview.constants";
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
      parentLabel: parentLabel(diff),
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

function parentLabel(diff: OrderCommitPreviewLineDiff): string | null {
  const metadata = diff.pendingLine?.metadata ?? diff.baselineLine?.metadata ?? {};
  const label = metadata.parentLabel ?? metadata.packageLabel;
  if (typeof label === "string" && label.length > 0) return label;
  return diff.pendingLine?.parentOrderPackageId ?? diff.baselineLine?.parentOrderPackageId ?? null;
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
