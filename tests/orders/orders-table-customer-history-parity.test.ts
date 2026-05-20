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

test("orders table and customer history financial projections stay byte-equivalent", async () => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [
        { db },
        { getOrders, getOrdersByCustomerId },
        { getOrdersTableFinancialProjections },
        { mapFinancialCasePaymentStatusToLabel },
        { makeFinancialCaseSummaryOrderFixture },
      ] = await Promise.all([
        import("@/lib/db"),
        import("@/modules/orders/order.service"),
        import("@/modules/financial-cases"),
        import("@/modules/financial-cases/financial-case-summary.constants"),
        import("../fixtures/financial"),
      ]);

      const fixtures = [
        await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "110001",
          finalStatus: InvoiceStatus.DRAFT,
          finalPaymentAmount: 0,
          finalRemainingAmount: 100,
          finalIsLocked: false,
        }),
        await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "110002",
          finalStatus: InvoiceStatus.CLOSED,
          finalPaymentAmount: 80,
          finalRemainingAmount: 0,
          finalIsLocked: true,
        }),
        await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "110003",
          finalStatus: InvoiceStatus.CLOSED,
          finalPaymentAmount: 55,
          finalRemainingAmount: 25,
          finalIsLocked: true,
        }),
        await makeFinancialCaseSummaryOrderFixture(db, {
          suffix: "110004",
          finalStatus: InvoiceStatus.PARTIAL,
          finalPaymentAmount: 30,
          finalRemainingAmount: 50,
          finalIsLocked: false,
        }),
      ];
      const orderIds = fixtures.map((fixture) => fixture.orderId).filter(Boolean);
      assert.equal(orderIds.length, fixtures.length);

      const tableProjectionByOrderId = await getOrdersTableFinancialProjections({
        orderIds: orderIds as string[],
      });
      const orders = await getOrders();
      const orderSurfaceById = new Map(orders.map((order) => [order.id, order]));

      for (const fixture of fixtures) {
        assert.ok(fixture.orderId, "expected fixture order id");
        const tableProjection = tableProjectionByOrderId.get(fixture.orderId);
        const orderSurface = orderSurfaceById.get(fixture.orderId);
        const historyRows = await getOrdersByCustomerId(fixture.customerId, 10);
        const historySurface = historyRows.find((row) => row.id === fixture.orderId);

        assert.ok(tableProjection, "expected orders table projection");
        assert.ok(orderSurface, "expected orders table service row");
        assert.ok(historySurface, "expected customer history row");

        assert.deepEqual(
          {
            invoiceStatus: orderSurface.financial?.invoiceStatus,
            paymentStatus: orderSurface.financial?.paymentStatusEnum,
            totalAmount: orderSurface.financial?.totalAmount,
            paidAmount: orderSurface.financial?.paidAmount,
            remainingAmount: orderSurface.financial?.remainingAmount,
          },
          {
            invoiceStatus: tableProjection.invoiceStatus,
            paymentStatus: tableProjection.paymentStatusEnum,
            totalAmount: tableProjection.totalAmount,
            paidAmount: tableProjection.paidAmount,
            remainingAmount: tableProjection.remainingAmount,
          }
        );
        assert.equal(
          historySurface.invoiceStatus,
          labelInvoiceStatus(tableProjection.invoiceStatus)
        );
        assert.equal(
          historySurface.paymentStatus,
          mapFinancialCasePaymentStatusToLabel(tableProjection.paymentStatusEnum)
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

function labelInvoiceStatus(status: InvoiceStatus): string {
  switch (status) {
    case InvoiceStatus.DRAFT:
      return "Draft";
    case InvoiceStatus.ISSUED:
      return "Issued";
    case InvoiceStatus.PARTIAL:
      return "Partial";
    case InvoiceStatus.PAID:
      return "Paid";
    case InvoiceStatus.CLOSED:
      return "Closed";
  }
}
