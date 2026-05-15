import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  InvoiceLineType,
  MediaType,
  Prisma,
  UserRole,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
import { makeManagerActor } from "../fixtures/actor";

type Db = typeof import("../../src/lib/db")["db"];

interface PackageFixture {
  silverPackageId: string;
  goldPackageId: string;
}

interface OrderFixture {
  orderId: string;
  packages: PackageFixture;
}

export async function runInvoiceMathInvariantTest(): Promise<void> {
  const [
    { db },
    {
      closeInvoice,
      createInvoiceForOrderWithClient,
      syncOrderInvoiceForFinancialEdit,
    },
  ] = await Promise.all([
    import("../../src/lib/db"),
    import("../../src/modules/invoices/invoice.service"),
  ]);
  const manager = await db.user.create({
    data: {
      id: "backend-invariants-invoice-math-manager",
      name: "Backend Invariants Manager",
      email: "backend-invariants-invoice-math@example.com",
      role: UserRole.MANAGER,
    },
  });
  const managerActor = makeManagerActor({ actorUserId: manager.id });

  try {
    const nonUpgraded = await createOrderFixture(db, {
      label: "non-upgraded",
      lines: [{ packageKind: "silver", originalPrice: 60, finalPrice: 60 }],
    });
    await assertComputedInvoiceReconciles(db, managerActor, nonUpgraded.orderId, {
      expectedTotal: 60,
      expectedPackageLines: ["Backend Silver"],
    });

    const upgraded = await createOrderFixture(db, {
      label: "upgraded",
      lines: [{ packageKind: "gold", originalPrice: 60, finalPrice: 90 }],
    });
    await assertComputedInvoiceReconciles(db, managerActor, upgraded.orderId, {
      expectedTotal: 90,
      expectedPackageLines: ["Backend Gold"],
    });

    const mixed = await createOrderFixture(db, {
      label: "mixed",
      lines: [
        { packageKind: "gold", originalPrice: 60, finalPrice: 90 },
        { packageKind: "silver", originalPrice: 60, finalPrice: 60 },
      ],
    });
    const mixedInvoiceId = await assertComputedInvoiceReconciles(
      db,
      managerActor,
      mixed.orderId,
      {
        expectedTotal: 150,
        expectedPackageLines: ["Backend Gold", "Backend Silver"],
      }
    );
    await closeInvoice(mixedInvoiceId, managerActor);
    await assertSnapshottedInvoiceReconciles(db, mixedInvoiceId);

    const upgradeThroughService = await createOrderFixture(db, {
      label: "service-upgrade",
      lines: [{ packageKind: "silver", originalPrice: 60, finalPrice: 60 }],
    });
    await createInvoiceForOrderWithClient(db, upgradeThroughService.orderId, managerActor);

    const orderPackageId = await findFirstOrderPackageId(
      db,
      upgradeThroughService.orderId
    );
    await db.orderPackage.update({
      where: { id: orderPackageId },
      data: {
        packageId: upgradeThroughService.packages.goldPackageId,
        finalPackagePriceSnapshot: new Prisma.Decimal(90),
      },
    });

    const upgradedLine = await db.orderPackage.findFirstOrThrow({
      where: { orderId: upgradeThroughService.orderId },
      select: {
        originalPackagePriceSnapshot: true,
        finalPackagePriceSnapshot: true,
      },
    });
    assert.equal(upgradedLine.originalPackagePriceSnapshot?.toNumber(), 60);
    assert.equal(upgradedLine.finalPackagePriceSnapshot?.toNumber(), 90);

    const syncSummary = await db.$transaction(async (tx) =>
      syncOrderInvoiceForFinancialEdit(tx, {
        orderId: upgradeThroughService.orderId,
        actorContext: managerActor,
        previousAddOns: [],
      })
    );
    assert.equal(syncSummary.packageAdjustmentAmount.toNumber(), 30);
  } finally {
    await db.$disconnect();
  }
}

async function createOrderFixture(
  db: Db,
  input: {
    label: string;
    lines: Array<{
      packageKind: "silver" | "gold";
      originalPrice: number;
      finalPrice: number;
    }>;
  }
): Promise<OrderFixture> {
  const fixtureId = randomUUID().replace(/-/g, "").slice(0, 10);
  const department = await db.studioDepartment.create({
    data: {
      code: `INV_${fixtureId}`,
      name: `Invoice Test ${input.label}`,
      isActive: true,
      sortOrder: 1,
    },
  });
  const sessionType = await db.sessionType.create({
    data: {
      code: `INV_SESSION_${fixtureId}`,
      name: `Invoice Test Session ${input.label}`,
      departmentId: department.id,
      isActive: true,
      sortOrder: 1,
    },
  });
  await db.sessionTypeExtraPhotoPricing.createMany({
    data: [
      {
        sessionTypeId: sessionType.id,
        mediaType: MediaType.DIGITAL,
        unitPrice: new Prisma.Decimal(5),
      },
      {
        sessionTypeId: sessionType.id,
        mediaType: MediaType.PRINT,
        unitPrice: new Prisma.Decimal(7),
      },
    ],
  });
  const packageFamily = await db.packageFamily.create({
    data: {
      code: `INV_FAMILY_${fixtureId}`,
      name: `Invoice Test Packages ${input.label}`,
      sessionTypeId: sessionType.id,
      isActive: true,
      sortOrder: 1,
    },
  });
  const silverPackage = await db.package.create({
    data: {
      name: "Backend Silver",
      packageFamilyId: packageFamily.id,
      price: new Prisma.Decimal(60),
      photoCount: 10,
      durationMinutes: 45,
      isActive: true,
    },
  });
  const goldPackage = await db.package.create({
    data: {
      name: "Backend Gold",
      packageFamilyId: packageFamily.id,
      price: new Prisma.Decimal(90),
      photoCount: 15,
      durationMinutes: 60,
      isActive: true,
    },
  });
  const customer = await db.customer.create({
    data: {
      name: `Invoice Test Customer ${fixtureId}`,
      phone: `+965${fixtureId.slice(0, 8)}`,
    },
  });
  const jobNumber = `JOB-INV-${fixtureId}`;
  const job = await db.job.create({
    data: {
      jobNumber,
      customerId: customer.id,
    },
  });
  const booking = await db.booking.create({
    data: {
      publicId: `BK-INV-${fixtureId}`,
      jobNumber,
      jobId: job.id,
      customerId: customer.id,
      sessionDate: new Date("2026-05-14T09:00:00.000Z"),
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
      publicId: `ORD-INV-${fixtureId}`,
      jobNumber,
      jobId: job.id,
      bookingId: booking.id,
      customerId: customer.id,
    },
  });

  await db.orderPackage.createMany({
    data: input.lines.map((line, index) => ({
      orderId: order.id,
      packageId:
        line.packageKind === "silver" ? silverPackage.id : goldPackage.id,
      sessionTypeId: sessionType.id,
      originalPackagePriceSnapshot: new Prisma.Decimal(line.originalPrice),
      finalPackagePriceSnapshot: new Prisma.Decimal(line.finalPrice),
      selectedPhotoCount: line.packageKind === "silver" ? 10 : 15,
      sortOrder: index,
    })),
  });

  return {
    orderId: order.id,
    packages: {
      silverPackageId: silverPackage.id,
      goldPackageId: goldPackage.id,
    },
  };
}

async function assertComputedInvoiceReconciles(
  db: Db,
  actorContext: ActorContext,
  orderId: string,
  input: {
    expectedTotal: number;
    expectedPackageLines: string[];
  }
): Promise<string> {
  const { createInvoiceForOrderWithClient, getInvoiceWithLineItems } =
    await import("../../src/modules/invoices/invoice.service");
  const invoice = await createInvoiceForOrderWithClient(
    db,
    orderId,
    actorContext
  );
  const invoiceDetail = await getInvoiceWithLineItems(invoice.id);

  assert.ok(invoiceDetail, "expected invoice detail to be available");
  assert.equal(parseMoney(invoiceDetail.totalAmount), input.expectedTotal);
  assert.equal(invoiceDetail.lineItemsAreComputed, true);
  assert.equal(
    invoiceDetail.lineItems.some(
      (line) => line.lineType === InvoiceLineType.PACKAGE_UPGRADE
    ),
    false
  );
  assert.deepEqual(
    invoiceDetail.lineItems
      .filter((line) => line.lineType === InvoiceLineType.PACKAGE_BASE)
      .map((line) => line.description),
    input.expectedPackageLines
  );
  assert.equal(sumFormattedLineTotals(invoiceDetail.lineItems), input.expectedTotal);

  return invoice.id;
}

async function assertSnapshottedInvoiceReconciles(
  db: Db,
  invoiceId: string
): Promise<void> {
  const invoice = await db.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      totalAmount: true,
      isLocked: true,
      lineItems: {
        select: { lineType: true, lineTotal: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  assert.equal(invoice.isLocked, true);
  assert.equal(
    invoice.lineItems.some(
      (line) => line.lineType === InvoiceLineType.PACKAGE_UPGRADE
    ),
    false
  );
  assert.equal(
    sumDecimals(invoice.lineItems.map((line) => line.lineTotal)).toNumber(),
    invoice.totalAmount.toNumber()
  );
}

async function findFirstOrderPackageId(db: Db, orderId: string): Promise<string> {
  const line = await db.orderPackage.findFirstOrThrow({
    where: { orderId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  return line.id;
}

function sumFormattedLineTotals(
  lines: Array<{ lineTotal: string }>
): number {
  return lines.reduce((sum, line) => sum + parseMoney(line.lineTotal), 0);
}

function parseMoney(value: string): number {
  return Number(value.replace(" KD", ""));
}

function sumDecimals(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce(
    (sum, value) => sum.plus(value),
    new Prisma.Decimal(0)
  );
}
