import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  Prisma,
} from "@prisma/client";

type Db = typeof import("../../src/lib/db")["db"];

interface SelectedPhotoFixture {
  orderId: string;
  firstOrderPackageId: string;
}

export async function runSelectedPhotoAggregateInvariantTest(): Promise<void> {
  const [
    { db },
    { getOrderTotalSelectedPhotoCount },
  ] = await Promise.all([
    import("../../src/lib/db"),
    import("../../src/modules/orders/order.utils"),
  ]);

  try {
    const fixture = await createSelectedPhotoFixture(db);
    const staleOrder = await db.order.findUniqueOrThrow({
      where: { id: fixture.orderId },
      select: { selectedPhotoCount: true },
    });
    assert.equal(staleOrder.selectedPhotoCount, 999);

    const initialLines = await findSelectedPhotoLines(db, fixture.orderId);
    assert.equal(getOrderTotalSelectedPhotoCount(initialLines), 27);

    await db.orderPackage.update({
      where: { id: fixture.firstOrderPackageId },
      data: { selectedPhotoCount: 14 },
    });
    const updatedLines = await findSelectedPhotoLines(db, fixture.orderId);
    const updatedAggregate = getOrderTotalSelectedPhotoCount(updatedLines);
    await db.order.update({
      where: { id: fixture.orderId },
      data: { selectedPhotoCount: updatedAggregate },
    });

    const syncedOrder = await db.order.findUniqueOrThrow({
      where: { id: fixture.orderId },
      select: { selectedPhotoCount: true },
    });
    assert.equal(syncedOrder.selectedPhotoCount, 29);
  } finally {
    await db.$disconnect();
  }
}

async function createSelectedPhotoFixture(
  db: Db
): Promise<SelectedPhotoFixture> {
  const fixtureId = randomUUID().replace(/-/g, "").slice(0, 10);
  const department = await db.studioDepartment.create({
    data: {
      code: `SPA_${fixtureId}`,
      name: "Selected Photo Aggregate Test",
      isActive: true,
      sortOrder: 1,
    },
  });
  const sessionType = await db.sessionType.create({
    data: {
      code: `SPA_SESSION_${fixtureId}`,
      name: "Selected Photo Session",
      departmentId: department.id,
      calendarLabel: "Selected Photo",
      isActive: true,
      sortOrder: 1,
    },
  });
  const packageFamily = await db.packageFamily.create({
    data: {
      code: `SPA_FAMILY_${fixtureId}`,
      name: "Selected Photo Packages",
      sessionTypeId: sessionType.id,
      isActive: true,
      sortOrder: 1,
    },
  });
  const firstPackage = await db.package.create({
    data: {
      name: "Selected Photo Silver",
      packageFamilyId: packageFamily.id,
      price: new Prisma.Decimal(60),
      photoCount: 10,
      durationMinutes: 45,
      isActive: true,
    },
  });
  const secondPackage = await db.package.create({
    data: {
      name: "Selected Photo Gold",
      packageFamilyId: packageFamily.id,
      price: new Prisma.Decimal(90),
      photoCount: 15,
      durationMinutes: 60,
      isActive: true,
    },
  });
  const customer = await db.customer.create({
    data: {
      name: `Selected Photo Customer ${fixtureId}`,
      phone: `+9655${fixtureId.slice(0, 7)}`,
    },
  });
  const jobNumber = `JOB-SPA-${fixtureId}`;
  const job = await db.job.create({
    data: {
      jobNumber,
      customerId: customer.id,
    },
  });
  const booking = await db.booking.create({
    data: {
      publicId: `BK-SPA-${fixtureId}`,
      jobNumber,
      jobId: job.id,
      customerId: customer.id,
      sessionDate: new Date("2026-05-14T10:00:00.000Z"),
      sessionTime: "10:00",
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
      publicId: `ORD-SPA-${fixtureId}`,
      jobNumber,
      jobId: job.id,
      bookingId: booking.id,
      customerId: customer.id,
      selectedPhotoCount: 999,
      editingJob: {
        create: {
          jobId: job.id,
        },
      },
      productionJob: {
        create: {
          jobId: job.id,
        },
      },
    },
  });
  const firstOrderPackage = await db.orderPackage.create({
    data: {
      orderId: order.id,
      packageId: firstPackage.id,
      sessionTypeId: sessionType.id,
      originalPackagePriceSnapshot: firstPackage.price,
      finalPackagePriceSnapshot: firstPackage.price,
      selectedPhotoCount: 12,
      sortOrder: 0,
    },
  });
  await db.orderPackage.create({
    data: {
      orderId: order.id,
      packageId: secondPackage.id,
      sessionTypeId: sessionType.id,
      originalPackagePriceSnapshot: secondPackage.price,
      finalPackagePriceSnapshot: secondPackage.price,
      selectedPhotoCount: null,
      sortOrder: 1,
    },
  });

  return {
    orderId: order.id,
    firstOrderPackageId: firstOrderPackage.id,
  };
}

function findSelectedPhotoLines(db: Db, orderId: string) {
  return db.orderPackage.findMany({
    where: { orderId },
    select: {
      selectedPhotoCount: true,
      package: { select: { photoCount: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}
