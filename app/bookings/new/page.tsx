import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { NewBookingForm } from "@/components/bookings/new-booking-form";
import { getCustomers } from "@/modules/customers/customer.service";
import { getPackages } from "@/modules/packages/package.service";

export default async function NewBookingPage() {
  const [allCustomers, allPackages] = await Promise.all([
    getCustomers(),
    getPackages(),
  ]);

  const customers = allCustomers.map((c) => ({ id: c.id, name: c.fullName }));
  const packages = allPackages
    .filter((p) => p.status === "Active")
    .map((p) => ({ id: p.id, name: p.name, price: p.price }));

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl space-y-8">
        {/* Back link */}
        <Link
          href="/bookings"
          className="inline-flex items-center gap-1 text-sm text-(--color-text-secondary) hover:text-(--color-text-primary) transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Bookings
        </Link>

        {/* Header */}
        <div>
          <h1 className="text-[28px] font-semibold text-(--color-text-primary)">
            New Booking
          </h1>
          <p className="mt-1 text-sm text-(--color-text-secondary)">
            Fill in the details below to create a new studio booking.
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-lg border border-(--color-border) bg-(--color-surface) p-8">
          <NewBookingForm customers={customers} packages={packages} />
        </div>
      </div>
    </PageContainer>
  );
}
