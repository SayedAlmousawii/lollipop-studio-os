import {
  BookingStatus,
  InvoiceLineType,
  InvoiceStatus,
  InvoiceType,
  PaymentMethod,
  PaymentType,
  Prisma,
  PrismaClient,
  ProductCategory,
  OrderStatus,
  UserRole,
} from "@prisma/client";
import {
  applyDepositToFinalIfPresent,
  createAdjustmentInvoice,
  createCreditNote,
  recalculateInvoiceStatus,
  syncOrderInvoiceForFinancialEdit,
} from "../../src/modules/invoices/invoice.service";
import { createPaymentWithAllocation } from "../../src/modules/payments/payment.service";
import { issueRefundWithPayment } from "../../src/modules/refunds/refund.service";

export type BookingFixtureResult = {
  customerId: string;
  departmentId: string;
  jobId: string;
  bookingId: string;
  financialCaseId: string;
  invoiceId: string;
  paymentId: string;
};

export type AdjustedBookingFixtureResult = BookingFixtureResult & {
  finalInvoiceId: string;
  finalPaymentId: string;
  adjustmentInvoiceId: string;
};

export type RefundedBookingFixtureResult = AdjustedBookingFixtureResult & {
  refundInvoiceId: string;
  refundPaymentId: string;
};

export type CreditNotedBookingFixtureResult = AdjustedBookingFixtureResult & {
  creditNoteInvoiceId: string;
};

export type MixedEditBookingFixtureResult = AdjustedBookingFixtureResult & {
  creditNoteInvoiceId: string;
};

async function ensureLockSnapshotsForFixtureInvoices(
  prisma: PrismaClient
): Promise<void> {
  const invoices = await prisma.invoice.findMany({
    where: {
      isLocked: true,
      lockSnapshots: { none: {} },
    },
    select: {
      id: true,
      publicId: true,
      totalAmount: true,
      invoiceType: true,
      parentInvoiceId: true,
      financialCaseId: true,
      jobId: true,
      orderId: true,
      invoiceNumber: true,
    },
  });

  if (invoices.length === 0) return;

  await prisma.invoiceLockSnapshot.createMany({
    data: invoices.map((invoice) => ({
      invoiceId: invoice.id,
      lockedByUserId: null,
      totalAmount: invoice.totalAmount,
      invoiceType: invoice.invoiceType,
      parentInvoiceId: invoice.parentInvoiceId,
      financialCaseId: invoice.financialCaseId,
      jobId: invoice.jobId,
      orderId: invoice.orderId,
      invoiceNumber: invoice.invoiceNumber,
      publicId: invoice.publicId,
    })),
  });
}

const FIXTURE_KEYS = {
  departmentCode: "FIN_FIXTURE_DEPT_73B",
  customerPhone: "+96550007300",
  jobNumber: "JOB-FIN-73B-BASE",
  bookingPublicId: "BK-FIN-73B-BASE",
  invoicePublicId: "INV-FIN-73B-DEP",
  invoiceNumber: "INV-FIN-73B-0001",
  finalInvoicePublicId: "INV-FIN-75A-FINAL",
  finalInvoiceNumber: "INV-FIN-75A-0002",
  adjustmentNotes: "Feature 75a fixture adjustment",
} as const;

const ADJUSTED_FIXTURE_KEYS = {
  departmentCode: "FIN_FIXTURE_DEPT_75A",
  customerPhone: "+96550007500",
  jobNumber: "JOB-FIN-75A-ADJ",
  bookingPublicId: "BK-FIN-75A-ADJ",
  invoicePublicId: "INV-FIN-75A-DEP",
  invoiceNumber: "INV-FIN-75A-0001",
  finalInvoicePublicId: "INV-FIN-75A-FINAL",
  finalInvoiceNumber: "INV-FIN-75A-0002",
  adjustmentNotes: "Feature 75a fixture adjustment",
} as const;

const AUTO_ADJUSTED_FIXTURE_KEYS = {
  departmentCode: "FIN_FIXTURE_DEPT_75B",
  customerPhone: "+96550007510",
  jobNumber: "JOB-FIN-75B-AUTO-ADJ",
  bookingPublicId: "BK-FIN-75B-AUTO-ADJ",
  invoicePublicId: "INV-FIN-75B-DEP",
  invoiceNumber: "DEP-FIN-75B-0001",
  finalInvoicePublicId: "INV-FIN-75B-FINAL",
  finalInvoiceNumber: "INV-FIN-75B-0002",
  adjustmentNotes: "Feature 75b auto adjustment",
  sessionTypeCode: "FIN_FIXTURE_SESSION_75B",
  packageFamilyCode: "FIN_FIXTURE_FAMILY_75B",
  packageId: "pkg-fin-75b-base",
  orderPublicId: "ORD-FIN-75B-AUTO-ADJ",
  addOnProductId: "prod-fin-75b-addon",
} as const;

const REFUNDED_FIXTURE_KEYS = {
  refundReason: "Feature 76a partial refund",
  managerEmail: "financial-refund-manager@example.com",
} as const;

const CREDIT_NOTED_FIXTURE_KEYS = {
  creditReason: "Feature 76b partial credit note",
  managerEmail: "financial-credit-note-manager@example.com",
} as const;

const MIXED_EDIT_FIXTURE_KEYS = {
  departmentCode: "FIN_FIXTURE_DEPT_76C",
  customerPhone: "+96550007630",
  jobNumber: "JOB-FIN-76C-MIXED",
  bookingPublicId: "BK-FIN-76C-MIXED",
  invoicePublicId: "INV-FIN-76C-DEP",
  invoiceNumber: "DEP-FIN-76C-0001",
  finalInvoicePublicId: "INV-FIN-76C-FINAL",
  finalInvoiceNumber: "INV-FIN-76C-0002",
  adjustmentNotes: "Feature 76c mixed edit",
  sessionTypeCode: "FIN_FIXTURE_SESSION_76C",
  packageFamilyCode: "FIN_FIXTURE_FAMILY_76C",
  packageId: "pkg-fin-76c-base",
  orderPublicId: "ORD-FIN-76C-MIXED",
  oldAddOnProductId: "prod-fin-76c-old-addon",
  newAddOnProductId: "prod-fin-76c-new-addon",
  managerEmail: "financial-mixed-edit-manager@example.com",
} as const;

type FixtureKeys = {
  departmentCode: string;
  customerPhone: string;
  jobNumber: string;
  bookingPublicId: string;
  invoicePublicId: string;
  invoiceNumber: string;
  finalInvoicePublicId: string;
  finalInvoiceNumber: string;
  adjustmentNotes: string;
};

export async function makeCashDepositBookingFixture(
  prisma: PrismaClient,
  fixtureKeys: FixtureKeys = FIXTURE_KEYS
): Promise<BookingFixtureResult> {
  const existingInvoice = await prisma.invoice.findUnique({
    where: { publicId: fixtureKeys.invoicePublicId },
    include: {
      booking: { select: { id: true, customerId: true, departmentId: true, jobId: true } },
      financialCase: { select: { id: true } },
      payments: {
        select: { id: true, allocations: { select: { id: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (
    existingInvoice &&
    existingInvoice.booking &&
    existingInvoice.booking.jobId &&
    existingInvoice.payments[0] &&
    existingInvoice.payments[0].allocations.length === 1
  ) {
    return {
      customerId: existingInvoice.booking.customerId,
      departmentId: existingInvoice.booking.departmentId,
      jobId: existingInvoice.booking.jobId,
      bookingId: existingInvoice.booking.id,
      financialCaseId: existingInvoice.financialCase.id,
      invoiceId: existingInvoice.id,
      paymentId: existingInvoice.payments[0].id,
    };
  }

  const department = await prisma.studioDepartment.upsert({
    where: { code: fixtureKeys.departmentCode },
    update: {
      name: "Financial Fixture Department",
      isActive: true,
      sortOrder: 73,
    },
    create: {
      code: fixtureKeys.departmentCode,
      name: "Financial Fixture Department",
      isActive: true,
      sortOrder: 73,
    },
  });

  const customer = await prisma.customer.upsert({
    where: { phone: fixtureKeys.customerPhone },
    update: {
      name: "Financial Fixture Customer",
    },
    create: {
      name: "Financial Fixture Customer",
      phone: fixtureKeys.customerPhone,
    },
  });

  const job = await prisma.job.upsert({
    where: { jobNumber: fixtureKeys.jobNumber },
    update: {
      customerId: customer.id,
    },
    create: {
      jobNumber: fixtureKeys.jobNumber,
      customerId: customer.id,
    },
  });

  const booking = await prisma.booking.upsert({
    where: { publicId: fixtureKeys.bookingPublicId },
    update: {
      jobId: job.id,
      jobNumber: job.jobNumber,
      customerId: customer.id,
      departmentId: department.id,
      status: BookingStatus.CONFIRMED,
      sessionDate: new Date("2026-05-14T08:00:00.000Z"),
      sessionTime: "11:00",
    },
    create: {
      publicId: fixtureKeys.bookingPublicId,
      jobId: job.id,
      jobNumber: job.jobNumber,
      customerId: customer.id,
      departmentId: department.id,
      status: BookingStatus.CONFIRMED,
      sessionDate: new Date("2026-05-14T08:00:00.000Z"),
      sessionTime: "11:00",
    },
  });

  const financialCase = await prisma.financialCase.upsert({
    where: { bookingId: booking.id },
    update: {
      customerId: customer.id,
      jobId: job.id,
    },
    create: {
      bookingId: booking.id,
      customerId: customer.id,
      jobId: job.id,
    },
  });

  const invoice = await prisma.invoice.upsert({
    where: { publicId: fixtureKeys.invoicePublicId },
    update: {
      financialCaseId: financialCase.id,
      invoiceType: InvoiceType.DEPOSIT,
      jobId: job.id,
      jobNumber: job.jobNumber,
      bookingId: booking.id,
      customerId: customer.id,
      totalAmount: new Prisma.Decimal(20),
      paidAmount: new Prisma.Decimal(20),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      issuedAt: new Date("2026-05-14T08:05:00.000Z"),
      closedAt: new Date("2026-05-14T08:10:00.000Z"),
    },
    create: {
      publicId: fixtureKeys.invoicePublicId,
      financialCaseId: financialCase.id,
      invoiceType: InvoiceType.DEPOSIT,
      jobId: job.id,
      jobNumber: job.jobNumber,
      bookingId: booking.id,
      customerId: customer.id,
      invoiceNumber: fixtureKeys.invoiceNumber,
      totalAmount: new Prisma.Decimal(20),
      paidAmount: new Prisma.Decimal(20),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      issuedAt: new Date("2026-05-14T08:05:00.000Z"),
      closedAt: new Date("2026-05-14T08:10:00.000Z"),
    },
  });

  const existingPayment = await prisma.payment.findFirst({
    where: {
      invoiceId: invoice.id,
      financialCaseId: financialCase.id,
      paymentType: PaymentType.DEPOSIT,
    },
    include: { allocations: true },
    orderBy: { createdAt: "asc" },
  });

  const payment = existingPayment
    ? existingPayment
    : await createPaymentWithAllocation(
        {
          invoiceId: invoice.id,
          financialCaseId: financialCase.id,
          amount: new Prisma.Decimal(20),
          method: PaymentMethod.CASH,
          paymentType: PaymentType.DEPOSIT,
          paidAt: new Date("2026-05-14T08:09:00.000Z"),
        },
        prisma
      );

  if (existingPayment && existingPayment.allocations.length === 0) {
    await prisma.paymentAllocation.create({
      data: {
        paymentId: existingPayment.id,
        invoiceId: invoice.id,
        amount: existingPayment.amount,
      },
    });
  }

  if (existingPayment && existingPayment.allocations.length > 1) {
    throw new Error("Fixture payment has more than one allocation");
  }

  return {
    customerId: customer.id,
    departmentId: department.id,
    jobId: job.id,
    bookingId: booking.id,
    financialCaseId: financialCase.id,
    invoiceId: invoice.id,
    paymentId: payment.id,
  };
}

export async function makeAdjustedBookingFixture(
  prisma: PrismaClient
): Promise<AdjustedBookingFixtureResult> {
  const base = await makeCashDepositBookingFixture(
    prisma,
    ADJUSTED_FIXTURE_KEYS
  );

  const finalInvoice = await prisma.invoice.upsert({
    where: { publicId: ADJUSTED_FIXTURE_KEYS.finalInvoicePublicId },
    update: {
      financialCaseId: base.financialCaseId,
      invoiceType: InvoiceType.FINAL,
      jobId: base.jobId,
      bookingId: base.bookingId,
      customerId: base.customerId,
      totalAmount: new Prisma.Decimal(100),
      paidAmount: new Prisma.Decimal(80),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      issuedAt: new Date("2026-05-14T09:00:00.000Z"),
      closedAt: new Date("2026-05-14T09:15:00.000Z"),
    },
    create: {
      publicId: ADJUSTED_FIXTURE_KEYS.finalInvoicePublicId,
      financialCaseId: base.financialCaseId,
      invoiceType: InvoiceType.FINAL,
      jobId: base.jobId,
      bookingId: base.bookingId,
      customerId: base.customerId,
      invoiceNumber: ADJUSTED_FIXTURE_KEYS.finalInvoiceNumber,
      totalAmount: new Prisma.Decimal(100),
      paidAmount: new Prisma.Decimal(80),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      issuedAt: new Date("2026-05-14T09:00:00.000Z"),
      closedAt: new Date("2026-05-14T09:15:00.000Z"),
    },
  });

  await applyDepositToFinalIfPresent(
    base.financialCaseId,
    finalInvoice.id,
    prisma
  );

  const existingFinalPayment = await prisma.payment.findFirst({
    where: {
      invoiceId: finalInvoice.id,
      financialCaseId: base.financialCaseId,
      paymentType: PaymentType.FINAL,
    },
    include: { allocations: true },
    orderBy: { createdAt: "asc" },
  });

  const finalPayment = existingFinalPayment
    ? existingFinalPayment
    : await createPaymentWithAllocation(
        {
          invoiceId: finalInvoice.id,
          financialCaseId: base.financialCaseId,
          amount: new Prisma.Decimal(80),
          method: PaymentMethod.CASH,
          paymentType: PaymentType.FINAL,
          paidAt: new Date("2026-05-14T09:10:00.000Z"),
        },
        prisma
      );

  if (existingFinalPayment && existingFinalPayment.allocations.length === 0) {
    await prisma.paymentAllocation.create({
      data: {
        paymentId: existingFinalPayment.id,
        invoiceId: finalInvoice.id,
        amount: existingFinalPayment.amount,
      },
    });
  }

  if (existingFinalPayment && existingFinalPayment.allocations.length > 1) {
    throw new Error("Fixture final payment has more than one allocation");
  }

  await recalculateInvoiceStatus(finalInvoice.id, prisma);
  await prisma.invoice.update({
    where: { id: finalInvoice.id },
    data: {
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      closedAt: new Date("2026-05-14T09:15:00.000Z"),
    },
  });

  const existingAdjustment = await prisma.invoice.findFirst({
    where: {
      invoiceType: InvoiceType.ADJUSTMENT,
      parentInvoiceId: finalInvoice.id,
      notes: ADJUSTED_FIXTURE_KEYS.adjustmentNotes,
    },
    select: { id: true },
  });
  const manager = await prisma.user.upsert({
    where: { email: "financial-adjustment-manager@example.com" },
    update: {
      name: "Financial Adjustment Manager",
      role: UserRole.MANAGER,
      active: true,
    },
    create: {
      name: "Financial Adjustment Manager",
      email: "financial-adjustment-manager@example.com",
      role: UserRole.MANAGER,
    },
  });

  const adjustmentInvoice = existingAdjustment
    ? existingAdjustment
    : await createAdjustmentInvoice(
        {
          parentFinalInvoiceId: finalInvoice.id,
          notes: ADJUSTED_FIXTURE_KEYS.adjustmentNotes,
          createdByUserId: manager.id,
          lines: [
            {
              lineType: InvoiceLineType.ADD_ON,
              description: "Fixture add-on after final lock",
              quantity: 1,
              unitPrice: 15,
            },
          ],
        },
        prisma
      );

  return {
    ...base,
    finalInvoiceId: finalInvoice.id,
    finalPaymentId: finalPayment.id,
    adjustmentInvoiceId: adjustmentInvoice.id,
  };
}

export async function makeAutoAdjustedBookingFixture(
  prisma: PrismaClient
): Promise<AdjustedBookingFixtureResult> {
  const base = await makeCashDepositBookingFixture(
    prisma,
    AUTO_ADJUSTED_FIXTURE_KEYS
  );

  const sessionType = await prisma.sessionType.upsert({
    where: { code: AUTO_ADJUSTED_FIXTURE_KEYS.sessionTypeCode },
    update: {
      name: "Financial Fixture Session",
      departmentId: base.departmentId,
      isActive: true,
    },
    create: {
      code: AUTO_ADJUSTED_FIXTURE_KEYS.sessionTypeCode,
      name: "Financial Fixture Session",
      departmentId: base.departmentId,
      isActive: true,
    },
  });
  const packageFamily = await prisma.packageFamily.upsert({
    where: { code: AUTO_ADJUSTED_FIXTURE_KEYS.packageFamilyCode },
    update: {
      name: "Financial Fixture Family",
      sessionTypeId: sessionType.id,
      isActive: true,
    },
    create: {
      code: AUTO_ADJUSTED_FIXTURE_KEYS.packageFamilyCode,
      name: "Financial Fixture Family",
      sessionTypeId: sessionType.id,
      isActive: true,
    },
  });
  const packageRow = await prisma.package.upsert({
    where: { id: AUTO_ADJUSTED_FIXTURE_KEYS.packageId },
    update: {
      name: "Fixture Base Package",
      price: new Prisma.Decimal(100),
      photoCount: 10,
      packageFamilyId: packageFamily.id,
      isActive: true,
    },
    create: {
      id: AUTO_ADJUSTED_FIXTURE_KEYS.packageId,
      name: "Fixture Base Package",
      price: new Prisma.Decimal(100),
      photoCount: 10,
      durationMinutes: 60,
      packageFamilyId: packageFamily.id,
      isActive: true,
    },
  });
  const order = await prisma.order.upsert({
    where: { bookingId: base.bookingId },
    update: {
      publicId: AUTO_ADJUSTED_FIXTURE_KEYS.orderPublicId,
      jobNumber: AUTO_ADJUSTED_FIXTURE_KEYS.jobNumber,
      jobId: base.jobId,
      customerId: base.customerId,
      status: OrderStatus.ACTIVE,
    },
    create: {
      publicId: AUTO_ADJUSTED_FIXTURE_KEYS.orderPublicId,
      jobNumber: AUTO_ADJUSTED_FIXTURE_KEYS.jobNumber,
      jobId: base.jobId,
      bookingId: base.bookingId,
      customerId: base.customerId,
      status: OrderStatus.ACTIVE,
    },
  });
  const orderPackage = await prisma.orderPackage.upsert({
    where: { id: "opkg-fin-75b-base" },
    update: {
      orderId: order.id,
      packageId: packageRow.id,
      sessionTypeId: sessionType.id,
      originalPackagePriceSnapshot: packageRow.price,
      finalPackagePriceSnapshot: packageRow.price,
    },
    create: {
      id: "opkg-fin-75b-base",
      orderId: order.id,
      packageId: packageRow.id,
      sessionTypeId: sessionType.id,
      originalPackagePriceSnapshot: packageRow.price,
      finalPackagePriceSnapshot: packageRow.price,
      selectedPhotoCount: packageRow.photoCount,
    },
  });

  const finalInvoice = await prisma.invoice.upsert({
    where: { publicId: AUTO_ADJUSTED_FIXTURE_KEYS.finalInvoicePublicId },
    update: {
      financialCaseId: base.financialCaseId,
      invoiceType: InvoiceType.FINAL,
      jobId: base.jobId,
      jobNumber: AUTO_ADJUSTED_FIXTURE_KEYS.jobNumber,
      orderId: order.id,
      bookingId: base.bookingId,
      customerId: base.customerId,
      totalAmount: new Prisma.Decimal(100),
      paidAmount: new Prisma.Decimal(80),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
    },
    create: {
      publicId: AUTO_ADJUSTED_FIXTURE_KEYS.finalInvoicePublicId,
      financialCaseId: base.financialCaseId,
      invoiceType: InvoiceType.FINAL,
      jobId: base.jobId,
      jobNumber: AUTO_ADJUSTED_FIXTURE_KEYS.jobNumber,
      orderId: order.id,
      bookingId: base.bookingId,
      customerId: base.customerId,
      invoiceNumber: AUTO_ADJUSTED_FIXTURE_KEYS.finalInvoiceNumber,
      totalAmount: new Prisma.Decimal(100),
      paidAmount: new Prisma.Decimal(80),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      issuedAt: new Date("2026-05-14T10:00:00.000Z"),
      closedAt: new Date("2026-05-14T10:15:00.000Z"),
    },
  });
  await prisma.invoiceLineItem.upsert({
    where: {
      invoiceId_sortOrder: {
        invoiceId: finalInvoice.id,
        sortOrder: 0,
      },
    },
    update: {
      lineType: InvoiceLineType.PACKAGE_BASE,
      description: packageRow.name,
      quantity: 1,
      unitPrice: packageRow.price,
      lineTotal: packageRow.price,
    },
    create: {
      invoiceId: finalInvoice.id,
      lineType: InvoiceLineType.PACKAGE_BASE,
      description: packageRow.name,
      quantity: 1,
      unitPrice: packageRow.price,
      lineTotal: packageRow.price,
      sortOrder: 0,
    },
  });

  await applyDepositToFinalIfPresent(base.financialCaseId, finalInvoice.id, prisma);
  const existingFinalPayment = await prisma.payment.findFirst({
    where: {
      invoiceId: finalInvoice.id,
      financialCaseId: base.financialCaseId,
      paymentType: PaymentType.FINAL,
    },
    include: { allocations: true },
    orderBy: { createdAt: "asc" },
  });
  const finalPayment = existingFinalPayment
    ? existingFinalPayment
    : await createPaymentWithAllocation(
        {
          invoiceId: finalInvoice.id,
          financialCaseId: base.financialCaseId,
          amount: new Prisma.Decimal(80),
          method: PaymentMethod.CASH,
          paymentType: PaymentType.FINAL,
          paidAt: new Date("2026-05-14T10:10:00.000Z"),
        },
        prisma
      );
  if (existingFinalPayment && existingFinalPayment.allocations.length === 0) {
    await prisma.paymentAllocation.create({
      data: {
        paymentId: existingFinalPayment.id,
        invoiceId: finalInvoice.id,
        amount: existingFinalPayment.amount,
      },
    });
  }

  await recalculateInvoiceStatus(finalInvoice.id, prisma);
  await prisma.invoice.update({
    where: { id: finalInvoice.id },
    data: { status: InvoiceStatus.CLOSED, isLocked: true },
  });

  const existingAdjustment = await prisma.invoice.findFirst({
    where: {
      invoiceType: InvoiceType.ADJUSTMENT,
      parentInvoiceId: finalInvoice.id,
      notes: { startsWith: "Auto-ADJUSTMENT from order edit" },
    },
    select: { id: true },
  });
  if (existingAdjustment) {
    return {
      ...base,
      finalInvoiceId: finalInvoice.id,
      finalPaymentId: finalPayment.id,
      adjustmentInvoiceId: existingAdjustment.id,
    };
  }

  const addOnProduct = await prisma.product.upsert({
    where: { id: AUTO_ADJUSTED_FIXTURE_KEYS.addOnProductId },
    update: {
      name: "Fixture add-on after final lock",
      category: ProductCategory.OTHER,
      canonicalPrice: new Prisma.Decimal(15),
      isActive: true,
      isAddOn: true,
    },
    create: {
      id: AUTO_ADJUSTED_FIXTURE_KEYS.addOnProductId,
      name: "Fixture add-on after final lock",
      category: ProductCategory.OTHER,
      canonicalPrice: new Prisma.Decimal(15),
      isActive: true,
      isAddOn: true,
    },
  });
  await prisma.orderAddOn.create({
    data: {
      orderId: order.id,
      orderPackageId: orderPackage.id,
      productId: addOnProduct.id,
      nameSnapshot: addOnProduct.name,
      priceSnapshot: addOnProduct.canonicalPrice,
      quantity: 1,
    },
  });
  const manager = await prisma.user.upsert({
    where: { email: "financial-auto-adjustment-manager@example.com" },
    update: {
      name: "Financial Auto Adjustment Manager",
      role: UserRole.MANAGER,
      active: true,
    },
    create: {
      name: "Financial Auto Adjustment Manager",
      email: "financial-auto-adjustment-manager@example.com",
      role: UserRole.MANAGER,
    },
  });
  await syncOrderInvoiceForFinancialEdit(prisma, {
    orderId: order.id,
    actorContext: { actorUserId: manager.id, actorRole: manager.role },
    previousAddOns: [],
  });

  const adjustmentInvoice = await prisma.invoice.findFirstOrThrow({
    where: {
      invoiceType: InvoiceType.ADJUSTMENT,
      parentInvoiceId: finalInvoice.id,
      notes: { startsWith: "Auto-ADJUSTMENT from order edit" },
    },
    select: { id: true },
  });

  return {
    ...base,
    finalInvoiceId: finalInvoice.id,
    finalPaymentId: finalPayment.id,
    adjustmentInvoiceId: adjustmentInvoice.id,
  };
}

export async function makeRefundedBookingFixture(
  prisma: PrismaClient
): Promise<RefundedBookingFixtureResult> {
  const adjusted = await makeAdjustedBookingFixture(prisma);
  const manager = await prisma.user.upsert({
    where: { email: REFUNDED_FIXTURE_KEYS.managerEmail },
    update: {
      name: "Financial Refund Manager",
      role: UserRole.MANAGER,
      active: true,
    },
    create: {
      name: "Financial Refund Manager",
      email: REFUNDED_FIXTURE_KEYS.managerEmail,
      role: UserRole.MANAGER,
      active: true,
    },
  });

  const existingRefund = await prisma.invoice.findFirst({
    where: {
      invoiceType: InvoiceType.REFUND,
      parentInvoiceId: adjusted.finalInvoiceId,
      notes: REFUNDED_FIXTURE_KEYS.refundReason,
    },
    select: {
      id: true,
      payments: {
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });
  if (existingRefund?.payments[0]) {
    return {
      ...adjusted,
      refundInvoiceId: existingRefund.id,
      refundPaymentId: existingRefund.payments[0].id,
    };
  }

  const existingRefundCapacityCredit = await prisma.invoice.findFirst({
    where: {
      invoiceType: InvoiceType.CREDIT_NOTE,
      parentInvoiceId: adjusted.finalInvoiceId,
      notes: REFUNDED_FIXTURE_KEYS.refundReason,
    },
    select: { id: true },
  });
  if (!existingRefundCapacityCredit) {
    await createCreditNote(
      {
        targetFinalInvoiceId: adjusted.finalInvoiceId,
        reason: REFUNDED_FIXTURE_KEYS.refundReason,
        notes: REFUNDED_FIXTURE_KEYS.refundReason,
        createdByUserId: manager.id,
        lines: [
          {
            description: "Fixture reduction enabling refund capacity",
            quantity: 1,
            unitPrice: new Prisma.Decimal(30),
          },
        ],
      },
      prisma
    );
  }

  const refund = await issueRefundWithPayment(
    {
      sourceInvoiceId: adjusted.finalInvoiceId,
      amount: new Prisma.Decimal(10),
      reason: REFUNDED_FIXTURE_KEYS.refundReason,
      notes: REFUNDED_FIXTURE_KEYS.refundReason,
      createdByUserId: manager.id,
      method: PaymentMethod.CASH,
      refundOfPaymentId: adjusted.finalPaymentId,
      paidAt: new Date("2026-05-14T11:00:00.000Z"),
    },
    prisma
  );

  return {
    ...adjusted,
    refundInvoiceId: refund.refundInvoiceId,
    refundPaymentId: refund.refundPaymentId,
  };
}

export async function makeCreditNotedBookingFixture(
  prisma: PrismaClient
): Promise<CreditNotedBookingFixtureResult> {
  const adjusted = await makeAdjustedBookingFixture(prisma);
  const manager = await prisma.user.upsert({
    where: { email: CREDIT_NOTED_FIXTURE_KEYS.managerEmail },
    update: {
      name: "Financial Credit Note Manager",
      role: UserRole.MANAGER,
      active: true,
    },
    create: {
      name: "Financial Credit Note Manager",
      email: CREDIT_NOTED_FIXTURE_KEYS.managerEmail,
      role: UserRole.MANAGER,
      active: true,
    },
  });

  const existingCreditNote = await prisma.invoice.findFirst({
    where: {
      invoiceType: InvoiceType.CREDIT_NOTE,
      parentInvoiceId: adjusted.finalInvoiceId,
      notes: CREDIT_NOTED_FIXTURE_KEYS.creditReason,
    },
    select: { id: true },
  });
  if (existingCreditNote) {
    return {
      ...adjusted,
      creditNoteInvoiceId: existingCreditNote.id,
    };
  }

  const creditNote = await createCreditNote(
    {
      targetFinalInvoiceId: adjusted.finalInvoiceId,
      reason: CREDIT_NOTED_FIXTURE_KEYS.creditReason,
      notes: CREDIT_NOTED_FIXTURE_KEYS.creditReason,
      createdByUserId: manager.id,
      lines: [
        {
          description: "Fixture reduction after final lock",
          quantity: 1,
          unitPrice: new Prisma.Decimal(20),
        },
      ],
    },
    prisma
  );

  return {
    ...adjusted,
    creditNoteInvoiceId: creditNote.id,
  };
}

export async function makeMixedEditBookingFixture(
  prisma: PrismaClient
): Promise<MixedEditBookingFixtureResult> {
  const base = await makeCashDepositBookingFixture(
    prisma,
    MIXED_EDIT_FIXTURE_KEYS
  );
  const manager = await prisma.user.upsert({
    where: { email: MIXED_EDIT_FIXTURE_KEYS.managerEmail },
    update: {
      name: "Financial Mixed Edit Manager",
      role: UserRole.MANAGER,
      active: true,
    },
    create: {
      name: "Financial Mixed Edit Manager",
      email: MIXED_EDIT_FIXTURE_KEYS.managerEmail,
      role: UserRole.MANAGER,
      active: true,
    },
  });
  const sessionType = await prisma.sessionType.upsert({
    where: { code: MIXED_EDIT_FIXTURE_KEYS.sessionTypeCode },
    update: {
      name: "Financial Mixed Edit Session",
      departmentId: base.departmentId,
      isActive: true,
    },
    create: {
      code: MIXED_EDIT_FIXTURE_KEYS.sessionTypeCode,
      name: "Financial Mixed Edit Session",
      departmentId: base.departmentId,
      isActive: true,
    },
  });
  const packageFamily = await prisma.packageFamily.upsert({
    where: { code: MIXED_EDIT_FIXTURE_KEYS.packageFamilyCode },
    update: {
      name: "Financial Mixed Edit Family",
      sessionTypeId: sessionType.id,
      isActive: true,
    },
    create: {
      code: MIXED_EDIT_FIXTURE_KEYS.packageFamilyCode,
      name: "Financial Mixed Edit Family",
      sessionTypeId: sessionType.id,
      isActive: true,
    },
  });
  const packageRow = await prisma.package.upsert({
    where: { id: MIXED_EDIT_FIXTURE_KEYS.packageId },
    update: {
      name: "Mixed Edit Base Package",
      price: new Prisma.Decimal(100),
      photoCount: 10,
      packageFamilyId: packageFamily.id,
      isActive: true,
    },
    create: {
      id: MIXED_EDIT_FIXTURE_KEYS.packageId,
      name: "Mixed Edit Base Package",
      price: new Prisma.Decimal(100),
      photoCount: 10,
      durationMinutes: 60,
      packageFamilyId: packageFamily.id,
      isActive: true,
    },
  });
  const [oldAddOnProduct, newAddOnProduct] = await Promise.all([
    prisma.product.upsert({
      where: { id: MIXED_EDIT_FIXTURE_KEYS.oldAddOnProductId },
      update: {
        name: "Mixed edit removed add-on",
        category: ProductCategory.OTHER,
        canonicalPrice: new Prisma.Decimal(10),
        isActive: true,
        isAddOn: true,
      },
      create: {
        id: MIXED_EDIT_FIXTURE_KEYS.oldAddOnProductId,
        name: "Mixed edit removed add-on",
        category: ProductCategory.OTHER,
        canonicalPrice: new Prisma.Decimal(10),
        isActive: true,
        isAddOn: true,
      },
    }),
    prisma.product.upsert({
      where: { id: MIXED_EDIT_FIXTURE_KEYS.newAddOnProductId },
      update: {
        name: "Mixed edit added add-on",
        category: ProductCategory.OTHER,
        canonicalPrice: new Prisma.Decimal(15),
        isActive: true,
        isAddOn: true,
      },
      create: {
        id: MIXED_EDIT_FIXTURE_KEYS.newAddOnProductId,
        name: "Mixed edit added add-on",
        category: ProductCategory.OTHER,
        canonicalPrice: new Prisma.Decimal(15),
        isActive: true,
        isAddOn: true,
      },
    }),
  ]);
  const order = await prisma.order.upsert({
    where: { bookingId: base.bookingId },
    update: {
      publicId: MIXED_EDIT_FIXTURE_KEYS.orderPublicId,
      jobNumber: MIXED_EDIT_FIXTURE_KEYS.jobNumber,
      jobId: base.jobId,
      customerId: base.customerId,
      status: OrderStatus.ACTIVE,
    },
    create: {
      publicId: MIXED_EDIT_FIXTURE_KEYS.orderPublicId,
      jobNumber: MIXED_EDIT_FIXTURE_KEYS.jobNumber,
      jobId: base.jobId,
      bookingId: base.bookingId,
      customerId: base.customerId,
      status: OrderStatus.ACTIVE,
    },
  });
  const orderPackage = await prisma.orderPackage.upsert({
    where: { id: "opkg-fin-76c-base" },
    update: {
      orderId: order.id,
      packageId: packageRow.id,
      sessionTypeId: sessionType.id,
      originalPackagePriceSnapshot: packageRow.price,
      finalPackagePriceSnapshot: packageRow.price,
      selectedPhotoCount: packageRow.photoCount,
    },
    create: {
      id: "opkg-fin-76c-base",
      orderId: order.id,
      packageId: packageRow.id,
      sessionTypeId: sessionType.id,
      originalPackagePriceSnapshot: packageRow.price,
      finalPackagePriceSnapshot: packageRow.price,
      selectedPhotoCount: packageRow.photoCount,
    },
  });

  const finalInvoice = await prisma.invoice.upsert({
    where: { publicId: MIXED_EDIT_FIXTURE_KEYS.finalInvoicePublicId },
    update: {
      financialCaseId: base.financialCaseId,
      invoiceType: InvoiceType.FINAL,
      jobId: base.jobId,
      jobNumber: MIXED_EDIT_FIXTURE_KEYS.jobNumber,
      orderId: order.id,
      bookingId: base.bookingId,
      customerId: base.customerId,
      totalAmount: new Prisma.Decimal(110),
      paidAmount: new Prisma.Decimal(90),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
    },
    create: {
      publicId: MIXED_EDIT_FIXTURE_KEYS.finalInvoicePublicId,
      financialCaseId: base.financialCaseId,
      invoiceType: InvoiceType.FINAL,
      jobId: base.jobId,
      jobNumber: MIXED_EDIT_FIXTURE_KEYS.jobNumber,
      orderId: order.id,
      bookingId: base.bookingId,
      customerId: base.customerId,
      invoiceNumber: MIXED_EDIT_FIXTURE_KEYS.finalInvoiceNumber,
      totalAmount: new Prisma.Decimal(110),
      paidAmount: new Prisma.Decimal(90),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      issuedAt: new Date("2026-05-14T12:00:00.000Z"),
      closedAt: new Date("2026-05-14T12:15:00.000Z"),
    },
  });
  await prisma.invoiceLineItem.upsert({
    where: {
      invoiceId_sortOrder: {
        invoiceId: finalInvoice.id,
        sortOrder: 0,
      },
    },
    update: {
      lineType: InvoiceLineType.PACKAGE_BASE,
      description: packageRow.name,
      quantity: 1,
      unitPrice: packageRow.price,
      lineTotal: packageRow.price,
    },
    create: {
      invoiceId: finalInvoice.id,
      lineType: InvoiceLineType.PACKAGE_BASE,
      description: packageRow.name,
      quantity: 1,
      unitPrice: packageRow.price,
      lineTotal: packageRow.price,
      sortOrder: 0,
    },
  });
  await prisma.invoiceLineItem.upsert({
    where: {
      invoiceId_sortOrder: {
        invoiceId: finalInvoice.id,
        sortOrder: 1,
      },
    },
    update: {
      lineType: InvoiceLineType.ADD_ON,
      description: oldAddOnProduct.name,
      quantity: 1,
      unitPrice: oldAddOnProduct.canonicalPrice,
      lineTotal: oldAddOnProduct.canonicalPrice,
    },
    create: {
      invoiceId: finalInvoice.id,
      lineType: InvoiceLineType.ADD_ON,
      description: oldAddOnProduct.name,
      quantity: 1,
      unitPrice: oldAddOnProduct.canonicalPrice,
      lineTotal: oldAddOnProduct.canonicalPrice,
      sortOrder: 1,
    },
  });

  await applyDepositToFinalIfPresent(base.financialCaseId, finalInvoice.id, prisma);
  const existingFinalPayment = await prisma.payment.findFirst({
    where: {
      invoiceId: finalInvoice.id,
      financialCaseId: base.financialCaseId,
      paymentType: PaymentType.FINAL,
    },
    include: { allocations: true },
    orderBy: { createdAt: "asc" },
  });
  const finalPayment = existingFinalPayment
    ? existingFinalPayment
    : await createPaymentWithAllocation(
        {
          invoiceId: finalInvoice.id,
          financialCaseId: base.financialCaseId,
          amount: new Prisma.Decimal(90),
          method: PaymentMethod.CASH,
          paymentType: PaymentType.FINAL,
          paidAt: new Date("2026-05-14T12:10:00.000Z"),
        },
        prisma
      );
  if (existingFinalPayment && existingFinalPayment.allocations.length === 0) {
    await prisma.paymentAllocation.create({
      data: {
        paymentId: existingFinalPayment.id,
        invoiceId: finalInvoice.id,
        amount: existingFinalPayment.amount,
      },
    });
  }

  await recalculateInvoiceStatus(finalInvoice.id, prisma);
  await prisma.invoice.update({
    where: { id: finalInvoice.id },
    data: { status: InvoiceStatus.CLOSED, isLocked: true },
  });

  const [existingAdjustment, existingCreditNote] = await Promise.all([
    prisma.invoice.findFirst({
      where: {
        invoiceType: InvoiceType.ADJUSTMENT,
        parentInvoiceId: finalInvoice.id,
        notes: { startsWith: "Auto-ADJUSTMENT from order edit" },
      },
      select: { id: true },
    }),
    prisma.invoice.findFirst({
      where: {
        invoiceType: InvoiceType.CREDIT_NOTE,
        parentInvoiceId: finalInvoice.id,
        notes: { startsWith: "Auto-CREDIT_NOTE from order edit" },
      },
      select: { id: true },
    }),
  ]);
  if (existingAdjustment && existingCreditNote) {
    return {
      ...base,
      finalInvoiceId: finalInvoice.id,
      finalPaymentId: finalPayment.id,
      adjustmentInvoiceId: existingAdjustment.id,
      creditNoteInvoiceId: existingCreditNote.id,
    };
  }

  await prisma.orderAddOn.deleteMany({
    where: {
      orderId: order.id,
      productId: {
        in: [oldAddOnProduct.id, newAddOnProduct.id],
      },
    },
  });
  await prisma.orderAddOn.create({
    data: {
      orderId: order.id,
      orderPackageId: orderPackage.id,
      productId: newAddOnProduct.id,
      nameSnapshot: newAddOnProduct.name,
      priceSnapshot: newAddOnProduct.canonicalPrice,
      quantity: 1,
    },
  });

  await syncOrderInvoiceForFinancialEdit(prisma, {
    orderId: order.id,
    actorContext: { actorUserId: manager.id, actorRole: manager.role },
    previousAddOns: [
      {
        productId: oldAddOnProduct.id,
        name: oldAddOnProduct.name,
        price: oldAddOnProduct.canonicalPrice.toNumber(),
      },
    ],
    managerApprovedReductionByUserId: manager.id,
    managerApprovedReason: "Feature 76c mixed edit approval",
  });

  const [adjustmentInvoice, creditNoteInvoice] = await Promise.all([
    prisma.invoice.findFirstOrThrow({
      where: {
        invoiceType: InvoiceType.ADJUSTMENT,
        parentInvoiceId: finalInvoice.id,
        notes: { startsWith: "Auto-ADJUSTMENT from order edit" },
      },
      select: { id: true },
    }),
    prisma.invoice.findFirstOrThrow({
      where: {
        invoiceType: InvoiceType.CREDIT_NOTE,
        parentInvoiceId: finalInvoice.id,
        notes: { startsWith: "Auto-CREDIT_NOTE from order edit" },
      },
      select: { id: true },
    }),
  ]);

  return {
    ...base,
    finalInvoiceId: finalInvoice.id,
    finalPaymentId: finalPayment.id,
    adjustmentInvoiceId: adjustmentInvoice.id,
    creditNoteInvoiceId: creditNoteInvoice.id,
  };
}

export async function seedAllSharedFixtures(prisma: PrismaClient): Promise<void> {
  await makeCashDepositBookingFixture(prisma);
  await makeAdjustedBookingFixture(prisma);
  await makeAutoAdjustedBookingFixture(prisma);
  await makeRefundedBookingFixture(prisma);
  await makeCreditNotedBookingFixture(prisma);
  await makeMixedEditBookingFixture(prisma);
  await ensureLockSnapshotsForFixtureInvoices(prisma);
}
