import { InvoiceType } from "@prisma/client";
import { db } from "@/lib/db";
import { recalculateInvoiceStatus } from "@/modules/invoices/invoice.service";

async function main() {
  const invoices = await db.invoice.findMany({
    where: {
      invoiceType: InvoiceType.FINAL,
    },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      remainingAmount: true,
    },
    orderBy: { createdAt: "asc" },
  });

  let changedCount = 0;

  for (const invoice of invoices) {
    await recalculateInvoiceStatus(invoice.id);

    const updatedInvoice = await db.invoice.findUnique({
      where: { id: invoice.id },
      select: {
        status: true,
        remainingAmount: true,
      },
    });

    if (
      updatedInvoice &&
      (updatedInvoice.status !== invoice.status ||
        !updatedInvoice.remainingAmount.equals(invoice.remainingAmount))
    ) {
      changedCount += 1;
    }
  }

  console.log(`Processed ${invoices.length} final invoices.`);
  console.log(`Updated ${changedCount} final invoices.`);
}

main()
  .catch((error) => {
    console.error("Backfill failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
