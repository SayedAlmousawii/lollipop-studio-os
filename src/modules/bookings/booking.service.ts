import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import type { Booking } from "@/components/bookings/bookings-table";
import type { BookingStatus } from "@/components/bookings/booking-status-badge";
import type { PaymentStatus } from "@/components/bookings/payment-status-badge";

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
