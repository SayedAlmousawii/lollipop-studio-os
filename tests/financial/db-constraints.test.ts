import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test, { after } from "node:test";
import {
  BookingStatus,
  InvoiceLineType,
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
moduleWithLoader._load = function loadWithServerOnlyShim(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalModuleLoad.call(this, request, parent, isMain);
};

after(() => {
  moduleWithLoader._load = originalModuleLoad;
});

type FinancialContext = Awaited<ReturnType<typeof createFinancialContext>>;

test("financial DB constraints reject over-collection and adjustment chaining", async (t) => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [{ db }, invoices, payments] = await Promise.all([
        import("@/lib/db"),
        import("@/modules/invoices/invoice.service"),
        import("@/modules/payments/payment.service"),
      ]);

      await t.test("C2 rejects a second allocation above invoice total", async () => {
        const context = await createFinancialContext(db, "c2-insert");
        const invoice = await createInvoice(db, context, "c2-insert-final", {
          totalAmount: 100,
        });
        const firstPayment = await createPayment(db, context, invoice.id, "c2-insert-a", 60);
        await db.paymentAllocation.create({
          data: {
            paymentId: firstPayment.id,
            invoiceId: invoice.id,
            amount: new Prisma.Decimal(60),
          },
        });
        const secondPayment = await createPayment(db, context, invoice.id, "c2-insert-b", 60);

        await assert.rejects(
          () =>
            db.paymentAllocation.create({
              data: {
                paymentId: secondPayment.id,
                invoiceId: invoice.id,
                amount: new Prisma.Decimal(60),
              },
            }),
          /over-collection|check_violation|constraint failed/i
        );

        const allocationTotal = await sumAllocations(db, invoice.id);
        assert.equal(allocationTotal.toFixed(3), "60.000");
      });

      await t.test("C2 rejects updating an allocation above invoice total", async () => {
        const context = await createFinancialContext(db, "c2-update-up");
        const invoice = await createInvoice(db, context, "c2-update-up-final", {
          totalAmount: 100,
        });
        const payment = await createPayment(db, context, invoice.id, "c2-update-up", 100);
        const allocation = await db.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            invoiceId: invoice.id,
            amount: new Prisma.Decimal(100),
          },
        });

        await assert.rejects(
          () =>
            db.paymentAllocation.update({
              where: { id: allocation.id },
              data: { amount: new Prisma.Decimal(101) },
            }),
          /over-collection|check_violation|constraint failed/i
        );
      });

      await t.test("C2 permits updating an allocation downward", async () => {
        const context = await createFinancialContext(db, "c2-update-down");
        const invoice = await createInvoice(db, context, "c2-update-down-final", {
          totalAmount: 100,
        });
        const payment = await createPayment(db, context, invoice.id, "c2-update-down", 100);
        const allocation = await db.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            invoiceId: invoice.id,
            amount: new Prisma.Decimal(100),
          },
        });

        const updated = await db.paymentAllocation.update({
          where: { id: allocation.id },
          data: { amount: new Prisma.Decimal(80) },
        });

        assert.equal(updated.amount.toFixed(3), "80.000");
      });

      await t.test("C3 permits an ADJUSTMENT parented to a FINAL invoice", async () => {
        const context = await createFinancialContext(db, "c3-final-parent");
        const finalInvoice = await createInvoice(db, context, "c3-final-parent-final", {
          invoiceType: InvoiceType.FINAL,
        });

        const adjustment = await createInvoice(db, context, "c3-final-parent-adjustment", {
          invoiceType: InvoiceType.ADJUSTMENT,
          parentInvoiceId: finalInvoice.id,
        });

        assert.equal(adjustment.parentInvoiceId, finalInvoice.id);
      });

      await t.test("C3 rejects an ADJUSTMENT parented to another ADJUSTMENT", async () => {
        const context = await createFinancialContext(db, "c3-chain-insert");
        const finalInvoice = await createInvoice(db, context, "c3-chain-insert-final", {
          invoiceType: InvoiceType.FINAL,
        });
        const adjustment = await createInvoice(db, context, "c3-chain-insert-adjustment-1", {
          invoiceType: InvoiceType.ADJUSTMENT,
          parentInvoiceId: finalInvoice.id,
        });

        await assert.rejects(
          () =>
            createInvoice(db, context, "c3-chain-insert-adjustment-2", {
              invoiceType: InvoiceType.ADJUSTMENT,
              parentInvoiceId: adjustment.id,
            }),
          /ADJUSTMENT invoice cannot reference another ADJUSTMENT|check_violation|constraint failed/i
        );
      });

      await t.test("C3 only checks rows whose invoice type is ADJUSTMENT on update", async () => {
        const firstContext = await createFinancialContext(db, "c3-chain-update-a");
        const secondContext = await createFinancialContext(db, "c3-chain-update-b");
        const firstFinal = await createInvoice(db, firstContext, "c3-chain-update-final-1", {
          invoiceType: InvoiceType.FINAL,
        });
        const secondFinal = await createInvoice(db, secondContext, "c3-chain-update-final-2", {
          invoiceType: InvoiceType.FINAL,
        });
        const firstAdjustment = await createInvoice(
          db,
          firstContext,
          "c3-chain-update-adjustment-1",
          {
            invoiceType: InvoiceType.ADJUSTMENT,
            parentInvoiceId: firstFinal.id,
          }
        );
        const secondAdjustment = await createInvoice(
          db,
          secondContext,
          "c3-chain-update-adjustment-2",
          {
            invoiceType: InvoiceType.ADJUSTMENT,
            parentInvoiceId: secondFinal.id,
          }
        );

        const updatedFinal = await db.invoice.update({
          where: { id: secondFinal.id },
          data: { parentInvoiceId: firstAdjustment.id },
          select: { parentInvoiceId: true },
        });
        assert.equal(updatedFinal.parentInvoiceId, firstAdjustment.id);

        await assert.rejects(
          () =>
            db.invoice.update({
              where: { id: secondAdjustment.id },
              data: { parentInvoiceId: firstAdjustment.id },
            }),
          /ADJUSTMENT invoice cannot reference another ADJUSTMENT|check_violation|constraint failed/i
        );
      });

      await t.test("service-level guards still surface before DB constraints", async () => {
        const context = await createFinancialContext(db, "service-guards");
        const manager = await db.user.create({
          data: {
            id: "feature-80c-manager",
            name: "Feature 80c Manager",
            email: "feature-80c-manager@example.com",
            role: UserRole.MANAGER,
          },
        });
        const finalInvoice = await createInvoice(db, context, "service-guards-final", {
          invoiceType: InvoiceType.FINAL,
          totalAmount: 100,
          status: InvoiceStatus.ISSUED,
        });
        const adjustment = await createInvoice(db, context, "service-guards-adjustment", {
          invoiceType: InvoiceType.ADJUSTMENT,
          parentInvoiceId: finalInvoice.id,
        });

        await assert.rejects(
          () =>
            payments.recordPayment(
              finalInvoice.id,
              {
                amount: 101,
                method: PaymentMethod.CASH,
                paymentType: PaymentType.FINAL,
              },
              { actorUserId: manager.id, actorRole: manager.role }
            ),
          /Payment amount cannot exceed the remaining invoice balance/i
        );

        await assert.rejects(
          () =>
            invoices.createAdjustmentInvoice({
              parentFinalInvoiceId: adjustment.id,
              createdByUserId: manager.id,
              lines: [
                {
                  lineType: InvoiceLineType.MANUAL_SURCHARGE,
                  description: "Should fail before DB trigger",
                  quantity: 1,
                  unitPrice: 1,
                },
              ],
            }),
          /Adjustment invoices can only be created for final invoices/i
        );
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
});

async function createFinancialContext(
  db: PrismaClient,
  suffix: string
): Promise<{
  bookingId: string;
  customerId: string;
  financialCaseId: string;
}> {
  const customer = await db.customer.create({
    data: {
      name: `Feature 80c Customer ${suffix}`,
      phone: `+96580${numericSuffix(suffix)}`,
    },
  });
  const department = await db.studioDepartment.create({
    data: {
      code: `F80C_${slugSuffix(suffix)}`,
      name: `Feature 80c Department ${suffix}`,
      sortOrder: 80,
    },
  });
  const booking = await db.booking.create({
    data: {
      publicId: `BK-80C-${suffix}`,
      customerId: customer.id,
      departmentId: department.id,
      sessionDate: new Date("2026-05-16T08:00:00.000Z"),
      sessionTime: "10:00",
      status: BookingStatus.CONFIRMED,
    },
  });
  const financialCase = await db.financialCase.create({
    data: {
      bookingId: booking.id,
      customerId: customer.id,
    },
  });

  return {
    bookingId: booking.id,
    customerId: customer.id,
    financialCaseId: financialCase.id,
  };
}

async function createInvoice(
  db: PrismaClient,
  context: FinancialContext,
  suffix: string,
  options: {
    invoiceType?: InvoiceType;
    totalAmount?: number;
    parentInvoiceId?: string;
    status?: InvoiceStatus;
  } = {}
) {
  const totalAmount = new Prisma.Decimal(options.totalAmount ?? 100);

  return db.invoice.create({
    data: {
      publicId: `INV-80C-PUB-${suffix}`,
      financialCaseId: context.financialCaseId,
      invoiceType: options.invoiceType ?? InvoiceType.FINAL,
      customerId: context.customerId,
      invoiceNumber: `INV-80C-${suffix}`,
      totalAmount,
      remainingAmount: totalAmount,
      status: options.status ?? InvoiceStatus.ISSUED,
      parentInvoiceId: options.parentInvoiceId,
    },
  });
}

async function createPayment(
  db: PrismaClient,
  context: FinancialContext,
  invoiceId: string,
  suffix: string,
  amount: number
) {
  return db.payment.create({
    data: {
      publicId: `PAY-80C-${suffix}`,
      financialCaseId: context.financialCaseId,
      invoiceId,
      amount: new Prisma.Decimal(amount),
      direction: PaymentDirection.IN,
      method: PaymentMethod.CASH,
      paymentType: PaymentType.FINAL,
    },
  });
}

async function sumAllocations(
  db: PrismaClient,
  invoiceId: string
): Promise<Prisma.Decimal> {
  const aggregate = await db.paymentAllocation.aggregate({
    _sum: { amount: true },
    where: { invoiceId },
  });

  return aggregate._sum.amount ?? new Prisma.Decimal(0);
}

function numericSuffix(value: string): string {
  const digits = Array.from(value)
    .reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 11), 0)
    .toString()
    .padStart(8, "0");

  return digits.slice(-8);
}

function slugSuffix(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "_").slice(0, 48);
}
