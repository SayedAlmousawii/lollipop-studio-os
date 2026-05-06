import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { SESSION_TYPE_COLORS, type CalendarBooking } from "@/components/calendar/calendar-mock-data";

function mapSessionType(
  sessionType: "NEWBORN" | "KIDS" | "FAMILY" | "MATERNITY" | "OTHER"
): "Newborn" | "Kids" | "Family" | "Other" {
  switch (sessionType) {
    case "NEWBORN":
      return "Newborn";
    case "KIDS":
      return "Kids";
    case "FAMILY":
      return "Family";
    case "MATERNITY":
    case "OTHER":
      return "Other";
  }
}

function mapBookingStatus(
  status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW"
): "Pending" | "Confirmed" | "Cancelled" {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "CONFIRMED":
    case "COMPLETED":
      return "Confirmed";
    case "CANCELLED":
    case "NO_SHOW":
      return "Cancelled";
  }
}

export async function getCalendarEvents(): Promise<CalendarBooking[]> {
  const rows = await withRetry(
    () =>
      db.booking.findMany({
        include: {
          customer: { select: { name: true } },
          package: { select: { name: true } },
          department: { select: { name: true } },
          assignedPhotographer: { select: { name: true } },
        },
        orderBy: { sessionDate: "asc" },
      }),
    "Failed to fetch calendar events"
  );

  return rows.map((row) => {
    const sessionType = mapSessionType(row.sessionType);
    const colors = SESSION_TYPE_COLORS[sessionType];
    return {
      id: row.id,
      title: row.customer.name,
      start: row.sessionDate.toISOString(),
      end: row.sessionDate.toISOString(),
      ...colors,
      extendedProps: {
        customerName: row.customer.name,
        sessionType,
        status: mapBookingStatus(row.status),
        department: row.department.name,
        packageName: row.package?.name ?? "—",
        photographerName: row.assignedPhotographer?.name ?? "—",
      },
    };
  });
}
