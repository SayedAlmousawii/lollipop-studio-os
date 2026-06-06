import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BookingStatus,
  InvoiceStatus,
  InvoiceType,
  PaymentMethod,
  PaymentType,
  type PrismaClient,
} from "@prisma/client";
import { computeEffectivePaidFromAllocations } from "@/modules/invoices/invoice.calculation";
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
