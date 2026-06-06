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

type PackageItemUpgradeStagingChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE }
>;

export type ResolvedOrderCommitDraftPackageItemUpgrade = {
  packageItemId: string;
  packageId: string;
  label: string;
  unitPrice: number;
};

export type ReduceOrderCommitDraftPackageItemUpgradeInput = {
  change: PackageItemUpgradeStagingChange;
  resolvedPackageItem?: ResolvedOrderCommitDraftPackageItemUpgrade;
};

export function reduceOrderCommitDraftPackageItemUpgrade(
  snapshot: OrderCommitSnapshotV1,
  input: ReduceOrderCommitDraftPackageItemUpgradeInput
): OrderCommitSnapshotV1 {
  const parentPackage = resolveParentPackageLine(
    snapshot,
    input.change.parentPackageTarget
  );

  switch (input.change.action) {
    case "ADD":
      return addPackageItemUpgrade(snapshot, input.change, parentPackage, input);
    case "UPDATE_QUANTITY":
      return updatePackageItemUpgradeQuantity(
        snapshot,
        input.change,
        parentPackage
      );
    case "REMOVE":
      return removePackageItemUpgrade(snapshot, input.change, parentPackage);
  }
}

function addPackageItemUpgrade(
  snapshot: OrderCommitSnapshotV1,
  change: PackageItemUpgradeStagingChange,
  parentPackage: OrderCommitSnapshotLineV1,
  input: ReduceOrderCommitDraftPackageItemUpgradeInput
): OrderCommitSnapshotV1 {
  if (!change.packageItemId) {
    throw new Error(
      "OrderCommit package item upgrade reducer failed: ADD requires packageItemId."
    );
  }
  if (change.quantity === undefined) {
    throw new Error(
      "OrderCommit package item upgrade reducer failed: ADD requires quantity."
    );
  }
  const requestedQuantity = change.quantity;
  if (!change.draftPackageItemUpgradeId) {
    throw new Error(
      "OrderCommit package item upgrade reducer failed: ADD requires draftPackageItemUpgradeId."
    );
  }
  const resolvedPackageItem = input.resolvedPackageItem;
  if (!resolvedPackageItem) {
    throw new Error(
      "OrderCommit package item upgrade reducer failed: ADD requires resolved package item data."
    );
  }
  if (resolvedPackageItem.packageItemId !== change.packageItemId) {
    throw new Error(
      `OrderCommit package item upgrade reducer failed: resolved package item ${resolvedPackageItem.packageItemId} does not match requested package item ${change.packageItemId}.`
    );
  }
  if (resolvedPackageItem.packageId !== parentPackage.catalogEntityId) {
    throw new Error(
      `OrderCommit package item upgrade reducer failed: package item ${resolvedPackageItem.packageItemId} is not scoped to package ${parentPackage.catalogEntityId}.`
    );
  }

  const existingIndex = snapshot.lines.findIndex(
    (line) =>
      line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE &&
      line.parentOrderPackageId === parentPackage.orderEntityId &&
      line.catalogEntityId === change.packageItemId
  );
  if (existingIndex >= 0) {
    const lines = snapshot.lines.map((line, index) => {
      if (index !== existingIndex) return cloneSnapshotLine(line);
      return {
        ...line,
        catalogEntityId: resolvedPackageItem.packageItemId,
        label: resolvedPackageItem.label,
        quantity: requestedQuantity,
        unitPrice: resolvedPackageItem.unitPrice,
        lineTotal: multiplyMoney(
          resolvedPackageItem.unitPrice,
          requestedQuantity
        ),
        metadata: {
          ...line.metadata,
          packageItemId: resolvedPackageItem.packageItemId,
        },
      };
    });
    return normalizeOrderCommitSnapshot({ ...snapshot, lines });
  }

  if (requestedQuantity === 0) {
    return normalizeOrderCommitSnapshot({
      ...snapshot,
      lines: snapshot.lines.map(cloneSnapshotLine),
    });
  }

  const line: OrderCommitSnapshotLineV1 = {
    lineId: `item-upgrade:${change.draftPackageItemUpgradeId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
    orderEntityId: change.draftPackageItemUpgradeId,
    parentOrderPackageId: parentPackage.orderEntityId,
    catalogEntityId: resolvedPackageItem.packageItemId,
    stableKey: `order-package-item-upgrade:${change.draftPackageItemUpgradeId}`,
    label: resolvedPackageItem.label,
    quantity: requestedQuantity,
    unitPrice: resolvedPackageItem.unitPrice,
    lineTotal: multiplyMoney(resolvedPackageItem.unitPrice, requestedQuantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      draftPackageItemUpgradeId: change.draftPackageItemUpgradeId,
      packageItemId: resolvedPackageItem.packageItemId,
    },
  };

  return normalizeOrderCommitSnapshot({
    ...snapshot,
    lines: [...snapshot.lines.map(cloneSnapshotLine), line],
  });
}

function updatePackageItemUpgradeQuantity(
  snapshot: OrderCommitSnapshotV1,
  change: PackageItemUpgradeStagingChange,
  parentPackage: OrderCommitSnapshotLineV1
): OrderCommitSnapshotV1 {
  if (!change.target) {
    throw new Error(
      "OrderCommit package item upgrade reducer failed: UPDATE_QUANTITY requires a target."
    );
  }
  if (change.quantity === undefined) {
    throw new Error(
      "OrderCommit package item upgrade reducer failed: UPDATE_QUANTITY requires quantity."
    );
  }
  const requestedQuantity = change.quantity;
  const target = resolvePackageItemUpgradeLine(
    snapshot,
    change.target,
    parentPackage
  );
  if (requestedQuantity === 0) {
    return normalizeOrderCommitSnapshot({
      ...snapshot,
      lines: snapshot.lines
        .filter((line) => line.lineId !== target.lineId)
        .map(cloneSnapshotLine),
    });
  }

  return normalizeOrderCommitSnapshot({
    ...snapshot,
    lines: snapshot.lines.map((line) => {
      if (line.lineId !== target.lineId) return cloneSnapshotLine(line);
      return {
        ...line,
        quantity: requestedQuantity,
        lineTotal: multiplyMoney(line.unitPrice, requestedQuantity),
        metadata: { ...line.metadata },
      };
    }),
  });
}

function removePackageItemUpgrade(
  snapshot: OrderCommitSnapshotV1,
  change: PackageItemUpgradeStagingChange,
  parentPackage: OrderCommitSnapshotLineV1
): OrderCommitSnapshotV1 {
  if (!change.target) {
    throw new Error(
      "OrderCommit package item upgrade reducer failed: REMOVE requires a target."
    );
  }
  const target = resolvePackageItemUpgradeLine(
    snapshot,
    change.target,
    parentPackage
  );
  return normalizeOrderCommitSnapshot({
    ...snapshot,
    lines: snapshot.lines
      .filter((line) => line.lineId !== target.lineId)
      .map(cloneSnapshotLine),
  });
}

function resolveParentPackageLine(
  snapshot: OrderCommitSnapshotV1,
  target: OrderCommitDraftLineTarget
): OrderCommitSnapshotLineV1 {
  const line = resolveOrderCommitDraftTargetLine(snapshot, target, {
    errorPrefix: "OrderCommit package item upgrade reducer failed",
    targetDescription: "parent package",
  });
  if (line.lineKind !== ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE) {
    throw new Error(
      `OrderCommit package item upgrade reducer failed: parent target ${line.lineId} is not a package line.`
    );
  }
  return line;
}

function resolvePackageItemUpgradeLine(
  snapshot: OrderCommitSnapshotV1,
  target: OrderCommitDraftLineTarget,
  parentPackage: OrderCommitSnapshotLineV1
): OrderCommitSnapshotLineV1 {
  const line = resolveOrderCommitDraftTargetLine(snapshot, target, {
    errorPrefix: "OrderCommit package item upgrade reducer failed",
    targetDescription: "package item upgrade target",
  });
  if (line.lineKind !== ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE) {
    throw new Error(
      `OrderCommit package item upgrade reducer failed: target ${line.lineId} is not a package item upgrade line.`
    );
  }
  if (line.parentOrderPackageId !== parentPackage.orderEntityId) {
    throw new Error(
      `OrderCommit package item upgrade reducer failed: target ${line.lineId} is not scoped to package ${parentPackage.orderEntityId}.`
    );
  }
  return line;
}

function cloneSnapshotLine(
  line: OrderCommitSnapshotLineV1
): OrderCommitSnapshotLineV1 {
  return { ...line, metadata: { ...line.metadata } };
}

function multiplyMoney(unitPrice: number, quantity: number): number {
  return Number((unitPrice * quantity).toFixed(3));
}
