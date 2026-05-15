import {
  BookingStatus,
  InvoiceLineType,
  InvoiceStatus,
  InvoiceType,
  OrderEditingStatus,
  OrderSelectionStatus,
  OrderStatus,
  PaymentDirection,
  PaymentMethod,
  PaymentType,
  Prisma,
  ProductCategory,
  UserRole,
  type PrismaClient,
} from "@prisma/client";

export type PhaseAFixtureIds = {
  pendingBookingId: string;
  confirmedBookingId: string;
  checkedInBookingId: string;
  financialCaseId: string;
  depositInvoiceId: string;
  finalInvoiceId: string;
  adjustmentInvoiceId: string;
  creditNoteInvoiceId: string;
  refundInvoiceId: string;
  finalPaymentId: string;
  orderId: string;
};

const FIXTURE_PREFIX = "phase-a-77";

async function createMissingLockSnapshots(db: PrismaClient): Promise<void> {
  const invoices = await db.invoice.findMany({
    where: { isLocked: true, lockSnapshots: { none: {} } },
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

  await db.invoiceLockSnapshot.createMany({
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

export async function seedPhaseAFinancialFixtures(
  db: PrismaClient
): Promise<PhaseAFixtureIds> {
  const manager = await db.user.create({
    data: {
      id: `${FIXTURE_PREFIX}-manager`,
      name: "Phase A Manager",
      email: "phase-a-manager@example.com",
      role: UserRole.MANAGER,
    },
  });

  const department = await db.studioDepartment.create({
    data: {
      id: `${FIXTURE_PREFIX}-department`,
      code: "PHASE_A",
      name: "Phase A Department",
      sortOrder: 77,
    },
  });

  const sessionType = await db.sessionType.create({
    data: {
      id: `${FIXTURE_PREFIX}-session`,
      code: "PHASE_A_SESSION",
      name: "Phase A Session",
      departmentId: department.id,
    },
  });

  const packageFamily = await db.packageFamily.create({
    data: {
      id: `${FIXTURE_PREFIX}-family`,
      code: "PHASE_A_FAMILY",
      name: "Phase A Family",
      sessionTypeId: sessionType.id,
    },
  });

  const packageRow = await db.package.create({
    data: {
      id: `${FIXTURE_PREFIX}-package`,
      name: "Phase A Package",
      price: new Prisma.Decimal(100),
      photoCount: 10,
      durationMinutes: 60,
      packageFamilyId: packageFamily.id,
    },
  });

  const product = await db.product.create({
    data: {
      id: `${FIXTURE_PREFIX}-addon-product`,
      name: "Phase A Add-on",
      category: ProductCategory.OTHER,
      canonicalPrice: new Prisma.Decimal(10),
      isAddOn: true,
    },
  });

  const packageItem = await db.packageItem.create({
    data: {
      id: `${FIXTURE_PREFIX}-package-item`,
      packageId: packageRow.id,
      productId: product.id,
      quantity: 1,
      priceSnapshot: new Prisma.Decimal(10),
    },
  });

  const [pendingCustomer, confirmedCustomer, checkedInCustomer] =
    await Promise.all([
      db.customer.create({
        data: {
          id: `${FIXTURE_PREFIX}-pending-customer`,
          name: "Phase A Pending Customer",
          phone: "+96577000001",
        },
      }),
      db.customer.create({
        data: {
          id: `${FIXTURE_PREFIX}-confirmed-customer`,
          name: "Phase A Confirmed Customer",
          phone: "+96577000002",
        },
      }),
      db.customer.create({
        data: {
          id: `${FIXTURE_PREFIX}-checked-in-customer`,
          name: "Phase A Checked In Customer",
          phone: "+96577000003",
        },
      }),
    ]);

  const pendingBooking = await db.booking.create({
    data: {
      id: `${FIXTURE_PREFIX}-pending-booking`,
      customerId: pendingCustomer.id,
      departmentId: department.id,
      status: BookingStatus.PENDING,
      sessionDate: new Date("2026-05-20T08:00:00.000Z"),
      sessionTime: "10:00",
    },
  });

  const confirmedBooking = await db.booking.create({
    data: {
      id: `${FIXTURE_PREFIX}-confirmed-booking`,
      publicId: "BK-PHASE-A-CONFIRMED",
      customerId: confirmedCustomer.id,
      departmentId: department.id,
      status: BookingStatus.CONFIRMED,
      sessionDate: new Date("2026-05-21T08:00:00.000Z"),
      sessionTime: "11:00",
      packages: {
        create: {
          id: `${FIXTURE_PREFIX}-confirmed-booking-package`,
          packageId: packageRow.id,
          sessionTypeId: sessionType.id,
        },
      },
    },
  });

  const confirmedCase = await db.financialCase.create({
    data: {
      id: `${FIXTURE_PREFIX}-confirmed-case`,
      bookingId: confirmedBooking.id,
      customerId: confirmedCustomer.id,
    },
  });

  const confirmedDeposit = await db.invoice.create({
    data: {
      id: `${FIXTURE_PREFIX}-confirmed-deposit`,
      publicId: "INV-PHASE-A-CONF-DEP",
      invoiceNumber: "DEP-PHASE-A-CONF",
      financialCaseId: confirmedCase.id,
      invoiceType: InvoiceType.DEPOSIT,
      bookingId: confirmedBooking.id,
      customerId: confirmedCustomer.id,
      totalAmount: new Prisma.Decimal(20),
      paidAmount: new Prisma.Decimal(20),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      issuedAt: new Date("2026-05-21T08:05:00.000Z"),
      closedAt: new Date("2026-05-21T08:10:00.000Z"),
    },
  });

  await createPaymentWithAllocation(db, {
    id: `${FIXTURE_PREFIX}-confirmed-deposit-payment`,
    publicId: "PAY-PHASE-A-CONF-DEP",
    financialCaseId: confirmedCase.id,
    invoiceId: confirmedDeposit.id,
    amount: new Prisma.Decimal(20),
    method: PaymentMethod.CASH,
    paymentType: PaymentType.DEPOSIT,
    paidAt: new Date("2026-05-21T08:09:00.000Z"),
  });

  const job = await db.job.create({
    data: {
      id: `${FIXTURE_PREFIX}-job`,
      jobNumber: "JOB-PHASE-A-0001",
      customerId: checkedInCustomer.id,
    },
  });

  const checkedInBooking = await db.booking.create({
    data: {
      id: `${FIXTURE_PREFIX}-checked-in-booking`,
      publicId: "BK-PHASE-A-CHECKED-IN",
      jobId: job.id,
      jobNumber: job.jobNumber,
      customerId: checkedInCustomer.id,
      departmentId: department.id,
      status: BookingStatus.CHECKED_IN,
      sessionDate: new Date("2026-05-22T08:00:00.000Z"),
      sessionTime: "12:00",
      packages: {
        create: {
          id: `${FIXTURE_PREFIX}-checked-in-booking-package`,
          packageId: packageRow.id,
          sessionTypeId: sessionType.id,
        },
      },
    },
  });

  const financialCase = await db.financialCase.create({
    data: {
      id: `${FIXTURE_PREFIX}-case`,
      bookingId: checkedInBooking.id,
      customerId: checkedInCustomer.id,
      jobId: job.id,
    },
  });

  const order = await db.order.create({
    data: {
      id: `${FIXTURE_PREFIX}-order`,
      publicId: "ORD-PHASE-A-0001",
      jobNumber: job.jobNumber,
      jobId: job.id,
      bookingId: checkedInBooking.id,
      customerId: checkedInCustomer.id,
      status: OrderStatus.EDITING,
      selectionStatus: OrderSelectionStatus.COMPLETED,
      packages: {
        create: {
          id: `${FIXTURE_PREFIX}-order-package`,
          packageId: packageRow.id,
          sessionTypeId: sessionType.id,
          originalPackagePriceSnapshot: new Prisma.Decimal(100),
          finalPackagePriceSnapshot: new Prisma.Decimal(100),
          selectedPhotoCount: 10,
        },
      },
      editingJob: {
        create: {
          id: `${FIXTURE_PREFIX}-editing-job`,
          jobId: job.id,
          status: OrderEditingStatus.IN_PROGRESS,
          editingStartedAt: new Date("2026-05-22T10:00:00.000Z"),
        },
      },
    },
  });

  await db.orderAddOn.create({
    data: {
      id: `${FIXTURE_PREFIX}-order-addon`,
      orderId: order.id,
      orderPackageId: `${FIXTURE_PREFIX}-order-package`,
      productId: product.id,
      nameSnapshot: product.name,
      priceSnapshot: product.canonicalPrice,
      quantity: 1,
    },
  });

  await db.orderPackageItemUpgrade.create({
    data: {
      id: `${FIXTURE_PREFIX}-order-upgrade`,
      orderId: order.id,
      orderPackageId: `${FIXTURE_PREFIX}-order-package`,
      packageItemId: packageItem.id,
      nameSnapshot: "Phase A Upgrade",
      priceSnapshot: new Prisma.Decimal(5),
      quantity: 1,
    },
  });

  const depositInvoice = await db.invoice.create({
    data: {
      id: `${FIXTURE_PREFIX}-deposit`,
      publicId: "INV-PHASE-A-DEP",
      invoiceNumber: "DEP-PHASE-A-0001",
      financialCaseId: financialCase.id,
      invoiceType: InvoiceType.DEPOSIT,
      jobId: job.id,
      jobNumber: job.jobNumber,
      bookingId: checkedInBooking.id,
      customerId: checkedInCustomer.id,
      totalAmount: new Prisma.Decimal(20),
      paidAmount: new Prisma.Decimal(20),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      issuedAt: new Date("2026-05-22T08:05:00.000Z"),
      closedAt: new Date("2026-05-22T08:10:00.000Z"),
    },
  });

  await createPaymentWithAllocation(db, {
    id: `${FIXTURE_PREFIX}-deposit-payment`,
    publicId: "PAY-PHASE-A-DEP",
    financialCaseId: financialCase.id,
    invoiceId: depositInvoice.id,
    amount: new Prisma.Decimal(20),
    method: PaymentMethod.CASH,
    paymentType: PaymentType.DEPOSIT,
    paidAt: new Date("2026-05-22T08:09:00.000Z"),
  });

  const finalInvoice = await db.invoice.create({
    data: {
      id: `${FIXTURE_PREFIX}-final`,
      publicId: "INV-PHASE-A-FINAL",
      invoiceNumber: "INV-PHASE-A-0001",
      financialCaseId: financialCase.id,
      invoiceType: InvoiceType.FINAL,
      jobId: job.id,
      jobNumber: job.jobNumber,
      orderId: order.id,
      bookingId: checkedInBooking.id,
      customerId: checkedInCustomer.id,
      totalAmount: new Prisma.Decimal(100),
      paidAmount: new Prisma.Decimal(80),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      issuedAt: new Date("2026-05-22T09:00:00.000Z"),
      closedAt: new Date("2026-05-22T09:15:00.000Z"),
      lineItems: {
        create: {
          lineType: InvoiceLineType.PACKAGE_BASE,
          description: "Phase A Package",
          quantity: 1,
          unitPrice: new Prisma.Decimal(100),
          lineTotal: new Prisma.Decimal(100),
          sortOrder: 0,
        },
      },
    },
  });

  await db.documentApplication.create({
    data: {
      id: `${FIXTURE_PREFIX}-deposit-final-application`,
      sourceInvoiceId: depositInvoice.id,
      targetInvoiceId: finalInvoice.id,
      amountApplied: new Prisma.Decimal(20),
      appliedByUserId: manager.id,
      notes: "Phase A deposit application",
    },
  });

  const finalPayment = await createPaymentWithAllocation(db, {
    id: `${FIXTURE_PREFIX}-final-payment`,
    publicId: "PAY-PHASE-A-FINAL",
    financialCaseId: financialCase.id,
    invoiceId: finalInvoice.id,
    amount: new Prisma.Decimal(80),
    method: PaymentMethod.CASH,
    paymentType: PaymentType.FINAL,
    paidAt: new Date("2026-05-22T09:10:00.000Z"),
  });

  const adjustmentInvoice = await db.invoice.create({
    data: {
      id: `${FIXTURE_PREFIX}-adjustment`,
      publicId: "INV-PHASE-A-ADJ",
      invoiceNumber: "ADJ-PHASE-A-0001",
      financialCaseId: financialCase.id,
      invoiceType: InvoiceType.ADJUSTMENT,
      parentInvoiceId: finalInvoice.id,
      jobId: job.id,
      jobNumber: job.jobNumber,
      orderId: order.id,
      bookingId: checkedInBooking.id,
      customerId: checkedInCustomer.id,
      totalAmount: new Prisma.Decimal(15),
      remainingAmount: new Prisma.Decimal(15),
      status: InvoiceStatus.ISSUED,
      notes: "Phase A adjustment",
      lineItems: {
        create: {
          lineType: InvoiceLineType.ADD_ON,
          description: "Phase A additive edit",
          quantity: 1,
          unitPrice: new Prisma.Decimal(15),
          lineTotal: new Prisma.Decimal(15),
          sortOrder: 0,
        },
      },
    },
  });

  const creditNoteInvoice = await db.invoice.create({
    data: {
      id: `${FIXTURE_PREFIX}-credit-note`,
      publicId: "INV-PHASE-A-CN",
      invoiceNumber: "CN-PHASE-A-0001",
      financialCaseId: financialCase.id,
      invoiceType: InvoiceType.CREDIT_NOTE,
      parentInvoiceId: finalInvoice.id,
      jobId: job.id,
      jobNumber: job.jobNumber,
      orderId: order.id,
      bookingId: checkedInBooking.id,
      customerId: checkedInCustomer.id,
      totalAmount: new Prisma.Decimal(10),
      paidAmount: new Prisma.Decimal(10),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      notes: "Phase A credit note",
      closedAt: new Date("2026-05-22T09:20:00.000Z"),
      lineItems: {
        create: {
          lineType: InvoiceLineType.MANUAL_DISCOUNT,
          description: "Phase A credit",
          quantity: 1,
          unitPrice: new Prisma.Decimal(10),
          lineTotal: new Prisma.Decimal(10),
          sortOrder: 0,
        },
      },
    },
  });

  await db.documentApplication.create({
    data: {
      id: `${FIXTURE_PREFIX}-credit-note-application`,
      sourceInvoiceId: creditNoteInvoice.id,
      targetInvoiceId: finalInvoice.id,
      amountApplied: new Prisma.Decimal(10),
      appliedByUserId: manager.id,
      notes: "Phase A credit note application",
    },
  });

  const refundInvoice = await db.invoice.create({
    data: {
      id: `${FIXTURE_PREFIX}-refund`,
      publicId: "INV-PHASE-A-REF",
      invoiceNumber: "REF-PHASE-A-0001",
      financialCaseId: financialCase.id,
      invoiceType: InvoiceType.REFUND,
      parentInvoiceId: finalInvoice.id,
      jobId: job.id,
      jobNumber: job.jobNumber,
      orderId: order.id,
      bookingId: checkedInBooking.id,
      customerId: checkedInCustomer.id,
      totalAmount: new Prisma.Decimal(10),
      paidAmount: new Prisma.Decimal(10),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      notes: "Phase A refund",
      closedAt: new Date("2026-05-22T09:25:00.000Z"),
      lineItems: {
        create: {
          lineType: InvoiceLineType.MANUAL_DISCOUNT,
          description: "Phase A refund",
          quantity: 1,
          unitPrice: new Prisma.Decimal(10),
          lineTotal: new Prisma.Decimal(10),
          sortOrder: 0,
        },
      },
    },
  });

  await createPaymentWithAllocation(db, {
    id: `${FIXTURE_PREFIX}-refund-payment`,
    publicId: "PAY-PHASE-A-REF",
    financialCaseId: financialCase.id,
    invoiceId: refundInvoice.id,
    amount: new Prisma.Decimal(10),
    method: PaymentMethod.CASH,
    paymentType: PaymentType.REFUND,
    direction: PaymentDirection.OUT,
    refundOfPaymentId: finalPayment.id,
    paidAt: new Date("2026-05-22T09:24:00.000Z"),
  });

  await createMissingLockSnapshots(db);

  return {
    pendingBookingId: pendingBooking.id,
    confirmedBookingId: confirmedBooking.id,
    checkedInBookingId: checkedInBooking.id,
    financialCaseId: financialCase.id,
    depositInvoiceId: depositInvoice.id,
    finalInvoiceId: finalInvoice.id,
    adjustmentInvoiceId: adjustmentInvoice.id,
    creditNoteInvoiceId: creditNoteInvoice.id,
    refundInvoiceId: refundInvoice.id,
    finalPaymentId: finalPayment.id,
    orderId: order.id,
  };
}

async function createPaymentWithAllocation(
  db: PrismaClient,
  data: {
    id: string;
    publicId: string;
    financialCaseId: string;
    invoiceId: string;
    amount: Prisma.Decimal;
    method: PaymentMethod;
    paymentType: PaymentType;
    direction?: PaymentDirection;
    refundOfPaymentId?: string;
    paidAt: Date;
  }
) {
  const payment = await db.payment.create({
    data: {
      id: data.id,
      publicId: data.publicId,
      financialCaseId: data.financialCaseId,
      invoiceId: data.invoiceId,
      amount: data.amount,
      method: data.method,
      paymentType: data.paymentType,
      direction: data.direction ?? PaymentDirection.IN,
      refundOfPaymentId: data.refundOfPaymentId,
      paidAt: data.paidAt,
    },
  });

  await db.paymentAllocation.create({
    data: {
      id: `${data.id}-allocation`,
      paymentId: payment.id,
      invoiceId: data.invoiceId,
      amount: data.amount,
    },
  });

  return payment;
}
