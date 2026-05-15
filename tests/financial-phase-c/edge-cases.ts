import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  InvoiceLineType,
  InvoiceStatus,
  InvoiceType,
  OrderStatus,
  PaymentMethod,
  PaymentType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { deletePendingBooking, recordBookingDeposit } from "@/modules/bookings/booking.service";
import { classifyEditDelta } from "@/modules/financial/edit-classifier";
import { runAllInvariants } from "@/modules/financial/invariants";
import {
  applyDepositToFinalIfPresent,
  computeRefundableAmountForInvoice,
  createAdjustmentInvoice,
  createCreditNote,
  createInvoiceForOrder,
  createRefundInvoice,
  issueInvoice,
  snapshotInvoiceLineItems,
  syncOrderInvoiceForFinancialEdit,
} from "@/modules/invoices/invoice.service";
import {
  addOrderProductAddOn,
  removeOrderAddOn,
  updateOrderPackage,
} from "@/modules/orders/order.service";
import { issueRefundWithPayment } from "@/modules/refunds/refund.service";
import { recordPayment } from "@/modules/payments/payment.service";
import { generateBookingReference } from "@/modules/identifiers/identifier.service";
import { WORKFLOW_REFERENCE_KIND } from "@/modules/identifiers/identifier.constants";
import { assertMoney, expectRejectsWithoutPartialWrites } from "../financial-phase-b/assertions";
import {
  addSecondPackageLine,
  buildCheckedInWorkflowFixture,
  buildConfirmedBookingFixture,
  buildFinalInvoiceWorkflowFixture,
  buildLockedFinalInvoiceWorkflowFixture,
  buildPendingBookingFixture,
  seedPhaseCFixtures,
  type PhaseCFixtures,
} from "./fixtures";

type CaseRunner = {
  id: string;
  run: (db: PrismaClient, fixtures: PhaseCFixtures) => Promise<void>;
};

const zero = new Prisma.Decimal(0);

export async function runPhaseCEdgeCaseExpansion(db: PrismaClient): Promise<void> {
  const fixtures = await seedPhaseCFixtures(db);
  const cases: CaseRunner[] = [
    { id: "E1", run: runE1EqualPriceUpgradeReplacement },
    { id: "E2", run: runE2NonEqualPriceUpgradeReplacement },
    { id: "E3", run: runE3PartialQuantityReduction },
    { id: "E4", run: runE4MixedAdditionsAndRemovals },
    { id: "E5", run: runE5PriceSnapshotEditBlocked },
    { id: "E6", run: runE6ManualDiscountCreditNoteOnly },
    { id: "E7", run: runE7ManualSurchargeExplicitOnly },
    { id: "E8", run: runE8AdjustmentOfAdjustmentBlocked },
    { id: "E9", run: runE9AdjustmentLineReductionTargetsFinal },
    { id: "E10", run: runE10ConcurrentEditCancellationStaleState },
    { id: "E11", run: runE11PaidAdjustmentCauseRemovalCharacterization },
    { id: "E12", run: runE12QuantityIncrease },
    { id: "EC-13", run: runEc13DoubleConfirmation },
    { id: "EC-14", run: runEc14DepositBelowMinimum },
    { id: "EC-15", run: runEc15FinalInvoiceCreatedTwice },
    { id: "EC-16", run: runEc16PaymentExceedsInvoiceTotal },
    { id: "EC-17", run: runEc17CreditNoteExceedsFinalTotal },
    { id: "EC-18", run: runEc18RefundExceedsOverpaymentCharacterization },
    { id: "EC-19", run: runEc19RefundAfterAdjustmentWithoutCreditCharacterization },
    { id: "EC-20", run: runEc20SecondAdjustmentIsSibling },
    { id: "EC-21", run: runEc21CreditNoteAfterMultipleAdjustments },
    { id: "EC-22", run: runEc22AppendOnlyPaymentOnLockedFinal },
    { id: "EC-23", run: runEc23StalePaymentAfterInvoiceLocks },
    { id: "EC-24", run: runEc24PackageDowngradeBlocked },
    { id: "EC-25", run: runEc25EqualPricePackageSwap },
    { id: "EC-26", run: runEc26ConfirmedBookingHardDeleteBlocked },
    { id: "EC-27", run: runEc27DirectLockedInvoiceUnlockCharacterization },
    { id: "EC-28", run: runEc28OpenAdjustmentAfterCancellationCharacterization },
    { id: "EC-29", run: runEc29MultiPackageInvoiceLines },
    { id: "EC-30", run: runEc30PackageScopedAddonDeletion },
    { id: "EC-31", run: runEc31PhotographerAssignmentChange },
    { id: "EC-32", run: runEc32CommissionUpgradeHookGap },
    { id: "EC-33", run: runEc33NoUpgradeNoCommissionRows },
    { id: "EC-34", run: runEc34SessionTypeMismatchBlocked },
    { id: "EC-35", run: runEc35StaleRecalculationAfterAdjustmentPaid },
    { id: "EC-36", run: runEc36MissingDocumentApplicationDetected },
    { id: "EC-37", run: runEc37PaymentRaceLockCoverageCharacterization },
    { id: "EC-38", run: runEc38RefundInvoiceAmountIntegrity },
    { id: "EC-39", run: runEc39VoucherSchemaCompatibilityCharacterization },
    { id: "EC-40", run: runEc40MultiPackageAdjustmentScope },
    { id: "EC-41", run: runEc41InvoiceNumberPrefixes },
    { id: "EC-42", run: runEc42IdentifierSequenceSelfHealing },
  ];

  for (const testCase of cases) {
    await testCase.run(db, fixtures);
  }
}

async function runE1EqualPriceUpgradeReplacement(): Promise<void> {
  const result = classifyEditDelta({
    additions: [],
    reductions: [],
    swaps: [
      {
        kind: "UPGRADE_REPLACEMENT",
        removedPriceSnapshot: money(40),
        addedPriceSnapshot: money(40),
        removedLineSnapshot: { name: "Old equal upgrade" },
        addedLineSnapshot: { name: "New equal upgrade" },
      },
    ],
  });

  assert.equal(result.netZero, true);
  assert.equal(result.adjustmentLines.length, 0);
  assert.equal(result.creditNoteRequired.length, 0);
  assert.equal(result.blocked.length, 0);
}

async function runE2NonEqualPriceUpgradeReplacement(): Promise<void> {
  const result = classifyEditDelta({
    additions: [],
    reductions: [],
    swaps: [
      {
        kind: "UPGRADE_REPLACEMENT",
        removedPriceSnapshot: money(50),
        addedPriceSnapshot: money(80),
        removedLineSnapshot: { name: "Removed upgrade" },
        addedLineSnapshot: { name: "Added upgrade" },
      },
    ],
  });

  assert.equal(result.netZero, false);
  assert.equal(result.adjustmentLines.length, 1);
  assert.equal(result.creditNoteRequired.length, 1);
  assert.equal(result.adjustmentLines[0]?.unitPrice, 80);
  assertMoney(result.creditNoteRequired[0]?.amount ?? zero, "50", "E2 must not use net delta");
}

async function runE3PartialQuantityReduction(): Promise<void> {
  const result = classifyEditDelta({
    additions: [],
    reductions: [
      {
        kind: "ADDON_QUANTITY_DECREASE",
        deltaQuantity: 2,
        lineSnapshot: { name: "Addon", unitPrice: money(15) },
      },
    ],
    swaps: [],
  });

  assert.equal(result.adjustmentLines.length, 0);
  assert.equal(result.creditNoteRequired[0]?.reason, "ADDON_QUANTITY_DECREASE");
  assertMoney(result.creditNoteRequired[0]?.amount ?? zero, "30", "E3 reduction value");
}

async function runE4MixedAdditionsAndRemovals(): Promise<void> {
  const result = classifyEditDelta({
    additions: [
      {
        kind: "NEW_ADDON",
        orderAddOnId: "addon-new",
        nameSnapshot: "New addon",
        priceSnapshot: money(25),
        quantity: 1,
      },
    ],
    reductions: [
      { kind: "REMOVED_ADDON", lineSnapshot: { name: "Old addon", totalValue: money(10) } },
    ],
    swaps: [],
  });

  assert.equal(result.adjustmentLines.length, 1);
  assert.equal(result.creditNoteRequired.length, 1);
  assert.equal(result.blocked.length, 0);
}

async function runE5PriceSnapshotEditBlocked(): Promise<void> {
  const result = classifyEditDelta({
    additions: [],
    reductions: [
      {
        kind: "PRICE_SNAPSHOT_EDIT_ATTEMPT",
        lineSnapshot: { name: "Locked line" },
      },
    ],
    swaps: [],
  });

  assert.equal(result.blocked[0]?.reason, "PRICE_SNAPSHOT_EDIT_ATTEMPT");
  assert.equal(result.adjustmentLines.length, 0);
  assert.equal(result.creditNoteRequired.length, 0);
}

async function runE6ManualDiscountCreditNoteOnly(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "e6");
  await createCreditNote({
    targetFinalInvoiceId: workflow.finalInvoiceId,
    lines: [{ description: "Manual discount", quantity: 1, unitPrice: 25 }],
    reason: "E6 manual discount",
    createdByUserId: fixtures.managerId,
  });

  const [creditNotes, adjustments] = await Promise.all([
    db.invoice.count({ where: { orderId: workflow.orderId, invoiceType: InvoiceType.CREDIT_NOTE } }),
    db.invoice.count({ where: { orderId: workflow.orderId, invoiceType: InvoiceType.ADJUSTMENT } }),
  ]);
  assert.equal(creditNotes, 1);
  assert.equal(adjustments, 0);
}

async function runE7ManualSurchargeExplicitOnly(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "e7");
  await createAdjustmentInvoice({
    parentFinalInvoiceId: workflow.finalInvoiceId,
    lines: [
      {
        lineType: InvoiceLineType.MANUAL_SURCHARGE,
        description: "Manual surcharge",
        quantity: 1,
        unitPrice: 35,
      },
    ],
    notes: "E7 explicit manual surcharge",
    createdByUserId: fixtures.managerId,
  });

  const [explicitAdjustment, autoAdjustmentActivity] = await Promise.all([
    db.invoice.findFirstOrThrow({
      where: { orderId: workflow.orderId, invoiceType: InvoiceType.ADJUSTMENT },
      include: { lineItems: true },
    }),
    db.orderActivity.count({
      where: { orderId: workflow.orderId, title: "Auto-adjustment issued" },
    }),
  ]);
  assert.equal(explicitAdjustment.lineItems[0]?.lineType, InvoiceLineType.MANUAL_SURCHARGE);
  assert.equal(autoAdjustmentActivity, 0);
}

async function runE8AdjustmentOfAdjustmentBlocked(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "e8");
  await addOrderProductAddOn(workflow.orderId, { productId: fixtures.addOnProductId }, fixtures.adminActor);
  const adjustment = await firstInvoice(db, workflow.orderId, InvoiceType.ADJUSTMENT);

  await assert.rejects(
    () =>
      createAdjustmentInvoice({
        parentFinalInvoiceId: adjustment.id,
        lines: [
          {
            lineType: InvoiceLineType.ADD_ON,
            description: "Invalid child adjustment",
            quantity: 1,
            unitPrice: 5,
          },
        ],
      }),
    /final invoices/
  );
}

async function runE9AdjustmentLineReductionTargetsFinal(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "e9");
  await addOrderProductAddOn(workflow.orderId, { productId: fixtures.addOnProductId }, fixtures.adminActor);
  const adjustment = await firstInvoice(db, workflow.orderId, InvoiceType.ADJUSTMENT);
  const creditNote = await createCreditNote({
    targetFinalInvoiceId: workflow.finalInvoiceId,
    lines: [{ description: "Reduction of adjustment cause", quantity: 1, unitPrice: 50 }],
    reason: "E9 reduction against adjustment-line cause",
    createdByUserId: fixtures.managerId,
  });
  const application = await db.documentApplication.findFirstOrThrow({
    where: { sourceInvoiceId: creditNote.id },
  });

  assert.equal(adjustment.parentInvoiceId, workflow.finalInvoiceId);
  assert.equal(application.targetInvoiceId, workflow.finalInvoiceId);
}

async function runE10ConcurrentEditCancellationStaleState(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "e10");
  await db.order.update({
    where: { id: workflow.orderId },
    data: { status: OrderStatus.DELIVERED },
  });

  await assert.rejects(
    () => addOrderProductAddOn(workflow.orderId, { productId: fixtures.addOnProductId }, fixtures.adminActor),
    /Delivered orders cannot be edited|Failed to add order add-on/
  );
  assert.equal(
    await db.invoice.count({ where: { orderId: workflow.orderId, invoiceType: InvoiceType.ADJUSTMENT } }),
    0
  );
}

async function runE11PaidAdjustmentCauseRemovalCharacterization(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "e11");
  await addOrderProductAddOn(workflow.orderId, { productId: fixtures.addOnProductId }, fixtures.adminActor);
  const adjustment = await firstInvoice(db, workflow.orderId, InvoiceType.ADJUSTMENT);
  await recordPayment(
    adjustment.id,
    { amount: 50, method: PaymentMethod.CASH, paymentType: PaymentType.ADJUSTMENT },
    fixtures.adminActor
  );
  const addOn = await db.orderAddOn.findFirstOrThrow({
    where: { orderId: workflow.orderId, productId: fixtures.addOnProductId },
  });
  const adjustmentLine = await db.invoiceLineItem.findFirstOrThrow({
    where: { invoiceId: adjustment.id },
  });

  await removeOrderAddOn(
    workflow.orderId,
    {
      addOnId: addOn.id,
      managerApprovedReductionByUserId: fixtures.managerId,
      managerApprovedReason: "E11 remove paid adjustment cause",
    },
    fixtures.adminActor
  );

  const [creditNotes, refunds, paidAdjustment, reversalApplication] = await Promise.all([
    db.invoice.count({ where: { orderId: workflow.orderId, invoiceType: InvoiceType.CREDIT_NOTE } }),
    db.invoice.count({ where: { orderId: workflow.orderId, invoiceType: InvoiceType.REFUND } }),
    db.invoice.findUniqueOrThrow({ where: { id: adjustment.id } }),
    db.documentApplication.findFirst({
      where: {
        targetInvoiceId: adjustment.id,
        targetInvoiceLineId: { not: null },
        sourceInvoice: { invoiceType: InvoiceType.CREDIT_NOTE },
      },
    }),
  ]);
  assert.equal(creditNotes, 1, "E11 now reverses paid adjustment cause removal with a credit note");
  assert.equal(refunds, 1, "E11 now creates a refund invoice for paid adjustment reversal");
  assert.equal(
    reversalApplication?.targetInvoiceLineId,
    adjustmentLine.id,
    "E11 reversal targets the exact adjustment line"
  );
  assert.equal(
    reversalApplication?.amountApplied.toFixed(3),
    adjustmentLine.lineTotal.toFixed(3),
    "E11 reversal amount matches the adjustment line"
  );
  assert.equal(paidAdjustment.status, InvoiceStatus.CLOSED);
}

async function runE12QuantityIncrease(): Promise<void> {
  const result = classifyEditDelta({
    additions: [
      {
        kind: "ADDON_QUANTITY_INCREASE",
        orderAddOnId: "addon",
        deltaQuantity: 3,
        lineSnapshot: { name: "Quantity addon", unitPrice: money(12) },
      },
    ],
    reductions: [],
    swaps: [],
  });

  assert.equal(result.adjustmentLines.length, 1);
  assert.equal(result.adjustmentLines[0]?.quantity, 3);
  assert.equal(result.adjustmentLines[0]?.unitPrice, 12);
}

async function runEc13DoubleConfirmation(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const pending = await buildPendingBookingFixture(fixtures, "ec13");
  await recordBookingDeposit(
    { bookingId: pending.bookingId, amount: 20, method: PaymentMethod.CASH },
    fixtures.adminActor
  );
  await assert.rejects(
    () =>
      recordBookingDeposit(
        { bookingId: pending.bookingId, amount: 20, method: PaymentMethod.CASH },
        fixtures.adminActor
      ),
    /pending bookings|Failed to record booking deposit/
  );

  const [financialCases, deposits, payments] = await Promise.all([
    db.financialCase.count({ where: { bookingId: pending.bookingId } }),
    db.invoice.count({ where: { bookingId: pending.bookingId, invoiceType: InvoiceType.DEPOSIT } }),
    db.payment.count({ where: { invoice: { bookingId: pending.bookingId }, paymentType: PaymentType.DEPOSIT } }),
  ]);
  assert.equal(financialCases, 1);
  assert.equal(deposits, 1);
  assert.equal(payments, 1);
}

async function runEc14DepositBelowMinimum(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const pending = await buildPendingBookingFixture(fixtures, "ec14");
  await expectRejectsWithoutPartialWrites(
    () =>
      recordBookingDeposit(
        { bookingId: pending.bookingId, amount: 15, method: PaymentMethod.CASH },
        fixtures.adminActor
      ),
    () => financialCaseSnapshotForBooking(db, pending.bookingId),
    /at least 20/
  );
}

async function runEc15FinalInvoiceCreatedTwice(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildCheckedInWorkflowFixture(db, fixtures, "ec15");
  const first = await createInvoiceForOrder(workflow.orderId, fixtures.adminActor);
  const second = await createInvoiceForOrder(workflow.orderId, fixtures.adminActor);

  assert.equal(second.id, first.id);
  assert.equal(
    await db.invoice.count({
      where: {
        financialCaseId: workflow.financialCaseId,
        invoiceType: InvoiceType.FINAL,
        parentInvoiceId: null,
      },
    }),
    1
  );
}

async function runEc16PaymentExceedsInvoiceTotal(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "ec16", {
    issue: true,
  });
  await expectRejectsWithoutPartialWrites(
    () =>
      recordPayment(
        workflow.finalInvoiceId,
        { amount: 481, method: PaymentMethod.CASH, paymentType: PaymentType.FINAL },
        fixtures.adminActor
      ),
    () => paymentSnapshot(db, workflow.finalInvoiceId),
    /cannot exceed/
  );
}

async function runEc17CreditNoteExceedsFinalTotal(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "ec17");
  await expectRejectsWithoutPartialWrites(
    () =>
      createCreditNote({
        targetFinalInvoiceId: workflow.finalInvoiceId,
        lines: [{ description: "Too much", quantity: 1, unitPrice: 501 }],
        reason: "EC-17 cap",
        createdByUserId: fixtures.managerId,
      }),
    () => invoiceTypeSnapshot(db, workflow.orderId),
    /cannot exceed/
  );
}

async function runEc18RefundExceedsOverpaymentCharacterization(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "ec18");
  const finalPayment = await firstPayment(db, workflow.finalInvoiceId, PaymentType.FINAL);
  await createCreditNote({
    targetFinalInvoiceId: workflow.finalInvoiceId,
    lines: [{ description: "Creates 50 overpayment", quantity: 1, unitPrice: 50 }],
    reason: "EC-18 credit",
    createdByUserId: fixtures.managerId,
  });

  const refund = await createRefundInvoice({
    sourceInvoiceId: workflow.finalInvoiceId,
    amount: 51,
    reason: "EC-18 characterizes refund cap gap",
    createdByUserId: fixtures.managerId,
  });
  assert.equal(refund.invoiceType, InvoiceType.REFUND);
  assert.equal(finalPayment.paymentType, PaymentType.FINAL);
}

async function runEc19RefundAfterAdjustmentWithoutCreditCharacterization(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "ec19");
  await addOrderProductAddOn(workflow.orderId, { productId: fixtures.addOnProductId }, fixtures.adminActor);
  const adjustment = await firstInvoice(db, workflow.orderId, InvoiceType.ADJUSTMENT);
  await recordPayment(
    adjustment.id,
    { amount: 50, method: PaymentMethod.CASH, paymentType: PaymentType.ADJUSTMENT },
    fixtures.adminActor
  );

  const refundable = await computeRefundableAmountForInvoice(adjustment.id, db);
  assertMoney(refundable, "50", "EC-19 characterizes current refundable amount gap without credit note");
}

async function runEc20SecondAdjustmentIsSibling(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "ec20");
  await addOrderProductAddOn(workflow.orderId, { productId: fixtures.addOnProductId }, fixtures.adminActor);
  const firstAdjustment = await firstInvoice(db, workflow.orderId, InvoiceType.ADJUSTMENT);
  await recordPayment(
    firstAdjustment.id,
    { amount: 50, method: PaymentMethod.CASH, paymentType: PaymentType.ADJUSTMENT },
    fixtures.adminActor
  );
  await addOrderProductAddOn(workflow.orderId, { productId: fixtures.secondAddOnProductId }, fixtures.adminActor);

  const adjustments = await db.invoice.findMany({
    where: { orderId: workflow.orderId, invoiceType: InvoiceType.ADJUSTMENT },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(adjustments.length, 2);
  assert.deepEqual(adjustments.map((invoice) => invoice.parentInvoiceId), [
    workflow.finalInvoiceId,
    workflow.finalInvoiceId,
  ]);
}

async function runEc21CreditNoteAfterMultipleAdjustments(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "ec21");
  await addOrderProductAddOn(workflow.orderId, { productId: fixtures.addOnProductId }, fixtures.adminActor);
  await addOrderProductAddOn(workflow.orderId, { productId: fixtures.secondAddOnProductId }, fixtures.adminActor);
  const creditNote = await createCreditNote({
    targetFinalInvoiceId: workflow.finalInvoiceId,
    lines: [{ description: "Reduction from first adjustment", quantity: 1, unitPrice: 50 }],
    reason: "EC-21 adjustment-line reduction",
    createdByUserId: fixtures.managerId,
  });

  const application = await db.documentApplication.findFirstOrThrow({
    where: { sourceInvoiceId: creditNote.id },
  });
  const adjustments = await db.invoice.findMany({
    where: { orderId: workflow.orderId, invoiceType: InvoiceType.ADJUSTMENT },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(application.targetInvoiceId, workflow.finalInvoiceId);
  assert.equal(adjustments.length, 2);
  assert.ok(adjustments.every((invoice) => invoice.parentInvoiceId === workflow.finalInvoiceId));
}

async function runEc22AppendOnlyPaymentOnLockedFinal(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "ec22", {
    issue: true,
    finalPaymentAmounts: [200],
  });
  await db.invoice.update({
    where: { id: workflow.finalInvoiceId },
    data: { status: InvoiceStatus.CLOSED, isLocked: true },
  });
  await recordPayment(
    workflow.finalInvoiceId,
    { amount: 280, method: PaymentMethod.CASH, paymentType: PaymentType.FINAL },
    fixtures.adminActor
  );

  const invoice = await db.invoice.findUniqueOrThrow({ where: { id: workflow.finalInvoiceId } });
  assert.equal(invoice.isLocked, true);
  assert.equal(invoice.status, InvoiceStatus.CLOSED);
  assertMoney(invoice.remainingAmount, "0", "locked final append-only payment settles balance");
}

async function runEc23StalePaymentAfterInvoiceLocks(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "ec23", {
    issue: true,
  });
  await recordPayment(
    workflow.finalInvoiceId,
    { amount: 480, method: PaymentMethod.CASH, paymentType: PaymentType.FINAL },
    fixtures.adminActor
  );
  await assert.rejects(
    () =>
      recordPayment(
        workflow.finalInvoiceId,
        { amount: 1, method: PaymentMethod.CASH, paymentType: PaymentType.FINAL },
        fixtures.adminActor
      ),
    /No outstanding balance|Failed to record payment/
  );
}

async function runEc24PackageDowngradeBlocked(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "ec24");
  const orderPackage = await firstOrderPackage(db, workflow.orderId);
  await expectRejectsWithoutPartialWrites(
    () =>
      updateOrderPackage(
        workflow.orderId,
        { orderPackageId: orderPackage.id, packageId: fixtures.cheaperPackageId },
        fixtures.adminActor
      ),
    () => invoiceTypeSnapshot(db, workflow.orderId),
    /Manager confirmation is required|Failed to update order package/
  );
}

async function runEc25EqualPricePackageSwap(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "ec25");
  const orderPackage = await firstOrderPackage(db, workflow.orderId);
  const beforeFinancial = await invoiceTypeSnapshot(db, workflow.orderId);
  await updateOrderPackage(
    workflow.orderId,
    { orderPackageId: orderPackage.id, packageId: fixtures.equalPackageId },
    fixtures.adminActor
  );
  const afterFinancial = await invoiceTypeSnapshot(db, workflow.orderId);
  const activityCount = await db.orderActivity.count({
    where: { orderId: workflow.orderId, title: "Package line changed" },
  });
  assert.deepEqual(afterFinancial, beforeFinancial);
  assert.equal(activityCount, 1);
}

async function runEc26ConfirmedBookingHardDeleteBlocked(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const confirmed = await buildConfirmedBookingFixture(db, fixtures, "ec26");
  await assert.rejects(
    () => deletePendingBooking({ bookingId: confirmed.bookingId }),
    /Only pending bookings can be deleted|Failed to delete pending booking/
  );
  assert.equal(await db.booking.count({ where: { id: confirmed.bookingId } }), 1);
}

async function runEc27DirectLockedInvoiceUnlockCharacterization(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "ec27");
  await db.invoice.update({
    where: { id: workflow.finalInvoiceId },
    data: { isLocked: false },
  });
  const unlocked = await db.invoice.findUniqueOrThrow({
    where: { id: workflow.finalInvoiceId },
    select: { isLocked: true },
  });
  assert.equal(unlocked.isLocked, false, "EC-27 documents missing DB lock immutability");
  await db.invoice.update({ where: { id: workflow.finalInvoiceId }, data: { isLocked: true } });
}

async function runEc28OpenAdjustmentAfterCancellationCharacterization(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "ec28");
  await addOrderProductAddOn(workflow.orderId, { productId: fixtures.addOnProductId }, fixtures.adminActor);
  await db.order.update({ where: { id: workflow.orderId }, data: { status: OrderStatus.CANCELLED } });

  const openAdjustments = await db.invoice.count({
    where: {
      orderId: workflow.orderId,
      invoiceType: InvoiceType.ADJUSTMENT,
      status: { not: InvoiceStatus.CLOSED },
    },
  });
  assert.equal(openAdjustments, 1, "EC-28 documents phantom receivable risk after cancellation");
}

async function runEc29MultiPackageInvoiceLines(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildCheckedInWorkflowFixture(db, fixtures, "ec29");
  await addSecondPackageLine(db, fixtures, workflow.orderId);
  await db.orderAddOn.create({
    data: {
      orderId: workflow.orderId,
      productId: fixtures.addOnProductId,
      nameSnapshot: "EC-29 shared add-on",
      priceSnapshot: new Prisma.Decimal(50),
      quantity: 1,
    },
  });
  const invoice = await createInvoiceForOrder(workflow.orderId, fixtures.adminActor);
  await snapshotInvoiceLineItems(invoice.id, workflow.orderId);
  const lineItems = await db.invoiceLineItem.findMany({
    where: { invoiceId: invoice.id },
    orderBy: { sortOrder: "asc" },
  });

  assert.equal(lineItems.filter((line) => line.lineType === InvoiceLineType.PACKAGE_BASE).length, 2);
  assert.equal(lineItems.filter((line) => line.lineType === InvoiceLineType.ADD_ON).length, 1);
  const storedInvoice = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  assertMoney(storedInvoice.totalAmount, "750", "multi-package total must avoid add-on double count");
}

async function runEc30PackageScopedAddonDeletion(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildCheckedInWorkflowFixture(db, fixtures, "ec30");
  const packageOne = await firstOrderPackage(db, workflow.orderId);
  const packageTwoId = await addSecondPackageLine(db, fixtures, workflow.orderId);
  await db.orderAddOn.createMany({
    data: [
      {
        orderId: workflow.orderId,
        orderPackageId: packageOne.id,
        productId: fixtures.addOnProductId,
        nameSnapshot: "Scoped add-on one",
        priceSnapshot: new Prisma.Decimal(50),
        quantity: 1,
      },
      {
        orderId: workflow.orderId,
        orderPackageId: packageTwoId,
        productId: fixtures.secondAddOnProductId,
        nameSnapshot: "Scoped add-on two",
        priceSnapshot: new Prisma.Decimal(30),
        quantity: 1,
      },
    ],
  });
  await db.orderPackage.delete({ where: { id: packageOne.id } });

  const remaining = await db.orderAddOn.findMany({
    where: { orderId: workflow.orderId },
    select: { orderPackageId: true, productId: true },
  });
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]?.orderPackageId, packageTwoId);
}

async function runEc31PhotographerAssignmentChange(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildCheckedInWorkflowFixture(db, fixtures, "ec31");
  const before = await invoiceTypeSnapshot(db, workflow.orderId);
  const booking = await db.booking.findUniqueOrThrow({
    where: { id: workflow.bookingId },
    select: { jobId: true },
  });
  await db.job.update({
    where: { id: booking.jobId ?? "" },
    data: { assignedPhotographerId: fixtures.secondPhotographerId },
  });
  const after = await invoiceTypeSnapshot(db, workflow.orderId);
  assert.deepEqual(after, before);
  assert.equal(
    await db.orderActivity.count({
      where: { orderId: workflow.orderId, title: { contains: "Photographer" } },
    }),
    0,
    "EC-31 documents audit gap for direct photographer changes"
  );
}

async function runEc32CommissionUpgradeHookGap(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "ec32");
  const orderPackage = await firstOrderPackage(db, workflow.orderId);
  await updateOrderPackage(
    workflow.orderId,
    { orderPackageId: orderPackage.id, packageId: fixtures.upgradePackageId },
    fixtures.adminActor
  );

  const maybeCommissionClient = db as PrismaClient & { commission?: unknown };
  assert.equal(maybeCommissionClient.commission, undefined, "EC-32 documents missing commission persistence model");
}

async function runEc33NoUpgradeNoCommissionRows(db: PrismaClient): Promise<void> {
  const maybeCommissionClient = db as PrismaClient & { commission?: { count: () => Promise<number> } };
  assert.equal(maybeCommissionClient.commission, undefined);
}

async function runEc34SessionTypeMismatchBlocked(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "ec34");
  const orderPackage = await firstOrderPackage(db, workflow.orderId);
  await assert.rejects(
    () =>
      updateOrderPackage(
        workflow.orderId,
        { orderPackageId: orderPackage.id, packageId: fixtures.otherSessionPackageId },
        fixtures.adminActor
      ),
    /session type|Failed to update order package/
  );
}

async function runEc35StaleRecalculationAfterAdjustmentPaid(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "ec35");
  await addOrderProductAddOn(workflow.orderId, { productId: fixtures.addOnProductId }, fixtures.adminActor);
  const adjustment = await firstInvoice(db, workflow.orderId, InvoiceType.ADJUSTMENT);
  await recordPayment(
    adjustment.id,
    { amount: 50, method: PaymentMethod.CASH, paymentType: PaymentType.ADJUSTMENT },
    fixtures.adminActor
  );
  const before = await paymentSnapshot(db, adjustment.id);
  await syncOrderInvoiceForFinancialEdit(db, { orderId: workflow.orderId, previousAddOns: [] });
  const after = await paymentSnapshot(db, adjustment.id);
  const finalInvoice = await db.invoice.findUniqueOrThrow({ where: { id: workflow.finalInvoiceId } });

  assert.deepEqual(after, before);
  assertMoney(finalInvoice.totalAmount, "500", "stale recalculation must not fold adjustment into final");
}

async function runEc36MissingDocumentApplicationDetected(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "ec36");
  const application = await db.documentApplication.findFirstOrThrow({
    where: { targetInvoiceId: workflow.finalInvoiceId },
  });
  await db.documentApplication.delete({ where: { id: application.id } });
  const violations = await runAllInvariants(db);
  assert.ok(
    violations.some(
      (violation) =>
        violation.invariant === "deposit-final-pair-has-document-application"
    )
  );
  await applyDepositToFinalIfPresent(workflow.financialCaseId, workflow.finalInvoiceId, db);
}

async function runEc37PaymentRaceLockCoverageCharacterization(): Promise<void> {
  const source = await readFile("src/modules/payments/payment.service.ts", "utf8");
  assert.equal(
    /FOR\s+UPDATE/i.test(source),
    true,
    "EC-37 expects row-level payment lock coverage in the settlement path"
  );
}

async function runEc38RefundInvoiceAmountIntegrity(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "ec38");
  const finalPayment = await firstPayment(db, workflow.finalInvoiceId, PaymentType.FINAL);
  await createCreditNote({
    targetFinalInvoiceId: workflow.finalInvoiceId,
    lines: [{ description: "Refundable", quantity: 1, unitPrice: 20 }],
    reason: "EC-38 credit",
    createdByUserId: fixtures.managerId,
  });
  const refund = await issueRefundWithPayment({
    sourceInvoiceId: workflow.finalInvoiceId,
    amount: 20,
    reason: "EC-38 refund",
    createdByUserId: fixtures.managerId,
    method: PaymentMethod.CASH,
    refundOfPaymentId: finalPayment.id,
  });
  const refundInvoice = await db.invoice.findUniqueOrThrow({
    where: { id: refund.refundInvoiceId },
    include: { payments: { include: { allocations: true } } },
  });
  const payment = refundInvoice.payments[0];

  assertMoney(refundInvoice.totalAmount, "20", "refund invoice amount");
  assertMoney(payment?.amount ?? zero, "20", "refund payment amount");
  assertMoney(payment?.allocations[0]?.amount ?? zero, "20", "refund allocation amount");
}

async function runEc39VoucherSchemaCompatibilityCharacterization(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const pending = await buildPendingBookingFixture(fixtures, "ec39");
  await recordBookingDeposit(
    { bookingId: pending.bookingId, amount: 20, method: PaymentMethod.CASH },
    fixtures.adminActor
  );
  const maybeGiftCardClient = db as PrismaClient & { giftCardRedemption?: unknown };
  assert.equal(maybeGiftCardClient.giftCardRedemption, undefined);
  assert.equal(
    await db.invoice.count({ where: { bookingId: pending.bookingId, invoiceType: InvoiceType.DEPOSIT } }),
    1
  );
}

async function runEc40MultiPackageAdjustmentScope(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildCheckedInWorkflowFixture(db, fixtures, "ec40");
  const packageOne = await firstOrderPackage(db, workflow.orderId);
  await addSecondPackageLine(db, fixtures, workflow.orderId);
  const invoice = await createInvoiceForOrder(workflow.orderId, fixtures.adminActor);
  await issueInvoice(invoice.id, fixtures.adminActor);
  await recordPayment(
    invoice.id,
    { amount: 680, method: PaymentMethod.CASH, paymentType: PaymentType.FINAL },
    fixtures.adminActor
  );
  await db.orderAddOn.create({
    data: {
      orderId: workflow.orderId,
      orderPackageId: packageOne.id,
      productId: fixtures.addOnProductId,
      nameSnapshot: "EC-40 scoped add-on",
      priceSnapshot: new Prisma.Decimal(50),
      quantity: 1,
    },
  });
  await syncOrderInvoiceForFinancialEdit(db, { orderId: workflow.orderId, previousAddOns: [] });
  const adjustment = await firstInvoice(db, workflow.orderId, InvoiceType.ADJUSTMENT);
  const addOn = await db.orderAddOn.findFirstOrThrow({
    where: { orderId: workflow.orderId, productId: fixtures.addOnProductId },
  });
  assert.equal(adjustment.parentInvoiceId, invoice.id);
  assert.equal(addOn.orderPackageId, packageOne.id);
}

async function runEc41InvoiceNumberPrefixes(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "ec41");
  await addOrderProductAddOn(workflow.orderId, { productId: fixtures.addOnProductId }, fixtures.adminActor);
  const finalPayment = await firstPayment(db, workflow.finalInvoiceId, PaymentType.FINAL);
  const creditNote = await createCreditNote({
    targetFinalInvoiceId: workflow.finalInvoiceId,
    lines: [{ description: "Prefix credit", quantity: 1, unitPrice: 10 }],
    reason: "EC-41 credit",
    createdByUserId: fixtures.managerId,
  });
  const refund = await issueRefundWithPayment({
    sourceInvoiceId: workflow.finalInvoiceId,
    amount: 10,
    reason: "EC-41 refund",
    createdByUserId: fixtures.managerId,
    method: PaymentMethod.CASH,
    refundOfPaymentId: finalPayment.id,
  });

  const invoices = await db.invoice.findMany({
    where: {
      OR: [
        { bookingId: workflow.bookingId, invoiceType: InvoiceType.DEPOSIT },
        { id: workflow.finalInvoiceId },
        { orderId: workflow.orderId, invoiceType: InvoiceType.ADJUSTMENT },
        { id: creditNote.id },
        { id: refund.refundInvoiceId },
      ],
    },
    select: { invoiceType: true, invoiceNumber: true },
  });
  const prefixByType: Record<InvoiceType, string> = {
    [InvoiceType.DEPOSIT]: "DEP-",
    [InvoiceType.FINAL]: "INV-",
    [InvoiceType.ADJUSTMENT]: "ADJ-",
    [InvoiceType.CREDIT_NOTE]: "CN-",
    [InvoiceType.REFUND]: "REF-",
    [InvoiceType.SALE]: "SALE-",
  };
  for (const invoice of invoices) {
    assert.equal(
      invoice.invoiceNumber.startsWith(prefixByType[invoice.invoiceType]),
      true,
      `${invoice.invoiceType} prefix`
    );
  }
}

async function runEc42IdentifierSequenceSelfHealing(
  db: PrismaClient,
  fixtures: PhaseCFixtures
): Promise<void> {
  const confirmed = await buildConfirmedBookingFixture(db, fixtures, "ec42-existing");
  const existing = await db.booking.findUniqueOrThrow({
    where: { id: confirmed.bookingId },
    select: { publicId: true, sessionDate: true, department: { select: { code: true } } },
  });
  const existingNumber = Number(existing.publicId?.match(/(\d+)$/)?.[1] ?? "0");
  await db.identifierSequence.update({
    where: {
      scope_year_kind: {
        scope: existing.department.code,
        year: existing.sessionDate.getUTCFullYear(),
        kind: WORKFLOW_REFERENCE_KIND.BOOKING,
      },
    },
    data: { lastValue: 1 },
  });
  const nextReference = await db.$transaction((tx) =>
    generateBookingReference(tx, {
      departmentCode: existing.department.code,
      sessionDate: existing.sessionDate,
    })
  );
  const nextNumber = Number(nextReference.match(/(\d+)$/)?.[1] ?? "0");
  assert.equal(nextNumber > existingNumber, true);
}

function money(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

async function firstOrderPackage(db: PrismaClient, orderId: string) {
  return db.orderPackage.findFirstOrThrow({
    where: { orderId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

async function firstInvoice(
  db: PrismaClient,
  orderId: string,
  invoiceType: InvoiceType
) {
  return db.invoice.findFirstOrThrow({
    where: { orderId, invoiceType },
    orderBy: { createdAt: "asc" },
  });
}

async function firstPayment(
  db: PrismaClient,
  invoiceId: string,
  paymentType: PaymentType
) {
  return db.payment.findFirstOrThrow({
    where: { invoiceId, paymentType },
    orderBy: { createdAt: "asc" },
  });
}

async function financialCaseSnapshotForBooking(db: PrismaClient, bookingId: string) {
  return db.booking.findUnique({
    where: { id: bookingId },
    select: {
      publicId: true,
      status: true,
      financialCase: { select: { id: true } },
      invoices: { select: { id: true, invoiceType: true } },
    },
  });
}

async function paymentSnapshot(db: PrismaClient, invoiceId: string) {
  return db.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      paidAmount: true,
      remainingAmount: true,
      status: true,
      isLocked: true,
      payments: {
        select: {
          id: true,
          amount: true,
          direction: true,
          paymentType: true,
          allocations: { select: { invoiceId: true, amount: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

async function invoiceTypeSnapshot(db: PrismaClient, orderId: string) {
  return db.invoice.findMany({
    where: { orderId },
    select: {
      invoiceType: true,
      parentInvoiceId: true,
      totalAmount: true,
      status: true,
      isLocked: true,
    },
    orderBy: [{ invoiceType: "asc" }, { createdAt: "asc" }],
  });
}
