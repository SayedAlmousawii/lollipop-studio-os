import assert from "node:assert/strict";
import {
  BookingStatus,
  InvoiceLineType,
  InvoiceStatus,
  InvoiceType,
  OrderDeliveryStatus,
  OrderEditingStatus,
  OrderSelectionStatus,
  OrderStatus,
  PaymentDirection,
  PaymentMethod,
  PaymentType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { updateBookingStatus } from "@/modules/bookings/booking.service";
import { createCreditNote } from "@/modules/invoices/invoice.service";
import {
  addOrderProductAddOn,
  removeOrderAddOn,
  updateOrderDeliveryWorkflow,
  updateOrderEditingWorkflow,
  updateOrderPackage,
  updateOrderProductionWorkflow,
} from "@/modules/orders/order.service";
import { issueRefundWithPayment } from "@/modules/refunds/refund.service";
import { recordPayment } from "@/modules/payments/payment.service";
import {
  assertMoney,
  assertNoFinancialRecordsForBooking,
  assertOrderActivity,
  assertSinglePaymentAllocation,
  expectRejectsWithoutPartialWrites,
} from "./assertions";
import {
  buildCheckedInWorkflowFixture,
  buildConfirmedBookingFixture,
  buildFinalInvoiceWorkflowFixture,
  buildLockedFinalInvoiceWorkflowFixture,
  buildPendingBookingFixture,
  getBookingFinancialSnapshot,
  makeOrderReadyForDelivery,
  seedPhaseBFixtures,
  type PhaseBFixtures,
} from "./fixtures";

export async function runPhaseBWorkflowIntegrationMatrix(
  db: PrismaClient
): Promise<void> {
  const fixtures = await seedPhaseBFixtures(db);

  await runInt01PendingBookingCreation(db, fixtures);
  await runInt02PendingBookingCancellation(db, fixtures);
  await runInt03BookingConfirmationAtomic(db, fixtures);
  await runInt04ConfirmedBookingCheckInAtomic(db, fixtures);
  await runInt05FinalInvoiceCreationAtPos(db, fixtures);
  await runInt06PartialPaymentOnFinalInvoice(db, fixtures);
  await runInt07FullPaymentLocksFinalInvoice(db, fixtures);
  await runInt08AdditiveOrderEditCreatesAdjustment(db, fixtures);
  await runInt09AdjustmentInvoicePayment(db, fixtures);
  await runInt10ReductiveEditRequiresManager(db, fixtures);
  await runInt11CreditNoteIssuance(db, fixtures);
  await runInt12RefundIssuance(db, fixtures);
  await runInt13PackageUpgradeCreatesDeltaAdjustment(db, fixtures);
  await runInt14NoShowHandling(db, fixtures);
  await runInt15OrderDeliveryCompletionGuards(db, fixtures);
}

async function runInt01PendingBookingCreation(
  db: PrismaClient,
  fixtures: PhaseBFixtures
): Promise<void> {
  const { bookingId } = await buildPendingBookingFixture(fixtures, "int01");
  const booking = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { status: true, publicId: true, packages: { select: { id: true } } },
  });

  assert.equal(booking.status, BookingStatus.PENDING);
  assert.equal(booking.publicId, null);
  assert.equal(booking.packages.length, 1);
  await assertNoFinancialRecordsForBooking(db, bookingId);
}

async function runInt02PendingBookingCancellation(
  db: PrismaClient,
  fixtures: PhaseBFixtures
): Promise<void> {
  const { bookingId } = await buildPendingBookingFixture(fixtures, "int02");
  const { deletePendingBooking } = await import("@/modules/bookings/booking.service");

  await deletePendingBooking({ bookingId });

  const [bookingCount, packageCount, themeCount, invoiceCount] = await Promise.all([
    db.booking.count({ where: { id: bookingId } }),
    db.bookingPackage.count({ where: { bookingId } }),
    db.bookingTheme.count({ where: { bookingId } }),
    db.invoice.count({ where: { bookingId } }),
  ]);

  assert.equal(bookingCount, 0, "pending cancellation must hard-delete booking");
  assert.equal(packageCount, 0, "pending cancellation must remove package references");
  assert.equal(themeCount, 0, "pending cancellation must remove theme references");
  assert.equal(invoiceCount, 0, "pending cancellation must leave no invoices");
}

async function runInt03BookingConfirmationAtomic(
  db: PrismaClient,
  fixtures: PhaseBFixtures
): Promise<void> {
  const confirmed = await buildConfirmedBookingFixture(db, fixtures, "int03");
  const booking = await db.booking.findUniqueOrThrow({
    where: { id: confirmed.bookingId },
    include: {
      financialCase: true,
      invoices: {
        include: {
          payments: { include: { allocations: true } },
        },
      },
    },
  });
  const deposit = booking.invoices.find(
    (invoice) => invoice.invoiceType === InvoiceType.DEPOSIT
  );
  const payment = deposit?.payments[0];

  assert.equal(booking.status, BookingStatus.CONFIRMED);
  assert.match(booking.publicId ?? "", /^BK-/);
  assert.ok(booking.financialCase, "confirmation must create FinancialCase");
  assert.ok(deposit, "confirmation must create Deposit invoice");
  assert.equal(deposit?.status, InvoiceStatus.CLOSED);
  assert.equal(deposit?.isLocked, true);
  assertMoney(deposit?.totalAmount ?? new Prisma.Decimal(0), "20", "deposit total");
  assertMoney(deposit?.paidAmount ?? new Prisma.Decimal(0), "20", "deposit paid");
  assert.ok(payment, "confirmation must record Deposit payment");
  await assertSinglePaymentAllocation(db, payment?.id ?? "", deposit?.id ?? "", "20");

  const rollback = await buildPendingBookingFixture(fixtures, "int03-rollback");
  await expectRejectsWithoutPartialWrites(
    () =>
      db.$transaction(async (tx) => {
        const pending = await tx.booking.findUniqueOrThrow({
          where: { id: rollback.bookingId },
          select: { customerId: true },
        });
        await tx.booking.update({
          where: { id: rollback.bookingId },
          data: { publicId: "BK-PHASE-B-ROLLBACK" },
        });
        await tx.financialCase.create({
          data: {
            bookingId: rollback.bookingId,
            customerId: pending.customerId,
          },
        });
        throw new Error("INT-03 injected failure before invoice creation");
      }),
    () => getBookingFinancialSnapshot(db, rollback.bookingId),
    /INT-03 injected failure/
  );
}

async function runInt04ConfirmedBookingCheckInAtomic(
  db: PrismaClient,
  fixtures: PhaseBFixtures
): Promise<void> {
  const checkedIn = await buildCheckedInWorkflowFixture(db, fixtures, "int04");
  const booking = await db.booking.findUniqueOrThrow({
    where: { id: checkedIn.bookingId },
    include: {
      job: true,
      order: { include: { activities: true } },
      financialCase: true,
      invoices: { where: { invoiceType: InvoiceType.DEPOSIT } },
    },
  });
  const deposit = booking.invoices[0];

  assert.equal(booking.status, BookingStatus.CHECKED_IN);
  assert.match(booking.jobNumber ?? "", /^JOB-/);
  assert.equal(booking.job?.assignedPhotographerId, fixtures.photographerId);
  assert.equal(booking.job?.socialMediaConsent, true);
  assert.equal(booking.order?.status, OrderStatus.WAITING_SELECTION);
  assert.equal(booking.financialCase?.jobId, booking.jobId);
  assert.equal(deposit?.status, InvoiceStatus.CLOSED);
  assert.equal(deposit?.isLocked, true);
  await assertOrderActivity(db, {
    orderId: checkedIn.orderId,
    title: "Order created",
    userId: fixtures.adminId,
  });

  const confirmed = await buildConfirmedBookingFixture(db, fixtures, "int04-rollback");
  await expectRejectsWithoutPartialWrites(
    () =>
      db.$transaction(async (tx) => {
        const bookingBefore = await tx.booking.findUniqueOrThrow({
          where: { id: confirmed.bookingId },
          select: { customerId: true },
        });
        const job = await tx.job.create({
          data: {
            jobNumber: "JOB-PHASE-B-ROLLBACK",
            customerId: bookingBefore.customerId,
            assignedPhotographerId: fixtures.photographerId,
            socialMediaConsent: true,
          },
        });
        await tx.booking.update({
          where: { id: confirmed.bookingId },
          data: { jobId: job.id, jobNumber: job.jobNumber },
        });
        throw new Error("INT-04 injected failure before order creation");
      }),
    () => getBookingFinancialSnapshot(db, confirmed.bookingId),
    /INT-04 injected failure/
  );
}

async function runInt05FinalInvoiceCreationAtPos(
  db: PrismaClient,
  fixtures: PhaseBFixtures
): Promise<void> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "int05", {
    preInvoiceAddOnQuantity: 2,
  });
  const finalInvoice = await db.invoice.findUniqueOrThrow({
    where: { id: workflow.finalInvoiceId },
    include: {
      documentApplicationsAsTarget: true,
      lineItems: true,
      order: { select: { status: true } },
    },
  });

  assert.equal(finalInvoice.invoiceType, InvoiceType.FINAL);
  assert.notEqual(finalInvoice.status, InvoiceStatus.CLOSED);
  assert.equal(finalInvoice.isLocked, false);
  assertMoney(finalInvoice.totalAmount, "600", "final invoice includes package + add-ons");
  assertMoney(finalInvoice.remainingAmount, "580", "deposit application reduces remaining");
  assert.equal(finalInvoice.documentApplicationsAsTarget.length, 1);
  assert.equal(
    finalInvoice.documentApplicationsAsTarget[0]?.sourceInvoiceId,
    workflow.depositInvoiceId
  );
  assertMoney(
    finalInvoice.documentApplicationsAsTarget[0]?.amountApplied ?? new Prisma.Decimal(0),
    "20",
    "deposit application amount"
  );
  assert.equal(finalInvoice.order?.status, OrderStatus.WAITING_SELECTION);
  await assertOrderActivity(db, {
    orderId: workflow.orderId,
    title: "Invoice created",
    userId: fixtures.adminId,
  });
}

async function runInt06PartialPaymentOnFinalInvoice(
  db: PrismaClient,
  fixtures: PhaseBFixtures
): Promise<void> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "int06", {
    issue: true,
  });
  const payment = await recordPayment(
    workflow.finalInvoiceId,
    { amount: 200, method: PaymentMethod.CASH, paymentType: PaymentType.FINAL },
    fixtures.adminActor
  );
  const invoice = await db.invoice.findUniqueOrThrow({
    where: { id: workflow.finalInvoiceId },
    include: { order: { select: { status: true } } },
  });

  assert.equal(invoice.status, InvoiceStatus.PARTIAL);
  assert.equal(invoice.isLocked, false);
  assertMoney(invoice.remainingAmount, "280", "partial payment leaves correct balance");
  assert.equal(invoice.order?.status, OrderStatus.WAITING_SELECTION);
  await assertSinglePaymentAllocation(db, payment.id, workflow.finalInvoiceId, "200");
  await assertOrderActivity(db, {
    orderId: workflow.orderId,
    title: "Payment received",
    userId: fixtures.adminId,
  });
}

async function runInt07FullPaymentLocksFinalInvoice(
  db: PrismaClient,
  fixtures: PhaseBFixtures
): Promise<void> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "int07", {
    issue: true,
    finalPaymentAmounts: [380],
  });
  await recordPayment(
    workflow.finalInvoiceId,
    { amount: 100, method: PaymentMethod.CASH, paymentType: PaymentType.FINAL },
    fixtures.adminActor
  );
  const invoice = await db.invoice.findUniqueOrThrow({
    where: { id: workflow.finalInvoiceId },
  });

  assert.equal(invoice.status, InvoiceStatus.CLOSED);
  assert.equal(invoice.isLocked, true);
  assertMoney(invoice.remainingAmount, "0", "full payment settles final invoice");
  await assertOrderActivity(db, {
    orderId: workflow.orderId,
    title: "Invoice settled",
    userId: fixtures.adminId,
  });

  await db.order.update({
    where: { id: workflow.orderId },
    data: { selectionStatus: OrderSelectionStatus.COMPLETED },
  });
  await updateOrderEditingWorkflow(
    workflow.orderId,
    { action: "assignEditor", assignedEditorId: fixtures.editorId },
    fixtures.adminActor
  );
  await updateOrderEditingWorkflow(
    workflow.orderId,
    { action: "markStarted" },
    fixtures.adminActor
  );
  const editingJob = await db.editingJob.findUniqueOrThrow({
    where: { orderId: workflow.orderId },
    select: { status: true },
  });
  assert.equal(editingJob.status, OrderEditingStatus.IN_PROGRESS);
}

async function runInt08AdditiveOrderEditCreatesAdjustment(
  db: PrismaClient,
  fixtures: PhaseBFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "int08");
  await addOrderProductAddOn(
    workflow.orderId,
    { productId: fixtures.addOnProductId },
    fixtures.adminActor
  );

  const adjustment = await db.invoice.findFirstOrThrow({
    where: {
      orderId: workflow.orderId,
      invoiceType: InvoiceType.ADJUSTMENT,
      parentInvoiceId: workflow.finalInvoiceId,
    },
    include: { lineItems: true },
  });
  const finalInvoice = await db.invoice.findUniqueOrThrow({
    where: { id: workflow.finalInvoiceId },
  });

  assert.equal(adjustment.status, InvoiceStatus.ISSUED);
  assert.equal(adjustment.isLocked, false);
  assertMoney(adjustment.totalAmount, "50", "additive edit adjustment amount");
  assert.equal(adjustment.lineItems[0]?.lineType, InvoiceLineType.ADD_ON);
  assert.equal(finalInvoice.status, InvoiceStatus.CLOSED);
  assert.equal(finalInvoice.isLocked, true);
  assert.equal(
    await db.invoice.count({
      where: { orderId: workflow.orderId, invoiceType: InvoiceType.CREDIT_NOTE },
    }),
    0
  );
  await assertOrderActivity(db, {
    orderId: workflow.orderId,
    title: "Add-on added",
    userId: fixtures.adminId,
  });
  await assertOrderActivity(db, {
    orderId: workflow.orderId,
    title: "Auto-adjustment issued",
    userId: null,
  });

  const zeroWorkflow = await buildLockedFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "int08-zero"
  );
  await expectRejectsWithoutPartialWrites(
    () =>
      addOrderProductAddOn(
        zeroWorkflow.orderId,
        { productId: fixtures.zeroPriceAddOnProductId },
        fixtures.adminActor
      ),
    () =>
      snapshotOrderEditFinancialState(db, zeroWorkflow.orderId),
    /greater than 0|Failed to add order add-on/
  );
}

async function runInt09AdjustmentInvoicePayment(
  db: PrismaClient,
  fixtures: PhaseBFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "int09");
  await addOrderProductAddOn(
    workflow.orderId,
    { productId: fixtures.addOnProductId },
    fixtures.adminActor
  );
  const adjustment = await db.invoice.findFirstOrThrow({
    where: { orderId: workflow.orderId, invoiceType: InvoiceType.ADJUSTMENT },
  });

  const payment = await recordPayment(
    adjustment.id,
    { amount: 50, method: PaymentMethod.CASH, paymentType: PaymentType.ADJUSTMENT },
    fixtures.adminActor
  );
  const paidAdjustment = await db.invoice.findUniqueOrThrow({
    where: { id: adjustment.id },
    include: { payments: true },
  });

  assert.equal(paidAdjustment.status, InvoiceStatus.CLOSED);
  assert.equal(paidAdjustment.isLocked, true);
  assert.equal(paidAdjustment.payments[0]?.direction, PaymentDirection.IN);
  await assertSinglePaymentAllocation(db, payment.id, adjustment.id, "50");
  await assertOrderActivity(db, {
    orderId: workflow.orderId,
    title: "Adjustment settled",
    userId: fixtures.adminId,
  });
}

async function runInt10ReductiveEditRequiresManager(
  db: PrismaClient,
  fixtures: PhaseBFixtures
): Promise<void> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "int10", {
    preInvoiceAddOnQuantity: 1,
    issue: true,
    finalPaymentAmounts: [530],
  });
  const addOn = await db.orderAddOn.findFirstOrThrow({
    where: { orderId: workflow.orderId, productId: fixtures.addOnProductId },
    select: { id: true },
  });

  await expectRejectsWithoutPartialWrites(
    () =>
      removeOrderAddOn(
        workflow.orderId,
        { addOnId: addOn.id },
        fixtures.adminActor
      ),
    () => snapshotOrderEditFinancialState(db, workflow.orderId),
    /Manager confirmation is required|Failed to remove order add-on/
  );
}

async function runInt11CreditNoteIssuance(
  db: PrismaClient,
  fixtures: PhaseBFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "int11");
  const creditNote = await createCreditNote({
    targetFinalInvoiceId: workflow.finalInvoiceId,
    lines: [{ description: "Approved reduction", quantity: 1, unitPrice: 50 }],
    reason: "Phase B approved reduction",
    createdByUserId: fixtures.managerId,
  });

  const storedCreditNote = await db.invoice.findUniqueOrThrow({
    where: { id: creditNote.id },
    include: { documentApplicationsAsSource: true },
  });
  const finalInvoice = await db.invoice.findUniqueOrThrow({
    where: { id: workflow.finalInvoiceId },
  });

  assert.equal(storedCreditNote.invoiceType, InvoiceType.CREDIT_NOTE);
  assert.equal(storedCreditNote.status, InvoiceStatus.CLOSED);
  assert.equal(storedCreditNote.isLocked, true);
  assertMoney(storedCreditNote.totalAmount, "50", "credit note amount");
  assert.equal(storedCreditNote.documentApplicationsAsSource.length, 1);
  assert.equal(
    storedCreditNote.documentApplicationsAsSource[0]?.targetInvoiceId,
    workflow.finalInvoiceId
  );
  assertMoney(finalInvoice.remainingAmount, "0", "credit note must not reopen final");
  await assertOrderActivity(db, {
    orderId: workflow.orderId,
    title: "Credit note issued",
    userId: fixtures.managerId,
  });
  await assertOrderActivity(db, {
    orderId: workflow.orderId,
    title: "Refund available",
    userId: fixtures.managerId,
  });
}

async function runInt12RefundIssuance(
  db: PrismaClient,
  fixtures: PhaseBFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "int12");
  const finalPayment = await db.payment.findFirstOrThrow({
    where: { invoiceId: workflow.finalInvoiceId, paymentType: PaymentType.FINAL },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  await createCreditNote({
    targetFinalInvoiceId: workflow.finalInvoiceId,
    lines: [{ description: "Refundable reduction", quantity: 1, unitPrice: 50 }],
    reason: "Phase B refundable reduction",
    createdByUserId: fixtures.managerId,
  });

  const refund = await issueRefundWithPayment({
    sourceInvoiceId: workflow.finalInvoiceId,
    amount: 30,
    reason: "Phase B refund",
    createdByUserId: fixtures.managerId,
    method: PaymentMethod.CASH,
    refundOfPaymentId: finalPayment.id,
  });
  const refundInvoice = await db.invoice.findUniqueOrThrow({
    where: { id: refund.refundInvoiceId },
    include: { payments: { include: { allocations: true } } },
  });
  const refundPayment = refundInvoice.payments[0];

  assert.equal(refundInvoice.invoiceType, InvoiceType.REFUND);
  assert.equal(refundInvoice.status, InvoiceStatus.CLOSED);
  assert.equal(refundInvoice.isLocked, true);
  assertMoney(refundInvoice.totalAmount, "30", "refund amount");
  assert.equal(refundPayment?.direction, PaymentDirection.OUT);
  assert.equal(refundPayment?.paymentType, PaymentType.REFUND);
  assert.equal(refundPayment?.refundOfPaymentId, finalPayment.id);
  await assertSinglePaymentAllocation(
    db,
    refundPayment?.id ?? "",
    refundInvoice.id,
    "30"
  );
  await assertOrderActivity(db, {
    orderId: workflow.orderId,
    title: "Refund payment recorded",
    userId: fixtures.managerId,
  });
}

async function runInt13PackageUpgradeCreatesDeltaAdjustment(
  db: PrismaClient,
  fixtures: PhaseBFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "int13");
  const orderPackage = await db.orderPackage.findFirstOrThrow({
    where: { orderId: workflow.orderId },
    select: { id: true },
  });

  await updateOrderPackage(
    workflow.orderId,
    {
      orderPackageId: orderPackage.id,
      packageId: fixtures.upgradePackageId,
    },
    fixtures.adminActor
  );

  const refreshedPackage = await db.orderPackage.findUniqueOrThrow({
    where: { id: orderPackage.id },
  });
  const adjustment = await db.invoice.findFirstOrThrow({
    where: {
      orderId: workflow.orderId,
      invoiceType: InvoiceType.ADJUSTMENT,
      parentInvoiceId: workflow.finalInvoiceId,
    },
  });
  const finalInvoice = await db.invoice.findUniqueOrThrow({
    where: { id: workflow.finalInvoiceId },
  });

  assert.equal(refreshedPackage.packageId, fixtures.upgradePackageId);
  assertMoney(
    refreshedPackage.finalPackagePriceSnapshot ?? new Prisma.Decimal(0),
    "600",
    "package upgrade final snapshot"
  );
  assertMoney(adjustment.totalAmount, "100", "upgrade adjustment is delta only");
  assertMoney(finalInvoice.totalAmount, "500", "locked final remains original amount");
  await assertOrderActivity(db, {
    orderId: workflow.orderId,
    title: "Package line changed",
    userId: fixtures.adminId,
  });
}

async function runInt14NoShowHandling(
  db: PrismaClient,
  fixtures: PhaseBFixtures
): Promise<void> {
  const confirmed = await buildConfirmedBookingFixture(db, fixtures, "int14");
  await updateBookingStatus(
    confirmed.bookingId,
    BookingStatus.NO_SHOW,
    fixtures.managerActor
  );
  const booking = await db.booking.findUniqueOrThrow({
    where: { id: confirmed.bookingId },
    include: {
      financialCase: true,
      invoices: { where: { invoiceType: InvoiceType.DEPOSIT } },
    },
  });
  const deposit = booking.invoices[0];

  assert.equal(booking.status, BookingStatus.NO_SHOW);
  assert.ok(booking.financialCase, "no-show must preserve financial case");
  assert.equal(deposit?.status, InvoiceStatus.CLOSED);
  assert.equal(deposit?.isLocked, true);
}

async function runInt15OrderDeliveryCompletionGuards(
  db: PrismaClient,
  fixtures: PhaseBFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "int15");
  await makeOrderReadyForDelivery(db, workflow.orderId);

  await updateOrderDeliveryWorkflow(
    workflow.orderId,
    {
      action: "markPickedUp",
      completedById: fixtures.adminId,
    },
    fixtures.adminActor
  );
  const delivered = await db.order.findUniqueOrThrow({
    where: { id: workflow.orderId },
    select: {
      status: true,
      deliveryStatus: true,
      deliveryCompletedById: true,
      invoices: {
        where: { id: workflow.finalInvoiceId },
        select: { status: true },
      },
    },
  });
  assert.equal(delivered.status, OrderStatus.DELIVERED);
  assert.equal(delivered.deliveryStatus, OrderDeliveryStatus.COMPLETED);
  assert.equal(delivered.deliveryCompletedById, fixtures.adminId);
  assert.equal(delivered.invoices[0]?.status, InvoiceStatus.CLOSED);
  await assertOrderActivity(db, {
    orderId: workflow.orderId,
    title: "Order completed",
    userId: fixtures.adminId,
  });

  const openPaymentWorkflow = await buildFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "int15-open-payment",
    { issue: true }
  );
  await makeOrderReadyForDelivery(db, openPaymentWorkflow.orderId);
  await assert.rejects(
    () =>
      updateOrderDeliveryWorkflow(
        openPaymentWorkflow.orderId,
        { action: "markPickedUp", completedById: fixtures.adminId },
        fixtures.adminActor
      ),
    /Payment must be settled|Failed to update delivery workflow/
  );

  const editingIncompleteWorkflow = await buildLockedFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "int15-editing"
  );
  await assert.rejects(
    () =>
      updateOrderProductionWorkflow(
        editingIncompleteWorkflow.orderId,
        { action: "markProductionReadyForPickup" },
        fixtures.adminActor
      ),
    /Production cannot be marked ready|EDITING_INCOMPLETE/
  );

  const productionNotReadyWorkflow = await buildLockedFinalInvoiceWorkflowFixture(
    db,
    fixtures,
    "int15-production"
  );
  await db.order.update({
    where: { id: productionNotReadyWorkflow.orderId },
    data: { deliveryStatus: OrderDeliveryStatus.READY_FOR_PICKUP },
  });
  await assert.rejects(
    () =>
      updateOrderDeliveryWorkflow(
        productionNotReadyWorkflow.orderId,
        { action: "markPickedUp", completedById: fixtures.adminId },
        fixtures.adminActor
      ),
    /production is ready|Production must be ready|Failed to update delivery workflow/
  );
}

async function snapshotOrderEditFinancialState(db: PrismaClient, orderId: string) {
  const [addOns, invoices, applications, activities] = await Promise.all([
    db.orderAddOn.findMany({
      where: { orderId },
      select: {
        id: true,
        productId: true,
        quantity: true,
      },
      orderBy: { id: "asc" },
    }),
    db.invoice.findMany({
      where: { orderId },
      select: {
        id: true,
        invoiceType: true,
        parentInvoiceId: true,
        totalAmount: true,
        status: true,
        isLocked: true,
      },
      orderBy: { id: "asc" },
    }),
    db.documentApplication.findMany({
      where: { targetInvoice: { orderId } },
      select: {
        id: true,
        sourceInvoiceId: true,
        targetInvoiceId: true,
        amountApplied: true,
      },
      orderBy: { id: "asc" },
    }),
    db.orderActivity.findMany({
      where: { orderId },
      select: {
        title: true,
        type: true,
      },
      orderBy: { id: "asc" },
    }),
  ]);

  return { addOns, invoices, applications, activities };
}
