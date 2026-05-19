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
        { db },
        {
          getFinancialCaseSummary,
          toFinancialTabBlock,
          toSalesSidebarLocked,
        },
        { makeAutoAdjustedBookingFixture, makeFinancialCaseSummaryOrderFixture },
      ] = await Promise.all([
        import("@/lib/db"),
        import("@/modules/financial-cases"),
        import("../../fixtures/financial"),
      ]);

      await t.test("booking-stage summaries do not project active financial blocks", async () => {
        const booking = await makeFinancialCaseSummaryOrderFixture(db, {
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
        const fixture = await makeFinancialCaseSummaryOrderFixture(db, {
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
        const fixture = await makeAutoAdjustedBookingFixture(db);
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
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});
