import {
  InvoiceStatus,
  InvoiceType,
  MediaType,
  OrderDeliveryStatus,
  OrderEditingStatus,
  OrderProductionSectionStatus,
  OrderProductionStatus,
  OrderSelectionStatus,
  OrderStatus,
  PaymentMethod,
  PaymentType,
  Prisma,
  ProductCategory,
  UserRole,
  type PrismaClient,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
import { createBookingInDb, checkInBooking, recordBookingDeposit } from "@/modules/bookings/booking.service";
import { createInvoiceForOrder, issueInvoice } from "@/modules/invoices/invoice.service";
import { recordPayment } from "@/modules/payments/payment.service";

const PREFIX = "phase-b-77";

export type PhaseBFixtures = {
  adminId: string;
  managerId: string;
  photographerId: string;
  editorId: string;
  departmentId: string;
  sessionTypeId: string;
  basePackageId: string;
  upgradePackageId: string;
  addOnProductId: string;
  zeroPriceAddOnProductId: string;
  adminActor: ActorContext;
  managerActor: ActorContext;
};

export type CheckedInWorkflow = {
  bookingId: string;
  orderId: string;
  financialCaseId: string;
  depositInvoiceId: string;
};

export type FinalInvoiceWorkflow = CheckedInWorkflow & {
  finalInvoiceId: string;
};

export async function seedPhaseBFixtures(db: PrismaClient): Promise<PhaseBFixtures> {
  const [admin, manager, photographer, editor] = await Promise.all([
    db.user.create({
      data: {
        id: `${PREFIX}-admin`,
        name: "Phase B Admin",
        email: "phase-b-admin@example.com",
        role: UserRole.ADMIN,
      },
    }),
    db.user.create({
      data: {
        id: `${PREFIX}-manager`,
        name: "Phase B Manager",
        email: "phase-b-manager@example.com",
        role: UserRole.MANAGER,
      },
    }),
    db.user.create({
      data: {
        id: `${PREFIX}-photographer`,
        name: "Phase B Photographer",
        email: "phase-b-photographer@example.com",
        role: UserRole.PHOTOGRAPHER,
      },
    }),
    db.user.create({
      data: {
        id: `${PREFIX}-editor`,
        name: "Phase B Editor",
        email: "phase-b-editor@example.com",
        role: UserRole.EDITOR,
      },
    }),
  ]);

  const department = await db.studioDepartment.create({
    data: {
      id: `${PREFIX}-department`,
      code: "PHASE_B",
      name: "Phase B Department",
      sortOrder: 78,
    },
  });

  const sessionType = await db.sessionType.create({
    data: {
      id: `${PREFIX}-session-type`,
      code: "PHASE_B_SESSION",
      name: "Phase B Session",
      departmentId: department.id,
    },
  });

  await db.sessionTypeExtraPhotoPricing.createMany({
    data: [
      {
        id: `${PREFIX}-extra-digital`,
        sessionTypeId: sessionType.id,
        mediaType: MediaType.DIGITAL,
        unitPrice: new Prisma.Decimal(5),
      },
      {
        id: `${PREFIX}-extra-print`,
        sessionTypeId: sessionType.id,
        mediaType: MediaType.PRINT,
        unitPrice: new Prisma.Decimal(6),
      },
    ],
  });

  const family = await db.packageFamily.create({
    data: {
      id: `${PREFIX}-family`,
      code: "PHASE_B_FAMILY",
      name: "Phase B Family",
      sessionTypeId: sessionType.id,
    },
  });

  const includedProduct = await db.product.create({
    data: {
      id: `${PREFIX}-included-product`,
      name: "Phase B Included Product",
      category: ProductCategory.DIGITAL,
      canonicalPrice: new Prisma.Decimal(40),
      isPackageDeliverable: true,
    },
  });

  const [basePackage, upgradePackage, addOnProduct, zeroPriceAddOnProduct] =
    await Promise.all([
      db.package.create({
        data: {
          id: `${PREFIX}-base-package`,
          name: "Phase B Base Package",
          price: new Prisma.Decimal(500),
          photoCount: 10,
          durationMinutes: 60,
          packageFamilyId: family.id,
        },
      }),
      db.package.create({
        data: {
          id: `${PREFIX}-upgrade-package`,
          name: "Phase B Upgrade Package",
          price: new Prisma.Decimal(600),
          photoCount: 15,
          durationMinutes: 75,
          packageFamilyId: family.id,
        },
      }),
      db.product.create({
        data: {
          id: `${PREFIX}-addon-product`,
          name: "Phase B Add-on",
          category: ProductCategory.OTHER,
          canonicalPrice: new Prisma.Decimal(50),
          isAddOn: true,
        },
      }),
      db.product.create({
        data: {
          id: `${PREFIX}-zero-addon-product`,
          name: "Phase B Zero Add-on",
          category: ProductCategory.OTHER,
          canonicalPrice: new Prisma.Decimal(0),
          isAddOn: true,
        },
      }),
    ]);

  await db.packageItem.create({
    data: {
      id: `${PREFIX}-base-package-item`,
      packageId: basePackage.id,
      productId: includedProduct.id,
      quantity: 1,
      priceSnapshot: new Prisma.Decimal(40),
    },
  });

  return {
    adminId: admin.id,
    managerId: manager.id,
    photographerId: photographer.id,
    editorId: editor.id,
    departmentId: department.id,
    sessionTypeId: sessionType.id,
    basePackageId: basePackage.id,
    upgradePackageId: upgradePackage.id,
    addOnProductId: addOnProduct.id,
    zeroPriceAddOnProductId: zeroPriceAddOnProduct.id,
    adminActor: { actorUserId: admin.id, actorRole: UserRole.ADMIN },
    managerActor: { actorUserId: manager.id, actorRole: UserRole.MANAGER },
  };
}

export async function buildPendingBookingFixture(
  fixtures: PhaseBFixtures,
  suffix: string
): Promise<{ bookingId: string }> {
  const day = 1 + (Math.abs(hashSuffix(suffix)) % 25);
  const phoneDigits = String(hashSuffix(suffix) % 1_000_000).padStart(6, "0");
  const booking = await createBookingInDb({
    phone: `+96578${phoneDigits}`,
    customerName: `Phase B ${suffix}`,
    packages: [
      {
        packageId: fixtures.basePackageId,
        quantity: 1,
        sortOrder: 0,
      },
    ],
    sessionDate: new Date(`2026-06-${String(day).padStart(2, "0")}T08:00:00.000Z`),
    sessionTime: "10:00",
    departmentId: fixtures.departmentId,
    themes: [],
  });

  return { bookingId: booking.id };
}

export async function buildConfirmedBookingFixture(
  db: PrismaClient,
  fixtures: PhaseBFixtures,
  suffix: string
): Promise<{ bookingId: string; financialCaseId: string; depositInvoiceId: string }> {
  const pending = await buildPendingBookingFixture(fixtures, suffix);

  await recordBookingDeposit(
    {
      bookingId: pending.bookingId,
      amount: 20,
      method: PaymentMethod.CASH,
      reference: `phase-b-${suffix}`,
    },
    fixtures.adminActor
  );

  const booking = await db.booking.findUniqueOrThrow({
    where: { id: pending.bookingId },
    select: {
      financialCase: { select: { id: true } },
      invoices: {
        where: { invoiceType: InvoiceType.DEPOSIT },
        select: { id: true },
        take: 1,
      },
    },
  });

  return {
    bookingId: pending.bookingId,
    financialCaseId: booking.financialCase?.id ?? fail("missing financial case"),
    depositInvoiceId: booking.invoices[0]?.id ?? fail("missing deposit invoice"),
  };
}

export async function buildCheckedInWorkflowFixture(
  db: PrismaClient,
  fixtures: PhaseBFixtures,
  suffix: string
): Promise<CheckedInWorkflow> {
  const confirmed = await buildConfirmedBookingFixture(db, fixtures, suffix);

  const checkedIn = await checkInBooking(
    {
      bookingId: confirmed.bookingId,
      assignedPhotographerId: fixtures.photographerId,
      socialMediaConsent: true,
    },
    fixtures.adminActor
  );

  return {
    ...confirmed,
    orderId: checkedIn.orderId,
  };
}

export async function buildFinalInvoiceWorkflowFixture(
  db: PrismaClient,
  fixtures: PhaseBFixtures,
  suffix: string,
  options: {
    issue?: boolean;
    finalPaymentAmounts?: number[];
    preInvoiceAddOnQuantity?: number;
  } = {}
): Promise<FinalInvoiceWorkflow> {
  const workflow = await buildCheckedInWorkflowFixture(db, fixtures, suffix);

  if (options.preInvoiceAddOnQuantity) {
    const orderPackage = await db.orderPackage.findFirstOrThrow({
      where: { orderId: workflow.orderId },
      select: { id: true },
    });
    await db.orderAddOn.create({
      data: {
        orderId: workflow.orderId,
        orderPackageId: orderPackage.id,
        productId: fixtures.addOnProductId,
        nameSnapshot: "Phase B Pre-Invoice Add-on",
        priceSnapshot: new Prisma.Decimal(50),
        quantity: options.preInvoiceAddOnQuantity,
      },
    });
  }

  const createdInvoice = await createInvoiceForOrder(
    workflow.orderId,
    fixtures.adminActor
  );

  if (options.issue) {
    await issueInvoice(createdInvoice.id, fixtures.adminActor);
  }

  for (const amount of options.finalPaymentAmounts ?? []) {
    await recordPayment(
      createdInvoice.id,
      {
        amount,
        method: PaymentMethod.CASH,
        paymentType: PaymentType.FINAL,
      },
      fixtures.adminActor
    );
  }

  return {
    ...workflow,
    finalInvoiceId: createdInvoice.id,
  };
}

export async function buildLockedFinalInvoiceWorkflowFixture(
  db: PrismaClient,
  fixtures: PhaseBFixtures,
  suffix: string
): Promise<FinalInvoiceWorkflow> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, suffix, {
    issue: true,
    finalPaymentAmounts: [480],
  });

  const finalInvoice = await db.invoice.findUniqueOrThrow({
    where: { id: workflow.finalInvoiceId },
    select: { status: true, isLocked: true },
  });
  if (finalInvoice.status !== InvoiceStatus.CLOSED || !finalInvoice.isLocked) {
    fail("final invoice fixture did not close");
  }

  return workflow;
}

export async function makeOrderReadyForDelivery(
  db: PrismaClient,
  orderId: string
): Promise<void> {
  await db.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.READY,
      selectionStatus: OrderSelectionStatus.COMPLETED,
      deliveryStatus: OrderDeliveryStatus.READY_FOR_PICKUP,
    },
  });
  await db.editingJob.update({
    where: { orderId },
    data: { status: OrderEditingStatus.COMPLETED },
  });
  await db.productionJob.update({
    where: { orderId },
    data: {
      status: OrderProductionStatus.READY_FOR_PICKUP,
      albumDesignStatus: OrderProductionSectionStatus.COMPLETED,
      printingStatus: OrderProductionSectionStatus.COMPLETED,
      assemblyStatus: OrderProductionSectionStatus.COMPLETED,
      vendorStatus: OrderProductionSectionStatus.COMPLETED,
      framedPrintsStatus: OrderProductionSectionStatus.COMPLETED,
      finalStatus: OrderProductionSectionStatus.COMPLETED,
      readyForPickupAt: new Date(),
    },
  });
}

export async function getBookingFinancialSnapshot(
  db: PrismaClient,
  bookingId: string
) {
  return db.booking.findUnique({
    where: { id: bookingId },
    select: {
      publicId: true,
      status: true,
      jobId: true,
      jobNumber: true,
      financialCase: { select: { id: true, jobId: true } },
      invoices: {
        select: {
          id: true,
          invoiceType: true,
          status: true,
          isLocked: true,
          totalAmount: true,
          paidAmount: true,
          remainingAmount: true,
        },
        orderBy: { createdAt: "asc" },
      },
      order: { select: { id: true } },
    },
  });
}

function hashSuffix(value: string): number {
  return Array.from(value).reduce(
    (sum, char, index) => sum + char.charCodeAt(0) * (index + 17),
    0
  );
}

function fail(message: string): never {
  throw new Error(message);
}
