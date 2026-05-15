import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test, { after } from "node:test";
import {
  AuditAction,
  AuditEntityType,
  InvoiceStatus,
  PaymentMethod,
  PaymentType,
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

test("locked invoice snapshots and DB immutability guard frozen fields", async (t) => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [{ db }, phaseFFixtures, payments, invariants] = await Promise.all([
        import("@/lib/db"),
        import("../financial-phase-f/fixtures"),
        import("@/modules/payments/payment.service"),
        import("@/modules/financial/invariants"),
      ]);

      const fixtures = await phaseFFixtures.seedPhaseFFixtures(db);
      await db.package.update({
        where: { id: fixtures.basePackageId },
        data: { price: new Prisma.Decimal(250) },
      });
      const workflow = await phaseFFixtures.buildFinalInvoiceWorkflowFixture(
        db,
        fixtures,
        "80b-lock",
        { issue: true }
      );

      await payments.recordPayment(
        workflow.finalInvoiceId,
        {
          amount: 230,
          method: PaymentMethod.CASH,
          paymentType: PaymentType.FINAL,
        },
        fixtures.managerActor
      );

      await t.test("lock writes one matching snapshot and one lock audit row", async () => {
        const [invoice, snapshots, auditRows] = await Promise.all([
          db.invoice.findUniqueOrThrow({
            where: { id: workflow.finalInvoiceId },
            select: {
              publicId: true,
              totalAmount: true,
              invoiceType: true,
              parentInvoiceId: true,
              financialCaseId: true,
              jobId: true,
              orderId: true,
              invoiceNumber: true,
              isLocked: true,
            },
          }),
          db.invoiceLockSnapshot.findMany({
            where: { invoiceId: workflow.finalInvoiceId },
          }),
          db.auditLog.findMany({
            where: {
              entityType: AuditEntityType.INVOICE,
              entityId: workflow.finalInvoiceId,
              action: AuditAction.INVOICE_LOCKED,
            },
          }),
        ]);

        assert.equal(invoice.isLocked, true);
        assert.equal(snapshots.length, 1);
        assert.equal(snapshots[0]?.lockedByUserId, fixtures.managerId);
        assert.equal(snapshots[0]?.publicId, invoice.publicId);
        assert.equal(snapshots[0]?.totalAmount.equals(invoice.totalAmount), true);
        assert.equal(snapshots[0]?.invoiceType, invoice.invoiceType);
        assert.equal(snapshots[0]?.parentInvoiceId, invoice.parentInvoiceId);
        assert.equal(snapshots[0]?.financialCaseId, invoice.financialCaseId);
        assert.equal(snapshots[0]?.jobId, invoice.jobId);
        assert.equal(snapshots[0]?.orderId, invoice.orderId);
        assert.equal(snapshots[0]?.invoiceNumber, invoice.invoiceNumber);
        assert.equal(auditRows.length, 1);
      });

      await t.test("direct frozen total mutation is rejected", async () => {
        await assert.rejects(
          () =>
            db.invoice.update({
              where: { id: workflow.finalInvoiceId },
              data: { totalAmount: new Prisma.Decimal(251) },
            }),
          /Frozen field mutation|check_violation|constraint failed/i
        );
      });

      await t.test("direct frozen invoice number mutation is rejected", async () => {
        await assert.rejects(
          () =>
            db.invoice.update({
              where: { id: workflow.finalInvoiceId },
              data: { invoiceNumber: "FINAL-SMUGGLED-80B" },
            }),
          /Frozen field mutation|check_violation|constraint failed/i
        );
      });

      await t.test("mutable locked invoice status update succeeds", async () => {
        await db.invoice.update({
          where: { id: workflow.finalInvoiceId },
          data: { status: InvoiceStatus.ISSUED },
        });
        const updated = await db.invoice.findUniqueOrThrow({
          where: { id: workflow.finalInvoiceId },
          select: { status: true },
        });
        assert.equal(updated.status, InvoiceStatus.ISSUED);

        await db.invoice.update({
          where: { id: workflow.finalInvoiceId },
          data: { status: InvoiceStatus.CLOSED },
        });
      });

      await t.test("plain unlock succeeds", async () => {
        const unlocked = await db.invoice.update({
          where: { id: workflow.finalInvoiceId },
          data: { isLocked: false },
          select: { isLocked: true },
        });
        assert.equal(unlocked.isLocked, false);
      });

      await t.test("unlock cannot smuggle a frozen total mutation", async () => {
        await db.invoice.update({
          where: { id: workflow.finalInvoiceId },
          data: { isLocked: true },
        });

        await assert.rejects(
          () =>
            db.invoice.update({
              where: { id: workflow.finalInvoiceId },
              data: {
                isLocked: false,
                totalAmount: new Prisma.Decimal(251),
              },
            }),
          /Frozen field mutation|check_violation|constraint failed/i
        );
      });

      await t.test("snapshot reconciliation invariant reports zero violations", async () => {
        const violations = await invariants.runAllInvariants(db);
        assert.deepEqual(
          violations.filter(
            (violation) =>
              violation.invariant ===
              "locked-invoice-frozen-fields-match-snapshot"
          ),
          []
        );
      });

      await db.$disconnect();
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});
