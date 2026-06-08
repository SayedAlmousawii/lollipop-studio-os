import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Module from "node:module";
import process from "node:process";
import test from "node:test";
import {
  DocumentApplicationKind,
  InvoiceStatus,
  InvoiceType,
  Prisma,
  type Invoice,
  type PrismaClient,
} from "@prisma/client";
import { withIsolatedBackendInvariantSchema } from "../backend-invariants/harness";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;
moduleWithLoader._load = function loadWithServerOnlyShim(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalModuleLoad.call(this, request, parent, isMain);
};

test("credit-note available balance is derived from append-only applications", async () => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const [
        { db },
        {
          appendCreditApplication,
          applyDepositToFinalIfPresent,
          computeCreditNoteAvailable,
        },
        { runAllInvariants },
        { recordInvoiceLockSnapshot },
        {
          makeCashDepositBookingFixture,
          makeCreditNotedBookingFixture,
          seedAllSharedFixtures,
        },
      ] = await Promise.all([
        import("@/lib/db"),
        import("@/modules/invoices/invoice.service"),
        import("@/modules/financial/invariants"),
        import("@/modules/invoices/invoice-lock.service"),
        import("../fixtures/financial"),
      ]);

      try {
        await seedAllSharedFixtures(db);

        const normalCreditFixture = await makeCreditNotedBookingFixture(db);
        const normalCreditNote = await db.invoice.findUniqueOrThrow({
          where: { id: normalCreditFixture.creditNoteInvoiceId },
          select: {
            id: true,
            isLocked: true,
            remainingAmount: true,
            status: true,
            documentApplicationsAsSource: {
              select: { kind: true, amountApplied: true },
            },
          },
        });
        assert.equal(normalCreditNote.isLocked, true);
        assert.equal(normalCreditNote.status, InvoiceStatus.CLOSED);
        assert.equal(normalCreditNote.remainingAmount.toFixed(3), "0.000");
        assert.equal(
          normalCreditNote.documentApplicationsAsSource[0]?.kind,
          DocumentApplicationKind.CREDIT_TO_FINAL
        );
        assert.equal(
          normalCreditNote.documentApplicationsAsSource[0]?.amountApplied.toFixed(3),
          "20.000"
        );
        assert.equal(
          (await computeCreditNoteAvailable(normalCreditNote.id, db)).toFixed(3),
          "0.000"
        );

        const fixture = await makeCashDepositBookingFixture(db);
        const suffix = randomUUID().slice(0, 8);
        const finalInvoice = await db.invoice.create({
          data: {
            publicId: `INV-CN-POOL-FINAL-${suffix}`,
            invoiceNumber: `INV-CN-POOL-FINAL-${suffix}`,
            financialCaseId: fixture.financialCaseId,
            invoiceType: InvoiceType.FINAL,
            jobId: fixture.jobId,
            bookingId: fixture.bookingId,
            customerId: fixture.customerId,
            totalAmount: new Prisma.Decimal(100),
            remainingAmount: new Prisma.Decimal(100),
            status: InvoiceStatus.ISSUED,
          },
        });
        await applyDepositToFinalIfPresent(
          fixture.financialCaseId,
          finalInvoice.id,
          db
        );

        const [firstAdjustment, secondAdjustment] = await Promise.all([
          createSyntheticAdjustment(db, fixture, finalInvoice.id, "A", suffix, 15),
          createSyntheticAdjustment(db, fixture, finalInvoice.id, "B", suffix, 5),
        ]);
        const partialCreditNote = await createSyntheticCreditNote(
          db,
          recordInvoiceLockSnapshot,
          fixture,
          finalInvoice.id,
          suffix,
          30
        );
        await db.documentApplication.create({
          data: {
            sourceInvoiceId: partialCreditNote.id,
            targetInvoiceId: finalInvoice.id,
            kind: DocumentApplicationKind.CREDIT_TO_FINAL,
            amountApplied: new Prisma.Decimal(10),
            appliedByUserId: fixture.managerId,
          },
        });

        assert.equal(
          (await computeCreditNoteAvailable(partialCreditNote.id, db)).toFixed(3),
          "20.000"
        );
        assert.deepEqual(await runAllInvariants(db), []);

        await appendCreditApplication(
          {
            creditNoteId: partialCreditNote.id,
            targetInvoiceId: firstAdjustment.id,
            amount: new Prisma.Decimal(15),
            kind: DocumentApplicationKind.SETTLEMENT,
            appliedByUserId: fixture.managerId,
            notes: "Spec 153 synthetic settlement draw",
          },
          db
        );
        assert.equal(
          (await computeCreditNoteAvailable(partialCreditNote.id, db)).toFixed(3),
          "5.000"
        );

        await appendCreditApplication(
          {
            creditNoteId: partialCreditNote.id,
            targetInvoiceId: secondAdjustment.id,
            amount: new Prisma.Decimal(5),
            kind: DocumentApplicationKind.SETTLEMENT,
            appliedByUserId: fixture.managerId,
            notes: "Spec 153 synthetic settlement draw",
          },
          db
        );
        assert.equal(
          (await computeCreditNoteAvailable(partialCreditNote.id, db)).toFixed(3),
          "0.000"
        );

        const unchangedCreditNote = await db.invoice.findUniqueOrThrow({
          where: { id: partialCreditNote.id },
          select: { isLocked: true, remainingAmount: true, status: true },
        });
        assert.equal(unchangedCreditNote.isLocked, true);
        assert.equal(unchangedCreditNote.status, InvoiceStatus.CLOSED);
        assert.equal(unchangedCreditNote.remainingAmount.toFixed(3), "0.000");

        await assert.rejects(
          () =>
            appendCreditApplication(
              {
                creditNoteId: partialCreditNote.id,
                targetInvoiceId: firstAdjustment.id,
                amount: new Prisma.Decimal("0.001"),
                kind: DocumentApplicationKind.SETTLEMENT,
              },
              db
            ),
          /overdraw/
        );

        const invalidCreditNote = await createSyntheticCreditNote(
          db,
          recordInvoiceLockSnapshot,
          fixture,
          finalInvoice.id,
          `invalid-${suffix}`,
          5
        );
        const invalidApplication = await db.documentApplication.create({
          data: {
            sourceInvoiceId: invalidCreditNote.id,
            targetInvoiceId: firstAdjustment.id,
            kind: DocumentApplicationKind.CREDIT_TO_FINAL,
            amountApplied: new Prisma.Decimal(5),
            appliedByUserId: fixture.managerId,
          },
          select: { id: true },
        });
        const invalidShapeViolations = await runAllInvariants(db);
        assert.ok(
          invalidShapeViolations.some(
            (violation) =>
              violation.invariant === "adjustment-has-no-document-application" &&
              violation.entityType === "DocumentApplication" &&
              violation.entityId === invalidApplication.id
          )
        );

        await db.documentApplication.deleteMany({
          where: { sourceInvoiceId: invalidCreditNote.id },
        });
        await db.invoiceLockSnapshot.deleteMany({
          where: { invoiceId: invalidCreditNote.id },
        });
        await db.invoice.delete({ where: { id: invalidCreditNote.id } });

        const overdrawnCreditNote = await createSyntheticCreditNote(
          db,
          recordInvoiceLockSnapshot,
          fixture,
          finalInvoice.id,
          `overdrawn-${suffix}`,
          10
        );
        await db.documentApplication.createMany({
          data: [
            {
              sourceInvoiceId: overdrawnCreditNote.id,
              targetInvoiceId: finalInvoice.id,
              kind: DocumentApplicationKind.CREDIT_TO_FINAL,
              amountApplied: new Prisma.Decimal(6),
              appliedByUserId: fixture.managerId,
            },
            {
              sourceInvoiceId: overdrawnCreditNote.id,
              targetInvoiceId: secondAdjustment.id,
              kind: DocumentApplicationKind.SETTLEMENT,
              amountApplied: new Prisma.Decimal(5),
              appliedByUserId: fixture.managerId,
            },
          ],
        });
        const overdrawViolations = await runAllInvariants(db);
        assert.ok(
          overdrawViolations.some(
            (violation) =>
              violation.invariant === "credit-note-pool-not-over-applied" &&
              violation.entityId === overdrawnCreditNote.id
          )
        );
      } finally {
        await db.$disconnect();
      }
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});

async function createSyntheticAdjustment(
  db: PrismaClient,
  fixture: {
    financialCaseId: string;
    jobId: string;
    bookingId: string;
    customerId: string;
  },
  finalInvoiceId: string,
  label: string,
  suffix: string,
  amount: number
) {
  return db.invoice.create({
    data: {
      publicId: `INV-CN-POOL-ADJ-${label}-${suffix}`,
      invoiceNumber: `INV-CN-POOL-ADJ-${label}-${suffix}`,
      financialCaseId: fixture.financialCaseId,
      invoiceType: InvoiceType.ADJUSTMENT,
      jobId: fixture.jobId,
      bookingId: fixture.bookingId,
      customerId: fixture.customerId,
      parentInvoiceId: finalInvoiceId,
      totalAmount: new Prisma.Decimal(amount),
      remainingAmount: new Prisma.Decimal(amount),
      status: InvoiceStatus.ISSUED,
    },
  });
}

async function createSyntheticCreditNote(
  db: PrismaClient,
  recordInvoiceLockSnapshot: (
    client: PrismaClient,
    invoice: Invoice,
    lockedByUserId?: string | null
  ) => Promise<void>,
  fixture: {
    financialCaseId: string;
    jobId: string;
    bookingId: string;
    customerId: string;
    managerId: string;
  },
  finalInvoiceId: string,
  suffix: string,
  amount: number
) {
  const creditNote = await db.invoice.create({
    data: {
      publicId: `INV-CN-POOL-CN-${suffix}`,
      invoiceNumber: `INV-CN-POOL-CN-${suffix}`,
      financialCaseId: fixture.financialCaseId,
      invoiceType: InvoiceType.CREDIT_NOTE,
      jobId: fixture.jobId,
      bookingId: fixture.bookingId,
      customerId: fixture.customerId,
      parentInvoiceId: finalInvoiceId,
      totalAmount: new Prisma.Decimal(amount),
      paidAmount: new Prisma.Decimal(0),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      issuedAt: new Date(),
      closedAt: new Date(),
    },
  });
  await recordInvoiceLockSnapshot(db, creditNote, fixture.managerId);
  return creditNote;
}
