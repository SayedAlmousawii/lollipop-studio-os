import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import type { Booking } from "@/components/bookings/bookings-table";
import type { BookingStatus } from "@/components/bookings/booking-status-badge";
import type { PaymentStatus } from "@/components/bookings/payment-status-badge";
import type { CreateBookingInput } from "./booking.schema";

export async function getBookings(): Promise<Booking[]> {
  const rows = await withRetry(
    () =>
      db.booking.findMany({
        include: {
          customer: { select: { name: true } },
          package: { select: { name: true } },
          order: { include: { invoice: { select: { status: true } } } },
        },
        orderBy: { sessionDate: "desc" },
      }),
    "Failed to fetch bookings"
  );

  return rows.map((row) => ({
    id: row.id,
    customerName: row.customer.name,
    sessionDate: formatSessionDate(row.sessionDate),
    package: row.package?.name ?? "—",
    status: mapBookingStatus(row.status),
    paymentStatus: mapPaymentStatus(row.order?.invoice?.status),
    assignedStaff: "—",
  }));
}

export async function createBookingInDb(
  data: CreateBookingInput
): Promise<{ id: string }> {
  const customer = await db.customer.findUnique({
    where: { id: data.customerId },
    select: { id: true },
  });
  if (!customer) throw new Error("Customer not found");

  const pkg = await db.package.findUnique({
    where: { id: data.packageId },
    select: { id: true, isActive: true },
  });
  if (!pkg) throw new Error("Package not found");
  if (!pkg.isActive) throw new Error("Package is not active");

  return withRetry(
    () =>
      db.booking.create({
        data: {
          customerId: data.customerId,
          packageId: data.packageId,
          sessionDate: data.sessionDate,
          sessionType: data.sessionType,
          notes: data.notes ?? null,
          status: "PENDING",
          depositPaid: false,
        },
        select: { id: true },
      }),
    "Failed to create booking",
    2
  );
}

function formatSessionDate(date: Date): string {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function mapBookingStatus(
  status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW"
): BookingStatus {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "CONFIRMED":
      return "Confirmed";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
    case "NO_SHOW":
      return "Cancelled";
  }
}

function mapPaymentStatus(
  status: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED" | null | undefined
): PaymentStatus {
  switch (status) {
    case "PARTIAL":
      return "Partial";
    case "PAID":
      return "Paid";
    case "REFUNDED":
      return "Refunded";
    default:
      return "Unpaid";
  }
}
