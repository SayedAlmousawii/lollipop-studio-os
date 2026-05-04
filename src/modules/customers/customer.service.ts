import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import type { Customer } from "./customer.types";

export async function getCustomers(): Promise<Customer[]> {
  const rows = await withRetry(
    () =>
      db.customer.findMany({
        include: {
          _count: { select: { children: true, bookings: true } },
          bookings: {
            orderBy: { sessionDate: "desc" },
            take: 1,
            select: { sessionDate: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    "Failed to fetch customers"
  );

  return rows.map((row) => ({
    id: row.id,
    fullName: row.name,
    phone: row.phone,
    childrenCount: row._count.children,
    totalBookings: row._count.bookings,
    lastSessionDate: row.bookings[0]
      ? formatSessionDate(row.bookings[0].sessionDate)
      : "—",
    status: row.status === "ACTIVE" ? "Active" : "Inactive",
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
