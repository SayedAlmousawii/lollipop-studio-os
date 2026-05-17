import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test from "node:test";
import {
  InvoiceLineType,
  InvoiceType,
  OrderEntityKind,
  Prisma,
  ProductCategory,
  type PrismaClient,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
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

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;

moduleWithLoader._load = function loadWithServerOnlyShim(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalModuleLoad.call(this, request, parent, isMain);
};

test("finalizeWorkspace emits ADJ lines for each new 83a edit op", async () => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
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
      const upgradeProductId = await createDeliverableProduct(
        db,
        "83a-finalize-upgrade-product",
        "83a Finalize Premium Frame",
        "65.000"
      );

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
            packageItemId: await firstPackageItemId(db, fixtures.basePackageId),
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
    } finally {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });
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
  const workspace = await services.openWorkspace(finalInvoiceId, actor);
  let version = 0;
  for (const edit of edits) {
    const view = await services.applyEdit(workspace.id, { version, edit }, actor);
    version = view.version;
  }
  await services.finalizeWorkspace(workspace.id, { version }, actor);
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
