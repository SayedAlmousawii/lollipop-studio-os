import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { SESSION_TYPE_COLORS, type CalendarBooking } from "@/components/calendar/calendar-mock-data";

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
          packages: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              quantity: true,
              package: { select: { name: true, durationMinutes: true } },
              sessionType: { select: { name: true } },
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
    const sessionType = mapCalendarSessionType(row.packages[0]?.sessionType.name);
    const colors = SESSION_TYPE_COLORS[sessionType];
    const packageLinesDuration = row.packages.reduce(
      (total, line) => total + line.package.durationMinutes * line.quantity,
      0
    );
    const durationMinutes =
      packageLinesDuration > 0
        ? packageLinesDuration
        : 60;
    const end = new Date(row.sessionDate);
    end.setMinutes(end.getMinutes() + durationMinutes);
    const packageName =
      row.packages.length > 0
        ? row.packages
            .map((line) =>
              line.quantity > 1
                ? `${line.package.name} x${line.quantity}`
                : line.package.name
            )
            .join(", ")
        : "—";

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

function mapCalendarSessionType(
  sessionTypeName: string | null | undefined
): "Newborn" | "Kids" | "Family" | "Other" {
  if (sessionTypeName === "Newborn") return "Newborn";
  if (sessionTypeName === "Family") return "Family";
  if (sessionTypeName === "Regular" || sessionTypeName === "Birthday") {
    return "Kids";
  }
  return "Other";
}
