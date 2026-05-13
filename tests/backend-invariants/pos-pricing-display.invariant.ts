import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { MediaType, Prisma } from "@prisma/client";

type Db = typeof import("../../src/lib/db")["db"];

export async function runPOSPricingDisplayInvariantTest(): Promise<void> {
  allowServerOnlyImportsInNodeInvariantRunner();
  const [{ db }, { getPOSWorkspace }] = await Promise.all([
    import("../../src/lib/db"),
    import("../../src/modules/orders/order.service"),
  ]);

  try {
    const orderId = await createMixedSessionPOSFixture(db);
    const workspace = await getPOSWorkspace(orderId);

    assert.ok(workspace, "expected POS workspace to be available");
    assert.equal(
      Object.hasOwn(
        workspace as unknown as Record<string, unknown>,
        "extraPhotoUnitPrice"
      ),
      false
    );
    assert.equal(workspace.packageLines.length, 2);
    assert.deepEqual(
      workspace.packageLines.map((line) => ({
        name: line.sessionTypeName,
        digital: line.extraDigitalUnitPrice,
        print: line.extraPrintUnitPrice,
        total: line.extraPhotoTotal,
      })),
      [
        { name: "POS Pricing Session A", digital: 5, print: 7, total: 17 },
        { name: "POS Pricing Session B", digital: 9, print: 11, total: 31 },
      ]
    );
    const displayedPackageTotal = workspace.packageLines.reduce(
      (sum, line) => sum + line.currentPackage.price,
      0
    );
    const subtotalIncludingExtras = workspace.packageLines.reduce(
      (sum, line) => sum + line.packageSubtotal,
      0
    );

    assert.equal(displayedPackageTotal, 140);
    assert.notEqual(displayedPackageTotal, subtotalIncludingExtras);
    assert.equal(
      workspace.extraPhotoTotal,
      workspace.packageLines.reduce((sum, line) => sum + line.extraPhotoTotal, 0)
    );
  } finally {
    await db.$disconnect();
  }
}

async function createMixedSessionPOSFixture(db: Db): Promise<string> {
  const fixtureId = randomUUID().replace(/-/g, "").slice(0, 10);
  const department = await db.studioDepartment.create({
    data: {
      code: `POS_${fixtureId}`,
      name: "POS Pricing Test",
      isActive: true,
      sortOrder: 1,
    },
  });
  const [firstSessionType, secondSessionType] = await Promise.all([
    db.sessionType.create({
      data: {
        code: `POS_A_${fixtureId}`,
        name: "POS Pricing Session A",
        departmentId: department.id,
        isActive: true,
        sortOrder: 1,
      },
    }),
    db.sessionType.create({
      data: {
        code: `POS_B_${fixtureId}`,
        name: "POS Pricing Session B",
        departmentId: department.id,
        isActive: true,
        sortOrder: 2,
      },
    }),
  ]);
  await db.sessionTypeExtraPhotoPricing.createMany({
    data: [
      {
        sessionTypeId: firstSessionType.id,
        mediaType: MediaType.DIGITAL,
        unitPrice: new Prisma.Decimal(5),
      },
      {
        sessionTypeId: firstSessionType.id,
        mediaType: MediaType.PRINT,
        unitPrice: new Prisma.Decimal(7),
      },
      {
        sessionTypeId: secondSessionType.id,
        mediaType: MediaType.DIGITAL,
        unitPrice: new Prisma.Decimal(9),
      },
      {
        sessionTypeId: secondSessionType.id,
        mediaType: MediaType.PRINT,
        unitPrice: new Prisma.Decimal(11),
      },
    ],
  });
  const [firstFamily, secondFamily] = await Promise.all([
    db.packageFamily.create({
      data: {
        code: `POS_FAMILY_A_${fixtureId}`,
        name: "POS Pricing Family A",
        sessionTypeId: firstSessionType.id,
        isActive: true,
        sortOrder: 1,
      },
    }),
    db.packageFamily.create({
      data: {
        code: `POS_FAMILY_B_${fixtureId}`,
        name: "POS Pricing Family B",
        sessionTypeId: secondSessionType.id,
        isActive: true,
        sortOrder: 2,
      },
    }),
  ]);
  const [firstPackage, secondPackage] = await Promise.all([
    db.package.create({
      data: {
        name: "POS Pricing Package A",
        packageFamilyId: firstFamily.id,
        price: new Prisma.Decimal(60),
        photoCount: 10,
        durationMinutes: 45,
        isActive: true,
      },
    }),
    db.package.create({
      data: {
        name: "POS Pricing Package B",
        packageFamilyId: secondFamily.id,
        price: new Prisma.Decimal(80),
        photoCount: 12,
        durationMinutes: 60,
        isActive: true,
      },
    }),
  ]);
  const customer = await db.customer.create({
    data: {
      name: `POS Pricing Customer ${fixtureId}`,
      phone: `+9657${fixtureId.slice(0, 7)}`,
    },
  });
  const jobNumber = `JOB-POS-${fixtureId}`;
  const job = await db.job.create({
    data: {
      jobNumber,
      customerId: customer.id,
    },
  });
  const booking = await db.booking.create({
    data: {
      publicId: `BK-POS-${fixtureId}`,
      jobNumber,
      jobId: job.id,
      customerId: customer.id,
      sessionDate: new Date("2026-05-14T11:00:00.000Z"),
      sessionTime: "11:00",
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
      publicId: `ORD-POS-${fixtureId}`,
      jobNumber,
      jobId: job.id,
      bookingId: booking.id,
      customerId: customer.id,
    },
  });

  await db.orderPackage.createMany({
    data: [
      {
        orderId: order.id,
        packageId: firstPackage.id,
        sessionTypeId: firstSessionType.id,
        originalPackagePriceSnapshot: firstPackage.price,
        finalPackagePriceSnapshot: firstPackage.price,
        selectedPhotoCount: 13,
        extraDigitalCount: 2,
        extraPrintCount: 1,
        sortOrder: 0,
      },
      {
        orderId: order.id,
        packageId: secondPackage.id,
        sessionTypeId: secondSessionType.id,
        originalPackagePriceSnapshot: secondPackage.price,
        finalPackagePriceSnapshot: secondPackage.price,
        selectedPhotoCount: 15,
        extraDigitalCount: 1,
        extraPrintCount: 2,
        sortOrder: 1,
      },
    ],
  });

  return order.id;
}

function allowServerOnlyImportsInNodeInvariantRunner(): void {
  const require = createRequire(import.meta.url);
  const serverOnlyPath = require.resolve("server-only");
  const cache = require.cache as unknown as Record<
    string,
    | {
        id: string;
        filename: string;
        loaded: boolean;
        exports: Record<string, never>;
      }
    | undefined
  >;
  const cacheEntry = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  };

  cache[serverOnlyPath] = cacheEntry;
}
