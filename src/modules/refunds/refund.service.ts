import {
  AuditAction,
  AuditEntityType,
  InvoiceLineType,
  InvoiceStatus,
  InvoiceType,
  OrderActivityType,
  PaymentType,
  Prisma,
  UserRole,
  type Invoice,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { recordAuditLog } from "@/modules/audit/audit-log.service";
import { assertFinancialCaseInvariants } from "@/modules/financial/invariants";
import { PUBLIC_ID_KIND } from "@/modules/identifiers/identifier.constants";
import { generatePublicId } from "@/modules/identifiers/identifier.service";
import {
  invoiceLockSnapshotSelect,
  recordInvoiceLockSnapshot,
} from "@/modules/invoices/invoice-lock.service";
import {
  computeOverpaymentCapacity,
  generateInvoiceNumber,
  recalculateInvoiceStatus,
} from "@/modules/invoices/invoice.service";
import type {
  CreateRefundWithPaymentInput,
  RefundInvoicePrimitiveInput,
} from "@/modules/invoices/invoice.schema";
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

async function createRefundInvoice(
  input: RefundInvoicePrimitiveInput,
  client: DbClient
): Promise<Invoice> {
  const amount = new Prisma.Decimal(input.amount);
  if (amount.lessThanOrEqualTo(0)) {
    throw new Error("Refund amount must be greater than 0");
  }

  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Refund reason is required");
  }

  const actor = await client.user.findUnique({
    where: { id: input.createdByUserId },
    select: { id: true, role: true },
  });
  if (
    !actor ||
    (actor.role !== UserRole.ADMIN && actor.role !== UserRole.MANAGER)
  ) {
    throw new Error("Manager permission is required to issue a refund");
  }
  const auditActorContext: ActorContext = {
    actorUserId: actor.id,
    actorRole: actor.role,
  };

  await lockInvoiceForUpdate(client, input.sourceInvoiceId);
  const source = await client.invoice.findUnique({
    where: { id: input.sourceInvoiceId },
    select: {
      id: true,
      financialCaseId: true,
      invoiceType: true,
      invoiceNumber: true,
      orderId: true,
      bookingId: true,
      customerId: true,
      jobId: true,
      jobNumber: true,
      isLocked: true,
    },
  });
  if (!source) throw new Error("Source invoice not found");
  if (
    source.invoiceType !== InvoiceType.FINAL &&
    source.invoiceType !== InvoiceType.ADJUSTMENT
  ) {
    throw new Error("Refunds can only be issued for final or adjustment invoices");
  }
  if (!source.isLocked) {
    throw new Error("Refunds can only be issued for locked invoices");
  }

  const capacity = await computeOverpaymentCapacity(source.id, client);
  if (amount.greaterThan(capacity)) {
    throw new Error(
      `Refund amount ${amount.toFixed(3)} KD exceeds overpayment capacity ${capacity.toFixed(3)} KD`
    );
  }

  const invoiceNumberData = await generateInvoiceNumber(client, InvoiceType.REFUND);
  const invoice = await client.invoice.create({
    data: {
      publicId: await generatePublicId(client, PUBLIC_ID_KIND.INVOICE),
      financialCaseId: source.financialCaseId,
      invoiceType: InvoiceType.REFUND,
      jobId: source.jobId,
      jobNumber: source.jobNumber,
      orderId: source.orderId,
      bookingId: source.bookingId,
      customerId: source.customerId,
      parentInvoiceId: source.id,
      ...invoiceNumberData,
      totalAmount: amount,
      remainingAmount: amount,
      status: InvoiceStatus.ISSUED,
      notes: input.notes?.trim() || reason,
      issuedAt: new Date(),
      lineItems: {
        create: [
          {
            lineType: InvoiceLineType.MANUAL_DISCOUNT,
            description: reason,
            quantity: 1,
            unitPrice: amount,
            lineTotal: amount,
            sortOrder: 0,
          },
        ],
      },
    },
  });

  await recordAuditLog(client, auditActorContext, {
    entityType: AuditEntityType.REFUND,
    entityId: invoice.id,
    action: AuditAction.REFUND_ISSUED,
    after: {
      refundInvoiceId: invoice.id,
      sourceInvoiceId: source.id,
      amount: amount.toFixed(3),
    },
    context: {
      financialCaseId: source.financialCaseId,
      orderId: source.orderId ?? null,
      bookingId: source.bookingId ?? null,
      sourceInvoiceId: source.id,
    },
  });

  if (source.orderId) {
    await recordOrderActivity(client, {
      orderId: source.orderId,
      userId: input.createdByUserId,
      type: OrderActivityType.INVOICE_ADJUSTED,
      title: "Refund invoice issued",
      description: `Refund invoice ${invoice.invoiceNumber} issued: ${amount.toFixed(3)} KD for reason '${reason}'.`,
      metadata: {
        sourceInvoiceId: source.id,
        sourceInvoiceNumber: source.invoiceNumber,
        refundInvoiceId: invoice.id,
        refundInvoiceNumber: invoice.invoiceNumber,
        amount: amount.toFixed(3),
        reason,
      },
    });
  }

  await assertFinancialCaseInvariants(source.financialCaseId, client);

  return invoice;
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
    throw new Error(
      `refund.invoice_lock_snapshot_skipped: missing_after_lock for invoice ${refundInvoiceId}`
    );
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

async function lockInvoiceForUpdate(
  client: DbClient,
  invoiceId: string
): Promise<void> {
  await client.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "invoices" WHERE id = ${invoiceId} FOR UPDATE
  `;
}
