import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test, { after } from "node:test";
import { InvoiceLineType, InvoiceStatus, InvoiceType, Prisma } from "@prisma/client";
import { withIsolatedBackendInvariantSchema } from "../../backend-invariants/harness";

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

test("getFinancialCaseSummary covers booking and active stages", async (t) => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [
        { db },
        {
          getFinancialCaseSummary,
          computeCustomerSettlement,
          toCustomerSettlementSummary,
        },
        {
          makeAdjustedBookingFixture,
          makeFinancialCaseSummaryOrderFixture,
          makeMixedEditBookingFixture,
          makeRefundedBookingFixture,
        },
      ] = await Promise.all([
        import("@/lib/db"),
        import("@/modules/financial-cases"),
        import("../../fixtures/financial"),
      ]);

      await t.test("confirmed booking without a Job returns booking stage", async () => {
        const fixture = await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "NOJOB1",
          createJob: false,
          createFinalInvoice: false,
        });

        const summary = await getFinancialCaseSummary({
          bookingId: fixture.bookingId,
        });

        assert.equal(summary?.stage, "booking");
        assert.equal(summary.financialCaseId, fixture.financialCaseId);
        assert.equal(summary.awaitingFinalInvoiceAfterCheckIn, false);
        assert.equal(summary.finalInvoicePending, true);
        assert.equal(summary.depositPaid, true);
        assert.deepEqual(summary.linkedDocuments, []);
      });

      await t.test("draft deposit without a Final Invoice stays booking stage", async () => {
        const fixture = await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "DRAFT1",
          createFinalInvoice: false,
          depositStatus: InvoiceStatus.DRAFT,
          depositPaidAmount: 0,
        });

        const summary = await getFinancialCaseSummary({
          financialCaseId: fixture.financialCaseId,
        });

        assert.equal(summary?.stage, "booking");
        assert.equal(summary.awaitingFinalInvoiceAfterCheckIn, true);
        assert.equal(summary.depositPaid, false);
        assert.equal(summary.depositInvoice?.status, InvoiceStatus.DRAFT);
      });

      await t.test("pre-final order without a Final Invoice is explicit booking stage", async () => {
        const fixture = await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "PREFIN",
          createFinalInvoice: false,
        });

        const summary = await getFinancialCaseSummary({
          financialCaseId: fixture.financialCaseId,
        });

        assert.equal(summary?.stage, "booking");
        assert.equal(summary.awaitingFinalInvoiceAfterCheckIn, true);
        assert.equal(summary.finalInvoicePending, true);
      });

      await t.test("active locked summary resolves from each supported id", async () => {
        const fixture = await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "LOCKED",
        });

        const byCase = await getFinancialCaseSummary({
          financialCaseId: fixture.financialCaseId,
        });
        const byOrder = await getFinancialCaseSummary({
          orderId: fixture.orderId ?? undefined,
        });
        const byBooking = await getFinancialCaseSummary({
          bookingId: fixture.bookingId,
        });

        assert.equal(byCase?.stage, "active");
        assert.equal(byOrder?.stage, "active");
        assert.equal(byBooking?.stage, "active");
        assert.equal(byCase.financialCaseId, byOrder.financialCaseId);
        assert.equal(byCase.financialCaseId, byBooking.financialCaseId);
        assert.equal(byCase.customerTotal, 100);
        assert.equal(byCase.effectivePaid, 100);
        assert.equal(byCase.depositApplied, 20);
        assert.equal(byCase.remaining, 0);
        assert.equal(byCase.paymentStatusEnum, "PAID");
      });

      await t.test("locked adjusted summary includes finalized adjustments", async () => {
        const fixture = await makeAdjustedBookingFixture(db);
        const summary = await getFinancialCaseSummary({
          financialCaseId: fixture.financialCaseId,
        });

        assert.equal(summary?.stage, "active");
        assert.equal(summary.finalizedAdjustments.length, 1);
        assert.equal(summary.customerTotal, 115);
      });

      await t.test("refunded summary exposes refund documents and status", async () => {
        const fixture = await makeRefundedBookingFixture(db);
        const summary = await getFinancialCaseSummary({
          financialCaseId: fixture.financialCaseId,
        });

        assert.equal(summary?.stage, "active");
        assert.ok(summary.refunds.length > 0);
        assert.equal(summary.paymentStatusEnum, "REFUNDED");
      });

      await t.test("overpaid summary exposes overpayment capacity", async () => {
        const fixture = await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "OVERPD",
          finalPaymentAmount: 90,
          finalRemainingAmount: 0,
        });

        const summary = await getFinancialCaseSummary({
          financialCaseId: fixture.financialCaseId,
        });

        assert.equal(summary?.stage, "active");
        assert.equal(summary.paymentStatusEnum, "OVERPAID");
        assert.equal(summary.overpaymentCapacity, 10);
        assert.equal(summary.effectivePaid, 110);

        const settlement = await computeCustomerSettlement({
          financialCaseId: fixture.financialCaseId,
        });

        assert.equal(settlement?.netCustomerTotal, 100);
        assert.equal(settlement.cashPaid, 110);
        assert.equal(settlement.remainingDue, 0);
        assert.equal(settlement.availableCredit, 10);
        assertSettlementIdentity(settlement);
      });

      await t.test("credit-noted summary exposes credit notes and capacity", async () => {
        const fixture = await makeMixedEditBookingFixture(db);
        const summary = await getFinancialCaseSummary({
          financialCaseId: fixture.financialCaseId,
        });

        assert.equal(summary?.stage, "active");
        assert.ok(summary.creditNotes.length > 0);
        assert.ok(summary.creditNoteCapacity < summary.finalInvoice.total);
      });

      await t.test("active summary exposes derived available case credit", async () => {
        const fixture = await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "AVAIL",
        });
        assert.ok(fixture.finalInvoiceId);
        await db.invoice.create({
          data: {
            publicId: "INV-SUMMARY-AVAILABLE-CN",
            invoiceNumber: "INV-SUMMARY-AVAILABLE-CN",
            financialCaseId: fixture.financialCaseId,
            invoiceType: InvoiceType.CREDIT_NOTE,
            jobId: fixture.jobId,
            orderId: fixture.orderId,
            bookingId: fixture.bookingId,
            customerId: fixture.customerId,
            parentInvoiceId: fixture.finalInvoiceId,
            totalAmount: new Prisma.Decimal(12),
            paidAmount: new Prisma.Decimal(0),
            remainingAmount: new Prisma.Decimal(0),
            status: InvoiceStatus.CLOSED,
            isLocked: true,
            issuedAt: new Date("2026-06-01T00:00:00.000Z"),
            closedAt: new Date("2026-06-01T00:00:00.000Z"),
          },
        });

        const summary = await getFinancialCaseSummary({
          financialCaseId: fixture.financialCaseId,
        });

        assert.equal(summary?.stage, "active");
        assert.equal(summary.availableCaseCredit, 12);
        assert.equal(summary.overpaymentCapacity, 0);
        assert.equal(summary.creditNoteCapacity, summary.finalInvoice.total);

        const settlement = await computeCustomerSettlement({
          financialCaseId: fixture.financialCaseId,
        });

        assert.equal(settlement?.netCustomerTotal, 88);
        assert.equal(settlement.cashPaid, 100);
        assert.equal(settlement.remainingDue, 0);
        assert.equal(settlement.availableCredit, 12);
        assertSettlementIdentity(settlement);
      });

      await t.test("customer settlement projection splits in-credit receipt line", async () => {
        const fixture = await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "RCRD01",
          depositPaidAmount: 0,
          finalTotal: 200,
          finalPaymentAmount: 200,
          finalRemainingAmount: 0,
        });
        assert.ok(fixture.finalInvoiceId);
        await db.invoice.create({
          data: {
            publicId: "INV-SUMMARY-RECEIPT-CREDIT-CN",
            invoiceNumber: "INV-SUMMARY-RECEIPT-CREDIT-CN",
            financialCaseId: fixture.financialCaseId,
            invoiceType: InvoiceType.CREDIT_NOTE,
            jobId: fixture.jobId,
            orderId: fixture.orderId,
            bookingId: fixture.bookingId,
            customerId: fixture.customerId,
            parentInvoiceId: fixture.finalInvoiceId,
            totalAmount: new Prisma.Decimal(50),
            paidAmount: new Prisma.Decimal(0),
            remainingAmount: new Prisma.Decimal(0),
            status: InvoiceStatus.CLOSED,
            isLocked: true,
            issuedAt: new Date("2026-06-01T00:00:00.000Z"),
            closedAt: new Date("2026-06-01T00:00:00.000Z"),
          },
        });

        const summary = await getFinancialCaseSummary({
          financialCaseId: fixture.financialCaseId,
        });
        assert.equal(summary?.stage, "active");

        const projection = toCustomerSettlementSummary(summary);
        assert.ok(projection);
        assert.equal(projection.mode, "clean");
        assert.equal(projection.netCustomerTotal, 150);
        assert.equal(projection.cashPaid, 200);
        assert.equal(projection.remainingDue, 0);
        assert.equal(projection.availableCredit, 50);
        assert.equal(projection.refundable, 50);
      });

      await t.test("customer settlement does not treat unpaid raw credit as available", async () => {
        const fixture = await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "UNPAIDCN",
          depositPaidAmount: 0,
          finalTotal: 250,
          finalPaymentAmount: 0,
          finalRemainingAmount: 250,
          finalStatus: InvoiceStatus.ISSUED,
        });
        assert.ok(fixture.finalInvoiceId);
        await db.invoice.create({
          data: {
            publicId: "INV-SUMMARY-UNPAID-CN",
            invoiceNumber: "INV-SUMMARY-UNPAID-CN",
            financialCaseId: fixture.financialCaseId,
            invoiceType: InvoiceType.CREDIT_NOTE,
            jobId: fixture.jobId,
            orderId: fixture.orderId,
            bookingId: fixture.bookingId,
            customerId: fixture.customerId,
            parentInvoiceId: fixture.finalInvoiceId,
            totalAmount: new Prisma.Decimal(50),
            paidAmount: new Prisma.Decimal(0),
            remainingAmount: new Prisma.Decimal(0),
            status: InvoiceStatus.CLOSED,
            isLocked: true,
            issuedAt: new Date("2026-06-01T00:00:00.000Z"),
            closedAt: new Date("2026-06-01T00:00:00.000Z"),
          },
        });

        const settlement = await computeCustomerSettlement({
          financialCaseId: fixture.financialCaseId,
        });

        assert.equal(settlement?.netCustomerTotal, 200);
        assert.equal(settlement.cashPaid, 0);
        assert.equal(settlement.remainingDue, 200);
        assert.equal(settlement.availableCredit, 0);
        assertSettlementIdentity(settlement);

        const summary = await getFinancialCaseSummary({
          financialCaseId: fixture.financialCaseId,
        });
        assert.equal(summary?.stage, "active");
        const projection = toCustomerSettlementSummary(summary);
        assert.ok(projection);
        assert.equal(projection.mode, "clean");
        assert.equal(projection.remainingDue, 200);
        assert.equal(projection.availableCredit, undefined);
      });

      await t.test("customer settlement reconciles B1-style add and removal documents", async () => {
        const fixture = await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "B1STYLE",
          finalTotal: 160,
          finalPaymentAmount: 140,
          finalRemainingAmount: 0,
        });
        assert.ok(fixture.finalInvoiceId);
        const adjustment = await db.invoice.create({
          data: {
            publicId: "INV-SUMMARY-B1STYLE-ADJ",
            invoiceNumber: "INV-SUMMARY-B1STYLE-ADJ",
            financialCaseId: fixture.financialCaseId,
            invoiceType: InvoiceType.ADJUSTMENT,
            jobId: fixture.jobId,
            orderId: fixture.orderId,
            bookingId: fixture.bookingId,
            customerId: fixture.customerId,
            parentInvoiceId: fixture.finalInvoiceId,
            totalAmount: new Prisma.Decimal(100),
            paidAmount: new Prisma.Decimal(0),
            remainingAmount: new Prisma.Decimal(100),
            status: InvoiceStatus.ISSUED,
            isLocked: true,
            issuedAt: new Date("2026-06-02T00:00:00.000Z"),
          },
        });
        await db.invoiceLineItem.create({
          data: {
            invoiceId: adjustment.id,
            lineType: InvoiceLineType.ADD_ON,
            description: "B1-style additive change",
            quantity: 1,
            unitPrice: new Prisma.Decimal(100),
            lineTotal: new Prisma.Decimal(100),
            sortOrder: 0,
          },
        });
        const creditNote = await db.invoice.create({
          data: {
            publicId: "INV-SUMMARY-B1STYLE-CN",
            invoiceNumber: "INV-SUMMARY-B1STYLE-CN",
            financialCaseId: fixture.financialCaseId,
            invoiceType: InvoiceType.CREDIT_NOTE,
            jobId: fixture.jobId,
            orderId: fixture.orderId,
            bookingId: fixture.bookingId,
            customerId: fixture.customerId,
            parentInvoiceId: fixture.finalInvoiceId,
            totalAmount: new Prisma.Decimal(10),
            paidAmount: new Prisma.Decimal(0),
            remainingAmount: new Prisma.Decimal(0),
            status: InvoiceStatus.CLOSED,
            isLocked: true,
            issuedAt: new Date("2026-06-02T00:05:00.000Z"),
            closedAt: new Date("2026-06-02T00:05:00.000Z"),
          },
        });
        await db.invoiceLineItem.create({
          data: {
            invoiceId: creditNote.id,
            lineType: InvoiceLineType.MANUAL_DISCOUNT,
            description: "B1-style removal",
            quantity: 1,
            unitPrice: new Prisma.Decimal(10),
            lineTotal: new Prisma.Decimal(10),
            sortOrder: 0,
          },
        });

        const settlement = await computeCustomerSettlement({
          financialCaseId: fixture.financialCaseId,
        });

        assert.equal(settlement?.netCustomerTotal, 250);
        assert.equal(settlement.cashPaid, 160);
        assert.equal(settlement.remainingDue, 90);
        assert.equal(settlement.availableCredit, 0);
        assertSettlementIdentity(settlement);

        const summary = await getFinancialCaseSummary({
          financialCaseId: fixture.financialCaseId,
        });
        assert.equal(summary?.stage, "active");
        const projection = toCustomerSettlementSummary(summary);
        assert.ok(projection);
        assert.equal(projection.mode, "clean");
        assert.equal(projection.netCustomerTotal, 250);
        assert.equal(projection.cashPaid, 160);
        assert.equal(projection.remainingDue, 90);
        assert.equal(projection.availableCredit, undefined);
      });

      await t.test("customer settlement projection uses corrected draft amount due", async () => {
        const fixture = await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "RDRF01",
          depositPaidAmount: 0,
          finalTotal: 200,
          finalPaymentAmount: 200,
          finalRemainingAmount: 0,
        });
        assert.ok(fixture.finalInvoiceId);
        await db.invoice.create({
          data: {
            publicId: "INV-SUMMARY-RECEIPT-DRAFT-CN",
            invoiceNumber: "INV-SUMMARY-RECEIPT-DRAFT-CN",
            financialCaseId: fixture.financialCaseId,
            invoiceType: InvoiceType.CREDIT_NOTE,
            jobId: fixture.jobId,
            orderId: fixture.orderId,
            bookingId: fixture.bookingId,
            customerId: fixture.customerId,
            parentInvoiceId: fixture.finalInvoiceId,
            totalAmount: new Prisma.Decimal(50),
            paidAmount: new Prisma.Decimal(0),
            remainingAmount: new Prisma.Decimal(0),
            status: InvoiceStatus.CLOSED,
            isLocked: true,
            issuedAt: new Date("2026-06-01T00:00:00.000Z"),
            closedAt: new Date("2026-06-01T00:00:00.000Z"),
          },
        });
        const summary = await getFinancialCaseSummary({
          financialCaseId: fixture.financialCaseId,
        });
        assert.equal(summary?.stage, "active");

        const projection = toCustomerSettlementSummary(summary, {
          previousTotal: 150,
          pendingDelta: 30,
          afterCommitTotal: 180,
          amountDueAfterCommit: 0,
        });
        assert.equal(projection?.mode, "draft");
        if (projection?.mode !== "draft") {
          throw new Error("Expected draft projection");
        }
        assert.equal(projection.availableCredit, 50);
        assert.equal(projection.amountDueAfterCommit, 0);
      });

      await t.test("missing FinancialCase resolves to null", async () => {
        const orphan = await db.booking.create({
          data: {
            customer: {
              create: {
                name: "No Case Customer",
                phone: "+96595000000",
              },
            },
            department: {
              create: {
                code: "NO_CASE_DEPT",
                name: "No Case Department",
              },
            },
            status: "CONFIRMED",
            sessionDate: new Date("2026-05-16T08:00:00.000Z"),
            sessionTime: "10:00",
          },
        });

        assert.equal(await getFinancialCaseSummary({ bookingId: orphan.id }), null);
        assert.equal(await getFinancialCaseSummary({ orderId: "missing" }), null);
        assert.equal(
          await getFinancialCaseSummary({ financialCaseId: "missing" }),
          null
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

function assertSettlementIdentity(settlement: {
  netCustomerTotal: number;
  cashPaid: number;
  remainingDue: number;
  availableCredit: number;
}) {
  assert.equal(
    Number((settlement.netCustomerTotal - settlement.cashPaid).toFixed(3)),
    Number((settlement.remainingDue - settlement.availableCredit).toFixed(3))
  );
}
