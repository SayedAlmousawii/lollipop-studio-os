import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test, { after } from "node:test";
import {
  PaymentMethod,
  PaymentType,
  Prisma,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationPricingMode,
} from "@prisma/client";
import { withIsolatedBackendInvariantSchema } from "../backend-invariants/harness";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;
moduleWithLoader._load = function loadWithServerOnlyShim(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalModuleLoad.call(this, request, parent, isMain);
};

after(() => {
  moduleWithLoader._load = originalModuleLoad;
});

test("Adjustment Workspace package and session metadata matches locked POS composition", async () => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [
        { db },
        { seedPhaseBFixtures, buildCheckedInWorkflowFixture },
        { createInvoiceForOrder, issueInvoice },
        { recordPayment },
        { getPendingAdjustmentOrderCompositionViewModel, openWorkspace },
        { getOrderCompositionViewModel },
        { toLockedPOSComposition },
      ] = await Promise.all([
        import("@/lib/db"),
        import("../financial-phase-b/fixtures"),
        import("@/modules/invoices/invoice.service"),
        import("@/modules/payments/payment.service"),
        import("@/modules/adjustment-workspace/adjustment-workspace.service"),
        import("@/modules/orders/composition"),
        import("@/modules/orders/composition/projections"),
      ]);

      const fixtures = await seedPhaseBFixtures(db);
      const workflow = await buildCheckedInWorkflowFixture(
        db,
        fixtures,
        "r13c-metadata-parity"
      );
      const orderPackage = await db.orderPackage.findFirstOrThrow({
        where: { orderId: workflow.orderId },
        select: { id: true },
      });
      const configuration = await db.sessionConfiguration.create({
        data: {
          code: "R13C_THEME",
          name: "R13c Theme",
          sessionTypeId: fixtures.sessionTypeId,
          inputType: SessionConfigurationInputType.TEXT,
          pricingMode: SessionConfigurationPricingMode.NONE,
          financialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
          isActive: true,
        },
      });
      await db.orderPackageSessionConfigurationSelection.create({
        data: {
          orderPackageId: orderPackage.id,
          configurationId: configuration.id,
          textValue: "Cloud",
          snapshotConfigurationCode: "R13C_THEME",
          snapshotLabel: "R13c Theme",
          snapshotOptionLabel: null,
          snapshotPriceDelta: new Prisma.Decimal(0),
          snapshotFinancialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
          snapshotInputType: SessionConfigurationInputType.TEXT,
          snapshotPricingMode: SessionConfigurationPricingMode.NONE,
          snapshotLinkedProductId: null,
          orderAddOnId: null,
        },
      });

      const invoice = await createInvoiceForOrder(workflow.orderId, fixtures.adminActor);
      await issueInvoice(invoice.id, fixtures.adminActor);
      await recordPayment(
        invoice.id,
        {
          amount: 480,
          method: PaymentMethod.CASH,
          paymentType: PaymentType.FINAL,
        },
        fixtures.adminActor
      );

      const lockedModel = await getOrderCompositionViewModel({ invoiceId: invoice.id });
      assert.ok(lockedModel, "expected locked composition model");
      const lockedPOS = toLockedPOSComposition(lockedModel);
      const workspace = await openWorkspace(invoice.id, fixtures.adminActor);
      const orderModelWithOpenWorkspace = await getOrderCompositionViewModel({
        orderId: workflow.orderId,
      });
      assert.ok(
        orderModelWithOpenWorkspace,
        "expected order composition model with open workspace"
      );
      const orderPOSWithOpenWorkspace = toLockedPOSComposition(
        orderModelWithOpenWorkspace
      );
      const workspaceModel = await getPendingAdjustmentOrderCompositionViewModel(
        workspace.id
      );
      assert.ok(workspaceModel, "expected workspace composition model");
      const workspacePOS = toLockedPOSComposition(workspaceModel);

      assert.deepEqual(
        orderPOSWithOpenWorkspace.packageLines.map((line) => ({
          packageName: line.packageName,
          sessionTypeName: line.sessionTypeName,
          includedPhotoCount: line.includedPhotoCount,
          selectedPhotoCount: line.selectedPhotoCount,
        })),
        lockedPOS.packageLines.map((line) => ({
          packageName: line.packageName,
          sessionTypeName: line.sessionTypeName,
          includedPhotoCount: line.includedPhotoCount,
          selectedPhotoCount: line.selectedPhotoCount,
        }))
      );

      assert.deepEqual(
        workspacePOS.packageLines.map((line) => ({
          packageName: line.packageName,
          sessionTypeName: line.sessionTypeName,
          includedPhotoCount: line.includedPhotoCount,
          selectedPhotoCount: line.selectedPhotoCount,
        })),
        lockedPOS.packageLines.map((line) => ({
          packageName: line.packageName,
          sessionTypeName: line.sessionTypeName,
          includedPhotoCount: line.includedPhotoCount,
          selectedPhotoCount: line.selectedPhotoCount,
        }))
      );
      assert.deepEqual(
        workspacePOS.sessionConfigurations.map((item) => ({
          configurationId: item.configurationId,
          label: item.label,
          textValue: item.textValue,
          priceDelta: item.priceDelta,
        })),
        lockedPOS.sessionConfigurations.map((item) => ({
          configurationId: item.configurationId,
          label: item.label,
          textValue: item.textValue,
          priceDelta: item.priceDelta,
        }))
      );
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});
