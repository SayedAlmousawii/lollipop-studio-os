import "dotenv/config";

import {
  AuditAction,
  AuditEntityType,
  InvoiceType,
  OrderActivityType,
  OrderEntityKind,
  Prisma,
} from "@prisma/client";
import process from "node:process";
import { db } from "@/lib/db";
import type { ActorContext } from "@/lib/auth/actor-context";
import { recordAuditLog } from "@/modules/audit/audit-log.service";
import { recalculateInvoiceStatus } from "@/modules/invoices/invoice.service";

const DEFAULT_ORDER_ID = "cmp6tm9n30007n7t3ramturmp";
const BACKFILL_REASON = "F6 backfill: pre-79a divergence";
const CREDIT_NOTE_ANNOTATION =
  "Pre-79a manual CREDIT_NOTE; classified as goodwill by F6 backfill.";

type BackfillArgs = {
  apply: boolean;
  orderId: string;
  actorUserId?: string;
};

type JsonRecord = Record<string, unknown>;

function parseArgs(): BackfillArgs {
  const args = process.argv.slice(2);
  const actorArg = args.find((arg) => arg.startsWith("--actor-user-id="));
  const orderArg = args.find((arg) => arg.startsWith("--order-id="));

  return {
    apply: args.includes("--apply"),
    orderId: orderArg?.split("=")[1]?.trim() || DEFAULT_ORDER_ID,
    actorUserId:
      actorArg?.split("=")[1]?.trim() ||
      process.env.BACKFILL_ACTOR_USER_ID?.trim(),
  };
}

function asRecord(value: Prisma.JsonValue | null): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function decimalEquals(left: Prisma.Decimal, right: Prisma.Decimal): boolean {
  return left.equals(right);
}

async function resolveActorContext(actorUserId: string): Promise<ActorContext> {
  const user = await db.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, role: true },
  });
  if (!user) {
    throw new Error(`Backfill actor user was not found: ${actorUserId}`);
  }
  return { actorUserId: user.id, actorRole: user.role };
}

async function buildBackfillSnapshot(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      bookingId: true,
      activities: {
        where: { type: OrderActivityType.ADD_ON_CHANGED },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          createdAt: true,
          metadata: true,
        },
      },
      invoices: {
        where: {
          invoiceType: {
            in: [InvoiceType.FINAL, InvoiceType.ADJUSTMENT, InvoiceType.CREDIT_NOTE],
          },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          financialCaseId: true,
          invoiceNumber: true,
          invoiceType: true,
          totalAmount: true,
          createdAt: true,
          notes: true,
          lineItems: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              description: true,
              lineTotal: true,
              causeOrderEntityKind: true,
              causeOrderEntityId: true,
            },
          },
          documentApplicationsAsSource: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              targetInvoiceId: true,
              targetInvoiceLineId: true,
              amountApplied: true,
              notes: true,
            },
          },
        },
      },
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} was not found`);
  }

  const adjustment = order.invoices.find(
    (invoice) =>
      invoice.invoiceType === InvoiceType.ADJUSTMENT &&
      invoice.invoiceNumber === "ADJ-00003"
  );
  const creditNote = order.invoices.find(
    (invoice) =>
      invoice.invoiceType === InvoiceType.CREDIT_NOTE &&
      invoice.invoiceNumber === "CN-00005"
  );
  const finalInvoice = order.invoices.find(
    (invoice) => invoice.invoiceType === InvoiceType.FINAL
  );

  if (!adjustment || !creditNote || !finalInvoice) {
    throw new Error("Expected INV-00002, ADJ-00003, and CN-00005 shape was not found");
  }

  const adjustmentLine = adjustment.lineItems.find((line) =>
    line.description.includes("Album 20x20")
  );
  if (!adjustmentLine) {
    throw new Error("ADJ-00003 Album 20x20 line was not found");
  }

  const historicalAddOnActivity = order.activities.find((activity) => {
    if (
      activity.title !== "Add-on removed" ||
      activity.createdAt <= adjustment.createdAt
    ) {
      return false;
    }
    const metadata = asRecord(activity.metadata);
    return (
      metadata.orderAddOnId &&
      metadata.productName === "Album 20x20" &&
      metadata.price === "45.000"
    );
  });
  const historicalAddOnId = asRecord(historicalAddOnActivity?.metadata ?? null)
    .orderAddOnId;
  if (typeof historicalAddOnId !== "string" || !historicalAddOnId.trim()) {
    throw new Error("Historical Album 20x20 add-on id could not be recovered");
  }

  return {
    order,
    financialCaseId: finalInvoice.financialCaseId,
    finalInvoice,
    adjustment,
    adjustmentLine,
    creditNote,
    historicalAddOnId,
  };
}

async function runDryRun(orderId: string): Promise<void> {
  const snapshot = await buildBackfillSnapshot(orderId);
  const reversalAmount = snapshot.adjustmentLine.lineTotal;
  const goodwillAmount = snapshot.creditNote.totalAmount.minus(reversalAmount);

  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        orderId,
        reason: BACKFILL_REASON,
        changes: {
          adjustmentLine: {
            id: snapshot.adjustmentLine.id,
            before: {
              causeOrderEntityKind: snapshot.adjustmentLine.causeOrderEntityKind,
              causeOrderEntityId: snapshot.adjustmentLine.causeOrderEntityId,
            },
            after: {
              causeOrderEntityKind: OrderEntityKind.ADDON,
              causeOrderEntityId: snapshot.historicalAddOnId,
            },
          },
          creditNote: {
            id: snapshot.creditNote.id,
            invoiceNumber: snapshot.creditNote.invoiceNumber,
            splitApplication: {
              lineTargetedReversalAmount: reversalAmount.toFixed(3),
              goodwillAmount: goodwillAmount.toFixed(3),
            },
            notesAnnotation: CREDIT_NOTE_ANNOTATION,
          },
        },
      },
      null,
      2
    )
  );
}

async function applyBackfill(
  orderId: string,
  actorContext: ActorContext
): Promise<number> {
  const snapshot = await buildBackfillSnapshot(orderId);
  const reversalAmount = snapshot.adjustmentLine.lineTotal;
  const goodwillAmount = snapshot.creditNote.totalAmount.minus(reversalAmount);
  if (goodwillAmount.lessThan(0)) {
    throw new Error("CN-00005 total is smaller than the ADJ-00003 reversal amount");
  }

  return db.$transaction(async (tx) => {
    let changedCount = 0;

    const currentAdjustmentLine = await tx.invoiceLineItem.findUniqueOrThrow({
      where: { id: snapshot.adjustmentLine.id },
      select: {
        id: true,
        invoiceId: true,
        causeOrderEntityKind: true,
        causeOrderEntityId: true,
      },
    });

    if (
      currentAdjustmentLine.causeOrderEntityKind !== OrderEntityKind.ADDON ||
      currentAdjustmentLine.causeOrderEntityId !== snapshot.historicalAddOnId
    ) {
      await tx.invoiceLineItem.update({
        where: { id: currentAdjustmentLine.id },
        data: {
          causeOrderEntityKind: OrderEntityKind.ADDON,
          causeOrderEntityId: snapshot.historicalAddOnId,
        },
      });
      await recordAuditLog(tx, actorContext, {
        entityType: AuditEntityType.INVOICE,
        entityId: snapshot.adjustment.id,
        action: AuditAction.INVOICE_TOTAL_MUTATED,
        before: {
          affectedInvoiceLineId: currentAdjustmentLine.id,
          causeOrderEntityKind: currentAdjustmentLine.causeOrderEntityKind,
          causeOrderEntityId: currentAdjustmentLine.causeOrderEntityId,
        },
        after: {
          affectedInvoiceLineId: currentAdjustmentLine.id,
          causeOrderEntityKind: OrderEntityKind.ADDON,
          causeOrderEntityId: snapshot.historicalAddOnId,
        },
        context: {
          reason: BACKFILL_REASON,
          orderId,
          financialCaseId: snapshot.financialCaseId,
        },
      });
      changedCount += 1;
    }

    const sourceApplications = await tx.documentApplication.findMany({
      where: { sourceInvoiceId: snapshot.creditNote.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        targetInvoiceId: true,
        targetInvoiceLineId: true,
        amountApplied: true,
        notes: true,
      },
    });
    const existingReversal = sourceApplications.find(
      (application) =>
        application.targetInvoiceId === snapshot.adjustment.id &&
        application.targetInvoiceLineId === snapshot.adjustmentLine.id &&
        decimalEquals(application.amountApplied, reversalAmount)
    );
    const existingGoodwill = sourceApplications.find(
      (application) =>
        application.targetInvoiceId === snapshot.finalInvoice.id &&
        application.targetInvoiceLineId === null &&
        decimalEquals(application.amountApplied, goodwillAmount)
    );

    if (!existingGoodwill) {
      const nullTargetApplication = sourceApplications.find(
        (application) =>
          application.targetInvoiceId === snapshot.finalInvoice.id &&
          application.targetInvoiceLineId === null
      );
      if (!nullTargetApplication) {
        throw new Error("CN-00005 goodwill DocumentApplication was not found");
      }
      await tx.documentApplication.update({
        where: { id: nullTargetApplication.id },
        data: {
          amountApplied: goodwillAmount,
          notes: CREDIT_NOTE_ANNOTATION,
          appliedByUserId: actorContext.actorUserId,
        },
      });
      await recordAuditLog(tx, actorContext, {
        entityType: AuditEntityType.CREDIT_NOTE,
        entityId: snapshot.creditNote.id,
        action: AuditAction.CREDIT_NOTE_ISSUED,
        before: {
          documentApplicationId: nullTargetApplication.id,
          targetInvoiceId: nullTargetApplication.targetInvoiceId,
          targetInvoiceLineId: nullTargetApplication.targetInvoiceLineId,
          amountApplied: nullTargetApplication.amountApplied.toFixed(3),
          notes: nullTargetApplication.notes,
        },
        after: {
          documentApplicationId: nullTargetApplication.id,
          targetInvoiceId: snapshot.finalInvoice.id,
          targetInvoiceLineId: null,
          amountApplied: goodwillAmount.toFixed(3),
          notes: CREDIT_NOTE_ANNOTATION,
        },
        context: {
          reason: BACKFILL_REASON,
          orderId,
          financialCaseId: snapshot.financialCaseId,
        },
      });
      changedCount += 1;
    }

    if (!existingReversal) {
      const createdApplication = await tx.documentApplication.create({
        data: {
          sourceInvoiceId: snapshot.creditNote.id,
          targetInvoiceId: snapshot.adjustment.id,
          targetInvoiceLineId: snapshot.adjustmentLine.id,
          amountApplied: reversalAmount,
          appliedByUserId: actorContext.actorUserId,
          notes: "F6 backfill adjustment reversal for ADJ-00003",
        },
        select: { id: true },
      });
      await recordAuditLog(tx, actorContext, {
        entityType: AuditEntityType.CREDIT_NOTE,
        entityId: snapshot.creditNote.id,
        action: AuditAction.CREDIT_NOTE_ISSUED,
        after: {
          documentApplicationId: createdApplication.id,
          targetInvoiceId: snapshot.adjustment.id,
          targetInvoiceLineId: snapshot.adjustmentLine.id,
          amountApplied: reversalAmount.toFixed(3),
          notes: "F6 backfill adjustment reversal for ADJ-00003",
        },
        context: {
          reason: BACKFILL_REASON,
          orderId,
          financialCaseId: snapshot.financialCaseId,
        },
      });
      changedCount += 1;
    }

    if (!snapshot.creditNote.notes?.includes(CREDIT_NOTE_ANNOTATION)) {
      const nextNotes = [snapshot.creditNote.notes, CREDIT_NOTE_ANNOTATION]
        .filter(Boolean)
        .join("\n");
      await tx.invoice.update({
        where: { id: snapshot.creditNote.id },
        data: { notes: nextNotes },
      });
      await recordAuditLog(tx, actorContext, {
        entityType: AuditEntityType.CREDIT_NOTE,
        entityId: snapshot.creditNote.id,
        action: AuditAction.CREDIT_NOTE_ISSUED,
        before: { notes: snapshot.creditNote.notes },
        after: { notes: nextNotes },
        context: {
          reason: BACKFILL_REASON,
          orderId,
          financialCaseId: snapshot.financialCaseId,
        },
      });
      changedCount += 1;
    }

    if (changedCount > 0) {
      await recalculateInvoiceStatus(snapshot.finalInvoice.id, tx);
      await recalculateInvoiceStatus(snapshot.adjustment.id, tx);
    }

    return changedCount;
  });
}

async function main() {
  const args = parseArgs();
  if (!args.apply) {
    await runDryRun(args.orderId);
    return;
  }

  if (!args.actorUserId) {
    throw new Error(
      "Pass --actor-user-id=<user id> or BACKFILL_ACTOR_USER_ID before running --apply"
    );
  }

  const actorContext = await resolveActorContext(args.actorUserId);
  const changedCount = await applyBackfill(args.orderId, actorContext);
  console.log(
    JSON.stringify(
      {
        mode: "apply",
        orderId: args.orderId,
        changedCount,
        idempotent: changedCount === 0,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("F6 INV-18 backfill failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
