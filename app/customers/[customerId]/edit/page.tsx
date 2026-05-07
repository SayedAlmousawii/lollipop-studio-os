import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { CustomerForm } from "@/components/customers/customer-form";
import { getCustomerForEdit } from "@/modules/customers/customer.service";

interface EditCustomerPageProps {
  params: Promise<{ customerId: string }>;
}

export default async function EditCustomerPage(props: EditCustomerPageProps) {
  const { customerId } = await props.params;
  const customer = await getCustomerForEdit(customerId);

  if (!customer) {
    notFound();
  }

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl space-y-8">
        <Link
          href="/customers"
          className="inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Customers
        </Link>

        <div>
          <h1 className="text-[28px] font-semibold text-text-primary">
            Edit Customer
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Update parent contact details and customer status.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-8">
          <CustomerForm
            mode="edit"
            customerId={customer.id}
            defaultValues={customer}
          />
        </div>
      </div>
    </PageContainer>
  );
}
