import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/page-container";
import { EditBookingForm } from "@/components/bookings/edit-booking-form";
import { getCustomers } from "@/modules/customers/customer.service";
import {
  getAssignablePhotographers,
  getEditableBookingById,
  getRecommendedPhotographer,
} from "@/modules/bookings/booking.service";
import { getActiveStudioDepartments } from "@/modules/departments/studio-department.service";
import { getPackages } from "@/modules/packages/package.service";

export default async function EditBookingPage(
  props: PageProps<"/bookings/[bookingId]/edit">
) {
  const { bookingId } = await props.params;
  const [booking, allCustomers, allPackages, photographers, departments] =
    await Promise.all([
      getEditableBookingById(bookingId),
      getCustomers(),
      getPackages(),
      getAssignablePhotographers(),
      getActiveStudioDepartments(),
    ]);

  if (!booking) notFound();
  const recommendedPhotographer = await getRecommendedPhotographer(
    booking.customerId
  );

  const customers = allCustomers.map((customer) => ({
    id: customer.id,
    name: customer.fullName,
  }));
  const packages = allPackages.map((item) => ({
    id: item.id,
    name: item.name,
    priceLabel: item.price,
  }));

  return (
    <PageContainer>
      <EditBookingForm
        booking={booking}
        customers={customers}
        packages={packages}
        photographers={photographers}
        departments={departments}
        recommendedPhotographer={recommendedPhotographer}
      />
    </PageContainer>
  );
}
