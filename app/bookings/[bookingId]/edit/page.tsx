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
  const bookingPromise = getEditableBookingById(bookingId);
  const customersPromise = getCustomers();
  const packagesPromise = getPackages();
  const photographersPromise = getAssignablePhotographers();
  const departmentsPromise = getActiveStudioDepartments();

  const booking = await bookingPromise;

  if (!booking) notFound();

  const recommendedPhotographerPromise = getRecommendedPhotographer(
    booking.customerId
  );
  const [allCustomers, allPackages, photographers, departments, recommendedPhotographer] =
    await Promise.all([
      customersPromise,
      packagesPromise,
      photographersPromise,
      departmentsPromise,
      recommendedPhotographerPromise,
    ]);

  const customers = allCustomers.map((customer) => ({
    id: customer.id,
    name: customer.fullName,
  }));
  const packages = allPackages.map((item) => ({
    id: item.id,
    name: item.name,
    priceLabel: item.price,
    durationMinutes: item.durationMinutes,
    departmentId: item.departmentId,
    departmentName: item.departmentName,
    sessionTypeId: item.sessionTypeId,
    sessionTypeName: item.sessionTypeName,
    packageFamilyId: item.packageFamilyId,
    packageFamilyName: item.packageFamilyName,
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
