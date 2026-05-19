import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test, { after } from "node:test";
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

test("FinancialCaseSummary financial tab and locked sales projectors expose canonical values", async (t) => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [
        {
          getFinancialCaseSummary,
          toFinancialTabBlock,
          toSalesSidebarLocked,
        },
        {
          makeAutoAdjustedBookingFixture,
          makeFinancialCaseSummaryOrderFixture,
          makeMixedEditBookingFixture,
        },
      ] = await Promise.all([
        import("@/modules/financial-cases"),
        import("../../fixtures/financial"),
      ]);

      await t.test("booking-stage summaries do not project active financial blocks", async () => {
        const booking = await makeFinancialCaseSummaryOrderFixture(dbFromEnv(), {
          suffix: "NOPROJ",
          createFinalInvoice: false,
        });
        const summary = await getFinancialCaseSummary({
          financialCaseId: booking.financialCaseId,
        });

        assert.equal(summary?.stage, "booking");
        assert.equal(toFinancialTabBlock(summary), null);
        assert.equal(toSalesSidebarLocked(summary), null);
      });

      await t.test("locked active summary projects settled totals", async () => {
        const fixture = await makeFinancialCaseSummaryOrderFixture(dbFromEnv(), {
          suffix: "TABLOCK",
        });
        const summary = await getFinancialCaseSummary({
          financialCaseId: fixture.financialCaseId,
        });

        assert.equal(summary?.stage, "active");
        const financialTab = toFinancialTabBlock(summary);
        assert.deepEqual(financialTab, {
          customerTotal: 100,
          paidSoFar: 100,
          includesDeposit: 20,
          remaining: 0,
          finalInvoiceTotal: 100,
          totalAdjustments: 0,
          finalTotal: 100,
        });
        assert.deepEqual(toSalesSidebarLocked(summary), financialTab);
      });

      await t.test("adjusted active summary includes finalized adjustment totals", async () => {
        const fixture = await makeAutoAdjustedBookingFixture(dbFromEnv());
        const summary = await getFinancialCaseSummary({
          financialCaseId: fixture.financialCaseId,
        });

        assert.equal(summary?.stage, "active");
        const financialTab = toFinancialTabBlock(summary);
        assert.deepEqual(financialTab, {
          customerTotal: 115,
          paidSoFar: 100,
          includesDeposit: 20,
          remaining: 15,
          finalInvoiceTotal: 100,
          totalAdjustments: 15,
          finalTotal: 115,
        });
        assert.deepEqual(toSalesSidebarLocked(summary), financialTab);
      });

      await t.test("credit-noted active summary includes credit note effect", async () => {
        const fixture = await makeMixedEditBookingFixture(dbFromEnv());
        const summary = await getFinancialCaseSummary({
          financialCaseId: fixture.financialCaseId,
        });

        assert.equal(summary?.stage, "active");
        const financialTab = toFinancialTabBlock(summary);
        assert.deepEqual(financialTab, {
          customerTotal: 125,
          paidSoFar: 110,
          includesDeposit: 20,
          remaining: 15,
          finalInvoiceTotal: 110,
          totalAdjustments: 15,
          finalTotal: 125,
        });
        assert.deepEqual(toSalesSidebarLocked(summary), financialTab);
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
