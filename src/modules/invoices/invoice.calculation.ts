import { PaymentDirection, Prisma, type PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function computeEffectivePaidFromAllocations(
  invoiceId: string,
  tx: DbClient
): Promise<Prisma.Decimal> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true },
  });
  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }

  const [incomingPaymentAllocations, outgoingPaymentAllocations, documentApplications] =
    await Promise.all([
      tx.paymentAllocation.aggregate({
        _sum: { amount: true },
        where: {
          invoiceId,
          payment: { direction: PaymentDirection.IN },
        },
      }),
      tx.paymentAllocation.aggregate({
        _sum: { amount: true },
        where: {
          invoiceId,
          payment: { direction: PaymentDirection.OUT },
        },
      }),
      tx.documentApplication.aggregate({
        _sum: { amountApplied: true },
        where: { targetInvoiceId: invoiceId },
      }),
    ]);

  return (incomingPaymentAllocations._sum.amount ?? new Prisma.Decimal(0))
    .minus(outgoingPaymentAllocations._sum.amount ?? new Prisma.Decimal(0))
    .plus(documentApplications._sum.amountApplied ?? new Prisma.Decimal(0));
}
