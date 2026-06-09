import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Module from "node:module";
import process from "node:process";
import test from "node:test";
import {
  CreditOrigin,
  DocumentApplicationKind,
  InvoiceLineType,
  InvoiceStatus,
  InvoiceType,
  OrderStatus,
  PaymentMethod,
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
          createCreditNote,
          settleAvailableCreditAgainstOpenReceivables,
        },
        { issueRefundWithPayment },
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
        import("@/modules/refunds/refund.service"),
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
            creditOrigin: true,
            reversesInvoiceLineId: true,
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
          DocumentApplicationKind.SETTLEMENT
        );
        assert.equal(normalCreditNote.creditOrigin, CreditOrigin.GOODWILL);
        assert.equal(normalCreditNote.reversesInvoiceLineId, null);
        assert.equal(
          normalCreditNote.documentApplicationsAsSource[0]?.amountApplied.toFixed(3),
          "20.000"
        );
        assert.equal(
          (await computeCreditNoteAvailable(normalCreditNote.id, db)).toFixed(3),
          "0.000"
        );

        const fixture = await makeCashDepositBookingFixture(db);
        const manager = await db.user.upsert({
          where: { email: "credit-note-pool-manager@example.com" },
          update: { name: "Credit Note Pool Manager", role: "MANAGER" },
          create: {
            name: "Credit Note Pool Manager",
            email: "credit-note-pool-manager@example.com",
            role: "MANAGER",
          },
        });
        const suffix = randomUUID().slice(0, 8);
        const syntheticOrder = await db.order.create({
          data: {
            publicId: `ORD-CN-POOL-${suffix}`,
            jobNumber: `JOB-CN-POOL-${suffix}`,
            jobId: fixture.jobId,
            bookingId: fixture.bookingId,
            customerId: fixture.customerId,
            status: OrderStatus.WAITING_SELECTION,
          },
        });
        const packageTemplate = await db.package.findFirstOrThrow({
          select: {
            id: true,
            name: true,
            price: true,
            photoCount: true,
            packageFamily: { select: { sessionTypeId: true } },
          },
        });
        await db.orderPackage.create({
          data: {
            orderId: syntheticOrder.id,
            originalPackageId: packageTemplate.id,
            currentPackageId: packageTemplate.id,
            sessionTypeId: packageTemplate.packageFamily.sessionTypeId,
            originalPackageNameSnapshot: packageTemplate.name,
            currentPackageNameSnapshot: packageTemplate.name,
            originalPackagePriceSnapshot: packageTemplate.price,
            finalPackagePriceSnapshot: packageTemplate.price,
            selectedPhotoCount: packageTemplate.photoCount,
          },
        });
        const fixtureWithOrder = { ...fixture, orderId: syntheticOrder.id };
        const fixtureWithManager = { ...fixture, managerId: manager.id };
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
        assert.equal(finalInvoice.creditOrigin, null);
        assert.equal(finalInvoice.reversesInvoiceLineId, null);
        await applyDepositToFinalIfPresent(
          fixture.financialCaseId,
          finalInvoice.id,
          db
        );
        const depositRecalculatedFinal = await db.invoice.findUniqueOrThrow({
          where: { id: finalInvoice.id },
          select: { remainingAmount: true, status: true },
        });
        assert.equal(
          depositRecalculatedFinal.remainingAmount.toFixed(3),
          "80.000"
        );
        assert.equal(depositRecalculatedFinal.status, InvoiceStatus.PARTIAL);
        await db.invoice.update({
          where: { id: finalInvoice.id },
          data: {
            remainingAmount: new Prisma.Decimal(100),
            status: InvoiceStatus.ISSUED,
          },
        });
        const staleCacheViolations = await runAllInvariants(db);
        assert.ok(
          staleCacheViolations.some(
            (violation) =>
              violation.invariant ===
              "charge-invoice-remaining-matches-derived" &&
              violation.entityId === finalInvoice.id
          )
        );
        await db.invoice.update({
          where: { id: finalInvoice.id },
          data: {
            remainingAmount: new Prisma.Decimal(80),
            status: InvoiceStatus.PARTIAL,
          },
        });

        const [firstAdjustment, secondAdjustment] = await Promise.all([
          createSyntheticAdjustment(db, fixture, finalInvoice.id, "A", suffix, 20),
          createSyntheticAdjustment(db, fixture, finalInvoice.id, "B", suffix, 5),
        ]);
        const unappliedCreditNote = await createSyntheticCreditNote(
          db,
          recordInvoiceLockSnapshot,
          fixtureWithManager,
          finalInvoice.id,
          `unapplied-${suffix}`,
          7
        );
        assert.equal(
          (await computeCreditNoteAvailable(unappliedCreditNote.id, db)).toFixed(3),
          "7.000"
        );
        assert.deepEqual(await runAllInvariants(db), []);

        const partialCreditNote = await createSyntheticCreditNote(
          db,
          recordInvoiceLockSnapshot,
          fixtureWithManager,
          finalInvoice.id,
          suffix,
          30
        );
        await appendCreditApplication(
          {
            creditNoteId: partialCreditNote.id,
            targetInvoiceId: finalInvoice.id,
            kind: DocumentApplicationKind.SETTLEMENT,
            amount: new Prisma.Decimal(10),
            appliedByUserId: manager.id,
          },
          db
        );

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
            appliedByUserId: manager.id,
            notes: "Spec 153 synthetic settlement draw",
          },
          db
        );
        assert.equal(
          (await computeCreditNoteAvailable(partialCreditNote.id, db)).toFixed(3),
          "5.000"
        );
        const partiallySettledAdjustment = await db.invoice.findUniqueOrThrow({
          where: { id: firstAdjustment.id },
          select: { remainingAmount: true, status: true, isLocked: true },
        });
        assert.equal(
          partiallySettledAdjustment.remainingAmount.toFixed(3),
          "5.000"
        );
        assert.equal(partiallySettledAdjustment.status, InvoiceStatus.PARTIAL);
        assert.equal(partiallySettledAdjustment.isLocked, false);

        await appendCreditApplication(
          {
            creditNoteId: partialCreditNote.id,
            targetInvoiceId: secondAdjustment.id,
            amount: new Prisma.Decimal(5),
            kind: DocumentApplicationKind.SETTLEMENT,
            appliedByUserId: manager.id,
            notes: "Spec 153 synthetic settlement draw",
          },
          db
        );
        assert.equal(
          (await computeCreditNoteAvailable(partialCreditNote.id, db)).toFixed(3),
          "0.000"
        );
        const fullySettledAdjustment = await db.invoice.findUniqueOrThrow({
          where: { id: secondAdjustment.id },
          select: { remainingAmount: true, status: true, isLocked: true },
        });
        assert.equal(fullySettledAdjustment.remainingAmount.toFixed(3), "0.000");
        assert.equal(fullySettledAdjustment.status, InvoiceStatus.CLOSED);
        assert.equal(fullySettledAdjustment.isLocked, true);

        const [firstBulkTarget, secondBulkTarget] = await Promise.all([
          createSyntheticAdjustment(db, fixture, finalInvoice.id, "BULK-A", suffix, 6),
          createSyntheticAdjustment(db, fixture, finalInvoice.id, "BULK-B", suffix, 4),
        ]);
        const [firstBulkLine, secondBulkLine] = await Promise.all([
          createSyntheticAdjustmentLine(db, firstBulkTarget.id, "Bulk target A", 6),
          createSyntheticAdjustmentLine(db, secondBulkTarget.id, "Bulk target B", 4),
        ]);
        await assert.rejects(
          () =>
            createCreditNote(
              {
                targetAdjustmentInvoiceId: firstBulkTarget.id,
                reason: "Spec 163 retired line-targeted credit",
                createdByUserId: manager.id,
                lines: [
                  {
                    description: "Bulk target A reversal",
                    quantity: 1,
                    unitPrice: new Prisma.Decimal(6),
                    targetInvoiceId: firstBulkTarget.id,
                    targetInvoiceLineId: firstBulkLine.id,
                  },
                  {
                    description: "Bulk target B reversal",
                    quantity: 1,
                    unitPrice: new Prisma.Decimal(4),
                    targetInvoiceId: secondBulkTarget.id,
                    targetInvoiceLineId: secondBulkLine.id,
                  },
                ],
              },
              db
            ),
          /Line-targeted credit note applications are retired/
        );

        const removalCreditNote = await createCreditNote(
          {
            targetFinalInvoiceId: normalCreditFixture.finalInvoiceId,
            reason: "Spec 159 residual removal credit",
            createdByUserId: manager.id,
            lines: [
              {
                description: "Residual removal credit",
                quantity: 1,
                unitPrice: new Prisma.Decimal(3),
              },
            ],
            applicationMode: "UNAPPLIED",
            creditOrigin: CreditOrigin.REMOVAL,
          },
          db
        );
        const storedRemovalCreditNote = await db.invoice.findUniqueOrThrow({
          where: { id: removalCreditNote.id },
          select: {
            creditOrigin: true,
            reversesInvoiceLineId: true,
            documentApplicationsAsSource: true,
          },
        });
        assert.equal(storedRemovalCreditNote.creditOrigin, CreditOrigin.REMOVAL);
        assert.equal(storedRemovalCreditNote.reversesInvoiceLineId, null);
        assert.equal(storedRemovalCreditNote.documentApplicationsAsSource.length, 0);

        const drawableReversalCreditNote = await createCreditNote(
          {
            targetAdjustmentInvoiceId: firstBulkTarget.id,
            reason: "Spec 161 drawable reversal credit",
            createdByUserId: manager.id,
            lines: [
              {
                description: "Drawable reversal",
                quantity: 1,
                unitPrice: new Prisma.Decimal(2),
              },
            ],
            applicationMode: "UNAPPLIED",
            creditOrigin: CreditOrigin.REVERSAL,
            reversesInvoiceLineId: firstBulkLine.id,
          },
          db
        );
        const storedDrawableReversal = await db.invoice.findUniqueOrThrow({
          where: { id: drawableReversalCreditNote.id },
          select: {
            creditOrigin: true,
            reversesInvoiceLineId: true,
            documentApplicationsAsSource: true,
          },
        });
        assert.equal(storedDrawableReversal.creditOrigin, CreditOrigin.REVERSAL);
        assert.equal(storedDrawableReversal.reversesInvoiceLineId, firstBulkLine.id);
        assert.equal(storedDrawableReversal.documentApplicationsAsSource.length, 0);
        assert.equal(
          (await computeCreditNoteAvailable(drawableReversalCreditNote.id, db)).toFixed(3),
          "2.000"
        );

        await assert.rejects(
          () =>
            issueRefundWithPayment(
              {
                sourceInvoiceId: drawableReversalCreditNote.id,
                amount: new Prisma.Decimal("1.250"),
                reason: "Spec 164 unpaid-origin credit-note refund",
                createdByUserId: manager.id,
                method: PaymentMethod.CASH,
              },
              db
            ),
          /credit note refundable balance 0\.000 KD/
        );
        assert.equal(
          (await computeCreditNoteAvailable(drawableReversalCreditNote.id, db)).toFixed(3),
          "2.000"
        );

        await assert.rejects(
          () =>
            issueRefundWithPayment(
              {
                sourceInvoiceId: drawableReversalCreditNote.id,
                amount: new Prisma.Decimal("0.751"),
                reason: "Spec 162 over-cap credit-note refund",
                createdByUserId: manager.id,
                method: PaymentMethod.CASH,
              },
              db
            ),
          /credit note refundable balance 0\.000 KD/
        );

        const interleavedCreditNote = await db.invoice.create({
          data: {
            publicId: `INV-CN-POOL-R3-CN-${suffix}`,
            invoiceNumber: `INV-CN-POOL-R3-CN-${suffix}`,
            financialCaseId: fixture.financialCaseId,
            invoiceType: InvoiceType.CREDIT_NOTE,
            jobId: fixture.jobId,
            bookingId: fixture.bookingId,
            orderId: fixtureWithOrder.orderId,
            customerId: fixture.customerId,
            parentInvoiceId: finalInvoice.id,
            totalAmount: new Prisma.Decimal(10),
            paidAmount: new Prisma.Decimal(0),
            remainingAmount: new Prisma.Decimal(0),
            status: InvoiceStatus.CLOSED,
            isLocked: true,
            creditOrigin: CreditOrigin.REVERSAL,
            reversesInvoiceLineId: firstBulkLine.id,
            issuedAt: new Date(),
            closedAt: new Date(),
            lineItems: {
              create: [
                {
                  lineType: InvoiceLineType.MANUAL_DISCOUNT,
                  description: "Interleaved drawable reversal",
                  quantity: 1,
                  unitPrice: new Prisma.Decimal(10),
                  lineTotal: new Prisma.Decimal(10),
                  sortOrder: 0,
                },
              ],
            },
          },
        });
        await recordInvoiceLockSnapshot(db, interleavedCreditNote, manager.id);
        await appendCreditApplication(
          {
            creditNoteId: interleavedCreditNote.id,
            targetInvoiceId: firstAdjustment.id,
            amount: new Prisma.Decimal(4),
            kind: DocumentApplicationKind.SETTLEMENT,
            appliedByUserId: manager.id,
            notes: "Spec 162 settlement before refund",
          },
          db
        );
        assert.equal(
          (await computeCreditNoteAvailable(interleavedCreditNote.id, db)).toFixed(3),
          "6.000"
        );
        const laterAdjustment = await createSyntheticAdjustment(
          db,
          fixtureWithOrder,
          finalInvoice.id,
          "POST-REFUND",
          suffix,
          5
        );
        assert.equal(
          await db.invoice.count({
            where: {
              financialCaseId: fixture.financialCaseId,
              orderId: fixtureWithOrder.orderId,
              invoiceType: InvoiceType.CREDIT_NOTE,
            },
          }),
          1
        );
        assert.equal(
          await db.invoice.count({
            where: {
              financialCaseId: fixture.financialCaseId,
              orderId: fixtureWithOrder.orderId,
              invoiceType: InvoiceType.ADJUSTMENT,
              id: laterAdjustment.id,
            },
          }),
          1
        );
        await settleAvailableCreditAgainstOpenReceivables(
          {
            financialCaseId: fixture.financialCaseId,
            orderId: fixtureWithOrder.orderId,
            appliedByUserId: manager.id,
            notes: "Spec 162 post-refund sweep",
          },
          db
        );
        assert.equal(
          (await computeCreditNoteAvailable(interleavedCreditNote.id, db)).toFixed(3),
          "1.000"
        );
        const laterAdjustmentAfterSweep = await db.invoice.findUniqueOrThrow({
          where: { id: laterAdjustment.id },
          select: { remainingAmount: true },
        });
        assert.equal(laterAdjustmentAfterSweep.remainingAmount.toFixed(3), "0.000");

        await assert.rejects(
          () =>
            createCreditNote(
              {
                targetAdjustmentInvoiceId: firstBulkTarget.id,
                reason: "Invalid drawable reversal without provenance",
                createdByUserId: manager.id,
                lines: [
                  {
                    description: "Missing provenance",
                    quantity: 1,
                    unitPrice: new Prisma.Decimal(2),
                  },
                ],
                applicationMode: "UNAPPLIED",
                creditOrigin: CreditOrigin.REVERSAL,
              },
              db
            ),
          /Adjustment credit notes require line-targeted applications/
        );
        await assert.rejects(
          () =>
            createCreditNote(
              {
                targetAdjustmentInvoiceId: firstBulkTarget.id,
                reason: "Invalid unapplied adjustment goodwill",
                createdByUserId: manager.id,
                lines: [
                  {
                    description: "Invalid goodwill",
                    quantity: 1,
                    unitPrice: new Prisma.Decimal(2),
                  },
                ],
                applicationMode: "UNAPPLIED",
                creditOrigin: CreditOrigin.GOODWILL,
              },
              db
            ),
          /Adjustment credit notes require line-targeted applications/
        );

        const refreshedBulkTargets = await db.invoice.findMany({
          where: { id: { in: [firstBulkTarget.id, secondBulkTarget.id] } },
          select: { id: true, remainingAmount: true, status: true, isLocked: true },
          orderBy: { invoiceNumber: "asc" },
        });
        assert.deepEqual(
          refreshedBulkTargets.map((invoice) => ({
            remainingAmount: invoice.remainingAmount.toFixed(3),
            status: invoice.status,
            isLocked: invoice.isLocked,
          })),
          [
            {
              remainingAmount: "6.000",
              status: InvoiceStatus.ISSUED,
              isLocked: false,
            },
            {
              remainingAmount: "4.000",
              status: InvoiceStatus.ISSUED,
              isLocked: false,
            },
          ]
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

        const overdrawnCreditNote = await createSyntheticCreditNote(
          db,
          recordInvoiceLockSnapshot,
          fixtureWithManager,
          finalInvoice.id,
          `overdrawn-${suffix}`,
          10
        );
        await db.documentApplication.createMany({
          data: [
            {
              sourceInvoiceId: overdrawnCreditNote.id,
              targetInvoiceId: finalInvoice.id,
              kind: DocumentApplicationKind.SETTLEMENT,
              amountApplied: new Prisma.Decimal(6),
              appliedByUserId: manager.id,
            },
            {
              sourceInvoiceId: overdrawnCreditNote.id,
              targetInvoiceId: secondAdjustment.id,
              kind: DocumentApplicationKind.SETTLEMENT,
              amountApplied: new Prisma.Decimal(5),
              appliedByUserId: manager.id,
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
    orderId?: string | null;
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
      orderId: fixture.orderId ?? null,
      customerId: fixture.customerId,
      parentInvoiceId: finalInvoiceId,
      totalAmount: new Prisma.Decimal(amount),
      remainingAmount: new Prisma.Decimal(amount),
      status: InvoiceStatus.ISSUED,
    },
  });
}

async function createSyntheticAdjustmentLine(
  db: PrismaClient,
  invoiceId: string,
  description: string,
  amount: number
) {
  return db.invoiceLineItem.create({
    data: {
      invoiceId,
      lineType: InvoiceLineType.ADD_ON,
      description,
      quantity: 1,
      unitPrice: new Prisma.Decimal(amount),
      lineTotal: new Prisma.Decimal(amount),
      sortOrder: 0,
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
    orderId?: string | null;
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
      orderId: fixture.orderId ?? null,
      customerId: fixture.customerId,
      parentInvoiceId: finalInvoiceId,
      totalAmount: new Prisma.Decimal(amount),
      paidAmount: new Prisma.Decimal(0),
      remainingAmount: new Prisma.Decimal(0),
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      creditOrigin: CreditOrigin.GOODWILL,
      issuedAt: new Date(),
      closedAt: new Date(),
    },
  });
  await recordInvoiceLockSnapshot(db, creditNote, fixture.managerId);
  return creditNote;
}
