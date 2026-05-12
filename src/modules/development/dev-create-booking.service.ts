import { CustomerStatus } from "@prisma/client";
import {
  createBookingInDb,
  getAssignablePhotographers,
} from "@/modules/bookings/booking.service";
import { getCustomers } from "@/modules/customers/customer.service";
import { getActiveStudioDepartments } from "@/modules/departments/studio-department.service";
import { getActivePackageOptions } from "@/modules/packages/package.service";

const TEST_BOOKING_TIME = "17:00";

export interface CreatedDevelopmentBooking {
  id: string;
  customerName: string;
}

export async function createDevelopmentTestBooking(): Promise<CreatedDevelopmentBooking> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Test booking creation is only available in development");
  }

  const [customers, packages, departments, photographers] = await Promise.all([
    getCustomers({ status: CustomerStatus.ACTIVE }),
    getActivePackageOptions(),
    getActiveStudioDepartments(),
    getAssignablePhotographers(),
  ]);

  const customer = customers[0];
  if (!customer) {
    throw new Error("At least one active customer is required to create a test booking");
  }

  const selectedPackage = packages[0];
  if (!selectedPackage) {
    throw new Error("At least one active package is required to create a test booking");
  }

  const department = departments[0];
  if (!department) {
    throw new Error("At least one active department is required to create a test booking");
  }

  const booking = await createBookingInDb({
    phone: customer.phone,
    customerName: customer.fullName,
    packageId: selectedPackage.id,
    sessionDate: buildNextDaySessionDate(TEST_BOOKING_TIME),
    sessionTime: TEST_BOOKING_TIME,
    departmentId: department.id,
    assignedPhotographerId: photographers[0]?.id,
    sessionType: "FAMILY",
    notes: "DEV TEST BOOKING",
    themes: [],
  });

  return {
    id: booking.id,
    customerName: customer.fullName,
  };
}

function buildNextDaySessionDate(time: string): Date {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const year = tomorrow.getUTCFullYear();
  const month = String(tomorrow.getUTCMonth() + 1).padStart(2, "0");
  const day = String(tomorrow.getUTCDate()).padStart(2, "0");

  return new Date(`${year}-${month}-${day}T${time}:00.000Z`);
}
