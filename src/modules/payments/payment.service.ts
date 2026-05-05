import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { recalculateInvoiceStatus } from "@/modules/invoices/invoice.service";
import type { RecordPaymentInput } from "./payment.schema";

type DbClient = typeof db | Prisma.TransactionClient;

export async function recordPayment(
  invoiceId: string,
  data: RecordPaymentInput
): Promise<{ id: string }> {
  return withRetry(
    () => db.$transaction((tx) => recordPaymentWithClient(tx, invoiceId, data)),
    "Failed to record payment"
  );
}

export async function recordPaymentWithClient(
  client: DbClient,
  invoiceId: string,
  data: RecordPaymentInput
): Promise<{ id: string }> {
  const invoice = await client.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, isLocked: true },
  });
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.isLocked) {
    throw new Error("Cannot record payments against a locked invoice");
  }

  const payment = await client.payment.create({
    data: {
      invoiceId,
      amount: new Prisma.Decimal(data.amount),
      method: data.method,
      paymentType: data.paymentType,
      paidAt: data.paidAt ?? new Date(),
      reference: data.reference ?? null,
      notes: data.notes ?? null,
    },
    select: { id: true },
  });

  await recalculateInvoiceStatus(invoiceId, client);
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
