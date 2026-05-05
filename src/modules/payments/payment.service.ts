import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { recalculateInvoiceStatus } from "@/modules/invoices/invoice.service";
import type { RecordPaymentInput } from "./payment.schema";

export async function recordPayment(
  invoiceId: string,
  data: RecordPaymentInput
): Promise<{ id: string }> {
  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({
          where: { id: invoiceId },
          select: { id: true, isLocked: true },
        });
        if (!invoice) throw new Error("Invoice not found");
        if (invoice.isLocked) {
          throw new Error("Cannot record payments against a locked invoice");
        }

        const payment = await tx.payment.create({
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

        await recalculateInvoiceStatus(invoiceId, tx);
        return payment;
      }),
    "Failed to record payment"
  );
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
