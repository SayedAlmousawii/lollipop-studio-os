import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test, { after } from "node:test";
import { InvoiceStatus, InvoiceType } from "@prisma/client";
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

test("R1b FinancialCaseSummary projectors cover booking and active stages", async (t) => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [
        {
          getFinancialCaseSummary,
          checkFinancialCaseSummaryProjectorParity,
          toBookingPageFinancial,
          toDraftSidebarFinancial,
          toInvoiceListRow,
          toOrderHeaderFinancial,
          toOrdersTableRow,
          toPaymentDialogContext,
        },
        {
          makeAutoAdjustedBookingFixture,
          makeFinancialCaseSummaryOrderFixture,
          makeFinancialCaseSummaryRefundedOrderFixture,
          makeMixedEditBookingFixture,
        },
      ] = await Promise.all([
        import("@/modules/financial-cases"),
        import("../../fixtures/financial"),
      ]);

      const booking = await makeFinancialCaseSummaryOrderFixture(dbFromEnv(), {
        suffix: "R1BBOOK",
        createFinalInvoice: false,
      });
      const activeDraft = await makeFinancialCaseSummaryOrderFixture(dbFromEnv(), {
        suffix: "R1BDRFT",
        finalStatus: InvoiceStatus.DRAFT,
        finalIsLocked: false,
        finalPaymentAmount: 0,
        finalRemainingAmount: 80,
      });
      const activeLocked = await makeFinancialCaseSummaryOrderFixture(dbFromEnv(), {
        suffix: "R1BLOCK",
      });
      const adjusted = await makeAutoAdjustedBookingFixture(dbFromEnv());
      const creditNoted = await makeMixedEditBookingFixture(dbFromEnv());
      const refunded = await makeFinancialCaseSummaryRefundedOrderFixture(
        dbFromEnv()
      );
      const overpaid = await makeFinancialCaseSummaryOrderFixture(dbFromEnv(), {
        suffix: "R1BOVER",
        finalPaymentAmount: 90,
        finalRemainingAmount: 0,
      });

      await t.test("booking-stage projectors return null or booking shape", async () => {
        const summary = await getFinancialCaseSummary({
          financialCaseId: booking.financialCaseId,
        });
        assert.equal(summary?.stage, "booking");

        assert.equal(toOrderHeaderFinancial(summary), null);
        assert.equal(toDraftSidebarFinancial(summary), null);
        assert.equal(toPaymentDialogContext(summary), null);
        assert.equal(toOrdersTableRow(summary), null);
        assert.deepEqual(toInvoiceListRow(summary), []);

        const bookingProjection = toBookingPageFinancial(summary);
        assert.equal(bookingProjection.stage, "booking");
        assert.equal(bookingProjection.depositPaid, true);
        assert.equal(bookingProjection.finalInvoicePending, true);
        assert.equal(bookingProjection.awaitingFinalInvoiceAfterCheckIn, true);
        assert.equal(bookingProjection.depositInvoice?.isLocked, true);
      });

      const activeCases = [
        {
          label: "active draft",
          financialCaseId: activeDraft.financialCaseId,
          expected: {
            total: 100,
            paid: 20,
            remaining: 80,
            status: "PARTIAL",
            finalLocked: false,
            finalStatus: InvoiceStatus.DRAFT,
          },
        },
        {
          label: "active locked",
          financialCaseId: activeLocked.financialCaseId,
          expected: {
            total: 100,
            paid: 100,
            remaining: 0,
            status: "PAID",
            finalLocked: true,
            finalStatus: InvoiceStatus.CLOSED,
          },
        },
        {
          label: "locked adjusted",
          financialCaseId: adjusted.financialCaseId,
          expected: {
            total: 115,
            paid: 100,
            remaining: 15,
            status: "PARTIAL",
            finalLocked: true,
            finalStatus: InvoiceStatus.CLOSED,
            documentType: InvoiceType.ADJUSTMENT,
          },
        },
        {
          label: "credit noted",
          financialCaseId: creditNoted.financialCaseId,
          expected: {
            total: 115,
            paid: 100,
            remaining: 15,
            status: "PARTIAL",
            finalLocked: true,
            finalStatus: InvoiceStatus.CLOSED,
            financialTotal: 125,
            paidSoFar: 110,
            documentType: InvoiceType.CREDIT_NOTE,
          },
        },
        {
          label: "refunded",
          financialCaseId: refunded.financialCaseId,
          expected: {
            total: 100,
            paid: 100,
            remaining: 0,
            status: "REFUNDED",
            finalLocked: true,
            finalStatus: InvoiceStatus.CLOSED,
            documentType: InvoiceType.REFUND,
          },
        },
        {
          label: "overpaid",
          financialCaseId: overpaid.financialCaseId,
          expected: {
            total: 100,
            paid: 100,
            remaining: 0,
            status: "OVERPAID",
            finalLocked: true,
            finalStatus: InvoiceStatus.CLOSED,
            overpaymentCapacity: 10,
          },
        },
      ] as const;

      for (const activeCase of activeCases) {
        await t.test(activeCase.label, async () => {
          const summary = await getFinancialCaseSummary({
            financialCaseId: activeCase.financialCaseId,
          });
          assert.equal(summary?.stage, "active");

          const header = toOrderHeaderFinancial(summary);
          assert.ok(header);
          assert.equal(header.totalOrderValue, activeCase.expected.total);
          assert.equal(header.paidAmount, activeCase.expected.paid);
          assert.equal(header.outstandingAmount, activeCase.expected.remaining);
          assert.equal(header.paymentStatusEnum, activeCase.expected.status);
          assert.equal(
            header.refundedAmount,
            summary.refunds.reduce((sum, refund) => sum + refund.total, 0)
          );
          assert.equal(header.hasOverpayment, summary.overpaymentCapacity > 0);

          const sidebar = toDraftSidebarFinancial(summary);
          assert.ok(sidebar);
          assert.equal(sidebar.finalInvoiceId, summary.finalInvoice.id);
          assert.equal(sidebar.finalInvoiceNumber, summary.finalInvoice.invoiceNumber);
          assert.equal(sidebar.isLocked, activeCase.expected.finalLocked);
          assert.equal(sidebar.invoiceStatus, activeCase.expected.finalStatus);
          assert.equal(
            sidebar.invoiceTotal,
            "financialTotal" in activeCase.expected
              ? activeCase.expected.financialTotal
              : activeCase.expected.total
          );
          assert.equal(
            sidebar.paidSoFar,
            "paidSoFar" in activeCase.expected
              ? activeCase.expected.paidSoFar
              : activeCase.expected.paid
          );
          assert.equal(sidebar.depositApplied, summary.depositApplied);
          assert.equal(sidebar.remaining, activeCase.expected.remaining);
          assert.equal(sidebar.paymentStatusEnum, activeCase.expected.status);

          const paymentDialog = toPaymentDialogContext(summary);
          assert.ok(paymentDialog);
          assert.equal(paymentDialog.finalInvoiceId, summary.finalInvoice.id);
          assert.equal(paymentDialog.finalInvoiceNumber, summary.finalInvoice.invoiceNumber);
          assert.equal(paymentDialog.isLocked, activeCase.expected.finalLocked);
          assert.equal(paymentDialog.invoiceStatus, activeCase.expected.finalStatus);
          assert.equal(
            paymentDialog.invoiceTotal,
            "financialTotal" in activeCase.expected
              ? activeCase.expected.financialTotal
              : activeCase.expected.total
          );
          assert.equal(
            paymentDialog.paidAmount,
            "paidSoFar" in activeCase.expected
              ? activeCase.expected.paidSoFar
              : activeCase.expected.paid
          );
          assert.equal(paymentDialog.remainingAmount, activeCase.expected.remaining);
          assert.equal(paymentDialog.overpaymentCapacity, summary.overpaymentCapacity);
          assert.equal(paymentDialog.creditNoteCapacity, summary.creditNoteCapacity);
          assert.equal(paymentDialog.paymentStatusEnum, activeCase.expected.status);

          const tableRow = toOrdersTableRow(summary);
          assert.ok(tableRow);
          assert.equal(typeof tableRow.totalAmount, "number");
          assert.equal(typeof tableRow.paidAmount, "number");
          assert.equal(typeof tableRow.remainingAmount, "number");
          assert.equal(tableRow.totalAmount, activeCase.expected.total);
          assert.equal(tableRow.paidAmount, activeCase.expected.paid);
          assert.equal(tableRow.remainingAmount, activeCase.expected.remaining);
          assert.equal(tableRow.paymentStatusEnum, activeCase.expected.status);

          const bookingProjection = toBookingPageFinancial(summary);
          assert.equal(bookingProjection.stage, "active");
          assert.equal(bookingProjection.depositInvoice?.id, summary.depositInvoice?.id);
          assert.equal(
            bookingProjection.depositInvoice?.isLocked,
            summary.depositInvoice?.isLocked
          );
          assert.equal(bookingProjection.finalInvoice.id, summary.finalInvoice.id);
          assert.equal(bookingProjection.finalInvoice.total, summary.finalInvoice.total);
          assert.equal(
            bookingProjection.finalInvoice.remaining,
            summary.finalInvoice.remaining
          );
          assert.equal(bookingProjection.remaining, activeCase.expected.remaining);
          assert.equal(bookingProjection.paymentStatusEnum, activeCase.expected.status);

          const invoiceRows = toInvoiceListRow(summary);
          assert.equal(invoiceRows.length, summary.linkedDocuments.length);
          assert.ok(invoiceRows.length > 0);
          for (const document of summary.linkedDocuments) {
            const row = invoiceRows.find(
              (candidate) => candidate.invoiceId === document.invoiceId
            );
            assert.ok(row, `missing row for ${document.invoiceNumber}`);
            assert.equal(row.invoiceNumber, document.invoiceNumber);
            assert.equal(row.total, document.invoiceTotal);
            assert.equal(row.remainingAmount, document.remainingAmount);
            assert.equal(row.status, document.invoiceStatus);
          }
          if ("documentType" in activeCase.expected) {
            assert.ok(
              invoiceRows.some(
                (row) => row.invoiceType === activeCase.expected.documentType
              ),
              `expected ${activeCase.expected.documentType} linked document`
            );
          }
          if ("overpaymentCapacity" in activeCase.expected) {
            assert.equal(
              paymentDialog.overpaymentCapacity,
              activeCase.expected.overpaymentCapacity
            );
          }
        });
      }

      await t.test("parity checker covers R1b header and table projectors", async () => {
        const originalError = console.error;
        const errorMessages: string[] = [];
        console.error = (message?: unknown) => {
          errorMessages.push(String(message));
        };

        try {
          const violations = await checkFinancialCaseSummaryProjectorParity(
            dbFromEnv()
          );
          assert.deepEqual(violations, []);
          assert.deepEqual(
            errorMessages.filter((message) =>
              message.includes("centralization.financial_case_summary.discrepancy")
            ),
            []
          );
        } finally {
          console.error = originalError;
        }
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

function dbFromEnv() {
  const globalForPrisma = globalThis as typeof globalThis & {
    prisma?: import("@prisma/client").PrismaClient;
  };
  assert.ok(globalForPrisma.prisma, "expected Prisma client to be initialized");
  return globalForPrisma.prisma;
}
