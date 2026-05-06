import { PageContainer } from "@/components/layout/page-container";
import { InvoicesFilters } from "@/components/invoices/invoices-filters";
import { InvoicesTable } from "@/components/invoices/invoices-table";
import { getInvoices } from "@/modules/invoices/invoice.service";

export default async function InvoicesPage(props: PageProps<"/invoices">) {
  const searchParams = await props.searchParams;
  const search = Array.isArray(searchParams.search)
    ? searchParams.search[0]
    : searchParams.search;
  const invoices = await getInvoices({ search });

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

        <InvoicesFilters />

        <InvoicesTable invoices={invoices} />
      </div>
    </PageContainer>
  );
}
