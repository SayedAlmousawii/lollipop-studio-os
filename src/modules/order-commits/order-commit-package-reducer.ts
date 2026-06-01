import {
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN,
} from "./order-commit-draft.constants";
import {
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

  const nextPackageLine = updatePackageLine(packageLine, resolvedPackage);
  if (!input.deferPhotoInvariantValidation) {
    assertPhotoCountsRemainValid(nextPackageLine);
  }

  const packageIdentityChanged =
    packageLine.catalogEntityId !== resolvedPackage.packageId;
  const lines = snapshot.lines
    .filter(
      (line) =>
        !(
          packageIdentityChanged &&
          line.lineKind ===
            ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE &&
          line.parentOrderPackageId === packageLine.orderEntityId
        )
    )
    .map((line) =>
      line.lineId === packageLine.lineId
        ? nextPackageLine
        : cloneSnapshotLine(line)
    );

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
  resolvedPackage: ResolvedOrderCommitDraftPackage
): OrderCommitSnapshotLineV1 {
  const unitPrice = roundMoney(resolvedPackage.packagePrice);
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
