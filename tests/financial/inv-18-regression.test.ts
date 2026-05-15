import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test from "node:test";
import { InvoiceType, PaymentMethod, PaymentType } from "@prisma/client";
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

test("INV-18 stays balanced when a paid adjustment cause is removed before a manual credit", async () => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const { db } = await import("@/lib/db");
      const {
        buildLockedFinalInvoiceWorkflowFixture,
        seedPhaseBFixtures,
      } = await import("../financial-phase-b/fixtures");
      const { addOrderProductAddOn, removeOrderAddOn } = await import(
        "@/modules/orders/order.service"
      );
      const { createCreditNote } = await import(
        "@/modules/invoices/invoice.service"
      );
      const { recordPayment } = await import("@/modules/payments/payment.service");
      const { executeFinancialReconciliation } = await import(
        "@/modules/financial/reconciliation.service"
      );

      const fixtures = await seedPhaseBFixtures(db);
      const workflow = await buildLockedFinalInvoiceWorkflowFixture(
        db,
        fixtures,
        "inv-18-regression"
      );

      await addOrderProductAddOn(
        workflow.orderId,
        { productId: fixtures.addOnProductId },
        fixtures.adminActor
      );

      const adjustment = await db.invoice.findFirstOrThrow({
        where: {
          orderId: workflow.orderId,
          invoiceType: InvoiceType.ADJUSTMENT,
        },
        orderBy: { createdAt: "desc" },
      });

      await recordPayment(
        adjustment.id,
        {
          amount: 50,
          method: PaymentMethod.CASH,
          paymentType: PaymentType.ADJUSTMENT,
        },
        fixtures.adminActor
      );

      const addOn = await db.orderAddOn.findFirstOrThrow({
        where: {
          orderId: workflow.orderId,
          productId: fixtures.addOnProductId,
        },
      });

      await removeOrderAddOn(
        workflow.orderId,
        {
          addOnId: addOn.id,
          managerApprovedReductionByUserId: fixtures.managerId,
          managerApprovedReason: "INV-18 repro: remove paid adjustment cause",
        },
        fixtures.adminActor
      );

      await createCreditNote({
        targetFinalInvoiceId: workflow.finalInvoiceId,
        lines: [
          {
            description: "INV-18 repro manual credit",
            quantity: 1,
            unitPrice: 55,
          },
        ],
        reason: "INV-18 regression repro manual credit",
        createdByUserId: fixtures.managerId,
      });

      const report = await executeFinancialReconciliation(db, {
        runAt: new Date("2026-05-15T02:00:00.000Z"),
      });
      const inv18Violations = report.violations.filter(
        (violation) =>
          violation.invariantId === "INV-18" &&
          violation.affectedEntityIds.includes(workflow.orderId)
      );

      assert.equal(
        inv18Violations.length,
        0,
        `Current code reproduces INV-18 drift: ${inv18Violations
          .map((violation) => violation.description)
          .join("; ")}`
      );
    } finally {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });
});
