import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { DevCreateTestBookingButton } from "@/components/bookings/dev-create-test-booking-button";
import { PageContainer } from "@/components/layout/page-container";
import { NewBookingForm } from "@/components/bookings/new-booking-form";
import { db } from "@/lib/db";
import {
  getAssignablePhotographers,
  getRecommendedPhotographer,
} from "@/modules/bookings/booking.service";
import { formatCustomerPhone } from "@/modules/customers/customer.utils";
import { getActiveStudioDepartments } from "@/modules/departments/studio-department.service";
import { getPackages } from "@/modules/packages/package.service";

export default async function NewBookingPage(props: PageProps<"/bookings/new">) {
  const { customerId } = await props.searchParams;
  const requestedCustomerId = Array.isArray(customerId)
    ? customerId[0]
    : customerId;
  const [initialCustomer, allPackages, photographers, departments] =
    await Promise.all([
      getInitialCustomerPhone(requestedCustomerId),
      getPackages({ activeTaxonomyOnly: true }),
      getAssignablePhotographers(),
      getActiveStudioDepartments(),
    ]);

  const packages = allPackages
    .filter((p) => p.status === "Active")
    .map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      durationMinutes: p.durationMinutes,
      departmentId: p.departmentId,
      departmentName: p.departmentName,
      sessionTypeId: p.sessionTypeId,
      sessionTypeName: p.sessionTypeName,
      packageFamilyId: p.packageFamilyId,
      packageFamilyName: p.packageFamilyName,
    }));
  const recommendedPhotographer = initialCustomer
    ? await getRecommendedPhotographer(initialCustomer.id)
    : null;

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

        {process.env.NODE_ENV === "development" ? (
          <div className="rounded-lg border border-warning/30 bg-warning-soft p-4 text-warning">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Development quick action</p>
                <p className="text-sm">
                  Create a preset pending booking from existing active records.
                </p>
              </div>
              <DevCreateTestBookingButton />
            </div>
          </div>
        ) : null}

        {/* Form card */}
        <div className="rounded-lg border border-(--color-border) bg-(--color-surface) p-8">
          <NewBookingForm
            packages={packages}
            photographers={photographers}
            departments={departments}
            initialCustomerPhone={initialCustomer?.phone}
            recommendedPhotographer={recommendedPhotographer}
          />
        </div>
      </div>
    </PageContainer>
  );
}

async function getInitialCustomerPhone(
  customerId: string | undefined
): Promise<{ id: string; phone: string } | null> {
  if (!customerId) {
    return null;
  }

  try {
    const customer = await db.customer.findUnique({
      where: { id: customerId },
      select: { id: true, phone: true },
    });

    if (!customer) {
      return null;
    }

    return {
      id: customer.id,
      phone: formatCustomerPhone(customer.phone),
    };
  } catch {
    return null;
  }
}
