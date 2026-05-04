import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/page-container";
import { CustomersFilters } from "@/components/customers/customers-filters";
import { CustomersTable } from "@/components/customers/customers-table";
import { getCustomers } from "@/modules/customers/customer.service";

export default async function CustomersPage() {
  const customers = await getCustomers();

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
          <Button className="shrink-0">
            <Plus className="mr-2 h-4 w-4" />
            New Customer
          </Button>
        </div>

        {/* Filters */}
        <CustomersFilters />

        {/* Table */}
        <CustomersTable customers={customers} />
      </div>
    </PageContainer>
  );
}
