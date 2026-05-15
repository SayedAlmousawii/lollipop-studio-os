import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test from "node:test";
import {
  InvoiceStatus,
  PaymentMethod,
  PaymentType,
  Prisma,
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

test("settlement transaction enforces row locking and auto-locks final invoices", async (t) => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [{ db }, phaseFFixtures, payments] = await Promise.all([
        import("@/lib/db"),
        import("../financial-phase-f/fixtures"),
        import("@/modules/payments/payment.service"),
      ]);

      const fixtures = await phaseFFixtures.seedPhaseFFixtures(db);

      await t.test("concurrent full-payment submissions allow exactly one winner", async () => {
        await db.package.update({
          where: { id: fixtures.basePackageId },
          data: { price: new Prisma.Decimal(500) },
        });
        const workflow = await phaseFFixtures.buildFinalInvoiceWorkflowFixture(
          db,
          fixtures,
          "settlement-a",
          { issue: true }
        );

        try {
          const results = await Promise.allSettled([
            payments.recordPayment(
              workflow.finalInvoiceId,
              {
                amount: 480,
                method: PaymentMethod.CASH,
                paymentType: PaymentType.FINAL,
              },
              fixtures.adminActor
            ),
            payments.recordPayment(
              workflow.finalInvoiceId,
              {
                amount: 480,
                method: PaymentMethod.KNET,
                paymentType: PaymentType.FINAL,
              },
              fixtures.adminActor
            ),
          ]);

          const storedPayments = await db.payment.findMany({
            where: {
              invoiceId: workflow.finalInvoiceId,
              paymentType: PaymentType.FINAL,
            },
            include: { allocations: true },
          });
          const invoice = await db.invoice.findUniqueOrThrow({
            where: { id: workflow.finalInvoiceId },
            select: { remainingAmount: true, status: true, isLocked: true },
          });

          assert.equal(
            results.filter((result) => result.status === "fulfilled").length,
            1
          );
          assert.equal(
            results.filter((result) => result.status === "rejected").length,
            1
          );
          assert.equal(storedPayments.length, 1);
          assert.equal(storedPayments[0]?.allocations.length, 1);
          assert.equal(storedPayments[0]?.amount.toFixed(3), "480.000");
          assert.equal(invoice.remainingAmount.toFixed(3), "0.000");
          assert.equal(invoice.status, InvoiceStatus.CLOSED);
          assert.equal(invoice.isLocked, true);
        } finally {
          await phaseFFixtures.cleanupWorkflow(db, workflow);
        }
      });

      await t.test("the final settlement cent closes and locks an issued FINAL invoice", async () => {
        await db.package.update({
          where: { id: fixtures.basePackageId },
          data: { price: new Prisma.Decimal(250) },
        });
        const workflow = await phaseFFixtures.buildFinalInvoiceWorkflowFixture(
          db,
          fixtures,
          "settlement-b",
          { issue: true, finalPaymentAmounts: [229] }
        );

        try {
          const partiallyPaid = await db.invoice.findUniqueOrThrow({
            where: { id: workflow.finalInvoiceId },
            select: { remainingAmount: true, status: true, isLocked: true },
          });
          assert.equal(partiallyPaid.remainingAmount.toFixed(3), "1.000");
          assert.equal(partiallyPaid.status, InvoiceStatus.PARTIAL);
          assert.equal(partiallyPaid.isLocked, false);

          await payments.recordPayment(
            workflow.finalInvoiceId,
            {
              amount: 1,
              method: PaymentMethod.CASH,
              paymentType: PaymentType.FINAL,
            },
            fixtures.adminActor
          );

          const settled = await db.invoice.findUniqueOrThrow({
            where: { id: workflow.finalInvoiceId },
            select: { remainingAmount: true, status: true, isLocked: true },
          });
          assert.equal(settled.remainingAmount.toFixed(3), "0.000");
          assert.equal(settled.status, InvoiceStatus.CLOSED);
          assert.equal(settled.isLocked, true);
        } finally {
          await phaseFFixtures.cleanupWorkflow(db, workflow);
        }
      });

      await t.test("a fully paid DRAFT FINAL auto-issues, snapshots, and locks in the same call", async () => {
        await db.package.update({
          where: { id: fixtures.basePackageId },
          data: { price: new Prisma.Decimal(250) },
        });
        const workflow = await phaseFFixtures.buildFinalInvoiceWorkflowFixture(
          db,
          fixtures,
          "settlement-c"
        );

        try {
          await payments.recordPayment(
            workflow.finalInvoiceId,
            {
              amount: 230,
              method: PaymentMethod.CASH,
              paymentType: PaymentType.FINAL,
            },
            fixtures.adminActor
          );

          const settled = await db.invoice.findUniqueOrThrow({
            where: { id: workflow.finalInvoiceId },
            select: {
              remainingAmount: true,
              status: true,
              isLocked: true,
              issuedAt: true,
              closedAt: true,
              lineItems: { select: { id: true } },
            },
          });
          assert.equal(settled.remainingAmount.toFixed(3), "0.000");
          assert.equal(settled.status, InvoiceStatus.CLOSED);
          assert.equal(settled.isLocked, true);
          assert.ok(settled.issuedAt, "draft final should be issued as part of settlement");
          assert.ok(settled.closedAt, "draft final should be closed as part of settlement");
          assert.equal(settled.lineItems.length > 0, true);
        } finally {
          await phaseFFixtures.cleanupWorkflow(db, workflow);
        }
      });

      await t.test("overpayment attempts fail without writing a second payment row", async () => {
        await db.package.update({
          where: { id: fixtures.basePackageId },
          data: { price: new Prisma.Decimal(250) },
        });
        const workflow = await phaseFFixtures.buildFinalInvoiceWorkflowFixture(
          db,
          fixtures,
          "settlement-d",
          { issue: true, finalPaymentAmounts: [200] }
        );

        try {
          const beforeCount = await db.payment.count({
            where: {
              invoiceId: workflow.finalInvoiceId,
              paymentType: PaymentType.FINAL,
            },
          });

          await assert.rejects(
            () =>
              payments.recordPayment(
                workflow.finalInvoiceId,
                {
                  amount: 50,
                  method: PaymentMethod.CASH,
                  paymentType: PaymentType.FINAL,
                },
                fixtures.adminActor
              ),
            /Payment amount cannot exceed the remaining invoice balance/
          );

          const invoice = await db.invoice.findUniqueOrThrow({
            where: { id: workflow.finalInvoiceId },
            select: { remainingAmount: true, status: true, isLocked: true },
          });
          const afterCount = await db.payment.count({
            where: {
              invoiceId: workflow.finalInvoiceId,
              paymentType: PaymentType.FINAL,
            },
          });

          assert.equal(afterCount, beforeCount);
          assert.equal(invoice.remainingAmount.toFixed(3), "30.000");
          assert.equal(invoice.status, InvoiceStatus.PARTIAL);
          assert.equal(invoice.isLocked, false);
        } finally {
          await phaseFFixtures.cleanupWorkflow(db, workflow);
        }
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
