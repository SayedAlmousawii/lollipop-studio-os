import {
  Prisma,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationPricingMode,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth/actor-context";
import {
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
} from "./order-commit.constants";
import { orderCommitSnapshotV1Schema } from "./order-commit.schema";
import { normalizeOrderCommitSnapshot } from "./order-commit-snapshot-normalizer";
import type {
  OrderCommitSnapshotLineV1,
  OrderCommitSnapshotV1,
} from "./order-commit.types";

export class OrderCommitUnsupportedPackageMembershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderCommitUnsupportedPackageMembershipError";
  }
}

export type MaterializeOrderCommitDraftIntoOrderRowsInput = {
  orderId: string;
  pendingSnapshot: OrderCommitSnapshotV1;
  actorContext: ActorContext;
  client: OrderCommitMaterializationClient;
};

export type MaterializeOrderCommitDraftIntoOrderRowsResult = {
  draftToOrderEntityMap: ReadonlyMap<string, string>;
};

export type RemapMaterializedSessionConfigurationSnapshotInput = {
  pendingSnapshot: OrderCommitSnapshotV1;
  draftToOrderEntityMap: ReadonlyMap<string, string>;
};

export type OrderCommitMaterializationClient = Pick<
  Prisma.TransactionClient,
  | "order"
  | "orderPackage"
  | "orderAddOn"
  | "orderPackageItemUpgrade"
  | "orderPackageSessionConfigurationSelection"
>;

const orderPackageSelect = {
  id: true,
  orderId: true,
  originalPackageId: true,
  currentPackageId: true,
  bookingPackageId: true,
  sessionTypeId: true,
  originalPackageNameSnapshot: true,
  currentPackageNameSnapshot: true,
  originalPackagePriceSnapshot: true,
  finalPackagePriceSnapshot: true,
  selectedPhotoCount: true,
  extraDigitalCount: true,
  extraPrintCount: true,
} satisfies Prisma.OrderPackageSelect;

type CurrentOrderPackage = Prisma.OrderPackageGetPayload<{
  select: typeof orderPackageSelect;
}>;

const orderAddOnSelect = {
  id: true,
  orderId: true,
  orderPackageId: true,
  productId: true,
  nameSnapshot: true,
  priceSnapshot: true,
  quantity: true,
  notes: true,
} satisfies Prisma.OrderAddOnSelect;

type CurrentOrderAddOn = Prisma.OrderAddOnGetPayload<{
  select: typeof orderAddOnSelect;
}>;

const orderPackageItemUpgradeSelect = {
  id: true,
  orderId: true,
  orderPackageId: true,
  packageItemId: true,
  nameSnapshot: true,
  priceSnapshot: true,
  quantity: true,
  notes: true,
} satisfies Prisma.OrderPackageItemUpgradeSelect;

type CurrentOrderPackageItemUpgrade = Prisma.OrderPackageItemUpgradeGetPayload<{
  select: typeof orderPackageItemUpgradeSelect;
}>;

const sessionConfigurationSelectionSelect = {
  id: true,
  orderPackageId: true,
  configurationId: true,
  optionId: true,
  numericValue: true,
  textValue: true,
  snapshotOptionLabel: true,
  snapshotConfigurationCode: true,
  snapshotLabel: true,
  snapshotPriceDelta: true,
  snapshotFinancialBehavior: true,
  snapshotInputType: true,
  snapshotPricingMode: true,
  snapshotLinkedProductId: true,
  orderAddOnId: true,
} satisfies Prisma.OrderPackageSessionConfigurationSelectionSelect;

type CurrentSessionConfigurationSelection =
  Prisma.OrderPackageSessionConfigurationSelectionGetPayload<{
    select: typeof sessionConfigurationSelectionSelect;
  }>;

type LoadedOrderRows = {
  order: { id: string; selectedPhotoCount: number | null };
  packages: CurrentOrderPackage[];
  addOns: CurrentOrderAddOn[];
  itemUpgrades: CurrentOrderPackageItemUpgrade[];
  selections: CurrentSessionConfigurationSelection[];
};

type SnapshotGroups = {
  packageLines: OrderCommitSnapshotLineV1[];
  addOnLines: OrderCommitSnapshotLineV1[];
  itemUpgradeLines: OrderCommitSnapshotLineV1[];
  selectionLines: OrderCommitSnapshotLineV1[];
  linkedAddOnLines: OrderCommitSnapshotLineV1[];
};

type LinkedAddOnIdentity = {
  selectionId: string;
  addOnRef: string;
  orderAddOnId: string | null;
  draftOrderAddOnId: string | null;
};

export async function materializeOrderCommitDraftIntoOrderRows(
  input: MaterializeOrderCommitDraftIntoOrderRowsInput
): Promise<MaterializeOrderCommitDraftIntoOrderRowsResult> {
  void input.actorContext;
  const pendingSnapshot = orderCommitSnapshotV1Schema.parse(input.pendingSnapshot);
  if (pendingSnapshot.orderId !== input.orderId) {
    throw new Error(
      `OrderCommit materialization failed: snapshot order ${pendingSnapshot.orderId} does not match order ${input.orderId}.`
    );
  }

  const rows = await loadOrderRows(input.client, input.orderId);
  const groups = groupSnapshotLines(pendingSnapshot);
  validatePackageMembershipBeforeWrites(groups.packageLines, rows.packages);
  validateSupportedReferences(groups, rows);

  const draftToOrderEntityMap = new Map<string, string>();
  const currentPackageById = new Map(rows.packages.map((row) => [row.id, row]));
  const currentAddOnById = new Map(rows.addOns.map((row) => [row.id, row]));
  const currentUpgradeById = new Map(rows.itemUpgrades.map((row) => [row.id, row]));
  const currentSelectionById = new Map(rows.selections.map((row) => [row.id, row]));
  const currentLinkedAddOnIds = new Set(
    rows.selections
      .map((selection) => selection.orderAddOnId)
      .filter((id): id is string => Boolean(id))
  );
  const desiredSelectionIds = new Set(
    groups.selectionLines
      .filter((line) => !isDraftId(line.orderEntityId))
      .map((line) => line.orderEntityId)
  );
  const desiredLinkedIdentities = linkedIdentitiesBySelection(groups);
  const desiredExistingLinkedAddOnIds = new Set(
    [...desiredLinkedIdentities.values()]
      .map((identity) => identity.orderAddOnId)
      .filter((id): id is string => Boolean(id))
  );

  const selectionsToPreNull = rows.selections.filter((selection) => {
    if (!selection.orderAddOnId) return false;
    if (!desiredSelectionIds.has(selection.id)) return true;
    const desired = desiredLinkedIdentities.get(selection.id);
    return desired?.orderAddOnId !== selection.orderAddOnId;
  });
  await updateSelectionsToNullLinkedAddOns(input.client, selectionsToPreNull);

  const absentSelectionIds = rows.selections
    .filter((selection) => !desiredSelectionIds.has(selection.id))
    .map((selection) => selection.id);
  await deleteSelections(input.client, absentSelectionIds);

  const linkedAddOnIdsToDelete = [...currentLinkedAddOnIds].filter(
    (id) => !desiredExistingLinkedAddOnIds.has(id)
  );
  await deleteAddOns(input.client, linkedAddOnIdsToDelete);

  await deleteItemUpgrades(
    input.client,
    rows.itemUpgrades
      .filter((upgrade) => !hasRealLine(groups.itemUpgradeLines, upgrade.id))
      .map((upgrade) => upgrade.id)
  );
  await deleteAddOns(
    input.client,
    rows.addOns
      .filter((addOn) => !currentLinkedAddOnIds.has(addOn.id))
      .filter((addOn) => !hasRealLine(groups.addOnLines, addOn.id))
      .map((addOn) => addOn.id)
  );

  for (const line of groups.packageLines) {
    const current = requiredMapValue(currentPackageById, line.orderEntityId);
    await updatePackageIfChanged(input.client, current, line);
  }

  for (const line of groups.addOnLines) {
    if (isDraftId(line.orderEntityId)) {
      const created = await createAddOn(input.client, input.orderId, line);
      draftToOrderEntityMap.set(line.orderEntityId, created.id);
    } else {
      await updateAddOnIfChanged(
        input.client,
        requiredMapValue(currentAddOnById, line.orderEntityId),
        line
      );
    }
  }

  for (const line of groups.itemUpgradeLines) {
    if (isDraftId(line.orderEntityId)) {
      const created = await createItemUpgrade(input.client, input.orderId, line);
      draftToOrderEntityMap.set(line.orderEntityId, created.id);
    } else {
      await updateItemUpgradeIfChanged(
        input.client,
        requiredMapValue(currentUpgradeById, line.orderEntityId),
        line
      );
    }
  }

  for (const line of groups.selectionLines) {
    if (isDraftId(line.orderEntityId)) {
      const created = await createSelection(input.client, line);
      draftToOrderEntityMap.set(line.orderEntityId, created.id);
    } else {
      const desiredIdentity = desiredLinkedIdentities.get(line.orderEntityId);
      await updateSelectionIfChanged(
        input.client,
        requiredMapValue(currentSelectionById, line.orderEntityId),
        line,
        desiredIdentity?.orderAddOnId ?? null
      );
    }
  }

  const actualLinkedAddOnByRef = new Map<string, string>();
  for (const line of groups.linkedAddOnLines) {
    const identity = linkedIdentity(line);
    const selectionId = materializedId(identity.selectionId, draftToOrderEntityMap);
    if (identity.draftOrderAddOnId) {
      const created = await createLinkedAddOn(input.client, input.orderId, line);
      draftToOrderEntityMap.set(identity.draftOrderAddOnId, created.id);
      actualLinkedAddOnByRef.set(identity.addOnRef, created.id);
    } else {
      const current = requiredMapValue(currentAddOnById, requiredString(identity.orderAddOnId));
      await updateAddOnIfChanged(input.client, current, line);
      actualLinkedAddOnByRef.set(identity.addOnRef, current.id);
    }

    if (isDraftId(identity.selectionId) && !draftToOrderEntityMap.has(identity.selectionId)) {
      throw new Error(
        `OrderCommit materialization failed: linked selection ${identity.selectionId} was not materialized.`
      );
    }
    await wireSelectionLinkedAddOnIfChanged(
      input.client,
      selectionId,
      actualLinkedAddOnByRef.get(identity.addOnRef) ?? requiredString(identity.orderAddOnId),
      currentSelectionById.get(identity.selectionId)
    );
  }

  await resyncOrderSelectedPhotoCountIfChanged(
    input.client,
    rows.order,
    groups.packageLines
  );

  return { draftToOrderEntityMap };
}

export function remapMaterializedSessionConfigurationSnapshot(
  input: RemapMaterializedSessionConfigurationSnapshotInput
): OrderCommitSnapshotV1 {
  const pendingSnapshot = orderCommitSnapshotV1Schema.parse(input.pendingSnapshot);
  return normalizeOrderCommitSnapshot({
    ...pendingSnapshot,
    lines: pendingSnapshot.lines.map((line) =>
      remapMaterializedSessionConfigurationLine(
        line,
        input.draftToOrderEntityMap
      )
    ),
  });
}

function remapMaterializedSessionConfigurationLine(
  line: OrderCommitSnapshotLineV1,
  draftToOrderEntityMap: ReadonlyMap<string, string>
): OrderCommitSnapshotLineV1 {
  if (line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION) {
    const selectionId = materializedId(line.orderEntityId, draftToOrderEntityMap);
    const linkedMetadata = remapLinkedProductMetadata(
      line.metadata,
      draftToOrderEntityMap
    );
    return {
      ...line,
      lineId: `session-config:${selectionId}`,
      orderEntityId: selectionId,
      stableKey: `session-configuration-selection:${selectionId}`,
      metadata: linkedMetadata.metadata,
    };
  }

  if (
    line.lineKind ===
    ORDER_COMMIT_SNAPSHOT_LINE_KIND.LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON
  ) {
    const selectionId = materializedId(line.orderEntityId, draftToOrderEntityMap);
    const linkedMetadata = remapLinkedProductMetadata(
      line.metadata,
      draftToOrderEntityMap
    );
    const addOnRef = linkedMetadata.addOnRef;
    if (!addOnRef) {
      throw new Error(
        `OrderCommit materialization failed: linked add-on line ${line.lineId} must reference orderAddOnId or draftOrderAddOnId.`
      );
    }
    return {
      ...line,
      lineId: `session-config:${selectionId}:addon:${addOnRef}`,
      orderEntityId: selectionId,
      stableKey: `session-configuration-selection:${selectionId}:add-on:${addOnRef}`,
      metadata: linkedMetadata.metadata,
    };
  }

  return line;
}

function remapLinkedProductMetadata(
  metadata: Record<string, unknown>,
  draftToOrderEntityMap: ReadonlyMap<string, string>
): { metadata: Record<string, unknown>; addOnRef: string | null } {
  const draftOrderAddOnId =
    typeof metadata.draftOrderAddOnId === "string"
      ? metadata.draftOrderAddOnId
      : null;
  const orderAddOnId =
    typeof metadata.orderAddOnId === "string" ? metadata.orderAddOnId : null;
  if (!draftOrderAddOnId) {
    return { metadata: { ...metadata }, addOnRef: orderAddOnId };
  }

  const materializedOrderAddOnId = materializedId(
    draftOrderAddOnId,
    draftToOrderEntityMap
  );
  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    orderAddOnId: materializedOrderAddOnId,
  };
  delete nextMetadata.draftOrderAddOnId;
  return { metadata: nextMetadata, addOnRef: materializedOrderAddOnId };
}

async function loadOrderRows(
  client: OrderCommitMaterializationClient,
  orderId: string
): Promise<LoadedOrderRows> {
  const [order, packages, addOns, itemUpgrades, selections] = await Promise.all([
    client.order.findUnique({
      where: { id: orderId },
      select: { id: true, selectedPhotoCount: true },
    }),
    client.orderPackage.findMany({
      where: { orderId },
      select: orderPackageSelect,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    client.orderAddOn.findMany({
      where: { orderId },
      select: orderAddOnSelect,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    client.orderPackageItemUpgrade.findMany({
      where: { orderId },
      select: orderPackageItemUpgradeSelect,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    client.orderPackageSessionConfigurationSelection.findMany({
      where: { orderPackage: { orderId } },
      select: sessionConfigurationSelectionSelect,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);

  if (!order) {
    throw new Error(`OrderCommit materialization failed: order ${orderId} was not found.`);
  }

  return { order, packages, addOns, itemUpgrades, selections };
}

function groupSnapshotLines(snapshot: OrderCommitSnapshotV1): SnapshotGroups {
  return {
    packageLines: snapshot.lines.filter(
      (line) => line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE
    ),
    addOnLines: snapshot.lines.filter(
      (line) => line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON
    ),
    itemUpgradeLines: snapshot.lines.filter(
      (line) =>
        line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE
    ),
    selectionLines: snapshot.lines.filter(
      (line) =>
        line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION
    ),
    linkedAddOnLines: snapshot.lines.filter(
      (line) =>
        line.lineKind ===
        ORDER_COMMIT_SNAPSHOT_LINE_KIND
          .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON
    ),
  };
}

function validatePackageMembershipBeforeWrites(
  packageLines: OrderCommitSnapshotLineV1[],
  currentPackages: CurrentOrderPackage[]
): void {
  const currentIds = new Set(currentPackages.map((row) => row.id));
  const pendingIds = new Set(packageLines.map((line) => line.orderEntityId));
  const draftPackageIds = packageLines
    .map((line) => line.orderEntityId)
    .filter(isDraftId);
  const missingCurrent = [...pendingIds].filter((id) => !currentIds.has(id));
  const missingPending = [...currentIds].filter((id) => !pendingIds.has(id));

  if (
    draftPackageIds.length > 0 ||
    missingCurrent.length > 0 ||
    missingPending.length > 0
  ) {
    throw new OrderCommitUnsupportedPackageMembershipError(
      [
        "OrderCommit materialization failed: package add/remove is not supported in Spec 124 Task 2.",
        `draftPackageIds=${draftPackageIds.join(",") || "none"}`,
        `pendingWithoutOrderPackage=${missingCurrent.join(",") || "none"}`,
        `orderPackagesMissingFromSnapshot=${missingPending.join(",") || "none"}`,
      ].join(" ")
    );
  }
}

function validateSupportedReferences(
  groups: SnapshotGroups,
  rows: LoadedOrderRows
): void {
  const packageIds = new Set(rows.packages.map((row) => row.id));
  const addOnIds = new Set(rows.addOns.map((row) => row.id));
  const linkedAddOnIds = new Set(
    rows.selections
      .map((selection) => selection.orderAddOnId)
      .filter((id): id is string => Boolean(id))
  );
  const itemUpgradeIds = new Set(rows.itemUpgrades.map((row) => row.id));
  const selectionIds = new Set(rows.selections.map((row) => row.id));

  for (const line of [
    ...groups.addOnLines,
    ...groups.itemUpgradeLines,
    ...groups.selectionLines,
    ...groups.linkedAddOnLines,
  ]) {
    if (line.parentOrderPackageId && !packageIds.has(line.parentOrderPackageId)) {
      throw new Error(
        `OrderCommit materialization failed: line ${line.lineId} references package ${line.parentOrderPackageId}, which was not found.`
      );
    }
  }

  for (const line of groups.addOnLines) {
    requireCatalogEntityId(line);
    if (!isDraftId(line.orderEntityId) && !addOnIds.has(line.orderEntityId)) {
      throw new Error(
        `OrderCommit materialization failed: add-on ${line.orderEntityId} was not found.`
      );
    }
    if (linkedAddOnIds.has(line.orderEntityId)) {
      throw new Error(
        `OrderCommit materialization failed: linked add-on ${line.orderEntityId} cannot be materialized as a non-linked add-on.`
      );
    }
  }

  for (const line of groups.itemUpgradeLines) {
    requireParentOrderPackageId(line);
    requireCatalogEntityId(line);
    if (!isDraftId(line.orderEntityId) && !itemUpgradeIds.has(line.orderEntityId)) {
      throw new Error(
        `OrderCommit materialization failed: package item upgrade ${line.orderEntityId} was not found.`
      );
    }
  }

  for (const line of groups.selectionLines) {
    requireParentOrderPackageId(line);
    requireCatalogEntityId(line);
    selectionData(line);
    if (!isDraftId(line.orderEntityId) && !selectionIds.has(line.orderEntityId)) {
      throw new Error(
        `OrderCommit materialization failed: session configuration selection ${line.orderEntityId} was not found.`
      );
    }
  }

  const linkedBySelection = new Map<string, OrderCommitSnapshotLineV1[]>();
  for (const line of groups.linkedAddOnLines) {
    requireParentOrderPackageId(line);
    requireCatalogEntityId(line);
    const identity = linkedIdentity(line);
    if (!isDraftId(identity.addOnRef) && !addOnIds.has(identity.addOnRef)) {
      throw new Error(
        `OrderCommit materialization failed: linked add-on ${identity.addOnRef} was not found.`
      );
    }
    if (!linkedBySelection.has(identity.selectionId)) {
      linkedBySelection.set(identity.selectionId, []);
    }
    linkedBySelection.get(identity.selectionId)?.push(line);
  }

  for (const selectionLine of groups.selectionLines) {
    const identity = optionalLinkedIdentity(selectionLine);
    const linkedLines = linkedBySelection.get(selectionLine.orderEntityId) ?? [];
    if (!identity && linkedLines.length === 0) continue;
    if (!identity || linkedLines.length !== 1) {
      throw new Error(
        `OrderCommit materialization failed: selection ${selectionLine.orderEntityId} must own exactly one linked add-on line.`
      );
    }
    const linkedLineIdentity = linkedIdentity(linkedLines[0]);
    if (linkedLineIdentity.addOnRef !== identity.addOnRef) {
      throw new Error(
        `OrderCommit materialization failed: selection ${selectionLine.orderEntityId} linked add-on identity mismatch.`
      );
    }
  }
}

function linkedIdentitiesBySelection(
  groups: SnapshotGroups
): Map<string, LinkedAddOnIdentity> {
  const identities = new Map<string, LinkedAddOnIdentity>();
  for (const line of groups.linkedAddOnLines) {
    const identity = linkedIdentity(line);
    identities.set(identity.selectionId, identity);
  }
  return identities;
}

async function updateSelectionsToNullLinkedAddOns(
  client: OrderCommitMaterializationClient,
  selections: CurrentSessionConfigurationSelection[]
): Promise<void> {
  const ids = selections.map((selection) => selection.id);
  if (ids.length === 0) return;
  await client.orderPackageSessionConfigurationSelection.updateMany({
    where: { id: { in: ids } },
    data: { orderAddOnId: null },
  });
}

async function deleteSelections(
  client: OrderCommitMaterializationClient,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  await client.orderPackageSessionConfigurationSelection.deleteMany({
    where: { id: { in: ids } },
  });
}

async function deleteAddOns(
  client: OrderCommitMaterializationClient,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  await client.orderAddOn.deleteMany({ where: { id: { in: ids } } });
}

async function deleteItemUpgrades(
  client: OrderCommitMaterializationClient,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  await client.orderPackageItemUpgrade.deleteMany({
    where: { id: { in: ids } },
  });
}

async function updatePackageIfChanged(
  client: OrderCommitMaterializationClient,
  current: CurrentOrderPackage,
  line: OrderCommitSnapshotLineV1
): Promise<void> {
  const data = packageUpdateData(current, line);
  if (Object.keys(data).length === 0) return;
  await client.orderPackage.update({ where: { id: current.id }, data });
}

function packageUpdateData(
  current: CurrentOrderPackage,
  line: OrderCommitSnapshotLineV1
): Prisma.OrderPackageUpdateInput {
  const data: Prisma.OrderPackageUpdateInput = {};
  const catalogEntityId = requireCatalogEntityId(line);
  const selectedPhotoCount = metadataInteger(line, "selectedPhotoCount");
  const extraDigitalCount = metadataInteger(line, "extraDigitalCount");
  const extraPrintCount = metadataInteger(line, "extraPrintCount");
  const sessionTypeId = metadataString(line, "sessionTypeId");

  if (current.currentPackageId !== catalogEntityId) {
    data.currentPackage = { connect: { id: catalogEntityId } };
  }
  if (current.currentPackageNameSnapshot !== line.label) {
    data.currentPackageNameSnapshot = line.label;
  }
  if (!decimalEquals(current.finalPackagePriceSnapshot, line.unitPrice)) {
    data.finalPackagePriceSnapshot = decimal(line.unitPrice);
  }
  if (current.selectedPhotoCount !== selectedPhotoCount) {
    data.selectedPhotoCount = selectedPhotoCount;
  }
  if (current.extraDigitalCount !== extraDigitalCount) {
    data.extraDigitalCount = extraDigitalCount;
  }
  if (current.extraPrintCount !== extraPrintCount) {
    data.extraPrintCount = extraPrintCount;
  }
  if (current.sessionTypeId !== sessionTypeId) {
    data.sessionType = { connect: { id: sessionTypeId } };
  }

  return data;
}

async function createAddOn(
  client: OrderCommitMaterializationClient,
  orderId: string,
  line: OrderCommitSnapshotLineV1
): Promise<{ id: string }> {
  return client.orderAddOn.create({
    data: addOnCreateData(orderId, line),
    select: { id: true },
  });
}

async function createLinkedAddOn(
  client: OrderCommitMaterializationClient,
  orderId: string,
  line: OrderCommitSnapshotLineV1
): Promise<{ id: string }> {
  return client.orderAddOn.create({
    data: addOnCreateData(orderId, line),
    select: { id: true },
  });
}

function addOnCreateData(
  orderId: string,
  line: OrderCommitSnapshotLineV1
): Prisma.OrderAddOnCreateInput {
  return {
    order: { connect: { id: orderId } },
    ...(line.parentOrderPackageId
      ? { orderPackage: { connect: { id: line.parentOrderPackageId } } }
      : {}),
    product: { connect: { id: requireCatalogEntityId(line) } },
    nameSnapshot: line.label,
    priceSnapshot: decimal(line.unitPrice),
    quantity: line.quantity,
    notes: nullableMetadataString(line, "notes") ?? nullableMetadataString(line, "addOnNotes"),
  };
}

async function updateAddOnIfChanged(
  client: OrderCommitMaterializationClient,
  current: CurrentOrderAddOn,
  line: OrderCommitSnapshotLineV1
): Promise<void> {
  const data: Prisma.OrderAddOnUpdateInput = {};
  const productId = requireCatalogEntityId(line);
  const notes = nullableMetadataString(line, "notes") ?? nullableMetadataString(line, "addOnNotes");

  if (current.orderPackageId !== line.parentOrderPackageId) {
    data.orderPackage = line.parentOrderPackageId
      ? { connect: { id: line.parentOrderPackageId } }
      : { disconnect: true };
  }
  if (current.productId !== productId) {
    data.product = { connect: { id: productId } };
  }
  if (current.nameSnapshot !== line.label) data.nameSnapshot = line.label;
  if (!decimalEquals(current.priceSnapshot, line.unitPrice)) {
    data.priceSnapshot = decimal(line.unitPrice);
  }
  if (current.quantity !== line.quantity) data.quantity = line.quantity;
  if (current.notes !== notes) data.notes = notes;

  if (Object.keys(data).length === 0) return;
  await client.orderAddOn.update({ where: { id: current.id }, data });
}

async function createItemUpgrade(
  client: OrderCommitMaterializationClient,
  orderId: string,
  line: OrderCommitSnapshotLineV1
): Promise<{ id: string }> {
  return client.orderPackageItemUpgrade.create({
    data: {
      order: { connect: { id: orderId } },
      orderPackage: { connect: { id: requireParentOrderPackageId(line) } },
      packageItem: { connect: { id: requireCatalogEntityId(line) } },
      nameSnapshot: line.label,
      priceSnapshot: decimal(line.unitPrice),
      quantity: line.quantity,
      notes: nullableMetadataString(line, "notes"),
    },
    select: { id: true },
  });
}

async function updateItemUpgradeIfChanged(
  client: OrderCommitMaterializationClient,
  current: CurrentOrderPackageItemUpgrade,
  line: OrderCommitSnapshotLineV1
): Promise<void> {
  const data: Prisma.OrderPackageItemUpgradeUpdateInput = {};
  const packageItemId = requireCatalogEntityId(line);
  const notes = nullableMetadataString(line, "notes");

  if (current.orderPackageId !== line.parentOrderPackageId) {
    data.orderPackage = { connect: { id: requireParentOrderPackageId(line) } };
  }
  if (current.packageItemId !== packageItemId) {
    data.packageItem = { connect: { id: packageItemId } };
  }
  if (current.nameSnapshot !== line.label) data.nameSnapshot = line.label;
  if (!decimalEquals(current.priceSnapshot, line.unitPrice)) {
    data.priceSnapshot = decimal(line.unitPrice);
  }
  if (current.quantity !== line.quantity) data.quantity = line.quantity;
  if (current.notes !== notes) data.notes = notes;

  if (Object.keys(data).length === 0) return;
  await client.orderPackageItemUpgrade.update({ where: { id: current.id }, data });
}

async function createSelection(
  client: OrderCommitMaterializationClient,
  line: OrderCommitSnapshotLineV1
): Promise<{ id: string }> {
  return client.orderPackageSessionConfigurationSelection.create({
    data: selectionCreateData(line, null),
    select: { id: true },
  });
}

function selectionCreateData(
  line: OrderCommitSnapshotLineV1,
  orderAddOnId: string | null
): Prisma.OrderPackageSessionConfigurationSelectionCreateInput {
  const data = selectionData(line);
  return {
    orderPackage: { connect: { id: requireParentOrderPackageId(line) } },
    configuration: { connect: { id: requireCatalogEntityId(line) } },
    ...(data.optionId
      ? {
          option: {
            connect: {
              id_configurationId: {
                id: data.optionId,
                configurationId: requireCatalogEntityId(line),
              },
            },
          },
        }
      : {}),
    numericValue: data.numericValue,
    textValue: data.textValue,
    snapshotOptionLabel: data.snapshotOptionLabel,
    snapshotConfigurationCode: data.snapshotConfigurationCode,
    snapshotLabel: data.snapshotLabel,
    snapshotPriceDelta: decimal(data.snapshotPriceDelta),
    snapshotFinancialBehavior: data.snapshotFinancialBehavior,
    snapshotInputType: data.snapshotInputType,
    snapshotPricingMode: data.snapshotPricingMode,
    snapshotLinkedProductId: data.snapshotLinkedProductId,
    ...(orderAddOnId ? { orderAddOn: { connect: { id: orderAddOnId } } } : {}),
  };
}

async function updateSelectionIfChanged(
  client: OrderCommitMaterializationClient,
  current: CurrentSessionConfigurationSelection,
  line: OrderCommitSnapshotLineV1,
  orderAddOnId: string | null
): Promise<void> {
  const data = selectionUpdateData(current, line, orderAddOnId);
  if (Object.keys(data).length === 0) return;
  await client.orderPackageSessionConfigurationSelection.update({
    where: { id: current.id },
    data,
  });
}

function selectionUpdateData(
  current: CurrentSessionConfigurationSelection,
  line: OrderCommitSnapshotLineV1,
  orderAddOnId: string | null
): Prisma.OrderPackageSessionConfigurationSelectionUpdateInput {
  const next = selectionData(line);
  const data: Prisma.OrderPackageSessionConfigurationSelectionUpdateInput = {};

  if (current.orderPackageId !== line.parentOrderPackageId) {
    data.orderPackage = { connect: { id: requireParentOrderPackageId(line) } };
  }
  if (current.configurationId !== line.catalogEntityId) {
    data.configuration = { connect: { id: requireCatalogEntityId(line) } };
  }
  if (current.optionId !== next.optionId) {
    data.option = next.optionId
      ? {
          connect: {
            id_configurationId: {
              id: next.optionId,
              configurationId: requireCatalogEntityId(line),
            },
          },
        }
      : { disconnect: true };
  }
  if (!decimalOrNullEquals(current.numericValue, next.numericValue)) {
    data.numericValue = next.numericValue;
  }
  if (current.textValue !== next.textValue) data.textValue = next.textValue;
  if (current.snapshotOptionLabel !== next.snapshotOptionLabel) {
    data.snapshotOptionLabel = next.snapshotOptionLabel;
  }
  if (current.snapshotConfigurationCode !== next.snapshotConfigurationCode) {
    data.snapshotConfigurationCode = next.snapshotConfigurationCode;
  }
  if (current.snapshotLabel !== next.snapshotLabel) {
    data.snapshotLabel = next.snapshotLabel;
  }
  if (!decimalEquals(current.snapshotPriceDelta, next.snapshotPriceDelta)) {
    data.snapshotPriceDelta = decimal(next.snapshotPriceDelta);
  }
  if (current.snapshotFinancialBehavior !== next.snapshotFinancialBehavior) {
    data.snapshotFinancialBehavior = next.snapshotFinancialBehavior;
  }
  if (current.snapshotInputType !== next.snapshotInputType) {
    data.snapshotInputType = next.snapshotInputType;
  }
  if (current.snapshotPricingMode !== next.snapshotPricingMode) {
    data.snapshotPricingMode = next.snapshotPricingMode;
  }
  if (current.snapshotLinkedProductId !== next.snapshotLinkedProductId) {
    data.snapshotLinkedProductId = next.snapshotLinkedProductId;
  }
  if (current.orderAddOnId !== orderAddOnId) {
    data.orderAddOn = orderAddOnId
      ? { connect: { id: orderAddOnId } }
      : { disconnect: true };
  }

  return data;
}

async function wireSelectionLinkedAddOnIfChanged(
  client: OrderCommitMaterializationClient,
  selectionId: string,
  orderAddOnId: string,
  currentSelection: CurrentSessionConfigurationSelection | undefined
): Promise<void> {
  if (currentSelection?.orderAddOnId === orderAddOnId) return;
  await client.orderPackageSessionConfigurationSelection.update({
    where: { id: selectionId },
    data: { orderAddOn: { connect: { id: orderAddOnId } } },
  });
}

async function resyncOrderSelectedPhotoCountIfChanged(
  client: OrderCommitMaterializationClient,
  order: { id: string; selectedPhotoCount: number | null },
  packageLines: OrderCommitSnapshotLineV1[]
): Promise<void> {
  const selectedPhotoCount = packageLines.reduce(
    (sum, line) => sum + metadataInteger(line, "selectedPhotoCount"),
    0
  );
  if (order.selectedPhotoCount === selectedPhotoCount) return;
  await client.order.update({
    where: { id: order.id },
    data: { selectedPhotoCount },
  });
}

function selectionData(line: OrderCommitSnapshotLineV1): {
  optionId: string | null;
  numericValue: Prisma.Decimal | null;
  textValue: string | null;
  snapshotOptionLabel: string | null;
  snapshotConfigurationCode: string;
  snapshotLabel: string;
  snapshotPriceDelta: number;
  snapshotFinancialBehavior: SessionConfigurationFinancialBehavior;
  snapshotInputType: SessionConfigurationInputType;
  snapshotPricingMode: SessionConfigurationPricingMode;
  snapshotLinkedProductId: string | null;
} {
  const numericValue = nullableMetadataString(line, "numericValue");
  return {
    optionId: nullableMetadataString(line, "optionId"),
    numericValue: numericValue === null ? null : new Prisma.Decimal(numericValue),
    textValue: nullableMetadataString(line, "textValue"),
    snapshotOptionLabel: nullableMetadataString(line, "snapshotOptionLabel"),
    snapshotConfigurationCode: metadataString(line, "snapshotConfigurationCode"),
    snapshotLabel: metadataString(line, "snapshotLabel"),
    snapshotPriceDelta: metadataNumber(line, "snapshotPriceDelta"),
    snapshotFinancialBehavior: enumValue(
      line,
      "snapshotFinancialBehavior",
      SessionConfigurationFinancialBehavior
    ),
    snapshotInputType: enumValue(
      line,
      "snapshotInputType",
      SessionConfigurationInputType
    ),
    snapshotPricingMode: enumValue(
      line,
      "snapshotPricingMode",
      SessionConfigurationPricingMode
    ),
    snapshotLinkedProductId: nullableMetadataString(line, "snapshotLinkedProductId"),
  };
}

function optionalLinkedIdentity(
  line: OrderCommitSnapshotLineV1
): LinkedAddOnIdentity | null {
  const orderAddOnId = nullableMetadataString(line, "orderAddOnId");
  const draftOrderAddOnId = nullableMetadataString(line, "draftOrderAddOnId");
  if (!orderAddOnId && !draftOrderAddOnId) return null;
  if (Boolean(orderAddOnId) === Boolean(draftOrderAddOnId)) {
    throw new Error(
      `OrderCommit materialization failed: line ${line.lineId} must reference exactly one linked add-on id.`
    );
  }
  const addOnRef = orderAddOnId ?? requiredString(draftOrderAddOnId);
  return {
    selectionId: line.orderEntityId,
    addOnRef,
    orderAddOnId,
    draftOrderAddOnId,
  };
}

function linkedIdentity(line: OrderCommitSnapshotLineV1): LinkedAddOnIdentity {
  const identity = optionalLinkedIdentity(line);
  if (!identity) {
    throw new Error(
      `OrderCommit materialization failed: linked add-on line ${line.lineId} must reference orderAddOnId or draftOrderAddOnId.`
    );
  }
  return identity;
}

function materializedId(id: string, draftMap: ReadonlyMap<string, string>): string {
  if (!isDraftId(id)) return id;
  const materialized = draftMap.get(id);
  if (!materialized) {
    throw new Error(`OrderCommit materialization failed: draft id ${id} was not materialized.`);
  }
  return materialized;
}

function requiredMapValue<T>(map: ReadonlyMap<string, T>, key: string): T {
  const value = map.get(key);
  if (!value) {
    throw new Error(`OrderCommit materialization failed: row ${key} was not found.`);
  }
  return value;
}

function hasRealLine(lines: OrderCommitSnapshotLineV1[], id: string): boolean {
  return lines.some((line) => line.orderEntityId === id);
}

function requireParentOrderPackageId(line: OrderCommitSnapshotLineV1): string {
  if (!line.parentOrderPackageId) {
    throw new Error(
      `OrderCommit materialization failed: line ${line.lineId} requires parentOrderPackageId.`
    );
  }
  return line.parentOrderPackageId;
}

function requireCatalogEntityId(line: OrderCommitSnapshotLineV1): string {
  if (!line.catalogEntityId) {
    throw new Error(
      `OrderCommit materialization failed: line ${line.lineId} requires catalogEntityId.`
    );
  }
  return line.catalogEntityId;
}

function metadataString(line: OrderCommitSnapshotLineV1, key: string): string {
  const value = line.metadata[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `OrderCommit materialization failed: line ${line.lineId} requires metadata.${key}.`
    );
  }
  return value;
}

function nullableMetadataString(
  line: OrderCommitSnapshotLineV1,
  key: string
): string | null {
  const value = line.metadata[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(
      `OrderCommit materialization failed: line ${line.lineId} metadata.${key} must be a string or null.`
    );
  }
  return value;
}

function metadataInteger(line: OrderCommitSnapshotLineV1, key: string): number {
  const value = line.metadata[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(
      `OrderCommit materialization failed: line ${line.lineId} requires integer metadata.${key}.`
    );
  }
  return value;
}

function metadataNumber(line: OrderCommitSnapshotLineV1, key: string): number {
  const value = line.metadata[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `OrderCommit materialization failed: line ${line.lineId} requires numeric metadata.${key}.`
    );
  }
  return value;
}

function enumValue<T extends Record<string, string>>(
  line: OrderCommitSnapshotLineV1,
  key: string,
  enumObject: T
): T[keyof T] {
  const value = metadataString(line, key);
  if (!Object.values(enumObject).includes(value)) {
    throw new Error(
      `OrderCommit materialization failed: line ${line.lineId} metadata.${key} is invalid.`
    );
  }
  return value as T[keyof T];
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(roundMoney(value).toFixed(3));
}

function roundMoney(value: number): number {
  return Number(value.toFixed(3));
}

function decimalEquals(value: Prisma.Decimal | null, next: number): boolean {
  return value !== null && Number(value.toFixed(3)) === roundMoney(next);
}

function decimalOrNullEquals(
  value: Prisma.Decimal | null,
  next: Prisma.Decimal | null
): boolean {
  if (value === null || next === null) return value === next;
  return value.equals(next);
}

function isDraftId(id: string): boolean {
  return id.startsWith("draft:");
}

function requiredString(value: string | null): string {
  if (!value) {
    throw new Error("OrderCommit materialization failed: expected string value.");
  }
  return value;
}
