import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test, { after } from "node:test";
import {
  InvoiceLineType,
  MediaType,
  OrderEntityKind,
  Prisma,
  ProductCategory,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationLinkProductDisplay,
  SessionConfigurationPricingMode,
  UserRole,
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

test("session configuration resolver, invoice pricing, and POS workspace integration", async (t) => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const { db } = await import("@/lib/db");
      const {
        createInvoiceForOrderWithClient,
        closeInvoice,
        syncOrderInvoiceForFinancialEdit,
      } = await import("@/modules/invoices/invoice.service");
      const { getPOSWorkspace } = await import("@/modules/orders/order.service");
      const {
        deriveLockedFinancialSidebarSummary,
      } = await import("@/modules/orders/order-settlement");
      const {
        resolveOrderPackageSessionConfigurations,
        SessionConfigurationRequiredSelectionMissingError,
      } = await import(
        "@/modules/session-configurations/session-configuration-resolver"
      );
      const { priceSelections } = await import(
        "@/modules/session-configurations/session-configuration-pricing"
      );

      await t.test("resolver reports only active required configs without selections", async () => {
        const fixture = await createFixture(db, "RESOLVE");
        await insertSelection(db, {
          orderPackageId: fixture.orderPackageId,
          configurationId: fixture.optionalConfigId,
          code: "RESOLVE_OPTIONAL",
          label: "Optional Cake",
          priceDelta: "4.000",
          pricingMode: SessionConfigurationPricingMode.FIXED,
          inputType: SessionConfigurationInputType.TOGGLE,
        });

        const initial = await resolveOrderPackageSessionConfigurations(
          db,
          fixture.orderPackageId
        );
        assert.deepEqual(initial.missingRequiredConfigurationCodes, [
          "RESOLVE_REQUIRED",
        ]);

        await db.sessionConfiguration.update({
          where: { id: fixture.requiredConfigId },
          data: { isActive: false },
        });
        const inactive = await resolveOrderPackageSessionConfigurations(
          db,
          fixture.orderPackageId
        );
        assert.deepEqual(inactive.missingRequiredConfigurationCodes, []);

        await db.sessionConfiguration.update({
          where: { id: fixture.requiredConfigId },
          data: { isActive: true, required: false },
        });
        const optional = await resolveOrderPackageSessionConfigurations(
          db,
          fixture.orderPackageId
        );
        assert.deepEqual(optional.missingRequiredConfigurationCodes, []);
      });

      await t.test("invoice creation gates required selections and snapshots priced lines", async () => {
        const fixture = await createFixture(db, "INVOICE");
        await insertSelection(db, {
          orderPackageId: fixture.orderPackageId,
          configurationId: fixture.optionalConfigId,
          code: "INVOICE_OPTIONAL",
          label: "Optional Cake",
          priceDelta: "4.000",
          pricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
          inputType: SessionConfigurationInputType.TOGGLE,
          linkProductDisplay: SessionConfigurationLinkProductDisplay.LINE_ITEM,
          linkedProductId: fixture.addOnProductId,
        });
        await insertSelection(db, {
          orderPackageId: fixture.orderPackageId,
          configurationId: fixture.modifierConfigId,
          code: "INVOICE_MODIFIER",
          label: "Album Color",
          priceDelta: "3.000",
          pricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
          inputType: SessionConfigurationInputType.SELECT,
          linkProductDisplay: SessionConfigurationLinkProductDisplay.MODIFIER_ONLY,
          linkedProductId: fixture.addOnProductId,
        });

        const invoiceCountBeforeGate = await db.invoice.count();
        await assert.rejects(
          () =>
            db.$transaction((tx) =>
              createInvoiceForOrderWithClient(tx, fixture.orderId, {
                actorUserId: fixture.managerUserId,
                actorRole: UserRole.MANAGER,
              })
            ),
          SessionConfigurationRequiredSelectionMissingError
        );
        assert.equal(await db.invoice.count(), invoiceCountBeforeGate);

        const requiredSelection = await insertSelection(db, {
          orderPackageId: fixture.orderPackageId,
          configurationId: fixture.requiredConfigId,
          code: "INVOICE_REQUIRED",
          label: "Required Twins",
          priceDelta: "12.000",
          pricingMode: SessionConfigurationPricingMode.FIXED,
          inputType: SessionConfigurationInputType.TOGGLE,
        });

        const pricedSelections = await db.orderPackageSessionConfigurationSelection.findMany({
          where: { orderPackageId: fixture.orderPackageId },
          select: {
            id: true,
            snapshotConfigurationCode: true,
            snapshotLabel: true,
            snapshotOptionLabel: true,
            snapshotPriceDelta: true,
            snapshotPricingMode: true,
            snapshotInputType: true,
            snapshotLinkProductDisplay: true,
            snapshotLinkedProductId: true,
            numericValue: true,
          },
        });
        assert.equal(priceSelections(pricedSelections).totalDelta.toFixed(3), "19.000");

        const invoice = await db.$transaction((tx) =>
          createInvoiceForOrderWithClient(tx, fixture.orderId, {
            actorUserId: fixture.managerUserId,
            actorRole: UserRole.MANAGER,
          })
        );
        const createdInvoice = await db.invoice.findUniqueOrThrow({
          where: { id: invoice.id },
        });
        assert.equal(createdInvoice.totalAmount.toFixed(3), "94.000");

        const syncedInvoice = await db.$transaction((tx) =>
          syncOrderInvoiceForFinancialEdit(tx, {
            orderId: fixture.orderId,
            previousAddOns: [
              { productId: fixture.addOnProductId, name: "Cake INVOICE", price: 5 },
              { productId: fixture.addOnProductId, name: "Cake INVOICE", price: 5 },
            ],
            previousExtraPhotoCharge: new Prisma.Decimal(5),
            actorContext: {
              actorUserId: fixture.managerUserId,
              actorRole: UserRole.MANAGER,
            },
          })
        );
        assert.equal(syncedInvoice.totalAmount, "94.000 KD");
        assert.equal(
          (
            await db.invoice.findUniqueOrThrow({
              where: { id: invoice.id },
              select: { totalAmount: true },
            })
          ).totalAmount.toFixed(3),
          "94.000"
        );

        const workspace = await getPOSWorkspace(fixture.orderId);
        assert.equal(workspace?.sessionConfigurationTotal, 19);

        await closeInvoice(invoice.id, {
          actorUserId: fixture.managerUserId,
          actorRole: UserRole.MANAGER,
        });
        const sessionConfigLines = await db.invoiceLineItem.findMany({
          where: {
            invoiceId: invoice.id,
            lineType: InvoiceLineType.SESSION_CONFIGURATION,
          },
          orderBy: { sortOrder: "asc" },
        });
        assert.equal(sessionConfigLines.length, 3);
        assert.deepEqual(
          sessionConfigLines.map((line) => line.causeOrderEntityKind),
          [
            OrderEntityKind.SESSION_CONFIGURATION_SELECTION,
            OrderEntityKind.SESSION_CONFIGURATION_SELECTION,
            OrderEntityKind.SESSION_CONFIGURATION_SELECTION,
          ]
        );
        assert.equal(
          sessionConfigLines.some(
            (line) => line.causeOrderEntityId === requiredSelection.id
          ),
          true
        );
        assert.equal(
          await db.invoiceLineItem.count({
            where: {
              invoiceId: invoice.id,
              description: "Album Color",
              lineType: InvoiceLineType.SESSION_CONFIGURATION,
            },
          }),
          1
        );

        const lockedInvoice = await db.invoice.findUniqueOrThrow({
          where: { id: invoice.id },
          select: { totalAmount: true, remainingAmount: true },
        });
        const lockedSummary = deriveLockedFinancialSidebarSummary({
          finalInvoice: {
            totalAmount: lockedInvoice.totalAmount,
            remainingAmount: lockedInvoice.remainingAmount,
            depositPaidAmount: new Prisma.Decimal(0),
          },
          finalizedAdjustments: [],
          orderId: fixture.orderId,
        });
        assert.equal(lockedSummary.customerTotal, 94);
      });
    } finally {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });
});

async function createFixture(
  db: typeof import("@/lib/db")["db"],
  suffix: string
) {
  const manager = await db.user.create({
    data: {
      name: `Session Config Manager ${suffix}`,
      email: `session-config-manager-${suffix.toLowerCase()}@example.com`,
      role: UserRole.MANAGER,
    },
  });
  const department = await db.studioDepartment.create({
    data: {
      code: `SC_${suffix}`,
      name: `Session Config ${suffix}`,
      sortOrder: 10,
    },
  });
  const sessionType = await db.sessionType.create({
    data: {
      code: `SC_SESSION_${suffix}`,
      name: `Session Config Session ${suffix}`,
      departmentId: department.id,
      calendarLabel: "Session Config",
      isActive: true,
      sortOrder: 10,
      extraPhotoPricing: {
        create: [
          { mediaType: MediaType.DIGITAL, unitPrice: new Prisma.Decimal(2) },
          { mediaType: MediaType.PRINT, unitPrice: new Prisma.Decimal(3) },
        ],
      },
    },
  });
  const packageFamily = await db.packageFamily.create({
    data: {
      code: `SC_FAMILY_${suffix}`,
      name: `Session Config Packages ${suffix}`,
      sessionTypeId: sessionType.id,
      isActive: true,
      sortOrder: 10,
    },
  });
  const packageRow = await db.package.create({
    data: {
      name: `Session Config Package ${suffix}`,
      packageFamilyId: packageFamily.id,
      price: new Prisma.Decimal(60),
      photoCount: 10,
      durationMinutes: 45,
      isActive: true,
    },
  });
  const customer = await db.customer.create({
    data: {
      name: `Session Config Customer ${suffix}`,
      phone: `+96555${suffix.length.toString().padStart(2, "0")}${suffix
        .charCodeAt(0)
        .toString()
        .padStart(5, "0")}`,
    },
  });
  const addOnProduct = await db.product.create({
    data: {
      name: `Cake ${suffix}`,
      category: ProductCategory.OTHER,
      canonicalPrice: new Prisma.Decimal(5),
      isActive: true,
      isPackageDeliverable: false,
      isAddOn: true,
    },
  });
  const jobNumber = `JOB-SC-${suffix}`;
  const job = await db.job.create({
    data: {
      jobNumber,
      customerId: customer.id,
    },
  });
  const booking = await db.booking.create({
    data: {
      publicId: `BK-SC-${suffix}`,
      jobNumber,
      jobId: job.id,
      customerId: customer.id,
      sessionDate: new Date("2026-05-18T09:00:00.000Z"),
      sessionTime: "09:00",
      departmentId: department.id,
    },
  });
  await db.financialCase.create({
    data: {
      bookingId: booking.id,
      customerId: customer.id,
      jobId: job.id,
    },
  });
  const order = await db.order.create({
    data: {
      publicId: `ORD-SC-${suffix}`,
      jobNumber,
      jobId: job.id,
      bookingId: booking.id,
      customerId: customer.id,
    },
  });
  const orderPackage = await db.orderPackage.create({
    data: {
      orderId: order.id,
      packageId: packageRow.id,
      sessionTypeId: sessionType.id,
      originalPackagePriceSnapshot: new Prisma.Decimal(60),
      finalPackagePriceSnapshot: new Prisma.Decimal(60),
      selectedPhotoCount: 12,
      extraDigitalCount: 1,
      extraPrintCount: 1,
      sortOrder: 10,
    },
  });
  await db.orderAddOn.create({
    data: {
      orderId: order.id,
      orderPackageId: orderPackage.id,
      productId: addOnProduct.id,
      nameSnapshot: addOnProduct.name,
      priceSnapshot: new Prisma.Decimal(5),
      quantity: 2,
    },
  });
  const requiredConfig = await db.sessionConfiguration.create({
    data: {
      code: `${suffix}_REQUIRED`,
      name: "Required Twins",
      sessionTypeId: sessionType.id,
      inputType: SessionConfigurationInputType.TOGGLE,
      pricingMode: SessionConfigurationPricingMode.FIXED,
      financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
      required: true,
      isActive: true,
      sortOrder: 10,
      fixedPriceDelta: new Prisma.Decimal(12),
    },
  });
  const optionalConfig = await db.sessionConfiguration.create({
    data: {
      code: `${suffix}_OPTIONAL`,
      name: "Optional Cake",
      sessionTypeId: sessionType.id,
      inputType: SessionConfigurationInputType.TOGGLE,
      pricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
      financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
      required: false,
      isActive: true,
      sortOrder: 20,
      linkedProductId: addOnProduct.id,
      linkProductDisplay: SessionConfigurationLinkProductDisplay.LINE_ITEM,
    },
  });
  const modifierConfig = await db.sessionConfiguration.create({
    data: {
      code: `${suffix}_MODIFIER`,
      name: "Album Color",
      sessionTypeId: sessionType.id,
      inputType: SessionConfigurationInputType.SELECT,
      pricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
      financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
      required: false,
      isActive: true,
      sortOrder: 30,
      linkedProductId: addOnProduct.id,
      linkProductDisplay: SessionConfigurationLinkProductDisplay.MODIFIER_ONLY,
    },
  });

  return {
    addOnProductId: addOnProduct.id,
    managerUserId: manager.id,
    modifierConfigId: modifierConfig.id,
    optionalConfigId: optionalConfig.id,
    orderId: order.id,
    orderPackageId: orderPackage.id,
    requiredConfigId: requiredConfig.id,
  };
}

async function insertSelection(
  db: typeof import("@/lib/db")["db"],
  input: {
    orderPackageId: string;
    configurationId: string;
    code: string;
    label: string;
    priceDelta: string;
    pricingMode: SessionConfigurationPricingMode;
    inputType: SessionConfigurationInputType;
    linkProductDisplay?: SessionConfigurationLinkProductDisplay | null;
    linkedProductId?: string | null;
  }
) {
  return db.orderPackageSessionConfigurationSelection.create({
    data: {
      orderPackageId: input.orderPackageId,
      configurationId: input.configurationId,
      snapshotConfigurationCode: input.code,
      snapshotLabel: input.label,
      snapshotOptionLabel: null,
      snapshotPriceDelta: new Prisma.Decimal(input.priceDelta),
      snapshotFinancialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
      snapshotInputType: input.inputType,
      snapshotPricingMode: input.pricingMode,
      snapshotLinkProductDisplay: input.linkProductDisplay ?? null,
      snapshotLinkedProductId: input.linkedProductId ?? null,
    },
  });
}
