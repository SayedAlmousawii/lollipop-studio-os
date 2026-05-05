import { PageContainer } from "@/components/layout/page-container";
import { InvoicesTable } from "@/components/invoices/invoices-table";
import { getInvoices } from "@/modules/invoices/invoice.service";

export default async function InvoicesPage() {
  const invoices = await getInvoices();

  return (
    <PageContainer>
      <div className="space-y-6">
        <div>
          <h1 className="text-[28px] font-semibold text-text-primary">
            Invoices
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Track issued invoices, locked records, adjustments, and payments.
          </p>
        </div>

        <InvoicesTable invoices={invoices} />
      </div>
    </PageContainer>
  );
}
