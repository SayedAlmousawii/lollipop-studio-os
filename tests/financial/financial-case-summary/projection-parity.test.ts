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

const TOLERANCE = 0.0005;

test("FinancialCaseSummary projectors match legacy locked derivations", async (t) => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [
        { getPOSWorkspace, getLinkedFinancialDocumentsForOrder },
        { deriveLockedFinancialSidebarSummary },
        {
          getFinancialCaseSummary,
          toFinancialTabBlock,
          toSalesSidebarLocked,
          checkFinancialCaseSummaryProjectorParity,
        },
        {
          makeAutoAdjustedBookingFixture,
          makeFinancialCaseSummaryOrderFixture,
          makeMixedEditBookingFixture,
        },
      ] = await Promise.all([
        import("@/modules/orders/order.service"),
        import("@/modules/orders/order-settlement"),
        import("@/modules/financial-cases"),
        import("../../fixtures/financial"),
      ]);

      const locked = await makeFinancialCaseSummaryOrderFixture(dbFromEnv(), {
        suffix: "PARITY",
      });
      const adjusted = await makeAutoAdjustedBookingFixture(dbFromEnv());
      const creditNoted = await makeMixedEditBookingFixture(dbFromEnv());
      const cases = [
        ["locked", locked.financialCaseId, locked.orderId],
        ["locked adjusted", adjusted.financialCaseId, await resolveOrderId(adjusted.bookingId)],
        ["credit noted", creditNoted.financialCaseId, await resolveOrderId(creditNoted.bookingId)],
      ] as const;

      for (const [label, financialCaseId, orderId] of cases) {
        await t.test(label, async () => {
          assert.ok(orderId, `${label} fixture should resolve to an order`);
          const summary = await getFinancialCaseSummary({ financialCaseId });
          assert.equal(summary?.stage, "active");

          const legacy = await legacyLockedSummary(orderId);
          const financialTab = toFinancialTabBlock(summary);
          const salesSidebar = toSalesSidebarLocked(summary);

          assertProjectionClose(financialTab, legacy);
          assertProjectionClose(salesSidebar, legacy);
        });
      }

      await t.test("booking-stage projectors return null", async () => {
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

      await t.test("checker emits no discrepancies for clean fixtures", async () => {
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

      async function legacyLockedSummary(orderId: string) {
        const [workspace, linkedDocuments] = await Promise.all([
          getPOSWorkspace(orderId),
          getLinkedFinancialDocumentsForOrder(orderId),
        ]);
        assert.ok(workspace?.invoice, "legacy surface requires a workspace invoice");

        return deriveLockedFinancialSidebarSummary({
          finalInvoice: {
            totalAmount: workspace.invoice.invoiceTotal,
            remainingAmount: workspace.invoice.remainingAmount,
            depositPaidAmount: workspace.invoice.depositPaidAmount,
          },
          finalizedAdjustments: linkedDocuments
            .filter(
              (document) =>
                document.invoiceType === "ADJUSTMENT" &&
                document.invoiceStatus !== "DRAFT"
            )
            .map((document) => ({
              totalAmount: document.invoiceTotal,
              remainingAmount: document.remainingAmount,
            })),
          orderId,
        });
      }

      async function resolveOrderId(bookingId: string): Promise<string | null> {
        const order = await dbFromEnv().order.findUnique({
          where: { bookingId },
          select: { id: true },
        });
        return order?.id ?? null;
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

function assertProjectionClose(
  actual: Record<string, number> | null,
  expected: Record<string, number>
) {
  assert.ok(actual, "projector should return active projection");
  for (const [field, expectedValue] of Object.entries(expected)) {
    assert.ok(
      Math.abs(actual[field] - expectedValue) <= TOLERANCE,
      `${field}: expected ${expectedValue}, got ${actual[field]}`
    );
  }
}

function dbFromEnv() {
  const globalForPrisma = globalThis as typeof globalThis & {
    prisma?: import("@prisma/client").PrismaClient;
  };
  assert.ok(globalForPrisma.prisma, "expected Prisma client to be initialized");
  return globalForPrisma.prisma;
}
