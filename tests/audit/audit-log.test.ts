import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test from "node:test";
import {
  AuditAction,
  AuditEntityType,
  PaymentMethod,
  PaymentType,
  UserRole,
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

test("AuditLog records co-transactional financial and booking actions", async (t) => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [
        { db },
        { seedPhaseBFixtures, buildFinalInvoiceWorkflowFixture, buildLockedFinalInvoiceWorkflowFixture },
        { recordPayment },
        { addOrderProductAddOn, removeOrderAddOn },
        { recordAuditLog },
      ] = await Promise.all([
        import("@/lib/db"),
        import("../financial-phase-b/fixtures"),
        import("@/modules/payments/payment.service"),
        import("@/modules/orders/order.service"),
        import("@/modules/audit/audit-log.service"),
      ]);

      const fixtures = await seedPhaseBFixtures(db);

      await t.test("payment recording writes one invoice-scoped audit row", async () => {
        const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "audit-pay", {
          issue: true,
        });

        const payment = await recordPayment(
          workflow.finalInvoiceId,
          {
            amount: 1,
            method: PaymentMethod.CASH,
            paymentType: PaymentType.FINAL,
          },
          fixtures.managerActor
        );

        const rows = await db.auditLog.findMany({
          where: {
            action: AuditAction.PAYMENT_RECORDED,
            entityType: AuditEntityType.INVOICE,
            entityId: workflow.finalInvoiceId,
          },
        });

        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.actorUserId, fixtures.managerId);
        assert.equal((rows[0]?.after as { paymentId?: string })?.paymentId, payment.id);
      });

      await t.test("adjustment reversal writes a credit-note audit row", async () => {
        const workflow = await buildLockedFinalInvoiceWorkflowFixture(
          db,
          fixtures,
          "audit-credit"
        );
        await addOrderProductAddOn(
          workflow.orderId,
          { productId: fixtures.addOnProductId },
          fixtures.adminActor
        );
        const adjustment = await db.invoice.findFirstOrThrow({
          where: {
            orderId: workflow.orderId,
            invoiceType: "ADJUSTMENT",
          },
          select: { id: true, totalAmount: true },
          orderBy: { createdAt: "desc" },
        });
        await recordPayment(
          adjustment.id,
          {
            amount: adjustment.totalAmount.toNumber(),
            method: PaymentMethod.CASH,
            paymentType: PaymentType.ADJUSTMENT,
          },
          fixtures.managerActor
        );
        const addOn = await db.orderAddOn.findFirstOrThrow({
          where: { orderId: workflow.orderId, productId: fixtures.addOnProductId },
          select: { id: true },
        });

        await removeOrderAddOn(
          workflow.orderId,
          {
            addOnId: addOn.id,
            managerApprovedReductionByUserId: fixtures.managerId,
            managerApprovedReason: "Audit reversal test",
          },
          fixtures.managerActor
        );

        const row = await db.auditLog.findFirstOrThrow({
          where: { action: AuditAction.CREDIT_NOTE_ISSUED },
          orderBy: { occurredAt: "desc" },
        });
        assert.equal(row.actorUserId, fixtures.managerId);
        assert.equal(
          (row.after as { managerApprovedReductionByUserId?: string })
            .managerApprovedReductionByUserId,
          fixtures.managerId
        );
      });

      await t.test("full final-invoice payment writes a lock audit row", async () => {
        const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "audit-lock", {
          issue: true,
        });
        const invoice = await db.invoice.findUniqueOrThrow({
          where: { id: workflow.finalInvoiceId },
          select: { remainingAmount: true },
        });

        await recordPayment(
          workflow.finalInvoiceId,
          {
            amount: invoice.remainingAmount.toNumber(),
            method: PaymentMethod.CASH,
            paymentType: PaymentType.FINAL,
          },
          fixtures.managerActor
        );

        const row = await db.auditLog.findFirstOrThrow({
          where: {
            action: AuditAction.INVOICE_LOCKED,
            entityId: workflow.finalInvoiceId,
          },
        });
        assert.equal(row.actorUserId, fixtures.managerId);
        assert.equal((row.after as { isLocked?: boolean }).isLocked, true);
      });

      await t.test("audit rows roll back with their transaction", async () => {
        const entityId = "rolled-back-audit-entity";
        await assert.rejects(
          () =>
            db.$transaction(async (tx) => {
              await recordAuditLog(tx, fixtures.managerActor, {
                entityType: AuditEntityType.ORDER,
                entityId,
                action: AuditAction.ORDER_LOCKED_FIELD_MUTATED,
                before: { status: "before" },
                after: { status: "after" },
              });
              throw new Error("force rollback");
            }),
          /force rollback/
        );

        assert.equal(await db.auditLog.count({ where: { entityId } }), 0);
      });

      await t.test("empty actor ids are rejected before writing", async () => {
        await assert.rejects(
          () =>
            recordAuditLog(
              db,
              { actorUserId: "", actorRole: UserRole.MANAGER },
              {
                entityType: AuditEntityType.ORDER,
                entityId: "missing-actor",
                action: AuditAction.ORDER_LOCKED_FIELD_MUTATED,
              }
            ),
          /actorUserId is required/
        );
      });
    } finally {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });
});
