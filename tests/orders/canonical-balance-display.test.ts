import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test from "node:test";
import {
  InvoiceStatus,
  InvoiceType,
  OrderSelectionStatus,
  PaymentMethod,
  PaymentType,
  Prisma,
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

type BookingService = typeof import("@/modules/bookings/booking.service");
type PhaseFFixturesModule = typeof import("../financial-phase-f/fixtures");
type PhaseFFixtures = Awaited<
  ReturnType<PhaseFFixturesModule["seedPhaseFFixtures"]>
>;

type CanonicalWorkflow = {
  bookingId: string;
  orderId: string;
  financialCaseId: string;
  depositInvoiceId: string;
  finalInvoiceId: string;
};

test("order POS and editing gates consume canonical invoice balances", async (t) => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [
        { db },
        bookingService,
        paymentService,
        orderService,
        phaseFFixtures,
      ] = await Promise.all([
        import("@/lib/db"),
        import("@/modules/bookings/booking.service"),
        import("@/modules/payments/payment.service"),
        import("@/modules/orders/order.service"),
        import("../financial-phase-f/fixtures"),
      ]);
      const fixtures = await phaseFFixtures.seedPhaseFFixtures(db);
      await db.package.update({
        where: { id: fixtures.basePackageId },
        data: { price: new Prisma.Decimal(230) },
      });

      await t.test("POS summary shows zero from Invoice.remainingAmount", async () => {
        const workflow = await buildCanonicalWorkflow({
          db,
          fixtures,
          bookingService,
          suffix: "canonical-a",
          depositAmount: 30,
        });

        try {
          await paymentService.recordPayment(
            workflow.finalInvoiceId,
            {
              amount: 200,
              method: PaymentMethod.CASH,
              paymentType: PaymentType.FINAL,
            },
            fixtures.adminActor
          );
          await db.invoice.update({
            where: { id: workflow.finalInvoiceId },
            data: { remainingAmount: new Prisma.Decimal(0) },
          });

          const workspace = await orderService.getPOSWorkspace(workflow.orderId);

          assert.equal(workspace?.invoice?.invoiceTotal, 230);
          assert.equal(workspace?.invoice?.paidAmount, 200);
          assert.equal(workspace?.invoice?.depositPaidAmount, 30);
          assert.equal(workspace?.invoice?.remainingAmount, 0);
        } finally {
          await phaseFFixtures.cleanupWorkflow(db, workflow);
        }
      });

      await t.test("POS summary reflects a direct canonical remaining mutation", async () => {
        const workflow = await buildCanonicalWorkflow({
          db,
          fixtures,
          bookingService,
          suffix: "canonical-b",
          depositAmount: 30,
        });

        try {
          await paymentService.recordPayment(
            workflow.finalInvoiceId,
            {
              amount: 100,
              method: PaymentMethod.CASH,
              paymentType: PaymentType.FINAL,
            },
            fixtures.adminActor
          );
          await db.invoice.update({
            where: { id: workflow.finalInvoiceId },
            data: { remainingAmount: new Prisma.Decimal(999) },
          });

          const workspace = await orderService.getPOSWorkspace(workflow.orderId);

          assert.equal(workspace?.invoice?.invoiceTotal, 230);
          assert.equal(workspace?.invoice?.paidAmount, 100);
          assert.equal(workspace?.invoice?.depositPaidAmount, 30);
          assert.equal(workspace?.invoice?.remainingAmount, 999);
        } finally {
          await phaseFFixtures.cleanupWorkflow(db, workflow);
        }
      });

      await t.test("editing start rejects a partially settled deposit invoice", async () => {
        const workflow = await buildCanonicalWorkflow({
          db,
          fixtures,
          bookingService,
          suffix: "canonical-c",
          depositAmount: 30,
        });

        try {
          await paymentService.recordPayment(
            workflow.finalInvoiceId,
            {
              amount: 200,
              method: PaymentMethod.CASH,
              paymentType: PaymentType.FINAL,
            },
            fixtures.adminActor
          );
          await db.invoice.update({
            where: { id: workflow.depositInvoiceId },
            data: {
              paidAmount: new Prisma.Decimal(15),
              remainingAmount: new Prisma.Decimal(15),
              status: InvoiceStatus.PARTIAL,
            },
          });
          await db.order.update({
            where: { id: workflow.orderId },
            data: { selectionStatus: OrderSelectionStatus.COMPLETED },
          });
          await orderService.updateOrderEditingWorkflow(
            workflow.orderId,
            { action: "assignEditor", assignedEditorId: fixtures.editorId },
            fixtures.adminActor
          );

          const editingWorkflow = await orderService.getOrderEditingWorkflowById(
            workflow.orderId
          );
          assert.equal(
            orderService.basePaymentSettled({
              booking: {
                financialCase: {
                  invoices: [
                    {
                      invoiceType: InvoiceType.DEPOSIT,
                      remainingAmount: new Prisma.Decimal(15),
                    },
                  ],
                },
              },
            }),
            false
          );
          assert.equal(editingWorkflow?.basePaymentVerified, false);
          assert.equal(editingWorkflow?.canMarkStarted, false);
          await assert.rejects(
            () =>
              orderService.updateOrderEditingWorkflow(
                workflow.orderId,
                { action: "markStarted" },
                fixtures.adminActor
              ),
            /base package payment|Failed to update editing workflow/
          );
        } finally {
          await phaseFFixtures.cleanupWorkflow(db, workflow);
        }
      });

      await t.test("basePaymentSettled allows orders without deposit invoices", () => {
        assert.equal(
          orderService.basePaymentSettled({
            booking: { financialCase: { invoices: [] } },
          }),
          true
        );
      });

      await t.test("basePaymentSettled accepts fully settled deposit invoices", () => {
        assert.equal(
          orderService.basePaymentSettled({
            booking: {
              financialCase: {
                invoices: [
                  {
                    invoiceType: InvoiceType.DEPOSIT,
                    remainingAmount: new Prisma.Decimal(0),
                  },
                ],
              },
            },
          }),
          true
        );
      });
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});

async function buildCanonicalWorkflow(input: {
  db: PrismaClient;
  fixtures: PhaseFFixtures;
  bookingService: BookingService;
  suffix: string;
  depositAmount: number;
}): Promise<CanonicalWorkflow> {
  const booking = await input.bookingService.createBookingInDb({
    phone: `+96577${String(hashSuffix(input.suffix) % 1_000_000).padStart(6, "0")}`,
    customerName: `Canonical Balance ${input.suffix}`,
    packages: [
      {
        packageId: input.fixtures.basePackageId,
        quantity: 1,
        sortOrder: 0,
      },
    ],
    sessionDate: new Date("2026-09-15T08:00:00.000Z"),
    sessionTime: "10:00",
    departmentId: input.fixtures.departmentId,
    themes: [],
  });

  await input.bookingService.recordBookingDeposit(
    {
      bookingId: booking.id,
      amount: input.depositAmount,
      method: PaymentMethod.CASH,
      reference: `canonical-${input.suffix}`,
    },
    input.fixtures.adminActor
  );

  const checkedIn = await input.bookingService.checkInBooking(
    {
      bookingId: booking.id,
      assignedPhotographerId: input.fixtures.photographerId,
      socialMediaConsent: true,
    },
    input.fixtures.adminActor
  );
  const stored = await input.db.booking.findUniqueOrThrow({
    where: { id: booking.id },
    select: {
      customerId: true,
      jobId: true,
      jobNumber: true,
      financialCase: { select: { id: true } },
      invoices: {
        where: { invoiceType: InvoiceType.DEPOSIT },
        select: { id: true },
        take: 1,
      },
    },
  });
  const finalInvoice = await input.db.invoice.create({
    data: {
      publicId: `canonical-final-${input.suffix}`,
      financialCaseId: stored.financialCase?.id ?? fail("missing financial case"),
      invoiceType: InvoiceType.FINAL,
      jobNumber: stored.jobNumber,
      jobId: stored.jobId,
      orderId: checkedIn.orderId,
      bookingId: booking.id,
      customerId: stored.customerId,
      invoiceNumber: `INV-CANONICAL-${input.suffix}`,
      totalAmount: new Prisma.Decimal(230),
      paidAmount: new Prisma.Decimal(0),
      remainingAmount: new Prisma.Decimal(230).minus(input.depositAmount),
      status: InvoiceStatus.ISSUED,
      issuedAt: new Date(),
    },
  });

  return {
    bookingId: booking.id,
    orderId: checkedIn.orderId,
    financialCaseId: stored.financialCase?.id ?? fail("missing financial case"),
    depositInvoiceId: stored.invoices[0]?.id ?? fail("missing deposit invoice"),
    finalInvoiceId: finalInvoice.id,
  };
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
