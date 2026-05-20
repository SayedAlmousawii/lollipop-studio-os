import assert from "node:assert/strict";
import {
  OrderEditingStatus,
  OrderSelectionStatus,
  OrderStatus,
  UserRole,
} from "@prisma/client";
import {
  buildFinalInvoiceWorkflowFixture,
  type PhaseBFixtures,
} from "../financial-phase-b/fixtures";

const fixtures: PhaseBFixtures = phaseBFixtures();

export async function runEditingStartGateSmokeTest(
  databaseUrl: string
): Promise<void> {
  void databaseUrl;
  const [{ db }, { updateOrderEditingWorkflow }] = await Promise.all([
    import("../../src/lib/db"),
    import("../../src/modules/orders/order.service"),
  ]);

  process.stdout.write("workflow smoke: editing start gate\n");

  const workflow = await buildFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "r13c-editing-start",
    { issue: true, finalPaymentAmounts: [480] }
  );
  await db.order.update({
    where: { id: workflow.orderId },
    data: {
      status: OrderStatus.SELECTION_COMPLETED,
      selectionStatus: OrderSelectionStatus.COMPLETED,
    },
  });

  const assigned = await updateOrderEditingWorkflow(
    workflow.orderId,
    { action: "assignEditor", assignedEditorId: fixtures.editorId },
    fixtures.adminActor
  );
  const startAction = assigned.workflowPolicy.actions.find(
    (action) => action.key === "markStarted"
  );
  assert.equal(startAction?.available, true);
  assert.equal(assigned.canMarkStarted, true);

  const started = await updateOrderEditingWorkflow(
    workflow.orderId,
    { action: "markStarted", editedPhotoCount: 10 },
    fixtures.adminActor
  );
  assert.equal(started.workflowPolicy.status, OrderEditingStatus.IN_PROGRESS);
  assert.equal(started.canMarkComplete, true);
  assert.equal(
    started.workflowPolicy.actions.find((action) => action.key === "markComplete")
      ?.available,
    true
  );

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
