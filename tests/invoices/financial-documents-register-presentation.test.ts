import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test, { after } from "node:test";
import {
  CreditOrigin,
  DocumentApplicationKind,
  InvoiceLineType,
  InvoiceStatus,
  InvoiceType,
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
after(() => {
  moduleWithLoader._load = originalModuleLoad;
});

test("Spec 165 register/detail/projector present credit-note availability", async () => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [
        { db },
        { getInvoiceById, getInvoices, parseInvoiceFilters },
        { getFinancialCaseSummary, toInvoiceListRow },
        { makeFinancialCaseSummaryOrderFixture },
      ] = await Promise.all([
        import("@/lib/db"),
        import("@/modules/invoices/invoice.service"),
        import("@/modules/financial-cases"),
        import("../fixtures/financial"),
      ]);

      const fixture = await makeFinancialCaseSummaryOrderFixture(db, {
        suffix: "165REG",
        finalTotal: 160,
        finalPaymentAmount: 140,
        finalRemainingAmount: 0,
      });
      assert.ok(fixture.finalInvoiceId);
      assert.ok(fixture.orderId);

      const creditNote = await db.invoice.create({
        data: {
          publicId: "INV-165-CN",
          invoiceNumber: "CN-165",
          financialCaseId: fixture.financialCaseId,
          invoiceType: InvoiceType.CREDIT_NOTE,
          jobId: fixture.jobId,
          jobNumber: "JOB-FCS-165REG",
          bookingId: fixture.bookingId,
          orderId: fixture.orderId,
          customerId: fixture.customerId,
          parentInvoiceId: fixture.finalInvoiceId,
          totalAmount: new Prisma.Decimal(100),
          paidAmount: new Prisma.Decimal(0),
          remainingAmount: new Prisma.Decimal(0),
          status: InvoiceStatus.CLOSED,
          isLocked: true,
          creditOrigin: CreditOrigin.GOODWILL,
          issuedAt: new Date("2026-05-15T10:00:00.000Z"),
          closedAt: new Date("2026-05-15T10:00:00.000Z"),
          createdAt: new Date("2026-05-15T23:30:00.000Z"),
        },
      });
      await db.invoiceLineItem.create({
        data: {
          invoiceId: creditNote.id,
          lineType: InvoiceLineType.MANUAL_DISCOUNT,
          description: "Settlement credit",
          quantity: 1,
          unitPrice: new Prisma.Decimal(100),
          lineTotal: new Prisma.Decimal(100),
          sortOrder: 0,
        },
      });
      const adjustment = await db.invoice.create({
        data: {
          publicId: "INV-165-ADJ",
          invoiceNumber: "ADJ-165",
          financialCaseId: fixture.financialCaseId,
          invoiceType: InvoiceType.ADJUSTMENT,
          jobId: fixture.jobId,
          jobNumber: "JOB-FCS-165REG",
          bookingId: fixture.bookingId,
          orderId: fixture.orderId,
          customerId: fixture.customerId,
          parentInvoiceId: fixture.finalInvoiceId,
          totalAmount: new Prisma.Decimal(100),
          paidAmount: new Prisma.Decimal(60),
          remainingAmount: new Prisma.Decimal(40),
          status: InvoiceStatus.PARTIAL,
          isLocked: false,
          issuedAt: new Date("2026-05-15T10:05:00.000Z"),
          createdAt: new Date("2026-05-15T00:05:00.000Z"),
        },
      });
      await db.documentApplication.create({
        data: {
          sourceInvoiceId: creditNote.id,
          targetInvoiceId: adjustment.id,
          kind: DocumentApplicationKind.SETTLEMENT,
          amountApplied: new Prisma.Decimal(60),
        },
      });

      const register = await getInvoices();
      const creditNoteRow = register.rows.find(
        (row) => row.invoiceNumber === "CN-165"
      );
      assert.ok(creditNoteRow);
      assert.equal(creditNoteRow.signedAmount, "(100.000 KD)");
      assert.equal(creditNoteRow.outstanding, "40.000 KD");
      assert.equal(creditNoteRow.outstandingTone, "neutral");
      assert.equal(creditNoteRow.accountantStatus, "Partially used");

      const adjustmentRow = register.rows.find(
        (row) => row.invoiceNumber === "ADJ-165"
      );
      assert.ok(adjustmentRow);
      assert.equal(adjustmentRow.creditApplied, "60.000 KD");
      assert.deepEqual(adjustmentRow.applicationLinks, ["·CN-165"]);
      assert.equal(register.subtotals.invoicedGross, "260.000 KD");
      assert.equal(register.subtotals.creditsIssued, "(100.000 KD)");
      assert.equal(register.subtotals.invoicedNet, "160.000 KD");
      assert.equal(register.subtotals.receivable, "40.000 KD");

      const creditNoteDetail = await getInvoiceById(creditNote.id);
      assert.deepEqual(creditNoteDetail?.creditNoteHeadline, {
        totalCredit: "100.000 KD",
        appliedCredit: "60.000 KD",
        availableCredit: "40.000 KD",
      });

      const adjustmentDetail = await getInvoiceById(adjustment.id);
      assert.deepEqual(adjustmentDetail?.applicationBreakdown, [
        {
          label: "Settlement credit applied",
          documentNumber: "CN-165",
          amount: "60.000 KD",
          signed: "(60.000 KD)",
        },
      ]);

      const summary = await getFinancialCaseSummary({
        financialCaseId: fixture.financialCaseId,
      });
      assert.ok(summary);
      const projectedCreditNote = toInvoiceListRow(summary).find(
        (row) => row.invoiceNumber === "CN-165"
      );
      assert.ok(projectedCreditNote);
      assert.equal(projectedCreditNote.paidAmount, 60);
      assert.equal(projectedCreditNote.remainingAmount, 40);

      const adjustmentOnly = await getInvoices({
        types: [InvoiceType.ADJUSTMENT],
      });
      assert.deepEqual(
        adjustmentOnly.rows.map((row) => row.invoiceNumber),
        ["ADJ-165"]
      );
      assert.equal(adjustmentOnly.subtotals.invoicedGross, "100.000 KD");
      assert.equal(adjustmentOnly.subtotals.creditsIssued, "0.000 KD");
      assert.equal(adjustmentOnly.subtotals.invoicedNet, "100.000 KD");
      assert.equal(adjustmentOnly.subtotals.receivable, "40.000 KD");

      const createdOnDay = await getInvoices({
        createdFrom: "2026-05-15",
        createdTo: "2026-05-15",
      });
      assert.deepEqual(
        createdOnDay.rows.map((row) => row.invoiceNumber),
        ["CN-165", "ADJ-165"]
      );
      assert.equal(createdOnDay.subtotals.invoicedGross, "100.000 KD");
      assert.equal(createdOnDay.subtotals.creditsIssued, "(100.000 KD)");
      assert.equal(createdOnDay.subtotals.invoicedNet, "0.000 KD");
      assert.equal(createdOnDay.subtotals.receivable, "40.000 KD");

      const outstandingOnly = await getInvoices({ outstandingOnly: true });
      assert.deepEqual(
        outstandingOnly.rows.map((row) => row.invoiceNumber),
        ["ADJ-165"]
      );
      assert.equal(outstandingOnly.subtotals.receivable, "40.000 KD");

      const searchAndType = await getInvoices({
        search: "ADJ-165",
        types: [InvoiceType.ADJUSTMENT],
      });
      assert.deepEqual(
        searchAndType.rows.map((row) => row.invoiceNumber),
        ["ADJ-165"]
      );

      const searchMismatch = await getInvoices({
        search: "CN-165",
        types: [InvoiceType.ADJUSTMENT],
      });
      assert.deepEqual(searchMismatch.rows, []);
      assert.equal(searchMismatch.subtotals.invoicedGross, "0.000 KD");
      assert.equal(searchMismatch.subtotals.creditsIssued, "0.000 KD");
      assert.equal(searchMismatch.subtotals.invoicedNet, "0.000 KD");
      assert.equal(searchMismatch.subtotals.receivable, "0.000 KD");

      const parsedFilters = parseInvoiceFilters({
        search: " ADJ-165 ",
        type: ["NOPE", "SALE", "ADJUSTMENT", "ADJUSTMENT"],
        from: "not-a-date",
        to: "2026-05-15",
        outstandingOnly: "true",
      });
      assert.deepEqual(parsedFilters, {
        search: "ADJ-165",
        types: [InvoiceType.ADJUSTMENT],
        createdFrom: undefined,
        createdTo: "2026-05-15",
        outstandingOnly: true,
        page: undefined,
        pageSize: undefined,
      });

      const noMatches = await getInvoices({ types: [InvoiceType.REFUND] });
      assert.deepEqual(noMatches.rows, []);
      assert.equal(noMatches.subtotals.invoicedGross, "0.000 KD");
      assert.equal(noMatches.subtotals.creditsIssued, "0.000 KD");
      assert.equal(noMatches.subtotals.invoicedNet, "0.000 KD");
      assert.equal(noMatches.subtotals.depositsPrepaid, "0.000 KD");
      assert.equal(noMatches.subtotals.cashReceived, "0.000 KD");
      assert.equal(noMatches.subtotals.receivable, "0.000 KD");
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});
