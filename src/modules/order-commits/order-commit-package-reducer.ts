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
  ResolvedOrderCommitDraftExtraPhotoPricing,
} from "./order-commit-photo-reducer";
import type {
  OrderCommitSnapshotLineV1,
  OrderCommitSnapshotV1,
} from "./order-commit.types";

type PackageStagingChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE }
>;

export type ResolvedOrderCommitDraftPackage = {
  packageId: string;
  packageName: string;
  packagePrice: number;
  sessionType: {
    id: string;
    name: string;
  };
  includedPhotoCount: number;
};

export type ReduceOrderCommitDraftPackageInput = {
  change: PackageStagingChange;
  resolvedPackage: ResolvedOrderCommitDraftPackage;
  deferPhotoInvariantValidation?: boolean;
  resolvedExtraPhotoPricing?: ResolvedOrderCommitDraftExtraPhotoPricing;
};

export function reduceOrderCommitDraftPackage(
  snapshot: OrderCommitSnapshotV1,
  input: ReduceOrderCommitDraftPackageInput
): OrderCommitSnapshotV1 {
  const packageLine = resolvePackageLine(snapshot, input.change.target);
  const resolvedPackage = input.resolvedPackage;
  assertResolvedPackageMatchesChange(input.change, resolvedPackage);
  assertPackageStaysInSession(packageLine, input.change, resolvedPackage);
  assertScopedSessionConfigurationsRemainValid(
    snapshot,
    packageLine,
    resolvedPackage
  );
  assertLinkedProductOwnership(snapshot.lines);
  assertPhotoCountsRemainValid(packageLine);

  const shouldNormalizePhotoCounts =
    !input.deferPhotoInvariantValidation &&
    requiredNonnegativeIntegerMetadata(packageLine, "includedPhotoCount") !==
      resolvedPackage.includedPhotoCount;
  const nextPackageLine = updatePackageLine(packageLine, {
    resolvedPackage,
    normalizePhotoCounts: shouldNormalizePhotoCounts,
  });
  if (!input.deferPhotoInvariantValidation) {
    assertPhotoCountsRemainValid(nextPackageLine);
  }

  const packageIdentityChanged =
    packageLine.catalogEntityId !== resolvedPackage.packageId;
  const existingPrintLine = resolveExtraPhotoLine(snapshot, packageLine, "PRINT");
  const nextPrintLine =
    !shouldNormalizePhotoCounts
      ? existingPrintLine
      : nextExtraPrintLine({
          packageLine: nextPackageLine,
          existingLine: existingPrintLine,
          resolvedExtraPhotoPricing: input.resolvedExtraPhotoPricing,
        });
  const lines = snapshot.lines
    .filter(
      (line) =>
        !(
          packageIdentityChanged &&
          line.lineKind ===
            ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE &&
          line.parentOrderPackageId === packageLine.orderEntityId
        ) &&
        !(
          shouldNormalizePhotoCounts &&
          line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA &&
          line.parentOrderPackageId === packageLine.orderEntityId
        )
    )
    .map((line) =>
      line.lineId === packageLine.lineId
        ? nextPackageLine
        : cloneSnapshotLine(line)
    );
  if (shouldNormalizePhotoCounts && nextPrintLine) {
    lines.push(nextPrintLine);
  }

  return normalizeOrderCommitSnapshot({ ...snapshot, lines });
}

function assertResolvedPackageMatchesChange(
  change: PackageStagingChange,
  resolvedPackage: ResolvedOrderCommitDraftPackage
): void {
  if (resolvedPackage.packageId !== change.packageId) {
    throw new Error(
      `OrderCommit package reducer failed: resolved package ${resolvedPackage.packageId} does not match requested package ${change.packageId}.`
    );
  }
  if (
    change.sessionTypeId &&
    change.sessionTypeId !== resolvedPackage.sessionType.id
  ) {
    throw new Error(
      `OrderCommit package reducer failed: resolved package session type ${resolvedPackage.sessionType.id} does not match requested session type ${change.sessionTypeId}.`
    );
  }
  if (!Number.isFinite(resolvedPackage.packagePrice)) {
    throw new Error(
      "OrderCommit package reducer failed: resolved package price must be finite."
    );
  }
  if (
    !Number.isInteger(resolvedPackage.includedPhotoCount) ||
    resolvedPackage.includedPhotoCount < 0
  ) {
    throw new Error(
      "OrderCommit package reducer failed: resolved includedPhotoCount must be a nonnegative integer."
    );
  }
}

function assertPackageStaysInSession(
  packageLine: OrderCommitSnapshotLineV1,
  change: PackageStagingChange,
  resolvedPackage: ResolvedOrderCommitDraftPackage
): void {
  const currentSessionTypeId = requiredStringMetadata(
    packageLine,
    "sessionTypeId"
  );
  if (currentSessionTypeId !== resolvedPackage.sessionType.id) {
    throw new Error(
      `OrderCommit package reducer failed: cross-session package changes are not supported (${currentSessionTypeId} to ${resolvedPackage.sessionType.id}).`
    );
  }
  if (change.sessionTypeId && change.sessionTypeId !== currentSessionTypeId) {
    throw new Error(
      `OrderCommit package reducer failed: target package session type ${currentSessionTypeId} does not match requested session type ${change.sessionTypeId}.`
    );
  }
}

function updatePackageLine(
  packageLine: OrderCommitSnapshotLineV1,
  input: {
    resolvedPackage: ResolvedOrderCommitDraftPackage;
    normalizePhotoCounts: boolean;
  }
): OrderCommitSnapshotLineV1 {
  const resolvedPackage = input.resolvedPackage;
  const unitPrice = roundMoney(resolvedPackage.packagePrice);
  const currentSelectedPhotoCount = requiredNonnegativeIntegerMetadata(
    packageLine,
    "selectedPhotoCount"
  );
  const selectedPhotoCount = input.normalizePhotoCounts
    ? Math.max(currentSelectedPhotoCount, resolvedPackage.includedPhotoCount)
    : currentSelectedPhotoCount;
  const remainingExtras = selectedPhotoCount - resolvedPackage.includedPhotoCount;
  return {
    ...packageLine,
    catalogEntityId: resolvedPackage.packageId,
    label: resolvedPackage.packageName,
    unitPrice,
    lineTotal: multiplyMoney(unitPrice, packageLine.quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      ...packageLine.metadata,
      currentPackageId: resolvedPackage.packageId,
      currentPackageNameSnapshot: resolvedPackage.packageName,
      finalPackagePriceSnapshot: unitPrice,
      includedPhotoCount: resolvedPackage.includedPhotoCount,
      selectedPhotoCount,
      ...(input.normalizePhotoCounts
        ? {
            extraDigitalCount: 0,
            extraPrintCount: remainingExtras,
          }
        : {}),
      sessionTypeId: resolvedPackage.sessionType.id,
      sessionTypeName: resolvedPackage.sessionType.name,
    },
  };
}

function resolvePackageLine(
  snapshot: OrderCommitSnapshotV1,
  target: OrderCommitDraftLineTarget
): OrderCommitSnapshotLineV1 {
  const line = resolveOrderCommitDraftTargetLine(snapshot, target, {
    errorPrefix: "OrderCommit package reducer failed",
    targetDescription: "package target",
  });
  if (line.lineKind !== ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE) {
    throw new Error(
      `OrderCommit package reducer failed: target ${line.lineId} is not a package line.`
    );
  }
  return line;
}

function assertScopedSessionConfigurationsRemainValid(
  snapshot: OrderCommitSnapshotV1,
  packageLine: OrderCommitSnapshotLineV1,
  resolvedPackage: ResolvedOrderCommitDraftPackage
): void {
  for (const line of snapshot.lines) {
    if (
      line.lineKind !== ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION ||
      line.parentOrderPackageId !== packageLine.orderEntityId
    ) {
      continue;
    }

    assertOptionalStringMetadataMatches(
      line,
      "sessionTypeId",
      resolvedPackage.sessionType.id
    );
    assertOptionalStringMetadataMatches(
      line,
      "snapshotSessionTypeId",
      resolvedPackage.sessionType.id
    );
    assertOptionalStringArrayMetadataIncludes(
      line,
      "validSessionTypeIds",
      resolvedPackage.sessionType.id
    );
    assertOptionalStringArrayMetadataIncludes(
      line,
      "validPackageIds",
      resolvedPackage.packageId
    );
    assertOptionalStringArrayMetadataIncludes(
      line,
      "allowedPackageIds",
      resolvedPackage.packageId
    );
  }
}

function assertOptionalStringMetadataMatches(
  line: OrderCommitSnapshotLineV1,
  key: string,
  expectedValue: string
): void {
  const value = line.metadata[key];
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value !== expectedValue
  ) {
    throw new Error(
      `OrderCommit package reducer failed: session configuration ${line.lineId} is invalid for ${key} ${expectedValue}.`
    );
  }
}

function assertOptionalStringArrayMetadataIncludes(
  line: OrderCommitSnapshotLineV1,
  key: string,
  expectedValue: string
): void {
  const value = line.metadata[key];
  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string") &&
    !value.includes(expectedValue)
  ) {
    throw new Error(
      `OrderCommit package reducer failed: session configuration ${line.lineId} is invalid for ${key} ${expectedValue}.`
    );
  }
}

function assertPhotoCountsRemainValid(
  packageLine: OrderCommitSnapshotLineV1
): void {
  const includedPhotoCount = requiredNonnegativeIntegerMetadata(
    packageLine,
    "includedPhotoCount"
  );
  const selectedPhotoCount = requiredNonnegativeIntegerMetadata(
    packageLine,
    "selectedPhotoCount"
  );
  const extraDigitalCount = requiredNonnegativeIntegerMetadata(
    packageLine,
    "extraDigitalCount"
  );
  const extraPrintCount = requiredNonnegativeIntegerMetadata(
    packageLine,
    "extraPrintCount"
  );

  if (selectedPhotoCount < includedPhotoCount) {
    throw new Error(
      "OrderCommit package reducer failed: selectedPhotoCount must be greater than or equal to includedPhotoCount."
    );
  }
  if (
    extraDigitalCount + extraPrintCount !==
    selectedPhotoCount - includedPhotoCount
  ) {
    throw new Error(
      "OrderCommit package reducer failed: existing extra photo counts are invalid for the resolved includedPhotoCount."
    );
  }
}

function resolveExtraPhotoLine(
  snapshot: OrderCommitSnapshotV1,
  packageLine: OrderCommitSnapshotLineV1,
  mediaType: "DIGITAL" | "PRINT"
): OrderCommitSnapshotLineV1 | null {
  const matches = snapshot.lines.filter(
    (line) =>
      line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA &&
      line.parentOrderPackageId === packageLine.orderEntityId &&
      extraPhotoLineMediaType(line) === mediaType
  );
  if (matches.length > 1) {
    throw new Error(
      `OrderCommit package reducer failed: package ${packageLine.orderEntityId} has multiple ${mediaType} extra-photo lines.`
    );
  }
  return matches[0] ?? null;
}

function nextExtraPrintLine(input: {
  packageLine: OrderCommitSnapshotLineV1;
  existingLine: OrderCommitSnapshotLineV1 | null;
  resolvedExtraPhotoPricing?: ResolvedOrderCommitDraftExtraPhotoPricing;
}): OrderCommitSnapshotLineV1 | null {
  const quantity = requiredNonnegativeIntegerMetadata(
    input.packageLine,
    "extraPrintCount"
  );
  if (quantity === 0) return null;
  if (input.existingLine) {
    return {
      ...input.existingLine,
      quantity,
      lineTotal: multiplyMoney(input.existingLine.unitPrice, quantity),
      metadata: { ...input.existingLine.metadata },
    };
  }

  const resolvedPrice = input.resolvedExtraPhotoPricing?.PRINT;
  if (!resolvedPrice) {
    throw new Error(
      "OrderCommit package reducer failed: creating PRINT extra-photo line requires resolved pricing."
    );
  }

  const sessionTypeId =
    resolvedPrice.sessionTypeId ??
    optionalStringMetadata(input.packageLine, "sessionTypeId");
  return {
    lineId: `extra-photo:${input.packageLine.orderEntityId}:print`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_PHOTO_EXTRA,
    orderEntityId: `${input.packageLine.orderEntityId}:PRINT`,
    parentOrderPackageId: input.packageLine.orderEntityId,
    catalogEntityId: null,
    stableKey: `order-package:${input.packageLine.orderEntityId}:extra-photo:print`,
    label: `Extra photos - Print (${input.packageLine.label})`,
    quantity,
    unitPrice: resolvedPrice.unitPrice,
    lineTotal: multiplyMoney(resolvedPrice.unitPrice, quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.SESSION_TYPE_EXTRA_PHOTO_PRICING,
    metadata: {
      mediaType: "PRINT",
      ...(sessionTypeId ? { sessionTypeId } : {}),
    },
  };
}

function extraPhotoLineMediaType(
  line: OrderCommitSnapshotLineV1
): "DIGITAL" | "PRINT" | null {
  if (line.metadata.mediaType === "DIGITAL") return "DIGITAL";
  if (line.metadata.mediaType === "PRINT") return "PRINT";
  if (line.stableKey.endsWith(":extra-photo:digital")) return "DIGITAL";
  if (line.stableKey.endsWith(":extra-photo:print")) return "PRINT";
  return null;
}

function assertLinkedProductOwnership(
  lines: OrderCommitSnapshotLineV1[]
): void {
  const selectionLines = lines.filter(
    (line) => line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION
  );
  const linkedLines = lines.filter(
    (line) =>
      line.lineKind ===
      ORDER_COMMIT_SNAPSHOT_LINE_KIND.LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON
  );
  const selectionById = new Map(
    selectionLines.map((line) => [line.orderEntityId, line])
  );

  for (const linkedLine of linkedLines) {
    const selectionLine = selectionById.get(linkedLine.orderEntityId);
    if (!selectionLine) {
      throw new Error(
        `OrderCommit package reducer failed: orphaned linked-product add-on ${linkedLine.lineId} has no owning selection line.`
      );
    }
    const linkedIdentity = metadataLinkedAddOnRef(linkedLine);
    const selectionIdentity = metadataLinkedAddOnRef(selectionLine);
    if (!linkedIdentity || !selectionIdentity || linkedIdentity !== selectionIdentity) {
      throw new Error(
        `OrderCommit package reducer failed: linked-product add-on ${linkedLine.lineId} does not match its owning selection metadata.`
      );
    }
  }

  for (const selectionLine of selectionLines) {
    const addOnRef = metadataLinkedAddOnRef(selectionLine);
    if (!addOnRef) continue;
    const matches = linkedLines.filter(
      (line) =>
        line.orderEntityId === selectionLine.orderEntityId &&
        metadataLinkedAddOnRef(line) === addOnRef
    );
    if (matches.length !== 1) {
      throw new Error(
        `OrderCommit package reducer failed: linked-product selection ${selectionLine.lineId} must own exactly one linked add-on line.`
      );
    }
  }
}

function metadataLinkedAddOnRef(
  line: OrderCommitSnapshotLineV1
): string | null {
  const orderAddOnId = optionalStringMetadata(line, "orderAddOnId");
  const draftOrderAddOnId = optionalStringMetadata(line, "draftOrderAddOnId");
  if (!orderAddOnId && !draftOrderAddOnId) return null;
  if (orderAddOnId && draftOrderAddOnId) {
    throw new Error(
      `OrderCommit package reducer failed: line ${line.lineId} cannot reference both orderAddOnId and draftOrderAddOnId.`
    );
  }
  return orderAddOnId ?? draftOrderAddOnId;
}

function optionalStringMetadata(
  line: OrderCommitSnapshotLineV1,
  key: string
): string | null {
  const value = line.metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredStringMetadata(
  line: OrderCommitSnapshotLineV1,
  key: string
): string {
  const value = line.metadata[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `OrderCommit package reducer failed: package metadata ${key} must be a string.`
    );
  }
  return value;
}

function requiredNonnegativeIntegerMetadata(
  line: OrderCommitSnapshotLineV1,
  key: string
): number {
  const value = line.metadata[key];
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw new Error(
      `OrderCommit package reducer failed: package metadata ${key} must be a nonnegative integer.`
    );
  }
  return value;
}

function cloneSnapshotLine(
  line: OrderCommitSnapshotLineV1
): OrderCommitSnapshotLineV1 {
  return { ...line, metadata: { ...line.metadata } };
}

function multiplyMoney(unitPrice: number, quantity: number): number {
  return roundMoney(unitPrice * quantity);
}

function roundMoney(value: number): number {
  return Number(value.toFixed(3));
}
