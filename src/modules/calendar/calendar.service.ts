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
  status: "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CANCELLED" | "NO_SHOW"
): "Pending" | "Confirmed" | "Cancelled" {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "CONFIRMED":
    case "CHECKED_IN":
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
          packages: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              quantity: true,
              package: { select: { name: true, durationMinutes: true } },
            },
          },
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
    const durationMinutes = row.packages.reduce(
      (total, line) => total + line.package.durationMinutes * line.quantity,
      0
    );
    const end = new Date(row.sessionDate);
    end.setMinutes(end.getMinutes() + Math.max(durationMinutes, 60));
    const packageName =
      row.packages.length > 0
        ? row.packages
            .map((line) =>
              line.quantity > 1
                ? `${line.package.name} x${line.quantity}`
                : line.package.name
            )
            .join(", ")
        : row.package?.name ?? "—";

    return {
      id: row.id,
      title: row.customer.name,
      start: row.sessionDate.toISOString(),
      end: end.toISOString(),
      ...colors,
      extendedProps: {
        customerName: row.customer.name,
        sessionType,
        status: mapBookingStatus(row.status),
        department: row.department.name,
        packageName,
        photographerName: row.assignedPhotographer?.name ?? "—",
      },
    };
  });
}
