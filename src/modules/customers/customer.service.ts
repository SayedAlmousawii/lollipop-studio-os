import { db } from "@/lib/db";
import type { Customer } from "@/components/customers/customers-table";

export async function getCustomers(): Promise<Customer[]> {
  const rows = await db.customer.findMany({
    include: {
      _count: { select: { children: true, bookings: true } },
      bookings: {
        orderBy: { sessionDate: "desc" },
        take: 1,
        select: { sessionDate: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

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
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
