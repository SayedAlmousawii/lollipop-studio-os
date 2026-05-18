import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test, { after } from "node:test";
import { InvoiceStatus } from "@prisma/client";
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
