import assert from "node:assert/strict";
import {
  OrderDeliveryStatus,
  OrderEditingStatus,
  OrderProductionStatus,
  OrderSelectionStatus,
  OrderStatus,
  PaymentMethod,
  PaymentType,
  UserRole,
} from "@prisma/client";
import {
  buildCheckedInWorkflowFixture,
  type PhaseBFixtures,
} from "../financial-phase-b/fixtures";
import type { AdjustmentWorkspaceEdit } from "../../src/modules/adjustment-workspace/adjustment-workspace.types";

const fixtures: PhaseBFixtures = phaseBFixtures();

export async function runEndToEndStudioWalkthroughSmokeTest(
  databaseUrl: string
): Promise<void> {
  void databaseUrl;
  const [
    { db },
    { createInvoiceForOrder, issueInvoice },
    { recordPayment },
    {
      updateOrderEditingWorkflow,
      updateOrderProductionWorkflow,
      updateOrderDeliveryWorkflow,
      getOrderEditingWorkflowById,
      getOrderProductionWorkflowById,
      getOrderDeliveryWorkflowById,
    },
    adjustmentWorkspace,
    { getFinancialCaseSummary },
    { getOrderCompositionViewModel },
    { toLockedPOSComposition },
  ] = await Promise.all([
    import("../../src/lib/db"),
    import("../../src/modules/invoices/invoice.service"),
    import("../../src/modules/payments/payment.service"),
    import("../../src/modules/orders/order.service"),
    import("../../src/modules/adjustment-workspace/adjustment-workspace.service"),
    import("../../src/modules/financial-cases"),
    import("../../src/modules/orders/composition"),
    import("../../src/modules/orders/composition/projections"),
  ]);

  process.stdout.write("workflow smoke: end-to-end studio walkthrough\n");

  const workflow = await buildCheckedInWorkflowFixture(
    db,
    fixtures,
    "r13c-e2e"
  );
  let summary = await getFinancialCaseSummary({ orderId: workflow.orderId });
  assert.ok(summary, "expected post-check-in financial summary");
  assert.equal(summary.stage, "booking");
  assert.equal(summary.awaitingFinalInvoiceAfterCheckIn, true);

  const existingAddOn = await db.orderAddOn.create({
    data: {
      orderId: workflow.orderId,
      productId: fixtures.addOnProductId,
      nameSnapshot: "R13c E2E removable add-on",
      priceSnapshot: 50,
      quantity: 1,
    },
    select: { id: true },
  });
  const invoice = await createInvoiceForOrder(workflow.orderId, fixtures.adminActor);
  await issueInvoice(invoice.id, fixtures.adminActor);
  await recordPayment(
    invoice.id,
    {
      amount: 530,
      method: PaymentMethod.CASH,
      paymentType: PaymentType.FINAL,
    },
    fixtures.adminActor
  );
  summary = await getFinancialCaseSummary({ orderId: workflow.orderId });
  assert.ok(summary, "expected settled active summary");
  assert.equal(summary.stage, "active");
  assert.equal(summary.paymentStatusEnum, "PAID");
  assert.equal(summary.remaining, 0);

  const lockedModel = await getOrderCompositionViewModel({ invoiceId: invoice.id });
  assert.ok(lockedModel, "expected locked model after settlement");
  const lockedProjection = toLockedPOSComposition(lockedModel);
  const lockedPackage = lockedProjection.packageLines[0];
  assert.ok(lockedPackage, "expected locked package projection");
  assert.equal(lockedPackage.includedPhotoCount, 10);
  assert.equal(lockedPackage.selectedPhotoCount, 10);

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
  const editingReady = await getOrderEditingWorkflowById(workflow.orderId);
  assert.ok(editingReady, "expected editing policy before start");
  assert.equal(editingReady.canMarkStarted, true);
  await updateOrderEditingWorkflow(
    workflow.orderId,
    { action: "markStarted", editedPhotoCount: 10 },
    fixtures.adminActor
  );

  const workspace = await adjustmentWorkspace.openWorkspace(
    invoice.id,
    fixtures.adminActor
  );
  let version = 0;
  for (const edit of [
    {
      id: "r13c-e2e-remove",
      op: "remove_line",
      targetLineId: `addon:${existingAddOn.id}`,
    },
    {
      id: "r13c-e2e-add",
      op: "add_line",
      kind: "addon",
      refId: fixtures.addOnProductId,
      quantity: 1,
    },
  ] satisfies AdjustmentWorkspaceEdit[]) {
    const view = await adjustmentWorkspace.applyEdit(
      workspace.id,
      { version, edit },
      fixtures.adminActor
    );
    version = view.version;
  }
  await adjustmentWorkspace.finalizeWorkspace(
    workspace.id,
    { version },
    fixtures.adminActor
  );
  const adjustedModel = await getOrderCompositionViewModel({ invoiceId: invoice.id });
  assert.ok(adjustedModel, "expected locked model after adjustment");
  const adjustedPackage = toLockedPOSComposition(adjustedModel).packageLines[0];
  assert.ok(adjustedPackage, "expected adjusted package projection");
  assert.equal(adjustedPackage.selectedPhotoCount, lockedPackage.selectedPhotoCount);

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
  const productionReadyInput = await getOrderProductionWorkflowById(workflow.orderId);
  assert.ok(productionReadyInput, "expected production policy before ready");
  assert.equal(
    productionReadyInput.workflowPolicy.productionStatus,
    OrderProductionStatus.IN_PROGRESS
  );
  await updateOrderProductionWorkflow(
    workflow.orderId,
    { action: "markProductionReadyForPickup" },
    fixtures.adminActor
  );
  const deliveryReady = await getOrderDeliveryWorkflowById(workflow.orderId);
  assert.ok(deliveryReady, "expected delivery policy after production ready");
  assert.equal(deliveryReady.workflowPolicy.deliveryStatus, OrderDeliveryStatus.READY_FOR_PICKUP);
  assert.equal(deliveryReady.workflowPolicy.canMarkPickedUp, true);

  await updateOrderDeliveryWorkflow(
    workflow.orderId,
    {
      action: "markPickedUp",
      completedById: fixtures.adminId,
      pickupNotes: "R13c end-to-end pickup",
    },
    fixtures.adminActor
  );
  const delivered = await db.order.findUniqueOrThrow({
    where: { id: workflow.orderId },
    select: {
      status: true,
      editingJob: { select: { status: true } },
      productionJob: { select: { status: true } },
      deliveryStatus: true,
    },
  });
  assert.equal(delivered.status, OrderStatus.DELIVERED);
  assert.equal(delivered.editingJob?.status, OrderEditingStatus.COMPLETED);
  assert.equal(delivered.productionJob?.status, OrderProductionStatus.COMPLETED);
  assert.equal(delivered.deliveryStatus, OrderDeliveryStatus.COMPLETED);

  summary = await getFinancialCaseSummary({ orderId: workflow.orderId });
  assert.ok(summary, "expected delivered financial summary");
  assert.equal(summary.stage, "active");
  assert.equal(summary.paymentStatusEnum, "PAID");
  assert.equal(summary.remaining, 0);

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
