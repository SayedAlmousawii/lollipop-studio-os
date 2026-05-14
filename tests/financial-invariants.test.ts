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
        { InvoiceStatus, InvoiceType, Prisma },
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
      ] = await Promise.all([
        import("@prisma/client"),
        import("../src/lib/db"),
        import("./fixtures/financial"),
        import("../src/modules/financial/invariants"),
        import("../src/modules/invoices/invoice.service"),
        import("../src/modules/invoices/invoice.calculation"),
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
