import {
  InvoiceStatus,
  InvoiceType,
  MediaType,
  PaymentMethod,
  PaymentType,
  Prisma,
  ProductCategory,
  UserRole,
  type PrismaClient,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
import {
  checkInBooking,
  createBookingInDb,
  recordBookingDeposit,
} from "@/modules/bookings/booking.service";
import { createInvoiceForOrder, issueInvoice } from "@/modules/invoices/invoice.service";
import { recordPayment } from "@/modules/payments/payment.service";

const PREFIX = "phase-f-77";

export type PhaseFFixtures = {
  adminId: string;
  managerId: string;
  receptionistId: string;
  accountantId: string;
  photographerId: string;
  editorId: string;
  departmentId: string;
  sessionTypeId: string;
  basePackageId: string;
  addOnProductId: string;
  secondAddOnProductId: string;
  adminActor: ActorContext;
  managerActor: ActorContext;
  receptionistActor: ActorContext;
  accountantActor: ActorContext;
  photographerActor: ActorContext;
  editorActor: ActorContext;
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

export async function seedPhaseFFixtures(db: PrismaClient): Promise<PhaseFFixtures> {
  const [admin, manager, receptionist, accountant, photographer, editor] =
    await Promise.all([
      db.user.create({
        data: {
          id: `${PREFIX}-admin`,
          name: "Phase F Admin",
          email: "phase-f-admin@example.com",
          role: UserRole.ADMIN,
        },
      }),
      db.user.create({
        data: {
          id: `${PREFIX}-manager`,
          name: "Phase F Manager",
          email: "phase-f-manager@example.com",
          role: UserRole.MANAGER,
        },
      }),
      db.user.create({
        data: {
          id: `${PREFIX}-receptionist`,
          name: "Phase F Receptionist",
          email: "phase-f-receptionist@example.com",
          role: UserRole.RECEPTIONIST,
        },
      }),
      db.user.create({
        data: {
          id: `${PREFIX}-accountant`,
          name: "Phase F Accountant",
          email: "phase-f-accountant@example.com",
          role: UserRole.ACCOUNTANT,
        },
      }),
      db.user.create({
        data: {
          id: `${PREFIX}-photographer`,
          name: "Phase F Photographer",
          email: "phase-f-photographer@example.com",
          role: UserRole.PHOTOGRAPHER,
        },
      }),
      db.user.create({
        data: {
          id: `${PREFIX}-editor`,
          name: "Phase F Editor",
          email: "phase-f-editor@example.com",
          role: UserRole.EDITOR,
        },
      }),
    ]);

  const department = await db.studioDepartment.create({
    data: {
      id: `${PREFIX}-department`,
      code: "PHASE_F",
      name: "Phase F Department",
      sortOrder: 90,
    },
  });

  const sessionType = await db.sessionType.create({
    data: {
      id: `${PREFIX}-session-type`,
      code: "PHASE_F_SESSION",
      name: "Phase F Session",
      departmentId: department.id,
      calendarLabel: "Phase F",
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
      code: "PHASE_F_FAMILY",
      name: "Phase F Family",
      sessionTypeId: sessionType.id,
    },
  });

  const [basePackage, addOnProduct, secondAddOnProduct] = await Promise.all([
    db.package.create({
      data: {
        id: `${PREFIX}-base-package`,
        name: "Phase F Base Package",
        price: new Prisma.Decimal(500),
        photoCount: 10,
        durationMinutes: 60,
        packageFamilyId: family.id,
      },
    }),
    db.product.create({
      data: {
        id: `${PREFIX}-addon-product`,
        name: "Phase F Add-on",
        category: ProductCategory.OTHER,
        canonicalPrice: new Prisma.Decimal(50),
        isAddOn: true,
      },
    }),
    db.product.create({
      data: {
        id: `${PREFIX}-second-addon-product`,
        name: "Phase F Second Add-on",
        category: ProductCategory.OTHER,
        canonicalPrice: new Prisma.Decimal(30),
        isAddOn: true,
      },
    }),
  ]);

  return {
    adminId: admin.id,
    managerId: manager.id,
    receptionistId: receptionist.id,
    accountantId: accountant.id,
    photographerId: photographer.id,
    editorId: editor.id,
    departmentId: department.id,
    sessionTypeId: sessionType.id,
    basePackageId: basePackage.id,
    addOnProductId: addOnProduct.id,
    secondAddOnProductId: secondAddOnProduct.id,
    adminActor: { actorUserId: admin.id, actorRole: UserRole.ADMIN },
    managerActor: { actorUserId: manager.id, actorRole: UserRole.MANAGER },
    receptionistActor: {
      actorUserId: receptionist.id,
      actorRole: UserRole.RECEPTIONIST,
    },
    accountantActor: { actorUserId: accountant.id, actorRole: UserRole.ACCOUNTANT },
    photographerActor: {
      actorUserId: photographer.id,
      actorRole: UserRole.PHOTOGRAPHER,
    },
    editorActor: { actorUserId: editor.id, actorRole: UserRole.EDITOR },
  };
}

export async function buildPendingBookingFixture(
  fixtures: PhaseFFixtures,
  suffix: string
): Promise<{ bookingId: string }> {
  const day = 1 + (Math.abs(hashSuffix(suffix)) % 25);
  const phoneDigits = String(hashSuffix(suffix) % 1_000_000).padStart(6, "0");
  const booking = await createBookingInDb({
    phone: `+96578${phoneDigits}`,
    customerName: `Phase F ${suffix}`,
    packages: [
      {
        packageId: fixtures.basePackageId,
        quantity: 1,
        sortOrder: 0,
      },
    ],
    sessionDate: new Date(`2026-08-${String(day).padStart(2, "0")}T08:00:00.000Z`),
    sessionTime: "10:00",
    departmentId: fixtures.departmentId,
    themes: [],
  });

  return { bookingId: booking.id };
}

export async function buildConfirmedBookingFixture(
  db: PrismaClient,
  fixtures: PhaseFFixtures,
  suffix: string
): Promise<{ bookingId: string; financialCaseId: string; depositInvoiceId: string }> {
  const pending = await buildPendingBookingFixture(fixtures, suffix);

  await recordBookingDeposit(
    {
      bookingId: pending.bookingId,
      amount: 20,
      method: PaymentMethod.CASH,
      reference: `phase-f-${suffix}`,
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
  fixtures: PhaseFFixtures,
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
  fixtures: PhaseFFixtures,
  suffix: string,
  options: {
    issue?: boolean;
    finalPaymentAmounts?: number[];
    preInvoiceAddOns?: Array<{
      productId: string;
      name: string;
      price: number;
      quantity: number;
    }>;
  } = {}
): Promise<FinalInvoiceWorkflow> {
  const workflow = await buildCheckedInWorkflowFixture(db, fixtures, suffix);

  for (const addOn of options.preInvoiceAddOns ?? []) {
    await db.orderAddOn.create({
      data: {
        orderId: workflow.orderId,
        productId: addOn.productId,
        nameSnapshot: addOn.name,
        priceSnapshot: new Prisma.Decimal(addOn.price),
        quantity: addOn.quantity,
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
  fixtures: PhaseFFixtures,
  suffix: string,
  options: Parameters<typeof buildFinalInvoiceWorkflowFixture>[3] = {}
): Promise<FinalInvoiceWorkflow> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, suffix, {
    ...options,
    issue: true,
    finalPaymentAmounts: options.finalPaymentAmounts ?? [
      await expectedRemainingAfterDeposit(db, fixtures, options),
    ],
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

export async function cleanupWorkflow(
  db: PrismaClient,
  workflow: { bookingId: string; orderId?: string; financialCaseId?: string }
): Promise<void> {
  await db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: workflow.bookingId },
      select: { jobId: true, financialCase: { select: { id: true } } },
    });
    const financialCaseId = workflow.financialCaseId ?? booking?.financialCase?.id;
    const orderId = workflow.orderId;
    const invoices = financialCaseId
      ? await tx.invoice.findMany({
          where: { financialCaseId },
          select: { id: true },
        })
      : [];
    const invoiceIds = invoices.map((invoice) => invoice.id);

    await tx.paymentAllocation.deleteMany({
      where: {
        OR: [
          { invoiceId: { in: invoiceIds } },
          ...(financialCaseId
            ? [{ payment: { financialCaseId } }]
            : []),
        ],
      },
    });
    await tx.documentApplication.deleteMany({
      where: {
        OR: [
          { sourceInvoiceId: { in: invoiceIds } },
          { targetInvoiceId: { in: invoiceIds } },
        ],
      },
    });
    if (financialCaseId) {
      await tx.payment.deleteMany({ where: { financialCaseId } });
    }
    await tx.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    if (financialCaseId) {
      await tx.invoice.deleteMany({ where: { financialCaseId } });
    }
    if (orderId) {
      await tx.orderActivity.deleteMany({ where: { orderId } });
      await tx.orderAddOn.deleteMany({ where: { orderId } });
      await tx.orderPackageItemUpgrade.deleteMany({ where: { orderId } });
      await tx.editingJob.deleteMany({ where: { orderId } });
      await tx.productionJob.deleteMany({ where: { orderId } });
      await tx.orderPackage.deleteMany({ where: { orderId } });
      await tx.order.deleteMany({ where: { id: orderId } });
    }
    if (financialCaseId) {
      await tx.financialCase.deleteMany({ where: { id: financialCaseId } });
    }
    await tx.bookingTheme.deleteMany({ where: { bookingId: workflow.bookingId } });
    await tx.bookingPackage.deleteMany({ where: { bookingId: workflow.bookingId } });
    await tx.booking.deleteMany({ where: { id: workflow.bookingId } });
    if (booking?.jobId) {
      await tx.job.deleteMany({ where: { id: booking.jobId } });
    }
  });
}

async function expectedRemainingAfterDeposit(
  db: PrismaClient,
  fixtures: PhaseFFixtures,
  options: Parameters<typeof buildFinalInvoiceWorkflowFixture>[3]
): Promise<number> {
  const basePackage = await db.package.findUniqueOrThrow({
    where: { id: fixtures.basePackageId },
    select: { price: true },
  });
  const addOnTotal = (options?.preInvoiceAddOns ?? []).reduce(
    (sum, addOn) => sum + addOn.price * addOn.quantity,
    0
  );
  return basePackage.price.toNumber() + addOnTotal - 20;
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
