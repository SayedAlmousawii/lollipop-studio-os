import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import type { Package } from "./package.types";

export async function getPackages(): Promise<Package[]> {
  const rows = await withRetry(
    () =>
      db.package.findMany({
        include: {
          _count: { select: { bookings: true } },
        },
        orderBy: { price: "asc" },
      }),
    "Failed to fetch packages"
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: formatPrice(Number(row.price)),
    photoCount: row.photoCount,
    description: row.description ?? "—",
    bookingCount: row._count.bookings,
    status: row.isActive ? "Active" : "Inactive",
  }));
}

function formatPrice(value: number): string {
  return (
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(value) + " KD"
  );
}
