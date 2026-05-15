import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BookingStatus,
  InvoiceLineType,
  InvoiceType,
  OrderEditingStatus,
  OrderSelectionStatus,
  OrderStatus,
  PaymentMethod,
  PaymentType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { updateBookingStatus } from "@/modules/bookings/booking.service";
import {
  createAdjustmentInvoice,
  createCreditNote,
  createRefundInvoice,
} from "@/modules/invoices/invoice.service";
import {
  recordPOSPaymentForOrder,
  updateOrderDeliveryWorkflow,
  updateOrderEditingWorkflow,
} from "@/modules/orders/order.service";
import { createBookingSchema } from "@/modules/bookings/booking.schema";
import { createRefundInvoiceSchema } from "@/modules/invoices/invoice.schema";
import { recordPaymentSchema } from "@/modules/payments/payment.schema";
import { recordPayment } from "@/modules/payments/payment.service";
import { expectRejectsWithoutPartialWrites } from "../financial-phase-b/assertions";
import {
  buildFinalInvoiceWorkflowFixture,
  buildLockedFinalInvoiceWorkflowFixture,
  buildPendingBookingFixture,
  seedPhaseFFixtures,
  type PhaseFFixtures,
} from "./fixtures";

type CaseRunner = {
  id: string;
  run: (db: PrismaClient, fixtures: PhaseFFixtures) => Promise<void>;
};

export async function runPhaseFSecurityPermissionSuite(
  db: PrismaClient,
  fixtures?: PhaseFFixtures
): Promise<void> {
  const activeFixtures = fixtures ?? (await seedPhaseFFixtures(db));
  const cases: CaseRunner[] = [
    { id: "F-SEC-01", run: runCreditNotePermissionMatrix },
    { id: "F-SEC-02", run: runRefundPermissionMatrix },
    { id: "F-SEC-03", run: runPaymentPermissionMatrixAndDirectBypass },
    { id: "F-SEC-04", run: runDeliveryOverridePermission },
    { id: "F-SEC-05", run: runForbiddenWorkflowTransitions },
    { id: "F-SEC-06", run: runApiValidationBypassAttempts },
    { id: "F-SEC-07", run: runLockedInvoiceDirectMutationCharacterization },
    { id: "F-SEC-08", run: runStaticHiddenMutationPathSearch },
  ];

  for (const testCase of cases) {
    await testCase.run(db, activeFixtures);
  }
}

async function runCreditNotePermissionMatrix(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "sec01");
  const snapshot = () =>
    db.invoice.count({
      where: { orderId: workflow.orderId, invoiceType: InvoiceType.CREDIT_NOTE },
    });

  await expectRejectsWithoutPartialWrites(
    () =>
      createCreditNote({
        targetFinalInvoiceId: workflow.finalInvoiceId,
        lines: [{ description: "Receptionist denied", quantity: 1, unitPrice: 10 }],
        reason: "Phase F receptionist denial",
        createdByUserId: fixtures.receptionistId,
      }),
    snapshot,
    /Manager permission is required/
  );

  await expectRejectsWithoutPartialWrites(
    () =>
      createCreditNote({
        targetFinalInvoiceId: workflow.finalInvoiceId,
        lines: [{ description: "Accountant denied", quantity: 1, unitPrice: 10 }],
        reason: "Phase F accountant denial",
        createdByUserId: fixtures.accountantId,
      }),
    snapshot,
    /Manager permission is required/
  );

  await createCreditNote({
    targetFinalInvoiceId: workflow.finalInvoiceId,
    lines: [{ description: "Manager allowed", quantity: 1, unitPrice: 10 }],
    reason: "Phase F manager allowed",
    createdByUserId: fixtures.managerId,
  });
  assert.equal(await snapshot(), 1, "manager credit note should be allowed");
}

async function runRefundPermissionMatrix(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "sec02");
  const snapshot = () =>
    db.invoice.count({
      where: { orderId: workflow.orderId, invoiceType: InvoiceType.REFUND },
    });

  await expectRejectsWithoutPartialWrites(
    () =>
      createRefundInvoice({
        sourceInvoiceId: workflow.finalInvoiceId,
        amount: 10,
        reason: "Phase F receptionist refund denial",
        createdByUserId: fixtures.receptionistId,
      }),
    snapshot,
    /Manager permission is required/
  );

  await expectRejectsWithoutPartialWrites(
    () =>
      createRefundInvoice({
        sourceInvoiceId: workflow.finalInvoiceId,
        amount: 10,
        reason: "Phase F accountant refund denial",
        createdByUserId: fixtures.accountantId,
      }),
    snapshot,
    /Manager permission is required/
  );
}

async function runPaymentPermissionMatrixAndDirectBypass(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "sec03", {
    issue: true,
  });

  await assert.rejects(
    () =>
      recordPOSPaymentForOrder(
        workflow.orderId,
        workflow.finalInvoiceId,
        {
          payment: {
            amount: 1,
            method: PaymentMethod.CASH,
            paymentType: PaymentType.FINAL,
          },
        },
        fixtures.editorActor
      ),
    /Permission denied: payment:create/
  );

  await assert.rejects(
    () =>
      recordPOSPaymentForOrder(
        workflow.orderId,
        workflow.finalInvoiceId,
        {
          payment: {
            amount: 1,
            method: PaymentMethod.CASH,
            paymentType: PaymentType.FINAL,
          },
        },
        fixtures.photographerActor
      ),
    /Permission denied: payment:create/
  );

  await assert.rejects(
    () =>
      recordPayment(
        workflow.finalInvoiceId,
        { amount: 1, method: PaymentMethod.CASH, paymentType: PaymentType.FINAL },
        fixtures.editorActor
      ),
    /Permission denied: payment:create/
  );
}

async function runDeliveryOverridePermission(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "sec04");

  await assert.rejects(
    () =>
      updateOrderDeliveryWorkflow(
        workflow.orderId,
        {
          action: "markPickedUp",
          completedById: fixtures.receptionistId,
          allowPaymentOverride: true,
          overrideReason: "Receptionist override attempt",
        },
        fixtures.receptionistActor
      ),
    /Permission denied: delivery:payment-override/
  );
}

async function runForbiddenWorkflowTransitions(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const pending = await buildPendingBookingFixture(fixtures, "sec05-pending");
  await assert.rejects(
    () => updateBookingStatus(pending.bookingId, BookingStatus.CHECKED_IN),
    /Invalid booking status transition/
  );

  const unpaidWorkflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "sec05-unpaid", {
    issue: true,
  });
  await db.order.update({
    where: { id: unpaidWorkflow.orderId },
    data: { selectionStatus: OrderSelectionStatus.COMPLETED },
  });
  await updateOrderEditingWorkflow(
    unpaidWorkflow.orderId,
    { action: "assignEditor", assignedEditorId: fixtures.editorId },
    fixtures.adminActor
  );
  await assert.rejects(
    () =>
      updateOrderEditingWorkflow(
        unpaidWorkflow.orderId,
        { action: "markStarted" },
        fixtures.adminActor
      ),
    /outstanding invoice balance|Failed to update editing workflow/
  );

  const lockedWorkflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "sec05-locked");
  await assert.rejects(
    () =>
      updateOrderDeliveryWorkflow(
        lockedWorkflow.orderId,
        { action: "markPickedUp", completedById: fixtures.adminId },
        fixtures.adminActor
      ),
    /production is ready|Failed to update delivery workflow/
  );

  await db.order.update({
    where: { id: lockedWorkflow.orderId },
    data: { selectionStatus: OrderSelectionStatus.COMPLETED },
  });
  await updateOrderEditingWorkflow(
    lockedWorkflow.orderId,
    { action: "assignEditor", assignedEditorId: fixtures.editorId },
    fixtures.adminActor
  );
  await updateOrderEditingWorkflow(
    lockedWorkflow.orderId,
    { action: "markStarted" },
    fixtures.adminActor
  );
  await updateOrderEditingWorkflow(
    lockedWorkflow.orderId,
    { action: "markComplete" },
    fixtures.adminActor
  );
  await updateOrderEditingWorkflow(
    lockedWorkflow.orderId,
    { action: "markApproved" },
    fixtures.adminActor
  );
  await updateOrderEditingWorkflow(
    lockedWorkflow.orderId,
    { action: "sendToProduction" },
    fixtures.adminActor
  );
  const completedEditing = await db.editingJob.findUniqueOrThrow({
    where: { orderId: lockedWorkflow.orderId },
    select: { status: true },
  });
  assert.equal(completedEditing.status, OrderEditingStatus.COMPLETED);
  await assert.rejects(
    () =>
      updateOrderEditingWorkflow(
        lockedWorkflow.orderId,
        { action: "requestRevision" },
        fixtures.adminActor
      ),
    /Invalid editingStatus transition|Failed to update editing workflow/
  );

  const order = await db.order.findUniqueOrThrow({
    where: { id: lockedWorkflow.orderId },
    select: { status: true },
  });
  assert.notEqual(order.status, OrderStatus.DELIVERED);
}

async function runApiValidationBypassAttempts(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  assert.equal(
    recordPaymentSchema.safeParse({
      amount: -1,
      method: PaymentMethod.CASH,
      paymentType: PaymentType.FINAL,
    }).success,
    false,
    "negative payment must be rejected by Zod"
  );
  assert.equal(
    createBookingSchema.safeParse({
      phone: "+96577123456",
      customerName: "No Package",
      packages: [],
      sessionDate: new Date("2026-08-20T08:00:00.000Z"),
      sessionTime: "10:00",
      departmentId: fixtures.departmentId,
      themes: [],
    }).success,
    false,
    "booking creation must require at least one package"
  );
  assert.equal(
    createRefundInvoiceSchema.safeParse({
      amount: -1,
      reason: "Negative refund",
      method: PaymentMethod.CASH,
    }).success,
    false,
    "negative refund must be rejected by Zod"
  );

  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "sec06");
  const adjustment = await createAdjustmentInvoice({
    parentFinalInvoiceId: workflow.finalInvoiceId,
    lines: [
      {
        lineType: InvoiceLineType.ADD_ON,
        description: "Phase F adjustment",
        quantity: 1,
        unitPrice: 20,
      },
    ],
    createdByUserId: fixtures.managerId,
  });

  await assert.rejects(
    () =>
      createCreditNote({
        targetFinalInvoiceId: adjustment.id,
        lines: [{ description: "Wrong target", quantity: 1, unitPrice: 5 }],
        reason: "Phase F wrong target",
        createdByUserId: fixtures.managerId,
      }),
    /final invoices/
  );

  await assert.rejects(
    () =>
      createAdjustmentInvoice({
        parentFinalInvoiceId: adjustment.id,
        lines: [
          {
            lineType: InvoiceLineType.ADD_ON,
            description: "Adjustment chain",
            quantity: 1,
            unitPrice: 5,
          },
        ],
        createdByUserId: fixtures.managerId,
      }),
    /final invoices/
  );

  let reachedInjectedRollback = false;
  await assert.rejects(
    () =>
      db.$transaction(async (tx) => {
        await createRefundInvoice(
          {
            sourceInvoiceId: workflow.finalInvoiceId,
            amount: 10,
            reason: "Phase F refund capacity characterization",
            createdByUserId: fixtures.managerId,
          },
          tx
        );
        reachedInjectedRollback = true;
        throw new Error("Phase F rollback after refund-capacity bypass characterization");
      }),
    /Phase F rollback after refund-capacity bypass/
  );
  assert.equal(
    reachedInjectedRollback,
    true,
    "Phase F characterization: refund service still accepts amount above true overpayment when inbound allocation capacity exists"
  );
}

async function runLockedInvoiceDirectMutationCharacterization(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "sec07");
  const before = await db.invoice.findUniqueOrThrow({
    where: { id: workflow.finalInvoiceId },
    select: { totalAmount: true, invoiceType: true, isLocked: true },
  });
  let directTotalMutationAccepted = false;
  let directUnlockAccepted = false;

  await assert.rejects(
    () =>
      db.$transaction(async (tx) => {
        const updatedTotal = await tx.invoice.update({
          where: { id: workflow.finalInvoiceId },
          data: { totalAmount: new Prisma.Decimal(499) },
          select: { totalAmount: true },
        });
        directTotalMutationAccepted = updatedTotal.totalAmount.equals(499);
        const unlocked = await tx.invoice.update({
          where: { id: workflow.finalInvoiceId },
          data: { isLocked: false },
          select: { isLocked: true },
        });
        directUnlockAccepted = !unlocked.isLocked;
        throw new Error("Phase F rollback after direct locked-invoice mutation characterization");
      }),
    /Phase F rollback after direct locked-invoice mutation/
  );

  const after = await db.invoice.findUniqueOrThrow({
    where: { id: workflow.finalInvoiceId },
    select: { totalAmount: true, invoiceType: true, isLocked: true },
  });
  assert.equal(directTotalMutationAccepted, true);
  assert.equal(directUnlockAccepted, true);
  assert.equal(after.totalAmount.equals(before.totalAmount), true);
  assert.equal(after.invoiceType, before.invoiceType);
  assert.equal(after.isLocked, before.isLocked);
}

async function runStaticHiddenMutationPathSearch(): Promise<void> {
  const [paymentSource, invoiceSource, orderSource, bookingSource, refundSource] =
    await Promise.all([
      readFile("src/modules/payments/payment.service.ts", "utf8"),
      readFile("src/modules/invoices/invoice.service.ts", "utf8"),
      readFile("src/modules/orders/order.service.ts", "utf8"),
      readFile("src/modules/bookings/booking.service.ts", "utf8"),
      readFile("src/modules/refunds/refund.service.ts", "utf8"),
    ]);

  assert.match(
    paymentSource,
    /client\.payment\.create/,
    "payment creation should remain in payment service choke point"
  );
  assert.doesNotMatch(
    `${invoiceSource}\n${orderSource}\n${bookingSource}\n${refundSource}`,
    /\b(?:db|tx|client)\.payment\.create\s*\(/,
    "production services outside payment.service must not create Payment rows directly"
  );
  assert.match(
    orderSource,
    /if \(!actorContext\.actorRole\) return;/,
    "Phase F documents optional actor role as a permission-bypass surface if service callers omit ActorContext"
  );
}
