import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test, { after } from "node:test";
import { InvoiceType } from "@prisma/client";
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

test("booking deposit invoices are canonical on FinancialCase invoices", async () => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [{ db }, { makeFinancialCaseSummaryOrderFixture }] =
        await Promise.all([
          import("@/lib/db"),
          import("../fixtures/financial"),
        ]);

      await makeFinancialCaseSummaryOrderFixture(db, {
        suffix: "R12CAN",
      });
      await makeFinancialCaseSummaryOrderFixture(db, {
        suffix: "R12BK",
        createFinalInvoice: false,
      });

      const rows = await db.booking.findMany({
        select: {
          id: true,
          publicId: true,
          invoices: {
            where: { invoiceType: InvoiceType.DEPOSIT },
            select: { id: true, createdAt: true },
            orderBy: { createdAt: "desc" },
          },
          financialCase: {
            select: {
              invoices: {
                where: { invoiceType: InvoiceType.DEPOSIT },
                select: { id: true, createdAt: true },
                orderBy: { createdAt: "desc" },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      assert.ok(rows.length > 0, "expected booking fixtures for audit");

      for (const row of rows) {
        const bookingInvoiceIds = row.invoices.map((invoice) => invoice.id);
        const financialCaseInvoices = row.financialCase?.invoices ?? [];
        const financialCaseInvoiceIds = new Set(
          financialCaseInvoices.map((invoice) => invoice.id)
        );

        for (const invoiceId of bookingInvoiceIds) {
          assert.ok(
            financialCaseInvoiceIds.has(invoiceId),
            `booking ${row.publicId ?? row.id} has non-canonical deposit invoice ${invoiceId}`
          );
        }

        const mergedLegacyOrder = dedupeAndSortDepositInvoices([
          ...row.invoices,
          ...financialCaseInvoices,
        ]).map((invoice) => invoice.id);
        const directFinancialCaseOrder = financialCaseInvoices.map(
          (invoice) => invoice.id
        );

        assert.deepEqual(
          directFinancialCaseOrder,
          mergedLegacyOrder,
          `booking ${row.publicId ?? row.id} deposit invoice ordering differs`
        );
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

function dedupeAndSortDepositInvoices<T extends { id: string; createdAt: Date }>(
  invoices: T[]
): T[] {
  return Array.from(
    invoices.reduce((map, invoice) => {
      const existing = map.get(invoice.id);
      if (!existing || existing.createdAt < invoice.createdAt) {
        map.set(invoice.id, invoice);
      }
      return map;
    }, new Map<string, T>())
  )
    .map(([, invoice]) => invoice)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}
