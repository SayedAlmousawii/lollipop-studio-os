import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test, { after } from "node:test";
import {
  InvoiceLineType,
  MediaType,
  Prisma,
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

const managerActor = { id: "pricing-manager", role: UserRole.MANAGER };
const receptionistActor = {
  id: "pricing-receptionist",
  role: UserRole.RECEPTIONIST,
};

test("extra-photo pricing service", async (t) => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const { db } = await import("@/lib/db");
      const {
        ExtraPhotoPricingNotFoundError,
        listExtraPhotoPricing,
        updateExtraPhotoPricing,
      } = await import("@/modules/pricing/extra-photo-pricing.service");
      const {
        createInvoiceForOrderWithClient,
        getInvoiceWithLineItems,
        snapshotInvoiceLineItemsWithClient,
      } = await import("@/modules/invoices/invoice.service");

      await t.test("lists active session types only", async () => {
        const { activeSessionTypeId, archivedSessionTypeId } =
          await createPricingFixture(db, "LIST");

        const rows = await listExtraPhotoPricing();
        assert.equal(
          rows.some((row) => row.sessionTypeId === activeSessionTypeId),
          true
        );
        assert.equal(
          rows.some((row) => row.sessionTypeId === archivedSessionTypeId),
          false
        );
      });

      await t.test("rejects invalid update prices", async () => {
        const { activeSessionTypeId } = await createPricingFixture(db, "VALID");

        await assert.rejects(
          () =>
            updateExtraPhotoPricing(
              activeSessionTypeId,
              {
                digitalUnitPrice: "-1.000",
                printUnitPrice: "1.000",
              } as never,
              managerActor
            ),
          /Use a valid non-negative price/
        );
        await assert.rejects(
          () =>
            updateExtraPhotoPricing(
              activeSessionTypeId,
              {
                digitalUnitPrice: "1.0000",
                printUnitPrice: "1.000",
              } as never,
              managerActor
            ),
          /up to 3 decimals/
        );
        await assert.rejects(
          () =>
            updateExtraPhotoPricing(
              activeSessionTypeId,
              {
                digitalUnitPrice: "1.000",
                printUnitPrice: "not-a-price",
              } as never,
              managerActor
            ),
          /valid non-negative price/
        );
      });

      await t.test("rejects unauthorized actors", async () => {
        const { activeSessionTypeId } = await createPricingFixture(db, "AUTH");

        await assert.rejects(
          () =>
            updateExtraPhotoPricing(
              activeSessionTypeId,
              {
                digitalUnitPrice: "1.000",
                printUnitPrice: "1.000",
              } as never,
              receptionistActor
            ),
          assertUnauthorizedError
        );
      });

      await t.test("persists valid paired prices", async () => {
        const { activeSessionTypeId } = await createPricingFixture(db, "SAVE");

        await updateExtraPhotoPricing(
          activeSessionTypeId,
          {
            digitalUnitPrice: "0",
            printUnitPrice: "9999999.999",
          } as never,
          managerActor
        );
        assert.deepEqual(await readPricing(db, activeSessionTypeId), {
          DIGITAL: "0.000",
          PRINT: "9999999.999",
        });
      });

      await t.test("uses updated prices for later invoices only", async () => {
        const fixture = await createInvoicePricingFixture(db, "INV");
        const firstOrderId = await createOrderFixture(db, fixture, "first");
        const firstInvoice = await db.$transaction((tx) =>
          createInvoiceForOrderWithClient(tx, firstOrderId, {
            actorUserId: fixture.managerUserId,
            actorRole: UserRole.MANAGER,
          })
        );
        await db.$transaction((tx) =>
          snapshotInvoiceLineItemsWithClient(tx, firstInvoice.id, firstOrderId)
        );

        await updateExtraPhotoPricing(
          fixture.sessionTypeId,
          {
            digitalUnitPrice: "6.000",
            printUnitPrice: "8.000",
          } as never,
          managerActor
        );

        const storedFirstInvoice = await getInvoiceWithLineItems(firstInvoice.id);
        assert.equal(storedFirstInvoice?.totalAmount, "77.000 KD");
        assert.deepEqual(
          storedFirstInvoice?.lineItems
            .filter((line) => line.lineType === InvoiceLineType.EXTRA_PHOTOS)
            .map((line) => line.lineTotal),
          ["10.000 KD", "7.000 KD"]
        );

        const secondOrderId = await createOrderFixture(db, fixture, "second");
        const secondInvoice = await db.$transaction((tx) =>
          createInvoiceForOrderWithClient(tx, secondOrderId, {
            actorUserId: fixture.managerUserId,
            actorRole: UserRole.MANAGER,
          })
        );
        const storedSecondInvoice =
          await getInvoiceWithLineItems(secondInvoice.id);
        assert.equal(storedSecondInvoice?.totalAmount, "80.000 KD");
        assert.deepEqual(
          storedSecondInvoice?.lineItems
            .filter((line) => line.lineType === InvoiceLineType.EXTRA_PHOTOS)
            .map((line) => line.lineTotal),
          ["12.000 KD", "8.000 KD"]
        );
      });

      await t.test("rejects missing pricing rows without partial updates", async () => {
        const { activeSessionTypeId } = await createPricingFixture(db, "MISS");
        await updateExtraPhotoPricing(
          activeSessionTypeId,
          {
            digitalUnitPrice: "0",
            printUnitPrice: "9999999.999",
          } as never,
          managerActor
        );
        await db.sessionTypeExtraPhotoPricing.delete({
          where: {
            sessionTypeId_mediaType: {
              sessionTypeId: activeSessionTypeId,
              mediaType: MediaType.PRINT,
            },
          },
        });

        await assert.rejects(
          () =>
            updateExtraPhotoPricing(
              activeSessionTypeId,
              {
                digitalUnitPrice: "2.000",
                printUnitPrice: "3.000",
              } as never,
              managerActor
            ),
          ExtraPhotoPricingNotFoundError
        );
        assert.equal(
          (await readPricing(db, activeSessionTypeId)).DIGITAL,
          "0.000"
        );
      });
    } finally {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });
});

function assertUnauthorizedError(error: unknown): boolean {
  assert.ok(error instanceof Error);
  assert.equal(
    error.message,
    "`unauthorized()` is experimental and only allowed to be used when `experimental.authInterrupts` is enabled."
  );
  return true;
}

async function createPricingFixture(
  db: typeof import("@/lib/db")["db"],
  suffix: string
) {
  const department = await db.studioDepartment.create({
    data: {
      code: `PR_${suffix}`,
      name: `Pricing ${suffix}`,
      isActive: true,
      sortOrder: 10,
    },
  });
  const activeSessionType = await db.sessionType.create({
    data: {
      code: `PR_ACTIVE_${suffix}`,
      name: `Active Pricing ${suffix}`,
      departmentId: department.id,
      calendarLabel: "Pricing",
      isActive: true,
      sortOrder: 10,
      extraPhotoPricing: {
        create: [
          { mediaType: MediaType.DIGITAL, unitPrice: new Prisma.Decimal(5) },
          { mediaType: MediaType.PRINT, unitPrice: new Prisma.Decimal(7) },
        ],
      },
    },
  });
  const archivedSessionType = await db.sessionType.create({
    data: {
      code: `PR_ARCHIVED_${suffix}`,
      name: `Archived Pricing ${suffix}`,
      departmentId: department.id,
      calendarLabel: "Pricing",
      isActive: false,
      sortOrder: 20,
      extraPhotoPricing: {
        create: [
          { mediaType: MediaType.DIGITAL, unitPrice: new Prisma.Decimal(9) },
          { mediaType: MediaType.PRINT, unitPrice: new Prisma.Decimal(11) },
        ],
      },
    },
  });

  return {
    activeSessionTypeId: activeSessionType.id,
    archivedSessionTypeId: archivedSessionType.id,
  };
}

async function readPricing(
  db: typeof import("@/lib/db")["db"],
  sessionTypeId: string
): Promise<Record<MediaType, string>> {
  const rows = await db.sessionTypeExtraPhotoPricing.findMany({
    where: { sessionTypeId },
    select: { mediaType: true, unitPrice: true },
  });
  return Object.fromEntries(
    rows.map((row) => [row.mediaType, row.unitPrice.toFixed(3)])
  ) as Record<MediaType, string>;
}

async function createInvoicePricingFixture(
  db: typeof import("@/lib/db")["db"],
  suffix: string
) {
  const manager = await db.user.create({
    data: {
      name: `Pricing Manager ${suffix}`,
      email: `pricing-manager-${suffix.toLowerCase()}@example.com`,
      role: UserRole.MANAGER,
    },
  });
  const department = await db.studioDepartment.create({
    data: {
      code: `IP_${suffix}`,
      name: `Invoice Pricing ${suffix}`,
      isActive: true,
      sortOrder: 10,
    },
  });
  const sessionType = await db.sessionType.create({
    data: {
      code: `IP_SESSION_${suffix}`,
      name: `Invoice Pricing Session ${suffix}`,
      departmentId: department.id,
      calendarLabel: "Invoice Pricing",
      isActive: true,
      sortOrder: 10,
      extraPhotoPricing: {
        create: [
          { mediaType: MediaType.DIGITAL, unitPrice: new Prisma.Decimal(5) },
          { mediaType: MediaType.PRINT, unitPrice: new Prisma.Decimal(7) },
        ],
      },
    },
  });
  const packageFamily = await db.packageFamily.create({
    data: {
      code: `IP_FAMILY_${suffix}`,
      name: `Invoice Pricing Packages ${suffix}`,
      sessionTypeId: sessionType.id,
      isActive: true,
      sortOrder: 10,
    },
  });
  const packageRow = await db.package.create({
    data: {
      name: "Invoice Pricing Package",
      packageFamilyId: packageFamily.id,
      price: new Prisma.Decimal(60),
      photoCount: 10,
      durationMinutes: 45,
      isActive: true,
    },
  });
  const customer = await db.customer.create({
    data: {
      name: "Invoice Pricing Customer",
      phone: "+96555123456",
    },
  });

  return {
    customerId: customer.id,
    departmentId: department.id,
    managerUserId: manager.id,
    packageId: packageRow.id,
    sessionTypeId: sessionType.id,
  };
}

async function createOrderFixture(
  db: typeof import("@/lib/db")["db"],
  fixture: {
    customerId: string;
    departmentId: string;
    packageId: string;
    sessionTypeId: string;
  },
  label: string
): Promise<string> {
  const jobNumber = `JOB-PRICING-${label.toUpperCase()}`;
  const job = await db.job.create({
    data: {
      jobNumber,
      customerId: fixture.customerId,
    },
  });
  const booking = await db.booking.create({
    data: {
      publicId: `BK-PRICING-${label.toUpperCase()}`,
      jobNumber,
      jobId: job.id,
      customerId: fixture.customerId,
      sessionDate: new Date("2026-05-14T09:00:00.000Z"),
      sessionTime: "09:00",
      departmentId: fixture.departmentId,
    },
  });
  await db.financialCase.create({
    data: {
      bookingId: booking.id,
      customerId: fixture.customerId,
      jobId: job.id,
    },
  });
  const order = await db.order.create({
    data: {
      publicId: `ORD-PRICING-${label.toUpperCase()}`,
      jobNumber,
      jobId: job.id,
      bookingId: booking.id,
      customerId: fixture.customerId,
    },
  });
  await db.orderPackage.create({
    data: {
      orderId: order.id,
      packageId: fixture.packageId,
      sessionTypeId: fixture.sessionTypeId,
      originalPackagePriceSnapshot: new Prisma.Decimal(60),
      finalPackagePriceSnapshot: new Prisma.Decimal(60),
      selectedPhotoCount: 13,
      extraDigitalCount: 2,
      extraPrintCount: 1,
      sortOrder: 10,
    },
  });

  return order.id;
}
