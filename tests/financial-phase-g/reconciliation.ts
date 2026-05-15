import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  InvoiceStatus,
  InvoiceType,
  PaymentDirection,
  PaymentMethod,
  PaymentType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  buildReconciliationAlertMessages,
  executeFinancialReconciliation,
  postReconciliationAlerts,
  runInReadOnlyReconciliationTransaction,
  type ReconciliationAlertPayload,
} from "@/modules/financial/reconciliation.service";

export async function runPhaseGFinancialReconciliation(
  db: PrismaClient
): Promise<void> {
  const runAt = new Date("2026-05-15T02:00:00.000Z");
  const cleanReport = await executeFinancialReconciliation(db, { runAt });

  assert.ok(cleanReport.invoicesChecked > 0, "reconciliation should read real invoices");
  assert.ok(cleanReport.paymentsChecked > 0, "reconciliation should read real payments");
  assert.ok(
    cleanReport.allocationsChecked > 0,
    "reconciliation should read real payment allocations"
  );
  assert.equal(cleanReport.status, cleanReport.violations.length === 0 ? "PASSED" : "VIOLATIONS_DETECTED");

  const corruptFixture = await seedReconciliationRiskFixture(db);
  const riskReport = await executeFinancialReconciliation(db, { runAt });

  assertViolation(
    riskReport,
    "INV-01",
    "CRITICAL",
    corruptFixture.unallocatedPaymentId
  );
  assertViolation(
    riskReport,
    "INV-08",
    "HIGH",
    corruptFixture.chainedAdjustmentInvoiceId
  );
  assertViolation(
    riskReport,
    "INV-PREFIX",
    "MEDIUM",
    corruptFixture.chainedAdjustmentInvoiceId
  );

  const messages = buildReconciliationAlertMessages(riskReport, "#studio-alerts");
  assert.ok(
    messages.some((message) => message.text.includes("CRITICAL reconciliation")),
    "critical violations should page on-call"
  );
  assert.ok(
    messages.some((message) => message.text.includes("HIGH reconciliation")),
    "high violations should alert for 24h investigation"
  );
  assert.ok(
    messages.some((message) => message.text.includes("MEDIUM reconciliation")),
    "medium violations should alert for 48h investigation"
  );

  const postedAlerts: ReconciliationAlertPayload[] = [];
  await postReconciliationAlerts(
    riskReport,
    async (payload) => {
      postedAlerts.push(payload);
    },
    "#studio-alerts"
  );
  assert.equal(postedAlerts.length, messages.length);
  assert.ok(postedAlerts.every((payload) => payload.channel === "#studio-alerts"));

  await assertReadOnlyTransactionRejectsWrites(db, corruptFixture.parentAdjustmentInvoiceId);
}

async function seedReconciliationRiskFixture(db: PrismaClient): Promise<{
  unallocatedPaymentId: string;
  parentAdjustmentInvoiceId: string;
  chainedAdjustmentInvoiceId: string;
}> {
  const sourceInvoice = await db.invoice.findFirst({
    where: { invoiceType: InvoiceType.FINAL },
    select: {
      id: true,
      financialCaseId: true,
      jobId: true,
      jobNumber: true,
      orderId: true,
      bookingId: true,
      customerId: true,
    },
    orderBy: { createdAt: "asc" },
  });
  assert.ok(sourceInvoice, "Phase G reconciliation fixture requires a FINAL invoice");

  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const unallocatedPayment = await db.payment.create({
    data: {
      publicId: `PAY-RECON-${suffix}`,
      financialCaseId: sourceInvoice.financialCaseId,
      jobId: sourceInvoice.jobId,
      jobNumber: sourceInvoice.jobNumber,
      invoiceId: sourceInvoice.id,
      amount: new Prisma.Decimal("1.000"),
      direction: PaymentDirection.IN,
      method: PaymentMethod.CASH,
      paymentType: PaymentType.FINAL,
      paidAt: new Date("2026-05-15T00:00:00.000Z"),
      notes: "Phase G fixture: deliberately missing allocation",
    },
    select: { id: true },
  });

  const parentAdjustment = await db.invoice.create({
    data: {
      publicId: `INV-RECON-PARENT-${suffix}`,
      financialCaseId: sourceInvoice.financialCaseId,
      invoiceType: InvoiceType.ADJUSTMENT,
      jobId: sourceInvoice.jobId,
      jobNumber: sourceInvoice.jobNumber,
      orderId: sourceInvoice.orderId,
      bookingId: sourceInvoice.bookingId,
      customerId: sourceInvoice.customerId,
      invoiceNumber: `ADJ-RECON-${suffix}`,
      totalAmount: new Prisma.Decimal("1.000"),
      remainingAmount: new Prisma.Decimal("1.000"),
      status: InvoiceStatus.DRAFT,
      parentInvoiceId: sourceInvoice.id,
      notes: "Phase G fixture: parent adjustment",
    },
    select: { id: true },
  });

  const chainedAdjustment = await db.invoice.create({
    data: {
      publicId: `INV-RECON-CHAIN-${suffix}`,
      financialCaseId: sourceInvoice.financialCaseId,
      invoiceType: InvoiceType.ADJUSTMENT,
      jobId: sourceInvoice.jobId,
      jobNumber: sourceInvoice.jobNumber,
      orderId: sourceInvoice.orderId,
      bookingId: sourceInvoice.bookingId,
      customerId: sourceInvoice.customerId,
      invoiceNumber: `WRONG-RECON-${suffix}`,
      totalAmount: new Prisma.Decimal("1.000"),
      remainingAmount: new Prisma.Decimal("1.000"),
      status: InvoiceStatus.DRAFT,
      parentInvoiceId: parentAdjustment.id,
      notes: "Phase G fixture: deliberately chained adjustment with bad prefix",
    },
    select: { id: true },
  });

  return {
    unallocatedPaymentId: unallocatedPayment.id,
    parentAdjustmentInvoiceId: parentAdjustment.id,
    chainedAdjustmentInvoiceId: chainedAdjustment.id,
  };
}

function assertViolation(
  report: Awaited<ReturnType<typeof executeFinancialReconciliation>>,
  invariantId: string,
  severity: string,
  entityId: string
): void {
  const match = report.violations.find(
    (violation) =>
      violation.invariantId === invariantId &&
      violation.severity === severity &&
      violation.affectedEntityIds.includes(entityId)
  );
  assert.ok(
    match,
    `${invariantId} ${severity} violation should include entity ${entityId}`
  );
}

async function assertReadOnlyTransactionRejectsWrites(
  db: PrismaClient,
  invoiceId: string
): Promise<void> {
  const before = await db.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { notes: true },
  });

  await assert.rejects(
    () =>
      runInReadOnlyReconciliationTransaction(db, async (tx) => {
        await tx.invoice.update({
          where: { id: invoiceId },
          data: { notes: "Phase G attempted read-only mutation" },
        });
      }),
    /read-only transaction|cannot execute UPDATE/i
  );

  const after = await db.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { notes: true },
  });
  assert.equal(after.notes, before.notes, "read-only reconciliation must not mutate data");
}
