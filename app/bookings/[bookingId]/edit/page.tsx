import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/page-container";
import { EditBookingForm } from "@/components/bookings/edit-booking-form";
import { getCustomers } from "@/modules/customers/customer.service";
import { getEditableBookingById } from "@/modules/bookings/booking.service";
import { getPackages } from "@/modules/packages/package.service";

export default async function EditBookingPage(
  props: PageProps<"/bookings/[bookingId]/edit">
) {
  const { bookingId } = await props.params;
  const [booking, allCustomers, allPackages] = await Promise.all([
    getEditableBookingById(bookingId),
    getCustomers(),
    getPackages(),
  ]);

  if (!booking) notFound();

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
      />
    </PageContainer>
  );
}
