import {
  InvoiceStatus,
  OrderActivityType,
  PaymentType,
  Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { assertFinancialCaseInvariants } from "@/modules/financial/invariants";
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
  await closeRefundInvoiceIfSettled(client, refundInvoice.id);

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
  refundInvoiceId: string
): Promise<void> {
  const invoice = await client.invoice.findUnique({
    where: { id: refundInvoiceId },
    select: { remainingAmount: true, isLocked: true },
  });
  if (!invoice || invoice.isLocked || invoice.remainingAmount.greaterThan(0)) {
    return;
  }

  await client.invoice.update({
    where: { id: refundInvoiceId },
    data: {
      status: InvoiceStatus.CLOSED,
      isLocked: true,
      closedAt: new Date(),
    },
  });
}
