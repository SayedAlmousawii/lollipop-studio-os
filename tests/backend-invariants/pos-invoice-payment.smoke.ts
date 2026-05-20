import assert from "node:assert/strict";
import { InvoiceStatus, PaymentMethod, PaymentType, UserRole } from "@prisma/client";
import {
  buildCheckedInWorkflowFixture,
  type PhaseBFixtures,
} from "../financial-phase-b/fixtures";

const fixtures: PhaseBFixtures = phaseBFixtures();

export async function runPOSInvoicePaymentSmokeTest(
  databaseUrl: string
): Promise<void> {
  void databaseUrl;
  const [
    { db },
    { createInvoiceForOrder, issueInvoice },
    { recordPayment },
    { getFinancialCaseSummary, getOrdersTableFinancialProjections },
    { getOrderCompositionViewModel },
    { toDraftPOSComposition, toLockedPOSComposition },
  ] = await Promise.all([
    import("../../src/lib/db"),
    import("../../src/modules/invoices/invoice.service"),
    import("../../src/modules/payments/payment.service"),
    import("../../src/modules/financial-cases"),
    import("../../src/modules/orders/composition"),
    import("../../src/modules/orders/composition/projections"),
  ]);

  process.stdout.write("workflow smoke: POS invoice + payment\n");

  const workflow = await buildCheckedInWorkflowFixture(
    db,
    fixtures,
    "r13c-pos-payment"
  );
  const draftModel = await getOrderCompositionViewModel({
    orderId: workflow.orderId,
  });
  assert.ok(draftModel, "expected draft composition model");
  const draftProjection = toDraftPOSComposition(draftModel);
  assert.equal(draftProjection.sourceState, "draft");
  assert.equal(draftProjection.packageLines[0]?.packageName, "Phase B Base Package");
  assert.equal(draftProjection.totals.netCompositionTotal, 500);

  const invoice = await createInvoiceForOrder(workflow.orderId, fixtures.adminActor);
  await issueInvoice(invoice.id, fixtures.adminActor);
  await recordPayment(
    invoice.id,
    {
      amount: 480,
      method: PaymentMethod.CASH,
      paymentType: PaymentType.FINAL,
    },
    fixtures.adminActor
  );

  const lockedInvoice = await db.invoice.findUniqueOrThrow({
    where: { id: invoice.id },
    select: { status: true, isLocked: true, remainingAmount: true },
  });
  assert.equal(lockedInvoice.status, InvoiceStatus.CLOSED);
  assert.equal(lockedInvoice.isLocked, true);
  assert.equal(lockedInvoice.remainingAmount.toNumber(), 0);

  const lockedModel = await getOrderCompositionViewModel({
    invoiceId: invoice.id,
  });
  assert.ok(lockedModel, "expected locked composition model");
  const lockedProjection = toLockedPOSComposition(lockedModel);
  assert.equal(lockedProjection.sourceState, "locked");
  assert.equal(lockedProjection.locked, true);
  assert.equal(lockedProjection.totals.netCompositionTotal, 500);

  const summary = await getFinancialCaseSummary({ orderId: workflow.orderId });
  assert.ok(summary, "expected active financial case summary");
  assert.equal(summary.stage, "active");
  assert.equal(summary.paymentStatusEnum, "PAID");
  assert.equal(summary.effectivePaid, 500);
  assert.equal(summary.depositApplied, 20);
  assert.equal(summary.remaining, 0);

  const tableRows = await getOrdersTableFinancialProjections({
    orderIds: [workflow.orderId],
  });
  const tableRow = tableRows.get(workflow.orderId);
  assert.ok(tableRow, "expected orders table projection");
  assert.equal(tableRow.paymentStatusEnum, summary.paymentStatusEnum);
  assert.equal(tableRow.totalAmount, summary.customerTotal);
  assert.equal(tableRow.remainingAmount, summary.remaining);

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
