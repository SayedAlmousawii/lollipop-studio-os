import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/page-container";
import { CustomersFilters } from "@/components/customers/customers-filters";
import { CustomersTable } from "@/components/customers/customers-table";
import {
  getCustomers,
  parseCustomerFilters,
} from "@/modules/customers/customer.service";

export default async function CustomersPage(props: PageProps<"/customers">) {
  const filters = parseCustomerFilters(await props.searchParams);
  const customers = await getCustomers(filters);

  return (
    <PageContainer>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold text-text-primary">
              Customers
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              View and manage your studio customers
            </p>
          </div>
          <Button className="shrink-0" asChild>
            <Link href="/customers/new">
              <Plus className="mr-2 h-4 w-4" />
              New Customer
            </Link>
          </Button>
        </div>

        {/* Filters */}
        <CustomersFilters
          currentSearch={filters.search ?? ""}
          currentStatus={filters.status ?? "all"}
        />

        {/* Table */}
        <CustomersTable customers={customers} />
      </div>
    </PageContainer>
  );
}
