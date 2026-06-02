import { z } from "zod";
import {
  ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND,
} from "./order-commit-preview.constants";
import { orderCommitSnapshotV1Schema } from "./order-commit.schema";
import { orderCommitSnapshotDiffSchema } from "./order-commit-preview.schema";
import {
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
} from "./order-commit.constants";
import type {
  OrderCommitPreviewLineDiff,
  OrderCommitPreviewLineSummary,
  OrderCommitPreviewOperationalFlags,
  OrderCommitSnapshotDiff,
} from "./order-commit-preview.types";
import type {
  OrderCommitSnapshotLineV1,
  OrderCommitSnapshotV1,
} from "./order-commit.types";

export type DiffOrderCommitSnapshotsInput = {
  baseSnapshot: OrderCommitSnapshotV1;
  pendingSnapshot: OrderCommitSnapshotV1;
};

const ZERO_NET_MEANINGFUL_CHANGE_REASON =
  "MEANINGFUL_ZERO_NET_OPERATIONAL_CHANGE";

export function diffOrderCommitSnapshots(
  input: DiffOrderCommitSnapshotsInput
): OrderCommitSnapshotDiff {
  const baseSnapshot = orderCommitSnapshotV1Schema.parse(input.baseSnapshot);
  const pendingSnapshot = orderCommitSnapshotV1Schema.parse(input.pendingSnapshot);

  assertMatchingSnapshotIdentity(baseSnapshot, pendingSnapshot);

  const baseLinesByStableKey = linesByStableKey(baseSnapshot.lines);
  const pendingLinesByStableKey = linesByStableKey(pendingSnapshot.lines);
  const stableKeys = [...new Set([
    ...baseLinesByStableKey.keys(),
    ...pendingLinesByStableKey.keys(),
  ])].sort((left, right) => left.localeCompare(right));

  const lineDiffs = stableKeys.map((stableKey) =>
    lineDiff({
      stableKey,
      baselineLine: baseLinesByStableKey.get(stableKey) ?? null,
      pendingLine: pendingLinesByStableKey.get(stableKey) ?? null,
    })
  );
  const netDelta = roundMoney(
    lineDiffs.reduce((sum, diff) => sum + diff.moneyDelta, 0)
  );
  const hasMeaningfulChanges = lineDiffs.some(
    (diff) => diff.operationalFlags.isOperationallyMeaningful
  );

  return orderCommitSnapshotDiffSchema.parse({
    orderId: baseSnapshot.orderId,
    financialCaseId: baseSnapshot.financialCaseId,
    currency: baseSnapshot.currency,
    lineDiffs,
    netDelta,
    zeroNetReason:
      netDelta === 0 && hasMeaningfulChanges
        ? ZERO_NET_MEANINGFUL_CHANGE_REASON
        : null,
  });
}

function assertMatchingSnapshotIdentity(
  baseSnapshot: OrderCommitSnapshotV1,
  pendingSnapshot: OrderCommitSnapshotV1
): void {
  const checks: Array<keyof Pick<
    OrderCommitSnapshotV1,
    "schemaVersion" | "orderId" | "financialCaseId" | "currency"
  >> = ["schemaVersion", "orderId", "financialCaseId", "currency"];

  for (const field of checks) {
    if (baseSnapshot[field] !== pendingSnapshot[field]) {
      throw new Error(
        `OrderCommit snapshot diff failed: ${field} mismatch (${baseSnapshot[field]} vs ${pendingSnapshot[field]}).`
      );
    }
  }
}

function linesByStableKey(
  lines: OrderCommitSnapshotLineV1[]
): Map<string, OrderCommitSnapshotLineV1> {
  const byStableKey = new Map<string, OrderCommitSnapshotLineV1>();
  for (const line of lines) {
    if (byStableKey.has(line.stableKey)) {
      throw new Error(
        `OrderCommit snapshot diff failed: duplicate stableKey ${line.stableKey}.`
      );
    }
    byStableKey.set(line.stableKey, line);
  }
  return byStableKey;
}

function lineDiff(input: {
  stableKey: string;
  baselineLine: OrderCommitSnapshotLineV1 | null;
  pendingLine: OrderCommitSnapshotLineV1 | null;
}): OrderCommitPreviewLineDiff {
  const changeKind = lineChangeKind(input.baselineLine, input.pendingLine);
  const quantityDelta =
    (input.pendingLine?.quantity ?? 0) - (input.baselineLine?.quantity ?? 0);
  const moneyDelta = roundMoney(
    (input.pendingLine?.lineTotal ?? 0) - (input.baselineLine?.lineTotal ?? 0)
  );
  const lineKind = (input.pendingLine ?? input.baselineLine)?.lineKind;
  if (!lineKind) {
    throw new Error(
      `OrderCommit snapshot diff failed: missing line kind for ${input.stableKey}.`
    );
  }

  return {
    stableKey: input.stableKey,
    lineId: input.pendingLine?.lineId ?? input.baselineLine?.lineId ?? null,
    lineKind,
    changeKind,
    baselineLine: input.baselineLine
      ? lineSummary(input.baselineLine)
      : null,
    pendingLine: input.pendingLine ? lineSummary(input.pendingLine) : null,
    quantityDelta,
    moneyDelta,
    operationalFlags: operationalFlags({
      baselineLine: input.baselineLine,
      pendingLine: input.pendingLine,
      changeKind,
      moneyDelta,
    }),
  };
}

function lineChangeKind(
  baselineLine: OrderCommitSnapshotLineV1 | null,
  pendingLine: OrderCommitSnapshotLineV1 | null
): OrderCommitPreviewLineDiff["changeKind"] {
  if (!baselineLine && pendingLine) {
    return ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.ADDED;
  }
  if (baselineLine && !pendingLine) {
    return ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.REMOVED;
  }
  if (!baselineLine || !pendingLine) {
    throw new Error("OrderCommit snapshot diff failed: missing diff lines.");
  }
  if (isPackageIdentityChange(baselineLine, pendingLine)) {
    return ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.PACKAGE_CHANGED;
  }
  if (baselineLine.quantity !== pendingLine.quantity) {
    return ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.QUANTITY_CHANGED;
  }
  if (
    baselineLine.unitPrice !== pendingLine.unitPrice ||
    baselineLine.lineTotal !== pendingLine.lineTotal
  ) {
    return ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.PRICE_CHANGED;
  }
  if (!lineMetadataEquivalent(baselineLine, pendingLine)) {
    return ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.METADATA_CHANGED;
  }
  return ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.UNCHANGED;
}

function isPackageIdentityChange(
  baselineLine: OrderCommitSnapshotLineV1,
  pendingLine: OrderCommitSnapshotLineV1
): boolean {
  return (
    baselineLine.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE &&
    pendingLine.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE &&
    (baselineLine.catalogEntityId !== pendingLine.catalogEntityId ||
      baselineLine.label !== pendingLine.label)
  );
}

function lineMetadataEquivalent(
  baselineLine: OrderCommitSnapshotLineV1,
  pendingLine: OrderCommitSnapshotLineV1
): boolean {
  const baselineComparable = comparableLineMetadata(baselineLine);
  const pendingComparable = comparableLineMetadata(pendingLine);
  return stableJson(baselineComparable) === stableJson(pendingComparable);
}

function comparableLineMetadata(
  line: OrderCommitSnapshotLineV1
): Record<string, unknown> {
  return {
    lineKind: line.lineKind,
    orderEntityKind: line.orderEntityKind,
    orderEntityId: line.orderEntityId,
    parentOrderPackageId: line.parentOrderPackageId,
    catalogEntityId: line.catalogEntityId,
    label: line.label,
    priceSource: line.priceSource,
    metadata: line.metadata,
  };
}

function lineSummary(
  line: OrderCommitSnapshotLineV1
): OrderCommitPreviewLineSummary {
  return {
    stableKey: line.stableKey,
    lineId: line.lineId,
    lineKind: line.lineKind,
    orderEntityKind: line.orderEntityKind,
    orderEntityId: line.orderEntityId,
    parentOrderPackageId: line.parentOrderPackageId,
    catalogEntityId: line.catalogEntityId,
    label: line.label,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
    priceSource: line.priceSource,
    metadata: line.metadata,
  };
}

function operationalFlags(input: {
  baselineLine: OrderCommitSnapshotLineV1 | null;
  pendingLine: OrderCommitSnapshotLineV1 | null;
  changeKind: OrderCommitPreviewLineDiff["changeKind"];
  moneyDelta: number;
}): OrderCommitPreviewOperationalFlags {
  const line = input.pendingLine ?? input.baselineLine;
  if (!line) {
    throw new Error("OrderCommit snapshot diff failed: missing line for flags.");
  }
  const isPackageLine = line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE;
  const isPackageChange =
    isPackageLine &&
    input.changeKind !== ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.UNCHANGED;
  const isOperationallyMeaningful =
    input.changeKind !== ORDER_COMMIT_PREVIEW_LINE_CHANGE_KIND.UNCHANGED;

  return {
    isPackageChange,
    isPackageUpgrade: isPackageChange && input.moneyDelta > 0,
    isPackageDowngrade: isPackageChange && input.moneyDelta < 0,
    isPackageSwap:
      isPackageLine &&
      Boolean(input.baselineLine) &&
      Boolean(input.pendingLine) &&
      isPackageIdentityChange(
        input.baselineLine as OrderCommitSnapshotLineV1,
        input.pendingLine as OrderCommitSnapshotLineV1
      ),
    isAddOnChange:
      line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON &&
      isOperationallyMeaningful,
    isPackageItemUpgradeChange:
      line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE &&
      isOperationallyMeaningful,
    isPhotoChange:
      (line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA ||
        packagePhotoMetadataChanged(input.baselineLine, input.pendingLine)) &&
      isOperationallyMeaningful,
    isSessionConfigurationChange:
      line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION &&
      isOperationallyMeaningful,
    isLinkedProductChange:
      line.lineKind ===
        ORDER_COMMIT_SNAPSHOT_LINE_KIND
          .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON &&
      isOperationallyMeaningful,
    isFinanciallyRelevant: input.moneyDelta !== 0,
    isOperationallyMeaningful,
  };
}

function packagePhotoMetadataChanged(
  baselineLine: OrderCommitSnapshotLineV1 | null,
  pendingLine: OrderCommitSnapshotLineV1 | null
): boolean {
  const line = pendingLine ?? baselineLine;
  if (line?.lineKind !== ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE) return false;

  return [
    "selectedPhotoCount",
    "includedPhotoCount",
    "extraDigitalCount",
    "extraPrintCount",
  ].some(
    (key) =>
      metadataValue(baselineLine, key) !== metadataValue(pendingLine, key)
  );
}

function metadataValue(
  line: OrderCommitSnapshotLineV1 | null,
  key: string
): unknown {
  return line?.metadata[key];
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJsonValue(nested)])
    );
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function roundMoney(value: number): number {
  return z.number().finite().parse(Number(value.toFixed(3)));
}
