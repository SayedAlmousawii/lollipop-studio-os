import { PageContainer } from "@/components/layout/page-container";
import { InvoicesFilters } from "@/components/invoices/invoices-filters";
import { InvoicesTable } from "@/components/invoices/invoices-table";
import { getInvoices, parseInvoiceFilters } from "@/modules/invoices/invoice.service";

export default async function InvoicesPage(props: PageProps<"/invoices">) {
  const filters = parseInvoiceFilters(await props.searchParams);
  const register = await getInvoices(filters);

  return (
    <PageContainer>
      <div className="space-y-6">
        <div>
          <h1 className="text-[28px] font-semibold text-text-primary">
            Financial Documents
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Accountant-facing register for charges, credits, deposits, and cash movements.
          </p>
        </div>

        <InvoicesFilters currentFilters={filters} />

        <InvoicesTable register={register} />
      </div>
    </PageContainer>
  );
}
