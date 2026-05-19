import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test from "node:test";
import {
  AuditAction,
  AuditEntityType,
  InvoiceLineType,
  InvoiceType,
  OrderEntityKind,
  Prisma,
  ProductCategory,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationPricingMode,
  type PrismaClient,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
import { formatMoney } from "@/lib/formatting/money";
import type { AdjustmentWorkspaceEdit } from "@/modules/adjustment-workspace/adjustment-workspace.types";
import { withIsolatedBackendInvariantSchema } from "../backend-invariants/harness";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

type WorkspaceServices = typeof import("@/modules/adjustment-workspace/adjustment-workspace.service");
type PhaseBFixturesModule = typeof import("../financial-phase-b/fixtures");
type PhaseBFixtures = Awaited<
  ReturnType<PhaseBFixturesModule["seedPhaseBFixtures"]>
>;
type BuildLockedWorkflow =
  PhaseBFixturesModule["buildLockedFinalInvoiceWorkflowFixture"];

type IntegrationContext = {
  db: PrismaClient;
  services: WorkspaceServices;
  fixtures: PhaseBFixtures;
  buildLockedFinalInvoiceWorkflowFixture: BuildLockedWorkflow;
  upgradeProductId: string;
};

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;

moduleWithLoader._load = function loadWithServerOnlyShim(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalModuleLoad.call(this, request, parent, isMain);
};

let integrationContext: IntegrationContext | null = null;
let releaseSchema: (() => void) | null = null;
let schemaRun: Promise<void> | null = null;

test.before(async () => {
  let resolveSetup: () => void = () => {};
  let rejectSetup: (error: unknown) => void = () => {};
  const setupComplete = new Promise<void>((resolve, reject) => {
    resolveSetup = resolve;
    rejectSetup = reject;
  });

  schemaRun = withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const { db } = await import("@/lib/db");
      const services = await import(
        "@/modules/adjustment-workspace/adjustment-workspace.service"
      );
      const {
        buildLockedFinalInvoiceWorkflowFixture,
        seedPhaseBFixtures,
      } = await import("../financial-phase-b/fixtures");

      const fixtures = await seedPhaseBFixtures(db);
      const upgradeTierProductId = await createDeliverableProduct(
        db,
        "83a-finalize-tier-product",
        "83a Finalize Tier Frame",
        "45.000"
      );
      const upgradeProductId = await createDeliverableProduct(
        db,
        "83a-finalize-upgrade-product",
        "83a Finalize Premium Frame",
        "65.000"
      );
      await db.packageItem.create({
        data: {
          id: "83a-finalize-upgrade-package-item",
          packageId: fixtures.upgradePackageId,
          productId: upgradeTierProductId,
          quantity: 1,
          priceSnapshot: new Prisma.Decimal("45.000"),
        },
      });

      integrationContext = {
        db,
        services,
        fixtures,
        buildLockedFinalInvoiceWorkflowFixture,
        upgradeProductId,
      };
      resolveSetup();

      await new Promise<void>((resolve) => {
        releaseSchema = resolve;
      });
    } catch (error) {
      rejectSetup(error);
      throw error;
    } finally {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  await setupComplete;
});

test.after(async () => {
  releaseSchema?.();
  await schemaRun;
  moduleWithLoader._load = originalModuleLoad;
});

test("finalizeWorkspace emits ADJ lines for each new 83a edit op", async () => {
  const {
    db,
    services,
    fixtures,
    buildLockedFinalInvoiceWorkflowFixture,
    upgradeProductId,
  } = getIntegrationContext();

      await assertFinalizedAdjustment({
        db,
        services,
        fixtures,
        suffix: "83a-upgrade",
        edit: async (workflow) => ({
          id: "upgrade-package-item",
          op: "upgrade_package_item",
          orderPackageId: await firstOrderPackageId(db, workflow.orderId),
          packageItemId: await firstPackageItemId(db, fixtures.basePackageId),
          toProductId: upgradeProductId,
          quantity: 1,
        }),
        expected: [
          {
            lineType: InvoiceLineType.PACKAGE_UPGRADE,
            causeOrderEntityKind: OrderEntityKind.UPGRADE,
          },
        ],
      });

      await assertFinalizedAdjustment({
        db,
        services,
        fixtures,
        suffix: "83a-photos",
        edit: async (workflow) => ({
          id: "change-selected-photo-count",
          op: "change_selected_photo_count",
          orderPackageId: await firstOrderPackageId(db, workflow.orderId),
          selectedPhotoCount: 12,
          extraDigitalCount: 2,
          extraPrintCount: 0,
        }),
        expected: [
          {
            lineType: InvoiceLineType.BUNDLE_ADJUSTMENT,
            causeOrderEntityKind: OrderEntityKind.EXTRA_PHOTO,
          },
        ],
      });

      await assertFinalizedAdjustment({
        db,
        services,
        fixtures,
        suffix: "83a-tier",
        edit: async (workflow) => ({
          id: "change-package-tier",
          op: "change_package_tier",
          orderPackageId: await firstOrderPackageId(db, workflow.orderId),
          toPackageRefId: fixtures.upgradePackageId,
        }),
        expected: [
          {
            lineType: InvoiceLineType.PACKAGE_UPGRADE,
            causeOrderEntityKind: OrderEntityKind.PACKAGE_TIER_UPGRADE,
          },
          {
            lineType: InvoiceLineType.PACKAGE_UPGRADE,
            causeOrderEntityKind: OrderEntityKind.PACKAGE_TIER_UPGRADE,
          },
        ],
      });

      const combinedWorkflow = await buildLockedFinalInvoiceWorkflowFixture(
        db,
        fixtures,
        "83a-combined"
      );
      const combinedOrderPackageId = await firstOrderPackageId(
        db,
        combinedWorkflow.orderId
      );
      await stageAndFinalize(
        services,
        combinedWorkflow.finalInvoiceId,
        fixtures.adminActor,
        [
          {
            id: "combined-tier",
            op: "change_package_tier",
            orderPackageId: combinedOrderPackageId,
            toPackageRefId: fixtures.upgradePackageId,
          },
          {
            id: "combined-upgrade",
            op: "upgrade_package_item",
            orderPackageId: combinedOrderPackageId,
            packageItemId: await firstPackageItemId(db, fixtures.upgradePackageId),
            toProductId: upgradeProductId,
            quantity: 1,
          },
          {
            id: "combined-photos",
            op: "change_selected_photo_count",
            orderPackageId: combinedOrderPackageId,
            selectedPhotoCount: 17,
            extraDigitalCount: 2,
            extraPrintCount: 0,
          },
        ]
      );
      const combinedAdjustment = await onlyAdjustmentInvoice(
        db,
        combinedWorkflow.orderId,
        combinedWorkflow.finalInvoiceId
      );
      assertLineSemantics(combinedAdjustment.lineItems, [
        {
          lineType: InvoiceLineType.PACKAGE_UPGRADE,
          causeOrderEntityKind: OrderEntityKind.PACKAGE_TIER_UPGRADE,
        },
        {
          lineType: InvoiceLineType.PACKAGE_UPGRADE,
          causeOrderEntityKind: OrderEntityKind.PACKAGE_TIER_UPGRADE,
        },
        {
          lineType: InvoiceLineType.PACKAGE_UPGRADE,
          causeOrderEntityKind: OrderEntityKind.UPGRADE,
        },
        {
          lineType: InvoiceLineType.BUNDLE_ADJUSTMENT,
          causeOrderEntityKind: OrderEntityKind.EXTRA_PHOTO,
        },
      ]);
});

test("finalizeWorkspace applies operational and financial session configuration edits through their split routes", async () => {
  const {
    db,
    services,
    fixtures,
    buildLockedFinalInvoiceWorkflowFixture,
  } = getIntegrationContext();
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "92a-session-config"
  );
  const orderPackage = await db.orderPackage.findFirstOrThrow({
    where: { orderId: workflow.orderId },
    select: { id: true },
  });
  const [operationalConfig, financialConfig] = await Promise.all([
    db.sessionConfiguration.create({
      data: {
        code: "92A_THEME",
        name: "92a Cake Theme",
        sessionTypeId: fixtures.sessionTypeId,
        inputType: SessionConfigurationInputType.TEXT,
        pricingMode: SessionConfigurationPricingMode.NONE,
        financialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
        isActive: true,
      },
    }),
    db.sessionConfiguration.create({
      data: {
        code: "92A_TWINS",
        name: "92a Twins",
        sessionTypeId: fixtures.sessionTypeId,
        inputType: SessionConfigurationInputType.TOGGLE,
        pricingMode: SessionConfigurationPricingMode.FIXED,
        financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
        fixedPriceDelta: new Prisma.Decimal("12.000"),
        isActive: true,
      },
    }),
  ]);
  const { workspaceId, version } = await stageWorkspaceEdits(
    services,
    workflow.finalInvoiceId,
    fixtures.adminActor,
    [
      {
        id: "92a-operational-theme",
        op: "change_session_configuration_selection",
        orderPackageId: orderPackage.id,
        configurationId: operationalConfig.id,
        desired: { kind: "text", textValue: "Blue cake" },
      },
      {
        id: "92a-financial-twins",
        op: "change_session_configuration_selection",
        orderPackageId: orderPackage.id,
        configurationId: financialConfig.id,
        desired: { kind: "toggle" },
      },
    ]
  );

  const result = await services.finalizeWorkspace(
    workspaceId,
    { version },
    fixtures.adminActor
  );
  assert.ok(result.adjustmentInvoiceId);

  const adjustment = await onlyAdjustmentInvoice(
    db,
    workflow.orderId,
    workflow.finalInvoiceId
  );
  assertLineSemantics(adjustment.lineItems, [
    {
      lineType: InvoiceLineType.SESSION_CONFIGURATION,
      causeOrderEntityKind: OrderEntityKind.SESSION_CONFIGURATION_SELECTION,
    },
  ]);
  const selectionRows = await db.orderPackageSessionConfigurationSelection.findMany({
    where: { orderPackageId: orderPackage.id },
    orderBy: { snapshotConfigurationCode: "asc" },
  });
  assert.equal(selectionRows.length, 2);
  assert.equal(
    selectionRows.find((row) => row.configurationId === operationalConfig.id)
      ?.textValue,
    "Blue cake"
  );
  assert.equal(
    await db.auditLog.count({
      where: {
        entityType: AuditEntityType.ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
        action: AuditAction.ORDER_LOCKED_FIELD_MUTATED,
        context: { path: ["source"], equals: "post_lock_workspace" },
      },
    }),
    1
  );
  const workspace = await db.adjustmentWorkspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { status: true },
  });
  assert.equal(workspace.status, "FINALIZED");
});

test("derivePOSWorkspaceFromAdjustmentWorkspace projects staged edits into POS modules", async () => {
  const {
    db,
    services,
    fixtures,
    buildLockedFinalInvoiceWorkflowFixture,
    upgradeProductId,
  } = getIntegrationContext();
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "83c-derived-pos"
  );
  const orderPackageId = await firstOrderPackageId(db, workflow.orderId);
  const packageItemId = await firstPackageItemId(db, fixtures.basePackageId);
  const workspace = await services.openWorkspace(
    workflow.finalInvoiceId,
    fixtures.adminActor
  );
  let version = 0;
  for (const edit of [
    {
      id: "83c-tier",
      op: "change_package_tier",
      orderPackageId,
      toPackageRefId: fixtures.upgradePackageId,
    },
    {
      id: "83c-photos",
      op: "change_selected_photo_count",
      orderPackageId,
      selectedPhotoCount: 17,
      extraDigitalCount: 2,
      extraPrintCount: 0,
    },
    {
      id: "83c-addon",
      op: "add_line",
      kind: "addon",
      refId: fixtures.addOnProductId,
      quantity: 1,
    },
  ] satisfies AdjustmentWorkspaceEdit[]) {
    const view = await services.applyEdit(
      workspace.id,
      { version, edit },
      fixtures.adminActor
    );
    version = view.version;
  }

  const derived = await services.derivePOSWorkspaceFromAdjustmentWorkspace(
    workspace.id
  );
  assert.ok(derived);
  assert.equal(derived.invoice?.isLocked, true);
  assert.equal(
    derived.packageLines[0]?.currentPackage.id,
    fixtures.upgradePackageId
  );
  assert.equal(derived.packageLines[0]?.selectedPhotoCount, 17);
  assert.equal(derived.packageLines[0]?.extraDigitalCount, 2);
  assert.equal(
    derived.addOns.some((addOn) => addOn.productId === fixtures.addOnProductId),
    true
  );

  const upgradeWorkflow = await buildLockedFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "83c-derived-item"
  );
  const upgradeWorkspace = await services.openWorkspace(
    upgradeWorkflow.finalInvoiceId,
    fixtures.adminActor
  );
  await services.applyEdit(
    upgradeWorkspace.id,
    {
      version: 0,
      edit: {
        id: "83c-upgrade-item",
        op: "upgrade_package_item",
        orderPackageId: await firstOrderPackageId(db, upgradeWorkflow.orderId),
        packageItemId,
        toProductId: upgradeProductId,
        quantity: 1,
      },
    },
    fixtures.adminActor
  );
  const upgradedDerived =
    await services.derivePOSWorkspaceFromAdjustmentWorkspace(
      upgradeWorkspace.id
    );
  assert.equal(
    upgradedDerived?.packageLines[0]?.packageItems[0]?.productId,
    upgradeProductId
  );
});

test("derivePOSWorkspaceFromAdjustmentWorkspace preserves POS public field equivalence for representative edits", async () => {
  const {
    db,
    services,
    fixtures,
    buildLockedFinalInvoiceWorkflowFixture,
    upgradeProductId,
  } = getIntegrationContext();
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "r7b-pos-equivalence"
  );
  const orderPackageId = await firstOrderPackageId(db, workflow.orderId);
  const basePackageItemId = await firstPackageItemId(db, fixtures.basePackageId);
  const upgradePackageItem = await db.packageItem.findFirstOrThrow({
    where: { packageId: fixtures.upgradePackageId },
    select: {
      productId: true,
      priceSnapshot: true,
      product: { select: { name: true } },
    },
  });
  const [originalItemBasePrice, upgradeProduct, downgradeProductId] =
    await Promise.all([
      db.packageItem
        .findUniqueOrThrow({
          where: { id: basePackageItemId },
          select: { priceSnapshot: true },
        })
        .then((item) => item.priceSnapshot.toNumber()),
      db.product.findUniqueOrThrow({
        where: { id: upgradeProductId },
        select: { canonicalPrice: true },
      }),
      createDeliverableProduct(
        db,
        "r7b-downgrade-product",
        "R7b Downgrade Frame",
        "30.000"
      ),
    ]);
  assert.ok(originalItemBasePrice > 0);
  const upgradeDelta = Number(
    upgradeProduct.canonicalPrice.minus(originalItemBasePrice).toFixed(3)
  );
  const expectedUpgradePrice = Number(
    (originalItemBasePrice + upgradeDelta).toFixed(3)
  );
  const expectedDowngradePrice = 30;
  assert.ok(expectedDowngradePrice < originalItemBasePrice);
  const existingAddOn = await db.orderAddOn.create({
    data: {
      orderId: workflow.orderId,
      orderPackageId,
      productId: fixtures.zeroPriceAddOnProductId,
      nameSnapshot: "Phase B Existing Remove Add-on",
      priceSnapshot: new Prisma.Decimal("0.000"),
      quantity: 1,
    },
    select: { id: true },
  });
  const { workspaceId } = await stageWorkspaceEdits(
    services,
    workflow.finalInvoiceId,
    fixtures.adminActor,
    [
      {
        id: "equiv-tier",
        op: "change_package_tier",
        orderPackageId,
        toPackageRefId: fixtures.upgradePackageId,
      },
      {
        id: "equiv-photos",
        op: "change_selected_photo_count",
        orderPackageId,
        selectedPhotoCount: 18,
        extraDigitalCount: 2,
        extraPrintCount: 1,
      },
      {
        id: "equiv-add-addon",
        op: "add_line",
        kind: "addon",
        refId: fixtures.addOnProductId,
        quantity: 1,
      },
      {
        id: "equiv-remove-addon",
        op: "remove_line",
        targetLineId: `addon:${existingAddOn.id}`,
      },
    ]
  );

  const derived = await services.derivePOSWorkspaceFromAdjustmentWorkspace(
    workspaceId
  );
  assert.ok(derived);
  const publicFields = pickAdapterPublicFields(derived);

  assert.deepEqual(publicFields, {
    packageLines: [
      {
        currentPackage: {
          id: fixtures.upgradePackageId,
          name: "Phase B Upgrade Package",
          price: 600,
          priceLabel: formatMoney(600),
        },
        extraDigitalCount: 2,
        extraPrintCount: 1,
        extraPhotoTotal: 16,
        packageItems: [
          {
            productId: upgradePackageItem.productId,
            productName: upgradePackageItem.product.name,
            priceSnapshot: upgradePackageItem.priceSnapshot.toNumber(),
            priceSnapshotLabel: formatMoney(upgradePackageItem.priceSnapshot),
          },
        ],
      },
    ],
    addOns: [
      {
        productId: fixtures.addOnProductId,
        name: "Phase B Add-on",
        price: 50,
        priceLabel: formatMoney(50),
      },
    ],
    totals: {
      rawDeliverableTotal: upgradePackageItem.priceSnapshot.toNumber(),
      includedPhotoCount: 15,
      selectedPhotoCount: 18,
      extraPhotoCount: 3,
      extraPhotoTotal: 16,
      addOnTotal: 50,
      sessionConfigurationTotal: 0,
    },
  });

  const upgradeWorkflow = await buildLockedFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "r7b-pos-upgrade-equivalence"
  );
  const { workspaceId: upgradeWorkspaceId } = await stageWorkspaceEdits(
    services,
    upgradeWorkflow.finalInvoiceId,
    fixtures.adminActor,
    [
      {
        id: "equiv-upgrade-item",
        op: "upgrade_package_item",
        orderPackageId: await firstOrderPackageId(db, upgradeWorkflow.orderId),
        packageItemId: basePackageItemId,
        toProductId: upgradeProductId,
        quantity: 1,
      },
    ]
  );
  const upgraded = await services.derivePOSWorkspaceFromAdjustmentWorkspace(
    upgradeWorkspaceId
  );
  assert.ok(upgraded);
  const upgradedItem = upgraded.packageLines[0]?.packageItems[0];
  assert.equal(upgradedItem?.priceSnapshot, expectedUpgradePrice);
  assert.equal(
    upgradedItem?.priceSnapshotLabel,
    formatMoney(expectedUpgradePrice),
    "upgraded package item label must match the legacy Decimal formatter output"
  );
  assert.equal(upgraded.rawDeliverableTotal, expectedUpgradePrice);

  const downgradeWorkflow = await buildLockedFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "r7b-pos-downgrade-equivalence"
  );
  const { workspaceId: downgradeWorkspaceId } = await stageWorkspaceEdits(
    services,
    downgradeWorkflow.finalInvoiceId,
    fixtures.adminActor,
    [
      {
        id: "equiv-downgrade-item",
        op: "upgrade_package_item",
        orderPackageId: await firstOrderPackageId(db, downgradeWorkflow.orderId),
        packageItemId: basePackageItemId,
        toProductId: downgradeProductId,
        quantity: 1,
      },
    ]
  );
  const downgraded = await services.derivePOSWorkspaceFromAdjustmentWorkspace(
    downgradeWorkspaceId
  );
  assert.ok(downgraded);
  const downgradedItem = downgraded.packageLines[0]?.packageItems[0];
  assert.equal(downgradedItem?.productId, downgradeProductId);
  assert.equal(downgradedItem?.priceSnapshot, expectedDowngradePrice);
  assert.equal(
    downgradedItem?.priceSnapshotLabel,
    formatMoney(expectedDowngradePrice)
  );
  assert.equal(downgraded.rawDeliverableTotal, expectedDowngradePrice);
});

test("finalizeWorkspace emits no ADJ when selected-photo edits return to baseline", async () => {
  const {
    db,
    services,
    fixtures,
    buildLockedFinalInvoiceWorkflowFixture,
  } = getIntegrationContext();
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "83c-photo-revert"
  );
  const orderPackage = await db.orderPackage.findFirstOrThrow({
    where: { orderId: workflow.orderId },
    select: { id: true, package: { select: { photoCount: true } } },
  });
  const { workspaceId, version } = await stageWorkspaceEdits(
    services,
    workflow.finalInvoiceId,
    fixtures.adminActor,
    [
      {
        id: "photo-count-increase",
        op: "change_selected_photo_count",
        orderPackageId: orderPackage.id,
        selectedPhotoCount: orderPackage.package.photoCount + 2,
        extraDigitalCount: 2,
        extraPrintCount: 0,
      },
      {
        id: "photo-count-baseline",
        op: "change_selected_photo_count",
        orderPackageId: orderPackage.id,
        selectedPhotoCount: orderPackage.package.photoCount,
        extraDigitalCount: 0,
        extraPrintCount: 0,
      },
    ]
  );
  const derived = await services.derivePOSWorkspaceFromAdjustmentWorkspace(
    workspaceId
  );
  assert.equal(
    derived?.packageLines[0]?.selectedPhotoCount,
    orderPackage.package.photoCount
  );

  const result = await services.finalizeWorkspace(
    workspaceId,
    { version },
    fixtures.adminActor
  );

  assert.equal(result.adjustmentInvoiceId, null);
  await assertNoAdjustmentInvoice(db, workflow.orderId, workflow.finalInvoiceId);
});

test("finalizeWorkspace emits no ADJ when staged add-on is removed before finalize", async () => {
  const {
    db,
    services,
    fixtures,
    buildLockedFinalInvoiceWorkflowFixture,
  } = getIntegrationContext();
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "83c-addon-revert"
  );
  const addEditId = "staged-addon-then-remove";
  const { workspaceId, version } = await stageWorkspaceEdits(
    services,
    workflow.finalInvoiceId,
    fixtures.adminActor,
    [
      {
        id: addEditId,
        op: "add_line",
        kind: "addon",
        refId: fixtures.addOnProductId,
        quantity: 1,
      },
      {
        id: "remove-staged-addon",
        op: "remove_line",
        targetLineId: `edit:${addEditId}`,
      },
    ]
  );

  const result = await services.finalizeWorkspace(
    workspaceId,
    { version },
    fixtures.adminActor
  );

  assert.equal(result.adjustmentInvoiceId, null);
  await assertNoAdjustmentInvoice(db, workflow.orderId, workflow.finalInvoiceId);
});

test("workspace POS handlers disable inline reductive approval for staged edits", async () => {
  const {
    db,
    services,
    fixtures,
    buildLockedFinalInvoiceWorkflowFixture,
  } = getIntegrationContext();
  const {
    createWorkspaceAddOnHandlers,
    createWorkspaceCompositionHandlers,
  } = await import(
    "../../app/orders/[orderId]/adjustment-workspace/pos-handler-adapters"
  );
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "83c-inline-approval"
  );
  const orderPackageId = await firstOrderPackageId(db, workflow.orderId);
  const workspace = await services.openWorkspace(
    workflow.finalInvoiceId,
    fixtures.adminActor
  );
  const view = await services.applyEdit(
    workspace.id,
    {
      version: 0,
      edit: {
        id: "remove-base-package-line",
        op: "remove_line",
        targetLineId: `package:${orderPackageId}`,
      },
    },
    fixtures.adminActor
  );

  const compositionHandlers = createWorkspaceCompositionHandlers(
    workflow.orderId,
    workspace.id
  );
  const addOnHandlers = createWorkspaceAddOnHandlers(
    workflow.orderId,
    workspace.id
  );

  assert.equal(view.proposal.requiresManagerApproval, true);
  assert.equal(compositionHandlers.shouldPromptInlineApproval, false);
  assert.equal(addOnHandlers.shouldPromptInlineApproval, false);
});

async function assertFinalizedAdjustment(input: {
  db: PrismaClient;
  services: WorkspaceServices;
  fixtures: PhaseBFixtures;
  suffix: string;
  edit: (workflow: { orderId: string; finalInvoiceId: string }) => Promise<AdjustmentWorkspaceEdit>;
  expected: Array<{
    lineType: InvoiceLineType;
    causeOrderEntityKind: OrderEntityKind;
  }>;
}) {
  const { buildLockedFinalInvoiceWorkflowFixture } = await import(
    "../financial-phase-b/fixtures"
  );
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(
    input.db,
    input.fixtures,
    input.suffix
  );
  await stageAndFinalize(
    input.services,
    workflow.finalInvoiceId,
    input.fixtures.adminActor,
    [await input.edit(workflow)]
  );
  const adjustment = await onlyAdjustmentInvoice(
    input.db,
    workflow.orderId,
    workflow.finalInvoiceId
  );
  assertLineSemantics(adjustment.lineItems, input.expected);
}

async function stageAndFinalize(
  services: WorkspaceServices,
  finalInvoiceId: string,
  actor: ActorContext,
  edits: AdjustmentWorkspaceEdit[]
) {
  const { workspaceId, version } = await stageWorkspaceEdits(
    services,
    finalInvoiceId,
    actor,
    edits
  );
  await services.finalizeWorkspace(workspaceId, { version }, actor);
}

async function stageWorkspaceEdits(
  services: WorkspaceServices,
  finalInvoiceId: string,
  actor: ActorContext,
  edits: AdjustmentWorkspaceEdit[]
): Promise<{ workspaceId: string; version: number }> {
  const workspace = await services.openWorkspace(finalInvoiceId, actor);
  let version = 0;
  for (const edit of edits) {
    const view = await services.applyEdit(workspace.id, { version, edit }, actor);
    version = view.version;
  }
  return { workspaceId: workspace.id, version };
}

function getIntegrationContext(): IntegrationContext {
  if (!integrationContext) {
    throw new Error("Integration test context was not initialized");
  }
  return integrationContext;
}

async function assertNoAdjustmentInvoice(
  db: PrismaClient,
  orderId: string,
  parentInvoiceId: string
) {
  const count = await db.invoice.count({
    where: {
      orderId,
      invoiceType: InvoiceType.ADJUSTMENT,
      parentInvoiceId,
    },
  });
  assert.equal(count, 0, "finalize should not emit an ADJ");
}

async function onlyAdjustmentInvoice(
  db: PrismaClient,
  orderId: string,
  parentInvoiceId: string
) {
  const adjustments = await db.invoice.findMany({
    where: {
      orderId,
      invoiceType: InvoiceType.ADJUSTMENT,
      parentInvoiceId,
    },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });
  assert.equal(adjustments.length, 1, "finalize should emit exactly one ADJ");
  return adjustments[0] ?? assert.fail("missing adjustment invoice");
}

function assertLineSemantics(
  lines: Array<{
    lineType: InvoiceLineType;
    causeOrderEntityKind: OrderEntityKind | null;
  }>,
  expected: Array<{
    lineType: InvoiceLineType;
    causeOrderEntityKind: OrderEntityKind;
  }>
) {
  assert.equal(lines.length, expected.length);
  for (const expectedLine of expected) {
    const index = lines.findIndex(
      (line) =>
        line.lineType === expectedLine.lineType &&
        line.causeOrderEntityKind === expectedLine.causeOrderEntityKind
    );
    assert.notEqual(
      index,
      -1,
      `missing ${expectedLine.lineType}/${expectedLine.causeOrderEntityKind}`
    );
    lines.splice(index, 1);
  }
}

async function firstOrderPackageId(db: PrismaClient, orderId: string): Promise<string> {
  const orderPackage = await db.orderPackage.findFirstOrThrow({
    where: { orderId },
    select: { id: true },
  });
  return orderPackage.id;
}

async function firstPackageItemId(db: PrismaClient, packageId: string): Promise<string> {
  const packageItem = await db.packageItem.findFirstOrThrow({
    where: { packageId },
    select: { id: true },
  });
  return packageItem.id;
}

async function createDeliverableProduct(
  db: PrismaClient,
  id: string,
  name: string,
  price: string
): Promise<string> {
  const product = await db.product.create({
    data: {
      id,
      name,
      category: ProductCategory.DIGITAL,
      canonicalPrice: new Prisma.Decimal(price),
      isPackageDeliverable: true,
    },
    select: { id: true },
  });
  return product.id;
}

function pickAdapterPublicFields(
  workspace: Awaited<
    ReturnType<WorkspaceServices["derivePOSWorkspaceFromAdjustmentWorkspace"]>
  > extends infer Workspace
    ? NonNullable<Workspace>
    : never
) {
  return {
    packageLines: workspace.packageLines.map((line) => ({
      currentPackage: {
        id: line.currentPackage.id,
        name: line.currentPackage.name,
        price: line.currentPackage.price,
        priceLabel: line.currentPackage.priceLabel,
      },
      extraDigitalCount: line.extraDigitalCount,
      extraPrintCount: line.extraPrintCount,
      extraPhotoTotal: line.extraPhotoTotal,
      packageItems: line.packageItems.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        priceSnapshot: item.priceSnapshot,
        priceSnapshotLabel: item.priceSnapshotLabel,
      })),
    })),
    addOns: workspace.addOns.map((addOn) => ({
      productId: addOn.productId,
      name: addOn.name,
      price: addOn.price,
      priceLabel: addOn.priceLabel,
    })),
    totals: {
      rawDeliverableTotal: workspace.rawDeliverableTotal,
      includedPhotoCount: workspace.includedPhotoCount,
      selectedPhotoCount: workspace.selectedPhotoCount,
      extraPhotoCount: workspace.extraPhotoCount,
      extraPhotoTotal: workspace.extraPhotoTotal,
      addOnTotal: workspace.addOnTotal,
      sessionConfigurationTotal: workspace.sessionConfigurationTotal,
    },
  };
}
