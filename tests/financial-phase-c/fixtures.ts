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
import {
  checkInBooking,
  createBookingInDb,
  recordBookingDeposit,
} from "@/modules/bookings/booking.service";
import { createInvoiceForOrder, issueInvoice } from "@/modules/invoices/invoice.service";
import { recordPayment } from "@/modules/payments/payment.service";

const PREFIX = "phase-c-77";

export type PhaseCFixtures = {
  adminId: string;
  managerId: string;
  receptionistId: string;
  photographerId: string;
  secondPhotographerId: string;
  editorId: string;
  departmentId: string;
  sessionTypeId: string;
  otherSessionTypeId: string;
  basePackageId: string;
  equalPackageId: string;
  cheaperPackageId: string;
  upgradePackageId: string;
  otherSessionPackageId: string;
  secondPackageId: string;
  addOnProductId: string;
  secondAddOnProductId: string;
  zeroPriceAddOnProductId: string;
  includedProductId: string;
  equalReplacementProductId: string;
  expensiveReplacementProductId: string;
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

export async function seedPhaseCFixtures(db: PrismaClient): Promise<PhaseCFixtures> {
  const [admin, manager, receptionist, photographer, secondPhotographer, editor] =
    await Promise.all([
      db.user.create({
        data: {
          id: `${PREFIX}-admin`,
          name: "Phase C Admin",
          email: "phase-c-admin@example.com",
          role: UserRole.ADMIN,
        },
      }),
      db.user.create({
        data: {
          id: `${PREFIX}-manager`,
          name: "Phase C Manager",
          email: "phase-c-manager@example.com",
          role: UserRole.MANAGER,
        },
      }),
      db.user.create({
        data: {
          id: `${PREFIX}-receptionist`,
          name: "Phase C Receptionist",
          email: "phase-c-receptionist@example.com",
          role: UserRole.RECEPTIONIST,
        },
      }),
      db.user.create({
        data: {
          id: `${PREFIX}-photographer`,
          name: "Phase C Photographer",
          email: "phase-c-photographer@example.com",
          role: UserRole.PHOTOGRAPHER,
        },
      }),
      db.user.create({
        data: {
          id: `${PREFIX}-photographer-2`,
          name: "Phase C Photographer Two",
          email: "phase-c-photographer-2@example.com",
          role: UserRole.PHOTOGRAPHER,
        },
      }),
      db.user.create({
        data: {
          id: `${PREFIX}-editor`,
          name: "Phase C Editor",
          email: "phase-c-editor@example.com",
          role: UserRole.EDITOR,
        },
      }),
    ]);

  const department = await db.studioDepartment.create({
    data: {
      id: `${PREFIX}-department`,
      code: "PHASE_C",
      name: "Phase C Department",
      sortOrder: 79,
    },
  });

  const [sessionType, otherSessionType] = await Promise.all([
    db.sessionType.create({
      data: {
        id: `${PREFIX}-session-type`,
        code: "PHASE_C_SESSION",
        name: "Phase C Session",
        departmentId: department.id,
        calendarLabel: "Phase C",
      },
    }),
    db.sessionType.create({
      data: {
        id: `${PREFIX}-other-session-type`,
        code: "PHASE_C_OTHER_SESSION",
        name: "Phase C Other Session",
        departmentId: department.id,
        calendarLabel: "Phase C",
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
        code: "PHASE_C_FAMILY",
        name: "Phase C Family",
        sessionTypeId: sessionType.id,
      },
    }),
    db.packageFamily.create({
      data: {
        id: `${PREFIX}-other-family`,
        code: "PHASE_C_OTHER_FAMILY",
        name: "Phase C Other Family",
        sessionTypeId: otherSessionType.id,
      },
    }),
  ]);

  const [
    includedProduct,
    equalReplacementProduct,
    expensiveReplacementProduct,
    addOnProduct,
    secondAddOnProduct,
    zeroPriceAddOnProduct,
  ] = await Promise.all([
    db.product.create({
      data: {
        id: `${PREFIX}-included-product`,
        name: "Phase C Included Product",
        category: ProductCategory.DIGITAL,
        canonicalPrice: new Prisma.Decimal(40),
        isPackageDeliverable: true,
      },
    }),
    db.product.create({
      data: {
        id: `${PREFIX}-equal-replacement-product`,
        name: "Phase C Equal Replacement Product",
        category: ProductCategory.DIGITAL,
        canonicalPrice: new Prisma.Decimal(40),
        isPackageDeliverable: true,
      },
    }),
    db.product.create({
      data: {
        id: `${PREFIX}-expensive-replacement-product`,
        name: "Phase C Expensive Replacement Product",
        category: ProductCategory.DIGITAL,
        canonicalPrice: new Prisma.Decimal(75),
        isPackageDeliverable: true,
      },
    }),
    db.product.create({
      data: {
        id: `${PREFIX}-addon-product`,
        name: "Phase C Add-on",
        category: ProductCategory.OTHER,
        canonicalPrice: new Prisma.Decimal(50),
        isAddOn: true,
      },
    }),
    db.product.create({
      data: {
        id: `${PREFIX}-second-addon-product`,
        name: "Phase C Second Add-on",
        category: ProductCategory.OTHER,
        canonicalPrice: new Prisma.Decimal(30),
        isAddOn: true,
      },
    }),
    db.product.create({
      data: {
        id: `${PREFIX}-zero-addon-product`,
        name: "Phase C Zero Add-on",
        category: ProductCategory.OTHER,
        canonicalPrice: new Prisma.Decimal(0),
        isAddOn: true,
      },
    }),
  ]);

  const [
    basePackage,
    equalPackage,
    cheaperPackage,
    upgradePackage,
    secondPackage,
    otherSessionPackage,
  ] = await Promise.all([
    db.package.create({
      data: {
        id: `${PREFIX}-base-package`,
        name: "Phase C Base Package",
        price: new Prisma.Decimal(500),
        photoCount: 10,
        durationMinutes: 60,
        packageFamilyId: family.id,
      },
    }),
    db.package.create({
      data: {
        id: `${PREFIX}-equal-package`,
        name: "Phase C Equal Package",
        price: new Prisma.Decimal(500),
        photoCount: 12,
        durationMinutes: 60,
        packageFamilyId: family.id,
      },
    }),
    db.package.create({
      data: {
        id: `${PREFIX}-cheaper-package`,
        name: "Phase C Cheaper Package",
        price: new Prisma.Decimal(400),
        photoCount: 8,
        durationMinutes: 45,
        packageFamilyId: family.id,
      },
    }),
    db.package.create({
      data: {
        id: `${PREFIX}-upgrade-package`,
        name: "Phase C Upgrade Package",
        price: new Prisma.Decimal(650),
        photoCount: 15,
        durationMinutes: 75,
        packageFamilyId: family.id,
      },
    }),
    db.package.create({
      data: {
        id: `${PREFIX}-second-package`,
        name: "Phase C Second Package",
        price: new Prisma.Decimal(200),
        photoCount: 5,
        durationMinutes: 30,
        packageFamilyId: family.id,
      },
    }),
    db.package.create({
      data: {
        id: `${PREFIX}-other-session-package`,
        name: "Phase C Other Session Package",
        price: new Prisma.Decimal(500),
        photoCount: 10,
        durationMinutes: 60,
        packageFamilyId: otherFamily.id,
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
    receptionistId: receptionist.id,
    photographerId: photographer.id,
    secondPhotographerId: secondPhotographer.id,
    editorId: editor.id,
    departmentId: department.id,
    sessionTypeId: sessionType.id,
    otherSessionTypeId: otherSessionType.id,
    basePackageId: basePackage.id,
    equalPackageId: equalPackage.id,
    cheaperPackageId: cheaperPackage.id,
    upgradePackageId: upgradePackage.id,
    otherSessionPackageId: otherSessionPackage.id,
    secondPackageId: secondPackage.id,
    addOnProductId: addOnProduct.id,
    secondAddOnProductId: secondAddOnProduct.id,
    zeroPriceAddOnProductId: zeroPriceAddOnProduct.id,
    includedProductId: includedProduct.id,
    equalReplacementProductId: equalReplacementProduct.id,
    expensiveReplacementProductId: expensiveReplacementProduct.id,
    adminActor: { actorUserId: admin.id, actorRole: UserRole.ADMIN },
    managerActor: { actorUserId: manager.id, actorRole: UserRole.MANAGER },
    receptionistActor: {
      actorUserId: receptionist.id,
      actorRole: UserRole.RECEPTIONIST,
    },
  };
}

export async function buildPendingBookingFixture(
  fixtures: PhaseCFixtures,
  suffix: string
): Promise<{ bookingId: string }> {
  const day = 1 + (Math.abs(hashSuffix(suffix)) % 25);
  const phoneDigits = String(hashSuffix(suffix) % 1_000_000).padStart(6, "0");
  const booking = await createBookingInDb({
    phone: `+96579${phoneDigits}`,
    customerName: `Phase C ${suffix}`,
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
  fixtures: PhaseCFixtures,
  suffix: string
): Promise<{ bookingId: string; financialCaseId: string; depositInvoiceId: string }> {
  const pending = await buildPendingBookingFixture(fixtures, suffix);

  await recordBookingDeposit(
    {
      bookingId: pending.bookingId,
      amount: 20,
      method: PaymentMethod.CASH,
      reference: `phase-c-${suffix}`,
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
  fixtures: PhaseCFixtures,
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
  fixtures: PhaseCFixtures,
  suffix: string,
  options: {
    issue?: boolean;
    finalPaymentAmounts?: number[];
    preInvoiceAddOnQuantity?: number;
    preInvoiceSecondAddOnQuantity?: number;
    selectedPhotoCount?: number;
    extraDigitalCount?: number;
    extraPrintCount?: number;
  } = {}
): Promise<FinalInvoiceWorkflow> {
  const workflow = await buildCheckedInWorkflowFixture(db, fixtures, suffix);

  if (options.preInvoiceAddOnQuantity || options.preInvoiceSecondAddOnQuantity) {
    const orderPackage = await db.orderPackage.findFirstOrThrow({
      where: { orderId: workflow.orderId },
      select: { id: true },
    });
    if (options.preInvoiceAddOnQuantity) {
      await db.orderAddOn.create({
        data: {
          orderId: workflow.orderId,
          orderPackageId: orderPackage.id,
          productId: fixtures.addOnProductId,
          nameSnapshot: "Phase C Pre-Invoice Add-on",
          priceSnapshot: new Prisma.Decimal(50),
          quantity: options.preInvoiceAddOnQuantity,
        },
      });
    }
    if (options.preInvoiceSecondAddOnQuantity) {
      await db.orderAddOn.create({
        data: {
          orderId: workflow.orderId,
          orderPackageId: orderPackage.id,
          productId: fixtures.secondAddOnProductId,
          nameSnapshot: "Phase C Pre-Invoice Second Add-on",
          priceSnapshot: new Prisma.Decimal(30),
          quantity: options.preInvoiceSecondAddOnQuantity,
        },
      });
    }
  }

  if (options.selectedPhotoCount !== undefined) {
    await db.orderPackage.updateMany({
      where: { orderId: workflow.orderId },
      data: {
        selectedPhotoCount: options.selectedPhotoCount,
        extraDigitalCount: options.extraDigitalCount ?? 0,
        extraPrintCount: options.extraPrintCount ?? 0,
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
  fixtures: PhaseCFixtures,
  suffix: string,
  options: Parameters<typeof buildFinalInvoiceWorkflowFixture>[3] = {}
): Promise<FinalInvoiceWorkflow> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, suffix, {
    ...options,
    issue: true,
    finalPaymentAmounts: options.finalPaymentAmounts ?? [
      expectedRemainingAfterDeposit(options),
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
  fixtures: PhaseCFixtures,
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

function expectedRemainingAfterDeposit(
  options: Parameters<typeof buildFinalInvoiceWorkflowFixture>[3] = {}
): number {
  const addOnTotal =
    (options.preInvoiceAddOnQuantity ?? 0) * 50 +
    (options.preInvoiceSecondAddOnQuantity ?? 0) * 30;
  const extraTotal =
    (options.extraDigitalCount ?? 0) * 5 + (options.extraPrintCount ?? 0) * 6;
  return 500 + addOnTotal + extraTotal - 20;
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
