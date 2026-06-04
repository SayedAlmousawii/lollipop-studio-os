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

type AddOnStagingChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON }
>;

export type ResolvedOrderCommitDraftAddOnProduct = {
  productId: string;
  label: string;
  unitPrice: number;
};

export type ReduceOrderCommitDraftAddOnInput = {
  change: AddOnStagingChange;
  resolvedProduct?: ResolvedOrderCommitDraftAddOnProduct;
};

export function reduceOrderCommitDraftAddOn(
  snapshot: OrderCommitSnapshotV1,
  input: ReduceOrderCommitDraftAddOnInput
): OrderCommitSnapshotV1 {
  const parentPackage = resolveOptionalParentPackageLine(
    snapshot,
    input.change.parentPackageTarget
  );

  switch (input.change.action) {
    case "ADD":
      return addCatalogAddOn(snapshot, input.change, parentPackage, input);
    case "UPDATE_QUANTITY":
      return updateAddOnQuantity(snapshot, input.change, parentPackage);
    case "REMOVE":
      return removeAddOn(snapshot, input.change, parentPackage);
  }
}

function addCatalogAddOn(
  snapshot: OrderCommitSnapshotV1,
  change: AddOnStagingChange,
  parentPackage: OrderCommitSnapshotLineV1 | null,
  input: ReduceOrderCommitDraftAddOnInput
): OrderCommitSnapshotV1 {
  if (!change.productId) {
    throw new Error("OrderCommit add-on reducer failed: ADD requires productId.");
  }
  if (change.quantity === undefined) {
    throw new Error("OrderCommit add-on reducer failed: ADD requires quantity.");
  }
  const requestedQuantity = change.quantity;
  if (!change.draftOrderAddOnId) {
    throw new Error(
      "OrderCommit add-on reducer failed: ADD requires draftOrderAddOnId."
    );
  }
  const resolvedProduct = input.resolvedProduct;
  if (!resolvedProduct) {
    throw new Error(
      "OrderCommit add-on reducer failed: ADD requires resolved product data."
    );
  }
  if (resolvedProduct.productId !== change.productId) {
    throw new Error(
      `OrderCommit add-on reducer failed: resolved product ${resolvedProduct.productId} does not match requested product ${change.productId}.`
    );
  }

  const parentOrderPackageId = parentPackage?.orderEntityId ?? null;
  const existingIndex = snapshot.lines.findIndex(
    (line) =>
      line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON &&
      line.parentOrderPackageId === parentOrderPackageId &&
      line.catalogEntityId === change.productId
  );
  if (existingIndex >= 0) {
    const lines = snapshot.lines.map((line, index) => {
      if (index !== existingIndex) return line;
      const quantity = line.quantity + requestedQuantity;
      return {
        ...line,
        quantity,
        lineTotal: multiplyMoney(line.unitPrice, quantity),
        metadata: { ...line.metadata },
      };
    });
    return normalizeOrderCommitSnapshot({ ...snapshot, lines });
  }

  if (requestedQuantity === 0) {
    return normalizeOrderCommitSnapshot({
      ...snapshot,
      lines: snapshot.lines.map((line) => ({
        ...line,
        metadata: { ...line.metadata },
      })),
    });
  }

  const line: OrderCommitSnapshotLineV1 = {
    lineId: `addon:${change.draftOrderAddOnId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_ADD_ON,
    orderEntityId: change.draftOrderAddOnId,
    parentOrderPackageId,
    catalogEntityId: resolvedProduct.productId,
    stableKey: `order-add-on:${change.draftOrderAddOnId}`,
    label: resolvedProduct.label,
    quantity: requestedQuantity,
    unitPrice: resolvedProduct.unitPrice,
    lineTotal: multiplyMoney(resolvedProduct.unitPrice, requestedQuantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      draftOrderAddOnId: change.draftOrderAddOnId,
      productId: resolvedProduct.productId,
    },
  };

  return normalizeOrderCommitSnapshot({
    ...snapshot,
    lines: [
      ...snapshot.lines.map((existingLine) => ({
        ...existingLine,
        metadata: { ...existingLine.metadata },
      })),
      line,
    ],
  });
}

function updateAddOnQuantity(
  snapshot: OrderCommitSnapshotV1,
  change: AddOnStagingChange,
  parentPackage: OrderCommitSnapshotLineV1 | null
): OrderCommitSnapshotV1 {
  if (!change.target) {
    throw new Error(
      "OrderCommit add-on reducer failed: UPDATE_QUANTITY requires a target."
    );
  }
  if (change.quantity === undefined) {
    throw new Error(
      "OrderCommit add-on reducer failed: UPDATE_QUANTITY requires quantity."
    );
  }
  const requestedQuantity = change.quantity;
  const target = resolveMutableAddOnLine(snapshot, change.target, parentPackage);
  if (requestedQuantity === 0) {
    return normalizeOrderCommitSnapshot({
      ...snapshot,
      lines: snapshot.lines
        .filter((line) => line.lineId !== target.lineId)
        .map((line) => ({ ...line, metadata: { ...line.metadata } })),
    });
  }

  return normalizeOrderCommitSnapshot({
    ...snapshot,
    lines: snapshot.lines.map((line) => {
      if (line.lineId !== target.lineId) {
        return { ...line, metadata: { ...line.metadata } };
      }
      return {
        ...line,
        quantity: requestedQuantity,
        lineTotal: multiplyMoney(line.unitPrice, requestedQuantity),
        metadata: { ...line.metadata },
      };
    }),
  });
}

function removeAddOn(
  snapshot: OrderCommitSnapshotV1,
  change: AddOnStagingChange,
  parentPackage: OrderCommitSnapshotLineV1 | null
): OrderCommitSnapshotV1 {
  if (!change.target) {
    throw new Error("OrderCommit add-on reducer failed: REMOVE requires a target.");
  }
  const target = resolveMutableAddOnLine(snapshot, change.target, parentPackage);
  return normalizeOrderCommitSnapshot({
    ...snapshot,
    lines: snapshot.lines
      .filter((line) => line.lineId !== target.lineId)
      .map((line) => ({ ...line, metadata: { ...line.metadata } })),
  });
}

function resolveOptionalParentPackageLine(
  snapshot: OrderCommitSnapshotV1,
  target: OrderCommitDraftLineTarget | undefined
): OrderCommitSnapshotLineV1 | null {
  if (!target) return null;
  const line = resolveOrderCommitDraftTargetLine(snapshot, target, {
    errorPrefix: "OrderCommit add-on reducer failed",
    targetDescription: "parent package",
  });
  if (line.lineKind !== ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE) {
    throw new Error(
      `OrderCommit add-on reducer failed: parent target ${line.lineId} is not a package line.`
    );
  }
  return line;
}

function resolveMutableAddOnLine(
  snapshot: OrderCommitSnapshotV1,
  target: OrderCommitDraftLineTarget,
  parentPackage: OrderCommitSnapshotLineV1 | null
): OrderCommitSnapshotLineV1 {
  const line = resolveOrderCommitDraftTargetLine(snapshot, target, {
    errorPrefix: "OrderCommit add-on reducer failed",
    targetDescription: "add-on target",
  });
  if (
    line.lineKind ===
    ORDER_COMMIT_SNAPSHOT_LINE_KIND.LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON
  ) {
    throw new Error(
      "OrderCommit add-on reducer failed: linked-product session-configuration add-ons cannot be mutated by the add-on reducer."
    );
  }
  if (line.lineKind !== ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON) {
    throw new Error(
      `OrderCommit add-on reducer failed: target ${line.lineId} is not a true add-on line.`
    );
  }
  if (parentPackage && line.parentOrderPackageId !== parentPackage.orderEntityId) {
    throw new Error(
      `OrderCommit add-on reducer failed: target ${line.lineId} is not scoped to package ${parentPackage.orderEntityId}.`
    );
  }
  return line;
}

function multiplyMoney(unitPrice: number, quantity: number): number {
  return Number((unitPrice * quantity).toFixed(3));
}
