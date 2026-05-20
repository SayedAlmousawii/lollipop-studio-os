import assert from "node:assert/strict";
import { UserRole } from "@prisma/client";
import {
  buildFinalInvoiceWorkflowFixture,
  type PhaseBFixtures,
} from "../financial-phase-b/fixtures";
import type { AdjustmentWorkspaceEdit } from "../../src/modules/adjustment-workspace/adjustment-workspace.types";

const fixtures: PhaseBFixtures = phaseBFixtures();

export async function runLockedAdjustmentSmokeTest(
  databaseUrl: string
): Promise<void> {
  void databaseUrl;
  const [
    { db },
    adjustmentWorkspace,
    { getFinancialCaseSummary },
    { getOrderCompositionViewModel },
    { toLockedPOSComposition },
  ] = await Promise.all([
    import("../../src/lib/db"),
    import("../../src/modules/adjustment-workspace/adjustment-workspace.service"),
    import("../../src/modules/financial-cases"),
    import("../../src/modules/orders/composition"),
    import("../../src/modules/orders/composition/projections"),
  ]);

  process.stdout.write("workflow smoke: locked adjustment\n");

  const workflow = await buildFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "r13c-locked-adjustment",
    {
      issue: true,
      finalPaymentAmounts: [530],
      preInvoiceAddOnQuantity: 1,
    }
  );
  const beforeModel = await getOrderCompositionViewModel({
    invoiceId: workflow.finalInvoiceId,
  });
  assert.ok(beforeModel, "expected locked composition before adjustment");
  const beforeProjection = toLockedPOSComposition(beforeModel);
  const beforePackage = beforeProjection.packageLines[0];
  assert.ok(beforePackage, "expected package projection before adjustment");

  const existingAddOn = await db.orderAddOn.findFirstOrThrow({
    where: { orderId: workflow.orderId },
    select: { id: true },
  });
  const workspace = await adjustmentWorkspace.openWorkspace(
    workflow.finalInvoiceId,
    fixtures.adminActor
  );
  let version = 0;
  for (const edit of [
    {
      id: "r13c-add-addon",
      op: "add_line",
      kind: "addon",
      refId: fixtures.addOnProductId,
      quantity: 1,
    },
    {
      id: "r13c-remove-addon",
      op: "remove_line",
      targetLineId: `addon:${existingAddOn.id}`,
    },
  ] satisfies AdjustmentWorkspaceEdit[]) {
    const view = await adjustmentWorkspace.applyEdit(
      workspace.id,
      { version, edit },
      fixtures.adminActor
    );
    version = view.version;
  }

  const pending = await adjustmentWorkspace.getAdjustmentWorkspaceView(workspace.id);
  assert.ok(pending, "expected pending workspace view");
  assert.equal(pending.pendingChanges.edits.length, 2);
  assert.equal(pending.proposal.adjustmentKind, "negative");
  assert.ok(Number(pending.proposal.netPayableDelta) < 0);

  const finalized = await adjustmentWorkspace.finalizeWorkspace(
    workspace.id,
    {
      version,
      managerApprovedReductionByUserId: fixtures.managerId,
      managerApprovedReason: "R13c locked adjustment smoke",
    },
    fixtures.adminActor
  );
  assert.ok(finalized.adjustmentInvoiceId, "expected adjustment invoice");

  const summary = await getFinancialCaseSummary({ orderId: workflow.orderId });
  assert.ok(summary, "expected active financial summary");
  assert.equal(summary.stage, "active");
  assert.equal(summary.finalizedAdjustments.length, 1);
  assert.ok(summary.totalAdjustments < 0);

  const afterModel = await getOrderCompositionViewModel({
    invoiceId: workflow.finalInvoiceId,
  });
  assert.ok(afterModel, "expected locked composition after adjustment");
  const afterPackage = toLockedPOSComposition(afterModel).packageLines[0];
  assert.ok(afterPackage, "expected package projection after adjustment");
  assert.equal(afterPackage.includedPhotoCount, beforePackage.includedPhotoCount);
  assert.equal(afterPackage.selectedPhotoCount, beforePackage.selectedPhotoCount);

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
