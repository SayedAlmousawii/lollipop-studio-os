import assert from "node:assert/strict";
import { Prisma, type PrismaClient } from "@prisma/client";

export function assertMoney(
  actual: Prisma.Decimal,
  expected: string,
  message: string
): void {
  assert.equal(actual.toFixed(3), new Prisma.Decimal(expected).toFixed(3), message);
}

export async function assertSinglePaymentAllocation(
  db: PrismaClient,
  paymentId: string,
  invoiceId: string,
  amount: string
): Promise<void> {
  const allocations = await db.paymentAllocation.findMany({
    where: { paymentId },
    select: { invoiceId: true, amount: true },
  });

  assert.equal(allocations.length, 1, "payment must have exactly one allocation");
  assert.equal(allocations[0]?.invoiceId, invoiceId);
  assertMoney(allocations[0].amount, amount, "allocation amount must match payment");
}

export async function assertOrderActivity(
  db: PrismaClient,
  input: {
    orderId: string;
    title: string;
    userId?: string | null;
  }
): Promise<void> {
  const activity = await db.orderActivity.findFirst({
    where: {
      orderId: input.orderId,
      title: input.title,
      ...(input.userId === undefined ? {} : { userId: input.userId }),
    },
    select: { id: true },
  });

  assert.ok(
    activity,
    `expected order activity "${input.title}" for order ${input.orderId}`
  );
}

export async function assertNoFinancialRecordsForBooking(
  db: PrismaClient,
  bookingId: string
): Promise<void> {
  const [financialCases, invoices, payments] = await Promise.all([
    db.financialCase.count({ where: { bookingId } }),
    db.invoice.count({ where: { bookingId } }),
    db.payment.count({ where: { invoice: { bookingId } } }),
  ]);

  assert.equal(financialCases, 0, "pending booking must not create FinancialCase");
  assert.equal(invoices, 0, "pending booking must not create Invoice");
  assert.equal(payments, 0, "pending booking must not create Payment");
}

export async function assertAuditLogModelUnavailable(
  db: PrismaClient,
  workflow: string
): Promise<void> {
  const maybeAuditClient = db as PrismaClient & { auditLog?: unknown };
  assert.equal(
    maybeAuditClient.auditLog,
    undefined,
    `${workflow} expected the current architecture to lack a first-class AuditLog model`
  );
}

export async function expectRejectsWithoutPartialWrites(
  action: () => Promise<unknown>,
  snapshot: () => Promise<unknown>,
  message: RegExp
): Promise<void> {
  const before = await snapshot();
  await assert.rejects(action, message);
  const after = await snapshot();
  assert.deepEqual(after, before, "failed workflow must roll back partial writes");
}
