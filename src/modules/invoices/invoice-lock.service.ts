import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type DbClient = typeof db | Prisma.TransactionClient;

export const invoiceLockSnapshotSelect = {
  id: true,
  publicId: true,
  invoiceType: true,
  parentInvoiceId: true,
  financialCaseId: true,
  jobId: true,
  orderId: true,
  invoiceNumber: true,
  totalAmount: true,
} satisfies Prisma.InvoiceSelect;

export type InvoiceLockSnapshotSource = Prisma.InvoiceGetPayload<{
  select: typeof invoiceLockSnapshotSelect;
}>;

export async function recordInvoiceLockSnapshot(
  client: DbClient,
  invoice: InvoiceLockSnapshotSource,
  lockedByUserId?: string | null
): Promise<void> {
  await client.invoiceLockSnapshot.create({
    data: {
      invoiceId: invoice.id,
      lockedByUserId: lockedByUserId?.trim() || null,
      totalAmount: invoice.totalAmount,
      invoiceType: invoice.invoiceType,
      parentInvoiceId: invoice.parentInvoiceId,
      financialCaseId: invoice.financialCaseId,
      jobId: invoice.jobId,
      orderId: invoice.orderId,
      invoiceNumber: invoice.invoiceNumber,
      publicId: invoice.publicId,
    },
  });
}
