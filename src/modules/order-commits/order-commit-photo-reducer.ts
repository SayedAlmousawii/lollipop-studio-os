import {
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN,
} from "./order-commit-draft.constants";
import {
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
} from "./order-commit.constants";
import { normalizeOrderCommitSnapshot } from "./order-commit-snapshot-normalizer";
import { resolveOrderCommitDraftTargetLine } from "./order-commit-target-resolver";
import type {
  OrderCommitDraftLineTarget,
  OrderCommitDraftStagingChange,
} from "./order-commit-draft.types";
import type {
  OrderCommitSnapshotLineV1,
  OrderCommitSnapshotV1,
} from "./order-commit.types";

type PhotoStagingChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO }
>;

type ExtraPhotoMediaType = "DIGITAL" | "PRINT";

export type ResolvedOrderCommitDraftExtraPhotoPricing = Partial<
  Record<
    ExtraPhotoMediaType,
    {
      unitPrice: number;
      sessionTypeId?: string;
    }
  >
>;

export type ReduceOrderCommitDraftPhotoInput = {
  change: PhotoStagingChange;
  resolvedExtraPhotoPricing?: ResolvedOrderCommitDraftExtraPhotoPricing;
};

export function reduceOrderCommitDraftPhoto(
  snapshot: OrderCommitSnapshotV1,
  input: ReduceOrderCommitDraftPhotoInput
): OrderCommitSnapshotV1 {
  const packageLine = resolvePackageLine(snapshot, input.change.target);
  const includedPhotoCount = requiredNonnegativeIntegerMetadata(
    packageLine,
    "includedPhotoCount"
  );
  const selectedPhotoCount = input.change.selectedPhotoCount;
  const extraDigitalCount = input.change.extraDigitalCount;
  const extraPrintCount = input.change.extraPrintCount;

  if (selectedPhotoCount < includedPhotoCount) {
    throw new Error(
      "OrderCommit photo reducer failed: selectedPhotoCount must be greater than or equal to includedPhotoCount."
    );
  }
  if (
    extraDigitalCount + extraPrintCount !==
    selectedPhotoCount - includedPhotoCount
  ) {
    throw new Error(
      "OrderCommit photo reducer failed: extraDigitalCount plus extraPrintCount must equal selectedPhotoCount minus includedPhotoCount."
    );
  }

  const existingDigitalLine = resolveExtraPhotoLine(
    snapshot,
    packageLine,
    "DIGITAL"
  );
  const existingPrintLine = resolveExtraPhotoLine(snapshot, packageLine, "PRINT");
  const nextLines = snapshot.lines
    .filter(
      (line) =>
        line.lineId !== existingDigitalLine?.lineId &&
        line.lineId !== existingPrintLine?.lineId
    )
    .map((line) => {
      if (line.lineId !== packageLine.lineId) return cloneSnapshotLine(line);
      return {
        ...line,
        metadata: {
          ...line.metadata,
          selectedPhotoCount,
          extraDigitalCount,
          extraPrintCount,
        },
      };
    });

  const digitalLine = nextExtraPhotoLine({
    packageLine,
    mediaType: "DIGITAL",
    quantity: extraDigitalCount,
    existingLine: existingDigitalLine,
    resolvedExtraPhotoPricing: input.resolvedExtraPhotoPricing,
  });
  const printLine = nextExtraPhotoLine({
    packageLine,
    mediaType: "PRINT",
    quantity: extraPrintCount,
    existingLine: existingPrintLine,
    resolvedExtraPhotoPricing: input.resolvedExtraPhotoPricing,
  });

  return normalizeOrderCommitSnapshot({
    ...snapshot,
    lines: [
      ...nextLines,
      ...(digitalLine ? [digitalLine] : []),
      ...(printLine ? [printLine] : []),
    ],
  });
}

function nextExtraPhotoLine(input: {
  packageLine: OrderCommitSnapshotLineV1;
  mediaType: ExtraPhotoMediaType;
  quantity: number;
  existingLine: OrderCommitSnapshotLineV1 | null;
  resolvedExtraPhotoPricing?: ResolvedOrderCommitDraftExtraPhotoPricing;
}): OrderCommitSnapshotLineV1 | null {
  if (input.quantity === 0) return null;
  if (input.existingLine) {
    return {
      ...input.existingLine,
      quantity: input.quantity,
      lineTotal: multiplyMoney(input.existingLine.unitPrice, input.quantity),
      metadata: { ...input.existingLine.metadata },
    };
  }

  const resolvedPrice = input.resolvedExtraPhotoPricing?.[input.mediaType];
  if (!resolvedPrice) {
    throw new Error(
      `OrderCommit photo reducer failed: creating ${input.mediaType} extra-photo line requires resolved pricing.`
    );
  }

  const packageLabel = input.packageLine.label;
  const mediaKey = mediaKeyFor(input.mediaType);
  const sessionTypeId =
    resolvedPrice.sessionTypeId ??
    stringMetadata(input.packageLine, "sessionTypeId");

  return {
    lineId: `extra-photo:${input.packageLine.orderEntityId}:${mediaKey}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_PHOTO_EXTRA,
    orderEntityId: `${input.packageLine.orderEntityId}:${input.mediaType}`,
    parentOrderPackageId: input.packageLine.orderEntityId,
    catalogEntityId: null,
    stableKey: `order-package:${input.packageLine.orderEntityId}:extra-photo:${mediaKey}`,
    label: `Extra photos - ${formatMediaType(input.mediaType)} (${packageLabel})`,
    quantity: input.quantity,
    unitPrice: resolvedPrice.unitPrice,
    lineTotal: multiplyMoney(resolvedPrice.unitPrice, input.quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.SESSION_TYPE_EXTRA_PHOTO_PRICING,
    metadata: {
      mediaType: input.mediaType,
      ...(sessionTypeId ? { sessionTypeId } : {}),
    },
  };
}

function resolvePackageLine(
  snapshot: OrderCommitSnapshotV1,
  target: OrderCommitDraftLineTarget
): OrderCommitSnapshotLineV1 {
  const line = resolveOrderCommitDraftTargetLine(snapshot, target, {
    errorPrefix: "OrderCommit photo reducer failed",
    targetDescription: "package target",
  });
  if (line.lineKind !== ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE) {
    throw new Error(
      `OrderCommit photo reducer failed: target ${line.lineId} is not a package line.`
    );
  }
  return line;
}

function resolveExtraPhotoLine(
  snapshot: OrderCommitSnapshotV1,
  packageLine: OrderCommitSnapshotLineV1,
  mediaType: ExtraPhotoMediaType
): OrderCommitSnapshotLineV1 | null {
  const matches = snapshot.lines.filter(
    (line) =>
      line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA &&
      line.parentOrderPackageId === packageLine.orderEntityId &&
      extraPhotoLineMediaType(line) === mediaType
  );
  if (matches.length > 1) {
    throw new Error(
      `OrderCommit photo reducer failed: package ${packageLine.orderEntityId} has multiple ${mediaType} extra-photo lines.`
    );
  }
  return matches[0] ?? null;
}

function extraPhotoLineMediaType(
  line: OrderCommitSnapshotLineV1
): ExtraPhotoMediaType | null {
  if (line.metadata.mediaType === "DIGITAL") return "DIGITAL";
  if (line.metadata.mediaType === "PRINT") return "PRINT";
  if (line.stableKey.endsWith(":extra-photo:digital")) return "DIGITAL";
  if (line.stableKey.endsWith(":extra-photo:print")) return "PRINT";
  return null;
}

function requiredNonnegativeIntegerMetadata(
  line: OrderCommitSnapshotLineV1,
  key: string
): number {
  const value = line.metadata[key];
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw new Error(
      `OrderCommit photo reducer failed: package metadata ${key} must be a nonnegative integer.`
    );
  }
  return value;
}

function stringMetadata(
  line: OrderCommitSnapshotLineV1,
  key: string
): string | undefined {
  const value = line.metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function cloneSnapshotLine(
  line: OrderCommitSnapshotLineV1
): OrderCommitSnapshotLineV1 {
  return { ...line, metadata: { ...line.metadata } };
}

function mediaKeyFor(mediaType: ExtraPhotoMediaType): string {
  return mediaType.toLowerCase();
}

function formatMediaType(mediaType: ExtraPhotoMediaType): string {
  return mediaType === "DIGITAL" ? "Digital" : "Print";
}

function multiplyMoney(unitPrice: number, quantity: number): number {
  return Number((unitPrice * quantity).toFixed(3));
}
