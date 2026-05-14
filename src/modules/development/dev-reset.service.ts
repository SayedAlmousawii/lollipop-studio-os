import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";

export async function resetWorkflowTestData(): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Workflow reset is only available in development");
  }

  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        await tx.documentApplication.deleteMany({});
        await tx.paymentAllocation.deleteMany({});
        await tx.payment.deleteMany({});
        await tx.invoice.deleteMany({});
        await tx.order.deleteMany({});
        await tx.financialCase.deleteMany({});
        await tx.bookingTheme.deleteMany({});
        await tx.booking.deleteMany({});
        await tx.job.deleteMany({});
        await tx.identifierSequence.deleteMany({});

        await resetSequence(tx, "booking_public_id_seq");
        await resetSequence(tx, "order_public_id_seq");
        await resetSequence(tx, "invoice_public_id_seq");
        await resetSequence(tx, "payment_public_id_seq");
        await resetSequence(tx, "invoice_number_seq");
      }),
    "Failed to reset workflow test data"
  );
}

async function resetSequence(
  client: Prisma.TransactionClient,
  sequenceName: string
): Promise<void> {
  // Prisma.raw is safe here only because sequenceName is a private hardcoded
  // literal from this module; never pass user input or dynamic values here.
  await client.$executeRaw`
    SELECT setval(${Prisma.raw(`'"${sequenceName}"'`)}, 1, false)
  `;
}
