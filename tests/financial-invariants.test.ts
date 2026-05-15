import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test from "node:test";
import { withIsolatedBackendInvariantSchema } from "./backend-invariants/harness";
import { makeManagerActor } from "./fixtures/actor";

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
          makeCreditNotedBookingFixture,
          makeMixedEditBookingFixture,
          makeRefundedBookingFixture,
          seedAllSharedFixtures,
        },
        { runAllInvariants },
        {
          applyDepositToFinalIfPresent,
          createCreditNote,
          recalculateInvoiceStatus,
        },
        { computeEffectivePaidFromAllocations },
        { createPaymentWithAllocation, recordPayment },
        { removeOrderAddOn },
      ] = await Promise.all([
        import("@prisma/client"),
        import("../src/lib/db"),
        import("./fixtures/financial"),
        import("../src/modules/financial/invariants"),
        import("../src/modules/invoices/invoice.service"),
        import("../src/modules/invoices/invoice.calculation"),
        import("../src/modules/payments/payment.service"),
        import("../src/modules/orders/order.service"),
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
        const manager = await db.user.upsert({
          where: { email: "financial-invariants-manager@example.com" },
          update: {
            name: "Financial Invariants Manager",
            role: "MANAGER",
          },
          create: {
            name: "Financial Invariants Manager",
            email: "financial-invariants-manager@example.com",
            role: "MANAGER",
          },
        });
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

        await recordPayment(
          autoAdjustedFixture.adjustmentInvoiceId,
          {
            amount: 15,
            method: PaymentMethod.CASH,
            paymentType: PaymentType.ADJUSTMENT,
            paidAt: new Date("2026-05-14T10:30:00.000Z"),
          },
          makeManagerActor({ actorUserId: manager.id })
        );
        const paidAdjustmentInvoice = await db.invoice.findUniqueOrThrow({
          where: { id: autoAdjustedFixture.adjustmentInvoiceId },
          select: {
            paidAmount: true,
            remainingAmount: true,
            status: true,
            isLocked: true,
            payments: {
              select: {
                id: true,
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

        const adjustedAddOn = await db.orderAddOn.findFirstOrThrow({
          where: { orderId: autoAdjustmentOrderId },
          select: { id: true },
        });
        const adjustmentLine = await db.invoiceLineItem.findFirstOrThrow({
          where: { invoiceId: autoAdjustedFixture.adjustmentInvoiceId },
          select: {
            id: true,
            causeOrderEntityKind: true,
            causeOrderEntityId: true,
            lineTotal: true,
          },
        });
        assert.equal(adjustmentLine.causeOrderEntityKind, "ADDON");
        assert.equal(adjustmentLine.causeOrderEntityId, adjustedAddOn.id);

        await removeOrderAddOn(
          autoAdjustmentOrderId,
          {
            addOnId: adjustedAddOn.id,
            managerApprovedReductionByUserId: manager.id,
            managerApprovedReason: "Regression reversal test",
          },
          makeManagerActor({ actorUserId: manager.id })
        );

        const adjustmentReversalApplication =
          await db.documentApplication.findFirstOrThrow({
            where: {
              targetInvoiceId: autoAdjustedFixture.adjustmentInvoiceId,
              targetInvoiceLineId: adjustmentLine.id,
            },
            include: { sourceInvoice: { include: { lineItems: true } } },
          });
        assert.equal(
          adjustmentReversalApplication.amountApplied.toFixed(3),
          adjustmentLine.lineTotal.toFixed(3)
        );
        assert.equal(
          adjustmentReversalApplication.sourceInvoice.invoiceType,
          InvoiceType.CREDIT_NOTE
        );
        assert.equal(
          adjustmentReversalApplication.sourceInvoice.parentInvoiceId,
          autoAdjustedFixture.adjustmentInvoiceId
        );
        assert.equal(
          adjustmentReversalApplication.sourceInvoice.lineItems[0]
            ?.causeOrderEntityId,
          adjustedAddOn.id
        );

        const adjustmentRefund = await db.invoice.findFirstOrThrow({
          where: {
            invoiceType: InvoiceType.REFUND,
            parentInvoiceId: autoAdjustedFixture.adjustmentInvoiceId,
          },
          include: {
            payments: {
              select: {
                direction: true,
                paymentType: true,
                amount: true,
                refundOfPaymentId: true,
                allocations: { select: { invoiceId: true, amount: true } },
              },
            },
          },
        });
        assert.equal(adjustmentRefund.totalAmount.toFixed(3), "15.000");
        assert.equal(adjustmentRefund.payments[0]?.direction, "OUT");
        assert.equal(adjustmentRefund.payments[0]?.paymentType, PaymentType.REFUND);
        assert.equal(
          adjustmentRefund.payments[0]?.amount.toFixed(3),
          "15.000"
        );
        assert.equal(
          adjustmentRefund.payments[0]?.refundOfPaymentId,
          paidAdjustmentInvoice.payments[0]?.id
        );
        assert.equal(
          adjustmentRefund.payments[0]?.allocations[0]?.invoiceId,
          adjustmentRefund.id
        );

        const finalAfterAdjustmentReversal = await db.invoice.findUniqueOrThrow({
          where: { id: autoAdjustedFixture.finalInvoiceId },
          select: { totalAmount: true, remainingAmount: true },
        });
        assert.equal(finalAfterAdjustmentReversal.totalAmount.toFixed(3), "100.000");
        assert.equal(finalAfterAdjustmentReversal.remainingAmount.toFixed(3), "0.000");

        const refundedFixture = await makeRefundedBookingFixture(db);
        const refundInvoice = await db.invoice.findUniqueOrThrow({
          where: { id: refundedFixture.refundInvoiceId },
          include: {
            lineItems: true,
            payments: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                direction: true,
                paymentType: true,
                amount: true,
                refundOfPaymentId: true,
                allocations: { select: { invoiceId: true, amount: true } },
              },
            },
          },
        });
        assert.equal(refundInvoice.invoiceType, InvoiceType.REFUND);
        assert.equal(refundInvoice.parentInvoiceId, refundedFixture.finalInvoiceId);
        assert.equal(refundInvoice.totalAmount.toFixed(3), "10.000");
        assert.equal(refundInvoice.invoiceNumber.startsWith("REF-"), true);
        assert.equal(refundInvoice.lineItems.length, 1);
        assert.equal(refundInvoice.payments[0]?.direction, "OUT");
        assert.equal(refundInvoice.payments[0]?.paymentType, PaymentType.REFUND);
        assert.equal(
          refundInvoice.payments[0]?.refundOfPaymentId,
          refundedFixture.finalPaymentId
        );
        assert.equal(
          refundInvoice.payments[0]?.allocations[0]?.invoiceId,
          refundInvoice.id
        );
        assert.equal(
          refundInvoice.payments[0]?.allocations[0]?.amount.toFixed(3),
          "10.000"
        );

        await assert.rejects(
          () =>
            createPaymentWithAllocation(
              {
                invoiceId: refundedFixture.finalInvoiceId,
                financialCaseId: refundedFixture.financialCaseId,
                amount: new Prisma.Decimal(1),
                method: PaymentMethod.CASH,
                paymentType: PaymentType.REFUND,
                direction: "OUT",
              },
              db
            ),
          /Outbound payments must target a refund invoice/
        );

        const creditNotedFixture = await makeCreditNotedBookingFixture(db);
        const creditNoteInvoice = await db.invoice.findUniqueOrThrow({
          where: { id: creditNotedFixture.creditNoteInvoiceId },
          include: {
            lineItems: true,
            documentApplicationsAsSource: true,
          },
        });
        assert.equal(creditNoteInvoice.invoiceType, InvoiceType.CREDIT_NOTE);
        assert.equal(
          creditNoteInvoice.parentInvoiceId,
          creditNotedFixture.finalInvoiceId
        );
        assert.equal(creditNoteInvoice.totalAmount.toFixed(3), "20.000");
        assert.equal(creditNoteInvoice.remainingAmount.toFixed(3), "0.000");
        assert.equal(creditNoteInvoice.status, InvoiceStatus.CLOSED);
        assert.equal(creditNoteInvoice.isLocked, true);
        assert.equal(creditNoteInvoice.invoiceNumber.startsWith("CN-"), true);
        assert.equal(creditNoteInvoice.lineItems.length, 1);
        assert.equal(creditNoteInvoice.documentApplicationsAsSource.length, 1);
        assert.equal(
          creditNoteInvoice.documentApplicationsAsSource[0]?.targetInvoiceId,
          creditNotedFixture.finalInvoiceId
        );
        assert.equal(
          creditNoteInvoice.documentApplicationsAsSource[0]?.amountApplied.toFixed(3),
          "20.000"
        );

        const creditedFinalEffectivePaid =
          await computeEffectivePaidFromAllocations(
            creditNotedFixture.finalInvoiceId,
            db
          );
        assert.equal(creditedFinalEffectivePaid.toFixed(3), "120.000");

        const creditNoteManager = await db.user.findUniqueOrThrow({
          where: { email: "financial-credit-note-manager@example.com" },
          select: { id: true },
        });
        await assert.rejects(
          () =>
            createCreditNote(
              {
                targetFinalInvoiceId: creditNotedFixture.adjustmentInvoiceId,
                reason: "Invalid adjustment target",
                createdByUserId: creditNoteManager.id,
                lines: [
                  {
                    description: "Invalid credit target",
                    quantity: 1,
                    unitPrice: new Prisma.Decimal(1),
                  },
                ],
              },
              db
            ),
          /Credit notes can only target final invoices/
        );
        await assert.rejects(
          () =>
            createCreditNote(
              {
                targetFinalInvoiceId: creditNotedFixture.finalInvoiceId,
                reason: "Too much credit",
                createdByUserId: creditNoteManager.id,
                lines: [
                  {
                    description: "Excess credit",
                    quantity: 1,
                    unitPrice: new Prisma.Decimal(500),
                  },
                ],
              },
              db
            ),
          /Credit note amount cannot exceed remaining credit capacity/
        );

        const mixedEditFixture = await makeMixedEditBookingFixture(db);
        const [mixedAdjustment, mixedCreditNote] = await Promise.all([
          db.invoice.findUniqueOrThrow({
            where: { id: mixedEditFixture.adjustmentInvoiceId },
            include: { paymentAllocations: true },
          }),
          db.invoice.findUniqueOrThrow({
            where: { id: mixedEditFixture.creditNoteInvoiceId },
            include: { documentApplicationsAsSource: true },
          }),
        ]);
        assert.equal(mixedAdjustment.invoiceType, InvoiceType.ADJUSTMENT);
        assert.equal(mixedAdjustment.parentInvoiceId, mixedEditFixture.finalInvoiceId);
        assert.equal(mixedAdjustment.totalAmount.toFixed(3), "15.000");
        assert.equal(mixedAdjustment.paymentAllocations.length, 0);
        assert.equal(mixedCreditNote.invoiceType, InvoiceType.CREDIT_NOTE);
        assert.equal(mixedCreditNote.parentInvoiceId, mixedEditFixture.finalInvoiceId);
        assert.equal(mixedCreditNote.totalAmount.toFixed(3), "10.000");
        assert.equal(mixedCreditNote.documentApplicationsAsSource.length, 1);
        assert.equal(
          mixedCreditNote.documentApplicationsAsSource[0]?.targetInvoiceId,
          mixedEditFixture.finalInvoiceId
        );
        const mixedActivities = await db.orderActivity.findMany({
          where: {
            orderId: mixedAdjustment.orderId ?? "",
            OR: [
              { title: "Auto-adjustment issued" },
              { title: "Classifier reduction credit note issued" },
            ],
          },
          select: { title: true, description: true },
        });
        assert.ok(
          mixedActivities.some(
            (activity) =>
              activity.title === "Auto-adjustment issued" &&
              activity.description?.includes(mixedCreditNote.invoiceNumber)
          )
        );
        assert.ok(
          mixedActivities.some(
            (activity) =>
              activity.title === "Classifier reduction credit note issued" &&
              activity.description?.includes(mixedAdjustment.invoiceNumber)
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
