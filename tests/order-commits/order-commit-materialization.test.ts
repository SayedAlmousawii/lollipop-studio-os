import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  Prisma,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationPricingMode,
  UserRole,
} from "@prisma/client";
import {
  materializeOrderCommitDraftIntoOrderRows,
  normalizeOrderCommitSnapshot,
  OrderCommitUnsupportedPackageMembershipError,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  type OrderCommitMaterializationClient,
  type OrderCommitSnapshotLineV1,
  type OrderCommitSnapshotV1,
} from "@/modules/order-commits";

const actorContext = {
  actorUserId: "user-manager",
  actorRole: UserRole.MANAGER,
};

test("no-op materialization leaves operational rows untouched", async () => {
  const state = materializationState();
  const client = fakeMaterializationClient(state);

  const result = await materializeOrderCommitDraftIntoOrderRows({
    orderId: state.order.id,
    pendingSnapshot: snapshotFromState(state),
    actorContext,
    client,
  });

  assert.deepEqual([...result.draftToOrderEntityMap.entries()], []);
  assert.deepEqual(state.operations, []);
});

test("materializes package, add-on, item-upgrade, photo, session, and linked-product deltas", async () => {
  const state = materializationState();
  const client = fakeMaterializationClient(state);
  const pendingSnapshot = normalizeOrderCommitSnapshot({
    ...snapshotFromState(state),
    lines: [
      packageLine({
        catalogEntityId: "package-premium",
        label: "Premium Package",
        unitPrice: 180,
        selectedPhotoCount: 14,
        extraDigitalCount: 3,
        extraPrintCount: 2,
      }),
      addOnLine({
        orderEntityId: "addon-keep",
        productId: "product-frame-updated",
        label: "Updated Frame",
        quantity: 4,
        unitPrice: 22,
        notes: "updated",
      }),
      addOnLine({
        orderEntityId: "draft:addon-new",
        productId: "product-canvas",
        label: "Canvas",
        quantity: 2,
        unitPrice: 35,
        notes: "new add-on",
      }),
      itemUpgradeLine({
        orderEntityId: "upgrade-keep",
        packageItemId: "package-item-premium",
        label: "Premium Spread",
        quantity: 3,
        unitPrice: 18,
        notes: "updated item",
      }),
      itemUpgradeLine({
        orderEntityId: "draft:upgrade-new",
        packageItemId: "package-item-cover",
        label: "Leather Cover",
        quantity: 1,
        unitPrice: 40,
      }),
      selectionLine({
        selectionId: "selection-keep",
        configurationId: "configuration-backdrop",
        optionId: "option-blue",
        label: "Backdrop - Blue",
        snapshotLabel: "Backdrop",
        snapshotOptionLabel: "Blue",
        priceDelta: 15,
      }),
      selectionLine({
        selectionId: "draft:selection-album",
        configurationId: "configuration-album",
        optionId: "option-album",
        label: "Album",
        snapshotLabel: "Album",
        snapshotOptionLabel: "Album",
        priceDelta: 0,
        pricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
        linkedProductId: "product-album",
        draftOrderAddOnId: "draft:linked-addon-album",
      }),
      linkedAddOnLine({
        selectionId: "draft:selection-album",
        draftOrderAddOnId: "draft:linked-addon-album",
        productId: "product-album",
        label: "Premium Album",
        quantity: 1,
        unitPrice: 55,
        notes: "selection-owned",
      }),
    ],
  });

  const result = await materializeOrderCommitDraftIntoOrderRows({
    orderId: state.order.id,
    pendingSnapshot,
    actorContext,
    client,
  });

  assert.equal(state.packages[0]?.currentPackageId, "package-premium");
  assert.equal(state.packages[0]?.currentPackageNameSnapshot, "Premium Package");
  assert.equal(money(state.packages[0]?.finalPackagePriceSnapshot), 180);
  assert.equal(state.packages[0]?.selectedPhotoCount, 14);
  assert.equal(state.packages[0]?.extraDigitalCount, 3);
  assert.equal(state.packages[0]?.extraPrintCount, 2);
  assert.equal(state.order.selectedPhotoCount, 14);

  assert.equal(state.addOns.some((addOn) => addOn.id === "addon-remove"), false);
  assert.equal(state.addOns.some((addOn) => addOn.id === "linked-remove"), false);
  assert.equal(state.addOns.find((addOn) => addOn.id === "addon-keep")?.quantity, 4);
  const createdAddOnId = result.draftToOrderEntityMap.get("draft:addon-new");
  assert.ok(createdAddOnId);
  assert.equal(
    state.addOns.find((addOn) => addOn.id === createdAddOnId)?.productId,
    "product-canvas"
  );

  assert.equal(
    state.itemUpgrades.some((upgrade) => upgrade.id === "upgrade-remove"),
    false
  );
  assert.equal(
    state.itemUpgrades.find((upgrade) => upgrade.id === "upgrade-keep")?.quantity,
    3
  );
  const createdUpgradeId = result.draftToOrderEntityMap.get("draft:upgrade-new");
  assert.ok(createdUpgradeId);
  assert.equal(
    state.itemUpgrades.find((upgrade) => upgrade.id === createdUpgradeId)
      ?.packageItemId,
    "package-item-cover"
  );

  assert.equal(state.selections.some((selection) => selection.id === "selection-remove"), false);
  assert.equal(
    state.selections.find((selection) => selection.id === "selection-keep")
      ?.optionId,
    "option-blue"
  );
  const createdSelectionId = result.draftToOrderEntityMap.get(
    "draft:selection-album"
  );
  const createdLinkedAddOnId = result.draftToOrderEntityMap.get(
    "draft:linked-addon-album"
  );
  assert.ok(createdSelectionId);
  assert.ok(createdLinkedAddOnId);
  assert.equal(
    state.selections.find((selection) => selection.id === createdSelectionId)
      ?.orderAddOnId,
    createdLinkedAddOnId
  );
  assert.equal(
    state.addOns.find((addOn) => addOn.id === createdLinkedAddOnId)?.productId,
    "product-album"
  );

  const packageUpdates = state.operations.filter(
    (operation) => operation.model === "orderPackage" && operation.action === "update"
  );
  assert.equal(packageUpdates.length, 1);
  assert.doesNotMatch(
    JSON.stringify(packageUpdates[0]?.data),
    /originalPackageId|originalPackageNameSnapshot|originalPackagePriceSnapshot|bookingPackageId/
  );
});

test("rejects unsupported package membership before any writes", async () => {
  const state = materializationState();
  const client = fakeMaterializationClient(state);
  const missingPackageSnapshot = normalizeOrderCommitSnapshot({
    ...snapshotFromState(state),
    lines: snapshotFromState(state).lines.filter(
      (line) => line.lineKind !== ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE
    ),
  });

  await assert.rejects(
    materializeOrderCommitDraftIntoOrderRows({
      orderId: state.order.id,
      pendingSnapshot: missingPackageSnapshot,
      actorContext,
      client,
    }),
    OrderCommitUnsupportedPackageMembershipError
  );
  assert.deepEqual(state.operations, []);

  const draftPackageSnapshot = normalizeOrderCommitSnapshot({
    ...snapshotFromState(state),
    lines: [
      ...snapshotFromState(state).lines,
      packageLine({
        orderEntityId: "draft:package-new",
        catalogEntityId: "package-new",
        stableKey: "order-package:draft:package-new",
      }),
    ],
  });

  await assert.rejects(
    materializeOrderCommitDraftIntoOrderRows({
      orderId: state.order.id,
      pendingSnapshot: draftPackageSnapshot,
      actorContext,
      client,
    }),
    OrderCommitUnsupportedPackageMembershipError
  );
  assert.deepEqual(state.operations, []);
});

test("rerunning a whole aborted attempt produces the same final row state", async () => {
  const pendingSnapshot = normalizeOrderCommitSnapshot({
    ...snapshotFromState(materializationState()),
    lines: [
      packageLine({ selectedPhotoCount: 12 }),
      addOnLine({
        orderEntityId: "draft:addon-new",
        productId: "product-canvas",
        label: "Canvas",
        quantity: 2,
        unitPrice: 35,
      }),
    ],
  });
  const abortedState = materializationState();
  await assert.rejects(
    materializeOrderCommitDraftIntoOrderRows({
      orderId: abortedState.order.id,
      pendingSnapshot,
      actorContext,
      client: fakeMaterializationClient(abortedState, { failAfterWrites: 1 }),
    })
  );

  const retryState = materializationState();
  await materializeOrderCommitDraftIntoOrderRows({
    orderId: retryState.order.id,
    pendingSnapshot,
    actorContext,
    client: fakeMaterializationClient(retryState),
  });

  const referenceState = materializationState();
  await materializeOrderCommitDraftIntoOrderRows({
    orderId: referenceState.order.id,
    pendingSnapshot,
    actorContext,
    client: fakeMaterializationClient(referenceState),
  });

  assert.deepEqual(serializableRows(retryState), serializableRows(referenceState));
});

test("materializer source stays inside the Task 2 boundary", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/order-commits/order-commit-materialization.service.ts"
    ),
    "utf8"
  );

  assert.doesNotMatch(source, /invoiceLineItem|pendingOpsJson/i);
  assert.doesNotMatch(source, /adjustment-workspace/);
  assert.doesNotMatch(
    source,
    /@\/modules\/(invoices|payments|refunds)|@\/modules\/financial\/edit-classifier/
  );
  assert.doesNotMatch(source, /\.(invoice|payment|refund|orderCommitDocument)\./);

  const packageUpdateBody = source
    .split("function packageUpdateData")[1]
    ?.split("async function createAddOn")[0];
  assert.ok(packageUpdateBody);
  assert.doesNotMatch(
    packageUpdateBody,
    /originalPackageId|originalPackageNameSnapshot|originalPackagePriceSnapshot|bookingPackageId/
  );
});

type MaterializationState = {
  order: { id: string; selectedPhotoCount: number | null };
  packages: FakeOrderPackage[];
  addOns: FakeOrderAddOn[];
  itemUpgrades: FakeItemUpgrade[];
  selections: FakeSelection[];
  operations: FakeOperation[];
};

type FakeOrderPackage = {
  id: string;
  orderId: string;
  originalPackageId: string;
  currentPackageId: string;
  bookingPackageId: string | null;
  sessionTypeId: string;
  originalPackageNameSnapshot: string;
  currentPackageNameSnapshot: string;
  originalPackagePriceSnapshot: Prisma.Decimal | null;
  finalPackagePriceSnapshot: Prisma.Decimal | null;
  selectedPhotoCount: number | null;
  extraDigitalCount: number;
  extraPrintCount: number;
  sortOrder: number;
  createdAt: Date;
};

type FakeOrderAddOn = {
  id: string;
  orderId: string;
  orderPackageId: string | null;
  productId: string;
  nameSnapshot: string;
  priceSnapshot: Prisma.Decimal;
  quantity: number;
  notes: string | null;
  createdAt: Date;
};

type FakeItemUpgrade = {
  id: string;
  orderId: string;
  orderPackageId: string;
  packageItemId: string;
  nameSnapshot: string;
  priceSnapshot: Prisma.Decimal;
  quantity: number;
  notes: string | null;
  createdAt: Date;
};

type FakeSelection = {
  id: string;
  orderPackageId: string;
  configurationId: string;
  optionId: string | null;
  numericValue: Prisma.Decimal | null;
  textValue: string | null;
  snapshotOptionLabel: string | null;
  snapshotConfigurationCode: string;
  snapshotLabel: string;
  snapshotPriceDelta: Prisma.Decimal;
  snapshotFinancialBehavior: SessionConfigurationFinancialBehavior;
  snapshotInputType: SessionConfigurationInputType;
  snapshotPricingMode: SessionConfigurationPricingMode;
  snapshotLinkedProductId: string | null;
  orderAddOnId: string | null;
  createdAt: Date;
};

type FakeOperation = {
  model: string;
  action: string;
  id?: string;
  data?: unknown;
};

function materializationState(): MaterializationState {
  return {
    order: { id: "order-1", selectedPhotoCount: 10 },
    packages: [
      {
        id: "package-line-1",
        orderId: "order-1",
        originalPackageId: "package-original",
        currentPackageId: "package-basic",
        bookingPackageId: "booking-package-1",
        sessionTypeId: "session-type-1",
        originalPackageNameSnapshot: "Original Package",
        currentPackageNameSnapshot: "Basic Package",
        originalPackagePriceSnapshot: decimal("100.000"),
        finalPackagePriceSnapshot: decimal("120.000"),
        selectedPhotoCount: 10,
        extraDigitalCount: 1,
        extraPrintCount: 0,
        sortOrder: 1,
        createdAt: new Date("2026-06-01T08:00:00.000Z"),
      },
    ],
    addOns: [
      {
        id: "addon-keep",
        orderId: "order-1",
        orderPackageId: "package-line-1",
        productId: "product-frame",
        nameSnapshot: "Frame",
        priceSnapshot: decimal("20.000"),
        quantity: 1,
        notes: "existing",
        createdAt: new Date("2026-06-01T08:01:00.000Z"),
      },
      {
        id: "addon-remove",
        orderId: "order-1",
        orderPackageId: "package-line-1",
        productId: "product-remove",
        nameSnapshot: "Removed Add-On",
        priceSnapshot: decimal("10.000"),
        quantity: 1,
        notes: null,
        createdAt: new Date("2026-06-01T08:02:00.000Z"),
      },
      {
        id: "linked-remove",
        orderId: "order-1",
        orderPackageId: "package-line-1",
        productId: "product-linked-remove",
        nameSnapshot: "Removed Linked Product",
        priceSnapshot: decimal("25.000"),
        quantity: 1,
        notes: null,
        createdAt: new Date("2026-06-01T08:03:00.000Z"),
      },
    ],
    itemUpgrades: [
      {
        id: "upgrade-keep",
        orderId: "order-1",
        orderPackageId: "package-line-1",
        packageItemId: "package-item-basic",
        nameSnapshot: "Basic Spread",
        priceSnapshot: decimal("12.000"),
        quantity: 1,
        notes: "existing item",
        createdAt: new Date("2026-06-01T08:04:00.000Z"),
      },
      {
        id: "upgrade-remove",
        orderId: "order-1",
        orderPackageId: "package-line-1",
        packageItemId: "package-item-remove",
        nameSnapshot: "Removed Item",
        priceSnapshot: decimal("8.000"),
        quantity: 1,
        notes: null,
        createdAt: new Date("2026-06-01T08:05:00.000Z"),
      },
    ],
    selections: [
      {
        id: "selection-keep",
        orderPackageId: "package-line-1",
        configurationId: "configuration-backdrop",
        optionId: "option-gold",
        numericValue: null,
        textValue: null,
        snapshotOptionLabel: "Gold",
        snapshotConfigurationCode: "BACKDROP",
        snapshotLabel: "Backdrop",
        snapshotPriceDelta: decimal("12.000"),
        snapshotFinancialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
        snapshotInputType: SessionConfigurationInputType.SELECT,
        snapshotPricingMode: SessionConfigurationPricingMode.FIXED,
        snapshotLinkedProductId: null,
        orderAddOnId: null,
        createdAt: new Date("2026-06-01T08:06:00.000Z"),
      },
      {
        id: "selection-remove",
        orderPackageId: "package-line-1",
        configurationId: "configuration-album-remove",
        optionId: "option-remove",
        numericValue: null,
        textValue: null,
        snapshotOptionLabel: "Remove",
        snapshotConfigurationCode: "ALBUM_REMOVE",
        snapshotLabel: "Album Remove",
        snapshotPriceDelta: decimal("0.000"),
        snapshotFinancialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
        snapshotInputType: SessionConfigurationInputType.SELECT,
        snapshotPricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
        snapshotLinkedProductId: "product-linked-remove",
        orderAddOnId: "linked-remove",
        createdAt: new Date("2026-06-01T08:07:00.000Z"),
      },
    ],
    operations: [],
  };
}

function snapshotFromState(state: MaterializationState): OrderCommitSnapshotV1 {
  return normalizeOrderCommitSnapshot({
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: state.order.id,
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-01T10:00:00.000Z",
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines: [
      packageLine(),
      addOnLine({
        orderEntityId: "addon-keep",
        productId: "product-frame",
        label: "Frame",
        quantity: 1,
        unitPrice: 20,
        notes: "existing",
      }),
      addOnLine({
        orderEntityId: "addon-remove",
        productId: "product-remove",
        label: "Removed Add-On",
        quantity: 1,
        unitPrice: 10,
      }),
      itemUpgradeLine({
        orderEntityId: "upgrade-keep",
        packageItemId: "package-item-basic",
        label: "Basic Spread",
        quantity: 1,
        unitPrice: 12,
        notes: "existing item",
      }),
      itemUpgradeLine({
        orderEntityId: "upgrade-remove",
        packageItemId: "package-item-remove",
        label: "Removed Item",
        quantity: 1,
        unitPrice: 8,
      }),
      selectionLine({
        selectionId: "selection-keep",
        configurationId: "configuration-backdrop",
        optionId: "option-gold",
        label: "Backdrop - Gold",
        snapshotLabel: "Backdrop",
        snapshotOptionLabel: "Gold",
        priceDelta: 12,
      }),
      selectionLine({
        selectionId: "selection-remove",
        configurationId: "configuration-album-remove",
        optionId: "option-remove",
        label: "Album Remove",
        snapshotLabel: "Album Remove",
        snapshotOptionLabel: "Remove",
        priceDelta: 0,
        pricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
        linkedProductId: "product-linked-remove",
        orderAddOnId: "linked-remove",
      }),
      linkedAddOnLine({
        selectionId: "selection-remove",
        orderAddOnId: "linked-remove",
        productId: "product-linked-remove",
        label: "Removed Linked Product",
        quantity: 1,
        unitPrice: 25,
      }),
    ],
    totals: { subtotal: 0, discountTotal: 0, netTotal: 0 },
  });
}

function packageLine(input: {
  orderEntityId?: string;
  catalogEntityId?: string;
  stableKey?: string;
  label?: string;
  unitPrice?: number;
  selectedPhotoCount?: number;
  extraDigitalCount?: number;
  extraPrintCount?: number;
} = {}): OrderCommitSnapshotLineV1 {
  const orderEntityId = input.orderEntityId ?? "package-line-1";
  return {
    lineId: `package:${orderEntityId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId,
    parentOrderPackageId: null,
    catalogEntityId: input.catalogEntityId ?? "package-basic",
    stableKey: input.stableKey ?? `order-package:${orderEntityId}`,
    label: input.label ?? "Basic Package",
    quantity: 1,
    unitPrice: input.unitPrice ?? 120,
    lineTotal: input.unitPrice ?? 120,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      selectedPhotoCount: input.selectedPhotoCount ?? 10,
      extraDigitalCount: input.extraDigitalCount ?? 1,
      extraPrintCount: input.extraPrintCount ?? 0,
      sessionTypeId: "session-type-1",
    },
  };
}

function addOnLine(input: {
  orderEntityId: string;
  productId: string;
  label: string;
  quantity: number;
  unitPrice: number;
  notes?: string | null;
}): OrderCommitSnapshotLineV1 {
  return {
    lineId: `addon:${input.orderEntityId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_ADD_ON,
    orderEntityId: input.orderEntityId,
    parentOrderPackageId: "package-line-1",
    catalogEntityId: input.productId,
    stableKey: `order-add-on:${input.orderEntityId}`,
    label: input.label,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    lineTotal: input.quantity * input.unitPrice,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: { notes: input.notes ?? null },
  };
}

function itemUpgradeLine(input: {
  orderEntityId: string;
  packageItemId: string;
  label: string;
  quantity: number;
  unitPrice: number;
  notes?: string | null;
}): OrderCommitSnapshotLineV1 {
  return {
    lineId: `item-upgrade:${input.orderEntityId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
    orderEntityId: input.orderEntityId,
    parentOrderPackageId: "package-line-1",
    catalogEntityId: input.packageItemId,
    stableKey: `order-package-item-upgrade:${input.orderEntityId}`,
    label: input.label,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    lineTotal: input.quantity * input.unitPrice,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: { notes: input.notes ?? null },
  };
}

function selectionLine(input: {
  selectionId: string;
  configurationId: string;
  optionId: string | null;
  label: string;
  snapshotLabel: string;
  snapshotOptionLabel: string | null;
  priceDelta: number;
  pricingMode?: SessionConfigurationPricingMode;
  linkedProductId?: string | null;
  orderAddOnId?: string | null;
  draftOrderAddOnId?: string | null;
}): OrderCommitSnapshotLineV1 {
  return {
    lineId: `session-config:${input.selectionId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: "package-line-1",
    catalogEntityId: input.configurationId,
    stableKey: `session-configuration-selection:${input.selectionId}`,
    label: input.label,
    quantity: 1,
    unitPrice: input.priceDelta,
    lineTotal: input.priceDelta,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.SESSION_CONFIGURATION_SELECTION_SNAPSHOT,
    metadata: {
      configurationId: input.configurationId,
      optionId: input.optionId,
      numericValue: null,
      textValue: null,
      orderAddOnId: input.orderAddOnId ?? null,
      ...(input.draftOrderAddOnId
        ? { draftOrderAddOnId: input.draftOrderAddOnId }
        : {}),
      snapshotConfigurationCode: input.snapshotLabel
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_"),
      snapshotFinancialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
      snapshotInputType: SessionConfigurationInputType.SELECT,
      snapshotLabel: input.snapshotLabel,
      snapshotLinkedProductId: input.linkedProductId ?? null,
      snapshotOptionLabel: input.snapshotOptionLabel,
      snapshotPriceDelta: input.priceDelta,
      snapshotPricingMode: input.pricingMode ?? SessionConfigurationPricingMode.FIXED,
    },
  };
}

function linkedAddOnLine(input: {
  selectionId: string;
  productId: string;
  label: string;
  quantity: number;
  unitPrice: number;
  orderAddOnId?: string | null;
  draftOrderAddOnId?: string | null;
  notes?: string | null;
}): OrderCommitSnapshotLineV1 {
  const addOnRef = input.orderAddOnId ?? input.draftOrderAddOnId;
  assert.ok(addOnRef);
  return {
    lineId: `session-config:${input.selectionId}:addon:${addOnRef}`,
    lineKind:
      ORDER_COMMIT_SNAPSHOT_LINE_KIND
        .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: "package-line-1",
    catalogEntityId: input.productId,
    stableKey: `session-configuration-selection:${input.selectionId}:add-on:${addOnRef}`,
    label: input.label,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    lineTotal: input.quantity * input.unitPrice,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      orderAddOnId: input.orderAddOnId ?? null,
      ...(input.draftOrderAddOnId
        ? { draftOrderAddOnId: input.draftOrderAddOnId }
        : {}),
      productId: input.productId,
      addOnNotes: input.notes ?? null,
    },
  };
}

function fakeMaterializationClient(
  state: MaterializationState,
  options: { failAfterWrites?: number } = {}
): OrderCommitMaterializationClient {
  let writeCount = 0;
  const record = (operation: FakeOperation) => {
    state.operations.push(operation);
    writeCount += 1;
    if (options.failAfterWrites && writeCount > options.failAfterWrites) {
      throw new Error("simulated transaction abort");
    }
  };

  return {
    order: {
      findUnique: async () => ({ ...state.order }),
      update: async (args: { where: { id: string }; data: { selectedPhotoCount: number } }) => {
        record({ model: "order", action: "update", id: args.where.id, data: args.data });
        state.order.selectedPhotoCount = args.data.selectedPhotoCount;
        return { ...state.order };
      },
    },
    orderPackage: {
      findMany: async () => state.packages.map(clonePackage),
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        record({ model: "orderPackage", action: "update", id: args.where.id, data: args.data });
        const row = requiredRow(state.packages, args.where.id);
        applyPackageUpdate(row, args.data);
        return clonePackage(row);
      },
    },
    orderAddOn: {
      findMany: async () => state.addOns.map(cloneAddOn),
      deleteMany: async (args: { where: { id: { in: string[] } } }) => {
        record({ model: "orderAddOn", action: "deleteMany", data: args.where });
        state.addOns = state.addOns.filter(
          (row) => !args.where.id.in.includes(row.id)
        );
        return { count: args.where.id.in.length };
      },
      create: async (args: { data: Record<string, unknown> }) => {
        const id = `addon-created-${state.addOns.length + 1}`;
        record({ model: "orderAddOn", action: "create", id, data: args.data });
        const row = addOnFromCreate(id, args.data);
        state.addOns.push(row);
        return { id };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        record({ model: "orderAddOn", action: "update", id: args.where.id, data: args.data });
        const row = requiredRow(state.addOns, args.where.id);
        applyAddOnUpdate(row, args.data);
        return cloneAddOn(row);
      },
    },
    orderPackageItemUpgrade: {
      findMany: async () => state.itemUpgrades.map(cloneItemUpgrade),
      deleteMany: async (args: { where: { id: { in: string[] } } }) => {
        record({ model: "orderPackageItemUpgrade", action: "deleteMany", data: args.where });
        state.itemUpgrades = state.itemUpgrades.filter(
          (row) => !args.where.id.in.includes(row.id)
        );
        return { count: args.where.id.in.length };
      },
      create: async (args: { data: Record<string, unknown> }) => {
        const id = `upgrade-created-${state.itemUpgrades.length + 1}`;
        record({ model: "orderPackageItemUpgrade", action: "create", id, data: args.data });
        const row = itemUpgradeFromCreate(id, args.data);
        state.itemUpgrades.push(row);
        return { id };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        record({ model: "orderPackageItemUpgrade", action: "update", id: args.where.id, data: args.data });
        const row = requiredRow(state.itemUpgrades, args.where.id);
        applyItemUpgradeUpdate(row, args.data);
        return cloneItemUpgrade(row);
      },
    },
    orderPackageSessionConfigurationSelection: {
      findMany: async () => state.selections.map(cloneSelection),
      updateMany: async (args: { where: { id: { in: string[] } }; data: { orderAddOnId: null } }) => {
        record({ model: "selection", action: "updateMany", data: args });
        for (const row of state.selections) {
          if (args.where.id.in.includes(row.id)) row.orderAddOnId = null;
        }
        return { count: args.where.id.in.length };
      },
      deleteMany: async (args: { where: { id: { in: string[] } } }) => {
        record({ model: "selection", action: "deleteMany", data: args.where });
        state.selections = state.selections.filter(
          (row) => !args.where.id.in.includes(row.id)
        );
        return { count: args.where.id.in.length };
      },
      create: async (args: { data: Record<string, unknown> }) => {
        const id = `selection-created-${state.selections.length + 1}`;
        record({ model: "selection", action: "create", id, data: args.data });
        const row = selectionFromCreate(id, args.data);
        state.selections.push(row);
        return { id };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        record({ model: "selection", action: "update", id: args.where.id, data: args.data });
        const row = requiredRow(state.selections, args.where.id);
        applySelectionUpdate(row, args.data);
        return cloneSelection(row);
      },
    },
  } as unknown as OrderCommitMaterializationClient;
}

function applyPackageUpdate(row: FakeOrderPackage, data: Record<string, unknown>) {
  if (isConnect(data.currentPackage)) row.currentPackageId = data.currentPackage.connect.id;
  if (typeof data.currentPackageNameSnapshot === "string") {
    row.currentPackageNameSnapshot = data.currentPackageNameSnapshot;
  }
  if (data.finalPackagePriceSnapshot instanceof Prisma.Decimal) {
    row.finalPackagePriceSnapshot = data.finalPackagePriceSnapshot;
  }
  if (typeof data.selectedPhotoCount === "number") {
    row.selectedPhotoCount = data.selectedPhotoCount;
  }
  if (typeof data.extraDigitalCount === "number") row.extraDigitalCount = data.extraDigitalCount;
  if (typeof data.extraPrintCount === "number") row.extraPrintCount = data.extraPrintCount;
  if (isConnect(data.sessionType)) row.sessionTypeId = data.sessionType.connect.id;
}

function addOnFromCreate(id: string, data: Record<string, unknown>): FakeOrderAddOn {
  return {
    id,
    orderId: connectId(data.order),
    orderPackageId: isConnect(data.orderPackage) ? data.orderPackage.connect.id : null,
    productId: connectId(data.product),
    nameSnapshot: String(data.nameSnapshot),
    priceSnapshot: data.priceSnapshot as Prisma.Decimal,
    quantity: Number(data.quantity),
    notes: data.notes === undefined ? null : (data.notes as string | null),
    createdAt: new Date("2026-06-01T09:00:00.000Z"),
  };
}

function applyAddOnUpdate(row: FakeOrderAddOn, data: Record<string, unknown>) {
  if (isConnect(data.orderPackage)) row.orderPackageId = data.orderPackage.connect.id;
  if (isDisconnect(data.orderPackage)) row.orderPackageId = null;
  if (isConnect(data.product)) row.productId = data.product.connect.id;
  if (typeof data.nameSnapshot === "string") row.nameSnapshot = data.nameSnapshot;
  if (data.priceSnapshot instanceof Prisma.Decimal) row.priceSnapshot = data.priceSnapshot;
  if (typeof data.quantity === "number") row.quantity = data.quantity;
  if ("notes" in data) row.notes = data.notes as string | null;
}

function itemUpgradeFromCreate(
  id: string,
  data: Record<string, unknown>
): FakeItemUpgrade {
  return {
    id,
    orderId: connectId(data.order),
    orderPackageId: connectId(data.orderPackage),
    packageItemId: connectId(data.packageItem),
    nameSnapshot: String(data.nameSnapshot),
    priceSnapshot: data.priceSnapshot as Prisma.Decimal,
    quantity: Number(data.quantity),
    notes: data.notes === undefined ? null : (data.notes as string | null),
    createdAt: new Date("2026-06-01T09:00:00.000Z"),
  };
}

function applyItemUpgradeUpdate(
  row: FakeItemUpgrade,
  data: Record<string, unknown>
) {
  if (isConnect(data.orderPackage)) row.orderPackageId = data.orderPackage.connect.id;
  if (isConnect(data.packageItem)) row.packageItemId = data.packageItem.connect.id;
  if (typeof data.nameSnapshot === "string") row.nameSnapshot = data.nameSnapshot;
  if (data.priceSnapshot instanceof Prisma.Decimal) row.priceSnapshot = data.priceSnapshot;
  if (typeof data.quantity === "number") row.quantity = data.quantity;
  if ("notes" in data) row.notes = data.notes as string | null;
}

function selectionFromCreate(
  id: string,
  data: Record<string, unknown>
): FakeSelection {
  return {
    id,
    orderPackageId: connectId(data.orderPackage),
    configurationId: connectId(data.configuration),
    optionId: isConnect(data.option)
      ? data.option.connect.id_configurationId.id
      : null,
    numericValue: (data.numericValue as Prisma.Decimal | null) ?? null,
    textValue: (data.textValue as string | null) ?? null,
    snapshotOptionLabel: (data.snapshotOptionLabel as string | null) ?? null,
    snapshotConfigurationCode: String(data.snapshotConfigurationCode),
    snapshotLabel: String(data.snapshotLabel),
    snapshotPriceDelta: data.snapshotPriceDelta as Prisma.Decimal,
    snapshotFinancialBehavior:
      data.snapshotFinancialBehavior as SessionConfigurationFinancialBehavior,
    snapshotInputType: data.snapshotInputType as SessionConfigurationInputType,
    snapshotPricingMode:
      data.snapshotPricingMode as SessionConfigurationPricingMode,
    snapshotLinkedProductId:
      (data.snapshotLinkedProductId as string | null) ?? null,
    orderAddOnId: isConnect(data.orderAddOn) ? data.orderAddOn.connect.id : null,
    createdAt: new Date("2026-06-01T09:00:00.000Z"),
  };
}

function applySelectionUpdate(row: FakeSelection, data: Record<string, unknown>) {
  if (isConnect(data.orderPackage)) row.orderPackageId = data.orderPackage.connect.id;
  if (isConnect(data.configuration)) row.configurationId = data.configuration.connect.id;
  if (isConnect(data.option)) row.optionId = data.option.connect.id_configurationId.id;
  if (isDisconnect(data.option)) row.optionId = null;
  if ("numericValue" in data) row.numericValue = data.numericValue as Prisma.Decimal | null;
  if ("textValue" in data) row.textValue = data.textValue as string | null;
  if ("snapshotOptionLabel" in data) row.snapshotOptionLabel = data.snapshotOptionLabel as string | null;
  if (typeof data.snapshotConfigurationCode === "string") row.snapshotConfigurationCode = data.snapshotConfigurationCode;
  if (typeof data.snapshotLabel === "string") row.snapshotLabel = data.snapshotLabel;
  if (data.snapshotPriceDelta instanceof Prisma.Decimal) row.snapshotPriceDelta = data.snapshotPriceDelta;
  if (typeof data.snapshotFinancialBehavior === "string") row.snapshotFinancialBehavior = data.snapshotFinancialBehavior as SessionConfigurationFinancialBehavior;
  if (typeof data.snapshotInputType === "string") row.snapshotInputType = data.snapshotInputType as SessionConfigurationInputType;
  if (typeof data.snapshotPricingMode === "string") row.snapshotPricingMode = data.snapshotPricingMode as SessionConfigurationPricingMode;
  if ("snapshotLinkedProductId" in data) row.snapshotLinkedProductId = data.snapshotLinkedProductId as string | null;
  if (isConnect(data.orderAddOn)) row.orderAddOnId = data.orderAddOn.connect.id;
  if (isDisconnect(data.orderAddOn)) row.orderAddOnId = null;
}

function isConnect(
  value: unknown
): value is { connect: { id: string; id_configurationId: { id: string } } } {
  return Boolean(value && typeof value === "object" && "connect" in value);
}

function isDisconnect(value: unknown): value is { disconnect: true } {
  return Boolean(value && typeof value === "object" && "disconnect" in value);
}

function connectId(value: unknown): string {
  assert.ok(isConnect(value));
  return value.connect.id;
}

function requiredRow<T extends { id: string }>(rows: T[], id: string): T {
  const row = rows.find((candidate) => candidate.id === id);
  assert.ok(row, `Expected fake row ${id}`);
  return row;
}

function clonePackage(row: FakeOrderPackage): FakeOrderPackage {
  return { ...row };
}

function cloneAddOn(row: FakeOrderAddOn): FakeOrderAddOn {
  return { ...row };
}

function cloneItemUpgrade(row: FakeItemUpgrade): FakeItemUpgrade {
  return { ...row };
}

function cloneSelection(row: FakeSelection): FakeSelection {
  return { ...row };
}

function serializableRows(state: MaterializationState): unknown {
  return {
    order: state.order,
    packages: state.packages.map((row) => ({
      ...row,
      originalPackagePriceSnapshot: money(row.originalPackagePriceSnapshot),
      finalPackagePriceSnapshot: money(row.finalPackagePriceSnapshot),
    })),
    addOns: state.addOns.map((row) => ({
      ...row,
      priceSnapshot: money(row.priceSnapshot),
    })),
    itemUpgrades: state.itemUpgrades.map((row) => ({
      ...row,
      priceSnapshot: money(row.priceSnapshot),
    })),
    selections: state.selections.map((row) => ({
      ...row,
      numericValue: money(row.numericValue),
      snapshotPriceDelta: money(row.snapshotPriceDelta),
    })),
  };
}

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function money(value: Prisma.Decimal | null | undefined): number | null {
  return value ? Number(value.toFixed(3)) : null;
}
