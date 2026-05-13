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
                  code: true,
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
    const sessionType = mapCalendarSessionType({
      sessionTypeCode: firstLineSessionType?.code,
      departmentCode: firstLineSessionType?.department.code ?? row.department.code,
    });
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

export function mapCalendarSessionType(input: {
  sessionTypeCode?: string | null;
  departmentCode?: string | null;
}): CalendarSessionType {
  const sessionTypeCode = normalizeTaxonomyCode(input.sessionTypeCode);
  if (sessionTypeCode) {
    const sessionBucket = CALENDAR_SESSION_TYPE_BY_CODE[sessionTypeCode];
    if (sessionBucket) return sessionBucket;
  }

  const departmentCode = normalizeTaxonomyCode(input.departmentCode);
  if (departmentCode) {
    return CALENDAR_SESSION_TYPE_BY_DEPARTMENT_CODE[departmentCode] ?? "Other";
  }

  return "Other";
}

function normalizeTaxonomyCode(code: string | null | undefined): string | null {
  const normalized = code?.trim().toUpperCase();
  return normalized ? normalized : null;
}

const CALENDAR_SESSION_TYPE_BY_CODE: Record<string, CalendarSessionType> = {
  NB_NEWBORN: "Newborn",
  KD_FAMILY: "Family",
};

const CALENDAR_SESSION_TYPE_BY_DEPARTMENT_CODE: Record<string, CalendarSessionType> = {
  NB: "Newborn",
  KD: "Kids",
};
