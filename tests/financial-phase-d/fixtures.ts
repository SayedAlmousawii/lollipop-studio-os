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

const PREFIX = "phase-d-77";

export type PhaseDFixtures = {
  adminId: string;
  managerId: string;
  receptionistId: string;
  photographerId: string;
  editorId: string;
  departmentId: string;
  sessionTypeId: string;
  otherSessionTypeId: string;
  basePackageId: string;
  secondPackageId: string;
  cheaperPackageId: string;
  otherSessionPackageId: string;
  addOnProductId: string;
  secondAddOnProductId: string;
  adminActor: ActorContext;
  managerActor: ActorContext;
  receptionistActor: ActorContext;
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

export async function seedPhaseDFixtures(db: PrismaClient): Promise<PhaseDFixtures> {
  const [admin, manager, receptionist, photographer, editor] = await Promise.all([
    db.user.create({
      data: {
        id: `${PREFIX}-admin`,
        name: "Phase D Admin",
        email: "phase-d-admin@example.com",
        role: UserRole.ADMIN,
      },
    }),
    db.user.create({
      data: {
        id: `${PREFIX}-manager`,
        name: "Phase D Manager",
        email: "phase-d-manager@example.com",
        role: UserRole.MANAGER,
      },
    }),
    db.user.create({
      data: {
        id: `${PREFIX}-receptionist`,
        name: "Phase D Receptionist",
        email: "phase-d-receptionist@example.com",
        role: UserRole.RECEPTIONIST,
      },
    }),
    db.user.create({
      data: {
        id: `${PREFIX}-photographer`,
        name: "Phase D Photographer",
        email: "phase-d-photographer@example.com",
        role: UserRole.PHOTOGRAPHER,
      },
    }),
    db.user.create({
      data: {
        id: `${PREFIX}-editor`,
        name: "Phase D Editor",
        email: "phase-d-editor@example.com",
        role: UserRole.EDITOR,
      },
    }),
  ]);

  const department = await db.studioDepartment.create({
    data: {
      id: `${PREFIX}-department`,
      code: "PHASE_D",
      name: "Phase D Department",
      sortOrder: 80,
    },
  });

  const [sessionType, otherSessionType] = await Promise.all([
    db.sessionType.create({
      data: {
        id: `${PREFIX}-session-type`,
        code: "PHASE_D_SESSION",
        name: "Phase D Session",
        departmentId: department.id,
      },
    }),
    db.sessionType.create({
      data: {
        id: `${PREFIX}-other-session-type`,
        code: "PHASE_D_OTHER_SESSION",
        name: "Phase D Other Session",
        departmentId: department.id,
      },
    }),
  ]);

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
      {
        id: `${PREFIX}-other-extra-digital`,
        sessionTypeId: otherSessionType.id,
        mediaType: MediaType.DIGITAL,
        unitPrice: new Prisma.Decimal(7),
      },
      {
        id: `${PREFIX}-other-extra-print`,
        sessionTypeId: otherSessionType.id,
        mediaType: MediaType.PRINT,
        unitPrice: new Prisma.Decimal(8),
      },
    ],
  });

  const [family, otherFamily] = await Promise.all([
    db.packageFamily.create({
      data: {
        id: `${PREFIX}-family`,
        code: "PHASE_D_FAMILY",
        name: "Phase D Family",
        sessionTypeId: sessionType.id,
      },
    }),
    db.packageFamily.create({
      data: {
        id: `${PREFIX}-other-family`,
        code: "PHASE_D_OTHER_FAMILY",
        name: "Phase D Other Family",
        sessionTypeId: otherSessionType.id,
      },
    }),
  ]);

  const [addOnProduct, secondAddOnProduct] = await Promise.all([
    db.product.create({
      data: {
        id: `${PREFIX}-addon-product`,
        name: "Phase D Add-on",
        category: ProductCategory.OTHER,
        canonicalPrice: new Prisma.Decimal(50),
        isAddOn: true,
      },
    }),
    db.product.create({
      data: {
        id: `${PREFIX}-second-addon-product`,
        name: "Phase D Second Add-on",
        category: ProductCategory.OTHER,
        canonicalPrice: new Prisma.Decimal(30),
        isAddOn: true,
      },
    }),
  ]);

  const [basePackage, secondPackage, cheaperPackage, otherSessionPackage] =
    await Promise.all([
      db.package.create({
        data: {
          id: `${PREFIX}-base-package`,
          name: "Phase D Base Package",
          price: new Prisma.Decimal(500),
          photoCount: 10,
          durationMinutes: 60,
          packageFamilyId: family.id,
        },
      }),
      db.package.create({
        data: {
          id: `${PREFIX}-second-package`,
          name: "Phase D Second Package",
          price: new Prisma.Decimal(250),
          photoCount: 5,
          durationMinutes: 45,
          packageFamilyId: family.id,
        },
      }),
      db.package.create({
        data: {
          id: `${PREFIX}-cheaper-package`,
          name: "Phase D Cheaper Package",
          price: new Prisma.Decimal(400),
          photoCount: 8,
          durationMinutes: 45,
          packageFamilyId: family.id,
        },
      }),
      db.package.create({
        data: {
          id: `${PREFIX}-other-session-package`,
          name: "Phase D Other Session Package",
          price: new Prisma.Decimal(500),
          photoCount: 10,
          durationMinutes: 60,
          packageFamilyId: otherFamily.id,
        },
      }),
    ]);

  return {
    adminId: admin.id,
    managerId: manager.id,
    receptionistId: receptionist.id,
    photographerId: photographer.id,
    editorId: editor.id,
    departmentId: department.id,
    sessionTypeId: sessionType.id,
    otherSessionTypeId: otherSessionType.id,
    basePackageId: basePackage.id,
    secondPackageId: secondPackage.id,
    cheaperPackageId: cheaperPackage.id,
    otherSessionPackageId: otherSessionPackage.id,
    addOnProductId: addOnProduct.id,
    secondAddOnProductId: secondAddOnProduct.id,
    adminActor: { actorUserId: admin.id, actorRole: UserRole.ADMIN },
    managerActor: { actorUserId: manager.id, actorRole: UserRole.MANAGER },
    receptionistActor: {
      actorUserId: receptionist.id,
      actorRole: UserRole.RECEPTIONIST,
    },
  };
}

export async function buildPendingBookingFixture(
  fixtures: PhaseDFixtures,
  suffix: string
): Promise<{ bookingId: string }> {
  const day = 1 + (Math.abs(hashSuffix(suffix)) % 25);
  const phoneDigits = String(hashSuffix(suffix) % 1_000_000).padStart(6, "0");
  const booking = await createBookingInDb({
    phone: `+96579${phoneDigits}`,
    customerName: `Phase D ${suffix}`,
    packages: [
      {
        packageId: fixtures.basePackageId,
        quantity: 1,
        sortOrder: 0,
      },
    ],
    sessionDate: new Date(`2026-07-${String(day).padStart(2, "0")}T08:00:00.000Z`),
    sessionTime: "10:00",
    departmentId: fixtures.departmentId,
    themes: [],
  });

  return { bookingId: booking.id };
}

export async function buildConfirmedBookingFixture(
  db: PrismaClient,
  fixtures: PhaseDFixtures,
  suffix: string
): Promise<{ bookingId: string; financialCaseId: string; depositInvoiceId: string }> {
  const pending = await buildPendingBookingFixture(fixtures, suffix);

  await recordBookingDeposit(
    {
      bookingId: pending.bookingId,
      amount: 20,
      method: PaymentMethod.CASH,
      reference: `phase-d-${suffix}`,
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
  fixtures: PhaseDFixtures,
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
  fixtures: PhaseDFixtures,
  suffix: string,
  options: {
    issue?: boolean;
    finalPaymentAmounts?: number[];
    preInvoiceAddOns?: Array<{ productId: string; name: string; price: number; quantity: number }>;
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
  fixtures: PhaseDFixtures,
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

export async function addSecondPackageLine(
  db: PrismaClient,
  fixtures: PhaseDFixtures,
  orderId: string
): Promise<string> {
  const secondPackage = await db.package.findUniqueOrThrow({
    where: { id: fixtures.secondPackageId },
    select: { id: true, price: true },
  });
  const orderPackage = await db.orderPackage.create({
    data: {
      orderId,
      packageId: secondPackage.id,
      sessionTypeId: fixtures.sessionTypeId,
      originalPackagePriceSnapshot: secondPackage.price,
      finalPackagePriceSnapshot: secondPackage.price,
      selectedPhotoCount: 5,
      sortOrder: 1,
    },
  });

  return orderPackage.id;
}

async function expectedRemainingAfterDeposit(
  db: PrismaClient,
  fixtures: PhaseDFixtures,
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
