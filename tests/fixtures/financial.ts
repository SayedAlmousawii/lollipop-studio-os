import {
  BookingStatus,
  InvoiceStatus,
  InvoiceType,
  PaymentMethod,
  PaymentType,
  Prisma,
  PrismaClient,
} from "@prisma/client";

export type BookingFixtureResult = {
  customerId: string;
  departmentId: string;
  jobId: string;
  bookingId: string;
  financialCaseId: string;
  invoiceId: string;
  paymentId: string;
};

const FIXTURE_KEYS = {
  departmentCode: "FIN_FIXTURE_DEPT_73B",
  customerPhone: "+96550007300",
  jobNumber: "JOB-FIN-73B-BASE",
  bookingPublicId: "BK-FIN-73B-BASE",
  invoicePublicId: "INV-FIN-73B-DEP",
  invoiceNumber: "INV-FIN-73B-0001",
  paymentPublicId: "PAY-FIN-73B-DEP",
} as const;

export async function makeCashDepositBookingFixture(
  prisma: PrismaClient
): Promise<BookingFixtureResult> {
  const existingInvoice = await prisma.invoice.findUnique({
    where: { publicId: FIXTURE_KEYS.invoicePublicId },
    include: {
      booking: { select: { id: true, customerId: true, departmentId: true, jobId: true } },
      financialCase: { select: { id: true } },
      payments: { select: { id: true }, orderBy: { createdAt: "asc" } },
    },
  });

  if (
    existingInvoice &&
    existingInvoice.booking &&
    existingInvoice.booking.jobId &&
    existingInvoice.payments[0]
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
    where: { code: FIXTURE_KEYS.departmentCode },
    update: {
      name: "Financial Fixture Department",
      isActive: true,
      sortOrder: 73,
    },
    create: {
      code: FIXTURE_KEYS.departmentCode,
      name: "Financial Fixture Department",
      isActive: true,
      sortOrder: 73,
    },
  });

  const customer = await prisma.customer.upsert({
    where: { phone: FIXTURE_KEYS.customerPhone },
    update: {
      name: "Financial Fixture Customer",
    },
    create: {
      name: "Financial Fixture Customer",
      phone: FIXTURE_KEYS.customerPhone,
    },
  });

  const job = await prisma.job.upsert({
    where: { jobNumber: FIXTURE_KEYS.jobNumber },
    update: {
      customerId: customer.id,
    },
    create: {
      jobNumber: FIXTURE_KEYS.jobNumber,
      customerId: customer.id,
    },
  });

  const booking = await prisma.booking.upsert({
    where: { publicId: FIXTURE_KEYS.bookingPublicId },
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
      publicId: FIXTURE_KEYS.bookingPublicId,
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
    where: { publicId: FIXTURE_KEYS.invoicePublicId },
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
      status: InvoiceStatus.PAID,
      isLocked: true,
      issuedAt: new Date("2026-05-14T08:05:00.000Z"),
      closedAt: new Date("2026-05-14T08:10:00.000Z"),
    },
    create: {
      publicId: FIXTURE_KEYS.invoicePublicId,
      financialCaseId: financialCase.id,
      invoiceType: InvoiceType.DEPOSIT,
      jobId: job.id,
      jobNumber: job.jobNumber,
      bookingId: booking.id,
      customerId: customer.id,
      invoiceNumber: FIXTURE_KEYS.invoiceNumber,
      totalAmount: new Prisma.Decimal(20),
      paidAmount: new Prisma.Decimal(20),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.PAID,
      isLocked: true,
      issuedAt: new Date("2026-05-14T08:05:00.000Z"),
      closedAt: new Date("2026-05-14T08:10:00.000Z"),
    },
  });

  const payment = await prisma.payment.upsert({
    where: { publicId: FIXTURE_KEYS.paymentPublicId },
    update: {
      financialCaseId: financialCase.id,
      jobId: job.id,
      jobNumber: job.jobNumber,
      invoiceId: invoice.id,
      amount: new Prisma.Decimal(20),
      method: PaymentMethod.CASH,
      paymentType: PaymentType.DEPOSIT,
      paidAt: new Date("2026-05-14T08:09:00.000Z"),
    },
    create: {
      publicId: FIXTURE_KEYS.paymentPublicId,
      financialCaseId: financialCase.id,
      jobId: job.id,
      jobNumber: job.jobNumber,
      invoiceId: invoice.id,
      amount: new Prisma.Decimal(20),
      method: PaymentMethod.CASH,
      paymentType: PaymentType.DEPOSIT,
      paidAt: new Date("2026-05-14T08:09:00.000Z"),
    },
  });

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

export async function seedAllSharedFixtures(prisma: PrismaClient): Promise<void> {
  await makeCashDepositBookingFixture(prisma);
}
