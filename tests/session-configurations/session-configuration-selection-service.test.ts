import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test, { after } from "node:test";
import {
  AuditAction,
  AuditEntityType,
  InvoiceType,
  Prisma,
  ProductCategory,
  SessionConfigurationCounterPricingMode,
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

const managerActor = { id: "selection-manager", role: UserRole.MANAGER };

test("session configuration selection service writes full package sets with fresh snapshots", async () => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const { db } = await import("@/lib/db");
      const {
        SessionConfigurationSelectionInputMismatchError,
        SessionConfigurationSelectionFinancialNotAllowedError,
        SessionConfigurationSelectionLockedError,
        SessionConfigurationSelectionPostLockMisuseError,
        SessionConfigurationSelectionOptionMismatchError,
        applySessionConfigurationEditFromWorkspace,
        writeOrderPackageSelections,
      } = await import(
        "@/modules/session-configurations/session-configuration-selection.service"
      );
      const fixture = await createFixture(db);

      const firstWrite = await writeOrderPackageSelections(
        fixture.orderPackageId,
        [{ configurationId: fixture.toggleConfigId, kind: "toggle" }],
        managerActor
      );
      const firstSelection =
        await db.orderPackageSessionConfigurationSelection.findUniqueOrThrow({
          where: {
            orderPackageId_configurationId: {
              orderPackageId: fixture.orderPackageId,
              configurationId: fixture.toggleConfigId,
            },
          },
        });
      assert.equal(firstSelection.id, firstWrite.writtenSelectionIds[0]);
      assert.equal(firstSelection.snapshotConfigurationCode, "SELECT_TWINS");
      assert.equal(firstSelection.snapshotLabel, "Twins");
      assert.equal(firstSelection.snapshotPriceDelta.toFixed(3), "12.000");

      await db.sessionConfiguration.update({
        where: { id: fixture.toggleConfigId },
        data: { name: "Twin Babies" },
      });
      await writeOrderPackageSelections(
        fixture.orderPackageId,
        [{ configurationId: fixture.toggleConfigId, kind: "toggle" }],
        managerActor
      );
      const refreshedSelection =
        await db.orderPackageSessionConfigurationSelection.findUniqueOrThrow({
          where: {
            orderPackageId_configurationId: {
              orderPackageId: fixture.orderPackageId,
              configurationId: fixture.toggleConfigId,
            },
          },
        });
      assert.equal(refreshedSelection.id, firstSelection.id);
      assert.equal(refreshedSelection.snapshotLabel, "Twin Babies");

      await writeOrderPackageSelections(fixture.orderPackageId, [], managerActor);
      assert.equal(
        await db.orderPackageSessionConfigurationSelection.count({
          where: { orderPackageId: fixture.orderPackageId },
        }),
        0
      );

      await assert.rejects(
        () =>
          writeOrderPackageSelections(
            fixture.orderPackageId,
            [
              {
                configurationId: fixture.selectConfigId,
                kind: "select",
                optionId: fixture.counterOptionId,
              },
            ],
            managerActor
          ),
        SessionConfigurationSelectionOptionMismatchError
      );
      await assert.rejects(
        () =>
          writeOrderPackageSelections(
            fixture.orderPackageId,
            [
              {
                configurationId: fixture.toggleConfigId,
                kind: "text",
                textValue: "wrong input",
              },
            ],
            managerActor
          ),
        SessionConfigurationSelectionInputMismatchError
      );

      await writeOrderPackageSelections(
        fixture.orderPackageId,
        [
          {
            configurationId: fixture.counterConfigId,
            kind: "counter",
            numericValue: 3,
            optionId: fixture.counterOptionId,
          },
          { configurationId: fixture.linkedConfigId, kind: "toggle" },
        ],
        managerActor
      );
      const tieredCounter =
        await db.orderPackageSessionConfigurationSelection.findUniqueOrThrow({
          where: {
            orderPackageId_configurationId: {
              orderPackageId: fixture.orderPackageId,
              configurationId: fixture.counterConfigId,
            },
          },
        });
      assert.equal(tieredCounter.snapshotPriceDelta.toFixed(3), "30.000");
      const linkedSelection =
        await db.orderPackageSessionConfigurationSelection.findUniqueOrThrow({
          where: {
            orderPackageId_configurationId: {
              orderPackageId: fixture.orderPackageId,
              configurationId: fixture.linkedConfigId,
            },
          },
        });
      assert.equal(linkedSelection.snapshotLinkedProductId, fixture.productId);
      assert.equal(
        linkedSelection.snapshotLinkProductDisplay,
        SessionConfigurationLinkProductDisplay.LINE_ITEM
      );
      assert.equal(linkedSelection.snapshotPriceDelta.toFixed(3), "8.000");

      await assert.rejects(
        () =>
          writeOrderPackageSelections(
            fixture.orderPackageId,
            [
              {
                configurationId: fixture.operationalConfigId,
                kind: "text",
                textValue: "Misuse",
              },
            ],
            { id: fixture.managerUserId, role: UserRole.MANAGER },
            {
              allowPostLock: true,
              postLockAudit: { actorUserId: fixture.managerUserId },
            }
          ),
        SessionConfigurationSelectionPostLockMisuseError
      );

      await db.invoice.create({
        data: {
          publicId: "INV-SELECT-LOCKED",
          financialCaseId: fixture.financialCaseId,
          invoiceType: InvoiceType.FINAL,
          invoiceNumber: "INV-SELECT-LOCKED",
          orderId: fixture.orderId,
          bookingId: fixture.bookingId,
          customerId: fixture.customerId,
          totalAmount: new Prisma.Decimal(0),
          remainingAmount: new Prisma.Decimal(0),
          isLocked: true,
        },
      });
      await assert.rejects(
        () =>
          writeOrderPackageSelections(
            fixture.orderPackageId,
            [{ configurationId: fixture.toggleConfigId, kind: "toggle" }],
            managerActor
          ),
        SessionConfigurationSelectionLockedError
      );

      const postLockActor = { id: fixture.managerUserId, role: UserRole.MANAGER };
      await writeOrderPackageSelections(
        fixture.orderPackageId,
        [
          {
            configurationId: fixture.operationalConfigId,
            kind: "text",
            textValue: "Vanilla cake",
          },
        ],
        postLockActor,
        { allowPostLock: true, postLockAudit: { actorUserId: fixture.managerUserId } }
      );
      const operationalSelection =
        await db.orderPackageSessionConfigurationSelection.findUniqueOrThrow({
          where: {
            orderPackageId_configurationId: {
              orderPackageId: fixture.orderPackageId,
              configurationId: fixture.operationalConfigId,
            },
          },
        });
      assert.equal(operationalSelection.textValue, "Vanilla cake");
      assert.equal(
        await db.auditLog.count({
          where: {
            entityType:
              AuditEntityType.ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
            entityId: operationalSelection.id,
            action: AuditAction.ORDER_LOCKED_FIELD_MUTATED,
          },
        }),
        1
      );

      await assert.rejects(
        () =>
          writeOrderPackageSelections(
            fixture.orderPackageId,
            [
              {
                configurationId: fixture.operationalConfigId,
                kind: "text",
                textValue: "Chocolate cake",
              },
              { configurationId: fixture.toggleConfigId, kind: "toggle" },
            ],
            postLockActor,
            {
              allowPostLock: true,
              postLockAudit: { actorUserId: fixture.managerUserId },
            }
          ),
        SessionConfigurationSelectionFinancialNotAllowedError
      );
      assert.equal(
        (
          await db.orderPackageSessionConfigurationSelection.findUniqueOrThrow({
            where: {
              orderPackageId_configurationId: {
                orderPackageId: fixture.orderPackageId,
                configurationId: fixture.operationalConfigId,
              },
            },
          })
        ).textValue,
        "Vanilla cake"
      );

      await db.$transaction((tx) =>
        applySessionConfigurationEditFromWorkspace(tx, {
          orderPackageId: fixture.orderPackageId,
          configurationId: fixture.operationalConfigId,
          desired: { kind: "text", textValue: "Workspace cake" },
          audit: { actorUserId: fixture.managerUserId },
        })
      );
      const workspaceOperationalSelection =
        await db.orderPackageSessionConfigurationSelection.findUniqueOrThrow({
          where: {
            orderPackageId_configurationId: {
              orderPackageId: fixture.orderPackageId,
              configurationId: fixture.operationalConfigId,
            },
          },
        });
      assert.equal(workspaceOperationalSelection.textValue, "Workspace cake");
      assert.equal(
        await db.auditLog.count({
          where: {
            entityType:
              AuditEntityType.ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
            entityId: workspaceOperationalSelection.id,
            action: AuditAction.ORDER_LOCKED_FIELD_MUTATED,
            context: { path: ["source"], equals: "post_lock_workspace" },
          },
        }),
        1
      );
    } finally {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });
});

async function createFixture(db: typeof import("@/lib/db")["db"]) {
  const manager = await db.user.create({
    data: {
      id: "selection-manager",
      name: "Selection Manager",
      email: "selection-manager@example.com",
      role: UserRole.MANAGER,
    },
  });
  const department = await db.studioDepartment.create({
    data: {
      code: "SELECT_DEPT",
      name: "Selection Department",
      sortOrder: 10,
    },
  });
  const sessionType = await db.sessionType.create({
    data: {
      code: "SELECT_SESSION",
      name: "Selection Session",
      departmentId: department.id,
      calendarLabel: "Selection",
      isActive: true,
      sortOrder: 10,
    },
  });
  const packageFamily = await db.packageFamily.create({
    data: {
      code: "SELECT_FAMILY",
      name: "Selection Family",
      sessionTypeId: sessionType.id,
      isActive: true,
      sortOrder: 10,
    },
  });
  const packageRow = await db.package.create({
    data: {
      name: "Selection Package",
      packageFamilyId: packageFamily.id,
      price: new Prisma.Decimal(60),
      photoCount: 10,
      durationMinutes: 45,
      isActive: true,
    },
  });
  const customer = await db.customer.create({
    data: { name: "Selection Customer", phone: "+96555111111" },
  });
  const job = await db.job.create({
    data: { jobNumber: "JOB-SELECT", customerId: customer.id },
  });
  const booking = await db.booking.create({
    data: {
      publicId: "BK-SELECT",
      jobNumber: "JOB-SELECT",
      jobId: job.id,
      customerId: customer.id,
      sessionDate: new Date("2026-05-18T09:00:00.000Z"),
      sessionTime: "09:00",
      departmentId: department.id,
    },
  });
  const financialCase = await db.financialCase.create({
    data: {
      bookingId: booking.id,
      customerId: customer.id,
      jobId: job.id,
    },
  });
  const order = await db.order.create({
    data: {
      publicId: "ORD-SELECT",
      jobNumber: "JOB-SELECT",
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
      sortOrder: 10,
    },
  });
  const product = await db.product.create({
    data: {
      name: "Selection Cake",
      category: ProductCategory.OTHER,
      canonicalPrice: new Prisma.Decimal(8),
      isActive: true,
      isPackageDeliverable: false,
      isAddOn: true,
    },
  });
  const toggleConfig = await db.sessionConfiguration.create({
    data: {
      code: "SELECT_TWINS",
      name: "Twins",
      sessionTypeId: sessionType.id,
      inputType: SessionConfigurationInputType.TOGGLE,
      pricingMode: SessionConfigurationPricingMode.FIXED,
      financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
      fixedPriceDelta: new Prisma.Decimal(12),
      isActive: true,
    },
  });
  const selectConfig = await db.sessionConfiguration.create({
    data: {
      code: "SELECT_AGE",
      name: "Age Range",
      sessionTypeId: sessionType.id,
      inputType: SessionConfigurationInputType.SELECT,
      pricingMode: SessionConfigurationPricingMode.TIERED,
      financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
      isActive: true,
      options: {
        create: [{ label: "Newborn", value: "newborn", priceDelta: 0 }],
      },
    },
    include: { options: true },
  });
  const counterConfig = await db.sessionConfiguration.create({
    data: {
      code: "SELECT_SIBLINGS",
      name: "Siblings",
      sessionTypeId: sessionType.id,
      inputType: SessionConfigurationInputType.COUNTER,
      pricingMode: SessionConfigurationPricingMode.TIERED,
      financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
      counterPricingMode: SessionConfigurationCounterPricingMode.TIERED,
      isActive: true,
      options: {
        create: [{ label: "Three", value: "3", priceDelta: 30 }],
      },
    },
    include: { options: true },
  });
  const linkedConfig = await db.sessionConfiguration.create({
    data: {
      code: "SELECT_CAKE",
      name: "Cake",
      sessionTypeId: sessionType.id,
      inputType: SessionConfigurationInputType.TOGGLE,
      pricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
      financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
      linkedProductId: product.id,
      linkProductDisplay: SessionConfigurationLinkProductDisplay.LINE_ITEM,
      isActive: true,
    },
  });
  const operationalConfig = await db.sessionConfiguration.create({
    data: {
      code: "SELECT_CAKE_THEME",
      name: "Cake Theme",
      sessionTypeId: sessionType.id,
      inputType: SessionConfigurationInputType.TEXT,
      pricingMode: SessionConfigurationPricingMode.NONE,
      financialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
      isActive: true,
    },
  });

  return {
    bookingId: booking.id,
    counterConfigId: counterConfig.id,
    counterOptionId: counterConfig.options[0].id,
    customerId: customer.id,
    financialCaseId: financialCase.id,
    linkedConfigId: linkedConfig.id,
    managerUserId: manager.id,
    orderId: order.id,
    orderPackageId: orderPackage.id,
    operationalConfigId: operationalConfig.id,
    productId: product.id,
    selectConfigId: selectConfig.id,
    selectOptionId: selectConfig.options[0].id,
    toggleConfigId: toggleConfig.id,
  };
}
