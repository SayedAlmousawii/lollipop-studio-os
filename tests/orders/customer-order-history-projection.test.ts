import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test, { after } from "node:test";
import { InvoiceStatus } from "@prisma/client";
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

test("customer order history reads invoice and payment status from projections", async () => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [
        { getOrdersByCustomerId },
        { makeFinancialCaseSummaryOrderFixture },
        { mapFinancialCasePaymentStatusToLabel },
      ] = await Promise.all([
        import("@/modules/orders/order.service"),
        import("../fixtures/financial"),
        import("@/modules/financial-cases/financial-case-summary.constants"),
      ]);
      const globalForPrisma = globalThis as typeof globalThis & {
        prisma?: import("@prisma/client").PrismaClient;
      };
      assert.ok(globalForPrisma.prisma, "expected Prisma client");

      const fixture = await makeFinancialCaseSummaryOrderFixture(
        globalForPrisma.prisma,
        {
          suffix: "R12HIST",
          finalPaymentAmount: 55,
          finalRemainingAmount: 25,
          finalStatus: InvoiceStatus.CLOSED,
          finalIsLocked: true,
        }
      );

      const rows = await getOrdersByCustomerId(fixture.customerId, 5);

      assert.equal(rows[0]?.invoiceStatus, "Closed");
      assert.equal(rows[0]?.paymentStatus, "Overridden");
      assert.equal(
        mapFinancialCasePaymentStatusToLabel("OVERRIDDEN"),
        rows[0]?.paymentStatus
      );
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});
