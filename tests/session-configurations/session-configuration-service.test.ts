import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test, { after } from "node:test";
import {
  Prisma,
  ProductCategory,
  SessionConfigurationCounterPricingMode,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
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

const managerActor = { id: "manager-user", role: UserRole.MANAGER };

test("session configuration service creates, updates, archives, and preserves option rows", async () => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const { db } = await import("@/lib/db");
      const {
        archiveSessionConfiguration,
        createSessionConfiguration,
        SessionConfigurationCodeConflictError,
        SessionConfigurationValidationError,
        unarchiveSessionConfiguration,
        updateSessionConfiguration,
      } = await import(
        "@/modules/session-configurations/session-configuration.service"
      );

      const sessionType = await seedSessionType(db);
      const product = await db.product.create({
        data: {
          id: "product-cake",
          name: "Cake",
          category: ProductCategory.OTHER,
          canonicalPrice: new Prisma.Decimal(15),
          isActive: true,
          isPackageDeliverable: false,
          isAddOn: true,
        },
      });

      const fixed = await createSessionConfiguration(
        {
          sessionTypeId: sessionType.id,
          name: "Twins",
          inputType: SessionConfigurationInputType.TOGGLE,
          pricingMode: SessionConfigurationPricingMode.FIXED,
          financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
          required: false,
          sortOrder: 10,
          fixedPriceDelta: 25,
          options: [],
        },
        managerActor
      );
      const fixedRow = await db.sessionConfiguration.findUniqueOrThrow({
        where: { id: fixed.id },
        include: { options: true },
      });
      assert.equal(fixedRow.code, "KD_BIRTHDAY__TWINS");
      assert.equal(fixedRow.fixedPriceDelta?.toFixed(3), "25.000");
      assert.equal(fixedRow.options.length, 0);

      await assert.rejects(
        () =>
          createSessionConfiguration(
            {
              sessionTypeId: sessionType.id,
              name: "Twins",
              inputType: SessionConfigurationInputType.TOGGLE,
              pricingMode: SessionConfigurationPricingMode.FIXED,
              financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
              required: false,
              sortOrder: 20,
              fixedPriceDelta: 30,
              options: [],
            },
            managerActor
          ),
        SessionConfigurationCodeConflictError
      );

      const select = await createSessionConfiguration(
        {
          sessionTypeId: sessionType.id,
          name: "Age Range",
          inputType: SessionConfigurationInputType.SELECT,
          pricingMode: SessionConfigurationPricingMode.TIERED,
          financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
          required: true,
          sortOrder: 20,
          options: [
            {
              label: "0-30 Days",
              value: "0_30",
              priceDelta: 0,
              sortOrder: 10,
              isActive: true,
            },
            {
              label: "31-45 Days",
              value: "31_45",
              priceDelta: 20,
              sortOrder: 20,
              isActive: true,
            },
            {
              label: "46-60 Days",
              value: "46_60",
              priceDelta: 30,
              sortOrder: 30,
              isActive: true,
            },
          ],
        },
        managerActor
      );
      const createdOptions = await db.sessionConfigurationOption.findMany({
        where: { configurationId: select.id },
        orderBy: { sortOrder: "asc" },
      });
      assert.equal(createdOptions.length, 3);

      const originalCode = (
        await db.sessionConfiguration.findUniqueOrThrow({ where: { id: select.id } })
      ).code;
      await updateSessionConfiguration(
        select.id,
        {
          name: "Newborn Age Range",
          inputType: SessionConfigurationInputType.SELECT,
          pricingMode: SessionConfigurationPricingMode.TIERED,
          financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
          required: true,
          sortOrder: 30,
          options: [
            {
              id: createdOptions[0]?.id,
              label: "0-30 Days",
              value: "0_30",
              priceDelta: 0,
              sortOrder: 10,
              isActive: true,
            },
            {
              label: "61-75 Days",
              value: "61_75",
              priceDelta: 45,
              sortOrder: 40,
              isActive: true,
            },
          ],
        },
        managerActor
      );

      const updated = await db.sessionConfiguration.findUniqueOrThrow({
        where: { id: select.id },
        include: { options: { orderBy: { sortOrder: "asc" } } },
      });
      assert.equal(updated.name, "Newborn Age Range");
      assert.equal(updated.code, originalCode);
      assert.equal(updated.options.length, 4);
      assert.equal(
        updated.options.find((option) => option.id === createdOptions[1]?.id)
          ?.isActive,
        false
      );
      assert.ok(updated.options.find((option) => option.value === "61_75"));

      await archiveSessionConfiguration(select.id, managerActor);
      const optionsAfterArchive = await db.sessionConfigurationOption.findMany({
        where: { configurationId: select.id },
      });
      assert.equal(
        (await db.sessionConfiguration.findUniqueOrThrow({ where: { id: select.id } }))
          .isActive,
        false
      );
      assert.equal(optionsAfterArchive.length, 4);

      await unarchiveSessionConfiguration(select.id, managerActor);
      assert.equal(
        (await db.sessionConfiguration.findUniqueOrThrow({ where: { id: select.id } }))
          .isActive,
        true
      );

      await createSessionConfiguration(
        {
          sessionTypeId: sessionType.id,
          name: "Guest Count",
          inputType: SessionConfigurationInputType.NUMBER,
          pricingMode: SessionConfigurationPricingMode.NONE,
          financialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
          required: false,
          sortOrder: 40,
          options: [],
        },
        managerActor
      );
      await createSessionConfiguration(
        {
          sessionTypeId: sessionType.id,
          name: "Cake Theme",
          inputType: SessionConfigurationInputType.TEXT,
          pricingMode: SessionConfigurationPricingMode.NONE,
          financialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
          required: false,
          sortOrder: 50,
          options: [],
        },
        managerActor
      );
      await createSessionConfiguration(
        {
          sessionTypeId: sessionType.id,
          name: "Sibling Count",
          inputType: SessionConfigurationInputType.COUNTER,
          pricingMode: SessionConfigurationPricingMode.FIXED,
          financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
          required: false,
          sortOrder: 60,
          fixedPriceDelta: 0,
          counterPricingMode: SessionConfigurationCounterPricingMode.PER_UNIT,
          counterUnitPrice: 5,
          options: [],
        },
        managerActor
      );
      await createSessionConfiguration(
        {
          sessionTypeId: sessionType.id,
          name: "Cake Product",
          inputType: SessionConfigurationInputType.TOGGLE,
          pricingMode: SessionConfigurationPricingMode.LINKED_PRODUCT,
          financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
          required: false,
          sortOrder: 70,
          linkedProductId: product.id,
          linkProductDisplay: "LINE_ITEM",
          options: [],
        },
        managerActor
      );

      const countBeforeInvalid = await db.sessionConfiguration.count();
      await assert.rejects(
        () =>
          createSessionConfiguration(
            {
              sessionTypeId: sessionType.id,
              name: "Invalid Tier",
              inputType: SessionConfigurationInputType.TEXT,
              pricingMode: SessionConfigurationPricingMode.TIERED,
              financialBehavior: SessionConfigurationFinancialBehavior.FINANCIAL,
              required: false,
              sortOrder: 80,
              options: [],
            },
            managerActor
          ),
        SessionConfigurationValidationError
      );
      assert.equal(await db.sessionConfiguration.count(), countBeforeInvalid);
    } finally {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });
});

async function seedSessionType(db: Awaited<typeof import("@/lib/db")>["db"]) {
  const department = await db.studioDepartment.upsert({
    where: { id: "dept-kids" },
    update: {
      code: "KD",
      name: "Kids",
      sortOrder: 10,
      isActive: true,
    },
    create: {
      id: "dept-kids",
      code: "KD",
      name: "Kids",
      sortOrder: 10,
    },
  });

  return db.sessionType.upsert({
    where: { id: "session-type-birthday" },
    update: {
      code: "KD_BIRTHDAY",
      name: "Birthday",
      departmentId: department.id,
      calendarLabel: "Kids",
      calendarColor: "var(--color-info-soft)",
      sortOrder: 10,
      isActive: true,
    },
    create: {
      id: "session-type-birthday",
      code: "KD_BIRTHDAY",
      name: "Birthday",
      departmentId: department.id,
      calendarLabel: "Kids",
      calendarColor: "var(--color-info-soft)",
      sortOrder: 10,
    },
  });
}
