import type { PrismaClient } from "@prisma/client";
import type { ActorContext } from "@/lib/auth/actor-context";
import {
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
} from "@/modules/order-commits/order-commit.constants";
import { ORDER_COMMIT_DRAFT_STAGING_DOMAIN } from "@/modules/order-commits/order-commit-draft.constants";
import type {
  OrderCommitDraftLineTarget,
  OrderCommitDraftStagingChange,
} from "@/modules/order-commits/order-commit-draft.types";
import type {
  OrderCommitSnapshotLineKind,
  OrderCommitSnapshotLineV1,
  OrderCommitSnapshotV1,
} from "@/modules/order-commits/order-commit.types";
import {
  commitOrderChanges,
  bootstrapOrderCommitIfMissing,
  getOrCreateOrderCommitDraft,
  stageOrderCommitDraftChange,
  type OrderCommitExecutionResult,
} from "@/modules/order-commits";

export type CommitOrderEditForTestInput = {
  orderId: string;
  change?: OrderCommitDraftStagingChange;
  changes?: readonly OrderCommitDraftStagingChange[];
  actorContext: ActorContext;
  approvalActorUserId?: string;
};

export async function commitOrderEditForTest(
  db: PrismaClient,
  input: CommitOrderEditForTestInput
): Promise<OrderCommitExecutionResult> {
  const changes = input.changes ?? (input.change ? [input.change] : []);
  if (changes.length === 0) {
    throw new Error("commitOrderEditForTest requires at least one change.");
  }

  await bootstrapOrderCommitIfMissing({
    orderId: input.orderId,
    actorContext: input.actorContext,
    client: db,
  });

  let draft = await getOrCreateOrderCommitDraft({
    orderId: input.orderId,
    actorContext: input.actorContext,
    client: db,
  });

  for (const change of changes) {
    draft = await stageOrderCommitDraftChange({
      orderId: input.orderId,
      expectedVersion: draft.draft.version,
      change: await normalizeChangeTargets(db, change, draft.pendingSnapshot),
      actorContext: input.actorContext,
      client: db,
    });
  }

  return commitOrderChanges({
    orderId: input.orderId,
    expectedDraftVersion: draft.draft.version,
    approvalActorUserId: input.approvalActorUserId,
    actorContext: input.actorContext,
    client: db,
  });
}

export function packageTarget(
  orderPackageId: string
): OrderCommitDraftLineTarget {
  return {
    stableKey: `order-package:${orderPackageId}`,
    orderEntityId: orderPackageId,
  };
}

export function addOnTarget(orderAddOnId: string): OrderCommitDraftLineTarget {
  return {
    stableKey: `order-add-on:${orderAddOnId}`,
    orderEntityId: orderAddOnId,
  };
}

export function packageItemUpgradeTarget(
  orderPackageItemUpgradeId: string
): OrderCommitDraftLineTarget {
  return {
    stableKey: `order-package-item-upgrade:${orderPackageItemUpgradeId}`,
    orderEntityId: orderPackageItemUpgradeId,
  };
}

export function addOrderAddOnChange(
  productId: string,
  quantity = 1
): OrderCommitDraftStagingChange {
  return {
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
    action: "ADD",
    productId,
    quantity,
  };
}

export function removeOrderAddOnChange(
  orderAddOnId: string
): OrderCommitDraftStagingChange {
  return {
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
    action: "REMOVE",
    target: addOnTarget(orderAddOnId),
  };
}

export function updateOrderAddOnQuantityChange(
  orderAddOnId: string,
  quantity: number
): OrderCommitDraftStagingChange {
  return {
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
    action: "UPDATE_QUANTITY",
    target: addOnTarget(orderAddOnId),
    quantity,
  };
}

export function updateOrderPackageChange(input: {
  orderPackageId: string;
  packageId: string;
}): OrderCommitDraftStagingChange {
  return {
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
    action: "CHANGE_PACKAGE",
    target: packageTarget(input.orderPackageId),
    packageId: input.packageId,
  };
}

export function upgradeOrderPackageItemChange(input: {
  orderPackageId: string;
  packageItemId: string;
  newProductId: string;
  quantity?: number;
}): OrderCommitDraftStagingChange {
  return {
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
    action: "ADD",
    parentPackageTarget: packageTarget(input.orderPackageId),
    packageItemId: input.packageItemId,
    toProductId: input.newProductId,
    quantity: input.quantity ?? 1,
  };
}

export function updateOrderPackageItemUpgradeQuantityChange(input: {
  orderPackageId: string;
  orderPackageItemUpgradeId: string;
  quantity: number;
}): OrderCommitDraftStagingChange {
  return {
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
    action: "UPDATE_QUANTITY",
    parentPackageTarget: packageTarget(input.orderPackageId),
    target: packageItemUpgradeTarget(input.orderPackageItemUpgradeId),
    quantity: input.quantity,
  };
}

export function updateOrderSelectedPhotoCountChange(input: {
  orderPackageId: string;
  selectedPhotoCount: number;
  extraDigitalCount: number;
  extraPrintCount: number;
}): OrderCommitDraftStagingChange {
  return {
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
    action: "SET_COUNTS",
    target: packageTarget(input.orderPackageId),
    selectedPhotoCount: input.selectedPhotoCount,
    extraDigitalCount: input.extraDigitalCount,
    extraPrintCount: input.extraPrintCount,
  };
}

async function normalizeChangeTargets(
  db: PrismaClient,
  change: OrderCommitDraftStagingChange,
  snapshot: OrderCommitSnapshotV1
): Promise<OrderCommitDraftStagingChange> {
  switch (change.domain) {
    case ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON:
      if (change.action === "ADD") return change;
      return {
        ...change,
        target: resolveSnapshotTarget({
          snapshot,
          target: change.target,
          expectedLineKind: [
            ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
            ORDER_COMMIT_SNAPSHOT_LINE_KIND
              .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON,
          ],
          label: "add-on",
        }),
      };
    case ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE:
      return {
        ...change,
        parentPackageTarget: resolveSnapshotTarget({
          snapshot,
          target: change.parentPackageTarget,
          expectedLineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
          label: "parent package",
        }),
        target:
          change.action === "ADD"
            ? change.target
            : await resolvePackageItemUpgradeTarget(db, snapshot, change.target),
      };
    case ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE:
      return {
        ...change,
        target: resolveSnapshotTarget({
          snapshot,
          target: change.target,
          expectedLineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
          label: "package",
        }),
      };
    case ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO:
      return {
        ...change,
        target: resolveSnapshotTarget({
          snapshot,
          target: change.target,
          expectedLineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
          label: "photo package",
        }),
      };
    case ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION:
      return change;
  }
}

async function resolvePackageItemUpgradeTarget(
  db: PrismaClient,
  snapshot: OrderCommitSnapshotV1,
  target: OrderCommitDraftLineTarget | undefined
): Promise<OrderCommitDraftLineTarget> {
  if (!target) {
    throw new Error("Missing package item upgrade target.");
  }

  try {
    return resolveSnapshotTarget({
      snapshot,
      target,
      expectedLineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE,
      label: "package item upgrade",
    });
  } catch (error) {
    if (!target.orderEntityId) throw error;
  }

  const row = await db.orderPackageItemUpgrade.findUnique({
    where: { id: target.orderEntityId },
    select: { orderPackageId: true, packageItemId: true },
  });
  if (!row) {
    throw new Error("Package item upgrade target row was not found.");
  }

  const line = snapshot.lines.find(
    (candidate) =>
      candidate.lineKind ===
        ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE &&
      candidate.parentOrderPackageId === row.orderPackageId &&
      candidate.catalogEntityId === row.packageItemId
  );
  if (!line) {
    throw new Error("Package item upgrade snapshot line was not found.");
  }

  return {
    stableKey: line.stableKey,
    lineId: line.lineId,
    orderEntityId: isDraftEntityId(line.orderEntityId)
      ? undefined
      : line.orderEntityId,
    draftEntityId: isDraftEntityId(line.orderEntityId)
      ? line.orderEntityId
      : undefined,
  };
}

function resolveSnapshotTarget(input: {
  snapshot: OrderCommitSnapshotV1;
  target: OrderCommitDraftLineTarget | undefined;
  expectedLineKind: OrderCommitSnapshotLineKind | readonly OrderCommitSnapshotLineKind[];
  label: string;
}): OrderCommitDraftLineTarget {
  if (!input.target) {
    throw new Error(`Missing ${input.label} target.`);
  }
  const matches = input.snapshot.lines.filter((line) =>
    targetMatchesLine(input.target!, line)
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one ${input.label} snapshot line, found ${matches.length}.`
    );
  }
  const line = matches[0];
  const expectedLineKinds = Array.isArray(input.expectedLineKind)
    ? input.expectedLineKind
    : [input.expectedLineKind];
  if (!line || !expectedLineKinds.includes(line.lineKind)) {
    throw new Error(`Resolved ${input.label} target is not the expected line kind.`);
  }

  return {
    stableKey: line.stableKey,
    lineId: line.lineId,
    orderEntityId: isDraftEntityId(line.orderEntityId)
      ? undefined
      : line.orderEntityId,
    draftEntityId: isDraftEntityId(line.orderEntityId)
      ? line.orderEntityId
      : undefined,
  };
}

function targetMatchesLine(
  target: OrderCommitDraftLineTarget,
  line: OrderCommitSnapshotLineV1
): boolean {
  return (
    Boolean(target.stableKey && line.stableKey === target.stableKey) ||
    Boolean(target.lineId && line.lineId === target.lineId) ||
    Boolean(target.orderEntityId && line.orderEntityId === target.orderEntityId) ||
    Boolean(target.draftEntityId && line.orderEntityId === target.draftEntityId) ||
    Boolean(
      target.orderEntityId &&
        line.orderEntityKind === ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_ADD_ON &&
        line.stableKey === `order-add-on:${target.orderEntityId}`
    ) ||
    Boolean(
      target.orderEntityId &&
        line.lineKind ===
          ORDER_COMMIT_SNAPSHOT_LINE_KIND
            .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON &&
        line.metadata.orderAddOnId === target.orderEntityId
    ) ||
    Boolean(
      target.orderEntityId &&
        line.orderEntityKind ===
          ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_ITEM_UPGRADE &&
        line.stableKey === `order-package-item-upgrade:${target.orderEntityId}`
    )
  );
}

function isDraftEntityId(value: string): boolean {
  return value.startsWith("draft:");
}
