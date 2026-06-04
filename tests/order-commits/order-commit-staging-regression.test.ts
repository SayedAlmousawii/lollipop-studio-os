import assert from "node:assert/strict";
import test from "node:test";
import {
  MediaType,
  Prisma,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationPricingMode,
  UserRole,
} from "@prisma/client";
import {
  appendOrderCommitDraftOperation,
  getOrderCommitDraft,
  orderCommitDraftStagingChangeSchema,
  orderCommitSnapshotV1Schema,
  reduceOrderCommitDraftAddOn,
  reduceOrderCommitDraftPackage,
  reduceOrderCommitDraftPackageItemUpgrade,
  reduceOrderCommitDraftPhoto,
  reduceOrderCommitDraftSessionConfiguration,
  stageOrderCommitDraftChange,
  ORDER_COMMIT_DRAFT_OPERATION_TYPE,
  ORDER_COMMIT_DRAFT_PENDING_OPS_SCHEMA_VERSION,
  ORDER_COMMIT_DRAFT_STAGING_DOMAIN,
  ORDER_COMMIT_ORDER_ENTITY_KIND,
  ORDER_COMMIT_PRICE_SOURCE,
  ORDER_COMMIT_SNAPSHOT_CURRENCY,
  ORDER_COMMIT_SNAPSHOT_LINE_KIND,
  ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
  type AppendOrderCommitDraftOperationInput,
  type GetOrderCommitDraftInput,
  type OrderCommitDraftOperationV1,
  type OrderCommitDraftStagingChange,
  type OrderCommitSnapshotLineV1,
  type OrderCommitSnapshotV1,
  type ResolvedOrderCommitDraftAddOnProduct,
  type ResolvedOrderCommitDraftLinkedProduct,
  type ResolvedOrderCommitDraftPackage,
  type ResolvedOrderCommitDraftPackageItemUpgrade,
  type ResolvedOrderCommitDraftSessionConfigurationSelection,
  type StageOrderCommitDraftChangeInput,
} from "@/modules/order-commits";
import type { ActorContext } from "@/lib/auth/actor-context";

type PackageChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE }
>;
type AddOnChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON }
>;
type PackageItemUpgradeChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE }
>;
type PhotoChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO }
>;
type SessionConfigurationChange = Extract<
  OrderCommitDraftStagingChange,
  { domain: typeof ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION }
>;

const ownerActor: ActorContext = {
  actorUserId: "owner-user",
  actorRole: UserRole.RECEPTIONIST,
};

const managerActor: ActorContext = {
  actorUserId: "manager-user",
  actorRole: UserRole.MANAGER,
};

const adminActor: ActorContext = {
  actorUserId: "admin-user",
  actorRole: UserRole.ADMIN,
};

test("reducers return parsed V1 snapshots without mutating inputs", () => {
  const cases: Array<{
    name: string;
    snapshot: OrderCommitSnapshotV1;
    reduce: (snapshot: OrderCommitSnapshotV1) => OrderCommitSnapshotV1;
  }> = [
    {
      name: "package",
      snapshot: snapshotFixture({
        lines: [packageLine(), packageItemUpgradeLine()],
      }),
      reduce: (snapshot) =>
        reduceOrderCommitDraftPackage(snapshot, {
          change: packageChange({
            packageId: "package-premium",
            sessionTypeId: "session-type-1",
          }),
          resolvedPackage: resolvedPackage({
            packageId: "package-premium",
            packageName: "Premium Package",
            packagePrice: 150.125,
            includedPhotoCount: 10,
          }),
        }),
    },
    {
      name: "add-on",
      snapshot: snapshotFixture({ lines: [packageLine()] }),
      reduce: (snapshot) =>
        reduceOrderCommitDraftAddOn(snapshot, {
          change: addOnChange({
            action: "ADD",
            productId: "product-stage",
            quantity: 2,
            draftOrderAddOnId: "draft:addon-stage",
          }),
          resolvedProduct: resolvedAddOnProduct({
            productId: "product-stage",
            label: "Framed Desk Print",
            unitPrice: 33,
          }),
        }),
    },
    {
      name: "package item upgrade",
      snapshot: snapshotFixture({ lines: [packageLine()] }),
      reduce: (snapshot) =>
        reduceOrderCommitDraftPackageItemUpgrade(snapshot, {
          change: packageItemUpgradeChange({
            action: "ADD",
            packageItemId: "package-item-stage",
            quantity: 1,
            draftPackageItemUpgradeId: "draft:item-stage",
          }),
          resolvedPackageItem: resolvedPackageItem({
            packageItemId: "package-item-stage",
            packageId: "package-current",
            label: "Premium Album Spread",
            unitPrice: 44,
          }),
        }),
    },
    {
      name: "photo",
      snapshot: snapshotFixture({ lines: [packageLine()] }),
      reduce: (snapshot) =>
        reduceOrderCommitDraftPhoto(snapshot, {
          change: photoChange({
            selectedPhotoCount: 12,
            extraDigitalCount: 2,
            extraPrintCount: 0,
          }),
          resolvedExtraPhotoPricing: {
            DIGITAL: { unitPrice: 5, sessionTypeId: "session-type-1" },
          },
        }),
    },
    {
      name: "session configuration",
      snapshot: snapshotFixture({ lines: [packageLine()] }),
      reduce: (snapshot) =>
        reduceOrderCommitDraftSessionConfiguration(snapshot, {
          change: sessionConfigurationChange({
            action: "UPSERT",
            configurationId: "configuration-operational",
            draftSelectionId: "draft:selection-operational",
          }),
          resolvedSelection: resolvedSelection({
            configurationId: "configuration-operational",
            snapshotFinancialBehavior:
              SessionConfigurationFinancialBehavior.OPERATIONAL,
            snapshotInputType: SessionConfigurationInputType.TOGGLE,
            snapshotPricingMode: SessionConfigurationPricingMode.NONE,
            snapshotPriceDelta: 0,
          }),
        }),
    },
  ];

  for (const reducerCase of cases) {
    const before = structuredClone(reducerCase.snapshot);

    const reduced = reducerCase.reduce(reducerCase.snapshot);

    assert.notEqual(
      reduced,
      reducerCase.snapshot,
      `${reducerCase.name} should return a new snapshot object`
    );
    assert.deepEqual(
      reducerCase.snapshot,
      before,
      `${reducerCase.name} should not mutate the input snapshot`
    );
    assert.doesNotThrow(() => orderCommitSnapshotV1Schema.parse(reduced));
    assert.equal(
      reduced.totals.subtotal,
      money(reduced.lines.reduce((sum, line) => sum + line.lineTotal, 0)),
      `${reducerCase.name} should recalculate totals from line totals`
    );
  }
});

test("reducers preserve stored prices, lock new prices, and keep merge keys deterministic", () => {
  const addOnBase = snapshotFixture({
    lines: [
      packageLine(),
      addOnLine({
        orderEntityId: "addon-existing",
        catalogEntityId: "product-stage",
        quantity: 1,
        unitPrice: 9,
      }),
    ],
  });
  const addOnMerged = reduceOrderCommitDraftAddOn(addOnBase, {
    change: addOnChange({
      action: "ADD",
      productId: "product-stage",
      quantity: 2,
      draftOrderAddOnId: "draft:addon-ignored-merge",
    }),
    resolvedProduct: resolvedAddOnProduct({
      productId: "product-stage",
      label: "Resolved price should not replace existing line",
      unitPrice: 99,
    }),
  });
  const mergedAddOn = requireLine(addOnMerged, "order-add-on:addon-existing");
  assert.equal(mergedAddOn.quantity, 3);
  assert.equal(mergedAddOn.unitPrice, 9);
  assert.equal(mergedAddOn.lineTotal, 27);
  assert.equal(
    addOnMerged.lines.filter(
      (line) =>
        line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON &&
        line.catalogEntityId === "product-stage"
    ).length,
    1
  );

  const newAddOn = reduceOrderCommitDraftAddOn(
    snapshotFixture({ lines: [packageLine()] }),
    {
      change: addOnChange({
        action: "ADD",
        productId: "product-new",
        quantity: 2,
        draftOrderAddOnId: "draft:addon-new",
      }),
      resolvedProduct: resolvedAddOnProduct({
        productId: "product-new",
        label: "Canvas Add-On",
        unitPrice: 55,
      }),
    }
  );
  assert.equal(requireLine(newAddOn, "order-add-on:draft:addon-new").unitPrice, 55);

  const upgradeBase = snapshotFixture({
    lines: [
      packageLine(),
      packageItemUpgradeLine({
        orderEntityId: "upgrade-existing",
        catalogEntityId: "package-item-stage",
        quantity: 1,
        unitPrice: 8,
      }),
    ],
  });
  const upgradeMerged = reduceOrderCommitDraftPackageItemUpgrade(upgradeBase, {
    change: packageItemUpgradeChange({
      action: "ADD",
      packageItemId: "package-item-stage",
      quantity: 2,
      draftPackageItemUpgradeId: "draft:item-ignored-merge",
    }),
    resolvedPackageItem: resolvedPackageItem({
      packageItemId: "package-item-stage",
      packageId: "package-current",
      label: "Resolved price should not replace existing upgrade",
      unitPrice: 77,
    }),
  });
  const mergedUpgrade = requireLine(
    upgradeMerged,
    "order-package-item-upgrade:upgrade-existing"
  );
  assert.equal(mergedUpgrade.quantity, 3);
  assert.equal(mergedUpgrade.unitPrice, 8);
  assert.equal(mergedUpgrade.lineTotal, 24);
  assert.equal(
    upgradeMerged.lines.filter(
      (line) =>
        line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE &&
        line.catalogEntityId === "package-item-stage"
    ).length,
    1
  );

  const photoBase = snapshotFixture({
    lines: [packageLine(), extraPhotoLine({ mediaType: "DIGITAL", unitPrice: 4 })],
  });
  const photoReduced = reduceOrderCommitDraftPhoto(photoBase, {
    change: photoChange({
      selectedPhotoCount: 13,
      extraDigitalCount: 2,
      extraPrintCount: 1,
    }),
    resolvedExtraPhotoPricing: {
      DIGITAL: { unitPrice: 99, sessionTypeId: "session-type-1" },
      PRINT: { unitPrice: 7.5, sessionTypeId: "session-type-1" },
    },
  });
  assert.equal(
    requireLine(photoReduced, "order-package:order-package-1:extra-photo:digital")
      .unitPrice,
    4
  );
  assert.equal(
    requireLine(photoReduced, "order-package:order-package-1:extra-photo:print")
      .unitPrice,
    7.5
  );
});

test("session configuration upsert preserves zero-value and paired linked-product ownership", () => {
  const operational = reduceOrderCommitDraftSessionConfiguration(
    snapshotFixture({ lines: [packageLine()] }),
    {
      change: sessionConfigurationChange({
        action: "UPSERT",
        configurationId: "configuration-operational",
        draftSelectionId: "draft:selection-operational",
      }),
      resolvedSelection: resolvedSelection({
        configurationId: "configuration-operational",
        snapshotFinancialBehavior:
          SessionConfigurationFinancialBehavior.OPERATIONAL,
        snapshotInputType: SessionConfigurationInputType.TOGGLE,
        snapshotPricingMode: SessionConfigurationPricingMode.NONE,
        snapshotPriceDelta: 0,
      }),
    }
  );
  const operationalSelection = requireLine(
    operational,
    "session-configuration-selection:draft:selection-operational"
  );
  assert.equal(operationalSelection.quantity, 1);
  assert.equal(operationalSelection.unitPrice, 0);
  assert.equal(operationalSelection.lineTotal, 0);

  const linkedDraft = reduceOrderCommitDraftSessionConfiguration(
    snapshotFixture({ lines: [packageLine()] }),
    {
      change: sessionConfigurationChange({
        action: "UPSERT",
        configurationId: "configuration-linked",
        draftSelectionId: "draft:selection-linked",
        linkedProduct: {
          productId: "product-linked",
          draftOrderAddOnId: "draft:addon-linked",
        },
      }),
      resolvedSelection: resolvedSelection({
        configurationId: "configuration-linked",
        snapshotFinancialBehavior:
          SessionConfigurationFinancialBehavior.FINANCIAL,
        snapshotInputType: SessionConfigurationInputType.TOGGLE,
        snapshotPricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
        snapshotLinkedProductId: "product-linked",
      }),
      resolvedLinkedProduct: resolvedLinkedProduct({
        productId: "product-linked",
        label: "Linked Album",
        unitPrice: 45,
      }),
    }
  );
  const draftSelection = requireLine(
    linkedDraft,
    "session-configuration-selection:draft:selection-linked"
  );
  const draftLinkedAddOn = requireLine(
    linkedDraft,
    "session-configuration-selection:draft:selection-linked:add-on:draft:addon-linked"
  );
  assert.equal(draftSelection.metadata.draftOrderAddOnId, "draft:addon-linked");
  assert.equal(draftSelection.metadata.orderAddOnId, null);
  assert.equal(draftLinkedAddOn.metadata.draftOrderAddOnId, "draft:addon-linked");
  assert.equal(draftLinkedAddOn.metadata.orderAddOnId, null);

  const materializedBase = snapshotFixture({
    lines: [
      packageLine(),
      sessionConfigurationLine({
        selectionId: "selection-linked",
        configurationId: "configuration-linked",
        linkedOrderAddOnId: "addon-linked",
      }),
      linkedProductLine({
        selectionId: "selection-linked",
        orderAddOnId: "addon-linked",
        productId: "product-linked",
        unitPrice: 30,
      }),
    ],
  });
  const materialized = reduceOrderCommitDraftSessionConfiguration(
    materializedBase,
    {
      change: sessionConfigurationChange({
        action: "UPSERT",
        target: { stableKey: "session-configuration-selection:selection-linked" },
        configurationId: "configuration-linked",
        linkedProduct: {
          productId: "product-linked",
          orderAddOnId: "addon-linked",
        },
      }),
      resolvedSelection: resolvedSelection({
        configurationId: "configuration-linked",
        snapshotFinancialBehavior:
          SessionConfigurationFinancialBehavior.FINANCIAL,
        snapshotInputType: SessionConfigurationInputType.TOGGLE,
        snapshotPricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
        snapshotLinkedProductId: "product-linked",
      }),
      resolvedLinkedProduct: resolvedLinkedProduct({
        productId: "product-linked",
        label: "Linked Album",
        unitPrice: 42,
      }),
    }
  );
  const materializedSelection = requireLine(
    materialized,
    "session-configuration-selection:selection-linked"
  );
  const materializedLinkedAddOn = requireLine(
    materialized,
    "session-configuration-selection:selection-linked:add-on:addon-linked"
  );
  assert.equal(materializedSelection.metadata.orderAddOnId, "addon-linked");
  assert.equal(materializedSelection.metadata.draftOrderAddOnId, undefined);
  assert.equal(materializedLinkedAddOn.metadata.orderAddOnId, "addon-linked");
  assert.equal(materializedLinkedAddOn.metadata.draftOrderAddOnId, undefined);
});

test("staging persists pendingSnapshotJson truth and keeps pendingOpsJson history-only", async () => {
  const client = fakeOrderCommitClient({
    drafts: [
      fakeDraft({
        id: "draft-1",
        pendingSnapshotJson: serviceSnapshotFixture(),
      }),
    ],
  });
  const beforeOperationalRows = client.operationalRowsSnapshot();
  const beforeFinancialRows = client.financialRowsSnapshot();

  const staged = await stageOrderCommitDraftChange({
    orderId: "order-1",
    change: {
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
      action: "CHANGE_PACKAGE",
      target: { stableKey: "order-package:op-order-1" },
      packageId: "package-new",
      intendedPhotoOutcome: {
        selectedPhotoCount: 13,
        extraDigitalCount: 1,
        extraPrintCount: 1,
      },
    },
    expectedVersion: 0,
    actorContext: ownerActor,
    client: client.draftRoot,
  });

  const packageLine = requireLine(staged.pendingSnapshot, "order-package:op-order-1");
  assert.equal(staged.draft.version, 1);
  assert.equal(packageLine.catalogEntityId, "package-new");
  assert.equal(packageLine.metadata.includedPhotoCount, 11);
  assert.equal(packageLine.metadata.selectedPhotoCount, 13);
  assert.equal(packageLine.metadata.extraDigitalCount, 1);
  assert.equal(packageLine.metadata.extraPrintCount, 1);
  assert.deepEqual(client.drafts[0]?.pendingSnapshotJson, staged.pendingSnapshot);
  assert.equal(staged.pendingOps.operations.length, 1);
  assert.deepEqual(
    staged.pendingOps.operations.map((operation) => operation.type),
    [ORDER_COMMIT_DRAFT_OPERATION_TYPE.SNAPSHOT_REPLACED]
  );
  assert.equal(staged.pendingOps.operations[0]?.payload.historyKind, "STAGING_CHANGE");
  assert.equal(
    staged.pendingOps.operations[0]?.payload.domain,
    ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE
  );

  const loaded = await getOrderCommitDraft({
    orderId: "order-1",
    client: client.draftRead,
  });
  assert.deepEqual(loaded?.pendingSnapshot, staged.pendingSnapshot);
  assert.deepEqual(loaded?.pendingOps, staged.pendingOps);

  const appended = await appendOrderCommitDraftOperation({
    orderId: "order-1",
    operation: noteOperation("op-note"),
    expectedVersion: 1,
    actorContext: ownerActor,
    client: client.draftRoot,
  });
  assert.deepEqual(appended.pendingSnapshot, staged.pendingSnapshot);
  assert.deepEqual(client.drafts[0]?.pendingSnapshotJson, staged.pendingSnapshot);
  assert.deepEqual(
    appended.pendingOps.operations.map((operation) => operation.type),
    [
      ORDER_COMMIT_DRAFT_OPERATION_TYPE.SNAPSHOT_REPLACED,
      ORDER_COMMIT_DRAFT_OPERATION_TYPE.NOTE_APPENDED,
    ]
  );
  assert.deepEqual(client.operationalRowsSnapshot(), beforeOperationalRows);
  assert.deepEqual(client.financialRowsSnapshot(), beforeFinancialRows);
});

test("package-only staging normalizes selected photos when new included count increases", async () => {
  const client = fakeOrderCommitClient({
    packagePhotoCount: 50,
    drafts: [
      fakeDraft({
        id: "draft-package-photo-normalization",
        pendingSnapshotJson: snapshotFixture({
          lines: [
            packageLine({
              orderEntityId: "op-order-1",
              catalogEntityId: "package-current",
              stableKey: "order-package:op-order-1",
              lineId: "package:op-order-1",
              includedPhotoCount: 20,
              selectedPhotoCount: 24,
              extraDigitalCount: 2,
              extraPrintCount: 2,
            }),
            extraPhotoLine({
              parentOrderPackageId: "op-order-1",
              mediaType: "DIGITAL",
              quantity: 2,
              unitPrice: 5,
            }),
            extraPhotoLine({
              parentOrderPackageId: "op-order-1",
              mediaType: "PRINT",
              quantity: 2,
              unitPrice: 7.5,
            }),
          ],
        }),
      }),
    ],
  });

  const staged = await stageOrderCommitDraftChange({
    orderId: "order-1",
    change: {
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
      action: "CHANGE_PACKAGE",
      target: { stableKey: "order-package:op-order-1" },
      packageId: "package-new",
    },
    expectedVersion: 0,
    actorContext: ownerActor,
    client: client.draftRoot,
  });

  const stagedPackageLine = requireLine(
    staged.pendingSnapshot,
    "order-package:op-order-1"
  );
  assert.equal(stagedPackageLine.metadata.includedPhotoCount, 50);
  assert.equal(stagedPackageLine.metadata.selectedPhotoCount, 50);
  assert.equal(stagedPackageLine.metadata.extraDigitalCount, 0);
  assert.equal(stagedPackageLine.metadata.extraPrintCount, 0);
  assert.equal(
    staged.pendingSnapshot.lines.some(
      (line) => line.lineKind === ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA
    ),
    false
  );
});

test("stale and non-owner staging attempts leave draft state unchanged", async () => {
  const initialSnapshot = serviceSnapshotFixture();
  const client = fakeOrderCommitClient({
    drafts: [
      fakeDraft({
        id: "draft-1",
        ownerUserId: "owner-user",
        pendingSnapshotJson: initialSnapshot,
      }),
    ],
  });
  const beforeDraft = structuredClone(client.drafts[0]);

  await assert.rejects(
    stageOrderCommitDraftChange({
      orderId: "order-1",
      change: {
        domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
        action: "ADD",
        parentPackageTarget: { stableKey: "order-package:op-order-1" },
        productId: "product-stage",
        quantity: 1,
      },
      expectedVersion: 1,
      actorContext: ownerActor,
      client: client.draftRoot,
    }),
    /stale expectedVersion/
  );
  assert.deepEqual(client.drafts[0], beforeDraft);

  await assert.rejects(
    stageOrderCommitDraftChange({
      orderId: "order-1",
      change: {
        domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
        action: "ADD",
        parentPackageTarget: { stableKey: "order-package:op-order-1" },
        productId: "product-stage",
        quantity: 1,
      },
      expectedVersion: 0,
      actorContext: {
        actorUserId: "other-user",
        actorRole: UserRole.RECEPTIONIST,
      },
      client: client.draftRoot,
    }),
    /cannot mutate draft/
  );
  assert.deepEqual(client.drafts[0], beforeDraft);
});

test("manager and admin can stage through snapshot replacement history", async () => {
  const client = fakeOrderCommitClient({
    drafts: [
      fakeDraft({
        id: "draft-1",
        ownerUserId: "owner-user",
        pendingSnapshotJson: serviceSnapshotFixture(),
      }),
    ],
  });

  const managerStaged = await stageOrderCommitDraftChange({
    orderId: "order-1",
    change: {
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
      action: "ADD",
      parentPackageTarget: { stableKey: "order-package:op-order-1" },
      productId: "product-stage",
      quantity: 1,
    },
    expectedVersion: 0,
    actorContext: managerActor,
    client: client.draftRoot,
  });
  assert.equal(managerStaged.draft.version, 1);
  assert.equal(managerStaged.draft.lastTouchedByUserId, "manager-user");
  assert.equal(managerStaged.pendingOps.operations.length, 1);
  const managerAddedLine = managerStaged.pendingSnapshot.lines.find(
    (line) => line.catalogEntityId === "product-stage"
  );
  assert.equal(managerAddedLine?.unitPrice, 33);
  assert.equal(managerAddedLine?.orderEntityId.startsWith("draft:"), true);

  const adminStaged = await stageOrderCommitDraftChange({
    orderId: "order-1",
    change: {
      domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
      action: "SET_COUNTS",
      target: { stableKey: "order-package:op-order-1" },
      selectedPhotoCount: 12,
      extraDigitalCount: 1,
      extraPrintCount: 1,
    },
    expectedVersion: 1,
    actorContext: adminActor,
    client: client.draftRoot,
  });
  assert.equal(adminStaged.draft.version, 2);
  assert.equal(adminStaged.draft.lastTouchedByUserId, "admin-user");
  assert.deepEqual(
    adminStaged.pendingOps.operations.map((operation) => operation.type),
    [
      ORDER_COMMIT_DRAFT_OPERATION_TYPE.SNAPSHOT_REPLACED,
      ORDER_COMMIT_DRAFT_OPERATION_TYPE.SNAPSHOT_REPLACED,
    ]
  );
});

function packageChange(
  input: Partial<PackageChange> & Pick<PackageChange, "packageId">
): PackageChange {
  return orderCommitDraftStagingChangeSchema.parse({
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE,
    action: "CHANGE_PACKAGE",
    target: { stableKey: "order-package:order-package-1" },
    ...input,
  }) as PackageChange;
}

function addOnChange(input: Partial<AddOnChange> & Pick<AddOnChange, "action">): AddOnChange {
  return orderCommitDraftStagingChangeSchema.parse({
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.ADD_ON,
    parentPackageTarget: { stableKey: "order-package:order-package-1" },
    ...input,
  }) as AddOnChange;
}

function packageItemUpgradeChange(
  input: Partial<PackageItemUpgradeChange> & Pick<PackageItemUpgradeChange, "action">
): PackageItemUpgradeChange {
  return orderCommitDraftStagingChangeSchema.parse({
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PACKAGE_ITEM_UPGRADE,
    parentPackageTarget: { stableKey: "order-package:order-package-1" },
    ...input,
  }) as PackageItemUpgradeChange;
}

function photoChange(input: Omit<PhotoChange, "domain" | "action" | "target">): PhotoChange {
  return orderCommitDraftStagingChangeSchema.parse({
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.PHOTO,
    action: "SET_COUNTS",
    target: { stableKey: "order-package:order-package-1" },
    ...input,
  }) as PhotoChange;
}

function sessionConfigurationChange(
  input: Partial<SessionConfigurationChange> &
    Pick<SessionConfigurationChange, "action" | "configurationId">
): SessionConfigurationChange {
  return orderCommitDraftStagingChangeSchema.parse({
    domain: ORDER_COMMIT_DRAFT_STAGING_DOMAIN.SESSION_CONFIGURATION,
    parentPackageTarget: { stableKey: "order-package:order-package-1" },
    ...input,
  }) as SessionConfigurationChange;
}

function resolvedPackage(
  input: Partial<ResolvedOrderCommitDraftPackage> & { packageId: string }
): ResolvedOrderCommitDraftPackage {
  return {
    packageId: input.packageId,
    packageName: input.packageName ?? "Resolved Package",
    packagePrice: input.packagePrice ?? 100,
    sessionType: input.sessionType ?? {
      id: "session-type-1",
      name: "Portrait",
    },
    includedPhotoCount: input.includedPhotoCount ?? 10,
  };
}

function resolvedAddOnProduct(
  input: ResolvedOrderCommitDraftAddOnProduct
): ResolvedOrderCommitDraftAddOnProduct {
  return input;
}

function resolvedPackageItem(
  input: ResolvedOrderCommitDraftPackageItemUpgrade
): ResolvedOrderCommitDraftPackageItemUpgrade {
  return input;
}

function resolvedSelection(
  input: Partial<ResolvedOrderCommitDraftSessionConfigurationSelection> & {
    configurationId: string;
  }
): ResolvedOrderCommitDraftSessionConfigurationSelection {
  return {
    configurationId: input.configurationId,
    optionId: input.optionId ?? null,
    numericValue: input.numericValue ?? null,
    textValue: input.textValue ?? null,
    snapshotOptionLabel: input.snapshotOptionLabel ?? null,
    snapshotConfigurationCode: input.snapshotConfigurationCode ?? "CONFIG",
    snapshotLabel: input.snapshotLabel ?? "Configuration",
    snapshotPriceDelta: input.snapshotPriceDelta ?? 0,
    snapshotFinancialBehavior:
      input.snapshotFinancialBehavior ??
      SessionConfigurationFinancialBehavior.FINANCIAL,
    snapshotInputType:
      input.snapshotInputType ?? SessionConfigurationInputType.TOGGLE,
    snapshotPricingMode:
      input.snapshotPricingMode ?? SessionConfigurationPricingMode.FIXED,
    snapshotLinkedProductId: input.snapshotLinkedProductId ?? null,
  };
}

function resolvedLinkedProduct(
  input: ResolvedOrderCommitDraftLinkedProduct
): ResolvedOrderCommitDraftLinkedProduct {
  return input;
}

function snapshotFixture(input: { lines: OrderCommitSnapshotLineV1[] }): OrderCommitSnapshotV1 {
  const lines = input.lines.map(cloneLine);
  const subtotal = money(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  return {
    schemaVersion: ORDER_COMMIT_SNAPSHOT_SCHEMA_VERSION,
    orderId: "order-1",
    financialCaseId: "financial-case-1",
    capturedAt: "2026-06-01T09:00:00.000Z",
    currency: ORDER_COMMIT_SNAPSHOT_CURRENCY,
    lines,
    totals: {
      subtotal,
      discountTotal: 0,
      netTotal: subtotal,
    },
  };
}

function serviceSnapshotFixture(): OrderCommitSnapshotV1 {
  return snapshotFixture({
    lines: [
      packageLine({
        orderEntityId: "op-order-1",
        catalogEntityId: "package-current",
        stableKey: "order-package:op-order-1",
        lineId: "package:op-order-1",
        selectedPhotoCount: 12,
        extraDigitalCount: 1,
        extraPrintCount: 1,
      }),
      extraPhotoLine({
        parentOrderPackageId: "op-order-1",
        mediaType: "DIGITAL",
        quantity: 1,
        unitPrice: 5,
      }),
      extraPhotoLine({
        parentOrderPackageId: "op-order-1",
        mediaType: "PRINT",
        quantity: 1,
        unitPrice: 7.5,
      }),
    ],
  });
}

function packageLine(
  input: Partial<{
    orderEntityId: string;
    catalogEntityId: string;
    stableKey: string;
    lineId: string;
    selectedPhotoCount: number;
    includedPhotoCount: number;
    extraDigitalCount: number;
    extraPrintCount: number;
    unitPrice: number;
  }> = {}
): OrderCommitSnapshotLineV1 {
  const orderEntityId = input.orderEntityId ?? "order-package-1";
  const unitPrice = input.unitPrice ?? 100;
  return {
    lineId: input.lineId ?? `package:${orderEntityId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE,
    orderEntityId,
    parentOrderPackageId: null,
    catalogEntityId: input.catalogEntityId ?? "package-current",
    stableKey: input.stableKey ?? `order-package:${orderEntityId}`,
    label: "Current Package",
    quantity: 1,
    unitPrice,
    lineTotal: unitPrice,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      originalPackageId: "package-original",
      originalPackageNameSnapshot: "Original Package",
      originalPackagePriceSnapshot: 80,
      bookingPackageId: "booking-package-1",
      currentPackageId: input.catalogEntityId ?? "package-current",
      currentPackageNameSnapshot: "Current Package",
      finalPackagePriceSnapshot: unitPrice,
      selectedPhotoCount: input.selectedPhotoCount ?? 11,
      includedPhotoCount: input.includedPhotoCount ?? 10,
      extraDigitalCount: input.extraDigitalCount ?? 1,
      extraPrintCount: input.extraPrintCount ?? 0,
      sessionTypeId: "session-type-1",
      sessionTypeName: "Portrait",
      sortOrder: 1,
    },
  };
}

function addOnLine(
  input: Partial<{
    orderEntityId: string;
    catalogEntityId: string;
    quantity: number;
    unitPrice: number;
  }> = {}
): OrderCommitSnapshotLineV1 {
  const orderEntityId = input.orderEntityId ?? "addon-existing";
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 12;
  return {
    lineId: `addon:${orderEntityId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.ADD_ON,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_ADD_ON,
    orderEntityId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: input.catalogEntityId ?? "product-existing",
    stableKey: `order-add-on:${orderEntityId}`,
    label: "Existing Add-On",
    quantity,
    unitPrice,
    lineTotal: money(unitPrice * quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      orderAddOnId: orderEntityId,
      productId: input.catalogEntityId ?? "product-existing",
    },
  };
}

function packageItemUpgradeLine(
  input: Partial<{
    orderEntityId: string;
    catalogEntityId: string;
    quantity: number;
    unitPrice: number;
  }> = {}
): OrderCommitSnapshotLineV1 {
  const orderEntityId = input.orderEntityId ?? "upgrade-existing";
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 8;
  return {
    lineId: `item-upgrade:${orderEntityId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.PACKAGE_ITEM_UPGRADE,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_ITEM_UPGRADE,
    orderEntityId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: input.catalogEntityId ?? "package-item-existing",
    stableKey: `order-package-item-upgrade:${orderEntityId}`,
    label: "Existing Upgrade",
    quantity,
    unitPrice,
    lineTotal: money(unitPrice * quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      packageItemId: input.catalogEntityId ?? "package-item-existing",
    },
  };
}

function extraPhotoLine(
  input: {
    mediaType: "DIGITAL" | "PRINT";
    parentOrderPackageId?: string;
    quantity?: number;
    unitPrice?: number;
  }
): OrderCommitSnapshotLineV1 {
  const parentOrderPackageId = input.parentOrderPackageId ?? "order-package-1";
  const mediaKey = input.mediaType.toLowerCase();
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? (input.mediaType === "DIGITAL" ? 5 : 7.5);
  return {
    lineId: `extra-photo:${parentOrderPackageId}:${mediaKey}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SELECTED_PHOTO_EXTRA,
    orderEntityKind: ORDER_COMMIT_ORDER_ENTITY_KIND.ORDER_PACKAGE_PHOTO_EXTRA,
    orderEntityId: `${parentOrderPackageId}:${input.mediaType}`,
    parentOrderPackageId,
    catalogEntityId: null,
    stableKey: `order-package:${parentOrderPackageId}:extra-photo:${mediaKey}`,
    label: `Extra photos - ${input.mediaType === "DIGITAL" ? "Digital" : "Print"} (Current Package)`,
    quantity,
    unitPrice,
    lineTotal: money(unitPrice * quantity),
    priceSource: ORDER_COMMIT_PRICE_SOURCE.SESSION_TYPE_EXTRA_PHOTO_PRICING,
    metadata: { mediaType: input.mediaType, sessionTypeId: "session-type-1" },
  };
}

function sessionConfigurationLine(input: {
  selectionId: string;
  configurationId: string;
  linkedOrderAddOnId?: string;
}): OrderCommitSnapshotLineV1 {
  return {
    lineId: `session-config:${input.selectionId}`,
    lineKind: ORDER_COMMIT_SNAPSHOT_LINE_KIND.SESSION_CONFIGURATION,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: input.configurationId,
    stableKey: `session-configuration-selection:${input.selectionId}`,
    label: "Linked Album",
    quantity: 1,
    unitPrice: 0,
    lineTotal: 0,
    priceSource:
      ORDER_COMMIT_PRICE_SOURCE.SESSION_CONFIGURATION_SELECTION_SNAPSHOT,
    metadata: {
      configurationId: input.configurationId,
      optionId: null,
      numericValue: null,
      orderAddOnId: input.linkedOrderAddOnId ?? null,
      snapshotConfigurationCode: "LINKED_ALBUM",
      snapshotFinancialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
      snapshotInputType: SessionConfigurationInputType.TOGGLE,
      snapshotLabel: "Linked Album",
      snapshotLinkedProductId: input.linkedOrderAddOnId ? "product-linked" : null,
      snapshotOptionLabel: null,
      snapshotPriceDelta: 0,
      snapshotPricingMode: input.linkedOrderAddOnId
        ? SessionConfigurationPricingMode.LINKED_PRODUCT
        : SessionConfigurationPricingMode.NONE,
      textValue: null,
    },
  };
}

function linkedProductLine(input: {
  selectionId: string;
  orderAddOnId: string;
  productId: string;
  unitPrice: number;
}): OrderCommitSnapshotLineV1 {
  return {
    lineId: `session-config:${input.selectionId}:addon:${input.orderAddOnId}`,
    lineKind:
      ORDER_COMMIT_SNAPSHOT_LINE_KIND
        .LINKED_PRODUCT_SESSION_CONFIGURATION_ADD_ON,
    orderEntityKind:
      ORDER_COMMIT_ORDER_ENTITY_KIND
        .ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
    orderEntityId: input.selectionId,
    parentOrderPackageId: "order-package-1",
    catalogEntityId: input.productId,
    stableKey: `session-configuration-selection:${input.selectionId}:add-on:${input.orderAddOnId}`,
    label: "Linked Album Product",
    quantity: 1,
    unitPrice: input.unitPrice,
    lineTotal: input.unitPrice,
    priceSource: ORDER_COMMIT_PRICE_SOURCE.ORDER_ROW_SNAPSHOT,
    metadata: {
      configurationId: "configuration-linked",
      optionId: null,
      numericValue: null,
      orderAddOnId: input.orderAddOnId,
      productId: input.productId,
      snapshotConfigurationCode: "LINKED_ALBUM",
      snapshotFinancialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
      snapshotInputType: SessionConfigurationInputType.TOGGLE,
      snapshotLabel: "Linked Album",
      snapshotLinkedProductId: input.productId,
      snapshotOptionLabel: null,
      snapshotPriceDelta: 0,
      snapshotPricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
      textValue: null,
    },
  };
}

function requireLine(snapshot: OrderCommitSnapshotV1, stableKey: string) {
  const line = snapshot.lines.find((candidate) => candidate.stableKey === stableKey);
  assert.ok(line, `Expected snapshot line ${stableKey}`);
  return line;
}

function cloneLine(line: OrderCommitSnapshotLineV1): OrderCommitSnapshotLineV1 {
  return { ...line, metadata: { ...line.metadata } };
}

function money(value: number): number {
  return Number(value.toFixed(3));
}

type FakeOrderCommitDraftRow = {
  id: string;
  orderId: string;
  financialCaseId: string;
  baseCommitId: string | null;
  pendingSnapshotVersion: number;
  pendingSnapshotJson: unknown;
  pendingOpsJson: unknown;
  version: number;
  ownerUserId: string;
  openedByUserId: string;
  lastTouchedByUserId: string;
  legacyAdjustmentWorkspaceId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeOrderCommitDraftFindUniqueArgs = {
  where: { orderId?: string; id?: string };
};

type FakeOrderCommitDraftUpdateManyArgs = {
  where: { id: string; version: number };
  data: {
    pendingSnapshotVersion?: number;
    pendingSnapshotJson?: unknown;
    pendingOpsJson?: unknown;
    version?: { increment: number };
    lastTouchedByUserId?: string;
  };
};

function fakeOrderCommitClient(
  options: {
    drafts?: FakeOrderCommitDraftRow[];
    packagePhotoCount?: number;
  } = {}
) {
  const drafts = [...(options.drafts ?? [])];
  const operationalRows = {
    orders: [{ id: "order-1", selectedPhotoCount: 12 }],
    orderPackages: [{ id: "op-order-1", currentPackageId: "package-current" }],
    orderAddOns: [{ id: "addon-existing", productId: "product-existing" }],
    packageItemUpgrades: [{ id: "upgrade-existing", packageItemId: "item-existing" }],
    packageSessionConfigurationSelections: [
      { id: "selection-existing", configurationId: "configuration-existing" },
    ],
  };
  const financialRows = {
    invoices: [{ id: "invoice-1", totalAmount: "162.500" }],
    payments: [{ id: "payment-1", amount: "100.000" }],
    paymentAllocations: [{ id: "allocation-1", amount: "100.000" }],
    documentApplications: [{ id: "application-1", amount: "10.000" }],
    creditNotes: [{ id: "credit-note-1", amount: "10.000" }],
    refunds: [{ id: "refund-1", amount: "5.000" }],
    adjustmentWorkspaces: [{ id: "workspace-1", pendingChangesJson: { old: true } }],
  };
  const root = {
    orderCommitDraft: {
      findUnique: async (args: FakeOrderCommitDraftFindUniqueArgs) =>
        drafts.find((draft) => {
          if (args.where.orderId) return draft.orderId === args.where.orderId;
          if (args.where.id) return draft.id === args.where.id;
          return false;
        }) ?? null,
      updateMany: async (args: FakeOrderCommitDraftUpdateManyArgs) => {
        const draft = drafts.find(
          (candidate) =>
            candidate.id === args.where.id &&
            candidate.version === args.where.version
        );
        if (!draft) return { count: 0 };
        if (args.data.pendingSnapshotVersion !== undefined) {
          draft.pendingSnapshotVersion = args.data.pendingSnapshotVersion;
        }
        if (args.data.pendingSnapshotJson !== undefined) {
          draft.pendingSnapshotJson = args.data.pendingSnapshotJson;
        }
        if (args.data.pendingOpsJson !== undefined) {
          draft.pendingOpsJson = args.data.pendingOpsJson;
        }
        if (args.data.version) {
          draft.version += args.data.version.increment;
        }
        if (args.data.lastTouchedByUserId !== undefined) {
          draft.lastTouchedByUserId = args.data.lastTouchedByUserId;
        }
        draft.updatedAt = new Date("2026-06-01T11:00:00.000Z");
        return { count: 1 };
      },
    },
    package: {
      findUnique: async (args: { where: { id: string } }) => {
        if (args.where.id !== "package-new") return null;
        return {
          id: "package-new",
          name: "Composite Package",
          price: decimal("200.000"),
          photoCount: options.packagePhotoCount ?? 11,
          isActive: true,
          packageFamily: {
            sessionType: { id: "session-type-1", name: "Portrait" },
          },
        };
      },
    },
    product: {
      findUnique: async (args: { where: { id: string } }) => {
        if (args.where.id !== "product-stage") return null;
        return {
          id: "product-stage",
          name: "Framed Desk Print",
          canonicalPrice: decimal("33.000"),
          isActive: true,
          isAddOn: true,
        };
      },
    },
    packageItem: {
      findUnique: async () => null,
    },
    sessionConfiguration: {
      findUnique: async () => null,
    },
    sessionTypeExtraPhotoPricing: {
      findMany: async () => [
        {
          sessionTypeId: "session-type-1",
          mediaType: MediaType.DIGITAL,
          unitPrice: decimal("5.000"),
        },
        {
          sessionTypeId: "session-type-1",
          mediaType: MediaType.PRINT,
          unitPrice: decimal("7.500"),
        },
      ],
    },
    $transaction: async <T>(fn: (transaction: unknown) => Promise<T>) => fn(root),
  };

  return {
    drafts,
    operationalRowsSnapshot: () => structuredClone(operationalRows),
    financialRowsSnapshot: () => structuredClone(financialRows),
    draftRoot: root as unknown as NonNullable<
      StageOrderCommitDraftChangeInput["client"] | AppendOrderCommitDraftOperationInput["client"]
    >,
    draftRead: root as unknown as NonNullable<GetOrderCommitDraftInput["client"]>,
  };
}

function fakeDraft(
  overrides: Partial<FakeOrderCommitDraftRow> & { id: string }
): FakeOrderCommitDraftRow {
  const now = new Date("2026-06-01T09:30:00.000Z");
  return {
    id: overrides.id,
    orderId: overrides.orderId ?? "order-1",
    financialCaseId: overrides.financialCaseId ?? "financial-case-1",
    baseCommitId: overrides.baseCommitId ?? null,
    pendingSnapshotVersion: overrides.pendingSnapshotVersion ?? 1,
    pendingSnapshotJson: overrides.pendingSnapshotJson ?? serviceSnapshotFixture(),
    pendingOpsJson:
      overrides.pendingOpsJson ??
      {
        schemaVersion: ORDER_COMMIT_DRAFT_PENDING_OPS_SCHEMA_VERSION,
        operations: [],
      },
    version: overrides.version ?? 0,
    ownerUserId: overrides.ownerUserId ?? "owner-user",
    openedByUserId: overrides.openedByUserId ?? "owner-user",
    lastTouchedByUserId: overrides.lastTouchedByUserId ?? "owner-user",
    legacyAdjustmentWorkspaceId: overrides.legacyAdjustmentWorkspaceId ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function noteOperation(id: string): OrderCommitDraftOperationV1 {
  return {
    id,
    type: ORDER_COMMIT_DRAFT_OPERATION_TYPE.NOTE_APPENDED,
    payload: { note: "history only" },
    createdAt: "2026-06-01T11:10:00.000Z",
    actorUserId: "owner-user",
  };
}

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
