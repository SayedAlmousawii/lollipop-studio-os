import assert from "node:assert/strict";
import {
  InvoiceLineType,
  PaymentDirection,
  PaymentMethod,
  PaymentType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { runAllInvariants } from "@/modules/financial/invariants";
import {
  createAdjustmentInvoice,
  createCreditNote,
  createInvoiceForOrderWithClient,
  createRefundInvoice,
} from "@/modules/invoices/invoice.service";
import { generatePublicId } from "@/modules/identifiers/identifier.service";
import {
  PUBLIC_ID_KIND,
  WORKFLOW_REFERENCE_KIND,
} from "@/modules/identifiers/identifier.constants";
import { generateBookingReference } from "@/modules/identifiers/identifier.service";
import {
  buildCheckedInWorkflowFixture,
  buildConfirmedBookingFixture,
  buildFinalInvoiceWorkflowFixture,
  buildLockedFinalInvoiceWorkflowFixture,
  buildPendingBookingFixture,
  seedPhaseFFixtures,
  type PhaseFFixtures,
} from "./fixtures";
import { expectRejectsWithoutPartialWrites } from "../financial-phase-b/assertions";

type CaseRunner = {
  id: string;
  run: (db: PrismaClient, fixtures: PhaseFFixtures) => Promise<void>;
};

type FinancialSnapshot = {
  booking: unknown;
  financialCaseCount: number;
  invoiceCount: number;
  paymentCount: number;
  allocationCount: number;
  applicationCount: number;
  orderCount: number;
  jobCount: number;
};

export async function runPhaseFFailureRecoverySuite(
  db: PrismaClient,
  fixtures?: PhaseFFixtures
): Promise<void> {
  const activeFixtures = fixtures ?? (await seedPhaseFFixtures(db));
  const cases: CaseRunner[] = [
    { id: "F-REC-01", run: runBookingConfirmationRollbackAfterReference },
    { id: "F-REC-02", run: runCheckInRollbackAfterJobCreation },
    { id: "F-REC-03", run: runFinalInvoiceRollbackAfterDocumentApplication },
    { id: "F-REC-04", run: runPaymentChokePointRollback },
    { id: "F-REC-05", run: runMixedAdjustmentCreditNoteRollback },
    { id: "F-REC-06", run: runRefundRollbackAfterRefundInvoice },
  ];

  for (const testCase of cases) {
    await testCase.run(db, activeFixtures);
    const violations = await runAllInvariants(db);
    assert.deepEqual(violations, [], `${testCase.id} must leave no invariant violations`);
  }
}

async function runBookingConfirmationRollbackAfterReference(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const pending = await buildPendingBookingFixture(fixtures, "rec01");

  await expectRejectsWithoutPartialWrites(
    () =>
      db.$transaction(async (tx) => {
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: pending.bookingId },
          select: {
            id: true,
            customerId: true,
            sessionDate: true,
            department: { select: { code: true } },
          },
        });
        const bookingReference = await generateBookingReference(tx, {
          departmentCode: booking.department.code,
          sessionDate: booking.sessionDate,
        });
        await tx.booking.update({
          where: { id: booking.id },
          data: { publicId: bookingReference },
        });
        await tx.financialCase.create({
          data: { bookingId: booking.id, customerId: booking.customerId },
        });
        throw new Error("F-REC-01 injected failure after booking reference");
      }),
    () => financialSnapshot(db, pending.bookingId),
    /F-REC-01 injected failure/
  );
}

async function runCheckInRollbackAfterJobCreation(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const confirmed = await buildConfirmedBookingFixture(db, fixtures, "rec02");

  await expectRejectsWithoutPartialWrites(
    () =>
      db.$transaction(async (tx) => {
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: confirmed.bookingId },
          select: {
            id: true,
            customerId: true,
            sessionDate: true,
            department: { select: { code: true } },
          },
        });
        const jobNumber = await generateBookingReference(tx, {
          departmentCode: booking.department.code,
          sessionDate: booking.sessionDate,
        });
        const job = await tx.job.create({
          data: {
            jobNumber: jobNumber.replace(
              WORKFLOW_REFERENCE_KIND.BOOKING,
              WORKFLOW_REFERENCE_KIND.JOB
            ),
            customerId: booking.customerId,
            assignedPhotographerId: fixtures.photographerId,
            socialMediaConsent: true,
          },
        });
        await tx.booking.update({
          where: { id: booking.id },
          data: { jobId: job.id, jobNumber: job.jobNumber },
        });
        throw new Error("F-REC-02 injected failure after job creation");
      }),
    () => financialSnapshot(db, confirmed.bookingId),
    /F-REC-02 injected failure/
  );
}

async function runFinalInvoiceRollbackAfterDocumentApplication(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const workflow = await buildCheckedInWorkflowFixture(db, fixtures, "rec03");

  await expectRejectsWithoutPartialWrites(
    () =>
      db.$transaction(async (tx) => {
        await createInvoiceForOrderWithClient(tx, workflow.orderId, fixtures.adminActor);
        throw new Error("F-REC-03 injected failure after final invoice creation");
      }),
    () => financialSnapshot(db, workflow.bookingId),
    /F-REC-03 injected failure/
  );
}

async function runPaymentChokePointRollback(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const workflow = await buildFinalInvoiceWorkflowFixture(db, fixtures, "rec04", {
    issue: true,
  });

  await expectRejectsWithoutPartialWrites(
    () =>
      db.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: workflow.finalInvoiceId },
          select: {
            id: true,
            financialCaseId: true,
            jobId: true,
            jobNumber: true,
          },
        });
        await tx.payment.create({
          data: {
            publicId: await generatePublicId(tx, PUBLIC_ID_KIND.PAYMENT),
            financialCaseId: invoice.financialCaseId,
            jobId: invoice.jobId,
            jobNumber: invoice.jobNumber,
            invoiceId: invoice.id,
            amount: new Prisma.Decimal(10),
            direction: PaymentDirection.IN,
            method: PaymentMethod.CASH,
            paymentType: PaymentType.FINAL,
          },
        });
        throw new Error("F-REC-04 injected failure after payment creation");
      }),
    () => financialSnapshot(db, workflow.bookingId),
    /F-REC-04 injected failure/
  );
}

async function runMixedAdjustmentCreditNoteRollback(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "rec05");

  await expectRejectsWithoutPartialWrites(
    () =>
      db.$transaction(async (tx) => {
        await createAdjustmentInvoice(
          {
            parentFinalInvoiceId: workflow.finalInvoiceId,
            lines: [
              {
                lineType: InvoiceLineType.ADD_ON,
                description: "F-REC-05 paired adjustment",
                quantity: 1,
                unitPrice: 25,
              },
            ],
            createdByUserId: fixtures.managerId,
          },
          tx
        );
        await createCreditNote(
          {
            targetFinalInvoiceId: workflow.finalInvoiceId,
            lines: [{ description: "F-REC-05 paired credit", quantity: 1, unitPrice: 10 }],
            reason: "F-REC-05 paired rollback",
            createdByUserId: fixtures.managerId,
          },
          tx
        );
        throw new Error("F-REC-05 injected failure after mixed documents");
      }),
    () => financialSnapshot(db, workflow.bookingId),
    /F-REC-05 injected failure/
  );
}

async function runRefundRollbackAfterRefundInvoice(
  db: PrismaClient,
  fixtures: PhaseFFixtures
): Promise<void> {
  const workflow = await buildLockedFinalInvoiceWorkflowFixture(db, fixtures, "rec06");

  await expectRejectsWithoutPartialWrites(
    () =>
      db.$transaction(async (tx) => {
        await createRefundInvoice(
          {
            sourceInvoiceId: workflow.finalInvoiceId,
            amount: 10,
            reason: "F-REC-06 refund rollback",
            createdByUserId: fixtures.managerId,
          },
          tx
        );
        throw new Error("F-REC-06 injected failure after refund invoice");
      }),
    () => financialSnapshot(db, workflow.bookingId),
    /F-REC-06 injected failure/
  );
}

async function financialSnapshot(
  db: PrismaClient,
  bookingId: string
): Promise<FinancialSnapshot> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      publicId: true,
      status: true,
      jobId: true,
      jobNumber: true,
      financialCase: { select: { id: true } },
      order: { select: { id: true } },
    },
  });
  const financialCaseId = booking?.financialCase?.id;
  const invoiceIds = financialCaseId
    ? (
        await db.invoice.findMany({
          where: { financialCaseId },
          select: { id: true },
        })
      ).map((invoice) => invoice.id)
    : [];

  const [
    financialCaseCount,
    invoiceCount,
    paymentCount,
    allocationCount,
    applicationCount,
    orderCount,
    jobCount,
  ] = await Promise.all([
    db.financialCase.count({ where: { bookingId } }),
    db.invoice.count({ where: { bookingId } }),
    db.payment.count({ where: financialCaseId ? { financialCaseId } : { id: "__none__" } }),
    db.paymentAllocation.count({
      where: {
        OR: [
          { invoiceId: { in: invoiceIds } },
          ...(financialCaseId ? [{ payment: { financialCaseId } }] : []),
        ],
      },
    }),
    db.documentApplication.count({
      where: {
        OR: [
          { sourceInvoiceId: { in: invoiceIds } },
          { targetInvoiceId: { in: invoiceIds } },
        ],
      },
    }),
    db.order.count({ where: { bookingId } }),
    db.job.count({ where: { booking: { id: bookingId } } }),
  ]);

  return {
    booking,
    financialCaseCount,
    invoiceCount,
    paymentCount,
    allocationCount,
    applicationCount,
    orderCount,
    jobCount,
  };
}
