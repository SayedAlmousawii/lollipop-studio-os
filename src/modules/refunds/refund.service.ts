import {
  AuditAction,
  AuditEntityType,
  InvoiceStatus,
  OrderActivityType,
  PaymentType,
  Prisma,
  UserRole,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { recordAuditLog } from "@/modules/audit/audit-log.service";
import { assertFinancialCaseInvariants } from "@/modules/financial/invariants";
import {
  invoiceLockSnapshotSelect,
  recordInvoiceLockSnapshot,
} from "@/modules/invoices/invoice-lock.service";
import {
  createRefundInvoice,
  recalculateInvoiceStatus,
} from "@/modules/invoices/invoice.service";
import type { CreateRefundWithPaymentInput } from "@/modules/invoices/invoice.schema";
import { recordOrderActivity } from "@/modules/orders/order-activity.service";
import { createPaymentWithAllocation } from "@/modules/payments/payment.service";

type DbClient = typeof db | Prisma.TransactionClient;

export async function issueRefundWithPayment(
  input: CreateRefundWithPaymentInput,
  tx?: DbClient
): Promise<{ refundInvoiceId: string; refundPaymentId: string }> {
  if (tx) {
    return issueRefundWithPaymentWithClient(input, tx);
  }

  return withRetry(
    () =>
      db.$transaction(
        (transaction) => issueRefundWithPaymentWithClient(input, transaction),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      ),
    "Failed to issue refund",
    3,
    isSerializableWriteConflict
  );
}

function isSerializableWriteConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

async function issueRefundWithPaymentWithClient(
  input: CreateRefundWithPaymentInput,
  client: DbClient
): Promise<{ refundInvoiceId: string; refundPaymentId: string }> {
  const auditActorContext = await getManagerAuditActorContext(
    client,
    input.createdByUserId
  );
  const refundInvoice = await createRefundInvoice(input, client);
  const payment = await createPaymentWithAllocation(
    {
      invoiceId: refundInvoice.id,
      financialCaseId: refundInvoice.financialCaseId,
      amount: new Prisma.Decimal(input.amount),
      method: input.method,
      paymentType: PaymentType.REFUND,
      direction: "OUT",
      refundOfPaymentId: input.refundOfPaymentId,
      paidAt: input.paidAt ?? new Date(),
      reference: input.reference,
      notes: input.reason,
    },
    client
  );

  await recalculateInvoiceStatus(refundInvoice.id, client);
  await recordAuditLog(client, auditActorContext, {
    entityType: AuditEntityType.PAYMENT,
    entityId: payment.id,
    action: AuditAction.PAYMENT_REFUNDED,
    after: {
      paymentId: payment.id,
      parentInvoiceId: refundInvoice.parentInvoiceId ?? null,
      refundInvoiceId: refundInvoice.id,
      amount: payment.amount.toFixed(3),
    },
    context: {
      financialCaseId: refundInvoice.financialCaseId,
      orderId: refundInvoice.orderId ?? null,
      bookingId: refundInvoice.bookingId ?? null,
    },
  });
  await closeRefundInvoiceIfSettled(client, refundInvoice.id, auditActorContext);

  if (refundInvoice.orderId) {
    await recordOrderActivity(client, {
      orderId: refundInvoice.orderId,
      userId: input.createdByUserId,
      type: OrderActivityType.INVOICE_ADJUSTED,
      title: "Refund payment recorded",
      description: `Refund payment recorded: ${new Prisma.Decimal(input.amount).toFixed(3)} KD via ${input.method} (${refundInvoice.invoiceNumber}).`,
      metadata: {
        refundInvoiceId: refundInvoice.id,
        refundInvoiceNumber: refundInvoice.invoiceNumber,
        refundPaymentId: payment.id,
        amount: new Prisma.Decimal(input.amount).toFixed(3),
        method: input.method,
        refundOfPaymentId: input.refundOfPaymentId ?? null,
      },
    });
  }

  await assertFinancialCaseInvariants(refundInvoice.financialCaseId, client);

  return { refundInvoiceId: refundInvoice.id, refundPaymentId: payment.id };
}

async function closeRefundInvoiceIfSettled(
  client: DbClient,
  refundInvoiceId: string,
  actorContext: ActorContext
): Promise<void> {
  const invoice = await client.invoice.findUnique({
    where: { id: refundInvoiceId },
    select: {
      ...invoiceLockSnapshotSelect,
      id: true,
      financialCaseId: true,
      orderId: true,
      bookingId: true,
      remainingAmount: true,
      isLocked: true,
      status: true,
      closedAt: true,
    },
  });
  if (!invoice || invoice.isLocked || invoice.remainingAmount.greaterThan(0)) {
    return;
  }

  const closedAt = new Date();
  const updateResult = await client.invoice.updateMany({
    where: {
      id: refundInvoiceId,
      isLocked: false,
      remainingAmount: invoice.remainingAmount,
    },
    data: {
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      closedAt,
    },
  });
  if (updateResult.count === 0) {
    return;
  }

  const persistedInvoice = await client.invoice.findUnique({
    where: { id: refundInvoiceId },
    select: {
      ...invoiceLockSnapshotSelect,
      id: true,
      financialCaseId: true,
      orderId: true,
      bookingId: true,
      remainingAmount: true,
      isLocked: true,
      status: true,
      closedAt: true,
    },
  });
  if (!persistedInvoice) {
    console.warn(
      JSON.stringify({
        metric: "refund.invoice_lock_snapshot_skipped",
        invoiceId: refundInvoiceId,
        reason: "missing_after_lock",
      })
    );
    return;
  }

  await recordInvoiceLockSnapshot(
    client,
    persistedInvoice,
    actorContext.actorUserId
  );

  await recordAuditLog(client, actorContext, {
    entityType: AuditEntityType.INVOICE,
    entityId: persistedInvoice.id,
    action: AuditAction.INVOICE_LOCKED,
    before: {
      isLocked: invoice.isLocked,
      status: invoice.status,
      closedAt: invoice.closedAt?.toISOString() ?? null,
    },
    after: {
      isLocked: true,
      status: InvoiceStatus.CLOSED,
      closedAt: closedAt.toISOString(),
    },
    context: {
      financialCaseId: persistedInvoice.financialCaseId,
      orderId: persistedInvoice.orderId ?? null,
      bookingId: persistedInvoice.bookingId ?? null,
      invoiceType: "REFUND",
    },
  });
}

async function getManagerAuditActorContext(
  client: DbClient,
  userId: string
): Promise<ActorContext> {
  const actor = await client.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (
    !actor ||
    (actor.role !== UserRole.ADMIN && actor.role !== UserRole.MANAGER)
  ) {
    throw new Error("Manager permission is required to issue a refund");
  }

  return { actorUserId: actor.id, actorRole: actor.role };
}
