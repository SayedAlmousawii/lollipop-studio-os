import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test from "node:test";
import { PaymentMethod, PaymentType } from "@prisma/client";
import { withIsolatedBackendInvariantSchema } from "../backend-invariants/harness";
import {
  makeManagerActor,
  makePhotographerActor,
} from "../fixtures/actor";

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

test("recordPayment enforces actor roles and rejects missing actorRole at runtime", async () => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const { db } = await import("@/lib/db");
      const { PERMISSIONS } = await import("@/lib/permissions");
      const {
        assertActorPermission,
        ForbiddenError,
        MissingActorRoleError,
      } = await import("@/lib/auth/assert-actor-permission");
      const {
        buildFinalInvoiceWorkflowFixture,
        seedPhaseFFixtures,
      } = await import("../financial-phase-f/fixtures");
      const {
        recordPayment,
        recordPaymentWithClient,
      } = await import("@/modules/payments/payment.service");

      const fixtures = await seedPhaseFFixtures(db);
      const workflow = await buildFinalInvoiceWorkflowFixture(
        db,
        fixtures,
        "payment-role-guard",
        { issue: true }
      );

      const beforeUnauthorizedAttempt = await db.paymentAllocation.count({
        where: { invoiceId: workflow.finalInvoiceId },
      });

      await assert.rejects(
        () =>
          recordPayment(
            workflow.finalInvoiceId,
            {
              amount: 1,
              method: PaymentMethod.CASH,
              paymentType: PaymentType.FINAL,
            },
            makePhotographerActor({ actorUserId: fixtures.photographerId })
          ),
        /Permission denied: payment:create/
      );

      assert.equal(
        await db.paymentAllocation.count({
          where: { invoiceId: workflow.finalInvoiceId },
        }),
        beforeUnauthorizedAttempt,
        "photographer payment attempt should not create allocations"
      );

      await assert.rejects(
        () =>
          db.$transaction((tx) =>
            recordPaymentWithClient(
              tx,
              workflow.finalInvoiceId,
              {
                amount: 1,
                method: PaymentMethod.CASH,
                paymentType: PaymentType.FINAL,
              },
              makePhotographerActor({ actorUserId: fixtures.photographerId })
            )
          ),
        (error) =>
          error instanceof ForbiddenError &&
          error.message === `Permission denied: ${PERMISSIONS.PAYMENT_CREATE}`
      );

      const managerPayment = await recordPayment(
        workflow.finalInvoiceId,
        {
          amount: 1,
          method: PaymentMethod.CASH,
          paymentType: PaymentType.FINAL,
        },
        makeManagerActor({ actorUserId: fixtures.managerId })
      );

      assert.ok(managerPayment.id, "manager payment should succeed");

      assert.throws(
        () =>
          assertActorPermission(
            {
              actorUserId: fixtures.managerId,
              actorRole: undefined,
            } as unknown as Parameters<typeof assertActorPermission>[0],
            PERMISSIONS.PAYMENT_CREATE
          ),
        MissingActorRoleError
      );
    } finally {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });
});
