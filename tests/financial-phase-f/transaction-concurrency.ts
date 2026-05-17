import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BookingStatus,
  InvoiceStatus,
  InvoiceType,
  PaymentMethod,
  PaymentType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { computeEffectivePaidFromAllocations } from "@/modules/invoices/invoice.calculation";
import {
  removeOrderAddOn,
} from "@/modules/orders/order.service";
import {
  applyEdit,
  finalizeWorkspace,
  openWorkspace,
} from "@/modules/adjustment-workspace/adjustment-workspace.service";
import { recordPayment } from "@/modules/payments/payment.service";
import { recordBookingDeposit } from "@/modules/bookings/booking.service";
import { assertMoney } from "../financial-phase-b/assertions";
import {
  buildFinalInvoiceWorkflowFixture,
  buildLockedFinalInvoiceWorkflowFixture,
  buildPendingBookingFixture,
  cleanupWorkflow,
  seedPhaseFFixtures,
  type PhaseFFixtures,
} from "./fixtures";

type CaseRunner = {
  id: string;
  run: (db: PrismaClient, fixtures: PhaseFFixtures) => Promise<void>;
};

export async function runPhaseFTransactionConcurrencySuite(
  db: PrismaClient,
  fixtures?: PhaseFFixtures
): Promise<void> {
  const activeFixtures = fixtures ?? (await seedPhaseFFixtures(db));
  const cases: CaseRunner[] = [
    { id: "F-CON-01", run: runConcurrentBookingConfirmation },
    { id: "F-CON-02", run: runDoubleClickFinalPaymentRace },
    { id: "F-CON-03", run: runConcurrentLockedPosAdditions },
    { id: "F-CON-04", run: runStaleCreditNoteApprovalRevalidatesAddOn },
    { id: "F-CON-05", run: runFinalOnePercentSettlementRace },
    { id: "F-CON-06", run: runStaleBrowserPaymentAfterInvoiceClosed },
    { id: "F-CON-07", run: runPaymentRowLockCoverageCharacterization },
  ];

  for (const testCase of cases) {
    await testCase.run(db, activeFixtures);
  }
}

async function runConcurrentBookingConfirmation(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const { bookingId } = await buildPendingBookingFixture(fixtures, "con01");
  const results = await Promise.allSettled([
    recordBookingDeposit(
      {
        bookingId,
        amount: 20,
        method: PaymentMethod.CASH,
        reference: "phase-f-con01-a",
      },
      fixtures.adminActor
    ),
    recordBookingDeposit(
      {
        bookingId,
        amount: 20,
        method: PaymentMethod.KNET,
        reference: "phase-f-con01-b",
      },
      fixtures.adminActor
    ),
  ]);

  assert.equal(countFulfilled(results), 1, "only one concurrent deposit can succeed");
  assert.equal(countRejected(results), 1, "the losing deposit must reject");

  const booking = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: {
      financialCase: true,
      invoices: {
        include: {
          payments: { include: { allocations: true } },
        },
      },
    },
  });
  const depositInvoices = booking.invoices.filter(
    (invoice) => invoice.invoiceType === InvoiceType.DEPOSIT
  );
  const depositPayments = depositInvoices.flatMap((invoice) => invoice.payments);

  assert.equal(booking.status, BookingStatus.CONFIRMED);
  assert.match(booking.publicId ?? "", /^BK-PHASE_F-2026-/);
  assert.ok(booking.financialCase, "exactly one FinancialCase must be present");
  assert.equal(depositInvoices.length, 1, "exactly one Deposit invoice must be present");
  assert.equal(depositPayments.length, 1, "exactly one Deposit payment must be present");
  assert.equal(
    depositPayments[0]?.allocations.length,
    1,
    "the winning payment must keep one allocation"
  );
}

async function runDoubleClickFinalPaymentRace(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "con02", {
    issue: true,
  });

  try {
    const results = await Promise.allSettled([
      recordPayment(
        workflow.finalInvoiceId,
        { amount: 480, method: PaymentMethod.CASH, paymentType: PaymentType.FINAL },
        fixtures.adminActor
      ),
      recordPayment(
        workflow.finalInvoiceId,
        { amount: 480, method: PaymentMethod.KNET, paymentType: PaymentType.FINAL },
        fixtures.adminActor
      ),
    ]);

    const storedPayments = await db.payment.findMany({
      where: { invoiceId: workflow.finalInvoiceId, paymentType: PaymentType.FINAL },
      include: { allocations: true },
    });
    const invoice = await db.invoice.findUniqueOrThrow({
      where: { id: workflow.finalInvoiceId },
      select: { remainingAmount: true, status: true, isLocked: true },
    });

    assert.equal(countFulfilled(results), 1, "exactly one simultaneous full payment should complete");
    assert.equal(countRejected(results), 1, "the losing submission must reject once the invoice settles");
    assert.equal(
      storedPayments.length,
      countFulfilled(results),
      "stored final payments must match successful submissions"
    );
    for (const payment of storedPayments) {
      assert.equal(payment.allocations.length, 1, "each stored payment keeps one allocation");
      assertMoney(payment.amount, "480", "stored race payment amount");
    }
    assertMoney(invoice.remainingAmount, "0", "winning payment must settle the invoice");
    assert.equal(invoice.status, InvoiceStatus.CLOSED);
    assert.equal(invoice.isLocked, true);
  } finally {
    await cleanupWorkflow(db, workflow);
  }
}

async function runConcurrentLockedPosAdditions(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "con03");

  const openResults = await Promise.allSettled([
    openWorkspace(workflow.finalInvoiceId, fixtures.adminActor),
    openWorkspace(workflow.finalInvoiceId, fixtures.managerActor),
  ]);
  assert.equal(countFulfilled(openResults), 2, "concurrent opens should converge");
  const workspaceIds = openResults.map((result) =>
    result.status === "fulfilled" ? result.value.id : ""
  );
  assert.equal(new Set(workspaceIds).size, 1, "only one open workspace is valid");

  const workspaceId = workspaceIds[0] ?? assert.fail("missing workspace id");
  let view = await applyEdit(
    workspaceId,
    {
      version: 0,
      edit: {
        id: "con03-addon-a",
        op: "add_line",
        kind: "addon",
        refId: fixtures.addOnProductId,
        quantity: 1,
      },
    },
    fixtures.adminActor
  );
  view = await applyEdit(
    workspaceId,
    {
      version: view.version,
      edit: {
        id: "con03-addon-b",
        op: "add_line",
        kind: "addon",
        refId: fixtures.secondAddOnProductId,
        quantity: 1,
      },
    },
    fixtures.managerActor
  );
  await finalizeWorkspace(workspaceId, { version: view.version }, fixtures.adminActor);

  const adjustments = await db.invoice.findMany({
    where: { orderId: workflow.orderId, invoiceType: InvoiceType.ADJUSTMENT },
    include: { lineItems: true },
  });

  assert.equal(adjustments.length, 1, "workspace finalize creates one consolidated ADJ");
  assert.equal(adjustments[0]?.parentInvoiceId, workflow.finalInvoiceId);
  assert.equal(adjustments[0]?.status, InvoiceStatus.ISSUED);
  assert.equal(adjustments[0]?.lineItems.length, 2);
  assertMoney(adjustments[0]?.totalAmount ?? new Prisma.Decimal(0), "80", "combined add-ons");
}

async function runStaleCreditNoteApprovalRevalidatesAddOn(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "con04", {
    preInvoiceAddOns: [
      {
        productId: fixtures.addOnProductId,
        name: "Phase F stale removable add-on",
        price: 50,
        quantity: 1,
      },
    ],
  });
  const staleAddOn = await db.orderAddOn.findFirstOrThrow({
    where: { orderId: workflow.orderId, productId: fixtures.addOnProductId },
    select: { id: true },
  });

  await assert.rejects(
    () =>
      removeOrderAddOn(
        workflow.orderId,
        {
          addOnId: staleAddOn.id,
          managerApprovedReductionByUserId: fixtures.managerId,
          managerApprovedReason: "Phase F first removal",
        },
        fixtures.managerActor
      ),
    /Adjustment Workspace|Failed to remove order add-on/
  );
  const creditNotesBeforeStaleSubmit = await db.invoice.count({
    where: { orderId: workflow.orderId, invoiceType: InvoiceType.CREDIT_NOTE },
  });

  await assert.rejects(
    () =>
      removeOrderAddOn(
        workflow.orderId,
        {
          addOnId: staleAddOn.id,
          managerApprovedReductionByUserId: fixtures.managerId,
          managerApprovedReason: "Phase F stale approval",
        },
        fixtures.managerActor
      ),
    /not found|Failed to remove order add-on/
  );

  const creditNotesAfterStaleSubmit = await db.invoice.count({
    where: { orderId: workflow.orderId, invoiceType: InvoiceType.CREDIT_NOTE },
  });
  assert.equal(
    creditNotesAfterStaleSubmit,
    creditNotesBeforeStaleSubmit,
    "stale approval must not issue a second credit note"
  );
}

async function runFinalOnePercentSettlementRace(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "con05", {
    issue: true,
    finalPaymentAmounts: [475],
  });

  try {
    const results = await Promise.allSettled([
      recordPayment(
        workflow.finalInvoiceId,
        { amount: 5, method: PaymentMethod.CASH, paymentType: PaymentType.FINAL },
        fixtures.adminActor
      ),
      recordPayment(
        workflow.finalInvoiceId,
        { amount: 5, method: PaymentMethod.KNET, paymentType: PaymentType.FINAL },
        fixtures.managerActor
      ),
    ]);
    const payments = await db.payment.findMany({
      where: { invoiceId: workflow.finalInvoiceId, paymentType: PaymentType.FINAL },
      orderBy: { createdAt: "asc" },
      select: { amount: true },
    });
    const invoice = await db.invoice.findUniqueOrThrow({
      where: { id: workflow.finalInvoiceId },
      select: { status: true, isLocked: true, totalAmount: true },
    });

    assert.equal(countFulfilled(results), 1, "exactly one final 1% settlement should complete");
    assert.equal(countRejected(results), 1, "the losing closer must reject once the invoice is settled");
    assert.equal(payments.length, 2, "safe race outcome keeps initial payment plus one closer");
    assert.equal(invoice.status, InvoiceStatus.CLOSED);
    assert.equal(invoice.isLocked, true);
    const effectivePaid = await computeEffectivePaidFromAllocations(
      workflow.finalInvoiceId,
      db
    );
    assert.equal(
      effectivePaid.equals(invoice.totalAmount),
      true,
      "the locked settlement path must not over-collect"
    );
  } finally {
    await cleanupWorkflow(db, workflow);
  }
}

async function runStaleBrowserPaymentAfterInvoiceClosed(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "con06");
  const beforePayments = await db.payment.count({
    where: { invoiceId: workflow.finalInvoiceId },
  });

  await assert.rejects(
    () =>
      recordPayment(
        workflow.finalInvoiceId,
        { amount: 1, method: PaymentMethod.CASH, paymentType: PaymentType.FINAL },
        fixtures.adminActor
      ),
    /No outstanding balance remains|Failed to record payment/
  );

  const afterPayments = await db.payment.count({
    where: { invoiceId: workflow.finalInvoiceId },
  });
  assert.equal(afterPayments, beforePayments, "stale closed invoice payment must not write");
}

async function runPaymentRowLockCoverageCharacterization(): Promise<void> {
  const source = await readFile("src/modules/payments/payment.service.ts", "utf8");
  assert.equal(
    /FOR\s+UPDATE/i.test(source),
    true,
    "Phase F expects invoice payment processing to acquire SELECT ... FOR UPDATE"
  );
}

function countFulfilled(results: PromiseSettledResult<unknown>[]): number {
  return results.filter((result) => result.status === "fulfilled").length;
}

function countRejected(results: PromiseSettledResult<unknown>[]): number {
  return results.filter((result) => result.status === "rejected").length;
}
