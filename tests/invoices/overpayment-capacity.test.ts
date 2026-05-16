import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test from "node:test";
import {
  BookingStatus,
  InvoiceStatus,
  InvoiceType,
  PaymentDirection,
  PaymentMethod,
  PaymentType,
  Prisma,
  UserRole,
  type PrismaClient,
} from "@prisma/client";
import { withIsolatedBackendInvariantSchema } from "../backend-invariants/harness";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;

test("invoice overpayment capacity bounds refunds to true overpayment", async (t) => {
  moduleWithLoader._load = function loadWithServerOnlyShim(request, parent, isMain) {
    if (request === "server-only") return {};
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
      const previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = databaseUrl;

      try {
        const [
          { db },
          invoices,
          invoiceCalculations,
          refunds,
          refundUtils,
        ] = await Promise.all([
          import("@/lib/db"),
          import("@/modules/invoices/invoice.service"),
          import("@/modules/invoices/invoice.calculation"),
          import("@/modules/refunds/refund.service"),
          import("@/lib/invoices/refund-utils"),
        ]);

        const fixture = await seedOverpaymentFixture(db);

        await t.test("paid below invoice total has zero capacity", async () => {
          const source = await createSourceInvoice(db, fixture, "a", {
            total: "230",
            paid: "210",
          });

          const capacity = await invoices.computeOverpaymentCapacity(source.id, db);
          assert.equal(capacity.toFixed(3), "0.000");
        });

        await t.test("full payment plus credit note exposes only the excess", async () => {
          const source = await createSourceInvoice(db, fixture, "b", {
            total: "250",
            paid: "250",
            creditNote: "20",
          });

          const capacity = await invoices.computeOverpaymentCapacity(source.id, db);
          assert.equal(capacity.toFixed(3), "20.000");
          await assertOverpaymentCapacityInvariant(
            db,
            invoices,
            invoiceCalculations,
            source.id
          );
        });

        await t.test("credit notes reduce net owed before capacity is calculated", async () => {
          const source = await createSourceInvoice(db, fixture, "c", {
            total: "230",
            paid: "210",
            creditNote: "50",
          });

          const capacity = await invoices.computeOverpaymentCapacity(source.id, db);
          assert.equal(capacity.toFixed(3), "30.000");
          await assertOverpaymentCapacityInvariant(
            db,
            invoices,
            invoiceCalculations,
            source.id
          );
        });

        await t.test("prior refunds reduce remaining capacity", async () => {
          const source = await createSourceInvoice(db, fixture, "d", {
            total: "250",
            paid: "250",
            creditNote: "20",
            priorRefund: "15",
          });

          const capacity = await invoices.computeOverpaymentCapacity(source.id, db);
          assert.equal(capacity.toFixed(3), "5.000");
          await assertOverpaymentCapacityInvariant(
            db,
            invoices,
            invoiceCalculations,
            source.id
          );
        });

        await t.test("deposit applications and credit notes expose true overpayment", async () => {
          const source = await createSourceInvoice(db, fixture, "h", {
            total: "198",
            paid: "178",
            depositApplied: "20",
            creditNote: "3",
          });

          const capacity = await invoices.computeOverpaymentCapacity(source.id, db);
          assert.equal(capacity.toFixed(3), "3.000");
          await assertOverpaymentCapacityInvariant(
            db,
            invoices,
            invoiceCalculations,
            source.id
          );
        });

        await t.test("deposit-settled credit note detail shows refund capacity", async () => {
          const source = await createSourceInvoice(db, fixture, "i", {
            total: "198",
            paid: "178",
            depositApplied: "20",
            creditNote: "3",
            withOrder: true,
          });

          const detail = await invoices.getInvoiceById(source.id);
          assert.equal(detail?.overpaymentCapacity, "3.000 KD");
          assert.equal(
            refundUtils.shouldShowRefundForm(detail?.overpaymentCapacity ?? null),
            true
          );
          await assertOverpaymentCapacityInvariant(
            db,
            invoices,
            invoiceCalculations,
            source.id
          );
        });

        await t.test("refund creation rejects requests above capacity", async () => {
          const source = await createSourceInvoice(db, fixture, "e", {
            total: "250",
            paid: "250",
            creditNote: "20",
          });

          await assert.rejects(
            () =>
              refunds.issueRefundWithPayment({
                sourceInvoiceId: source.id,
                amount: 50,
                reason: "Over capacity",
                createdByUserId: fixture.managerId,
                method: PaymentMethod.CASH,
              }),
            /Refund amount 50\.000 KD exceeds overpayment capacity 20\.000 KD/
          );
        });

        await t.test("zero-capacity detail emits the renamed API field and hides refund form", async () => {
          const source = await createSourceInvoice(db, fixture, "f", {
            total: "230",
            paid: "210",
          });

          const detail = await invoices.getInvoiceById(source.id);
          assert.equal(detail?.overpaymentCapacity, "0.000 KD");
          assert.equal(
            refundUtils.shouldShowRefundForm(detail?.overpaymentCapacity ?? null),
            false
          );
        });

        await t.test("concurrent refunds cannot both consume the same capacity", async () => {
          const source = await createSourceInvoice(db, fixture, "g", {
            total: "250",
            paid: "250",
            creditNote: "20",
          });

          const results = await Promise.allSettled([
            refunds.issueRefundWithPayment({
              sourceInvoiceId: source.id,
              amount: 15,
              reason: "Concurrent refund A",
              createdByUserId: fixture.managerId,
              method: PaymentMethod.CASH,
            }),
            refunds.issueRefundWithPayment({
              sourceInvoiceId: source.id,
              amount: 15,
              reason: "Concurrent refund B",
              createdByUserId: fixture.managerId,
              method: PaymentMethod.KNET,
            }),
          ]);

          assert.equal(
            results.filter((result) => result.status === "fulfilled").length,
            1
          );
          assert.equal(
            results.filter((result) => result.status === "rejected").length,
            1
          );
          const rejected = results.find((result) => result.status === "rejected");
          assert.match(
            rejected?.status === "rejected" && rejected.reason instanceof Error
              ? rejected.reason.message
              : "",
            /exceeds overpayment capacity/
          );

          const refundInvoices = await db.invoice.findMany({
            where: { parentInvoiceId: source.id, invoiceType: InvoiceType.REFUND },
            select: { totalAmount: true },
          });
          const capacity = await invoices.computeOverpaymentCapacity(source.id, db);

          assert.equal(refundInvoices.length, 1);
          assert.equal(refundInvoices[0]?.totalAmount.toFixed(3), "15.000");
          assert.equal(capacity.toFixed(3), "5.000");
        });

        await db.$disconnect();
      } finally {
        if (previousDatabaseUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = previousDatabaseUrl;
        }
      }
    });
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
});

async function seedOverpaymentFixture(db: PrismaClient) {
  const manager = await db.user.create({
    data: {
      id: "overpayment-capacity-manager",
      name: "Overpayment Capacity Manager",
      email: "overpayment-capacity-manager@example.com",
      role: UserRole.MANAGER,
    },
  });
  const department = await db.studioDepartment.create({
    data: {
      id: "overpayment-capacity-department",
      code: "OVERPAY_CAPACITY",
      name: "Overpayment Capacity",
    },
  });

  return {
    managerId: manager.id,
    departmentId: department.id,
  };
}

async function createSourceInvoice(
  db: PrismaClient,
  fixture: Awaited<ReturnType<typeof seedOverpaymentFixture>>,
  suffix: string,
  options: {
    total: string;
    paid: string;
    depositApplied?: string;
    creditNote?: string;
    priorRefund?: string;
    withOrder?: boolean;
  }
) {
  const customer = await db.customer.create({
    data: {
      id: `overpayment-capacity-customer-${suffix}`,
      name: `Overpayment Capacity Customer ${suffix}`,
      phone: `+9657000000${suffix}`,
    },
  });
  const booking = await db.booking.create({
    data: {
      id: `overpayment-capacity-booking-${suffix}`,
      customerId: customer.id,
      departmentId: fixture.departmentId,
      sessionDate: new Date("2026-05-15T09:00:00.000Z"),
      sessionTime: "12:00",
      status: BookingStatus.CONFIRMED,
    },
  });
  const financialCase = await db.financialCase.create({
    data: {
      id: `overpayment-capacity-case-${suffix}`,
      bookingId: booking.id,
      customerId: customer.id,
    },
  });

  let orderId: string | undefined;
  let jobId: string | undefined;
  let jobNumber: string | undefined;
  if (options.withOrder) {
    const job = await db.job.create({
      data: {
        id: `overpayment-capacity-job-${suffix}`,
        jobNumber: `JOB-OVERPAY-${suffix}`,
        customerId: customer.id,
      },
    });
    await db.booking.update({
      where: { id: booking.id },
      data: { jobId: job.id, jobNumber: job.jobNumber },
    });
    await db.financialCase.update({
      where: { id: financialCase.id },
      data: { jobId: job.id },
    });
    const order = await db.order.create({
      data: {
        id: `overpayment-capacity-order-${suffix}`,
        publicId: `ORD-OVERPAY-${suffix}`,
        jobId: job.id,
        jobNumber: job.jobNumber,
        bookingId: booking.id,
        customerId: customer.id,
      },
    });
    orderId = order.id;
    jobId = job.id;
    jobNumber = job.jobNumber;
  }

  const depositApplied = new Prisma.Decimal(options.depositApplied ?? 0);
  const initialApplied = new Prisma.Decimal(options.paid).plus(depositApplied);
  const invoice = await db.invoice.create({
    data: {
      publicId: `INV-OVERPAY-${suffix}`,
      financialCaseId: financialCase.id,
      invoiceType: InvoiceType.FINAL,
      bookingId: booking.id,
      jobId,
      jobNumber,
      orderId,
      customerId: customer.id,
      invoiceNumber: `INV-OVERPAY-${suffix}`,
      totalAmount: new Prisma.Decimal(options.total),
      paidAmount: new Prisma.Decimal(0),
      remainingAmount: Prisma.Decimal.max(
        new Prisma.Decimal(options.total).minus(initialApplied),
        0
      ),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      issuedAt: new Date(),
      closedAt: new Date(),
    },
  });

  if (options.depositApplied) {
    const depositInvoice = await db.invoice.create({
      data: {
        publicId: `DEP-OVERPAY-${suffix}`,
        financialCaseId: financialCase.id,
        invoiceType: InvoiceType.DEPOSIT,
        bookingId: booking.id,
        jobId,
        jobNumber,
        customerId: customer.id,
        invoiceNumber: `DEP-OVERPAY-${suffix}`,
        totalAmount: depositApplied,
        paidAmount: depositApplied,
        remainingAmount: new Prisma.Decimal(0),
        status: InvoiceStatus.CLOSED,
        isLocked: true,
        issuedAt: new Date(),
        closedAt: new Date(),
      },
    });
    await createInboundPayment(
      db,
      financialCase.id,
      depositInvoice.id,
      `${suffix}-deposit`,
      options.depositApplied,
      PaymentType.DEPOSIT
    );
    await db.documentApplication.create({
      data: {
        sourceInvoiceId: depositInvoice.id,
        targetInvoiceId: invoice.id,
        amountApplied: depositApplied,
        appliedByUserId: fixture.managerId,
      },
    });
  }

  await createInboundPayment(db, financialCase.id, invoice.id, suffix, options.paid);

  if (options.creditNote) {
    const creditNote = await db.invoice.create({
      data: {
        publicId: `CN-OVERPAY-${suffix}`,
        financialCaseId: financialCase.id,
        invoiceType: InvoiceType.CREDIT_NOTE,
        bookingId: booking.id,
        customerId: customer.id,
        parentInvoiceId: invoice.id,
        invoiceNumber: `CN-OVERPAY-${suffix}`,
        totalAmount: new Prisma.Decimal(options.creditNote),
        paidAmount: new Prisma.Decimal(0),
        remainingAmount: new Prisma.Decimal(0),
        status: InvoiceStatus.CLOSED,
        isLocked: true,
        issuedAt: new Date(),
        closedAt: new Date(),
      },
    });
    await db.documentApplication.create({
      data: {
        sourceInvoiceId: creditNote.id,
        targetInvoiceId: invoice.id,
        amountApplied: new Prisma.Decimal(options.creditNote),
        appliedByUserId: fixture.managerId,
      },
    });
  }

  if (options.priorRefund) {
    await db.invoice.create({
      data: {
        publicId: `REF-OVERPAY-${suffix}`,
        financialCaseId: financialCase.id,
        invoiceType: InvoiceType.REFUND,
        bookingId: booking.id,
        customerId: customer.id,
        parentInvoiceId: invoice.id,
        invoiceNumber: `REF-OVERPAY-${suffix}`,
        totalAmount: new Prisma.Decimal(options.priorRefund),
        paidAmount: new Prisma.Decimal(0),
        remainingAmount: new Prisma.Decimal(options.priorRefund),
        status: InvoiceStatus.ISSUED,
        isLocked: false,
        issuedAt: new Date(),
      },
    });
  }

  return invoice;
}

async function createInboundPayment(
  db: PrismaClient,
  financialCaseId: string,
  invoiceId: string,
  suffix: string,
  amount: string,
  paymentType: PaymentType = PaymentType.FINAL
): Promise<void> {
  const payment = await db.payment.create({
    data: {
      publicId: `PAY-OVERPAY-${suffix}`,
      financialCaseId,
      invoiceId,
      amount: new Prisma.Decimal(amount),
      direction: PaymentDirection.IN,
      method: PaymentMethod.CASH,
      paymentType,
    },
  });

  await db.paymentAllocation.create({
    data: {
      paymentId: payment.id,
      invoiceId,
      amount: new Prisma.Decimal(amount),
    },
  });
}

async function assertOverpaymentCapacityInvariant(
  db: PrismaClient,
  invoices: typeof import("@/modules/invoices/invoice.service"),
  invoiceCalculations: typeof import("@/modules/invoices/invoice.calculation"),
  invoiceId: string
): Promise<void> {
  const [invoice, priorRefunds, capacity, effectivePaid] = await Promise.all([
    db.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { totalAmount: true, invoiceType: true, isLocked: true },
    }),
    db.invoice.aggregate({
      _sum: { totalAmount: true },
      where: {
        parentInvoiceId: invoiceId,
        invoiceType: InvoiceType.REFUND,
      },
    }),
    invoices.computeOverpaymentCapacity(invoiceId, db),
    invoiceCalculations.computeEffectivePaidFromAllocations(invoiceId, db),
  ]);
  assert.equal(invoice.invoiceType, InvoiceType.FINAL);
  assert.equal(invoice.isLocked, true);

  const refunded = priorRefunds._sum.totalAmount ?? new Prisma.Decimal(0);
  const expectedCapacity = Prisma.Decimal.max(
    effectivePaid.minus(invoice.totalAmount).minus(refunded),
    0
  );

  assert.equal(capacity.toFixed(3), expectedCapacity.toFixed(3));
}
