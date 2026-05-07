import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { CustomerForm } from "@/components/customers/customer-form";

export default function NewCustomerPage() {
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
            New Customer
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Add a parent profile with the contact details used for bookings.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-8">
          <CustomerForm />
        </div>
      </div>
    </PageContainer>
  );
}
