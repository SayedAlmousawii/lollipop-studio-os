import assert from "node:assert/strict";
import {
  OrderDeliveryStatus,
  OrderProductionStatus,
  OrderSelectionStatus,
  OrderStatus,
  UserRole,
} from "@prisma/client";
import {
  buildFinalInvoiceWorkflowFixture,
  type PhaseBFixtures,
} from "../financial-phase-b/fixtures";

const fixtures: PhaseBFixtures = phaseBFixtures();

export async function runProductionReadinessSmokeTest(
  databaseUrl: string
): Promise<void> {
  void databaseUrl;
  const [
    { db },
    {
      updateOrderEditingWorkflow,
      updateOrderProductionWorkflow,
      getOrderProductionWorkflowById,
    },
    { getOrderCompositionViewModel },
    { toProductionDeliverables },
  ] = await Promise.all([
    import("../../src/lib/db"),
    import("../../src/modules/orders/order.service"),
    import("../../src/modules/orders/composition"),
    import("../../src/modules/orders/composition/projections"),
  ]);

  process.stdout.write("workflow smoke: production readiness\n");

  const workflow = await buildFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "r13c-production-ready",
    { issue: true, finalPaymentAmounts: [480] }
  );
  await db.order.update({
    where: { id: workflow.orderId },
    data: {
      status: OrderStatus.SELECTION_COMPLETED,
      selectionStatus: OrderSelectionStatus.COMPLETED,
    },
  });
  await updateOrderEditingWorkflow(
    workflow.orderId,
    { action: "assignEditor", assignedEditorId: fixtures.editorId },
    fixtures.adminActor
  );
  await updateOrderEditingWorkflow(
    workflow.orderId,
    { action: "markStarted", editedPhotoCount: 10 },
    fixtures.adminActor
  );
  await updateOrderEditingWorkflow(
    workflow.orderId,
    { action: "markComplete", editedPhotoCount: 10 },
    fixtures.adminActor
  );
  await updateOrderEditingWorkflow(
    workflow.orderId,
    { action: "markApproved" },
    fixtures.adminActor
  );
  await updateOrderEditingWorkflow(
    workflow.orderId,
    { action: "sendToProduction" },
    fixtures.adminActor
  );

  const beforeReady = await getOrderProductionWorkflowById(workflow.orderId);
  assert.ok(beforeReady, "expected production workflow before readiness");
  assert.equal(
    beforeReady.workflowPolicy.finalReadinessAction.available,
    true
  );

  const ready = await updateOrderProductionWorkflow(
    workflow.orderId,
    { action: "markProductionReadyForPickup" },
    fixtures.adminActor
  );
  assert.equal(
    ready.workflowPolicy.productionStatus,
    OrderProductionStatus.READY_FOR_PICKUP
  );
  assert.equal(ready.workflowPolicy.deliveryStatus, OrderDeliveryStatus.READY_FOR_PICKUP);
  assert.equal(ready.workflowPolicy.finalReadinessAction.available, false);

  const model = await getOrderCompositionViewModel({
    invoiceId: workflow.finalInvoiceId,
  });
  assert.ok(model, "expected locked composition for production deliverables");
  const deliverables = toProductionDeliverables(model);
  assert.equal(deliverables.includedPhotoCount, 10);
  assert.equal(deliverables.extraPhotoCount, 0);
  assert.equal(deliverables.rows.length, 1);

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
