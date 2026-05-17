import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import {
  SESSION_TYPE_COLORS,
  type CalendarBooking,
  type CalendarSessionType,
} from "@/components/calendar/calendar-mock-data";

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
              sessionType: {
                select: {
                  calendarLabel: true,
                  calendarColor: true,
                  department: { select: { code: true } },
                },
              },
            },
          },
          department: { select: { name: true, code: true } },
          assignedPhotographer: { select: { name: true } },
        },
        orderBy: { sessionDate: "asc" },
      }),
    "Failed to fetch calendar events"
  );

  return rows.map((row) => {
    const firstLineSessionType = row.packages[0]?.sessionType;
    const sessionType = resolveCalendarSessionType({
      calendarLabel: firstLineSessionType?.calendarLabel,
      departmentCode: firstLineSessionType?.department.code ?? row.department.code,
    });
    const colors = resolveCalendarColors({
      calendarLabel: sessionType,
      calendarColor: firstLineSessionType?.calendarColor,
    });
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

export function resolveCalendarSessionType(input: {
  calendarLabel?: string | null;
  departmentCode?: string | null;
}): CalendarSessionType {
  const calendarLabel = input.calendarLabel?.trim();
  if (calendarLabel) {
    return calendarLabel;
  }

  const departmentCode = normalizeTaxonomyCode(input.departmentCode);
  if (departmentCode) {
    return departmentCode;
  }

  return "Other";
}

export function resolveCalendarColors(input: {
  calendarLabel: CalendarSessionType;
  calendarColor?: string | null;
}) {
  const defaultColors =
    SESSION_TYPE_COLORS[input.calendarLabel] ?? SESSION_TYPE_COLORS.Other;
  const calendarColor = input.calendarColor?.trim();
  if (!calendarColor || calendarColor === defaultColors.backgroundColor) {
    return defaultColors;
  }

  return {
    backgroundColor: calendarColor,
    textColor: "var(--color-text-primary)",
    borderColor: calendarColor,
  };
}

function normalizeTaxonomyCode(code: string | null | undefined): string | null {
  const normalized = code?.trim().toUpperCase();
  return normalized ? normalized : null;
}
