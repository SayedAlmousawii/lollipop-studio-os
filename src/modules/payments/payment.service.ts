import {
  AuditAction,
  AuditEntityType,
  InvoiceStatus,
  InvoiceType,
  OrderActivityType,
  PaymentDirection,
  PaymentType,
  Prisma,
} from "@prisma/client";
import type { Payment, PaymentMethod } from "@prisma/client";
import { assertActorPermission } from "@/lib/auth/assert-actor-permission";
import type { ActorContext } from "@/lib/auth/actor-context";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { withRetry } from "@/lib/retry";
import { recordAuditLog } from "@/modules/audit/audit-log.service";
import { assertFinancialCaseInvariants } from "@/modules/financial/invariants";
import type { FinancialPaymentDirection, Money } from "@/modules/financial/types";
import { PUBLIC_ID_KIND } from "@/modules/identifiers/identifier.constants";
import { generatePublicId } from "@/modules/identifiers/identifier.service";
import {
  invoiceLockSnapshotSelect,
  recordInvoiceLockSnapshot,
} from "@/modules/invoices/invoice-lock.service";
import {
  recalculateInvoiceStatus,
  snapshotInvoiceLineItemsWithClient,
} from "@/modules/invoices/invoice.service";
import { recordOrderActivity } from "@/modules/orders/order-activity.service";
import type { RecordPaymentInput } from "./payment.schema";

type DbClient = typeof db | Prisma.TransactionClient;

type PaymentAllocationInput = {
  invoiceId: string;
  amount: Money;
};

export type CreatePaymentInput = {
  invoiceId: string;
  amount: Money;
  method: PaymentMethod;
  paymentType: PaymentType;
  direction?: FinancialPaymentDirection;
  refundOfPaymentId?: string;
  paidAt?: Date;
  reference?: string;
  notes?: string;
  financialCaseId: string;
  allocations?: PaymentAllocationInput[];
};

export async function createPaymentWithAllocation(
  input: CreatePaymentInput,
  tx?: DbClient
): Promise<Payment> {
  if (tx) {
    return createPaymentWithAllocationWithClient(input, tx);
  }

  return db.$transaction((transaction) =>
    createPaymentWithAllocationWithClient(input, transaction)
  );
}

async function createPaymentWithAllocationWithClient(
  input: CreatePaymentInput,
  client: DbClient
): Promise<Payment> {
  if (input.allocations && input.allocations.length > 1) {
    throw new Error("Multi-allocation payments not supported until Phase 5");
  }

  if (input.amount.lessThanOrEqualTo(0)) {
    throw new Error("Payment amount must be greater than 0");
  }

  const allocation = input.allocations?.[0] ?? {
    invoiceId: input.invoiceId,
    amount: input.amount,
  };

  if (
    allocation.invoiceId !== input.invoiceId ||
    !allocation.amount.equals(input.amount)
  ) {
    throw new Error(
      "Single payment allocation must match the payment invoice and amount"
    );
  }

  const invoice = await client.invoice.findFirst({
    where: {
      id: input.invoiceId,
      financialCaseId: input.financialCaseId,
    },
    select: {
      id: true,
      financialCaseId: true,
      jobId: true,
      jobNumber: true,
      invoiceType: true,
      parentInvoiceId: true,
    },
  });

  if (!invoice) {
    throw new Error("Invoice not found for financial case");
  }

  const direction = input.direction ?? PaymentDirection.IN;
  const paymentType =
    direction === PaymentDirection.OUT ? PaymentType.REFUND : input.paymentType;
  if (direction === PaymentDirection.OUT) {
    if (invoice.invoiceType !== InvoiceType.REFUND) {
      throw new Error("Outbound payments must target a refund invoice");
    }
    if (paymentType !== PaymentType.REFUND) {
      throw new Error("Outbound payments must use refund payment type");
    }
    if (input.refundOfPaymentId) {
      if (!invoice.parentInvoiceId) {
        throw new Error("Refund invoice source is required for payment traceability");
      }
      const sourcePayment = await client.payment.findFirst({
        where: {
          id: input.refundOfPaymentId,
          financialCaseId: input.financialCaseId,
        },
        select: {
          id: true,
          direction: true,
          allocations: {
            where: { invoiceId: invoice.parentInvoiceId },
            select: { id: true },
            take: 1,
          },
        },
      });

      if (!sourcePayment || sourcePayment.direction !== PaymentDirection.IN) {
        throw new Error("Refund trace must point to an inbound payment");
      }
      if (sourcePayment.allocations.length === 0) {
        throw new Error(
          "Refund trace payment must be allocated to the source invoice"
        );
      }
    }
  } else if (input.refundOfPaymentId) {
    throw new Error("Only outbound refund payments can reference a source payment");
  }

  const payment = await client.payment.create({
    data: {
      publicId: await generatePublicId(client, PUBLIC_ID_KIND.PAYMENT),
      financialCaseId: input.financialCaseId,
      jobId: invoice.jobId,
      jobNumber: invoice.jobNumber,
      invoiceId: input.invoiceId,
      amount: input.amount,
      direction,
      method: input.method,
      paymentType,
      ...(input.refundOfPaymentId
        ? { refundOfPaymentId: input.refundOfPaymentId }
        : {}),
      paidAt: input.paidAt ?? new Date(),
      reference: input.reference ?? null,
      notes: input.notes ?? null,
    },
  });

  await client.paymentAllocation.create({
    data: {
      paymentId: payment.id,
      invoiceId: allocation.invoiceId,
      amount: allocation.amount,
    },
  });

  await assertFinancialCaseInvariants(input.financialCaseId, client);

  return payment;
}

export async function recordPayment(
  invoiceId: string,
  data: RecordPaymentInput,
  actorContext: ActorContext
): Promise<{ id: string }> {
  return withRetry(
    () =>
      db.$transaction((tx) =>
        recordPaymentWithClient(tx, invoiceId, data, actorContext)
      ),
    "Failed to record payment"
  );
}

export class UpgradePaymentInvoiceNotFoundError extends Error {
  constructor() {
    super("Invoice not found.");
    this.name = "UpgradePaymentInvoiceNotFoundError";
  }
}

export class UpgradePaymentInvoiceOrderMismatchError extends Error {
  constructor() {
    super("Invoice does not belong to this order.");
    this.name = "UpgradePaymentInvoiceOrderMismatchError";
  }
}

export class UpgradePaymentNoOutstandingBalanceError extends Error {
  constructor() {
    super("No outstanding balance remains on this invoice.");
    this.name = "UpgradePaymentNoOutstandingBalanceError";
  }
}

export class UpgradePaymentOutstandingBalanceChangedError extends Error {
  constructor() {
    super("Outstanding balance changed. Please reopen the payment dialog and try again.");
    this.name = "UpgradePaymentOutstandingBalanceChangedError";
  }
}

export async function recordUpgradePaymentForOrder(
  input: {
    orderId: string;
    invoiceId: string;
    payment: RecordPaymentInput;
  },
  actorContext: ActorContext
): Promise<{ id: string }> {
  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        await lockInvoiceForUpdate(tx, input.invoiceId);
        const invoice = await tx.invoice.findUnique({
          where: { id: input.invoiceId },
          select: { id: true, orderId: true, remainingAmount: true },
        });
        if (!invoice) {
          throw new UpgradePaymentInvoiceNotFoundError();
        }
        if (invoice.orderId !== input.orderId) {
          throw new UpgradePaymentInvoiceOrderMismatchError();
        }

        const outstandingAmount = new Prisma.Decimal(invoice.remainingAmount);
        const outstandingNumber = outstandingAmount.toNumber();
        if (!Number.isFinite(outstandingNumber) || outstandingNumber <= 0) {
          throw new UpgradePaymentNoOutstandingBalanceError();
        }

        const submittedAmount = new Prisma.Decimal(input.payment.amount);
        if (submittedAmount.toFixed(3) !== outstandingAmount.toFixed(3)) {
          throw new UpgradePaymentOutstandingBalanceChangedError();
        }

        return recordPaymentWithClient(
          tx,
          invoice.id,
          { ...input.payment, amount: outstandingNumber },
          actorContext
        );
      }),
    "Failed to record upgrade payment",
    3,
    (error) => !isUpgradePaymentKnownError(error)
  );
}

function isUpgradePaymentKnownError(error: unknown): boolean {
  return (
    error instanceof UpgradePaymentInvoiceNotFoundError ||
    error instanceof UpgradePaymentInvoiceOrderMismatchError ||
    error instanceof UpgradePaymentNoOutstandingBalanceError ||
    error instanceof UpgradePaymentOutstandingBalanceChangedError
  );
}

export async function recordPaymentWithClient(
  client: DbClient,
  invoiceId: string,
  data: RecordPaymentInput,
  actorContext: ActorContext
): Promise<{ id: string }> {
  assertActorPermission(actorContext, PERMISSIONS.PAYMENT_CREATE);
  assertActorHasUserId(actorContext);
  await lockInvoiceForUpdate(client, invoiceId);

  const invoice = await client.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      payments: { select: { amount: true } },
      paymentAllocations: { select: { amount: true } },
      documentApplicationsAsTarget: { select: { amountApplied: true } },
    },
  });
  if (!invoice) throw new Error("Invoice not found");

  const directPaidAmount = invoice.payments.reduce(
    (sum, payment) => sum.plus(payment.amount),
    new Prisma.Decimal(0)
  );
  const allocatedPaymentAmount = invoice.paymentAllocations.reduce(
    (sum, allocation) => sum.plus(allocation.amount),
    new Prisma.Decimal(0)
  );
  const appliedDocumentAmount = invoice.documentApplicationsAsTarget.reduce(
    (sum, application) => sum.plus(application.amountApplied),
    new Prisma.Decimal(0)
  );
  const totalAppliedAndPaid = (invoice.paymentAllocations.length > 0
    ? allocatedPaymentAmount
    : directPaidAmount
  ).plus(appliedDocumentAmount);
  const remainingAmount = Prisma.Decimal.max(
    invoice.totalAmount.minus(totalAppliedAndPaid),
    0
  );
  const paymentAmount = new Prisma.Decimal(data.amount);
  if (remainingAmount.lessThanOrEqualTo(0)) {
    throw new Error("No outstanding balance remains on this invoice");
  }
  if (paymentAmount.greaterThan(remainingAmount)) {
    throw new Error("Payment amount cannot exceed the remaining invoice balance");
  }

  const payment = await createPaymentWithAllocation(
    {
      invoiceId,
      amount: paymentAmount,
      method: data.method,
      paymentType: data.paymentType,
      paidAt: data.paidAt ?? new Date(),
      reference: data.reference,
      notes: data.notes,
      financialCaseId: invoice.financialCaseId,
    },
    client
  );

  await recordAuditLog(client, actorContext, {
    entityType: AuditEntityType.INVOICE,
    entityId: invoice.id,
    action: AuditAction.PAYMENT_RECORDED,
    after: {
      paymentId: payment.id,
      invoiceId: invoice.id,
      amount: payment.amount.toFixed(3),
      method: payment.method,
      direction: payment.direction,
    },
    context: {
      financialCaseId: invoice.financialCaseId,
      orderId: invoice.orderId ?? null,
      bookingId: invoice.bookingId ?? null,
    },
  });

  await recalculateInvoiceStatus(invoiceId, client);
  const recalculatedInvoice = await closeInvoiceIfSettled(
    client,
    invoiceId,
    actorContext
  );
  if (invoice.orderId) {
    const isAdjustmentPayment = data.paymentType === "ADJUSTMENT";
    await recordOrderActivity(client, {
      orderId: invoice.orderId,
      userId: actorContext.actorUserId ?? null,
      type: OrderActivityType.PAYMENT_RECEIVED,
      title: "Payment received",
      description: isAdjustmentPayment
        ? `Payment recorded against ${invoice.invoiceNumber}: ${paymentAmount.toFixed(3)} KD via ${data.method}.`
        : `${paymentAmount.toFixed(3)} KD payment recorded.`,
      metadata: {
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        paymentId: payment.id,
        amount: paymentAmount.toFixed(3),
        method: data.method,
        paymentType: data.paymentType,
        paidAt: (data.paidAt ?? new Date()).toISOString(),
        reference: data.reference ?? null,
      },
    });

    if (recalculatedInvoice?.justClosed) {
      await recordOrderActivity(client, {
        orderId: invoice.orderId,
        userId: actorContext.actorUserId ?? null,
        type: OrderActivityType.INVOICE_ADJUSTED,
        title:
          recalculatedInvoice.invoiceType === InvoiceType.ADJUSTMENT
            ? "Adjustment settled"
            : "Invoice settled",
        description:
          recalculatedInvoice.invoiceType === InvoiceType.ADJUSTMENT
            ? `Adjustment ${invoice.invoiceNumber} settled and closed.`
            : `Invoice ${invoice.invoiceNumber} settled and closed.`,
        metadata: {
          invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          invoiceType: recalculatedInvoice.invoiceType,
          status: InvoiceStatus.CLOSED,
          locked: true,
        },
      });
    }
  }

  if (data.paymentType === "ADJUSTMENT") {
    recordPaymentCounter("pos.adjustment.payment.recorded", {
      method: data.method,
      invoiceId,
      paymentId: payment.id,
    });
  }
  return payment;
}

function assertActorHasUserId(actorContext: ActorContext): void {
  if (!actorContext.actorUserId.trim()) {
    throw new Error("actorUserId is required to record a payment");
  }
}

async function lockInvoiceForUpdate(
  client: DbClient,
  invoiceId: string
): Promise<void> {
  await client.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "invoices" WHERE id = ${invoiceId} FOR UPDATE
  `;
}

async function closeInvoiceIfSettled(
  client: DbClient,
  invoiceId: string,
  actorContext: ActorContext
): Promise<{
  invoiceType: InvoiceType;
  justClosed: boolean;
} | null> {
  const invoice = await client.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      ...invoiceLockSnapshotSelect,
      id: true,
      invoiceType: true,
      orderId: true,
      isLocked: true,
      status: true,
      remainingAmount: true,
      issuedAt: true,
      closedAt: true,
      financialCaseId: true,
      bookingId: true,
    },
  });
  if (!invoice) return null;
  const shouldAutoCloseDraftFinal =
    invoice.invoiceType === InvoiceType.FINAL &&
    invoice.status === InvoiceStatus.DRAFT;
  if (
    invoice.isLocked ||
    invoice.status === InvoiceStatus.CLOSED ||
    (invoice.status === InvoiceStatus.DRAFT && !shouldAutoCloseDraftFinal) ||
    invoice.remainingAmount.greaterThan(0)
  ) {
    return { invoiceType: invoice.invoiceType, justClosed: false };
  }

  if (invoice.orderId) {
    await snapshotInvoiceLineItemsWithClient(client, invoice.id, invoice.orderId);
  }

  const settledAt = new Date();
  const updateResult = shouldAutoCloseDraftFinal
    ? await client.invoice.updateMany({
        where: {
          id: invoice.id,
          invoiceType: InvoiceType.FINAL,
          isLocked: false,
          status: InvoiceStatus.DRAFT,
          remainingAmount: new Prisma.Decimal(0),
        },
        data: {
          status: InvoiceStatus.CLOSED,
          isLocked: true,
          issuedAt: invoice.issuedAt ?? settledAt,
          closedAt: settledAt,
        },
      })
    : await client.invoice.updateMany({
        where: {
          id: invoice.id,
          isLocked: false,
          status: { notIn: [InvoiceStatus.CLOSED, InvoiceStatus.DRAFT] },
          remainingAmount: new Prisma.Decimal(0),
        },
        data: {
          status: InvoiceStatus.CLOSED,
          isLocked: true,
          closedAt: settledAt,
        },
      });

  const justClosed = updateResult.count > 0;
  if (justClosed) {
    await recordInvoiceLockSnapshot(client, invoice, actorContext.actorUserId);

    await recordAuditLog(client, actorContext, {
      entityType: AuditEntityType.INVOICE,
      entityId: invoice.id,
      action: AuditAction.INVOICE_LOCKED,
      before: {
        isLocked: invoice.isLocked,
        status: invoice.status,
        closedAt: invoice.closedAt?.toISOString() ?? null,
      },
      after: {
        isLocked: true,
        status: InvoiceStatus.CLOSED,
        closedAt: settledAt.toISOString(),
      },
      context: {
        financialCaseId: invoice.financialCaseId,
        orderId: invoice.orderId ?? null,
        bookingId: invoice.bookingId ?? null,
        invoiceType: invoice.invoiceType,
      },
    });
  }

  return { invoiceType: invoice.invoiceType, justClosed };
}

function recordPaymentCounter(
  metric: string,
  fields: Record<string, string>
): void {
  console.info(JSON.stringify({ metric, ...fields }));
}

export async function getPaymentsByInvoice(invoiceId: string) {
  return withRetry(
    () =>
      db.payment.findMany({
        where: { invoiceId },
        orderBy: { paidAt: "desc" },
      }),
    "Failed to fetch payments"
  );
}

export async function getRevenueByDateRange(
  startDate: Date,
  endDate: Date
): Promise<number> {
  const result = await withRetry(
    () =>
      db.payment.aggregate({
        _sum: { amount: true },
        where: { paidAt: { gte: startDate, lte: endDate } },
      }),
    "Failed to calculate revenue"
  );

  return result._sum.amount?.toNumber() ?? 0;
}
