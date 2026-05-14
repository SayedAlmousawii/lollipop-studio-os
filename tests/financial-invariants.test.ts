import "dotenv/config";

import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { withIsolatedBackendInvariantSchema } from "./backend-invariants/harness";

test("financial invariants all pass against seeded fixtures", async () => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [
        { InvoiceStatus, InvoiceType, PaymentMethod, PaymentType, Prisma },
        { db },
        {
          makeAutoAdjustedBookingFixture,
          makeAdjustedBookingFixture,
          makeCashDepositBookingFixture,
          seedAllSharedFixtures,
        },
        { runAllInvariants },
        {
          applyDepositToFinalIfPresent,
          recalculateInvoiceStatus,
        },
        { computeEffectivePaidFromAllocations },
        { recordPayment },
      ] = await Promise.all([
        import("@prisma/client"),
        import("../src/lib/db"),
        import("./fixtures/financial"),
        import("../src/modules/financial/invariants"),
        import("../src/modules/invoices/invoice.service"),
        import("../src/modules/invoices/invoice.calculation"),
        import("../src/modules/payments/payment.service"),
      ]);

      const originalWarn = console.warn;
      const originalError = console.error;
      const warnMessages: string[] = [];
      console.warn = (message?: unknown) => {
        warnMessages.push(String(message));
      };
      console.error = () => {};

      try {
        await seedAllSharedFixtures(db);
        const adjustedFixture = await makeAdjustedBookingFixture(db);
        const adjustmentInvoice = await db.invoice.findUniqueOrThrow({
          where: { id: adjustedFixture.adjustmentInvoiceId },
          include: { lineItems: true },
        });
        assert.equal(adjustmentInvoice.invoiceType, InvoiceType.ADJUSTMENT);
        assert.equal(adjustmentInvoice.parentInvoiceId, adjustedFixture.finalInvoiceId);
        assert.equal(adjustmentInvoice.financialCaseId, adjustedFixture.financialCaseId);
        assert.equal(adjustmentInvoice.invoiceNumber.startsWith("ADJ-"), true);
        assert.equal(adjustmentInvoice.lineItems.length, 1);

        const autoAdjustedFixture = await makeAutoAdjustedBookingFixture(db);
        const autoAdjustmentInvoice = await db.invoice.findUniqueOrThrow({
          where: { id: autoAdjustedFixture.adjustmentInvoiceId },
          include: { lineItems: true },
        });
        assert.equal(autoAdjustmentInvoice.invoiceType, InvoiceType.ADJUSTMENT);
        assert.equal(autoAdjustmentInvoice.parentInvoiceId, autoAdjustedFixture.finalInvoiceId);
        assert.equal(autoAdjustmentInvoice.invoiceNumber.startsWith("ADJ-"), true);
        assert.equal(autoAdjustmentInvoice.lineItems.length, 1);
        assert.equal(autoAdjustmentInvoice.lineItems[0]?.lineTotal.toFixed(3), "15.000");

        const autoAdjustmentOrderId = autoAdjustmentInvoice.orderId;
        assert.ok(autoAdjustmentOrderId, "expected auto adjustment to belong to an order");

        await recordPayment(autoAdjustedFixture.adjustmentInvoiceId, {
          amount: 15,
          method: PaymentMethod.CASH,
          paymentType: PaymentType.ADJUSTMENT,
          paidAt: new Date("2026-05-14T10:30:00.000Z"),
        });
        const paidAdjustmentInvoice = await db.invoice.findUniqueOrThrow({
          where: { id: autoAdjustedFixture.adjustmentInvoiceId },
          select: {
            paidAmount: true,
            remainingAmount: true,
            status: true,
            isLocked: true,
            payments: {
              select: {
                paymentType: true,
                direction: true,
                allocations: { select: { invoiceId: true, amount: true } },
              },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        });
        assert.equal(paidAdjustmentInvoice.paidAmount.toFixed(3), "15.000");
        assert.equal(paidAdjustmentInvoice.remainingAmount.toFixed(3), "0.000");
        assert.equal(paidAdjustmentInvoice.status, InvoiceStatus.CLOSED);
        assert.equal(paidAdjustmentInvoice.isLocked, true);
        assert.equal(
          paidAdjustmentInvoice.payments[0]?.paymentType,
          PaymentType.ADJUSTMENT
        );
        assert.equal(paidAdjustmentInvoice.payments[0]?.direction, "IN");
        assert.equal(
          paidAdjustmentInvoice.payments[0]?.allocations[0]?.invoiceId,
          autoAdjustedFixture.adjustmentInvoiceId
        );
        assert.equal(
          paidAdjustmentInvoice.payments[0]?.allocations[0]?.amount.toFixed(3),
          "15.000"
        );

        const adjustmentPaymentActivities = await db.orderActivity.findMany({
          where: {
            orderId: autoAdjustmentOrderId,
            description: { contains: autoAdjustmentInvoice.invoiceNumber },
          },
          select: { description: true },
        });
        assert.ok(
          adjustmentPaymentActivities.some((activity) =>
            activity.description?.includes("Payment recorded against")
          )
        );
        assert.ok(
          adjustmentPaymentActivities.some((activity) =>
            activity.description?.includes("settled and closed")
          )
        );

        const fixture = await makeCashDepositBookingFixture(db);
        const finalInvoice = await db.invoice.create({
          data: {
            publicId: "INV-FIN-74D-FINAL",
            invoiceNumber: "INV-FIN-74D-0001",
            financialCaseId: fixture.financialCaseId,
            invoiceType: InvoiceType.FINAL,
            jobId: fixture.jobId,
            bookingId: fixture.bookingId,
            customerId: fixture.customerId,
            totalAmount: new Prisma.Decimal(100),
            remainingAmount: new Prisma.Decimal(100),
            status: InvoiceStatus.ISSUED,
          },
        });

        await applyDepositToFinalIfPresent(
          fixture.financialCaseId,
          finalInvoice.id,
          db
        );
        await applyDepositToFinalIfPresent(
          fixture.financialCaseId,
          finalInvoice.id,
          db
        );

        const applications = await db.documentApplication.findMany({
          where: { targetInvoiceId: finalInvoice.id },
          select: { amountApplied: true },
        });
        assert.equal(applications.length, 1);
        assert.equal(applications[0]?.amountApplied.toFixed(3), "20.000");

        const effectivePaid = await computeEffectivePaidFromAllocations(
          finalInvoice.id,
          db
        );
        assert.equal(effectivePaid.toFixed(3), "20.000");

        await recalculateInvoiceStatus(finalInvoice.id, db);
        const recalculatedInvoice = await db.invoice.findUniqueOrThrow({
          where: { id: finalInvoice.id },
          select: { paidAmount: true, remainingAmount: true, status: true },
        });

        assert.equal(recalculatedInvoice.paidAmount.toFixed(3), "0.000");
        assert.equal(recalculatedInvoice.remainingAmount.toFixed(3), "80.000");
        assert.equal(recalculatedInvoice.status, InvoiceStatus.PARTIAL);
        assert.deepEqual(
          warnMessages.filter(
            (message) => !message.includes('"phase":"phase-2-classifier"')
          ),
          []
        );

        const violations = await runAllInvariants(db);
        assert.deepEqual(violations, []);

        await db.documentApplication.deleteMany({
          where: { targetInvoiceId: finalInvoice.id },
        });
        const missingApplicationViolations = await runAllInvariants(db);
        assert.ok(
          missingApplicationViolations.some(
            (violation) =>
              violation.invariant ===
              "deposit-final-pair-has-document-application"
          )
        );

        await applyDepositToFinalIfPresent(
          fixture.financialCaseId,
          finalInvoice.id,
          db
        );
        await db.paymentAllocation.deleteMany({
          where: { paymentId: fixture.paymentId },
        });
        const missingAllocationViolations = await runAllInvariants(db);
        assert.ok(
          missingAllocationViolations.some(
            (violation) => violation.invariant === "no-payment-without-allocation"
          )
        );
      } finally {
        console.warn = originalWarn;
        console.error = originalError;
        await db.$disconnect();
      }
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});
