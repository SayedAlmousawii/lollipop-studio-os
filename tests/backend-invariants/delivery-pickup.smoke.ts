import assert from "node:assert/strict";
import {
  OrderDeliveryStatus,
  OrderStatus,
  UserRole,
} from "@prisma/client";
import {
  buildFinalInvoiceWorkflowFixture,
  makeOrderReadyForDelivery,
  type PhaseBFixtures,
} from "../financial-phase-b/fixtures";

const fixtures: PhaseBFixtures = phaseBFixtures();

export async function runDeliveryPickupSmokeTest(
  databaseUrl: string
): Promise<void> {
  void databaseUrl;
  const [
    { db },
    { getOrderDeliveryWorkflowById, updateOrderDeliveryWorkflow },
    { getFinancialCaseSummary },
  ] = await Promise.all([
    import("../../src/lib/db"),
    import("../../src/modules/orders/order.service"),
    import("../../src/modules/financial-cases"),
  ]);

  process.stdout.write("workflow smoke: delivery pickup + override\n");

  const settled = await buildFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "r13c-delivery-settled",
    { issue: true, finalPaymentAmounts: [480] }
  );
  await makeOrderReadyForDelivery(db, settled.orderId);
  const settledBefore = await getOrderDeliveryWorkflowById(settled.orderId);
  assert.ok(settledBefore, "expected settled delivery workflow");
  assert.equal(settledBefore.workflowPolicy.canMarkPickedUp, true);
  assert.equal(settledBefore.workflowPolicy.requiresPaymentOverride, false);

  const settledAfter = await updateOrderDeliveryWorkflow(
    settled.orderId,
    {
      action: "markPickedUp",
      completedById: fixtures.adminId,
      pickupNotes: "R13c settled pickup",
    },
    fixtures.adminActor
  );
  assert.equal(settledAfter.workflowPolicy.deliveryStatus, OrderDeliveryStatus.COMPLETED);
  const settledOrder = await db.order.findUniqueOrThrow({
    where: { id: settled.orderId },
    select: { status: true },
  });
  assert.equal(settledOrder.status, OrderStatus.DELIVERED);
  const settledSummary = await getFinancialCaseSummary({ orderId: settled.orderId });
  assert.ok(settledSummary, "expected settled financial summary");
  assert.equal(settledSummary.stage, "active");
  assert.equal(settledSummary.paymentStatusEnum, "PAID");
  assert.equal(settledSummary.remaining, 0);

  const override = await buildFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "r13c-delivery-override",
    { issue: true, finalPaymentAmounts: [100] }
  );
  await makeOrderReadyForDelivery(db, override.orderId);
  const overrideBefore = await getOrderDeliveryWorkflowById(override.orderId);
  assert.ok(overrideBefore, "expected override delivery workflow");
  assert.equal(overrideBefore.workflowPolicy.canMarkPickedUp, true);
  assert.equal(overrideBefore.workflowPolicy.requiresPaymentOverride, true);

  const overrideAfter = await updateOrderDeliveryWorkflow(
    override.orderId,
    {
      action: "markPickedUp",
      completedById: fixtures.managerId,
      allowPaymentOverride: true,
      overrideReason: "R13c manager-approved pickup smoke",
    },
    fixtures.managerActor
  );
  assert.equal(overrideAfter.workflowPolicy.deliveryStatus, OrderDeliveryStatus.COMPLETED);
  const overrideSummary = await getFinancialCaseSummary({ orderId: override.orderId });
  assert.ok(overrideSummary, "expected override financial summary");
  assert.equal(overrideSummary.stage, "active");
  assert.equal(overrideSummary.paymentStatusEnum, "OVERRIDDEN");
  assert.ok(overrideSummary.remaining > 0);

  await db.$disconnect();
}

function phaseBFixtures(): PhaseBFixtures {
  return {
    adminId: "phase-b-77-admin",
    managerId: "phase-b-77-manager",
    photographerId: "phase-b-77-photographer",
    editorId: "phase-b-77-editor",
    departmentId: "phase-b-77-department",
    sessionTypeId: "phase-b-77-session-type",
    basePackageId: "phase-b-77-base-package",
    upgradePackageId: "phase-b-77-upgrade-package",
    addOnProductId: "phase-b-77-addon-product",
    zeroPriceAddOnProductId: "phase-b-77-zero-addon-product",
    adminActor: { actorUserId: "phase-b-77-admin", actorRole: UserRole.ADMIN },
    managerActor: {
      actorUserId: "phase-b-77-manager",
      actorRole: UserRole.MANAGER,
    },
  };
}
