import { OrderActivityType, Prisma } from "@prisma/client";
import type { Payment, PaymentMethod, PaymentType } from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { assertFinancialCaseInvariants } from "@/modules/financial/invariants";
import type { Money, PaymentDirection } from "@/modules/financial/types";
import { PUBLIC_ID_KIND } from "@/modules/identifiers/identifier.constants";
import { generatePublicId } from "@/modules/identifiers/identifier.service";
import { recalculateInvoiceStatus } from "@/modules/invoices/invoice.service";
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
  direction?: PaymentDirection;
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
    },
  });

  if (!invoice) {
    throw new Error("Invoice not found for financial case");
  }

  const payment = await client.payment.create({
    data: {
      publicId: await generatePublicId(client, PUBLIC_ID_KIND.PAYMENT),
      financialCaseId: input.financialCaseId,
      jobId: invoice.jobId,
      jobNumber: invoice.jobNumber,
      invoiceId: input.invoiceId,
      amount: input.amount,
      direction: input.direction ?? "IN",
      method: input.method,
      paymentType: input.paymentType,
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
  actorContext: ActorContext = {}
): Promise<{ id: string }> {
  return withRetry(
    () =>
      db.$transaction((tx) =>
        recordPaymentWithClient(tx, invoiceId, data, actorContext)
      ),
    "Failed to record payment"
  );
}

export async function recordPaymentWithClient(
  client: DbClient,
  invoiceId: string,
  data: RecordPaymentInput,
  actorContext: ActorContext = {}
): Promise<{ id: string }> {
  const invoice = await client.invoice.findUnique({
    where: { id: invoiceId },
    include: { payments: { select: { amount: true } } },
  });
  if (!invoice) throw new Error("Invoice not found");

  const paidAmount = invoice.payments.reduce(
    (sum, payment) => sum.plus(payment.amount),
    new Prisma.Decimal(0)
  );
  const remainingAmount = Prisma.Decimal.max(invoice.totalAmount.minus(paidAmount), 0);
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

  await recalculateInvoiceStatus(invoiceId, client);
  if (invoice.orderId) {
    await recordOrderActivity(client, {
      orderId: invoice.orderId,
      userId: actorContext.actorUserId ?? null,
      type: OrderActivityType.PAYMENT_RECEIVED,
      title: "Payment received",
      description: `${paymentAmount.toFixed(3)} KD payment recorded.`,
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
  }
  return payment;
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
